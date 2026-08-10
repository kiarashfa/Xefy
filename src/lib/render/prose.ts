import type { UnitSystem } from '../math/units.ts';
import type { ResolvedRecipe } from '../content/resolve.ts';
import { durHtml, escapeHtml, lenHtml, qtyHtml, tempHtml, type QtyData } from './live-values.ts';

/**
 * Renders one step's authored prose to HTML.
 *
 * Step prose is a deliberately small language: sentences, four components, and
 * light emphasis. Nothing else is allowed in it, because every number has to
 * come from structured data — so rendering it here rather than through the
 * general MDX pipeline is not a limitation, it is the same constraint the
 * content rules already impose.
 *
 * It also has to be done this way. Transclusion interleaves a Component's steps
 * into the parent's sequence, so a page's method is assembled from several
 * files' prose in an order neither of them declares. There is no single
 * document to hand to a Markdown renderer.
 */

const COMPONENT = /<(Qty|Temp|Len|Dur)\b([^>]*?)\/?>/g;

const stringAttr = (source: string, name: string): string | undefined =>
  source.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`))?.[1];

/** Numeric props are authored JSX-style: `c={260}`. Plain `c="260"` also works. */
const numberAttr = (source: string, name: string): number | undefined => {
  const braced = source.match(new RegExp(`\\b${name}\\s*=\\s*\\{\\s*([-\\d.]+)\\s*\\}`));
  if (braced) return Number(braced[1]);
  const quoted = source.match(new RegExp(`\\b${name}\\s*=\\s*"([-\\d.]+)"`));
  return quoted ? Number(quoted[1]) : undefined;
};

/** Emphasis and links only. Everything else in the source is literal text. */
function inlineMarkdown(escaped: string): string {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
}

export interface ProseContext {
  recipe: ResolvedRecipe;
  servings: number;
  system: UnitSystem;
}

/** Finds the merged line or portion a ref points at, and the amount it means. */
function qtyDataFor(recipe: ResolvedRecipe, ref: string): QtyData | null {
  for (const resolved of recipe.lines) {
    const { line } = resolved;
    const portion = line.portions?.find((p) => p.id === ref);
    if (line.id !== ref && !portion) continue;

    return {
      amount: portion ? portion.amount : line.amount,
      unit: line.unit,
      defaultServings: recipe.defaultServings,
      name: proseName(resolved),
      density: resolved.density,
    };
  }
  return null;
}

/**
 * How an ingredient reads mid-sentence.
 *
 * The Form is named only when it carries a qualifier written for prose. A form
 * *label* is a heading — "Made with animal rennet" is exactly right above a
 * nutrition table and absurd in the middle of a sentence — so the two are
 * separate fields rather than one doing both jobs badly.
 */
export function proseName(resolved: ResolvedRecipe['lines'][number]): string {
  const base = resolved.ingredient.proseName ?? resolved.ingredient.name.toLowerCase();
  const qualifier = resolved.form.proseQualifier;
  return qualifier ? `${qualifier} ${base}` : base;
}

export function renderProse(prose: string, context: ProseContext): string {
  const { recipe, servings, system } = context;
  let out = '';
  let cursor = 0;

  for (const match of prose.matchAll(COMPONENT)) {
    const start = match.index ?? 0;
    out += inlineMarkdown(escapeHtml(prose.slice(cursor, start)));
    cursor = start + match[0].length;

    const [, tag, rawAttrs = ''] = match;
    switch (tag) {
      case 'Qty': {
        const ref = stringAttr(rawAttrs, 'ref') ?? '';
        const data = qtyDataFor(recipe, ref);
        // Unresolvable refs fail the build, so reaching this branch means the
        // checks were bypassed. Show the ref rather than swallowing it.
        out += data
          ? qtyHtml({ ...data, fraction: numberAttr(rawAttrs, 'fraction') }, servings, system)
          : `<span class="qty is-unresolved">[${escapeHtml(ref)}]</span>`;
        break;
      }
      case 'Temp': {
        const c = numberAttr(rawAttrs, 'c');
        out += c == null ? '' : tempHtml(c, system);
        break;
      }
      case 'Len': {
        const cm = numberAttr(rawAttrs, 'cm');
        out += cm == null ? '' : lenHtml(cm, system);
        break;
      }
      case 'Dur': {
        const stepId = stringAttr(rawAttrs, 'step') ?? '';
        const step = recipe.flat.steps.find((s) => s.id === stepId);
        out += step
          ? durHtml(step.durationMin, step.id)
          : `<span class="value is-unresolved">[${escapeHtml(stepId)}]</span>`;
        break;
      }
    }
  }

  out += inlineMarkdown(escapeHtml(prose.slice(cursor)));
  // Authored prose is indented inside its MDX block; collapse that away.
  return out.replace(/\s*\n\s*/g, ' ').trim();
}
