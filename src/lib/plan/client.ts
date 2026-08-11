import { atom } from 'nanostores';
import type { CatalogRecord, RecipeDetail } from './types.ts';

/**
 * Fetching the two build-time exports. §8.1
 *
 * The split is the point: the light index arrives once, and a detail file is
 * pulled only for a dish someone has actually planned. At ten recipes that is a
 * nicety; at five hundred it is the difference between a page that loads and
 * one that does not.
 *
 * Both Plan views load through here, so neither can end up with a different
 * idea of what is on the site.
 */

export const catalog = atom<CatalogRecord[] | null>(null);
export const details = atom<Map<string, RecipeDetail>>(new Map());

/** Set when the data behind the page could not be fetched at all. */
export const loadError = atom<string | null>(null);

let catalogRequest: Promise<void> | null = null;
const detailRequests = new Map<string, Promise<void>>();

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return (await response.json()) as T;
}

/** Idempotent: several components on one page share the one request. */
export function ensureCatalog(base: string): Promise<void> {
  catalogRequest ??= fetchJson<CatalogRecord[]>(`${base}catalog-index.json`)
    .then((records) => {
      catalog.set(records);
    })
    .catch(() => {
      loadError.set('The catalogue could not be loaded, so this plan cannot be worked out right now.');
    });
  return catalogRequest;
}

/**
 * One file per planned recipe, requested once each. A recipe dropped from the
 * plan keeps its detail in memory rather than being re-fetched if it comes
 * back — plans are small and the file is already paid for.
 */
export async function ensureDetails(base: string, slugs: readonly string[]): Promise<void> {
  const wanted = [...new Set(slugs)].filter((slug) => !detailRequests.has(slug));

  for (const slug of wanted) {
    detailRequests.set(
      slug,
      fetchJson<RecipeDetail>(`${base}recipe-detail/${slug}.json`)
        .then((detail) => {
          details.set(new Map(details.get()).set(slug, detail));
        })
        .catch(() => {
          // A missing detail file leaves that dish out of the arithmetic rather
          // than emptying the page; the resolver already reports what is gone.
        }),
    );
  }

  await Promise.all([...detailRequests.values()]);
}
