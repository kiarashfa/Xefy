import { atom } from 'nanostores';
import { readNotice, versionedStore } from '../storage.ts';
import { EMPTY_PLAN, isDay, type Day, type Plan, type PlanItem } from './types.ts';

/**
 * The Plan — the only stateful thing in this feature.
 *
 * A shopping list and a weekly meal plan are two views of one list of recipes
 * the reader intends to cook. Building them over one store is the whole design:
 * two parallel stores would disagree the moment someone changed a serving count
 * in one of them. §8.3
 *
 * Everything else in `src/lib/plan/` is a pure function over this value.
 */

const MIN_SERVINGS = 1;
const MAX_SERVINGS = 24;

const store = versionedStore<Plan>('plan', 1, 1);

export const plan = atom<Plan>(EMPTY_PLAN);

/** The one-line notice §8.1 requires when the Plan starts empty for a reason. */
export const planNotice = atom<string | null>(null);

/** True once `loadPlan` has run, so a view can tell "empty" from "not yet read". */
export const planLoaded = atom<boolean>(false);

const clampServings = (value: unknown): number => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return MIN_SERVINGS;
  return Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, n));
};

/**
 * Short and random. Two entries for the same dish on two nights have to stay
 * independent, and nothing else depends on the value.
 */
function uid(): string {
  try {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 6);
  } catch {
    return Math.random().toString(36).slice(2, 8);
  }
}

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * What comes back from storage is untrusted in exactly the way a URL fragment
 * is: it was written by an older version of this code, or by hand. Each field
 * is checked rather than spread in.
 */
export function sanitisePlan(raw: Partial<Plan> | null): Plan {
  if (!raw) return EMPTY_PLAN;
  const items = Array.isArray(raw.items) ? raw.items : [];
  return {
    items: items
      .filter(
        (i): i is PlanItem =>
          Boolean(i) && typeof i.recipe === 'string' && typeof i.version === 'string',
      )
      .map((i) => ({
        uid: typeof i.uid === 'string' && i.uid ? i.uid : uid(),
        recipe: i.recipe,
        version: i.version,
        servings: clampServings(i.servings),
        day: isDay(i.day) ? i.day : null,
        // Absent in plans saved before the flag existed, and false is what
        // those meant — every one of them was added as something to cook.
        listOnly: i.listOnly === true,
      })),
    have: stringList(raw.have),
    needStaples: stringList(raw.needStaples),
  };
}

/**
 * Reads storage once per page.
 *
 * Idempotent on purpose: the header count and the page's own view both need the
 * Plan, and re-reading would lose the notice — a discarded value is cleared as
 * it is read, so a second read would find an ordinary empty store and report
 * nothing, which is exactly the silence §8.1 forbids.
 */
export function loadPlan(): void {
  if (planLoaded.get()) return;

  const { value, status } = store.read();
  plan.set(sanitisePlan(value));
  planNotice.set(readNotice(status));
  planLoaded.set(true);
  // A discarded value is cleared rather than left to be re-read and re-reported
  // on every page for the rest of the browser's life.
  if (status === 'discarded') store.clear();
}

function commit(next: Plan): void {
  plan.set(next);
  store.write(next);
}

const update = (change: (current: Plan) => Plan) => commit(change(plan.get()));

/**
 * Adds a dish at the serving count currently showing in the stepper. Adding the
 * same recipe twice is allowed and meaningful — cook it Monday and Thursday.
 */
export function addToPlan(
  recipe: string,
  version: string,
  servings: number,
  listOnly = false,
): PlanItem {
  const item: PlanItem = {
    uid: uid(),
    recipe,
    version,
    servings: clampServings(servings),
    day: null,
    listOnly,
  };
  update((current) => ({ ...current, items: [...current.items, item] }));
  return item;
}

/** Promoting something bought-for into something planned, or the reverse. */
export function setItemListOnly(itemUid: string, listOnly: boolean): void {
  update((current) => ({
    ...current,
    items: current.items.map((i) =>
      i.uid === itemUid ? { ...i, listOnly, day: listOnly ? null : i.day } : i,
    ),
  }));
}

export function removeFromPlan(itemUid: string): void {
  update((current) => ({ ...current, items: current.items.filter((i) => i.uid !== itemUid) }));
}

export function setItemServings(itemUid: string, servings: number): void {
  update((current) => ({
    ...current,
    items: current.items.map((i) =>
      i.uid === itemUid ? { ...i, servings: clampServings(servings) } : i,
    ),
  }));
}

export function setItemDay(itemUid: string, day: Day | null): void {
  update((current) => ({
    ...current,
    items: current.items.map((i) => (i.uid === itemUid ? { ...i, day } : i)),
  }));
}

/** Ticking something off the shopping list. Reversible, and never a deletion. */
export function toggleHave(ingredientRef: string): void {
  update((current) => ({
    ...current,
    have: current.have.includes(ingredientRef)
      ? current.have.filter((h) => h !== ingredientRef)
      : [...current.have, ingredientRef],
  }));
}

/** Moves one pantry staple into "To buy", or back out of it. §8.4 */
export function toggleNeedStaple(ingredientRef: string): void {
  update((current) => ({
    ...current,
    needStaples: current.needStaples.includes(ingredientRef)
      ? current.needStaples.filter((s) => s !== ingredientRef)
      : [...current.needStaples, ingredientRef],
  }));
}

export function clearPlan(): void {
  commit(EMPTY_PLAN);
}

/**
 * "Copy to my plan", from a shared link. It adds rather than replaces: someone
 * opening a friend's list has their own plan, and losing it to a link would be
 * unrecoverable. §8.4
 */
export function copyIntoPlan(items: readonly Omit<PlanItem, 'uid'>[]): number {
  const added = items.map((i) => ({ ...i, uid: uid(), servings: clampServings(i.servings) }));
  update((current) => ({ ...current, items: [...current.items, ...added] }));
  return added.length;
}

export const planItemCount = (value: Plan = plan.get()): number => value.items.length;
