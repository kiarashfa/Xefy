import { z } from 'astro/zod';
import { ALLERGENS, ANIMAL_ORIGINS, BASE_UNITS, DENSITY_SOURCES } from './vocabularies.ts';

/** Lowercase, hyphen-separated, no leading/trailing hyphen. */
export const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase hyphen-separated slug');

/**
 * Ids used as reference targets by `<Qty>` and `<Dur>`. Double underscore is
 * reserved as the namespace separator the transclusion merge introduces, so
 * authored ids may not contain it.
 */
export const refId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase hyphen-separated id')
  .refine((v) => !v.includes('__'), 'double underscore is reserved for merged portion ids');

export const allergen = z.enum(ALLERGENS);
export const animalOrigin = z.enum(ANIMAL_ORIGINS);
export const baseUnit = z.enum(BASE_UNITS);
export const densitySource = z.enum(DENSITY_SOURCES);

/**
 * Structured naming data, carried by both Recipe and Ingredient.
 *
 * The three buckets are not interchangeable, and the distinction is the point
 * of the block: a genuine regional synonym, a name that leads here but means
 * something else, and a way of typing a name that is not itself a name.
 */
export const alsoKnownAsEntry = z.object({
  name: z.string().min(1),
  /** Short free text, e.g. "Basque Country", "North America". */
  region: z.string().min(1).optional(),
  /** BCP-47; feeds structured data. */
  lang: z.string().min(2).optional(),
  /** One sentence, only where the name carries a nuance worth stating. */
  note: z.string().min(1).optional(),
  /** Ingredients only: when the name applies to one Form rather than the whole ingredient. */
  formRef: z.string().min(1).optional(),
});

export const notToBeConfusedWithEntry = z.object({
  name: z.string().min(1),
  /**
   * Required. An entry without a stated difference is useless as knowledge and
   * would assert the opposite of what this field means.
   */
  note: z.string().min(1),
  slugRef: slug.optional(),
});

export const names = z
  .object({
    alsoKnownAs: z.array(alsoKnownAsEntry).default([]),
    notToBeConfusedWith: z.array(notToBeConfusedWithEntry).default([]),
    /** Transliterations and diacritic-free spellings: indexed, never displayed. */
    searchOnly: z.array(z.string().min(1)).default([]),
  })
  .default({ alsoKnownAs: [], notToBeConfusedWith: [], searchOnly: [] });

export type Names = z.infer<typeof names>;

/**
 * Per-100g figures. Macros are required so nutrition can always be computed;
 * micronutrients are optional and only present where the source dataset
 * carries them.
 *
 * Units: kcal for energy, grams for macros, milligrams for minerals unless
 * suffixed `Mcg`, micrograms where suffixed.
 */
export const nutritionPer100g = z.object({
  kcal: z.number().min(0),
  protein: z.number().min(0),
  carbs: z.number().min(0),
  fat: z.number().min(0),

  fiber: z.number().min(0).optional(),
  sugars: z.number().min(0).optional(),
  saturatedFat: z.number().min(0).optional(),
  monounsaturatedFat: z.number().min(0).optional(),
  polyunsaturatedFat: z.number().min(0).optional(),
  transFat: z.number().min(0).optional(),
  cholesterol: z.number().min(0).optional(),

  sodium: z.number().min(0).optional(),
  potassium: z.number().min(0).optional(),
  calcium: z.number().min(0).optional(),
  iron: z.number().min(0).optional(),
  magnesium: z.number().min(0).optional(),
  phosphorus: z.number().min(0).optional(),
  zinc: z.number().min(0).optional(),
  copper: z.number().min(0).optional(),
  manganese: z.number().min(0).optional(),
  seleniumMcg: z.number().min(0).optional(),

  vitaminAMcg: z.number().min(0).optional(),
  vitaminC: z.number().min(0).optional(),
  vitaminDMcg: z.number().min(0).optional(),
  vitaminE: z.number().min(0).optional(),
  vitaminKMcg: z.number().min(0).optional(),
  thiamin: z.number().min(0).optional(),
  riboflavin: z.number().min(0).optional(),
  niacin: z.number().min(0).optional(),
  vitaminB6: z.number().min(0).optional(),
  folateMcg: z.number().min(0).optional(),
  vitaminB12Mcg: z.number().min(0).optional(),
  choline: z.number().min(0).optional(),
});

export type NutritionPer100g = z.infer<typeof nutritionPer100g>;

/**
 * Density backs volume display only. It never touches a stored amount, so an
 * estimate here can never corrupt a figure the site presents as authoritative
 * — but it must still be visibly labelled wherever it surfaces.
 */
export const density = z
  .object({
    gPerMl: z.number().positive().optional(),
    gPerCup: z.number().positive().optional(),
    gPerTbsp: z.number().positive().optional(),
    gPerTsp: z.number().positive().optional(),
    densitySource,
    /** Required when estimated: which class in density-classes.json was interpolated from. */
    densityClass: z.string().min(1).optional(),
  })
  .refine(
    (d) => d.gPerMl != null || d.gPerCup != null || d.gPerTbsp != null || d.gPerTsp != null,
    'density needs at least one measured figure',
  )
  .refine(
    (d) => d.densitySource !== 'estimated' || d.densityClass != null,
    'an estimated density must name the density class it was interpolated from',
  );

/** Where a figure came from, kept on the record rather than in a changelog. */
export const sourceCitation = z.object({
  sourceDataset: z.string().min(1),
  sourceId: z.string().min(1),
  sourceUrl: z.url().optional(),
});
