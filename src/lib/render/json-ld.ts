import type { SiteRecipe } from '../content/site.ts';
import { renderProse } from './prose.ts';

/**
 * Schema.org Recipe structured data. §14.3
 *
 * Generated from the **default version** and from the same resolved data the
 * page renders, at the authored serving count in metric. The instruction text
 * therefore has every quantity, temperature, dimension and duration resolved to
 * a literal — the live components on the page are a display layer over these
 * same numbers, so the two cannot disagree by construction.
 */

const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

/** ISO 8601 duration, which is what Google reads for cook and prep times. */
const iso = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : h ? '' : '0M'}`;
};

export function recipeJsonLd(recipe: SiteRecipe, origin: string, base: string): string {
  const r = recipe.head;
  const url = `${origin}${base}recipes/${recipe.slug}/`;
  const servings = r.defaultServings;

  const names = recipe.identity.names;
  /*
   * `alternateName` and `keywords` take genuine alternative names and
   * transliterations. Never a misspelling, and never a `notToBeConfusedWith`
   * entry — asserting one of those as an alternate name would claim the exact
   * opposite of what the field means.
   */
  const alternates = names.alsoKnownAs.map((n) => n.name);
  const keywords = [...alternates, ...names.searchOnly];

  const nutrition = r.nutrition.perServing;
  const round = (n: number | undefined, unit: string) =>
    n == null ? undefined : `${Math.round(n)} ${unit}`;

  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: recipe.identity.title,
    description: recipe.identity.description ?? recipe.identity.subtitle,
    url,
    ...(alternates.length ? { alternateName: alternates } : {}),
    ...(keywords.length ? { keywords: keywords.join(', ') } : {}),
    ...(recipe.identity.image ? { image: [`${origin}${base}${recipe.identity.image.src}`] } : {}),
    recipeCategory: recipe.identity.tags.course.join(', '),
    recipeCuisine: recipe.identity.tags.cuisine.join(', '),
    recipeYield: `${servings} servings`,
    totalTime: iso(r.timing.total),
    ...(r.timing.prep > 0 ? { prepTime: iso(r.timing.prep) } : {}),
    ...(r.timing.cook > 0 ? { cookTime: iso(r.timing.cook) } : {}),
    recipeIngredient: r.lines.map((line) => {
      const amount =
        line.line.unit === 'g'
          ? `${Math.round(line.line.amount)} g`
          : `${Math.round(line.line.amount)} ml`;
      return `${amount} ${line.ingredient.name}${line.line.note ? `, ${line.line.note}` : ''}`;
    }),
    recipeInstructions: r.flat.steps.map((step) => ({
      '@type': 'HowToStep',
      name: `Step ${step.number}`,
      text: plain(renderProse(step.prose, { recipe: r, servings, system: 'metric' })),
    })),
    nutrition: {
      '@type': 'NutritionInformation',
      servingSize: '1 serving',
      calories: round(nutrition.kcal, 'kcal'),
      proteinContent: round(nutrition.protein, 'g'),
      carbohydrateContent: round(nutrition.carbs, 'g'),
      fatContent: round(nutrition.fat, 'g'),
      ...(nutrition.fiber != null ? { fiberContent: round(nutrition.fiber, 'g') } : {}),
      ...(nutrition.sodium != null ? { sodiumContent: round(nutrition.sodium, 'mg') } : {}),
    },
  };

  // A false-friend note is the natural carrier for this field: it says what the
  // dish is *not*, which is exactly what disambiguation means.
  const falseFriend = names.notToBeConfusedWith[0];
  if (falseFriend) {
    data.disambiguatingDescription = `Not to be confused with ${falseFriend.name}: ${falseFriend.note}`;
  }

  return JSON.stringify(data);
}
