/**
 * The build-time integrity checks.
 *
 * Each check answers one question about the content set, and each declares
 * whether a hit stops the build or only reports. The split matters: a failure
 * means a number on the page would be wrong, while a warning means something
 * looks unintended but the page is still truthful.
 *
 * Checks that need the transclusion and math engines are registered here as
 * pending rather than left out, so the run always reports its own coverage
 * instead of quietly checking less than it appears to.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { isComponentStep, type IngredientLine, type StepEntry } from '../../src/schemas/recipe.ts';
import { ALLERGENS, ANIMAL_ORIGINS } from '../../src/schemas/vocabularies.ts';
import { ALLERGEN_TERMS, DIETS } from '../../src/schemas/taxonomy.ts';
import { ROOT, type Content, type StepProse } from '../../src/lib/content/disk.ts';
import { resolveRecipe, type ComponentInput } from '../../src/lib/content/resolve.ts';
import { parallelTarget } from '../../src/lib/math/timing.ts';
import { proseName } from '../../src/lib/render/prose.ts';

export type Severity = 'fail' | 'warn';

export interface Finding {
  check: string;
  severity: Severity;
  file: string;
  message: string;
}

export interface CheckResult {
  findings: Finding[];
  /** Checks that could not run yet, and what they are waiting on. */
  pending: { check: string; waitingOn: string }[];
}

/* ------------------------------------------------------------------ *
 * Shared extraction
 * ------------------------------------------------------------------ */

const SELF_CLOSING = (tag: string) => new RegExp(`<${tag}\\b([^>]*?)/?>`, 'g');
const attr = (source: string, name: string) =>
  source.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`))?.[1];

/** Every id a `<Qty>` may legitimately point at within one ingredient list. */
function refTargets(lines: IngredientLine[]): Set<string> {
  const ids = new Set<string>();
  for (const line of lines) {
    if (line.portions) {
      // A split line is referenced by its portions; the parent id names the
      // checklist row, not a quantity any single step adds.
      for (const p of line.portions) ids.add(p.id);
    } else {
      ids.add(line.id);
    }
  }
  return ids;
}

function qtyRefs(steps: StepProse[]): { stepId: string; ref: string }[] {
  const out: { stepId: string; ref: string }[] = [];
  for (const step of steps) {
    for (const match of step.text.matchAll(SELF_CLOSING('Qty'))) {
      out.push({ stepId: step.stepId, ref: attr(match[1] ?? '', 'ref') ?? '' });
    }
  }
  return out;
}

function durRefs(steps: StepProse[]): { stepId: string; ref: string }[] {
  const out: { stepId: string; ref: string }[] = [];
  for (const step of steps) {
    for (const match of step.text.matchAll(SELF_CLOSING('Dur'))) {
      out.push({ stepId: step.stepId, ref: attr(match[1] ?? '', 'step') ?? '' });
    }
  }
  return out;
}

const inlineStepIds = (steps: StepEntry[]) =>
  new Set(steps.filter((s) => !isComponentStep(s)).map((s) => (s as { id: string }).id));

/* ------------------------------------------------------------------ *
 * Literal-number allowlist
 * ------------------------------------------------------------------ */

interface AllowlistEntry {
  file: string;
  stepId: string;
  text: string;
  reason: string;
}

async function loadLiteralAllowlist(): Promise<AllowlistEntry[]> {
  const file = path.join(ROOT, 'scripts', 'integrity', 'literal-allowlist.json');
  const parsed = JSON.parse(await readFile(file, 'utf8')) as { entries?: AllowlistEntry[] };
  return parsed.entries ?? [];
}

/**
 * Strips every component call and MDX/JSX tag out of step prose, leaving only
 * the words a reader sees as sentence text. Anything numeric left in there is
 * a number typed by hand.
 */
function proseWithoutComponents(text: string): string {
  return text
    .replace(/<[A-Z][A-Za-z0-9]*\b[^>]*?\/>/g, ' ') // self-closing components
    .replace(/<\/?[A-Za-z][A-Za-z0-9-]*\b[^>]*>/g, ' ') // remaining tags
    .replace(/\{[^}]*\}/g, ' ') // JSX expressions
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' '); // markdown links
}

const DIGITS = /\d+(?:[.,]\d+)?/g;

/* ------------------------------------------------------------------ *
 * The checks
 * ------------------------------------------------------------------ */

export async function runChecks(content: Content): Promise<CheckResult> {
  const findings: Finding[] = [];
  const pending: CheckResult['pending'] = [];
  const add = (check: string, severity: Severity, file: string, message: string) =>
    findings.push({ check, severity, file, message });

  const ingredientBySlug = new Map(content.ingredients.map((i) => [i.slug, i]));
  const componentBySlug = new Map(content.components.map((c) => [c.slug, c]));
  const recipeSlugs = new Set(content.recipeVersions.map((v) => v.recipe));

  /** Recipe versions and Components share an ingredients + steps + prose shape. */
  const authored = [
    ...content.recipeVersions.map((v) => ({
      kind: 'recipe' as const,
      file: v.file,
      ingredients: v.data.ingredients,
      steps: v.data.steps,
      prose: v.steps,
      substitutions: 'substitutions' in v.data ? v.data.substitutions : [],
      notes: 'notes' in v.data ? v.data.notes : undefined,
    })),
    ...content.components.map((c) => ({
      kind: 'component' as const,
      file: c.file,
      ingredients: c.data.ingredients,
      steps: c.data.steps,
      prose: c.steps,
      substitutions: [] as never[],
      notes: undefined,
    })),
  ];

  /* --- 1. Portion amounts must sum to the line total ------------------- */
  for (const unit of authored) {
    for (const line of unit.ingredients) {
      if (!line.portions) continue;
      const sum = line.portions.reduce((n, p) => n + p.amount, 0);
      if (Math.abs(sum - line.amount) > 1e-6) {
        add(
          'portion-sums',
          'fail',
          unit.file,
          `"${line.id}": portions total ${sum}${line.unit}, but the line declares ${line.amount}${line.unit}`,
        );
      }
    }
  }

  /* --- 2. Every <Qty ref> resolves ------------------------------------- */
  for (const unit of authored) {
    const targets = refTargets(unit.ingredients);
    const parentIds = new Set(unit.ingredients.filter((l) => l.portions).map((l) => l.id));
    for (const { stepId, ref } of qtyRefs(unit.prose)) {
      if (targets.has(ref)) continue;
      const hint = parentIds.has(ref)
        ? ` — "${ref}" is split across portions, so a step references one of its portion ids`
        : '';
      add(
        'qty-refs',
        'fail',
        unit.file,
        `step "${stepId}": <Qty ref="${ref}"/> does not resolve to an ingredient or portion${hint}`,
      );
    }
  }

  /* --- 3. Every componentRef resolves ---------------------------------- */
  for (const unit of authored) {
    for (const step of unit.steps) {
      if (!isComponentStep(step)) continue;
      if (!componentBySlug.has(step.componentRef)) {
        add(
          'component-refs',
          'fail',
          unit.file,
          `componentRef "${step.componentRef}" has no file in src/content/components/`,
        );
      }
    }
  }

  /* --- 4. Every ingredientRef and Form resolves ------------------------ */
  for (const unit of authored) {
    for (const line of unit.ingredients) {
      const ing = ingredientBySlug.get(line.ingredientRef);
      if (!ing) {
        add(
          'ingredient-refs',
          'fail',
          unit.file,
          `"${line.id}": ingredientRef "${line.ingredientRef}" has no record in src/content/ingredients/`,
        );
        continue;
      }
      if (!ing.data.forms.some((f) => f.id === line.form)) {
        const available = ing.data.forms.map((f) => f.id).join(', ');
        add(
          'ingredient-refs',
          'fail',
          unit.file,
          `"${line.id}": "${line.ingredientRef}" has no form "${line.form}" (has: ${available})`,
        );
      }
    }
  }

  /* --- 5. Every <Dur step> resolves; every inline step declares an id --- */
  for (const unit of authored) {
    const own = inlineStepIds(unit.steps);
    // A recipe may time a step that arrives through a Component.
    const fromComponents = new Set<string>();
    for (const step of unit.steps) {
      if (!isComponentStep(step)) continue;
      const component = componentBySlug.get(step.componentRef);
      if (!component) continue;
      for (const id of inlineStepIds(component.data.steps)) fromComponents.add(id);
    }
    for (const { stepId, ref } of durRefs(unit.prose)) {
      if (own.has(ref) || fromComponents.has(ref)) continue;
      add(
        'dur-refs',
        'fail',
        unit.file,
        `step "${stepId}": <Dur step="${ref}"/> does not resolve to a declared step`,
      );
    }
    for (const prose of unit.prose) {
      if (!prose.stepId) {
        add('step-ids', 'fail', unit.file, `a <Step> block at line ${prose.line} has no id`);
      } else if (!own.has(prose.stepId)) {
        add(
          'step-ids',
          'fail',
          unit.file,
          `<Step id="${prose.stepId}"> at line ${prose.line} has no matching entry in the steps frontmatter`,
        );
      }
    }
    for (const step of unit.steps) {
      if (isComponentStep(step)) continue;
      if (!unit.prose.some((p) => p.stepId === step.id)) {
        add(
          'step-ids',
          'fail',
          unit.file,
          `step "${step.id}" is declared in frontmatter but has no <Step id="${step.id}"> block in the body`,
        );
      }
    }
    // parallel-with must point at a sibling step.
    for (const step of unit.steps) {
      if (isComponentStep(step)) continue;
      const target = step.type.startsWith('parallel-with:') ? step.type.slice(14) : null;
      if (!target) continue;
      if (!own.has(target) && !fromComponents.has(target)) {
        add(
          'step-ids',
          'fail',
          unit.file,
          `step "${step.id}" is parallel-with "${target}", which is not a step in this sequence`,
        );
      }
      if (target === step.id) {
        add('step-ids', 'fail', unit.file, `step "${step.id}" is parallel with itself`);
      }
    }
  }

  /* --- 6. No hand-typed numbers in step prose -------------------------- */
  const allowlist = await loadLiteralAllowlist();
  const allowed = new Set(allowlist.map((e) => `${e.file}::${e.stepId}::${e.text}`));
  for (const unit of authored) {
    for (const prose of unit.prose) {
      const bare = proseWithoutComponents(prose.text);
      for (const match of bare.matchAll(DIGITS)) {
        const literal = match[0];
        if (allowed.has(`${unit.file}::${prose.stepId}::${literal}`)) continue;
        add(
          'literal-numbers',
          'fail',
          unit.file,
          `step "${prose.stepId}": the literal "${literal}" is not inside <Qty>, <Temp>, <Len> or <Dur>. ` +
            `Spell out a plain count ("six wedges"), or add an entry to scripts/integrity/literal-allowlist.json`,
        );
      }
    }
  }

  /* --- 7. Naming entries are usable knowledge -------------------------- */
  for (const version of content.recipeVersions) {
    if (!('names' in version.data)) continue;
    const names = version.data.names;
    for (const entry of names.notToBeConfusedWith) {
      if (!entry.note.trim()) {
        add(
          'names',
          'fail',
          version.file,
          `notToBeConfusedWith "${entry.name}" has an empty note; an entry without the difference stated misinforms`,
        );
      }
      if (entry.slugRef && !recipeSlugs.has(entry.slugRef) && !ingredientBySlug.has(entry.slugRef)) {
        add(
          'names',
          'fail',
          version.file,
          `notToBeConfusedWith "${entry.name}": slugRef "${entry.slugRef}" matches no recipe or ingredient`,
        );
      }
    }
  }
  for (const ingredient of content.ingredients) {
    const names = ingredient.data.names;
    const formIds = new Set(ingredient.data.forms.map((f) => f.id));
    for (const entry of names.alsoKnownAs) {
      if (entry.formRef && !formIds.has(entry.formRef)) {
        add(
          'names',
          'fail',
          ingredient.file,
          `alsoKnownAs "${entry.name}": formRef "${entry.formRef}" is not a form of this ingredient`,
        );
      }
    }
    for (const entry of names.notToBeConfusedWith) {
      if (!entry.note.trim()) {
        add(
          'names',
          'fail',
          ingredient.file,
          `notToBeConfusedWith "${entry.name}" has an empty note`,
        );
      }
      if (entry.slugRef && !recipeSlugs.has(entry.slugRef) && !ingredientBySlug.has(entry.slugRef)) {
        add(
          'names',
          'fail',
          ingredient.file,
          `notToBeConfusedWith "${entry.name}": slugRef "${entry.slugRef}" matches no recipe or ingredient`,
        );
      }
    }
  }

  /* --- 8. Id collisions ------------------------------------------------ */
  for (const unit of authored) {
    const seenLine = new Map<string, number>();
    for (const line of unit.ingredients) {
      seenLine.set(line.id, (seenLine.get(line.id) ?? 0) + 1);
      for (const p of line.portions ?? []) {
        seenLine.set(p.id, (seenLine.get(p.id) ?? 0) + 1);
      }
    }
    for (const [id, count] of seenLine) {
      if (count > 1) {
        add('id-collisions', 'fail', unit.file, `ingredient or portion id "${id}" is used ${count} times`);
      }
    }
    const seenStep = new Map<string, number>();
    for (const step of unit.steps) {
      if (isComponentStep(step)) continue;
      seenStep.set(step.id, (seenStep.get(step.id) ?? 0) + 1);
    }
    for (const [id, count] of seenStep) {
      if (count > 1) {
        add('id-collisions', 'fail', unit.file, `step id "${id}" is used ${count} times`);
      }
    }
  }

  /* --- 9. consumedFraction is a fraction ------------------------------- */
  for (const unit of authored) {
    for (const line of unit.ingredients) {
      if (!(line.consumedFraction > 0 && line.consumedFraction <= 1)) {
        add(
          'consumed-fraction',
          'fail',
          unit.file,
          `"${line.id}": consumedFraction ${line.consumedFraction} is outside 0 < x ≤ 1`,
        );
      }
    }
  }

  /* --- Structural: recipe directories, versions, references ------------ */
  const byRecipe = new Map<string, typeof content.recipeVersions>();
  for (const version of content.recipeVersions) {
    const list = byRecipe.get(version.recipe) ?? [];
    list.push(version);
    byRecipe.set(version.recipe, list);
  }
  /** The recipe's directory, taken from a real file so fixture runs report real paths. */
  const dirOf = (versions: typeof content.recipeVersions) =>
    `${versions[0]!.file.slice(0, versions[0]!.file.lastIndexOf('/'))}/`;

  for (const versions of byRecipe.values()) {
    if (!versions.some((v) => v.isDefault)) {
      add(
        'recipe-structure',
        'fail',
        dirOf(versions),
        'has no index.mdx; the default version carries the recipe identity and the canonical URL',
      );
    }
    const labels = versions.map((v) => v.data.label);
    const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);
    for (const label of new Set(dupes)) {
      add(
        'recipe-structure',
        'fail',
        dirOf(versions),
        `two versions share the label "${label}"; a label has to tell its version apart from its siblings`,
      );
    }
  }
  for (const version of content.recipeVersions) {
    const lineIds = new Set(version.data.ingredients.map((l) => l.id));
    // A note may reasonably attach to a step that arrives through a Component:
    // once flattened it is an ordinary step of this method, and the reason a
    // roux is cooked out belongs beside the step that cooks it.
    const stepIds = inlineStepIds(version.data.steps);
    for (const step of version.data.steps) {
      if (!isComponentStep(step)) continue;
      const component = componentBySlug.get(step.componentRef);
      if (!component) continue;
      for (const id of inlineStepIds(component.data.steps)) stepIds.add(id);
    }
    for (const sub of version.data.substitutions) {
      if (!lineIds.has(sub.lineRef)) {
        add(
          'recipe-structure',
          'fail',
          version.file,
          `substitution lineRef "${sub.lineRef}" matches no ingredient line`,
        );
      }
    }
    const noteEntries = [
      ...version.data.notes.techniqueRationale,
      ...version.data.notes.commonPitfalls,
    ];
    for (const note of noteEntries) {
      if (note.stepId && !stepIds.has(note.stepId)) {
        add('recipe-structure', 'fail', version.file, `note stepId "${note.stepId}" matches no step`);
      }
    }
  }

  /* --- Structural: vocabularies stay in step --------------------------- */
  const allergenTermIds = new Set(ALLERGEN_TERMS.map((t) => t.id));
  for (const id of ALLERGENS) {
    if (!allergenTermIds.has(id)) {
      add(
        'vocabularies',
        'fail',
        'src/data/taxonomy/allergens.json',
        `allergen "${id}" is declared in code but has no display label here`,
      );
    }
  }
  for (const term of ALLERGEN_TERMS) {
    if (!(ALLERGENS as readonly string[]).includes(term.id)) {
      add(
        'vocabularies',
        'fail',
        'src/data/taxonomy/allergens.json',
        `"${term.id}" is not in the fixed allergen vocabulary`,
      );
    }
  }
  const heroDiets = DIETS.filter((d) => d.heroEligible).map((d) => d.id);
  for (const id of ['vegan', 'vegetarian', 'pescatarian']) {
    if (!heroDiets.includes(id)) {
      add(
        'vocabularies',
        'fail',
        'src/data/taxonomy/diets.json',
        `"${id}" must be present and hero-eligible; the hero picks the most restrictive of these`,
      );
    }
  }
  for (const ingredient of content.ingredients) {
    if (!(ANIMAL_ORIGINS as readonly string[]).includes(ingredient.data.animalOrigin)) {
      add(
        'vocabularies',
        'fail',
        ingredient.file,
        `animalOrigin "${ingredient.data.animalOrigin}" is not in the fixed vocabulary`,
      );
    }
  }

  /* --- 10. Ingredients nobody reaches for (warn) ----------------------- */
  for (const unit of authored) {
    const used = new Set(qtyRefs(unit.prose).map((r) => r.ref));
    for (const line of unit.ingredients) {
      if (line.notReferencedInSteps) continue;
      const targets = line.portions ? line.portions.map((p) => p.id) : [line.id];
      const unused = targets.filter((id) => !used.has(id));
      if (unused.length === targets.length) {
        add(
          'unreferenced-ingredients',
          'warn',
          unit.file,
          `"${line.id}" is never named by a <Qty> in the method. Add a step reference, or set notReferencedInSteps to say why not`,
        );
      } else if (unused.length > 0) {
        add(
          'unreferenced-ingredients',
          'warn',
          unit.file,
          `"${line.id}": portion(s) ${unused.join(', ')} are never named by a <Qty>`,
        );
      }
    }
  }

  /* --- 11. Partial consumption not declared (warn) --------------------- */
  const consumption = JSON.parse(
    await readFile(path.join(ROOT, 'src', 'data', 'consumption-classes.json'), 'utf8'),
  ) as {
    classes: {
      id: string;
      label: string;
      defaultConsumedFraction: number;
      matches: { categories: string[]; minAmount?: number; lineIdPatterns: string[] };
      note: string;
    }[];
  };
  for (const unit of authored) {
    for (const line of unit.ingredients) {
      if (line.consumedFraction < 1) continue;
      const category = ingredientBySlug.get(line.ingredientRef)?.data.category ?? '';
      const hit = consumption.classes.find((c) => {
        if (c.matches.lineIdPatterns.some((p) => line.id.includes(p))) return true;
        // Category alone is too broad — a drizzle of oil is not a fryer full of
        // it — so a category match also has to clear an amount floor.
        if (!c.matches.categories.includes(category)) return false;
        return c.matches.minAmount != null && line.amount >= c.matches.minAmount;
      });
      if (hit) {
        add(
          'partial-consumption',
          'warn',
          unit.file,
          `"${line.id}" looks like ${hit.label} (${hit.id}) but has no consumedFraction. ` +
            `If most of it is discarded, the nutrition figures overstate the dish — a typical value is ${hit.defaultConsumedFraction}`,
        );
      }
    }
  }

  /* --- 8, 12, 13. What only survives contact with the real engine ------ */

  // Everything above reads the content as authored. These run it through
  // transclusion and the math engine, which is where merge collisions, an
  // unconvertible amount, and a timing card that disagrees with itself show up.
  const componentInputs = new Map<string, ComponentInput>(
    content.components.map((c) => [
      c.slug,
      { slug: c.slug, data: c.data, prose: new Map(c.steps.map((s) => [s.stepId, s.text])) },
    ]),
  );
  const ingredientIndex = new Map(content.ingredients.map((i) => [i.slug, i.data]));

  for (const version of content.recipeVersions) {
    let resolved;
    try {
      resolved = resolveRecipe(
        {
          slug: version.recipe,
          versionId: version.versionId,
          data: version.data,
          prose: new Map(version.steps.map((s) => [s.stepId, s.text])),
        },
        componentInputs,
        ingredientIndex,
      );
    } catch (error) {
      add(
        'transclusion',
        'fail',
        version.file,
        `could not be flattened: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    for (const message of resolved.errors) add('transclusion', 'fail', version.file, message);
    for (const message of resolved.warnings) add('transclusion', 'warn', version.file, message);

    // Two Forms of one ingredient are two lines on purpose — but if they read
    // the same in the method, the reader cannot tell which one a step means.
    const byIngredient = new Map<string, typeof resolved.lines>();
    for (const line of resolved.lines) {
      const key = line.ingredient.id;
      byIngredient.set(key, [...(byIngredient.get(key) ?? []), line]);
    }
    for (const [ingredientId, group] of byIngredient) {
      if (group.length < 2) continue;
      const names = group.map((l) => proseName(l));
      if (new Set(names).size < names.length) {
        add(
          'ambiguous-forms',
          'fail',
          version.file,
          `this recipe uses ${group.length} forms of "${ingredientId}" that all read as "${names[0]}" in the method. ` +
            `Give each form a proseQualifier so a step can say which one it means`,
        );
      }
    }

    // 8. Nothing may share an id once Components have been merged in.
    const ids = new Map<string, number>();
    for (const line of resolved.flat.ingredients) {
      ids.set(line.id, (ids.get(line.id) ?? 0) + 1);
      for (const p of line.portions ?? []) ids.set(p.id, (ids.get(p.id) ?? 0) + 1);
    }
    for (const step of resolved.flat.steps) {
      ids.set(step.id, (ids.get(step.id) ?? 0) + 1);
    }
    for (const [id, count] of ids) {
      if (count > 1) {
        add('id-collisions', 'fail', version.file, `"${id}" is used ${count} times after the merge`);
      }
    }

    // The merge re-expresses contributions as portions, so the portion-sum rule
    // above validates it for free — but only if it is applied to the merged
    // list too, which is what this does.
    for (const line of resolved.flat.ingredients) {
      if (!line.portions) continue;
      const sum = line.portions.reduce((n, p) => n + p.amount, 0);
      if (Math.abs(sum - line.amount) > 1e-6) {
        add(
          'portion-sums',
          'fail',
          version.file,
          `after the merge, "${line.id}" totals ${line.amount}${line.unit} but its portions come to ${sum}${line.unit}`,
        );
      }
    }

    // 12. The card has to be internally consistent. If timing is computed this
    // cannot fail, so a failure means something has been hand-typed.
    const { prep, cook, rest, total } = resolved.timing;
    if (Math.abs(prep + cook + rest - total) > 1e-9) {
      add(
        'timing-card-sum',
        'fail',
        version.file,
        `the timing card does not add up: prep ${prep} + cook ${cook} + rest ${rest} ≠ total ${total}`,
      );
    }
    const hasParallel = resolved.flat.steps.some((s) => parallelTarget(s.type) != null);
    if (!hasParallel) {
      const declared = resolved.flat.steps.reduce((n, s) => n + s.durationMin, 0);
      if (Math.abs(declared - total) > 1e-9) {
        add(
          'timing-card-sum',
          'fail',
          version.file,
          `no step runs alongside another, so the total should be the sum of the steps (${declared}), not ${total}`,
        );
      }
    }

    // 13. Same data, same rule — so a divergence means the two have drifted.
    if (Math.abs(resolved.criticalPathMin - total) > 1e-9) {
      add(
        'timeline-critical-path',
        'fail',
        version.file,
        `the timeline's critical path is ${resolved.criticalPathMin} minutes but the timing card totals ${total}`,
      );
    }
  }

  /* --- 14. Multi-version recipes need an editorial look (warn) --------- */
  for (const versions of byRecipe.values()) {
    if (versions.length < 2) continue;
    const labels = versions.map((v) => `"${v.data.label}"`).join(', ');
    add(
      'version-tab-rule',
      'warn',
      dirOf(versions),
      `has ${versions.length} versions (${labels}). Tabs are only for the same name and the same core ingredient identity — confirm these are not separate dishes`,
    );
  }

  return { findings, pending };
}
