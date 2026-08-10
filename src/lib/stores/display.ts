import { atom } from 'nanostores';
import type { UnitSystem } from '../math/units.ts';

/**
 * The two pieces of state every live value on a recipe page depends on.
 *
 * Keeping them here rather than inside a component is what lets the serving
 * stepper, the unit toggle and forty quantity spans stay in step without any
 * of them knowing about the others.
 */

export const unitSystem = atom<UnitSystem>('metric');
export const servings = atom<number>(0);

/* Namespaced and versioned, with a schema integer on every stored object, so a
 * shape change is detected rather than half-parsed. */
const UNITS_KEY = 'xefy.units.v1';
const SERVINGS_KEY = 'xefy.servings.v1';
const SCHEMA = 1;

/**
 * Storage can be unavailable — private windows, disabled cookies, a full quota.
 * Every read and write is guarded so the page degrades to working-but-not-
 * remembering rather than breaking.
 */
function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { schema?: number } & T;
    // An unknown or newer schema is discarded rather than partly trusted.
    if (parsed?.schema !== SCHEMA) return null;
    return parsed;
  } catch {
    return null;
  }
}

function write(key: string, value: object): void {
  try {
    localStorage.setItem(key, JSON.stringify({ schema: SCHEMA, ...value }));
  } catch {
    // Nothing to do and nothing worth saying: the feature still works.
  }
}

export function restoreUnitSystem(): void {
  const stored = read<{ system?: UnitSystem }>(UNITS_KEY);
  if (stored?.system === 'metric' || stored?.system === 'us') unitSystem.set(stored.system);
}

export function setUnitSystem(system: UnitSystem): void {
  unitSystem.set(system);
  write(UNITS_KEY, { system });
}

/** Serving counts are remembered per recipe: they are a property of the dish. */
export function restoreServings(recipeSlug: string, fallback: number): void {
  const stored = read<{ byRecipe?: Record<string, number> }>(SERVINGS_KEY);
  const saved = stored?.byRecipe?.[recipeSlug];
  servings.set(typeof saved === 'number' && saved > 0 ? saved : fallback);
}

export function setServings(recipeSlug: string, count: number): void {
  servings.set(count);
  const stored = read<{ byRecipe?: Record<string, number> }>(SERVINGS_KEY);
  write(SERVINGS_KEY, { byRecipe: { ...(stored?.byRecipe ?? {}), [recipeSlug]: count } });
}
