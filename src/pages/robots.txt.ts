import type { APIRoute } from 'astro';

/**
 * The user-state pages are noindexed by meta tag rather than disallowed here.
 * A blocked page cannot be fetched, so the tag is never seen — which is the
 * standard way to end up with a thin page indexed anyway. §9.
 */
export const GET: APIRoute = ({ site }) => {
  // The sitemap sits under the base path, not at the origin root.
  const sitemap = new URL(`${import.meta.env.BASE_URL}sitemap-index.xml`, site);

  return new Response(['User-agent: *', 'Allow: /', '', `Sitemap: ${sitemap}`, ''].join('\n'), {
    headers: { 'content-type': 'text/plain' },
  });
};
