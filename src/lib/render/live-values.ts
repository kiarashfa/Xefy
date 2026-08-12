import { formatQuantity, type BaseUnit, type Density } from '../math/quantity.ts';
import {
  formatCount,
  formatDuration,
  formatLength,
  formatTemperature,
  type UnitSystem,
} from '../math/units.ts';

/**
 * The live values — quantities, temperatures, dimensions, durations.
 *
 * These render server-side as ordinary spans carrying their own data in
 * attributes. A recipe page has thirty to fifty of them and exactly two pieces
 * of state behind them all, so making each one an interactive island would
 * ship a great deal of JavaScript to do very little. Instead one small shared
 * script updates every span when the serving count or unit system changes.
 *
 * Both the server render and that script call the functions below, so the
 * first paint and every later update come from one implementation.
 */

export interface QtyData {
  /** Base amount at the recipe's authored serving count, after any merge. */
  amount: number;
  unit: BaseUnit;
  defaultServings: number;
  /** Shown alongside the amount — the two read as one phrase. */
  name: string;
  density?: Density | undefined;
  /** Partial use of a line, for the rare case a portion would be overkill. */
  fraction?: number | undefined;
  /** Present for things a cook counts: the count leads, the weight follows. */
  countUnit?: { singular: string; plural: string; grams: number } | undefined;
}

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * An estimate is marked the same way everywhere it appears: a tilde and a
 * dotted underline, and that pairing means nothing else on the site.
 */
const amountSpan = (text: string, estimated: boolean) =>
  `<span class="qty-amount${estimated ? ' is-estimated' : ''}">${estimated ? '~' : ''}${escapeHtml(text)}</span>`;

export function renderQtyText(
  data: QtyData,
  servings: number,
  system: UnitSystem,
): { text: string; estimated: boolean } {
  const scaled = data.amount * (servings / data.defaultServings) * (data.fraction ?? 1);
  const counted = data.countUnit != null && data.unit === 'g';
  return formatQuantity(scaled, data.unit, system, data.density, counted);
}

/**
 * "3 ½ egg yolks (60 g)".
 *
 * The count is what a cook acts on and the weight is what the site computes
 * from, so both are shown. Eggs vary, which makes the count approximate — and
 * printing the exact figure beside it is what makes saying so unnecessary.
 */
export function countText(
  data: QtyData,
  servings: number,
): { count: string; label: string } | null {
  if (!data.countUnit || data.unit !== 'g') return null;
  const grams = data.amount * (servings / data.defaultServings) * (data.fraction ?? 1);
  const raw = grams / data.countUnit.grams;
  const count = formatCount(raw);
  return { count, label: count === '1' ? data.countUnit.singular : data.countUnit.plural };
}

export function qtyHtml(
  data: QtyData,
  servings: number,
  system: UnitSystem,
  options: { showName?: boolean } = {},
): string {
  const showName = options.showName ?? true;
  const { text, estimated } = renderQtyText(data, servings, system);

  const attrs = [
    'class="qty"',
    'data-qty',
    `data-amount="${data.amount}"`,
    `data-unit="${data.unit}"`,
    `data-default-servings="${data.defaultServings}"`,
  ];
  if (data.fraction != null) attrs.push(`data-fraction="${data.fraction}"`);
  if (data.countUnit && data.unit === 'g') {
    attrs.push(`data-count-grams="${data.countUnit.grams}"`);
    attrs.push(`data-count-singular="${escapeHtml(data.countUnit.singular)}"`);
    attrs.push(`data-count-plural="${escapeHtml(data.countUnit.plural)}"`);
  }
  if (data.density) {
    // One figure is enough for the client: every volume unit derives from it.
    const gPerMl =
      data.density.gPerMl ??
      (data.density.gPerCup != null ? data.density.gPerCup / 236.5882365 : undefined) ??
      (data.density.gPerTbsp != null ? data.density.gPerTbsp / 14.78676478125 : undefined) ??
      (data.density.gPerTsp != null ? data.density.gPerTsp / 4.92892159375 : undefined);
    if (gPerMl != null) {
      attrs.push(`data-g-per-ml="${gPerMl}"`);
      attrs.push(`data-density-source="${data.density.source}"`);
    }
  }

  const counted = countText(data, servings);
  if (counted) {
    // The count is the instruction; the weight is the authority. Both are shown,
    // and the name is already inside the count's own label.
    return (
      `<span ${attrs.join(' ')}>` +
      `<span class="qty-count">${escapeHtml(counted.count)}</span> ` +
      `<span class="qty-name">${escapeHtml(counted.label)}</span> ` +
      `<span class="qty-weight">(${amountSpan(text, estimated)})</span>` +
      `</span>`
    );
  }

  const name = showName ? ` <span class="qty-name">${escapeHtml(data.name)}</span>` : '';
  return `<span ${attrs.join(' ')}>${amountSpan(text, estimated)}${name}</span>`;
}

export function tempHtml(celsius: number, system: UnitSystem): string {
  return `<span class="value value-temp" data-temp-c="${celsius}">${escapeHtml(formatTemperature(celsius, system))}</span>`;
}

export function lenHtml(cm: number, system: UnitSystem): string {
  return `<span class="value value-len" data-len-cm="${cm}">${escapeHtml(formatLength(cm, system))}</span>`;
}

/**
 * A duration reads its own step's declared time, so the sentence and the
 * timing card cannot disagree. It changes with neither serving count nor unit
 * system, so nothing updates it after render.
 */
export function durHtml(minutes: number, stepId: string): string {
  return `<span class="value value-dur" data-dur-min="${minutes}" data-dur-step="${escapeHtml(stepId)}">${escapeHtml(formatDuration(minutes))}</span>`;
}
