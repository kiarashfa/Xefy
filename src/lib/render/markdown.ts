/**
 * The small amount of Markdown the narrative content on this site is allowed
 * to use — About panels and technique pages.
 *
 * Not a Markdown library, deliberately. The content rules already forbid nearly
 * everything a library would handle, and what is left is a handful of shapes
 * that fit in fifty lines and never surprise anyone. Step prose is a separate
 * renderer again (`prose.ts`), because it has to resolve live values and is
 * assembled from several files' prose in an order no single document declares.
 */
import { lenHtml, tempHtml } from './live-values.ts';
import type { UnitSystem } from '../math/units.ts';

/**
 * Escaping happens once, here, and inline formatting is applied to the escaped
 * text. Anything that needs to survive escaping — a citation marker — must be
 * pulled out of the source *before* this runs, never after: escaping first
 * turns `<Cite …/>` into `&lt;Cite …/>` and it silently stops being a marker.
 */
function inline(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\s*\n\s*/g, ' ');
}

const VALUE = /<(Temp|Len)\s+(?:c|cm)=\{(-?[\d.]+)\}\s*\/>/g;

/**
 * Temperatures and dimensions are live here too.
 *
 * A technique page explaining that an egg sets somewhere above a stated
 * temperature is making exactly the kind of claim §3.7 exists for: typed as a
 * literal it would stay Celsius for a reader who has asked for Fahrenheit,
 * which is the one thing this site promises never to do. The spans are the same
 * ones a recipe emits, so the same shared script updates them.
 */
function values(text: string, system: UnitSystem): string {
  let html = '';
  let cursor = 0;
  for (const match of text.matchAll(VALUE)) {
    html += inline(text.slice(cursor, match.index));
    cursor = (match.index ?? 0) + match[0].length;
    const amount = Number(match[2]);
    html += match[1] === 'Temp' ? tempHtml(amount, system) : lenHtml(amount, system);
  }
  return html + inline(text.slice(cursor));
}

/** Narrative prose: paragraphs, one level of subhead, and bullet lists. */
export function renderMarkdown(body: string, system: UnitSystem = 'metric'): string {
  return body
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const heading = /^##\s+(.*)$/.exec(block.trim());
      if (heading) return `<h2 class="panel-title">${inline(heading[1]!)}</h2>`;

      const lines = block.trim().split(/\n/);
      if (lines.every((l) => /^[-*]\s+/.test(l.trim()))) {
        const items = lines.map(
          (l) => `<li>${values(l.trim().replace(/^[-*]\s+/, ''), system)}</li>`,
        );
        return `<ul class="prose-list">${items.join('')}</ul>`;
      }

      return `<p>${values(block, system)}</p>`;
    })
    .join('');
}

const CITE = /<Cite\s+ref="([^"]+)"\s*\/>/g;

/**
 * The same prose with citation markers resolved to numbered links. Sourcing is
 * mandatory in an About section and nowhere else (§11.5), which is why this is
 * a separate entry point rather than a flag.
 */
export function renderAbout(body: string, sources: { id: string }[]): string {
  const index = new Map(sources.map((s, i) => [s.id, i + 1]));

  return body
    .trim()
    .split(/\n\s*\n/)
    .map((para) => {
      let html = '';
      let cursor = 0;
      for (const match of para.matchAll(CITE)) {
        html += inline(para.slice(cursor, match.index));
        cursor = (match.index ?? 0) + match[0].length;
        const n = index.get(match[1]!);
        if (n) html += `<a class="cite" href="#source-${match[1]}">[${n}]</a>`;
      }
      html += inline(para.slice(cursor));
      return `<p>${html}</p>`;
    })
    .join('');
}
