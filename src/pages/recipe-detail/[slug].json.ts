import type { APIRoute } from 'astro';
import { getSite, type SiteRecipe } from '../../lib/content/site.ts';
import { gramsPerMl } from '../../lib/math/quantity.ts';
import type { DetailLine, RecipeDetail } from '../../lib/plan/types.ts';

/**
 * Per-recipe detail, fetched on demand by the Plan and the shopping list. §8.1
 *
 * Carries the ingredient lines, timing and nutrition the light index
 * deliberately omits — one file per planned recipe rather than one file for the
 * catalogue, so the tools' data cost stays proportional to how much of the
 * catalogue a reader actually plans.
 *
 * Every field here is version-scoped, including `makeAhead`: a pressure-cooker
 * version keeps differently from an oven one, and hanging it off the recipe
 * would make the Plan's storage answer belong to whichever version happened to
 * be first.
 */
export async function getStaticPaths() {
  const site = await getSite();
  return site.recipes.map((recipe) => ({ params: { slug: recipe.slug }, props: { recipe } }));
}

export const GET: APIRoute = ({ props }) => {
  const { recipe } = props as { recipe: SiteRecipe };

  const detail: RecipeDetail = {
    slug: recipe.slug,
    title: recipe.identity.title,
    versions: recipe.versions.map(({ id, resolved }) => ({
      id,
      label: resolved.label,
      defaultServings: resolved.defaultServings,
      // Timing does not scale with portions (§3.5), so this is the dish's time
      // however many servings the Plan asks for — and the Plan must never sum
      // or scale it.
      totalMin: resolved.timing.total,
      perServing: resolved.nutrition.perServing,
      nutritionEstimated: resolved.nutrition.estimated,
      nutritionEstimateReasons: resolved.nutrition.estimateReasons,
      // Estimated density is a separate reason for an aggregate to be an
      // estimate (§5.3) from a partially-consumed ingredient (§3.4.1), and
      // §8.5 flags the whole plan on either.
      densityEstimated: resolved.lines.some((l) => l.density?.source === 'estimated'),
      makeAhead: resolved.makeAhead,
      ingredients: resolved.lines.map((l): DetailLine => {
        const gPerMl = l.density ? gramsPerMl(l.density) : null;
        return {
          ingredientRef: l.ingredient.id,
          name: l.ingredient.name,
          form: l.form.id,
          formLabel: l.form.label,
          // Where an ingredient has one Form, naming it on a shopping list adds
          // nothing; where it has several, the Form *is* the purchase.
          multiForm: l.ingredient.forms.length > 1,
          amount: l.line.amount,
          unit: l.line.unit,
          optional: l.line.optional,
          ...(gPerMl != null
            ? { gPerMl, densityEstimated: l.density?.source === 'estimated' }
            : {}),
          ...(l.form.countUnit ? { countUnit: l.form.countUnit } : {}),
        };
      }),
    })),
  };

  return new Response(JSON.stringify(detail), {
    headers: { 'content-type': 'application/json' },
  });
};
