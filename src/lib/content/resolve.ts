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

  const components = new Map<string, ComponentSource>(
    [...componentInputs].map(([slug, input]) => [
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

  const flat = flatten(
    {
      ingredients: recipe.data.ingredients,
      steps: recipe.data.steps,
      prose: recipe.prose,
    },
    components,
  );

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

  const steps = timedSteps(flat);
  const timing = computeTiming(steps);

  const nutrition = computeNutrition(
    lines.map((l) => ({
      label: l.ingredient.name,
      grams: l.grams,
      consumedFraction: l.line.consumedFraction,
      consumedFractionNote: l.line.consumedFractionNote,
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
