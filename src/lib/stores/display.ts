import { atom } from 'nanostores';
import type { UnitSystem } from '../math/units.ts';
import { versionedStore } from '../storage.ts';

/**
 * The two pieces of state every live value on a recipe page depends on.
 *
 * Keeping them here rather than inside a component is what lets the serving
 * stepper, the unit toggle and forty quantity spans stay in step without any
 * of them knowing about the others.
 */

export const unitSystem = atom<UnitSystem>('metric');
export const servings = atom<number>(0);

/* Namespacing, versioning, the schema check and the guarded read all live in
 * one place now — the same utility the Plan uses. §8.1 */
const unitsStore = versionedStore<{ system: UnitSystem }>('units', 1, 1);
const servingsStore = versionedStore<{ byRecipe: Record<string, number> }>('servings', 1, 1);

export function restoreUnitSystem(): void {
  const { value } = unitsStore.read();
  if (value?.system === 'metric' || value?.system === 'us') unitSystem.set(value.system);
}

export function setUnitSystem(system: UnitSystem): void {
  unitSystem.set(system);
  unitsStore.write({ system });
}

/** Serving counts are remembered per recipe: they are a property of the dish. */
export function restoreServings(recipeSlug: string, fallback: number): void {
  const saved = servingsStore.read().value?.byRecipe?.[recipeSlug];
  servings.set(typeof saved === 'number' && saved > 0 ? saved : fallback);
}

export function setServings(recipeSlug: string, count: number): void {
  servings.set(count);
  const stored = servingsStore.read().value;
  servingsStore.write({ byRecipe: { ...(stored?.byRecipe ?? {}), [recipeSlug]: count } });
}
