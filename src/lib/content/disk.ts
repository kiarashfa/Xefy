/**
 * Reads the content collections straight from disk and validates them against
 * the same Zod schemas the site build uses.
 *
 * The checks run as their own step rather than inside the Astro build so they
 * can be run alone, fail fast, and report every problem in one pass instead of
 * stopping at the first one.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'tinyglobby';
import { parse as parseYaml } from 'yaml';

import { ingredientSchema } from '../../schemas/ingredient.ts';
import { recipeSchema, recipeVersionSchema } from '../../schemas/recipe.ts';
import { componentSchema } from '../../schemas/component.ts';
import { techniqueSchema } from '../../schemas/technique.ts';
import type { Ingredient } from '../../schemas/ingredient.ts';
import type { Recipe, RecipeVersion } from '../../schemas/recipe.ts';
import type { Component } from '../../schemas/component.ts';
import type { Technique } from '../../schemas/technique.ts';

export const ROOT = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
export const DEFAULT_CONTENT = path.join(ROOT, 'src', 'content');

export const relative = (abs: string) => path.relative(ROOT, abs).split(path.sep).join('/');

export interface SchemaError {
  file: string;
  path: string;
  message: string;
}

/** One `<Step id="…">` block from an MDX body, with its prose. */
export interface StepProse {
  stepId: string;
  text: string;
  /** Offset into the file body, so a message can name a line. */
  line: number;
}

export interface LoadedRecipeVersion {
  /** Recipe slug — the directory name, and the canonical URL. */
  recipe: string;
  /** Version id: the filename without extension, or `index` for the default. */
  versionId: string;
  isDefault: boolean;
  file: string;
  data: Recipe | RecipeVersion;
  body: string;
  steps: StepProse[];
}

export interface LoadedIngredient {
  slug: string;
  file: string;
  data: Ingredient;
}

export interface LoadedComponent {
  slug: string;
  file: string;
  data: Component;
  body: string;
  steps: StepProse[];
}

export interface LoadedTechnique {
  slug: string;
  file: string;
  data: Technique;
}

export interface Content {
  recipeVersions: LoadedRecipeVersion[];
  ingredients: LoadedIngredient[];
  components: LoadedComponent[];
  techniques: LoadedTechnique[];
  schemaErrors: SchemaError[];
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function splitFrontmatter(raw: string): { data: unknown; body: string } {
  const match = raw.match(FRONTMATTER);
  if (!match) return { data: {}, body: raw };
  return { data: parseYaml(match[1]!) ?? {}, body: raw.slice(match[0].length) };
}

/**
 * Step prose is authored in the MDX body inside `<Step id="…">` blocks, keyed
 * to the structured step declared in frontmatter. Structure and prose stay in
 * the place each belongs, and neither has to restate the other.
 */
const STEP_BLOCK = /<Step\s+([^>]*?)>([\s\S]*?)<\/Step>/g;
const ID_ATTR = /\bid\s*=\s*["']([^"']+)["']/;

export function extractSteps(body: string): StepProse[] {
  const out: StepProse[] = [];
  for (const match of body.matchAll(STEP_BLOCK)) {
    const id = match[1]!.match(ID_ATTR)?.[1] ?? '';
    const before = body.slice(0, match.index ?? 0);
    out.push({
      stepId: id,
      text: match[2] ?? '',
      line: before.split('\n').length,
    });
  }
  return out;
}

function collectErrors(file: string, issues: readonly { path: PropertyKey[]; message: string }[]) {
  return issues.map((issue) => ({
    file,
    path: issue.path.map(String).join('.') || '(root)',
    message: issue.message,
  }));
}

/**
 * `contentRoot` exists so the same checks can be pointed at throwaway fixtures
 * — including deliberately broken ones — without those fixtures living
 * anywhere they might be mistaken for real catalogue entries.
 */
export async function loadContent(contentRoot: string = DEFAULT_CONTENT): Promise<Content> {
  const schemaErrors: SchemaError[] = [];
  const CONTENT = contentRoot;

  const recipeFiles = globSync('*/*.mdx', { cwd: path.join(CONTENT, 'recipes'), absolute: true });
  const recipeVersions: LoadedRecipeVersion[] = [];
  for (const abs of recipeFiles.sort()) {
    const file = relative(abs);
    const { data, body } = splitFrontmatter(await readFile(abs, 'utf8'));
    const versionId = path.basename(abs, '.mdx');
    const isDefault = versionId === 'index';
    const parsed = (isDefault ? recipeSchema : recipeVersionSchema).safeParse(data);
    if (!parsed.success) {
      schemaErrors.push(...collectErrors(file, parsed.error.issues));
      continue;
    }
    recipeVersions.push({
      recipe: path.basename(path.dirname(abs)),
      versionId,
      isDefault,
      file,
      data: parsed.data,
      body,
      steps: extractSteps(body),
    });
  }

  const ingredientFiles = globSync('*.json', {
    cwd: path.join(CONTENT, 'ingredients'),
    absolute: true,
  });
  const ingredients: LoadedIngredient[] = [];
  for (const abs of ingredientFiles.sort()) {
    const file = relative(abs);
    const parsed = ingredientSchema.safeParse(JSON.parse(await readFile(abs, 'utf8')));
    if (!parsed.success) {
      schemaErrors.push(...collectErrors(file, parsed.error.issues));
      continue;
    }
    ingredients.push({ slug: path.basename(abs, '.json'), file, data: parsed.data });
  }

  const componentFiles = globSync('*.mdx', {
    cwd: path.join(CONTENT, 'components'),
    absolute: true,
  });
  const components: LoadedComponent[] = [];
  for (const abs of componentFiles.sort()) {
    const file = relative(abs);
    const { data, body } = splitFrontmatter(await readFile(abs, 'utf8'));
    const parsed = componentSchema.safeParse(data);
    if (!parsed.success) {
      schemaErrors.push(...collectErrors(file, parsed.error.issues));
      continue;
    }
    components.push({
      slug: path.basename(abs, '.mdx'),
      file,
      data: parsed.data,
      body,
      steps: extractSteps(body),
    });
  }

  const techniqueFiles = globSync('*.mdx', {
    cwd: path.join(CONTENT, 'techniques'),
    absolute: true,
  });
  const techniques: LoadedTechnique[] = [];
  for (const abs of techniqueFiles.sort()) {
    const file = relative(abs);
    const { data } = splitFrontmatter(await readFile(abs, 'utf8'));
    const parsed = techniqueSchema.safeParse(data);
    if (!parsed.success) {
      schemaErrors.push(...collectErrors(file, parsed.error.issues));
      continue;
    }
    techniques.push({ slug: path.basename(abs, '.mdx'), file, data: parsed.data });
  }

  return { recipeVersions, ingredients, components, techniques, schemaErrors };
}
