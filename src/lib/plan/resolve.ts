import type { CatalogRecord, CatalogVersion, Plan, PlanItem } from './types.ts';

/**
 * Reconciling a saved plan against the catalogue it was saved from. §8.3
 *
 * The Plan stores references, so every figure it shows is recomputed on load —
 * which also means a reference can have gone away since. A recipe that has been
 * renamed, or a version that has been folded into another, leaves an item with
 * nothing behind it. Those are dropped, and the page says how many and why: a
 * shopping list that quietly lost an entry is worse than one that admits it.
 */

export type DropReason = 'recipe-gone' | 'version-gone';

export interface DroppedItem {
  uid: string;
  recipe: string;
  version: string;
  reason: DropReason;
}

export interface ResolvedPlanItem {
  item: PlanItem;
  recipe: CatalogRecord;
  version: CatalogVersion;
}

export interface PlanResolution {
  items: ResolvedPlanItem[];
  dropped: DroppedItem[];
}

export function resolvePlan(value: Plan, catalog: readonly CatalogRecord[]): PlanResolution {
  const bySlug = new Map(catalog.map((r) => [r.slug, r]));
  const items: ResolvedPlanItem[] = [];
  const dropped: DroppedItem[] = [];

  for (const item of value.items) {
    const recipe = bySlug.get(item.recipe);
    if (!recipe) {
      dropped.push({ uid: item.uid, recipe: item.recipe, version: item.version, reason: 'recipe-gone' });
      continue;
    }
    const version = recipe.versions.find((v) => v.id === item.version);
    if (!version) {
      dropped.push({ uid: item.uid, recipe: item.recipe, version: item.version, reason: 'version-gone' });
      continue;
    }
    items.push({ item, recipe, version });
  }

  return { items, dropped };
}

/** The single quiet line, or nothing at all when nothing was dropped. */
export function describeDropped(dropped: readonly DroppedItem[]): string | null {
  if (dropped.length === 0) return null;
  const missingRecipes = dropped.filter((d) => d.reason === 'recipe-gone').length;
  const missingVersions = dropped.length - missingRecipes;

  const parts: string[] = [];
  if (missingRecipes > 0) {
    parts.push(
      `${missingRecipes} ${missingRecipes === 1 ? 'dish is' : 'dishes are'} no longer on the site`,
    );
  }
  if (missingVersions > 0) {
    parts.push(
      `${missingVersions} ${missingVersions === 1 ? 'version has' : 'versions have'} been changed since`,
    );
  }

  const count = dropped.length === 1 ? 'One saved entry was' : `${dropped.length} saved entries were`;
  return `${count} removed from this plan: ${parts.join(', and ')}.`;
}

/** The total number of portions a plan produces — the divisor for §8.5's average. */
export const totalPortions = (items: readonly ResolvedPlanItem[]): number =>
  items.reduce((sum, i) => sum + i.item.servings, 0);
