import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

import { ingredientSchema, ingredientEnrichmentSchema } from './schemas/ingredient.ts';
import { recipeSchema, recipeVersionSchema } from './schemas/recipe.ts';
import { componentSchema } from './schemas/component.ts';
import { techniqueSchema } from './schemas/technique.ts';

const CONTENT = './src/content';

/**
 * A recipe's default version. Its directory name is the slug and the canonical
 * URL; identity fields live here and nowhere else.
 */
const recipes = defineCollection({
  loader: glob({ pattern: '*/index.mdx', base: `${CONTENT}/recipes` }),
  schema: recipeSchema,
});

/**
 * Additional versions of a dish — the tabs. Entry ids read as
 * `{recipe-slug}/{version-id}`, which is how they join back to the recipe.
 */
const recipeVersions = defineCollection({
  loader: glob({ pattern: ['*/*.mdx', '!*/index.mdx'], base: `${CONTENT}/recipes` }),
  schema: recipeVersionSchema,
});

/** Data-only records; nutrition and density have no narrative to carry. */
const ingredients = defineCollection({
  loader: glob({ pattern: '*.json', base: `${CONTENT}/ingredients` }),
  schema: ingredientSchema,
});

/** Optional narrative for an ingredient: history, buying, storage. */
const ingredientNotes = defineCollection({
  loader: glob({ pattern: '*.mdx', base: `${CONTENT}/ingredients` }),
  schema: ingredientEnrichmentSchema,
});

const components = defineCollection({
  loader: glob({ pattern: '*.mdx', base: `${CONTENT}/components` }),
  schema: componentSchema,
});

const techniques = defineCollection({
  loader: glob({ pattern: '*.mdx', base: `${CONTENT}/techniques` }),
  schema: techniqueSchema,
});

export const collections = {
  recipes,
  recipeVersions,
  ingredients,
  ingredientNotes,
  components,
  techniques,
};
