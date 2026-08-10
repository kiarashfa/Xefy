/**
 * Unit conversion and the formatting rules that go with it.
 *
 * Every function here is pure and runs identically at build time and in the
 * browser. That is the point: the server renders the default view and the
 * client re-renders on a serving or unit change, and if the two used different
 * code they would eventually disagree.
 */

export type UnitSystem = 'metric' | 'us';

/* Exact definitions, not approximations — these are the legal conversions. */
export const G_PER_OZ = 28.349523125;
export const G_PER_LB = 453.59237;
export const OZ_PER_LB = 16;

export const ML_PER_TSP = 4.92892159375;
export const ML_PER_TBSP = 14.78676478125;
export const ML_PER_FL_OZ = 29.5735295625;
export const ML_PER_CUP = 236.5882365;
export const ML_PER_QUART = 946.352946;

export const CM_PER_IN = 2.54;

/* ------------------------------------------------------------------ *
 * Fractions
 * ------------------------------------------------------------------ */

/**
 * The fractions a kitchen actually uses. US customary amounts read as
 * fractions because that is how the measuring equipment is marked — a decimal
 * cup measurement is a number nobody can act on.
 */
const KITCHEN_FRACTIONS: readonly { value: number; glyph: string }[] = [
  { value: 0, glyph: '' },
  { value: 1 / 8, glyph: '⅛' },
  { value: 1 / 4, glyph: '¼' },
  { value: 1 / 3, glyph: '⅓' },
  { value: 1 / 2, glyph: '½' },
  { value: 2 / 3, glyph: '⅔' },
  { value: 3 / 4, glyph: '¾' },
  { value: 7 / 8, glyph: '⅞' },
  { value: 1, glyph: '' },
];

/** The coarser set, for lengths, where eighths are false precision. */
const QUARTER_FRACTIONS: readonly { value: number; glyph: string }[] = [
  { value: 0, glyph: '' },
  { value: 1 / 4, glyph: '¼' },
  { value: 1 / 2, glyph: '½' },
  { value: 3 / 4, glyph: '¾' },
  { value: 1, glyph: '' },
];

function nearest(
  fraction: number,
  table: readonly { value: number; glyph: string }[],
): { carry: number; glyph: string } {
  let best = table[0]!;
  for (const entry of table) {
    if (Math.abs(entry.value - fraction) < Math.abs(best.value - fraction)) best = entry;
  }
  return { carry: best.value === 1 ? 1 : 0, glyph: best.glyph };
}

/**
 * Renders a number as a whole part plus a kitchen fraction: 2.5 → "2 ½".
 *
 * A value that rounds away to nothing keeps the smallest fraction rather than
 * becoming "0" — the caller is expected to have already stepped down to a
 * smaller unit if that is the better answer.
 */
export function formatFraction(value: number, coarse = false): string {
  const table = coarse ? QUARTER_FRACTIONS : KITCHEN_FRACTIONS;
  const whole = Math.floor(value);
  const { carry, glyph } = nearest(value - whole, table);
  const total = whole + carry;

  if (total === 0 && glyph === '') {
    return value > 0 ? table[1]!.glyph : '0';
  }
  if (total === 0) return glyph;
  if (glyph === '') return String(total);
  return `${total} ${glyph}`;
}

/**
 * Metric amounts are decimal, with precision that falls off as the number
 * grows — a tenth of a gram matters in 3 g of yeast and is noise in 450 g of
 * flour.
 */
export function formatDecimal(value: number): string {
  const rounded = value < 1 ? Math.round(value * 100) / 100 : value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return String(rounded);
}

/* ------------------------------------------------------------------ *
 * Temperature — §3.7
 * ------------------------------------------------------------------ */

/**
 * Fahrenheit lands on the nearest 5°. An oven dial is not a precise
 * instrument, and "500°F" carries the confidence the number deserves where
 * "482°F" claims one it does not have.
 */
export function celsiusToFahrenheit(celsius: number): number {
  return Math.round(((celsius * 9) / 5 + 32) / 5) * 5;
}

export function formatTemperature(celsius: number, system: UnitSystem): string {
  return system === 'metric'
    ? `${Math.round(celsius)} °C`
    : `${celsiusToFahrenheit(celsius)} °F`;
}

/* ------------------------------------------------------------------ *
 * Length — §3.7
 * ------------------------------------------------------------------ */

export function formatLength(cm: number, system: UnitSystem): string {
  if (system === 'metric') return `${formatDecimal(cm)} cm`;
  const inches = cm / CM_PER_IN;
  // Eighths below two inches, quarters above: a 12-inch round measured to the
  // eighth claims a precision no dough has.
  return `${formatFraction(inches, inches >= 2)} in`;
}

/* ------------------------------------------------------------------ *
 * Duration — §3.5
 * ------------------------------------------------------------------ */

/**
 * Under an hour reads as minutes; at an hour and above as hours and minutes,
 * dropping the minutes when they are zero.
 *
 * Computed totals are often unround, and that is correct. A total rounded to
 * look tidy is a hand-typed number wearing a computed number's clothes.
 */
export function formatDuration(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total}m`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/* ------------------------------------------------------------------ *
 * Clock times — §3.8
 * ------------------------------------------------------------------ */

/** 24-hour local clock. Exact, never rounded to a tidier minute. */
export function formatClock(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * How many calendar days a moment sits from the anchor day. A bare clock time
 * that silently belongs to another day is the one failure this has to prevent.
 */
export function dayOffset(from: Date, to: Date): number {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000);
}

export function formatDayOffset(offset: number): string {
  if (offset === 0) return '';
  if (offset === -1) return 'the day before';
  if (offset === 1) return 'the next day';
  if (offset < 0) return `${Math.abs(offset)} days before`;
  return `${offset} days later`;
}
