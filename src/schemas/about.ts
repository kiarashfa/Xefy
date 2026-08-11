import { z } from 'astro/zod';
import { refId, slug } from './primitives.ts';

/**
 * Reference prose — where a dish comes from, how it became what it is, what
 * separates it from its neighbours.
 *
 * Sourcing is mandatory here, and it is the only place on the site where it is.
 * Culinary technique is trusted directly, because a wrong technique is caught
 * by the first person who cooks the dish. An invented origin story is caught by
 * nobody: it is fluent, plausible, flattering, and indistinguishable from a
 * real one to the reader and to whoever wrote it. So the sources are part of
 * the record rather than part of the research that produced it.
 */

export const sourceReference = z.object({
  /** What `<Cite ref="…"/>` points at. */
  id: refId,
  title: z.string().min(1),
  /** The publication, institution or site standing behind the claim. */
  publisher: z.string().min(1),
  url: z.url().optional(),
  /** Year or date of publication, as free text — sources state it inconsistently. */
  published: z.string().min(1).optional(),
  /** ISO date the source was read, so a dead link is still traceable. */
  accessed: z.string().min(1).optional(),
  /**
   * What this source actually establishes, where that is not obvious. Useful
   * where a source is cited precisely because it *disputes* something.
   */
  note: z.string().min(1).optional(),
});

export type SourceReference = z.infer<typeof sourceReference>;

const sourcesField = z
  .array(sourceReference)
  .min(1, 'reference prose needs at least one source; unsourceable claims get cut instead')
  .superRefine((sources, ctx) => {
    const seen = new Set<string>();
    for (const [i, source] of sources.entries()) {
      if (seen.has(source.id)) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'id'],
          message: `duplicate source id "${source.id}"`,
        });
      }
      seen.add(source.id);
    }
  });

export const recipeAboutSchema = z.object({
  /**
   * One or two sentences. Shown wherever the panel is closed, and usable as the
   * page's meta description.
   */
  summary: z.string().min(1),
  sources: sourcesField,
});

export type RecipeAbout = z.infer<typeof recipeAboutSchema>;

/**
 * The same content and the same rules for an ingredient. Optional to have —
 * an ingredient page is valid with none — never optional to source.
 */
export const ingredientAboutSchema = z.object({
  ingredientRef: slug,
  summary: z.string().min(1),
  sources: sourcesField,
});

export type IngredientAbout = z.infer<typeof ingredientAboutSchema>;
