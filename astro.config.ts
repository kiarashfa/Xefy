// @ts-check
import { defineConfig } from 'astro/config';

import svelte from '@astrojs/svelte';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// Deployed as a project site on GitHub Pages, so the build needs both the
// origin (for canonical URLs and the sitemap) and the repo path prefix.
export default defineConfig({
  site: 'https://kiarashfa.github.io',
  base: '/Xefy',
  trailingSlash: 'always',
  integrations: [
    svelte(),
    mdx(),
    // User-state pages carry noindex and are kept out of the sitemap. They are
    // deliberately *not* disallowed in robots.txt: a blocked page is never
    // fetched, so the noindex tag would never be seen.
    sitemap({ filter: (page) => !/\/(plan|shopping-list|search)\/?$/.test(page) }),
  ],

  vite: {
    plugins: [tailwindcss()],
  },
});