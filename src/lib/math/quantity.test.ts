import assert from 'node:assert/strict';
import test from 'node:test';
import { formatQuantity, gramsPerMl, toGrams, type Density } from './quantity.ts';

const measured = (gPerCup: number): Density => ({ gPerCup, source: 'measured' });

test('metric renders the authored unit, and steps up at a thousand', () => {
  assert.equal(formatQuantity(450, 'g', 'metric').text, '450 g');
  assert.equal(formatQuantity(1500, 'g', 'metric').text, '1.5 kg');
  assert.equal(formatQuantity(3000, 'ml', 'metric').text, '3 L');
});

test('a gram amount renders as US volume where a density exists', () => {
  assert.equal(formatQuantity(100, 'g', 'us', measured(100)).text, '1 cup');
});

test('a gram amount with no density falls back to weight rather than inventing a cup', () => {
  const { text, estimated } = formatQuantity(600, 'g', 'us');
  assert.equal(text, '1 ⅓ lb');
  assert.equal(estimated, false);
});

test('an estimated density is reported as estimated, in US only', () => {
  const density: Density = { gPerCup: 100, source: 'estimated' };
  assert.equal(formatQuantity(60, 'g', 'us', density).estimated, true);
  assert.equal(formatQuantity(60, 'g', 'metric', density).estimated, false);
});

/**
 * §2.1.1. Beside a count the bracketed figure is the exact weight that makes
 * the approximate count honest — not a second way to measure the ingredient.
 * Rendering it as a volume would leave the reader two estimates and no fact,
 * which is how "2 garlic cloves (1 ⅛ tbsp)" reached the page.
 */
test('a counted amount renders as mass even where the Form carries a density', () => {
  const garlic = measured(136);
  assert.equal(formatQuantity(10, 'g', 'us', garlic).text, '1 ⅛ tbsp');
  assert.equal(formatQuantity(10, 'g', 'us', garlic, true).text, '⅓ oz');
});

test('a counted amount is never marked estimated, whatever its density says', () => {
  const density: Density = { gPerCup: 100, source: 'estimated' };
  assert.equal(formatQuantity(60, 'g', 'us', density, true).estimated, false);
});

test('counting does not disturb metric, which shows the authored grams either way', () => {
  assert.equal(formatQuantity(34, 'g', 'metric', measured(100), true).text, '34 g');
});

test('gramsPerMl derives from whichever figure the record carries', () => {
  assert.equal(gramsPerMl({ gPerMl: 1, source: 'measured' }), 1);
  assert.ok(Math.abs(gramsPerMl(measured(236.5882365))! - 1) < 1e-9);
  assert.equal(gramsPerMl({ source: 'measured' }), null);
});

test('a millilitre line needs a density to reach grams, and says so rather than guessing', () => {
  assert.equal(toGrams(100, 'g'), 100);
  assert.equal(toGrams(100, 'ml'), null);
  assert.ok(Math.abs(toGrams(100, 'ml', { gPerMl: 1.15, source: 'measured' })! - 115) < 1e-9);
});
