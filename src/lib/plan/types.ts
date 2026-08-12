import type { NutritionTotals } from '../math/nutrition.ts';

/**
 * The shapes the Plan works in.
 *
 * `CatalogRecord` and `RecipeDetail` are the two build-time exports (§8.1)
 * described from the reading end. Declaring them here rather than in the routes
 * that emit them is what makes the exporter and its only consumer typecheck
 * against one definition — the JSON is a wire format between two halves of the
 * same codebase, and it should be as hard to drift as any other interface.
 */

export type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** Relative weekday slots, not dates. No calendar, no rollover. §8.5 */
export const DAYS: readonly Day[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const DAY_LABELS: Record<Day, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

export const isDay = (value: unknown): value is Day => DAYS.includes(value as Day);

/**
 * One intention to cook something. References and one scalar — never a
 * snapshot of a computed value, so a month-old plan silently benefits from
 * every correction made since. §8.3
 */
export interface PlanItem {
  /** Random. The same recipe may appear twice and the two stay independent. */
  uid: string;
  /** Recipe slug. */
  recipe: string;
  /** RecipeVersion id. §4.4 */
  version: string;
  /** Absolute, so a change to `defaultServings` cannot rewrite a saved plan. */
  servings: number;
  day: Day | null;
}

export interface Plan {
  items: PlanItem[];
  /** Ingredient ids ticked as already owned. */
  have: string[];
  /**
   * Pantry staples the reader has moved into "To buy". §8.3 sketches this as a
   * single `includeStaples` boolean; a boolean cannot express "I need oil but I
   * still have salt", which is exactly what §8.4 asks the staples group to
   * allow, so it is a list of the ones asked for.
   */
  needStaples: string[];
}

export const EMPTY_PLAN: Plan = { items: [], have: [], needStaples: [] };

/* ------------------------------------------------------------------ *
 * The build-time exports — §8.1
 * ------------------------------------------------------------------ */

export interface CatalogVersion {
  id: string;
  label: string;
  defaultServings: number;
}

/** `catalog-index.json` — one light record per recipe. */
export interface CatalogRecord {
  slug: string;
  title: string;
  subtitle: string;
  style: string;
  tags: { cuisine: string[]; course: string[]; method: string[] };
  totalMin: number;
  kcalPerServing: number;
  difficulty: string;
  diets: string[];
  allergens: string[];
  ingredients: string[];
  image: string | null;
  versions: CatalogVersion[];
  nutritionEstimated: boolean;
}

/** One ingredient line of one version, as the Plan needs to see it. */
export interface DetailLine {
  ingredientRef: string;
  /** Display name, as it heads the ingredient's own page. */
  name: string;
  form: string;
  formLabel: string;
  /** True where the ingredient has more than one Form, so the Form names itself. */
  multiForm: boolean;
  amount: number;
  unit: 'g' | 'ml';
  optional: boolean;
  /** Present where the Form carries a density, so US volumes can be rendered. */
  gPerMl?: number;
  /** §5.3 — travels with the figure so the dotted underline follows it. */
  densityEstimated?: boolean;
  countUnit?: { singular: string; plural: string; grams: number };
  /**
   * Where this Form is not the thing a shopper buys, the Form that is — already
   * resolved, because the target may not appear anywhere else in the plan. A
   * recipe made only of yolks still sends someone to buy eggs.
   */
  purchaseAs?:
    | {
        form: string;
        formLabel: string;
        /** Grams of the target Form per gram of this one. */
        ratio: number;
        gPerMl?: number;
        densityEstimated?: boolean;
        countUnit?: { singular: string; plural: string; grams: number };
      }
    | undefined;
  /**
   * Set on a line only after a list has folded another Form into it: the Form
   * labels the reader asked for, so the list can say why it names something
   * else. Never present in the build-time export.
   */
  boughtFor?: string[] | undefined;
}

export interface DetailVersion {
  id: string;
  label: string;
  defaultServings: number;
  totalMin: number;
  perServing: NutritionTotals;
  /** §3.4.1 / §5.3 — why the figures are an estimate, if they are. */
  nutritionEstimated: boolean;
  nutritionEstimateReasons: string[];
  /** True where any line's amount rests on an estimated density. §5.3 */
  densityEstimated: boolean;
  makeAhead: {
    aheadInstructions: string | null;
    freezable: boolean | null;
    freezeInstructions: string | null;
    reheatInstructions: string | null;
  };
  ingredients: DetailLine[];
}

/** `recipe-detail/{slug}.json` — fetched on demand, one file per planned dish. */
export interface RecipeDetail {
  slug: string;
  title: string;
  versions: DetailVersion[];
}
