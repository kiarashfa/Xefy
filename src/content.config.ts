import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

import { ingredientSchema } from './schemas/ingredient.ts';
import { recipeAboutSchema, ingredientAboutSchema } from './schemas/about.ts';
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
 *
 * `about.mdx` is excluded explicitly: it sits in the same directory and is not
 * a version of the dish.
 */
const recipeVersions = defineCollection({
  loader: glob({
    pattern: ['*/*.mdx', '!*/index.mdx', '!*/about.mdx'],
    base: `${CONTENT}/recipes`,
  }),
  schema: recipeVersionSchema,
});

/**
 * Reference prose about the dish, shown in its own panel. Recipe-level rather
 * than version-level: the history of a dish does not change between a
 * wood-fired version and a home-oven one.
 */
const recipeAbout = defineCollection({
  loader: glob({ pattern: '*/about.mdx', base: `${CONTENT}/recipes` }),
  schema: recipeAboutSchema,
});

/** Data-only records; nutrition and density have no narrative to carry. */
const ingredients = defineCollection({
  loader: glob({ pattern: '*.json', base: `${CONTENT}/ingredients` }),
  schema: ingredientSchema,
});

/**
 * Optional narrative for an ingredient: history, buying, storage. Optional to
 * have, never optional to source.
 */
const ingredientAbout = defineCollection({
  loader: glob({ pattern: '*.mdx', base: `${CONTENT}/ingredients` }),
  schema: ingredientAboutSchema,
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
  recipeAbout,
  ingredients,
  ingredientAbout,
  components,
  techniques,
};
