import { formatQuantity, type Density } from '../math/quantity.ts';
import { formatCount, type UnitSystem } from '../math/units.ts';
import type { Nutrient, NutritionTotals } from '../math/nutrition.ts';
import { mergeByForm } from '../transclusion/merge.ts';
import type { ResolvedPlanItem } from './resolve.ts';
import type { DetailLine, DetailVersion, Plan, RecipeDetail } from './types.ts';

/**
 * Turning a plan into a shopping list, and into a week's nutrition. §8.4, §8.5
 *
 * Everything here is a pure function of the plan plus the build-time exports.
 * The grouping rule is not reimplemented: `mergeByForm` is the same code the
 * transclusion merge uses, because grouping one recipe's flour with another's
 * is the same operation as grouping a Component's flour with its parent's.
 */

export interface ListSource {
  uid: string;
  slug: string;
  title: string;
  servings: number;
  /** This dish's share of the line, so 450 g of flour can be explained. */
  amount: number;
}

export interface ListLine {
  /** Stable across re-renders: one ingredient in one Form is one purchase. */
  key: string;
  ingredientRef: string;
  name: string;
  form: string;
  formLabel: string;
  multiForm: boolean;
  unit: 'g' | 'ml';
  total: number;
  /** Only where every recipe asking for it says so. */
  optional: boolean;
  pantryStaple: boolean;
  density?: Density | undefined;
  countUnit?: DetailLine['countUnit'];
  /** Forms folded into this purchase — "bought for the yolks". §8.4 */
  boughtFor: string[];
  sources: ListSource[];
}

const versionOf = (detail: RecipeDetail | undefined, id: string): DetailVersion | undefined =>
  detail?.versions.find((v) => v.id === id);

const densityOf = (line: DetailLine): Density | undefined =>
  line.gPerMl == null
    ? undefined
    : { gPerMl: line.gPerMl, source: line.densityEstimated ? 'estimated' : 'measured' };

/**
 * Rewrites a line into the Form a shopper actually buys — §8.4 rule 1 says one
 * ingredient in one Form is one line, and this decides which Form that is.
 *
 * A recipe wanting yolks and whole eggs needs both in the kitchen and neither
 * in the shop, where there are only eggs. Converting here, on the way into the
 * grouping, means the two arrive as one line and the existing merge does the
 * rest without knowing anything about it.
 *
 * The conversion never touches nutrition, which reads the recipe's own lines:
 * the dish contains yolk, whatever the shopping list had to say to be useful.
 */
function asPurchased(line: DetailLine): DetailLine {
  const buy = line.purchaseAs;
  if (!buy || line.unit !== 'g') return line;
  return {
    ...line,
    form: buy.form,
    formLabel: buy.formLabel,
    // The reader is told which of their lines was folded in, or a checklist
    // saying "eggs" against a recipe saying "egg yolks" looks like a bug. The
    // count's own noun is the one to use where there is one: "the egg yolks"
    // is what the recipe called them, and "Yolk, raw" is a table heading.
    boughtFor: [...(line.boughtFor ?? []), line.countUnit?.plural ?? line.formLabel.toLowerCase()],
    ...(buy.gPerMl != null
      ? { gPerMl: buy.gPerMl, densityEstimated: buy.densityEstimated }
      : { gPerMl: undefined, densityEstimated: undefined }),
    countUnit: buy.countUnit,
    purchaseAs: undefined,
  };
}

/**
 * The aggregation itself. §8.4
 *
 * Each planned item is scaled by `servings / defaultServings` before it is
 * summed, exactly as the recipe page scales it — and the sum happens in base
 * units, which is the direct payoff of authoring in grams: because nothing is
 * written in cups, a cross-recipe total cannot accumulate conversion error.
 *
 * Amounts are never rounded to a package size. Xefy has no product data, and
 * "one bag of flour" would be a fabricated number in a system built to avoid
 * them.
 */
export function aggregateList(
  items: readonly ResolvedPlanItem[],
  details: ReadonlyMap<string, RecipeDetail>,
  staples: readonly string[],
): ListLine[] {
  const stapleSet = new Set(staples);

  const contributions = items.flatMap((entry) => {
    const version = versionOf(details.get(entry.item.recipe), entry.item.version);
    if (!version) return [];
    const scale = entry.item.servings / version.defaultServings;
    return version.ingredients.map((line) => ({
      sourceKey: entry.item.uid,
      line: asPurchased(line),
      amount: line.amount * scale * (line.purchaseAs?.ratio ?? 1),
    }));
  });

  const byUid = new Map(items.map((i) => [i.item.uid, i]));

  return mergeByForm(contributions).map((group) => {
    const line = group.largest.line;
    return {
      key: `${group.ingredientRef} ${group.form}`,
      ingredientRef: group.ingredientRef,
      name: line.name,
      form: group.form,
      formLabel: line.formLabel,
      multiForm: line.multiForm,
      unit: group.unit,
      total: group.total,
      // Optional only where nothing in the plan actually requires it.
      optional: group.contributions.every((c) => c.line.optional),
      pantryStaple: stapleSet.has(group.ingredientRef),
      density: densityOf(line),
      countUnit: line.countUnit,
      boughtFor: [
        ...new Set(group.contributions.flatMap((c) => c.line.boughtFor ?? [])),
      ],
      // One planned dish is one source, however many of its lines ended up
      // here. Two lines of one recipe merging — a split use, or a Form folded
      // into its purchase — must not make the recipe appear twice.
      sources: [...group.contributions.reduce(
        (acc, c) => {
          const entry = byUid.get(c.sourceKey)!;
          const existing = acc.get(c.sourceKey);
          acc.set(c.sourceKey, {
            uid: c.sourceKey,
            slug: entry.recipe.slug,
            title: entry.recipe.title,
            servings: entry.item.servings,
            amount: (existing?.amount ?? 0) + c.amount,
          });
          return acc;
        },
        new Map<string, ListSource>(),
      ).values()],
    };
  });
}

export interface ListGroups {
  /** The list. Non-staples not yet ticked off, plus any staple asked for. */
  toBuy: ListLine[];
  /** Ticked off — moved down and struck through, still visible and reversible. */
  alreadyHave: ListLine[];
  /** Assumed on hand, collapsed, until one is moved into "To buy". */
  staples: ListLine[];
}

/**
 * Three groups, in the order §8.4 sets. The staples group is the one that earns
 * its complexity: a list that silently omits the oil you have actually run out
 * of is a wasted trip, so they are always visible and always reachable.
 */
export function groupList(lines: readonly ListLine[], plan: Plan): ListGroups {
  const have = new Set(plan.have);
  const needed = new Set(plan.needStaples);
  const groups: ListGroups = { toBuy: [], alreadyHave: [], staples: [] };

  for (const line of lines) {
    if (have.has(line.ingredientRef)) groups.alreadyHave.push(line);
    else if (line.pantryStaple && !needed.has(line.ingredientRef)) groups.staples.push(line);
    else groups.toBuy.push(line);
  }
  return groups;
}

/* ------------------------------------------------------------------ *
 * Display — one function, so the page and the shared text agree
 * ------------------------------------------------------------------ */

export interface DisplayAmount {
  /** "450 g", "1 ¾ cups". */
  text: string;
  /** A density estimate was involved, so it carries the tilde and the underline. */
  estimated: boolean;
  /** "4 eggs", where the Form is something a cook counts. §2.1.1 */
  count?: string;
}

export function displayAmount(line: ListLine, system: UnitSystem): DisplayAmount {
  const counted = line.countUnit != null && line.unit === 'g';
  const { text, estimated } = formatQuantity(line.total, line.unit, system, line.density, counted);
  if (!counted || !line.countUnit) return { text, estimated };

  const raw = formatCount(line.total / line.countUnit.grams);
  const label = raw === '1' ? line.countUnit.singular : line.countUnit.plural;
  return { text, estimated, count: `${raw} ${label}` };
}

/** "Fior di latte", or "Wheat Flour (Type 00)" where the Form is the purchase. */
export const displayName = (line: ListLine): string =>
  line.multiForm ? `${line.name} (${line.formLabel})` : line.name;

/* ------------------------------------------------------------------ *
 * Nutrition across a plan — §8.5
 * ------------------------------------------------------------------ */

const MACROS: readonly Nutrient[] = ['kcal', 'protein', 'carbs', 'fat'];

export interface PlanNutrition {
  /** The plan as prepared, summed. Never framed as consumption. §3.4 */
  totals: NutritionTotals;
  portions: number;
  /** The figure this feature exists to produce. §8.5 */
  perPortion: NutritionTotals;
  estimated: boolean;
  reasons: string[];
}

/**
 * Uncertainty adds when figures are summed, so one estimated input makes the
 * whole aggregate an estimate — an aggregate that looks more confident than its
 * inputs is the one place this feature could actively mislead. §8.5
 */
export function aggregateNutrition(
  items: readonly ResolvedPlanItem[],
  details: ReadonlyMap<string, RecipeDetail>,
): PlanNutrition {
  const totals: NutritionTotals = {};
  const reasons = new Set<string>();
  const estimatedDensities: string[] = [];
  let portions = 0;
  let estimated = false;

  for (const entry of items) {
    const version = versionOf(details.get(entry.item.recipe), entry.item.version);
    if (!version) continue;
    portions += entry.item.servings;

    for (const key of MACROS) {
      const perServing = version.perServing[key];
      if (perServing == null) continue;
      totals[key] = (totals[key] ?? 0) + perServing * entry.item.servings;
    }

    if (version.nutritionEstimated) {
      estimated = true;
      for (const reason of version.nutritionEstimateReasons) reasons.add(reason);
    }
    if (version.densityEstimated && !estimatedDensities.includes(entry.recipe.title)) {
      estimated = true;
      estimatedDensities.push(entry.recipe.title);
    }
  }

  // One sentence naming every dish it applies to, rather than the same sentence
  // once per dish — a reason repeated verbatim four times stops being read.
  if (estimatedDensities.length > 0) {
    const names = new Intl.ListFormat('en', { type: 'conjunction' }).format(estimatedDensities);
    reasons.add(
      `${names} ${estimatedDensities.length === 1 ? 'converts' : 'convert'} at least one amount using an estimated density.`,
    );
  }

  const perPortion: NutritionTotals = {};
  if (portions > 0) {
    for (const [key, value] of Object.entries(totals) as [Nutrient, number][]) {
      perPortion[key] = value / portions;
    }
  }

  return { totals, portions, perPortion, estimated, reasons: [...reasons] };
}
