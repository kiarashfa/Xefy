import { isComponentStep, type IngredientLine, type StepEntry } from '../../schemas/recipe.ts';
import type { StepPhase } from '../../schemas/vocabularies.ts';
import { mergeByForm, type SourceKey } from './merge.ts';

export { mergeByForm, groupKey, type MergeGroup, type MergeInput, type SourceKey } from './merge.ts';

/**
 * Build-time Component flattening.
 *
 * A recipe that reuses "béchamel" ends up as one seamless page: the sauce's
 * steps sit in the method where they belong, its flour joins the flour already
 * in the checklist, and the timing card counts all of it. The reader never
 * clicks away to find out how to make part of their dinner.
 *
 * The intricate half is ingredients. Two "Flour" rows in one checklist reads as
 * a bug, so contributions to the same ingredient and form merge into a single
 * line expressed as portions — which has the useful side effect that the
 * existing portions-must-sum check validates the merge itself, with no separate
 * verification path.
 */

export interface FlattenSource {
  ingredients: IngredientLine[];
  steps: StepEntry[];
  /** Step id to its authored prose. */
  prose: Map<string, string>;
}

export interface ComponentSource extends FlattenSource {
  slug: string;
  title: string;
}

export interface MergedPortion {
  id: string;
  amount: number;
  note?: string | undefined;
  sourceKey: SourceKey;
}

export interface MergedLine {
  id: string;
  ingredientRef: string;
  form: string;
  unit: 'g' | 'ml';
  /** Already carries each Component's multiplier. The serving scale applies later. */
  amount: number;
  note?: string | undefined;
  optional: boolean;
  consumedFraction: number;
  consumedFractionNote?: string | undefined;
  notReferencedInSteps?: string | undefined;
  /** Present when the line was split by its author, merged from several sources, or both. */
  portions?: MergedPortion[];
  /** Which sources contributed, and how much, so a total can be explained. */
  contributions: { sourceKey: SourceKey; amount: number }[];
}

export interface FlatStep {
  id: string;
  sourceKey: SourceKey;
  /** 1-based position in the flattened method. */
  number: number;
  durationMin: number;
  type: string;
  phase?: StepPhase | undefined;
  /** Prose with every ref rewritten to its post-merge id. */
  prose: string;
  /** The component this step arrived from, for provenance in the UI. */
  fromComponent?: { slug: string; title: string } | undefined;
}

export interface FlattenResult {
  ingredients: MergedLine[];
  steps: FlatStep[];
  /** Authored substitution targets, remapped onto post-merge line ids. */
  substitutionTargets: Map<string, string>;
  components: { sourceKey: SourceKey; slug: string; title: string; multiplier: number }[];
  warnings: string[];
}

export class TransclusionError extends Error {}

const QTY_REF = /(<Qty\b[^>]*?\bref\s*=\s*")([^"]*)(")/g;
const DUR_REF = /(<Dur\b[^>]*?\bstep\s*=\s*")([^"]*)(")/g;

/* The grouping rule is shared with the shopping list, so it lives on its own
 * (see merge.ts for why it is not in this file). */

/**
 * Keeps an authored id when it is free and namespaces it when it is not.
 *
 * Authored ids are meaningful, so churning them all would make the flattened
 * output harder to read and debug for no gain. Where two sources genuinely
 * collide, the source key disambiguates — which is what produces the
 * `flour__self` / `flour__bechamel` shape on a real merge.
 */
function claimId(preferred: string, sourceKey: SourceKey, taken: Set<string>): string {
  if (!taken.has(preferred)) {
    taken.add(preferred);
    return preferred;
  }
  const namespaced = `${preferred}__${sourceKey}`;
  if (!taken.has(namespaced)) {
    taken.add(namespaced);
    return namespaced;
  }
  for (let n = 2; ; n += 1) {
    const candidate = `${namespaced}-${n}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

interface Instance {
  sourceKey: SourceKey;
  source: FlattenSource;
  component?: { slug: string; title: string; multiplier: number } | undefined;
  multiplier: number;
}

/**
 * Expands the step list into a flat sequence of instances, following component
 * references down as far as they go.
 */
function collectInstances(
  parent: FlattenSource,
  components: Map<string, ComponentSource>,
): { order: { instance: Instance; step: Exclude<StepEntry, { componentRef: string }> }[]; instances: Instance[] } {
  const instances: Instance[] = [];
  const order: { instance: Instance; step: Exclude<StepEntry, { componentRef: string }> }[] = [];
  const occurrences = new Map<string, number>();

  const walk = (instance: Instance, ancestry: readonly string[]) => {
    instances.push(instance);
    for (const step of instance.source.steps) {
      if (!isComponentStep(step)) {
        order.push({ instance, step });
        continue;
      }
      const component = components.get(step.componentRef);
      if (!component) {
        throw new TransclusionError(
          `component "${step.componentRef}" does not exist, so it cannot be flattened in`,
        );
      }
      if (ancestry.includes(step.componentRef)) {
        throw new TransclusionError(
          `component "${step.componentRef}" ends up including itself (via ${[...ancestry, step.componentRef].join(' → ')})`,
        );
      }

      // A component used twice in one recipe gets its occurrences kept apart,
      // so two batches of the same sauce stay traceable rather than collapsing.
      const seen = (occurrences.get(step.componentRef) ?? 0) + 1;
      occurrences.set(step.componentRef, seen);
      const usedAgain = instanceCount(parent, components, step.componentRef) > 1;
      const sourceKey = usedAgain ? `${step.componentRef}#${seen}` : step.componentRef;

      walk(
        {
          sourceKey,
          source: component,
          component: {
            slug: component.slug,
            title: component.title,
            multiplier: step.multiplier,
          },
          // A component's own multiplier compounds with any it is nested inside.
          multiplier: instance.multiplier * step.multiplier,
        },
        [...ancestry, step.componentRef],
      );
    }
  };

  walk({ sourceKey: 'self', source: parent, multiplier: 1 }, []);
  return { order, instances };
}

/** How many times a component ends up used, counting nested reuse. */
function instanceCount(
  parent: FlattenSource,
  components: Map<string, ComponentSource>,
  slug: string,
  seen: Set<string> = new Set(),
): number {
  let count = 0;
  for (const step of parent.steps) {
    if (!isComponentStep(step)) continue;
    if (step.componentRef === slug) count += 1;
    if (seen.has(step.componentRef)) continue;
    const nested = components.get(step.componentRef);
    if (nested) {
      count += instanceCount(nested, components, slug, new Set([...seen, step.componentRef]));
    }
  }
  return count;
}

export function flatten(
  parent: FlattenSource,
  components: Map<string, ComponentSource>,
): FlattenResult {
  const warnings: string[] = [];
  const { order, instances } = collectInstances(parent, components);

  /* --- 1. Steps: one sequence, renumbered, ids kept where they are free --- */

  const takenStepIds = new Set<string>();
  const stepIdMap = new Map<string, string>(); // `${sourceKey} ${authoredId}` -> final id
  const steps: FlatStep[] = order.map(({ instance, step }, index) => {
    const id = claimId(step.id, instance.sourceKey, takenStepIds);
    stepIdMap.set(`${instance.sourceKey} ${step.id}`, id);
    return {
      id,
      sourceKey: instance.sourceKey,
      number: index + 1,
      durationMin: step.durationMin,
      type: step.type,
      phase: step.phase,
      prose: instance.source.prose.get(step.id) ?? '',
      fromComponent: instance.component
        ? { slug: instance.component.slug, title: instance.component.title }
        : undefined,
    };
  });

  /* --- 2. Ingredients: merge by ingredient *and* form ------------------- */

  // The grouping and summing is `mergeByForm`, shared with the shopping list.
  // Everything below it is transclusion's own work: claiming ids, synthesising
  // portions, and keeping every authored ref pointing somewhere real.
  const instanceByKey = new Map<SourceKey, Instance>(instances.map((i) => [i.sourceKey, i]));
  const scaleOf = (sourceKey: SourceKey) => instanceByKey.get(sourceKey)!.multiplier;

  const groups = mergeByForm(
    instances.flatMap((instance) =>
      instance.source.ingredients.map((line) => ({
        sourceKey: instance.sourceKey,
        line,
        // The component's own multiplier lands here, before the merge. The
        // reader's serving scale multiplies the merged result later.
        amount: line.amount * instance.multiplier,
      })),
    ),
  );

  const takenLineIds = new Set<string>();
  const refMap = new Map<string, string>(); // `${sourceKey} ${authoredRef}` -> final id
  const merged: MergedLine[] = [];

  for (const group of groups) {
    // Substitution data and the consumed fraction come from whichever source
    // put the most in; a token amount should not dictate how the line reads.
    const { contributions, largest } = group;
    const first = contributions[0]!;

    const id = claimId(largest.line.id, largest.sourceKey, takenLineIds);

    // Normally the biggest contributor sets the line's terms. Where sources
    // disagree outright, the recipe overrules the component it borrowed from,
    // and the disagreement is surfaced rather than silently resolved.
    const fractions = new Set(contributions.map((c) => c.line.consumedFraction));
    let authority = largest;
    if (fractions.size > 1) {
      authority = contributions.find((c) => c.sourceKey === 'self') ?? largest;
      warnings.push(
        `"${id}" is contributed by sources declaring different consumedFraction values ` +
          `(${[...fractions].join(', ')}); using ${authority.line.consumedFraction} from "${authority.sourceKey}"`,
      );
    }

    const needsPortions = contributions.length > 1 || contributions.some((c) => c.line.portions);
    let portions: MergedPortion[] | undefined;

    if (needsPortions) {
      portions = [];
      for (const c of contributions) {
        const scale = scaleOf(c.sourceKey);
        if (c.line.portions) {
          for (const p of c.line.portions) {
            const portionId = claimId(p.id, c.sourceKey, takenLineIds);
            refMap.set(`${c.sourceKey} ${p.id}`, portionId);
            portions.push({
              id: portionId,
              amount: p.amount * scale,
              note: p.note,
              sourceKey: c.sourceKey,
            });
          }
          // The parent line id still resolves, for anything referencing the whole.
          refMap.set(`${c.sourceKey} ${c.line.id}`, id);
        } else {
          const portionId = claimId(c.line.id, c.sourceKey, takenLineIds);
          refMap.set(`${c.sourceKey} ${c.line.id}`, portionId);
          portions.push({ id: portionId, amount: c.amount, sourceKey: c.sourceKey });
        }
      }
    } else {
      refMap.set(`${first.sourceKey} ${first.line.id}`, id);
    }

    merged.push({
      id,
      ingredientRef: group.ingredientRef,
      form: group.form,
      unit: group.unit,
      amount: group.total,
      note: largest.line.note,
      optional: contributions.every((c) => c.line.optional),
      consumedFraction: authority.line.consumedFraction,
      consumedFractionNote: authority.line.consumedFractionNote,
      notReferencedInSteps: contributions.every((c) => c.line.notReferencedInSteps)
        ? largest.line.notReferencedInSteps
        : undefined,
      ...(portions ? { portions } : {}),
      contributions: contributions.map((c) => ({
        sourceKey: c.sourceKey,
        amount: c.amount,
      })),
    });
  }

  /* --- 3. Rewrite refs, and resolve cross-source <Dur> targets ---------- */

  // A parent step may time a step that arrived through a component. That only
  // has one answer when the component was used once.
  const stepIdsByAuthoredId = new Map<string, string[]>();
  for (const [key, finalId] of stepIdMap) {
    const authored = key.slice(key.indexOf(' ') + 1);
    stepIdsByAuthoredId.set(authored, [...(stepIdsByAuthoredId.get(authored) ?? []), finalId]);
  }

  for (const step of steps) {
    step.prose = step.prose
      .replace(QTY_REF, (whole, before: string, ref: string, after: string) => {
        const mapped = refMap.get(`${step.sourceKey} ${ref}`);
        if (mapped) return `${before}${mapped}${after}`;
        warnings.push(`step "${step.id}": <Qty ref="${ref}"/> did not survive the merge`);
        return whole;
      })
      .replace(DUR_REF, (whole, before: string, ref: string, after: string) => {
        const own = stepIdMap.get(`${step.sourceKey} ${ref}`);
        if (own) return `${before}${own}${after}`;
        const candidates = stepIdsByAuthoredId.get(ref) ?? [];
        if (candidates.length === 1) return `${before}${candidates[0]}${after}`;
        if (candidates.length > 1) {
          warnings.push(
            `step "${step.id}": <Dur step="${ref}"/> is ambiguous — that step id arrives from more than one source`,
          );
        }
        return whole;
      });

    const target = step.type.startsWith('parallel-with:')
      ? step.type.slice('parallel-with:'.length)
      : null;
    if (target) {
      const mapped =
        stepIdMap.get(`${step.sourceKey} ${target}`) ??
        (stepIdsByAuthoredId.get(target)?.length === 1
          ? stepIdsByAuthoredId.get(target)![0]
          : undefined);
      if (mapped) step.type = `parallel-with:${mapped}`;
    }
  }

  /* --- 4. Order the checklist the way a cook reaches for things --------- */

  const firstUse = new Map<string, number>();
  for (const step of steps) {
    for (const match of step.prose.matchAll(QTY_REF)) {
      const ref = match[2]!;
      const line = merged.find((l) => l.id === ref || l.portions?.some((p) => p.id === ref));
      if (line && !firstUse.has(line.id)) firstUse.set(line.id, firstUse.size);
    }
  }
  const unusedRank = merged.length + firstUse.size;
  merged.sort((a, b) => (firstUse.get(a.id) ?? unusedRank) - (firstUse.get(b.id) ?? unusedRank));

  /* --- 5. Remap the parent's substitution targets ----------------------- */

  const substitutionTargets = new Map<string, string>();
  const ownerOf = (mapped: string) =>
    merged.find((l) => l.id === mapped || l.portions?.some((p) => p.id === mapped));

  /*
   * A recipe may substitute a line it did not author.
   *
   * Once flattened, a Component's ingredients are ordinary ingredients of this
   * dish — the reader has no idea which file they came from — so refusing to
   * let the dish speak about them is an authoring artefact leaking into the
   * page. The most-wanted swap in Japanese cooking is a vegetarian dashi, and
   * the katsuobushi it replaces arrives through a Component.
   *
   * The recipe's own lines are mapped last so they win outright: an id the dish
   * itself authored means that line, whatever a borrowed Component calls its
   * own. Where two Components use the same id and the recipe does not, the
   * reference is genuinely ambiguous and is left unmapped rather than guessed —
   * the check that validates `lineRef` then reports it.
   */
  const fromComponents = new Map<string, string[]>();
  for (const instance of instances) {
    if (instance.sourceKey === 'self') continue;
    for (const line of instance.source.ingredients) {
      const mapped = refMap.get(`${instance.sourceKey} ${line.id}`);
      const owner = mapped ? ownerOf(mapped) : undefined;
      if (owner) fromComponents.set(line.id, [...(fromComponents.get(line.id) ?? []), owner.id]);
    }
  }
  for (const [authoredId, owners] of fromComponents) {
    const unique = new Set(owners);
    if (unique.size === 1) substitutionTargets.set(authoredId, owners[0]!);
  }

  for (const line of parent.ingredients) {
    const mapped = refMap.get(`self ${line.id}`);
    const owner = mapped ? ownerOf(mapped) : undefined;
    if (owner) substitutionTargets.set(line.id, owner.id);
  }

  return {
    ingredients: merged,
    steps,
    substitutionTargets,
    components: instances
      .filter((i) => i.component)
      .map((i) => ({
        sourceKey: i.sourceKey,
        slug: i.component!.slug,
        title: i.component!.title,
        multiplier: i.component!.multiplier,
      })),
    warnings,
  };
}
