import { readFile } from 'node:fs/promises';
import { loadContent, type Content } from './disk.ts';
import { resolveRecipe, type ComponentInput, type ResolvedRecipe } from './resolve.ts';
import type { Recipe } from '../../schemas/recipe.ts';
import type { Ingredient } from '../../schemas/ingredient.ts';
import type { CatalogRecord } from '../plan/types.ts';

/**
 * One resolved view of the whole site, loaded once and shared by every page.
 *
 * Astro keeps module state for the length of a build, so the content is read,
 * validated, flattened and computed a single time however many routes ask for
 * it — and every page necessarily agrees with every other, because they are
 * looking at the same objects.
 */

export interface SiteRecipe {
  slug: string;
  identity: Recipe;
  /** Default version first. */
  versions: { id: string; resolved: ResolvedRecipe }[];
  about: { summary: string; sources: any[]; body: string } | null;
  /** The default version — what the catalogue, the title and the JSON-LD use. */
  head: ResolvedRecipe;
}

export interface ImageCredit {
  slug: string;
  kind: string;
  alt: string;
  sourceUrl: string;
  title: string;
  author?: string;
  license: string;
  licenseUrl?: string;
  shareAlike: boolean;
  modified: string;
  files: Record<string, string>;
}

export interface Site {
  raw: Content;
  recipes: SiteRecipe[];
  ingredients: Ingredient[];
  credits: ImageCredit[];
  /** Ingredient slug to the recipes using it, with how much each uses. */
  usage: Map<string, { recipe: SiteRecipe; grams: number }[]>;
}

let cached: Promise<Site> | null = null;

async function build(): Promise<Site> {
  const raw = await loadContent('src/content');
  const componentInputs = new Map<string, ComponentInput>(
    raw.components.map((c) => [
      c.slug,
      { slug: c.slug, data: c.data, prose: new Map(c.steps.map((s) => [s.stepId, s.text])) },
    ]),
  );
  const ingredientIndex = new Map(raw.ingredients.map((i) => [i.slug, i.data]));

  const bySlug = new Map<string, typeof raw.recipeVersions>();
  for (const v of raw.recipeVersions) bySlug.set(v.recipe, [...(bySlug.get(v.recipe) ?? []), v]);

  const recipes: SiteRecipe[] = [];
  for (const [slug, versions] of bySlug) {
    const ordered = [...versions].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    if (ordered[0]?.data && 'draft' in ordered[0].data && ordered[0].data.draft) continue;

    const resolvedVersions = ordered.map((v) => ({
      id: v.versionId,
      resolved: resolveRecipe(
        {
          slug: v.recipe,
          versionId: v.versionId,
          data: v.data,
          prose: new Map(v.steps.map((s) => [s.stepId, s.text])),
        },
        componentInputs,
        ingredientIndex,
      ),
    }));

    const aboutEntry = raw.recipeAbout.find((a) => a.subject === slug);
    recipes.push({
      slug,
      identity: ordered[0]!.data as Recipe,
      versions: resolvedVersions,
      about: aboutEntry
        ? { ...(aboutEntry.data as any), body: aboutEntry.body }
        : null,
      head: resolvedVersions[0]!.resolved,
    });
  }
  recipes.sort((a, b) => a.identity.title.localeCompare(b.identity.title));

  const credits: ImageCredit[] = JSON.parse(
    await readFile('src/data/image-credits.json', 'utf8').catch(() => '[]'),
  );

  /*
   * Backlinks are sorted by how much of the ingredient each recipe uses, not
   * alphabetically: someone arriving with 400 g of leftover ricotta wants the
   * recipe that uses it up, and the sort key already exists in the data. §5.5.
   */
  const usage = new Map<string, { recipe: SiteRecipe; grams: number }[]>();
  for (const recipe of recipes) {
    const seen = new Map<string, number>();
    for (const line of recipe.head.lines) {
      seen.set(line.ingredient.id, (seen.get(line.ingredient.id) ?? 0) + (line.grams ?? 0));
    }
    for (const [ingredient, grams] of seen) {
      usage.set(ingredient, [...(usage.get(ingredient) ?? []), { recipe, grams }]);
    }
  }
  for (const list of usage.values()) list.sort((a, b) => b.grams - a.grams);

  return {
    raw,
    recipes,
    ingredients: raw.ingredients.map((i) => i.data),
    credits,
    usage,
  };
}

export function getSite(): Promise<Site> {
  cached ??= build();
  return cached;
}

/** The lightweight record the catalogue, reverse search and the Plan read. §8.1 */
export function catalogRecord(recipe: SiteRecipe): CatalogRecord {
  const r = recipe.head;
  return {
    slug: recipe.slug,
    title: recipe.identity.title,
    subtitle: recipe.identity.subtitle,
    style: r.label,
    tags: {
      cuisine: [...recipe.identity.tags.cuisine],
      course: [...recipe.identity.tags.course],
      method: [...recipe.identity.tags.method],
    },
    totalMin: r.timing.total,
    kcalPerServing: Math.round(r.nutrition.perServing.kcal ?? 0),
    difficulty: r.difficulty,
    diets: [...r.diet.labels, ...r.diet.freeFrom],
    allergens: [...r.diet.allergens],
    ingredients: [...new Set(r.lines.map((l) => l.ingredient.id))],
    image: recipe.identity.image?.src ?? null,
    // The ids, not a count: the Plan stores a version reference and has to be
    // able to tell whether the one it saved still exists. §8.3
    versions: recipe.versions.map((v) => ({
      id: v.id,
      label: v.resolved.label,
      defaultServings: v.resolved.defaultServings,
    })),
    nutritionEstimated: r.nutrition.estimated,
  };
}
