/**
 * Closed vocabularies.
 *
 * These lists are fixed in code rather than in a data file because logic
 * depends on their exact membership: diet labels are derived from
 * `animalOrigin`, and an allergen category that appeared after content was
 * authored would leave every earlier record silently under-declared.
 *
 * The matching files in `src/data/taxonomy/` carry display labels for the
 * same ids; an integrity check asserts the two stay in step.
 *
 * Open vocabularies that are expected to grow with the catalogue (cuisine,
 * course, method) live in `src/data/taxonomy/` instead, and are validated
 * against those files rather than against a list here.
 */

/** Ordered from least to most restrictive; the hero shows the most restrictive match. */
export const DIET_LABELS = ['vegan', 'vegetarian', 'pescatarian'] as const;
export type DietLabel = (typeof DIET_LABELS)[number];

/**
 * A boolean "is this an animal product" cannot separate cheese from beef,
 * so the origin is recorded specifically enough to derive every diet label.
 */
export const ANIMAL_ORIGINS = [
  'none',
  'dairy',
  'egg',
  'honey',
  'fish',
  'shellfish',
  'poultry',
  'meat',
  'insect',
] as const;
export type AnimalOrigin = (typeof ANIMAL_ORIGINS)[number];

/** Origins compatible with each diet label. */
export const DIET_ALLOWED_ORIGINS: Record<DietLabel, ReadonlySet<AnimalOrigin>> = {
  vegan: new Set<AnimalOrigin>(['none']),
  vegetarian: new Set<AnimalOrigin>(['none', 'dairy', 'egg', 'honey']),
  pescatarian: new Set<AnimalOrigin>(['none', 'dairy', 'egg', 'honey', 'fish', 'shellfish']),
};

/** The union of the US and EU declarable lists, for a global-English audience. */
export const ALLERGENS = [
  'nuts',
  'peanuts',
  'shellfish',
  'molluscs',
  'fish',
  'dairy',
  'gluten',
  'soy',
  'egg',
  'sesame',
  'celery',
  'mustard',
  'lupin',
  'sulphites',
] as const;
export type Allergen = (typeof ALLERGENS)[number];

/** Editorial assessment, presented as such rather than as a derived figure. */
export const DIFFICULTIES = ['Easy', 'Medium', 'Hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/**
 * Base units for authored amounts. Cups and spoons are display-only
 * conversions computed from density; authoring in them would make the
 * stored figure depend on a density estimate.
 */
export const BASE_UNITS = ['g', 'ml'] as const;
export type BaseUnit = (typeof BASE_UNITS)[number];

/** Which line of the Prep / Cook / Rest card a step's duration lands on. */
export const STEP_PHASES = ['prep', 'cook', 'rest'] as const;
export type StepPhase = (typeof STEP_PHASES)[number];

export const DENSITY_SOURCES = ['measured', 'estimated'] as const;
export type DensitySource = (typeof DENSITY_SOURCES)[number];
