import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatten, type ComponentSource, type FlattenSource } from './flatten.ts';

/** A boil that names its pasta, as the real Component does. */
const boil: ComponentSource = {
  slug: 'boil-pasta',
  title: 'Pasta, boiled al dente',
  ingredients: [
    { id: 'pasta', ingredientRef: 'spaghetti', form: 'dried', amount: 200, unit: 'g', optional: false, consumedFraction: 1 },
    { id: 'water', ingredientRef: 'water', form: 'tap', amount: 2000, unit: 'ml', optional: false, consumedFraction: 0.05, consumedFractionNote: 'Drained.' },
  ],
  steps: [{ id: 'boil', durationMin: 10, type: 'active', phase: 'cook' }],
  prose: new Map([['boil', 'Boil the <Qty ref="pasta"/>.']]),
};

const dish = (swap?: Record<string, { ingredientRef: string; form: string }>): FlattenSource => ({
  ingredients: [
    { id: 'cheese', ingredientRef: 'cheddar', form: 'mature', amount: 150, unit: 'g', optional: false, consumedFraction: 1 },
  ],
  steps: [
    swap ? { componentRef: 'boil-pasta', multiplier: 1, swap } : { componentRef: 'boil-pasta', multiplier: 1 },
    { id: 'melt', durationMin: 5, type: 'active', phase: 'cook' },
  ],
  prose: new Map([['melt', 'Stir in the <Qty ref="cheese"/>.']]),
});

const components = new Map([['boil-pasta', boil]]);

test('a Component line keeps its own ingredient when nothing swaps it', () => {
  const result = flatten(dish(), components);
  const pasta = result.ingredients.find((line) => line.ingredientRef === 'spaghetti');
  assert.ok(pasta, 'the Component brings its spaghetti');
});

test('a swap replaces the ingredient and form on the named line, for this use only', () => {
  const result = flatten(dish({ pasta: { ingredientRef: 'macaroni', form: 'dried' } }), components);
  assert.equal(result.ingredients.some((line) => line.ingredientRef === 'spaghetti'), false);
  const macaroni = result.ingredients.find((line) => line.ingredientRef === 'macaroni');
  assert.ok(macaroni, 'the swapped line is macaroni');
  assert.equal(macaroni.amount, 200, 'the amount is the Component’s own');
  // The Component itself is untouched for every other recipe that uses it.
  assert.equal(boil.ingredients[0]!.ingredientRef, 'spaghetti');
});

test('a swap naming a line the Component does not have fails loudly', () => {
  assert.throws(
    () => flatten(dish({ noodles: { ingredientRef: 'macaroni', form: 'dried' } }), components),
    /has no ingredient line "noodles"/,
  );
});
