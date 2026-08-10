import type { NutritionPer100g } from '../../schemas/primitives.ts';

export type Nutrient = keyof NutritionPer100g;
export type NutritionTotals = Partial<Record<Nutrient, number>>;

/** Always present on every Form, so a total for these is never partial. */
const REQUIRED_NUTRIENTS: readonly Nutrient[] = ['kcal', 'protein', 'carbs', 'fat'];

export interface NutritionContribution {
  /** For messages, not display. */
  label: string;
  /** Null when the line is authored in millilitres and its Form has no density. */
  grams: number | null;
  /** The eaten share. 1 unless the ingredient is largely thrown away. */
  consumedFraction: number;
  consumedFractionNote?: string | undefined;
  nutritionPer100g: NutritionPer100g;
}

export interface NutritionResult {
  /** The whole recipe as prepared, at its authored serving count. */
  total: NutritionTotals;
  /** Invariant under the serving stepper — see the note below. */
  perServing: NutritionTotals;
  /** Nutrients some contributing ingredient had no figure for. */
  partial: Nutrient[];
  /** True when any figure rests on an estimate. */
  estimated: boolean;
  estimateReasons: string[];
  /** Lines whose gram weight could not be established, so were left out. */
  missingWeight: string[];
}

/**
 * Sums what goes into the dish.
 *
 * This is a total-raw-input calculation, not a per-100g-of-finished-dish one.
 * Cooked yield and nutrient retention are deliberately not modelled: the data
 * to do it well does not exist, and input totals already answer the question
 * people actually have — how much am I about to eat. Water lost in cooking
 * concentrates figures without changing them.
 *
 * Per-serving figures do **not** move when the serving stepper does. Scaling
 * multiplies the ingredients and the divisor equally, so the answer to "what is
 * in one portion" is the same at two servings and at seven. The total scales;
 * the per-serving figure is a property of the recipe.
 */
export function computeNutrition(
  contributions: NutritionContribution[],
  servings: number,
): NutritionResult {
  const total: NutritionTotals = {};
  const partial = new Set<Nutrient>();
  const estimateReasons: string[] = [];
  const missingWeight: string[] = [];

  const contributing = contributions.filter((c) => {
    if (c.grams == null) {
      missingWeight.push(c.label);
      return false;
    }
    return true;
  });

  const seen = new Set<Nutrient>();
  for (const c of contributing) {
    for (const key of Object.keys(c.nutritionPer100g) as Nutrient[]) {
      if (c.nutritionPer100g[key] != null) seen.add(key);
    }
  }

  for (const c of contributing) {
    const factor = (c.grams! / 100) * c.consumedFraction;
    for (const key of seen) {
      const per100 = c.nutritionPer100g[key];
      if (per100 == null) {
        // Something else in the dish carries this nutrient and this ingredient
        // has no figure for it, so the total is a floor rather than a sum.
        if (c.grams! > 0) partial.add(key);
        continue;
      }
      total[key] = (total[key] ?? 0) + per100 * factor;
    }
    if (c.consumedFraction < 1 && c.consumedFractionNote) {
      estimateReasons.push(c.consumedFractionNote);
    }
  }

  for (const key of REQUIRED_NUTRIENTS) partial.delete(key);

  const perServing: NutritionTotals = {};
  for (const [key, value] of Object.entries(total) as [Nutrient, number][]) {
    perServing[key] = value / servings;
  }

  return {
    total,
    perServing,
    partial: [...partial],
    estimated: estimateReasons.length > 0,
    estimateReasons,
    missingWeight,
  };
}

/** Nutrition figures are rounded for display only, never in the arithmetic. */
export function formatNutrient(value: number, nutrient: Nutrient): string {
  if (nutrient === 'kcal') return String(Math.round(value));
  if (value >= 100) return String(Math.round(value));
  if (value >= 10) return value.toFixed(1).replace(/\.0$/, '');
  return value.toFixed(1).replace(/\.0$/, '');
}
