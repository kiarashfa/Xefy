import { z } from 'astro/zod';
import { slug } from './primitives.ts';

/**
 * A standalone explainer — "Blanching". Prose, not a procedure to transclude;
 * where a technique is also reusable as steps, that lives as a Component and
 * the two cross-link.
 */
export const techniqueSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  relatedComponents: z.array(slug).default([]),
  relatedRecipes: z.array(slug).default([]),
  image: z
    .object({
      src: z.string().min(1),
      alt: z.string().min(1),
    })
    .optional(),
  draft: z.boolean().default(false),
});

export type Technique = z.infer<typeof techniqueSchema>;
