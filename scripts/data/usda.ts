#!/usr/bin/env node
/**
 * Nutrition data from USDA FoodData Central.
 *
 * Two things this script is careful about.
 *
 * **The cache is the read path, not a fallback.** Fetched records are written
 * into `src/data/nutrition-sources/` and committed, so a build never depends on
 * the API being up or on anyone holding a key. The key is needed to *add* an
 * ingredient and never to build the site.
 *
 * **It proposes, it does not decide.** Which food record describes the
 * ingredient, and which household measure represents it, are judgment calls —
 * "1 cup basil, chopped" and "1 cup basil leaves, whole" are different foods to
 * a cook. The script surfaces the candidates and the author picks.
 *
 * Usage:
 *   node scripts/data/usda.ts search "basil"
 *   node scripts/data/usda.ts fetch 172232
 *   node scripts/data/usda.ts form 172232 --id fresh --label Fresh
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { convertAmount, ENERGY_NUMBERS, NUTRIENT_MAP, REQUIRED_FIELDS } from './usda-nutrients.ts';
import type { NutritionPer100g } from '../../src/schemas/primitives.ts';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CACHE_DIR = path.join(ROOT, 'src', 'data', 'nutrition-sources');
const API = 'https://api.nal.usda.gov/fdc/v1';

/** Whole-food datasets. Branded records describe products, not ingredients. */
const INGREDIENT_DATA_TYPES = 'Foundation,SR Legacy';

export interface DensityCandidate {
  measure: 'gPerCup' | 'gPerTbsp' | 'gPerTsp';
  value: number;
  /** The USDA portion this came from, so the choice can be reviewed. */
  from: string;
}

export interface CachedRecord {
  /** Cited on every Form that uses this record (§16). */
  sourceDataset: string;
  sourceId: string;
  sourceUrl: string;
  description: string;
  category?: string | undefined;
  publicationDate?: string | undefined;
  /** When this cache entry was written, so staleness is visible. */
  retrieved: string;
  nutritionPer100g: NutritionPer100g;
  /** Nutrients present in the source that we do not model, for transparency. */
  unmapped: { number: string; name: string; amount: number; unit: string }[];
  /** Reported in a unit that cannot be converted without inventing a factor. */
  skipped: { number: string; name: string; unit: string }[];
  densityCandidates: DensityCandidate[];
}

function requireKey(): string {
  try {
    process.loadEnvFile();
  } catch {
    // No .env is fine if the variable is already in the environment.
  }
  const key = process.env.USDA_FDC_API_KEY;
  if (!key) {
    console.error(
      'USDA_FDC_API_KEY is not set. Put it in a .env file at the repo root:\n' +
        '  USDA_FDC_API_KEY=your-key-here\n' +
        'Write the file as UTF-8 — a UTF-16 .env parses as garbage.',
    );
    process.exit(1);
  }
  return key;
}

/** An expected failure — printed as a sentence rather than as a stack trace. */
class UsdaError extends Error {}

async function api(pathname: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${API}${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('api_key', requireKey());

  const res = await fetch(url);
  if (res.status === 429) {
    throw new Error('USDA rate limit reached (3,600/hour). Wait and try again.');
  }
  // The search index and the detail endpoint do not always agree: search
  // returns records the detail endpoint will not serve. That is a dead
  // candidate rather than a fault to investigate, so say so and move on.
  if (res.status === 404) {
    throw new UsdaError(
      'USDA has no record at that id. The search index sometimes lists records ' +
        'the detail endpoint does not serve — take the next candidate.',
    );
  }
  if (!res.ok) throw new UsdaError(`USDA responded ${res.status} ${res.statusText}`);
  return res.json();
}

/* ------------------------------------------------------------------ *
 * Mapping
 * ------------------------------------------------------------------ */

interface RawNutrient {
  nutrient?: { number?: string; name?: string; unitName?: string };
  amount?: number;
}

interface RawFood {
  fdcId: number;
  description: string;
  dataType?: string;
  publicationDate?: string;
  foodCategory?: { description?: string };
  foodNutrients?: RawNutrient[];
  foodPortions?: { amount?: number; gramWeight?: number; modifier?: string }[];
}

function mapNutrition(food: RawFood): Pick<CachedRecord, 'nutritionPer100g' | 'unmapped' | 'skipped'> {
  const byNumber = new Map(NUTRIENT_MAP.map((m) => [m.number, m]));
  const nutrition: Record<string, number> = {};
  const unmapped: CachedRecord['unmapped'] = [];
  const skipped: CachedRecord['skipped'] = [];

  // Energy is the one field several numbers compete for, so it is resolved by
  // preference rather than by whichever happens to be read last.
  const reported = new Map(
    (food.foodNutrients ?? [])
      .filter((e) => e.nutrient?.number && e.amount != null)
      .map((e) => [e.nutrient!.number!, e]),
  );
  const energyNumber = ENERGY_NUMBERS.find((n) => reported.has(n));

  for (const entry of food.foodNutrients ?? []) {
    const number = entry.nutrient?.number;
    const amount = entry.amount;
    // Category headers ("Proximates") carry no amount.
    if (!number || amount == null) continue;
    // Skip the energy figures that lost the preference contest.
    if (ENERGY_NUMBERS.includes(number) && number !== energyNumber) continue;

    const mapping = byNumber.get(number);
    if (!mapping) {
      unmapped.push({
        number,
        name: entry.nutrient?.name ?? '',
        amount,
        unit: entry.nutrient?.unitName ?? '',
      });
      continue;
    }

    const converted = convertAmount(amount, entry.nutrient?.unitName ?? '', mapping);
    if (converted == null) {
      skipped.push({ number, name: mapping.label, unit: entry.nutrient?.unitName ?? '' });
      continue;
    }
    // Round hard at the source's own precision; the figures are per 100 g and
    // more decimals than this would be noise dressed as accuracy.
    nutrition[mapping.field] = Math.round(converted * 1000) / 1000;
  }

  return {
    nutritionPer100g: nutrition as unknown as NutritionPer100g,
    unmapped,
    skipped,
  };
}

/**
 * Reads real densities out of the household measures USDA publishes.
 *
 * This matters more than it looks: §5.3 only permits an estimated density where
 * no direct source exists, and a `gramWeight` for "1 cup, chopped" is exactly
 * such a source. Every candidate found here is one fewer estimate on the page.
 */
function densityCandidates(food: RawFood): DensityCandidate[] {
  const out: DensityCandidate[] = [];
  for (const portion of food.foodPortions ?? []) {
    const grams = portion.gramWeight;
    const amount = portion.amount;
    const modifier = (portion.modifier ?? '').toLowerCase();
    if (!grams || !amount) continue;

    // Order matters: "tbsp" must be tested before "tsp" would ever match, and
    // a modifier naming a fraction of a cup is still a cup measure.
    const measure = modifier.includes('cup')
      ? 'gPerCup'
      : modifier.includes('tbsp') || modifier.includes('tablespoon')
        ? 'gPerTbsp'
        : modifier.includes('tsp') || modifier.includes('teaspoon')
          ? 'gPerTsp'
          : null;
    if (!measure) continue;

    out.push({
      measure,
      value: Math.round((grams / amount) * 100) / 100,
      from: `${amount} ${portion.modifier ?? ''}`.trim(),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Cache
 * ------------------------------------------------------------------ */

const cachePath = (fdcId: string | number) => path.join(CACHE_DIR, `usda-${fdcId}.json`);

export async function readCached(fdcId: string | number): Promise<CachedRecord | null> {
  try {
    return JSON.parse(await readFile(cachePath(fdcId), 'utf8')) as CachedRecord;
  } catch {
    return null;
  }
}

/** The cache is consulted first; the network is only for what is missing. */
export async function fetchRecord(fdcId: string | number, refresh = false): Promise<CachedRecord> {
  if (!refresh) {
    const cached = await readCached(fdcId);
    if (cached) return cached;
  }

  const food = (await api(`/food/${fdcId}`, {})) as RawFood;
  const record: CachedRecord = {
    sourceDataset: `USDA FDC ${food.dataType ?? ''}`.trim(),
    sourceId: String(food.fdcId),
    sourceUrl: `https://fdc.nal.usda.gov/food-details/${food.fdcId}/nutrients`,
    description: food.description,
    category: food.foodCategory?.description,
    publicationDate: food.publicationDate,
    retrieved: new Date().toISOString().slice(0, 10),
    ...mapNutrition(food),
    densityCandidates: densityCandidates(food),
  };

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePath(fdcId), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

async function search(query: string): Promise<void> {
  const result = (await api('/foods/search', {
    query,
    dataType: INGREDIENT_DATA_TYPES,
    pageSize: '15',
  })) as { totalHits?: number; foods?: RawFood[] };

  console.log(`${result.totalHits ?? 0} matches for "${query}" — showing the closest:\n`);
  for (const food of result.foods ?? []) {
    console.log(`  ${String(food.fdcId).padEnd(10)} ${(food.dataType ?? '').padEnd(11)} ${food.description}`);
  }
  console.log(
    '\nFoundation records are more recently sampled than SR Legacy; prefer them where the food matches.' +
      '\nThen: node scripts/data/usda.ts fetch <fdcId>',
  );
}

async function show(fdcId: string, refresh: boolean): Promise<void> {
  const record = await fetchRecord(fdcId, refresh);
  const cached = !refresh && (await readCached(fdcId));

  console.log(`${record.description}`);
  console.log(`${record.sourceDataset} · record ${record.sourceId} · published ${record.publicationDate ?? 'unknown'}`);
  console.log(`${cached ? 'From the local cache' : 'Fetched and cached'}: src/data/nutrition-sources/usda-${fdcId}.json\n`);

  console.log('Per 100 g:');
  // Several nutrient numbers map onto one field — the three energy figures in
  // particular — so print each field once.
  const shown = new Set<string>();
  for (const mapping of NUTRIENT_MAP) {
    const value = record.nutritionPer100g[mapping.field];
    if (value == null || shown.has(mapping.field)) continue;
    shown.add(mapping.field);
    const unit = mapping.unit === 'kcal' ? 'kcal' : mapping.unit === 'ug' ? 'µg' : mapping.unit;
    console.log(`  ${mapping.label.padEnd(30)} ${String(value).padStart(9)} ${unit}`);
  }

  // A record missing a macro cannot back a Form, and the failure would
  // otherwise surface much later as a schema error on a half-written
  // ingredient. Foundation records are the usual culprit: more recently
  // sampled, and frequently carrying only part of the panel.
  const missing = REQUIRED_FIELDS.filter((f) => record.nutritionPer100g[f] == null);
  if (missing.length > 0) {
    console.log(
      `\nINCOMPLETE — this record carries no ${missing.join(', ')}.\n` +
        '  Look for an SR Legacy record of the same food, which is usually complete:\n' +
        `    node scripts/data/usda.ts search "${record.description}"`,
    );
  }

  if (record.densityCandidates.length > 0) {
    console.log('\nDensity, measured — from this record\'s own household portions:');
    for (const c of record.densityCandidates) {
      console.log(`  ${c.measure.padEnd(10)} ${String(c.value).padStart(7)} g   (from "${c.from}")`);
    }
    console.log('  Pick the measure that matches how the recipe uses it; chopped and whole differ.');
  } else {
    console.log('\nNo household portions in this record — density will have to come from a class (§5.3).');
  }

  if (record.skipped.length > 0) {
    console.log('\nReported in a unit with no honest conversion, so left out:');
    for (const s of record.skipped) console.log(`  ${s.name} (${s.unit})`);
  }
}

/** Emits the Form block to paste into an ingredient record. */
async function form(fdcId: string, id: string, label: string, density?: string): Promise<void> {
  const record = await fetchRecord(fdcId);

  const block: Record<string, unknown> = {
    id,
    label,
    sourceDataset: record.sourceDataset,
    sourceId: record.sourceId,
    sourceUrl: record.sourceUrl,
    nutritionPer100g: record.nutritionPer100g,
  };

  const chosen = density
    ? record.densityCandidates.find((c) => `${c.measure}:${c.value}` === density || c.measure === density)
    : record.densityCandidates[0];

  if (chosen) {
    block.density = { [chosen.measure]: chosen.value, densitySource: 'measured' };
  }

  console.log(JSON.stringify(block, null, 2));
  if (chosen && record.densityCandidates.length > 1) {
    console.error(
      `\n// Density taken from "${chosen.from}". Other measures in this record: ` +
        record.densityCandidates.map((c) => `${c.measure} ${c.value} g (${c.from})`).join('; ') +
        '\n// Pass --density gPerCup to choose a different one.',
    );
  }
}

async function list(): Promise<void> {
  let files: string[] = [];
  try {
    files = (await readdir(CACHE_DIR)).filter((f) => f.endsWith('.json')).sort();
  } catch {
    // No cache yet.
  }
  if (files.length === 0) {
    console.log('No cached records yet.');
    return;
  }
  console.log(`${files.length} cached record(s):\n`);
  for (const file of files) {
    const record = JSON.parse(await readFile(path.join(CACHE_DIR, file), 'utf8')) as CachedRecord;
    console.log(`  ${record.sourceId.padEnd(10)} ${record.description}`);
  }
}

/* ------------------------------------------------------------------ */

const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
};

/** The rate limit and a missing record are ordinary outcomes, not crashes. */
async function run<T>(work: Promise<T>): Promise<void> {
  try {
    await work;
  } catch (error) {
    if (error instanceof UsdaError || (error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      console.error((error as Error).message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

switch (command) {
  case 'search':
    await run(search(rest.filter((a) => !a.startsWith('--')).join(' ')));
    break;
  case 'fetch':
  case 'show':
    await run(show(rest[0]!, rest.includes('--refresh')));
    break;
  case 'form':
    await run(
      form(rest[0]!, flag('id') ?? 'default', flag('label') ?? 'Default', flag('density')),
    );
    break;
  case 'list':
    await run(list());
    break;
  default:
    console.log(
      'Nutrition data from USDA FoodData Central.\n\n' +
        '  search <query>                       find candidate records\n' +
        '  fetch|show <fdcId> [--refresh]       cache a record and print it\n' +
        '  form <fdcId> --id <id> --label <l>   emit a Form block to paste\n' +
        '             [--density gPerCup]\n' +
        '  list                                 what is already cached\n',
    );
}
