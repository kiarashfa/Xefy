# Xefy

A free, ad-free, login-free recipe encyclopedia. One page per dish.

Every number on a page — ingredient quantities, nutrition, timing — is computed
from structured data rather than typed into prose. Change the serving count and
the whole page recomputes; switch to US customary and temperatures and
dimensions change with it, in the method text as well as the ingredient list.
Nothing is hand-typed, so nothing can drift out of step.

Static site, no backend, no accounts. Anything the site remembers about you
lives in your own browser.

## Running it

```bash
npm install
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Content checks, then a production build, then the search index |
| `npm run preview` | Serve the production build locally |
| `npm run check` | TypeScript and Astro diagnostics |
| `npm run check:content` | Content integrity checks on their own |
| `npm run check:self` | Confirms those checks still catch known-bad content |

## How content is checked

`npm run build` will not produce a site from content that cannot be trusted. A
quantity referenced in a step that does not exist in the ingredient list, a
split ingredient whose parts do not add up, a number typed into prose instead
of computed — each of these stops the build rather than reaching a page.

Some things only warrant a warning: an ingredient the method never mentions
might be a garnish, and a recipe with two versions might be right. Those are
reported and left to a human.

`scripts/integrity/` holds the checks. `test-fixtures/broken-content/` holds
content that breaks every one of them on purpose, so there is a way to tell
that the checks still work.

## Layout

```
src/
  content/      recipes, ingredients, reusable components, techniques
  schemas/      the shape each of those has to have
  data/         taxonomies and reference tables
  lib/          scaling, unit conversion, nutrition and timing
  components/   Astro and Svelte
  pages/        routes
scripts/        build-time checks and data import
```

## Licence

Recipe and ingredient text is original. Photography comes from Wikimedia
Commons and Open Food Facts under the licence each image carries; every image
is credited on the attributions page, along with the processing applied to it.
