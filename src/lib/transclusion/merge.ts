/**
 * The ingredient merge rule. §4.5 rule 1, §8.4 rule 1
 *
 * Two callers, one rule. Transclusion merges a Component's flour into the
 * parent's; the shopping list merges one recipe's flour into another's. §8.4
 * states outright that these are the same operation over different inputs, and
 * two implementations of it would eventually disagree about which Forms count
 * as one purchase — on one page and not the other, which is the worst way for
 * it to go wrong.
 *
 * It lives in its own module rather than inside `flatten.ts` for a second
 * reason: the shopping list runs in the browser, and `flatten.ts` reaches the
 * content schemas, which reach Zod. Importing the rule from there shipped a
 * 77 kB validator to every reader of the Plan to do arithmetic that needs none.
 */

/** `self` for the recipe; a component slug, suffixed by occurrence when repeated. */
export type SourceKey = string;

/**
 * Ingredient *and* form. Fresh basil and dried basil are different lines with
 * different nutrition, and merging on the ingredient alone would apply one
 * Form's figures to both. Neither an id nor a source key can contain a space,
 * so the composite key is unambiguous.
 */
export const groupKey = (ingredientRef: string, form: string) => `${ingredientRef} ${form}`;

/** One source's contribution to a line, with its own multiplier already in. */
export interface MergeInput<L> {
  sourceKey: SourceKey;
  line: L;
  amount: number;
}

export interface MergeGroup<L> {
  ingredientRef: string;
  form: string;
  unit: 'g' | 'ml';
  /** The sum in the base unit. Pure addition, so no conversion error accrues. */
  total: number;
  /** In the order the sources contributed. */
  contributions: MergeInput<L>[];
  /** Whichever source put the most in; a token amount should not set the terms. */
  largest: MergeInput<L>;
}

/**
 * Groups contributions by ingredient and form, and sums them in base units.
 *
 * Groups come back in the order their first contribution arrived, so a caller
 * that cares about authored order gets it without sorting.
 */
export function mergeByForm<L extends { ingredientRef: string; form: string; unit: 'g' | 'ml' }>(
  inputs: readonly MergeInput<L>[],
): MergeGroup<L>[] {
  const groups = new Map<string, MergeInput<L>[]>();
  for (const input of inputs) {
    const key = groupKey(input.line.ingredientRef, input.line.form);
    groups.set(key, [...(groups.get(key) ?? []), input]);
  }

  return [...groups.values()].map((contributions) => {
    const first = contributions[0]!;
    return {
      ingredientRef: first.line.ingredientRef,
      form: first.line.form,
      unit: first.line.unit,
      total: contributions.reduce((sum, c) => sum + c.amount, 0),
      contributions,
      // Strictly greater, so a tie leaves the first contributor in charge and
      // the result does not depend on iteration order.
      largest: contributions.reduce((a, b) => (b.amount > a.amount ? b : a)),
    };
  });
}
