import {
  formatDecimal,
  formatFraction,
  G_PER_LB,
  G_PER_OZ,
  ML_PER_CUP,
  ML_PER_TBSP,
  ML_PER_QUART,
  ML_PER_TSP,
  OZ_PER_LB,
  type UnitSystem,
} from './units.ts';

export type BaseUnit = 'g' | 'ml';

/**
 * Density is only ever a display convenience. It converts a stored weight into
 * a volume a US cook can measure; it never touches the stored number, so an
 * estimate here cannot corrupt a figure the site presents as authoritative.
 * It does have to be visibly marked as an estimate wherever it surfaces.
 */
export interface Density {
  gPerMl?: number | undefined;
  gPerCup?: number | undefined;
  gPerTbsp?: number | undefined;
  gPerTsp?: number | undefined;
  source: 'measured' | 'estimated';
}

export interface FormattedQuantity {
  /** The amount and its unit, e.g. "450 g" or "1 ¾ cups". */
  text: string;
  /** True when a density estimate was involved, so the display can say so. */
  estimated: boolean;
}

/** Grams per millilitre, from whichever density figure the record carries. */
export function gramsPerMl(density: Density): number | null {
  if (density.gPerMl != null) return density.gPerMl;
  if (density.gPerCup != null) return density.gPerCup / ML_PER_CUP;
  if (density.gPerTbsp != null) return density.gPerTbsp / ML_PER_TBSP;
  if (density.gPerTsp != null) return density.gPerTsp / ML_PER_TSP;
  return null;
}

/**
 * The gram weight of an authored line, which is what nutrition is computed
 * from. A line authored in millilitres needs a density to get there — without
 * one the figure cannot be produced, and inventing a value would be worse than
 * saying so.
 */
export function toGrams(amount: number, unit: BaseUnit, density?: Density): number | null {
  if (unit === 'g') return amount;
  if (!density) return null;
  const gPerMl = gramsPerMl(density);
  return gPerMl == null ? null : amount * gPerMl;
}

function formatMetric(amount: number, unit: BaseUnit): string {
  if (amount >= 1000) {
    const large = amount / 1000;
    return unit === 'g' ? `${formatDecimal(large)} kg` : `${formatDecimal(large)} L`;
  }
  return `${formatDecimal(amount)} ${unit}`;
}

/**
 * Whether a rendered fraction reads as one thing or several. It has to be
 * decided from the rendered text rather than the raw number: 1.05 cups renders
 * as "1", and "1 cups" is wrong.
 */
function isPlural(rendered: string): boolean {
  const [whole = '', fraction] = rendered.split(' ');
  const count = Number(whole);
  if (!Number.isFinite(count)) return false; // a bare fraction: "¾ cup"
  return count > 1 || (count === 1 && fraction != null);
}

/** Quarts down to teaspoons, stepping as the amount gets too big or small to read. */
function formatUsVolume(ml: number): string {
  // A pan of pasta water is three quarts, not twelve and two-thirds cups.
  if (ml >= ML_PER_QUART) {
    const rendered = formatFraction(ml / ML_PER_QUART);
    return `${rendered} ${isPlural(rendered) ? 'quarts' : 'quart'}`;
  }
  if (ml >= ML_PER_CUP / 4) {
    const rendered = formatFraction(ml / ML_PER_CUP);
    return `${rendered} ${isPlural(rendered) ? 'cups' : 'cup'}`;
  }
  if (ml >= ML_PER_TBSP) return `${formatFraction(ml / ML_PER_TBSP)} tbsp`;
  return `${formatFraction(ml / ML_PER_TSP)} tsp`;
}

function formatUsMass(grams: number): string {
  const oz = grams / G_PER_OZ;
  if (oz >= OZ_PER_LB) return `${formatFraction(grams / G_PER_LB)} lb`;
  return `${formatFraction(oz)} oz`;
}

/**
 * Renders an amount in the reader's chosen system.
 *
 * A millilitre amount converts to US volume exactly — no density involved. A
 * gram amount prefers volume where a density exists, because that is how a US
 * recipe is read and measured, and falls back to weight where it does not.
 *
 * `counted` is the exception, and it exists because the figure means something
 * different there. Beside a count — "2 garlic cloves (…)" — the bracketed
 * figure is not an alternative way to measure the ingredient; it is the exact
 * weight that makes the approximate count honest (§2.1.1). A volume in that
 * position is a second approximation, which leaves the reader with two
 * estimates and no fact, so a counted amount always renders as mass.
 */
export function formatQuantity(
  amount: number,
  unit: BaseUnit,
  system: UnitSystem,
  density?: Density,
  counted = false,
): FormattedQuantity {
  if (system === 'metric') {
    return { text: formatMetric(amount, unit), estimated: false };
  }

  if (unit === 'ml') {
    return { text: formatUsVolume(amount), estimated: false };
  }

  const gPerMl = counted || !density ? null : gramsPerMl(density);
  if (gPerMl != null && density) {
    return { text: formatUsVolume(amount / gPerMl), estimated: density.source === 'estimated' };
  }
  return { text: formatUsMass(amount), estimated: false };
}

/**
 * The reader's serving stepper is a plain multiplier over the authored base.
 * Nothing else about a recipe scales — see the timing engine, which
 * deliberately does not.
 */
export function scaleAmount(baseAmount: number, servings: number, defaultServings: number): number {
  return baseAmount * (servings / defaultServings);
}
