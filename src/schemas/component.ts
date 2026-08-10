import { z } from 'astro/zod';
import { slug } from './primitives.ts';
import { ingredientLine, stepEntry } from './recipe.ts';

/**
 * A reusable bundle of steps and ingredients — "boil pasta al dente",
 * "béchamel". It exists to keep authoring DRY; readers only ever see it
 * flattened into a recipe, unless it is notable enough to also stand alone.
 */
export const componentSchema = z.object({
  title: z.string().min(1),
  /** One sentence, used where the component is listed for reuse. */
  summary: z.string().min(1),

  /**
   * Amounts are a batch, not a serving count: a recipe scales them with its
   * own multiplier, and the reader's serving scale applies after that.
   */
  batchLabel: z.string().min(1).optional(),

  ingredients: z.array(ingredientLine).min(1),
  steps: z.array(stepEntry).min(1),

  /** Whether this also earns a page of its own for direct search traffic. */
  standalonePage: z.boolean().default(false),
  relatedTechniques: z.array(slug).default([]),
  draft: z.boolean().default(false),
});

export type Component = z.infer<typeof componentSchema>;
