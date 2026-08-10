import { z } from 'astro/zod';
import cuisines from '../data/taxonomy/cuisines.json' with { type: 'json' };
import courses from '../data/taxonomy/courses.json' with { type: 'json' };
import methods from '../data/taxonomy/methods.json' with { type: 'json' };
import diets from '../data/taxonomy/diets.json' with { type: 'json' };
import allergens from '../data/taxonomy/allergens.json' with { type: 'json' };

/**
 * Cuisine, course and method are open vocabularies: they grow as the catalogue
 * does, so the list lives in data rather than in code. Tags are still checked
 * against it at build time — an invented tag would silently create an orphan
 * listing page, which is exactly the drift a controlled vocabulary prevents.
 */
export interface TaxonomyTerm {
  id: string;
  label: string;
  description?: string;
}

const ids = (terms: readonly TaxonomyTerm[]) => new Set(terms.map((t) => t.id));

export const CUISINES = cuisines.items as readonly TaxonomyTerm[];
export const COURSES = courses.items as readonly TaxonomyTerm[];
export const METHODS = methods.items as readonly TaxonomyTerm[];
export const DIETS = diets.items as readonly (TaxonomyTerm & { heroEligible: boolean })[];
export const ALLERGEN_TERMS = allergens.items as readonly TaxonomyTerm[];
export const ALLERGEN_DISCLAIMER: string = allergens.disclaimer;

const CUISINE_IDS = ids(CUISINES);
const COURSE_IDS = ids(COURSES);
const METHOD_IDS = ids(METHODS);

const inVocabulary = (set: ReadonlySet<string>, kind: string) =>
  z.string().superRefine((value, ctx) => {
    if (set.has(value)) return;
    ctx.addIssue({
      code: 'custom',
      message: `"${value}" is not in the ${kind} vocabulary (src/data/taxonomy/${kind}.json)`,
    });
  });

export const cuisineTag = inVocabulary(CUISINE_IDS, 'cuisines');
export const courseTag = inVocabulary(COURSE_IDS, 'courses');
export const methodTag = inVocabulary(METHOD_IDS, 'methods');

export const recipeTags = z.object({
  cuisine: z.array(cuisineTag).min(1),
  course: z.array(courseTag).min(1),
  method: z.array(methodTag).default([]),
});

export type RecipeTags = z.infer<typeof recipeTags>;

export const labelFor = (terms: readonly TaxonomyTerm[], id: string): string =>
  terms.find((t) => t.id === id)?.label ?? id;
