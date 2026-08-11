import assert from 'node:assert/strict';
import { test } from 'node:test';

import { aggregateList, aggregateNutrition, displayAmount, displayName, groupList } from './aggregate.ts';
import { describeDropped, resolvePlan, totalPortions } from './resolve.ts';
import { decodePlanFragment, encodePlanFragment, shareText } from './share.ts';
import { sanitisePlan } from './store.ts';
import type { CatalogRecord, Plan, PlanItem, RecipeDetail } from './types.ts';

/**
 * The Plan is pure functions over a store, which is what makes it testable at
 * all — every figure it shows is recomputed from the catalogue, so a test needs
 * nothing but a catalogue and a plan.
 */

/* --- fixtures -------------------------------------------------------- */

const pizza: CatalogRecord = {
  slug: 'test-pizza',
  title: 'Test Pizza',
  subtitle: 'A pizza for testing.',
  style: 'Neapolitan',
  tags: { cuisine: ['italian'], course: ['main'], method: ['baked'] },
  totalMin: 90,
  kcalPerServing: 700,
  difficulty: 'Medium',
  diets: ['vegetarian'],
  allergens: ['gluten', 'milk'],
  ingredients: ['flour', 'water', 'mozzarella'],
  image: null,
  versions: [
    { id: 'index', label: 'Neapolitan', defaultServings: 2 },
    { id: 'home-oven', label: 'Home oven', defaultServings: 2 },
  ],
  nutritionEstimated: false,
};

const stew: CatalogRecord = {
  ...pizza,
  slug: 'test-stew',
  title: 'Test Stew',
  style: 'Classic',
  ingredients: ['flour', 'salt'],
  versions: [{ id: 'index', label: 'Classic', defaultServings: 4 }],
};

const catalog = [pizza, stew];

const line = (over: Partial<RecipeDetail['versions'][number]['ingredients'][number]> = {}) => ({
  ingredientRef: 'flour',
  name: 'Wheat Flour',
  form: '00',
  formLabel: 'Type 00',
  multiForm: true,
  amount: 250,
  unit: 'g' as const,
  optional: false,
  ...over,
});

const pizzaDetail: RecipeDetail = {
  slug: 'test-pizza',
  title: 'Test Pizza',
  versions: [
    {
      id: 'index',
      label: 'Neapolitan',
      defaultServings: 2,
      totalMin: 90,
      perServing: { kcal: 700, protein: 25, carbs: 90, fat: 20 },
      nutritionEstimated: false,
      nutritionEstimateReasons: [],
      densityEstimated: false,
      makeAhead: { aheadInstructions: null, freezable: true, freezeInstructions: null, reheatInstructions: null },
      ingredients: [
        line(),
        line({ ingredientRef: 'water', name: 'Water', form: 'tap', formLabel: 'Tap', multiForm: false, amount: 160, unit: 'ml' }),
        line({ ingredientRef: 'salt', name: 'Fine Sea Salt', form: 'fine', formLabel: 'Fine', multiForm: false, amount: 8 }),
      ],
    },
    {
      id: 'home-oven',
      label: 'Home oven',
      defaultServings: 2,
      totalMin: 75,
      perServing: { kcal: 690, protein: 24, carbs: 89, fat: 20 },
      nutritionEstimated: true,
      nutritionEstimateReasons: ['The tinned tomato figure is a stand-in.'],
      densityEstimated: false,
      makeAhead: { aheadInstructions: null, freezable: true, freezeInstructions: null, reheatInstructions: null },
      ingredients: [line({ amount: 260 })],
    },
  ],
};

const stewDetail: RecipeDetail = {
  slug: 'test-stew',
  title: 'Test Stew',
  versions: [
    {
      id: 'index',
      label: 'Classic',
      defaultServings: 4,
      totalMin: 120,
      perServing: { kcal: 400, protein: 30, carbs: 20, fat: 15 },
      nutritionEstimated: false,
      nutritionEstimateReasons: [],
      densityEstimated: true,
      makeAhead: { aheadInstructions: null, freezable: false, freezeInstructions: null, reheatInstructions: null },
      ingredients: [
        // The same ingredient in a *different* Form: a separate purchase.
        line({ form: 'plain', formLabel: 'Plain white', amount: 100 }),
        line({ ingredientRef: 'salt', name: 'Fine Sea Salt', form: 'fine', formLabel: 'Fine', multiForm: false, amount: 12 }),
      ],
    },
  ],
};

const details = new Map([
  ['test-pizza', pizzaDetail],
  ['test-stew', stewDetail],
]);

const item = (over: Partial<PlanItem> = {}): PlanItem => ({
  uid: 'a1',
  recipe: 'test-pizza',
  version: 'index',
  servings: 2,
  day: null,
  ...over,
});

const planOf = (items: PlanItem[], over: Partial<Plan> = {}): Plan => ({
  items,
  have: [],
  needStaples: [],
  ...over,
});

const STAPLES = ['salt', 'water'];

/* --- resolution ------------------------------------------------------ */

test('an item whose recipe has gone is dropped and reported', () => {
  const { items, dropped } = resolvePlan(
    planOf([item(), item({ uid: 'b2', recipe: 'test-gone' })]),
    catalog,
  );
  assert.equal(items.length, 1);
  assert.deepEqual(
    dropped.map((d) => d.reason),
    ['recipe-gone'],
  );
  assert.match(describeDropped(dropped)!, /One saved entry was removed.*no longer on the site/);
});

test('an item whose version has gone is dropped separately from a missing recipe', () => {
  const { items, dropped } = resolvePlan(planOf([item({ version: 'wood-fired' })]), catalog);
  assert.equal(items.length, 0);
  assert.equal(dropped[0]!.reason, 'version-gone');
  assert.match(describeDropped(dropped)!, /version has been changed/);
});

test('nothing dropped means no line at all', () => {
  assert.equal(describeDropped([]), null);
});

test('the same recipe twice stays two independent entries', () => {
  const { items } = resolvePlan(
    planOf([item({ uid: 'a1', servings: 2 }), item({ uid: 'b2', servings: 6, day: 'thu' })]),
    catalog,
  );
  assert.equal(items.length, 2);
  assert.equal(totalPortions(items), 8);
});

/* --- aggregation ----------------------------------------------------- */

test('one ingredient in one Form sums across recipes, scaled by servings', () => {
  // Pizza at 4 of a default 2 → 250 × 2 = 500 g of 00 flour.
  // Stew at 4 of a default 4 → 100 g of *plain* flour, a different purchase.
  const { items } = resolvePlan(
    planOf([item({ servings: 4 }), item({ uid: 'b2', recipe: 'test-stew', servings: 4 })]),
    catalog,
  );
  const lines = aggregateList(items, details, STAPLES);

  const doubleZero = lines.find((l) => l.form === '00')!;
  assert.equal(doubleZero.total, 500);
  assert.equal(doubleZero.sources.length, 1);

  const plain = lines.find((l) => l.form === 'plain')!;
  assert.equal(plain.total, 100);
  assert.equal(displayName(plain), 'Wheat Flour (Plain white)');

  // Salt is one ingredient in one Form across both dishes: 8 × 2 + 12 = 28 g.
  const salt = lines.find((l) => l.ingredientRef === 'salt')!;
  assert.equal(salt.total, 28);
  assert.deepEqual(
    salt.sources.map((s) => `${s.title} ${s.amount}`),
    ['Test Pizza 16', 'Test Stew 12'],
  );
});

test('a line explains which planned dishes it came from', () => {
  const { items } = resolvePlan(
    planOf([item(), item({ uid: 'b2', recipe: 'test-stew', servings: 8 })]),
    catalog,
  );
  const salt = aggregateList(items, details, STAPLES).find((l) => l.ingredientRef === 'salt')!;
  assert.equal(salt.total, 8 + 24);
  assert.equal(salt.sources.length, 2);
});

test('staples, owned items and the list are three separate groups', () => {
  const { items } = resolvePlan(planOf([item()]), catalog);
  const lines = aggregateList(items, details, STAPLES);

  const plain = groupList(lines, planOf([]));
  assert.deepEqual(plain.toBuy.map((l) => l.ingredientRef), ['flour']);
  assert.deepEqual(plain.staples.map((l) => l.ingredientRef), ['water', 'salt']);
  assert.equal(plain.alreadyHave.length, 0);

  const ticked = groupList(lines, planOf([], { have: ['flour'] }));
  assert.equal(ticked.toBuy.length, 0);
  assert.deepEqual(ticked.alreadyHave.map((l) => l.ingredientRef), ['flour']);

  // One staple moved into "To buy" leaves the others where they were.
  const needed = groupList(lines, planOf([], { needStaples: ['water'] }));
  assert.deepEqual(needed.toBuy.map((l) => l.ingredientRef), ['flour', 'water']);
  assert.deepEqual(needed.staples.map((l) => l.ingredientRef), ['salt']);
});

test('a version with no detail contributes nothing rather than throwing', () => {
  const { items } = resolvePlan(planOf([item()]), catalog);
  assert.deepEqual(aggregateList(items, new Map(), STAPLES), []);
});

/* --- display --------------------------------------------------------- */

test('amounts render in the reader’s unit system, and mark an estimated density', () => {
  const { items } = resolvePlan(planOf([item()]), catalog);
  const lines = aggregateList(items, details, STAPLES);
  const flour = lines.find((l) => l.form === '00')!;

  assert.equal(displayAmount(flour, 'metric').text, '250 g');
  // No density on this Form, so US falls back to weight rather than inventing a cup.
  assert.equal(displayAmount(flour, 'us').estimated, false);

  const estimated = { ...flour, density: { gPerMl: 0.53, source: 'estimated' as const } };
  assert.equal(displayAmount(estimated, 'us').estimated, true);
  assert.equal(displayAmount(estimated, 'metric').estimated, false);
});

test('a countable Form shows the count alongside the weight', () => {
  const { items } = resolvePlan(planOf([item()]), catalog);
  const flour = aggregateList(items, details, STAPLES)[0]!;
  const eggs = { ...flour, total: 200, countUnit: { singular: 'egg', plural: 'eggs', grams: 50 } };
  assert.equal(displayAmount(eggs, 'metric').count, '4 eggs');
  assert.equal(displayAmount({ ...eggs, total: 50 }, 'metric').count, '1 egg');
});

/* --- nutrition ------------------------------------------------------- */

test('plan totals scale with servings and average across every portion', () => {
  const { items } = resolvePlan(
    planOf([item({ servings: 4 }), item({ uid: 'b2', recipe: 'test-stew', servings: 4 })]),
    catalog,
  );
  const n = aggregateNutrition(items, details);

  assert.equal(n.portions, 8);
  assert.equal(n.totals.kcal, 700 * 4 + 400 * 4);
  assert.equal(n.perPortion.kcal, (700 * 4 + 400 * 4) / 8);
});

test('one estimated input makes the whole aggregate an estimate', () => {
  const { items } = resolvePlan(planOf([item({ version: 'home-oven' })]), catalog);
  const n = aggregateNutrition(items, details);
  assert.equal(n.estimated, true);
  assert.deepEqual(n.reasons, ['The tinned tomato figure is a stand-in.']);

  // An estimated density is its own reason, and names the dish it came from.
  const stewOnly = resolvePlan(planOf([item({ recipe: 'test-stew' })]), catalog);
  const m = aggregateNutrition(stewOnly.items, details);
  assert.equal(m.estimated, true);
  assert.match(m.reasons[0]!, /Test Stew converts at least one amount using an estimated density/);
});

test('an empty plan has no portions and no division by zero', () => {
  const n = aggregateNutrition([], details);
  assert.equal(n.portions, 0);
  assert.deepEqual(n.perPortion, {});
});

/* --- sharing --------------------------------------------------------- */

test('the shared text puts the quantity first, one item per line', () => {
  const { items } = resolvePlan(planOf([item({ servings: 4 })]), catalog);
  const lines = aggregateList(items, details, STAPLES);
  const text = shareText(groupList(lines, planOf([])).toBuy, items, 'metric', 'https://example.test/');

  const rows = text.split('\n');
  assert.equal(rows[0], 'Shopping list — Xefy');
  assert.equal(rows[1], '');
  assert.equal(rows[2], '- 500 g  Wheat Flour (Type 00)');
  assert.ok(rows.includes('For: Test Pizza (4 servings)'));
  assert.equal(rows.at(-1), 'https://example.test/');
  assert.ok(!text.includes('|'), 'no markdown table structure');
});

test('an empty list still produces sendable text', () => {
  assert.match(shareText([], [], 'metric'), /- \(nothing to buy\)/);
});

/* --- the fragment ---------------------------------------------------- */

test('the fragment carries slug and servings, and the version only when it differs', () => {
  const { items } = resolvePlan(
    planOf([item({ servings: 4 }), item({ uid: 'b2', version: 'home-oven', servings: 6 })]),
    catalog,
  );
  assert.equal(encodePlanFragment(items), '#p=test-pizza:4,test-pizza:6:home-oven');
});

test('a fragment round-trips through the catalogue', () => {
  const { items } = resolvePlan(
    planOf([item({ servings: 4 }), item({ uid: 'b2', version: 'home-oven', servings: 6 })]),
    catalog,
  );
  const decoded = decodePlanFragment(encodePlanFragment(items), catalog);
  assert.deepEqual(decoded, [
    { recipe: 'test-pizza', version: 'index', servings: 4, day: null },
    { recipe: 'test-pizza', version: 'home-oven', servings: 6, day: null },
  ]);
});

test('§8.4’s two-field form is still valid input', () => {
  assert.deepEqual(decodePlanFragment('#p=test-stew:6', catalog), [
    { recipe: 'test-stew', version: 'index', servings: 6, day: null },
  ]);
});

test('an empty plan encodes to nothing rather than a bare marker', () => {
  assert.equal(encodePlanFragment([]), '');
});

test('a hostile fragment yields nothing the page can render', () => {
  const hostile = [
    '#p=<script>alert(1)</script>:4',
    '#p=../../etc/passwd:4',
    '#p=test-pizza:999999',
    '#p=test-pizza:-4',
    '#p=test-pizza:4e2',
    '#p=test-pizza:NaN',
    '#p=nonexistent-dish:4',
    '#p=',
    '#nonsense',
    '',
    '#p=test-pizza',
    `#p=${'test-pizza:2,'.repeat(500)}`,
  ];
  for (const hash of hostile) {
    for (const decoded of decodePlanFragment(hash, catalog)) {
      // Whatever survives is a real catalogue entry with a sane serving count —
      // there is no path by which a fragment introduces content of its own.
      assert.ok(catalog.some((r) => r.slug === decoded.recipe));
      assert.ok(Number.isInteger(decoded.servings) && decoded.servings >= 1 && decoded.servings <= 24);
    }
  }
  assert.equal(decodePlanFragment(`#p=${'test-pizza:2,'.repeat(500)}`, catalog).length, 40);
  assert.equal(decodePlanFragment('#p=<script>alert(1)</script>:4', catalog).length, 0);
});

/* --- what comes back out of storage ---------------------------------- */

test('a stored plan is checked field by field rather than trusted', () => {
  const restored = sanitisePlan({
    items: [
      { uid: 'a1', recipe: 'test-pizza', version: 'index', servings: 900, day: 'tue' },
      { uid: 'b2', recipe: 'test-pizza', version: 'index', servings: 2, day: 'someday' },
      { recipe: 'test-pizza', version: 'index', servings: 2, day: null },
      { recipe: 42, version: 'index', servings: 2 },
      null,
    ],
    have: ['flour', 7, null],
    needStaples: 'not-an-array',
  } as never);

  assert.equal(restored.items.length, 3);
  assert.equal(restored.items[0]!.servings, 24, 'clamped, not trusted');
  assert.equal(restored.items[1]!.day, null, 'an unknown day is dropped');
  assert.ok(restored.items[2]!.uid, 'a missing uid is generated rather than left undefined');
  assert.deepEqual(restored.have, ['flour']);
  assert.deepEqual(restored.needStaples, []);
});

test('a field this version does not know is ignored, not spread in', () => {
  const restored = sanitisePlan({ items: [], have: [], includeStaples: true } as never);
  assert.deepEqual(restored, { items: [], have: [], needStaples: [] });
});

test('nothing stored is an empty plan, not a crash', () => {
  assert.deepEqual(sanitisePlan(null), { items: [], have: [], needStaples: [] });
});
