/**
 * What to write next, taken from the plan and from what already exists.
 *
 *   node scripts/authoring/next.ts             # the next 3 recipes
 *   node scripts/authoring/next.ts 6           # the next 6
 *   node scripts/authoring/next.ts 3 --family stuffed-leaves
 *   node scripts/authoring/next.ts 5 --cuisine japanese
 *   node scripts/authoring/next.ts --plan      # every remaining batch, in order
 *
 * **Recipes, not rows.** A dish with three version tabs is three recipes: three
 * ingredient lists, three sets of steps, three sets of computed figures. Sizing a
 * batch by rows makes one batch three times the size of another and nobody
 * notices until the work is done.
 *
 * **Batches are coherent, by family first and by cuisine + course second.** All
 * the kebabs in one hand produces consistent treatment of what is genuinely one
 * subject seen from many directions, and it reuses the ingredient records the
 * previous dish created rather than re-deriving them. A family is the stronger
 * grouping because `families.csv` asserts the relationship explicitly; where a
 * dish belongs to none, cuisine + course is the next best claim that two dishes
 * share ingredients and technique.
 *
 * **Progress is derived, never stored.** `dishes.csv` carries a `note` column
 * that says "WRITTEN" on some rows; it is not read here, because a note is a
 * record someone has to remember to update and `src/content/` is the truth.
 *
 * Reads `catalogue/`, which is editorial planning and is not part of the build —
 * this prints what to write and asserts nothing about what ships. It exits with a
 * message rather than a stack trace where the folder is absent.
 */

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const CATALOGUE = 'catalogue';
const CONTENT = 'src/content';

interface Row {
  slug: string;
  name: string;
  cuisine: string;
  region: string;
  course: string;
  method: string;
  tier: number;
  versions: number;
  keyIngredient: string;
  note: string;
  family: string;
  familyLabel: string;
  familyRole: string;
}

const clean = (v: string | undefined): string => (v && v !== '-' ? v : '');

/**
 * The catalogue's format invariant is that no field contains a comma, so a plain
 * split is correct and a CSV parser would be a dependency buying nothing. Its own
 * validator fails on a stray comma, which from here would look like a short row.
 */
async function readCsv(file: string): Promise<string[][]> {
  const raw = await readFile(path.join(CATALOGUE, file), 'utf8');
  return raw
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter((l) => l.trim())
    .map((line) => line.split(','));
}

/** family_id,family_label,member_slug,role,derived_from,note */
async function familyOf(): Promise<Map<string, { id: string; label: string; role: string }>> {
  const out = new Map<string, { id: string; label: string; role: string }>();
  if (!existsSync(path.join(CATALOGUE, 'families.csv'))) return out;
  for (const f of await readCsv('families.csv')) {
    const member = clean(f[2]);
    if (!member || out.has(member)) continue;
    out.set(member, { id: clean(f[0]), label: clean(f[1]), role: clean(f[3]) });
  }
  return out;
}

/** slug,name,cuisine,cuisine_alt,region,course,course_alt,method,tier,versions,key_ingredient,note */
async function rows(): Promise<Row[]> {
  const fams = await familyOf();
  return (await readCsv('dishes.csv')).map((f) => {
    const slug = clean(f[0]);
    const fam = fams.get(slug);
    return {
      slug,
      name: clean(f[1]),
      cuisine: clean(f[2]),
      region: clean(f[4]),
      course: clean(f[5]),
      method: clean(f[7]),
      tier: Number(clean(f[8]) || '9'),
      versions: Number(clean(f[9]) || '1'),
      keyIngredient: clean(f[10]),
      note: clean(f[11]),
      family: fam?.id ?? '',
      familyLabel: fam?.label ?? '',
      familyRole: fam?.role ?? '',
    };
  });
}

const written = async (): Promise<Set<string>> => {
  const dirs = await readdir(path.join(CONTENT, 'recipes'), { withFileTypes: true }).catch(() => []);
  return new Set(dirs.filter((d) => d.isDirectory()).map((d) => d.name));
};

const componentsOnSite = async (): Promise<Set<string>> => {
  const files = await readdir(path.join(CONTENT, 'components')).catch(() => []);
  return new Set(files.filter((f) => f.endsWith('.mdx')).map((f) => f.replace(/\.mdx$/, '')));
};

/** The grouping key: an explicit family beats an inferred cuisine + course. */
const groupKey = (r: Row): string => (r.family ? `f:${r.family}` : `c:${r.cuisine}/${r.course}`);

/**
 * Group the remaining plan into batches of about `size` recipes.
 *
 * A dish is never split across two batches: its tabs are variations on one
 * subject and separating them is how two tabs of one dish end up written to two
 * different conventions. A dish whose own tab count exceeds the size is therefore
 * a batch on its own.
 *
 * Within a group this packs rather than truncating — it takes the next dishes
 * that FIT and leaves the ones that do not for a later batch — so a batch comes
 * out at the requested size instead of two recipes under it or three over.
 */
function batches(remaining: Row[], size: number): Row[][] {
  const order = [...remaining].sort(
    (a, b) =>
      a.tier - b.tier ||
      // an explicit family first: it is the stronger claim of coherence
      Number(!a.family) - Number(!b.family) ||
      groupKey(a).localeCompare(groupKey(b)) ||
      a.slug.localeCompare(b.slug),
  );

  const out: Row[][] = [];
  const pool = [...order];

  while (pool.length) {
    const first = pool.shift()!;
    const batch = [first];
    let count = Math.max(1, first.versions);

    // Only from the same tier and group, and only what still fits.
    for (let i = 0; i < pool.length && count < size; ) {
      const row = pool[i]!;
      if (row.tier !== first.tier || groupKey(row) !== groupKey(first)) break;
      if (count + Math.max(1, row.versions) > size) {
        i += 1;
        continue;
      }
      batch.push(row);
      count += Math.max(1, row.versions);
      pool.splice(i, 1);
    }
    out.push(batch);
  }
  return out;
}

const recipes = (batch: Row[]): number => batch.reduce((n, r) => n + Math.max(1, r.versions), 0);

function describe(batch: Row[]): string[] {
  const lines: string[] = [];
  const first = batch[0]!;
  // "catalogue family" and not just "family": there is no `family` field, no
  // families collection and no family page in Xefy — it is a grouping in
  // catalogue/families.csv and nothing else. An agent told its dish "is in the
  // cured-raw-seafood family" correctly went looking for the field, found
  // nothing, and had to report the dispatch was wrong. Say what it is here.
  const group = first.family
    ? `catalogue family ${first.family}${first.familyLabel ? ` (${first.familyLabel})` : ''} — grouping only, not a field`
    : `${first.cuisine || 'no cuisine'} · ${first.course || 'no course'}`;
  lines.push(
    `  ${recipes(batch)} recipe${recipes(batch) === 1 ? '' : 's'}` +
      ` · ${batch.length} dish${batch.length === 1 ? '' : 'es'}` +
      ` · tier ${first.tier}` +
      ` · ${group}`,
  );
  for (const r of batch) {
    const tabs = r.versions > 1 ? ` (${r.versions} tabs)` : '';
    const where = [r.cuisine, r.region].filter(Boolean).join(' / ');
    lines.push(`    ${r.slug}${tabs} — ${r.name} · ${r.method || 'no method'} · ${where}`);
    if (r.keyIngredient) lines.push(`      key: ${r.keyIngredient}`);
    if (r.note) lines.push(`      note: ${r.note}`);
  }
  return lines;
}

async function main(): Promise<void> {
  if (!existsSync(CATALOGUE)) {
    console.log(`\nNo ${CATALOGUE}/ here. It is editorial planning and is not part of a clone.\n`);
    return;
  }

  const args = process.argv.slice(2);
  const size = Number(args.find((a) => /^\d+$/.test(a)) ?? '3');
  const onlyFamily = args.includes('--family') ? args[args.indexOf('--family') + 1] : null;
  const onlyCuisine = args.includes('--cuisine') ? args[args.indexOf('--cuisine') + 1] : null;
  const wholePlan = args.includes('--plan');

  const [all, done, components] = await Promise.all([rows(), written(), componentsOnSite()]);
  // Components are the orchestrator's to write, never an agent's, and a batch
  // that needs one which does not exist is not dispatchable. The count is
  // printed so the gap is visible before the agent is flown, not after.
  let remaining = all.filter((r) => !done.has(r.slug));
  if (onlyFamily) remaining = remaining.filter((r) => r.family === onlyFamily);
  if (onlyCuisine) remaining = remaining.filter((r) => r.cuisine === onlyCuisine);

  const grouped = batches(remaining, size);
  const filter = onlyFamily
    ? ` in family "${onlyFamily}"`
    : onlyCuisine
      ? ` in cuisine "${onlyCuisine}"`
      : '';

  console.log(
    `\n${done.size} of ${all.length} planned dishes written.` +
      ` ${remaining.length} remaining${filter},` +
      ` ~${recipes(remaining)} recipes.`,
  );
  console.log(`${components.size} Components exist. They are yours to write, never an agent's.`);

  const show = wholePlan ? grouped : grouped.slice(0, 1);
  for (const [i, batch] of show.entries()) {
    console.log(`\nBATCH ${i + 1}`);
    for (const line of describe(batch)) console.log(line);
  }

  if (!wholePlan && grouped.length > 1) {
    console.log(`\n${grouped.length - 1} further batches. Pass --plan to see them all.`);
  }
  console.log('');
}

await main();
