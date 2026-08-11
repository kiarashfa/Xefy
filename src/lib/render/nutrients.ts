import type { Nutrient } from '../math/nutrition.ts';

/**
 * The nutrition panel's row order and units, in one place.
 *
 * Macros first in the order a label uses them, then minerals, then vitamins —
 * so an ingredient page and a recipe page never disagree about what a figure is
 * called or what unit it is in.
 */
export const NUTRIENT_ROWS: readonly [Nutrient, string, string][] = [
  ['kcal', 'Energy', ' kcal'],
  ['protein', 'Protein', ' g'],
  ['carbs', 'Carbohydrate', ' g'],
  ['sugars', 'of which sugars', ' g'],
  ['fiber', 'Fibre', ' g'],
  ['fat', 'Fat', ' g'],
  ['saturatedFat', 'of which saturates', ' g'],
  ['monounsaturatedFat', 'Monounsaturated fat', ' g'],
  ['polyunsaturatedFat', 'Polyunsaturated fat', ' g'],
  ['cholesterol', 'Cholesterol', ' mg'],

  ['sodium', 'Sodium', ' mg'],
  ['potassium', 'Potassium', ' mg'],
  ['calcium', 'Calcium', ' mg'],
  ['iron', 'Iron', ' mg'],
  ['magnesium', 'Magnesium', ' mg'],
  ['phosphorus', 'Phosphorus', ' mg'],
  ['zinc', 'Zinc', ' mg'],
  ['copper', 'Copper', ' mg'],
  ['manganese', 'Manganese', ' mg'],
  ['seleniumMcg', 'Selenium', ' µg'],

  ['vitaminAMcg', 'Vitamin A', ' µg'],
  ['vitaminC', 'Vitamin C', ' mg'],
  ['vitaminDMcg', 'Vitamin D', ' µg'],
  ['vitaminE', 'Vitamin E', ' mg'],
  ['vitaminKMcg', 'Vitamin K', ' µg'],
  ['thiamin', 'Thiamin', ' mg'],
  ['riboflavin', 'Riboflavin', ' mg'],
  ['niacin', 'Niacin', ' mg'],
  ['vitaminB6', 'Vitamin B6', ' mg'],
  ['folateMcg', 'Folate', ' µg'],
  ['vitaminB12Mcg', 'Vitamin B12', ' µg'],
  ['choline', 'Choline', ' mg'],
];
