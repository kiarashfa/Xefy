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

  /**
   * Overrides the ingredient's prose name entirely, for forms an adjective
   * cannot reach. A qualifier is a prefix, which serves "fresh basil" and
   * fails "egg yolk" — the yolk is not a kind of adjective applied to an egg.
   */
  proseName: z.string().min(1).optional(),

  /**
   * For things a cook counts rather than weighs: eggs, garlic cloves, chillies.
   *
   * Weight stays the source of truth and the stored figure — a count is a
   * derived display exactly as a cup measurement is, and it scales with the
   * serving stepper because the grams behind it do. But "60 g egg yolk" is not
   * a usable instruction in a kitchen, so where a Form declares this, the
   * count leads and the weight follows in the same breath: "3 ½ egg yolks
   * (60 g)".
   *
   * Both are shown because the count is necessarily approximate — eggs vary —
   * and the exact figure sitting beside it is what keeps the display honest.
   * The dotted-underline estimate marker is deliberately not used here: it is
   * reserved for a figure whose true value is *not* on the page (§5.3), and
   * here it is.
   */
  countUnit: z
    .object({
      /** The full noun phrase, so it reads alone: "egg yolk", "garlic clove". */
      singular: z.string().min(1),
      plural: z.string().min(1),
      /** Average weight of one, which is what makes the count approximate. */
      grams: z.number().positive(),
    })
    .optional(),
  nutritionPer100g,

  /**
   * Set when the cited record is known to be wrong for this food in a stated
   * direction, and no better record exists.
   *
   * `sourceNote` explains where a figure came from; this says the figure is not
   * right. The distinction matters for dried foods above all: reference
   * datasets carry raw kelp and cooked shrimp but not dried kombu or dried
   * shrimp, and the same food at a tenth of the water content is several times
   * as concentrated. Citing the wet record is the most honest option available
   * and still produces a number that is too low.
   *
   * Declaring it here marks the whole dish's nutrition as an estimate with this
   * reason attached, so the figure is never presented as computed fact. It is a
   * confession, not a correction — the arithmetic is not adjusted, because a
   * scaling factor nobody can source would be exactly the invented number this
   * project exists to avoid.
   */
  nutritionCaveat: z.string().min(1).optional(),

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

    /**
     * Assumed on hand rather than shopped for. §8.1
     *
     * This is the single source of the staples list — the record is where every
     * other property of the food already lives, and a central list would have to
     * be edited by every author of every new ingredient, which is exactly the
     * cross-file edit a catalogue authored by many hands over time gets wrong.
     *
     * The test is *both* parts of the following, not either:
     *
     * 1. A kitchen keeps it rather than shopping for it — it lives in the
     *    cupboard, keeps for months, and is bought without reference to any
     *    particular dish. Salt, pepper, oil, sugar, bicarbonate, dried yeast,
     *    common dried spices.
     * 2. Recipes use it in small supporting amounts. If a dish is *built* out of
     *    it, it is a purchase however common it is: flour for a pizza, tinned
     *    tomatoes for a shakshuka, rice for a pilaf.
     *
     * Fresh and perishable fails the first test almost always — an onion is in
     * most kitchens most weeks and is still shopped for. Note that reverse
     * search drops staples from matching entirely (§8.2), so an over-generous
     * list quietly inflates every match percentage on the site; the cost of a
     * wrong `true` is higher than the cost of a wrong `false`.
     */
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
