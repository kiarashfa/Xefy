import type { UnitSystem } from '../math/units.ts';
import { displayAmount, displayName, type ListLine } from './aggregate.ts';
import type { ResolvedPlanItem } from './resolve.ts';
import type { CatalogRecord, PlanItem } from './types.ts';

/**
 * Sharing a list, and sharing a plan. §8.4
 *
 * Two different things travel: the *text* goes to a person in a message, and
 * the *URL* carries the plan so the recipient's page computes the list itself —
 * in their own unit system, with working links — rather than receiving a frozen
 * snapshot.
 */

/** Beyond this a fragment is not a shared plan, it is someone poking at it. */
const MAX_SHARED_ITEMS = 40;
const MIN_SERVINGS = 1;
const MAX_SERVINGS = 24;

/* ------------------------------------------------------------------ *
 * The text
 * ------------------------------------------------------------------ */

/**
 * The format is fixed because it has two audiences: a person reading it in a
 * message, and an assistant asked to turn it into an order. Quantity first, one
 * item per line, unit separated from name, no markdown and no nesting — that
 * reads correctly in any plain-text client and parses reliably.
 */
export function shareText(
  lines: readonly ListLine[],
  items: readonly ResolvedPlanItem[],
  system: UnitSystem,
  url?: string,
): string {
  const rendered = lines.map((line) => {
    const amount = displayAmount(line, system);
    return { amount: `${amount.estimated ? '~' : ''}${amount.text}`, name: displayName(line) };
  });

  // The amount column is padded to a common width so the names line up when the
  // message client uses a monospaced font, and reads normally when it does not.
  const width = rendered.reduce((max, r) => Math.max(max, r.amount.length), 0);

  const body = rendered.map((r) => `- ${r.amount.padEnd(width)}  ${r.name}`);

  const forLine = items
    .map((i) => `${i.recipe.title} (${i.item.servings} servings)`)
    .join(', ');

  return [
    'Shopping list — Xefy',
    '',
    ...(body.length > 0 ? body : ['- (nothing to buy)']),
    '',
    ...(forLine ? [`For: ${forLine}`] : []),
    ...(url ? [url] : []),
  ].join('\n');
}

/**
 * The week, as a message.
 *
 * Same discipline as the list: one line per thing, no markdown, nothing that
 * depends on a monospaced font to make sense. Days are relative slots rather
 * than dates (§8.5), so they are named and not dated — a plan sent on Thursday
 * still means "Monday", whenever the reader cooks it.
 *
 * Anything without a day is grouped at the end rather than dropped. A dish
 * someone means to cook but has not placed is still part of what they are
 * sharing.
 */
export function planText(
  items: readonly ResolvedPlanItem[],
  dayLabels: Readonly<Record<string, string>>,
  days: readonly string[],
  url?: string,
): string {
  const line = (i: ResolvedPlanItem) =>
    `- ${i.recipe.title} (${i.item.servings} ${i.item.servings === 1 ? 'serving' : 'servings'})`;

  const scheduled = days
    .map((day) => ({ day, entries: items.filter((i) => i.item.day === day) }))
    .filter((slot) => slot.entries.length > 0)
    .flatMap((slot) => [`${dayLabels[slot.day] ?? slot.day}:`, ...slot.entries.map(line), '']);

  const loose = items.filter((i) => i.item.day === null);

  return [
    'Meal plan — Xefy',
    '',
    ...(scheduled.length > 0 ? scheduled : []),
    ...(loose.length > 0 ? ['Not yet given a day:', ...loose.map(line), ''] : []),
    ...(items.length === 0 ? ['- (nothing planned)', ''] : []),
    ...(url ? [url] : []),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

/* ------------------------------------------------------------------ *
 * The fragment
 * ------------------------------------------------------------------ */

/**
 * `#p=margherita-pizza:4,hummus:6:home-oven`
 *
 * A fragment rather than a query string, because fragments are never sent to
 * the server and so never appear in logs or referrers, and because it keeps the
 * page a single URL as far as crawlers are concerned.
 *
 * §8.4 gives the shape as `slug:servings`. The version is appended as a third
 * field only where the item is not on the recipe's default version: without it
 * a shared Neapolitan pizza arrives as the home-oven one, and the recipient's
 * list quietly disagrees with the sender's. A two-field entry still parses, so
 * the documented form remains valid input.
 *
 * `have` is deliberately not encoded: what the sender already owns is not
 * information the recipient needs.
 */
export function encodePlanFragment(items: readonly ResolvedPlanItem[]): string {
  const parts = items.slice(0, MAX_SHARED_ITEMS).map((entry) => {
    const isDefault = entry.recipe.versions[0]?.id === entry.item.version;
    const base = `${entry.recipe.slug}:${entry.item.servings}`;
    return isDefault ? base : `${base}:${entry.item.version}`;
  });
  return parts.length > 0 ? `#p=${parts.join(',')}` : '';
}

const clampServings = (raw: string): number | null => {
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= MIN_SERVINGS && n <= MAX_SERVINGS ? n : null;
};

/**
 * Reads a fragment someone else wrote. It is untrusted input, so every slug is
 * resolved against the catalogue and anything that does not match is discarded
 * rather than rendered — there is no path here by which a hostile fragment can
 * put content of its own on the page.
 */
export function decodePlanFragment(
  hash: string,
  catalog: readonly CatalogRecord[],
): Omit<PlanItem, 'uid'>[] {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw.startsWith('p=')) return [];

  const bySlug = new Map(catalog.map((r) => [r.slug, r]));
  const out: Omit<PlanItem, 'uid'>[] = [];

  for (const entry of raw.slice(2).split(',')) {
    if (out.length >= MAX_SHARED_ITEMS) break;
    const [slug = '', servingsRaw = '', versionId] = decodeURIComponent(entry).split(':');

    const recipe = bySlug.get(slug);
    if (!recipe) continue;

    const servings = clampServings(servingsRaw);
    if (servings == null) continue;

    // An unknown version falls back to the default rather than dropping the
    // dish: the recipe is real, and the reader gets the version the site itself
    // shows first.
    const version = recipe.versions.find((v) => v.id === versionId) ?? recipe.versions[0];
    if (!version) continue;

    // A shared plan is a plan: everything in it arrives as something to cook,
    // whatever the sender had marked as shopping-only.
    out.push({ recipe: recipe.slug, version: version.id, servings, day: null, listOnly: false });
  }

  return out;
}
