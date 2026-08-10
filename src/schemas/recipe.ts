import { z } from 'astro/zod';
import { baseUnit, names, refId, slug } from './primitives.ts';
import { recipeTags } from './taxonomy.ts';
import { DIFFICULTIES, STEP_PHASES } from './vocabularies.ts';

/**
 * One portion of a split-use ingredient. Steps reference portions rather than
 * the parent line when an ingredient is added in more than one place, so the
 * checklist keeps a single row while the method stays specific.
 *
 * Portion amounts must sum to the parent amount; the build enforces it.
 */
export const ingredientPortion = z.object({
  id: refId,
  amount: z.number().positive(),
  note: z.string().min(1).optional(),
});

export const ingredientLine = z
  .object({
    id: refId,
    ingredientRef: slug,
    form: slug,

    /**
     * Authored in grams, or millilitres for liquids. Cups and spoons are a
     * display conversion, so scaling and nutrition never depend on a density
     * figure that might be an estimate.
     */
    amount: z.number().positive(),
    unit: baseUnit,

    /** Preparation state shown after the name, e.g. "finely chopped". */
    note: z.string().min(1).optional(),
    optional: z.boolean().default(false),

    /**
     * The eaten share of an authored amount, for things largely thrown away:
     * frying oil, marinades, brines. Applies to nutrition only — the shopping
     * and prep quantity is always the full amount, because the cook still
     * needs all of it.
     */
    consumedFraction: z.number().gt(0).max(1).default(1),
    consumedFractionNote: z.string().min(1).optional(),

    portions: z.array(ingredientPortion).min(2).optional(),

    /**
     * States why a line is never named in a step, for garnishes and
     * serve-alongside items. Its presence documents the exception the
     * unreferenced-ingredient check would otherwise warn about.
     */
    notReferencedInSteps: z.string().min(1).optional(),
  })
  .superRefine((line, ctx) => {
    if (line.consumedFraction < 1 && !line.consumedFractionNote) {
      ctx.addIssue({
        code: 'custom',
        path: ['consumedFractionNote'],
        message:
          'a partially-consumed line must explain why, since the reason is surfaced beside the estimated nutrition figures',
      });
    }
    if (line.portions) {
      const seen = new Set<string>();
      for (const [i, p] of line.portions.entries()) {
        if (seen.has(p.id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['portions', i, 'id'],
            message: `duplicate portion id "${p.id}"`,
          });
        }
        seen.add(p.id);
      }
    }
  });

export type IngredientLine = z.infer<typeof ingredientLine>;

/**
 * `active` counts toward Prep or Cook, `passive` toward Rest, and
 * `parallel-with:<stepId>` runs alongside another step so only the longer of
 * the pair reaches the total.
 */
export const stepType = z
  .string()
  .regex(
    /^(active|passive|parallel-with:[a-z0-9]+(?:-[a-z0-9]+)*)$/,
    'must be "active", "passive", or "parallel-with:<stepId>"',
  );

export const inlineStep = z
  .object({
    /**
     * Required on every step, not only on parallel targets: `<Dur>` resolves
     * against it, and ids must survive the renumbering that transclusion
     * causes, so they cannot be derived from position.
     */
    id: refId,
    durationMin: z.number().min(0),
    type: stepType,
    phase: z.enum(STEP_PHASES).optional(),
  })
  .superRefine((step, ctx) => {
    const isPassive = step.type === 'passive';
    const isParallel = step.type.startsWith('parallel-with:');

    if (!isPassive && step.phase == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['phase'],
        message: 'an active step must declare whether its time is prep or cook',
      });
    }
    // A concurrent step may be waiting rather than working — "meanwhile, let
    // the sauce settle" — and the type field is already spent naming what it
    // runs alongside, so its phase is where that gets said.
    if (!isPassive && !isParallel && step.phase === 'rest') {
      ctx.addIssue({
        code: 'custom',
        path: ['phase'],
        message: 'rest is the phase for passive time; an active step belongs in prep or cook',
      });
    }
    if (isPassive && step.phase != null && step.phase !== 'rest') {
      ctx.addIssue({
        code: 'custom',
        path: ['phase'],
        message: 'passive time always counts as rest',
      });
    }
  });

/**
 * A reference to a reusable bundle of steps and ingredients. Its content is
 * flattened into this recipe at build time, so the reader never leaves the page.
 */
export const componentStep = z.object({
  componentRef: slug,
  /**
   * Scales the Component's own base amounts before the merge — "one and a half
   * batches of béchamel". The reader's serving scale multiplies on top of the
   * merged result.
   */
  multiplier: z.number().positive().default(1),
});

export const stepEntry = z.union([componentStep, inlineStep]);
export type StepEntry = z.infer<typeof stepEntry>;
export type InlineStep = z.infer<typeof inlineStep>;
export type ComponentStep = z.infer<typeof componentStep>;

export const isComponentStep = (s: StepEntry): s is ComponentStep => 'componentRef' in s;

/** Dish-specific and authoritative, unlike the browsing-level list on an ingredient page. */
export const recipeSubstitution = z.object({
  /** The ingredient line id this applies to. */
  lineRef: refId,
  substitute: z.string().min(1),
  ratio: z.string().min(1),
  note: z.string().min(1),
  impact: z
    .object({
      flavor: z.string().min(1).optional(),
      texture: z.string().min(1).optional(),
      color: z.string().min(1).optional(),
    })
    .default({}),
});

/**
 * Two purpose-typed categories, capped. Generic taste-preference caveats are
 * out of scope: the recipe states one way to make the dish.
 */
export const recipeNotes = z
  .object({
    techniqueRationale: z
      .array(z.object({ stepId: refId.optional(), text: z.string().min(1) }))
      .max(2)
      .default([]),
    commonPitfalls: z
      .array(z.object({ stepId: refId.optional(), text: z.string().min(1) }))
      .max(2)
      .default([]),
  })
  .default({ techniqueRationale: [], commonPitfalls: [] });

/** Null means genuinely not applicable to this dish, rather than not yet written. */
export const makeAhead = z.object({
  aheadInstructions: z.string().min(1).nullable(),
  freezable: z.boolean().nullable(),
  freezeInstructions: z.string().min(1).nullable(),
  reheatInstructions: z.string().min(1).nullable(),
});

/**
 * Everything scoped to one version of a dish. Shared by the default version
 * (`index.mdx`) and any sibling versions.
 */
export const recipeVersionFields = {
  /**
   * What makes this version this version — "Neapolitan", "Home oven",
   * "Pressure cooker". Free text, shown as the Style fact, and the tab name
   * where a dish has more than one. Never restates the dish name.
   */
  label: z.string().min(1),

  defaultServings: z.number().int().positive(),
  ingredients: z.array(ingredientLine).min(1),
  steps: z.array(stepEntry).min(1),

  /** Editorial judgment, shown as such alongside the computed signals. */
  difficulty: z.enum(DIFFICULTIES),

  makeAhead,
  substitutions: z.array(recipeSubstitution).default([]),
  notes: recipeNotes,
};

/**
 * A non-default version. Identity — title, naming, tags, imagery — belongs to
 * the recipe and is not repeated here, because a repeated field is a field
 * that can disagree with itself.
 */
export const recipeVersionSchema = z.object(recipeVersionFields);

/** The recipe's identity, carried by its default version. */
export const recipeSchema = z.object({
  ...recipeVersionFields,

  title: z.string().min(1),
  /** The italic serif line under the title. One sentence. */
  subtitle: z.string().min(1),
  /** Meta description and catalogue summary; falls back to the subtitle when absent. */
  description: z.string().min(1).optional(),

  names,
  tags: recipeTags,

  image: z
    .object({
      src: z.string().min(1),
      alt: z.string().min(1),
    })
    .optional(),

  relatedRecipes: z.array(slug).default([]),
  draft: z.boolean().default(false),
});

export type Recipe = z.infer<typeof recipeSchema>;
export type RecipeVersion = z.infer<typeof recipeVersionSchema>;
