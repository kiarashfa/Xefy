import type { APIRoute } from 'astro';
import { catalogRecord, getSite } from '../lib/content/site.ts';

/**
 * The light catalogue export. §8.1
 *
 * One record per recipe, holding what the homepage and reverse search need and
 * nothing else. Amounts and full nutrition live in the per-recipe detail files,
 * because loading them site-wide would tax every page for a feature most visits
 * never touch.
 *
 * Generated from the same content the pages render, so the two cannot disagree.
 */
export const GET: APIRoute = async () => {
  const site = await getSite();
  return new Response(JSON.stringify(site.recipes.map(catalogRecord)), {
    headers: { 'content-type': 'application/json' },
  });
};
