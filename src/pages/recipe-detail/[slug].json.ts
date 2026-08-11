import type { APIRoute } from 'astro';
import { getSite } from '../../lib/content/site.ts';

/**
 * Per-recipe detail, fetched on demand by the Plan and the shopping list. §8.1
 *
 * Carries the ingredient lines and nutrition the light index deliberately
 * omits — one file per planned recipe rather than one file for the catalogue.
 */
export async function getStaticPaths() {
  const site = await getSite();
  return site.recipes.map((recipe) => ({ params: { slug: recipe.slug }, props: { recipe } }));
}

export const GET: APIRoute = ({ props }) => {
  const { recipe } = props as any;
  return new Response(
    JSON.stringify({
      slug: recipe.slug,
      title: recipe.identity.title,
      makeAhead: recipe.head.makeAhead ?? null,
      versions: recipe.versions.map((v: any) => ({
        id: v.id,
        label: v.resolved.label,
        defaultServings: v.resolved.defaultServings,
        perServing: v.resolved.nutrition.perServing,
        nutritionEstimated: v.resolved.nutrition.estimated,
        ingredients: v.resolved.lines.map((l: any) => ({
          ingredientRef: l.ingredient.id,
          name: l.ingredient.name,
          form: l.form.id,
          amount: l.line.amount,
          unit: l.line.unit,
          consumedFraction: l.line.consumedFraction,
          pantryStaple: l.ingredient.pantryStaple ?? false,
        })),
      })),
    }),
    { headers: { 'content-type': 'application/json' } },
  );
};
