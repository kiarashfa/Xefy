import type { Component } from '../../schemas/component.ts';
import type { Ingredient, IngredientForm } from '../../schemas/ingredient.ts';
import type { Recipe, RecipeVersion } from '../../schemas/recipe.ts';
import type { Allergen, AnimalOrigin, Difficulty } from '../../schemas/vocabularies.ts';

import { computeDiet, type DietResult } from '../math/diet.ts';
import { computeNutrition, type NutritionResult } from '../math/nutrition.ts';
import { toGrams, type Density } from '../math/quantity.ts';
import { computeTiming, criticalPathTotal, type TimedStep, type TimingTotals } from '../math/timing.ts';
import { flatten, type ComponentSource, type FlattenResult, type MergedLine } from '../transclusion/flatten.ts';

/**
 * Turns authored content into everything a page needs, in one place.
 *
 * Flatten first, then compute. Diet labels, allergens and nutrition all read
 * the *merged* ingredient list, because a component contributes real
 * ingredients — a béchamel folded into a dish makes it no less dairy for
 * having arrived indirectly.
 */

export interface RecipeInput {
  slug: string;
  versionId: string;
  data: Recipe | RecipeVersion;
  /** Step id to authored prose, from the MDX body. */
  prose: Map<string, string>;
}

export interface ComponentInput {
  slug: string;
  data: Component;
  prose: Map<string, string>;
}

export interface ResolvedLine {
  line: MergedLine;
  ingredient: Ingredient;
  form: IngredientForm;
  /** The Form's override where it has one, otherwise the ingredient's own. */
  animalOrigin: AnimalOrigin;
  animalOriginNote?: string | undefined;
  containsGluten: boolean;
  containsDairy: boolean;
  allergenTags: readonly Allergen[];
  density?: Density | undefined;
  /** Null when a millilitre amount has no density to convert it. */
  grams: number | null;
}

export interface ResolvedRecipe {
  slug: string;
  versionId: string;
  label: string;
  defaultServings: number;
  difficulty: Difficulty;
  /** Version-scoped editorial data the page renders alongside the computed parts. */
  makeAhead: RecipeVersion['makeAhead'];
  notes: RecipeVersion['notes'];
  substitutions: RecipeVersion['substitutions'];
  flat: FlattenResult;
  lines: ResolvedLine[];
  timing: TimingTotals;
  criticalPathMin: number;
  nutrition: NutritionResult;
  diet: DietResult;
  /** Problems that make a figure wrong rather than merely suspicious. */
  errors: string[];
  warnings: string[];
}

const densityOf = (form: IngredientForm): Density | undefined =>
  form.density
    ? {
        gPerMl: form.density.gPerMl,
        gPerCup: form.density.gPerCup,
        gPerTbsp: form.density.gPerTbsp,
        gPerTsp: form.density.gPerTsp,
        source: form.density.densitySource,
      }
    : undefined;

/**
 * Joins merged ingredient lines to their records. Shared by a recipe and by a
 * Component's own page: the two differ in what surrounds the ingredients —
 * servings, diet, make-ahead — and not at all in how a line resolves.
 */
function resolveLines(
  flat: FlattenResult,
  ingredients: Map<string, Ingredient>,
  errors: string[],
): ResolvedLine[] {
  const lines: ResolvedLine[] = [];
  for (const line of flat.ingredients) {
    const ingredient = ingredients.get(line.ingredientRef);
    if (!ingredient) {
      errors.push(`"${line.id}": no ingredient record for "${line.ingredientRef}"`);
      continue;
    }
    const form = ingredient.forms.find((f) => f.id === line.form);
    if (!form) {
      errors.push(`"${line.id}": "${line.ingredientRef}" has no form "${line.form}"`);
      continue;
    }

    const density = densityOf(form);
    const grams = toGrams(line.amount, line.unit, density);
    if (grams == null) {
      errors.push(
        `"${line.id}" is authored in ml and "${line.ingredientRef}.${form.id}" carries no density, ` +
          `so its weight — and therefore its nutrition — cannot be computed`,
      );
    }

    lines.push({
      line,
      ingredient,
      form,
      // A Form overrides its ingredient where the answer varies by product
      // rather than by food: animal rennet in a cheese, isinglass in a wine.
      animalOrigin: form.animalOrigin ?? ingredient.animalOrigin,
      animalOriginNote: form.animalOriginNote ?? ingredient.animalOriginNote,
      containsGluten: form.containsGluten ?? ingredient.containsGluten,
      containsDairy: form.containsDairy ?? ingredient.containsDairy,
      allergenTags: form.allergenTags ?? ingredient.allergenTags,
      density,
      grams,
    });
  }
  return lines;
}

/**
 * A Component on its own page — §4.2's "independently notable" case.
 *
 * Deliberately narrower than a resolved recipe. A Component is a batch, not a
 * meal: it has no serving count, so it has no per-serving nutrition and no
 * stepper, and inventing either would put a figure on the page that means
 * nothing. What it does have is a real ingredient list, real steps and real
 * timing, which is what the page shows.
 */
export interface ResolvedComponent {
  slug: string;
  flat: FlattenResult;
  lines: ResolvedLine[];
  timing: TimingTotals;
  criticalPathMin: number;
  errors: string[];
  warnings: string[];
}

export function resolveComponent(
  component: ComponentInput,
  componentInputs: Map<string, ComponentInput>,
  ingredients: Map<string, Ingredient>,
): ResolvedComponent {
  const errors: string[] = [];
  const flat = flatten(
    {
      ingredients: component.data.ingredients,
      steps: component.data.steps,
      prose: component.prose,
    },
    componentSources(componentInputs),
  );
  const lines = resolveLines(flat, ingredients, errors);
  const steps = timedSteps(flat);

  return {
    slug: component.slug,
    flat,
    lines,
    timing: computeTiming(steps),
    criticalPathMin: criticalPathTotal(steps),
    errors,
    warnings: flat.warnings,
  };
}

const componentSources = (inputs: Map<string, ComponentInput>) =>
  new Map<string, ComponentSource>(
    [...inputs].map(([slug, input]) => [
      slug,
      {
        slug,
        title: input.data.title,
        ingredients: input.data.ingredients,
        steps: input.data.steps,
        prose: input.prose,
      },
    ]),
  );

export const timedSteps = (flat: FlattenResult): TimedStep[] =>
  flat.steps.map((s) => ({
    id: s.id,
    durationMin: s.durationMin,
    type: s.type,
    phase: s.phase,
  }));

export function resolveRecipe(
  recipe: RecipeInput,
  componentInputs: Map<string, ComponentInput>,
  ingredients: Map<string, Ingredient>,
): ResolvedRecipe {
  const errors: string[] = [];

  const flat = flatten(
    {
      ingredients: recipe.data.ingredients,
      steps: recipe.data.steps,
      prose: recipe.prose,
    },
    componentSources(componentInputs),
  );

  const lines = resolveLines(flat, ingredients, errors);

  const steps = timedSteps(flat);
  const timing = computeTiming(steps);

  const nutrition = computeNutrition(
    lines.map((l) => ({
      label: l.ingredient.name,
      grams: l.grams,
      consumedFraction: l.line.consumedFraction,
      consumedFractionNote: l.line.consumedFractionNote,
      nutritionCaveat: l.form.nutritionCaveat,
      nutritionPer100g: l.form.nutritionPer100g,
    })),
    recipe.data.defaultServings,
  );

  const diet = computeDiet(
    lines.map((l) => ({
      label: l.ingredient.name,
      animalOrigin: l.animalOrigin,
      animalOriginNote: l.animalOriginNote,
      containsGluten: l.containsGluten,
      containsDairy: l.containsDairy,
      allergenTags: l.allergenTags,
    })),
  );

  return {
    slug: recipe.slug,
    versionId: recipe.versionId,
    label: recipe.data.label,
    defaultServings: recipe.data.defaultServings,
    difficulty: recipe.data.difficulty,
    makeAhead: recipe.data.makeAhead,
    notes: recipe.data.notes,
    substitutions: recipe.data.substitutions,
    flat,
    lines,
    timing,
    criticalPathMin: criticalPathTotal(steps),
    nutrition,
    diet,
    errors,
    warnings: flat.warnings,
  };
}
