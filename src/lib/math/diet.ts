import {
  DIET_ALLOWED_ORIGINS,
  DIET_LABELS,
  type Allergen,
  type AnimalOrigin,
  type DietLabel,
} from '../../schemas/vocabularies.ts';

export type FreeFromLabel = 'gluten-free' | 'dairy-free' | 'nut-free';

/** What the diet computation needs to know about one ingredient in a dish. */
export interface DietContribution {
  /** Ingredient name, for the note that accompanies a computed label. */
  label: string;
  animalOrigin: AnimalOrigin;
  animalOriginNote?: string | undefined;
  containsGluten: boolean;
  containsDairy: boolean;
  allergenTags: readonly Allergen[];
}

export interface DietResult {
  /** Every qualifying label, most restrictive first. */
  labels: DietLabel[];
  /**
   * The single label the hero shows. Free-from labels never appear here — they
   * are catalogue facets and belong beside the allergen disclosure.
   */
  heroLabel: DietLabel | null;
  freeFrom: FreeFromLabel[];
  allergens: Allergen[];
  /**
   * Why a label survived a suspicious-looking ingredient, or why one did not.
   * Surfaced wherever the label is, because a site claiming computed labels
   * cannot be casually wrong about rennet.
   */
  animalOriginNotes: { label: string; note: string }[];
}

const NUT_ALLERGENS: readonly Allergen[] = ['nuts', 'peanuts'];

/**
 * Derives diet and allergen labels from the ingredients themselves.
 *
 * Never hand-tagged: a recipe tagged "vegetarian" goes stale the moment an
 * ingredient is swapped, and nobody notices. Derived from the list every time,
 * it cannot.
 *
 * Run this **after** transclusion. A Component contributes real ingredients,
 * and a béchamel folded into a dish makes it no less dairy for having arrived
 * indirectly.
 */
export function computeDiet(contributions: DietContribution[]): DietResult {
  const labels = DIET_LABELS.filter((label) =>
    contributions.every((c) => DIET_ALLOWED_ORIGINS[label].has(c.animalOrigin)),
  );

  const allergens = [...new Set(contributions.flatMap((c) => [...c.allergenTags]))].sort();

  const freeFrom: FreeFromLabel[] = [];
  if (!contributions.some((c) => c.containsGluten)) freeFrom.push('gluten-free');
  if (!contributions.some((c) => c.containsDairy)) freeFrom.push('dairy-free');
  if (!NUT_ALLERGENS.some((n) => allergens.includes(n))) freeFrom.push('nut-free');

  const animalOriginNotes = contributions
    .filter((c) => c.animalOriginNote)
    .map((c) => ({ label: c.label, note: c.animalOriginNote! }));

  return {
    labels: [...labels],
    // DIET_LABELS runs vegan → vegetarian → pescatarian, so the first match is
    // already the most restrictive. No qualifying label means no fact at all,
    // rather than an empty slot.
    heroLabel: labels[0] ?? null,
    freeFrom,
    allergens,
    animalOriginNotes,
  };
}
