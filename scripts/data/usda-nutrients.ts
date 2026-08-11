import type { Nutrient } from '../../src/lib/math/nutrition.ts';

/**
 * The map from USDA nutrient numbers to the fields a Form carries.
 *
 * Keyed on `nutrient.number` rather than name: the response holds two entries
 * called "Energy", one in kilocalories and one in kilojoules, and picking by
 * name would silently take whichever came first.
 *
 * `unit` is what our schema stores. USDA reports its own unit per nutrient, so
 * the fetch converts rather than assuming the two agree.
 */
export interface NutrientMapping {
  number: string;
  field: Nutrient;
  unit: 'g' | 'mg' | 'ug' | 'kcal';
  label: string;
}

/**
 * Energy is reported under three different nutrient numbers depending on the
 * dataset, and a record may carry any combination of them. SR Legacy uses the
 * classic 208; Foundation records frequently carry only the Atwater figures,
 * which is why a Foundation record can look as though the food has no calories.
 *
 * Preference order: the directly reported value, then Atwater specific factors
 * (which vary the coefficients by food), then Atwater general factors.
 */
export const ENERGY_NUMBERS: readonly string[] = ['208', '958', '957'];

/** Without these four, nutrition cannot be computed at all. */
export const REQUIRED_FIELDS: readonly Nutrient[] = ['kcal', 'protein', 'carbs', 'fat'];

export const NUTRIENT_MAP: readonly NutrientMapping[] = [
  { number: '208', field: 'kcal', unit: 'kcal', label: 'Energy' },
  { number: '958', field: 'kcal', unit: 'kcal', label: 'Energy (Atwater specific factors)' },
  { number: '957', field: 'kcal', unit: 'kcal', label: 'Energy (Atwater general factors)' },
  { number: '203', field: 'protein', unit: 'g', label: 'Protein' },
  { number: '205', field: 'carbs', unit: 'g', label: 'Carbohydrate, by difference' },
  { number: '204', field: 'fat', unit: 'g', label: 'Total fat' },

  { number: '291', field: 'fiber', unit: 'g', label: 'Fibre, total dietary' },
  { number: '269', field: 'sugars', unit: 'g', label: 'Sugars, total' },
  { number: '606', field: 'saturatedFat', unit: 'g', label: 'Saturated fat' },
  { number: '645', field: 'monounsaturatedFat', unit: 'g', label: 'Monounsaturated fat' },
  { number: '646', field: 'polyunsaturatedFat', unit: 'g', label: 'Polyunsaturated fat' },
  { number: '605', field: 'transFat', unit: 'g', label: 'Trans fat' },
  { number: '601', field: 'cholesterol', unit: 'mg', label: 'Cholesterol' },

  { number: '307', field: 'sodium', unit: 'mg', label: 'Sodium' },
  { number: '306', field: 'potassium', unit: 'mg', label: 'Potassium' },
  { number: '301', field: 'calcium', unit: 'mg', label: 'Calcium' },
  { number: '303', field: 'iron', unit: 'mg', label: 'Iron' },
  { number: '304', field: 'magnesium', unit: 'mg', label: 'Magnesium' },
  { number: '305', field: 'phosphorus', unit: 'mg', label: 'Phosphorus' },
  { number: '309', field: 'zinc', unit: 'mg', label: 'Zinc' },
  { number: '312', field: 'copper', unit: 'mg', label: 'Copper' },
  { number: '315', field: 'manganese', unit: 'mg', label: 'Manganese' },
  { number: '317', field: 'seleniumMcg', unit: 'ug', label: 'Selenium' },

  { number: '320', field: 'vitaminAMcg', unit: 'ug', label: 'Vitamin A, RAE' },
  { number: '401', field: 'vitaminC', unit: 'mg', label: 'Vitamin C' },
  { number: '328', field: 'vitaminDMcg', unit: 'ug', label: 'Vitamin D (D2 + D3)' },
  { number: '323', field: 'vitaminE', unit: 'mg', label: 'Vitamin E (alpha-tocopherol)' },
  { number: '430', field: 'vitaminKMcg', unit: 'ug', label: 'Vitamin K (phylloquinone)' },
  { number: '404', field: 'thiamin', unit: 'mg', label: 'Thiamin' },
  { number: '405', field: 'riboflavin', unit: 'mg', label: 'Riboflavin' },
  { number: '406', field: 'niacin', unit: 'mg', label: 'Niacin' },
  { number: '415', field: 'vitaminB6', unit: 'mg', label: 'Vitamin B-6' },
  { number: '435', field: 'folateMcg', unit: 'ug', label: 'Folate, DFE' },
  { number: '418', field: 'vitaminB12Mcg', unit: 'ug', label: 'Vitamin B-12' },
  { number: '421', field: 'choline', unit: 'mg', label: 'Choline, total' },
];

const TO_GRAMS: Record<string, number> = {
  g: 1,
  mg: 1e-3,
  ug: 1e-6,
  kcal: 1,
  // Alpha-tocopherol equivalents, reported in milligrams.
  mg_ate: 1e-3,
};

const FROM_GRAMS: Record<NutrientMapping['unit'], number> = {
  g: 1,
  mg: 1e3,
  ug: 1e6,
  kcal: 1,
};

/**
 * USDA writes micrograms with the micro sign rather than "UG", and the sign
 * itself comes in two codepoints — MICRO SIGN and GREEK SMALL LETTER MU — which
 * look identical and are not equal. Normalising both is the difference between
 * capturing the micronutrients and silently dropping every one of them.
 */
function normaliseUnit(reported: string): string {
  return reported.trim().toLowerCase().replace(/[µμ]/g, 'u');
}

/**
 * Converts a reported amount into the unit our schema stores it in.
 *
 * International Units are deliberately not converted. The factor depends on the
 * compound — retinol against beta-carotene, D2 against D3 — so a single
 * multiplier would be a fabricated number, and a dropped value is better than
 * an invented one.
 */
export function convertAmount(
  amount: number,
  reportedUnit: string,
  mapping: NutrientMapping,
): number | null {
  const unit = normaliseUnit(reportedUnit);
  if (mapping.unit === 'kcal') return unit === 'kcal' ? amount : null;

  const factor = TO_GRAMS[unit];
  if (factor == null) return null;
  return amount * factor * FROM_GRAMS[mapping.unit];
}
