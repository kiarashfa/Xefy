import { z } from 'astro/zod';
import {
  allergen,
  animalOrigin,
  density,
  names,
  nutritionPer100g,
  slug,
  sourceCitation,
} from './primitives.ts';

/**
 * A Form is the unit that carries data: fresh and dried basil have different
 * nutrition and different density, so they cannot share a record — but they
 * are the same ingredient and share one page.
 */
export const ingredientForm = sourceCitation.extend({
  id: slug,
  label: z.string().min(1),
  /**
   * The one word that names this form inside a sentence — "fresh", "dried",
   * "smoked". Set it only where the distinction is one a cook acts on: "fresh
   * basil" earns its adjective, and a cheese's rennet does not belong in the
   * middle of a step. Where it is absent the ingredient name stands alone.
   */
  proseQualifier: z.string().min(1).optional(),
  nutritionPer100g,
  density: density.optional(),

  /**
   * Hidden animal inputs vary by product, not by food — animal rennet in a
   * cheese, isinglass in a wine. Where that is the case the Form overrides the
   * ingredient's origin and must say why, because the note travels with every
   * computed diet label that depends on it.
   */
  animalOrigin: animalOrigin.optional(),
  animalOriginNote: z.string().min(1).optional(),
  containsGluten: z.boolean().optional(),
  containsDairy: z.boolean().optional(),
  allergenTags: z.array(allergen).optional(),

  /** Equivalence to another Form of the same ingredient, e.g. dried to fresh. */
  convertsFrom: z
    .object({
      form: slug,
      ratio: z.number().positive(),
      note: z.string().min(1).optional(),
    })
    .optional(),

  image: z.string().min(1).optional(),
});

export const ingredientSchema = z
  .object({
    id: slug,
    name: z.string().min(1),
    /**
     * The name as it reads inside a sentence. Defaults to the lowercased name,
     * which is right for "flour" and wrong for "Parmigiano-Reggiano" — so a
     * proper noun sets this rather than being lowercased mid-method.
     */
    proseName: z.string().min(1).optional(),
    names,

    /** Feeds reverse search grouping and ingredient-page browsing. */
    category: z.string().min(1),

    animalOrigin,
    animalOriginNote: z.string().min(1).optional(),
    containsGluten: z.boolean(),
    containsDairy: z.boolean(),
    allergenTags: z.array(allergen).default([]),

    /** Light, browsing-level suggestions. Dish-specific advice lives on the recipe. */
    generalSubstitutes: z
      .array(
        z.object({
          substitute: z.string().min(1),
          note: z.string().min(1).optional(),
        }),
      )
      .default([]),

    forms: z.array(ingredientForm).min(1),

    /** Set where the ingredient is assumed on hand rather than shopped for. */
    pantryStaple: z.boolean().default(false),

    image: z.string().min(1).optional(),
  })
  .superRefine((ing, ctx) => {
    const seen = new Set<string>();
    for (const [i, form] of ing.forms.entries()) {
      if (seen.has(form.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['forms', i, 'id'],
          message: `duplicate form id "${form.id}"`,
        });
      }
      seen.add(form.id);
    }
    for (const [i, form] of ing.forms.entries()) {
      if (form.convertsFrom && !seen.has(form.convertsFrom.form)) {
        ctx.addIssue({
          code: 'custom',
          path: ['forms', i, 'convertsFrom', 'form'],
          message: `convertsFrom points at "${form.convertsFrom.form}", which is not a form of this ingredient`,
        });
      }
      if (form.animalOrigin != null && form.animalOrigin !== 'none' && !form.animalOriginNote) {
        ctx.addIssue({
          code: 'custom',
          path: ['forms', i, 'animalOriginNote'],
          message:
            'a form that overrides animalOrigin must explain the condition, since the note is shown wherever the computed diet label appears',
        });
      }
    }
  });

export type Ingredient = z.infer<typeof ingredientSchema>;
export type IngredientForm = z.infer<typeof ingredientForm>;

/** Optional narrative enrichment: history, buying, storage. Never required. */
export const ingredientEnrichmentSchema = z.object({
  ingredientRef: slug,
  title: z.string().min(1).optional(),
});
