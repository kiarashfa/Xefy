/**
 * What already exists, printed compactly.
 *
 *   node scripts/authoring/inventory.ts
 *   node scripts/authoring/inventory.ts --ingredients
 *   node scripts/authoring/inventory.ts --images
 *
 * Reuse is the rule that keeps the shopping list, the reverse search and every
 * computed figure coherent, and an author can only reuse what they know is
 * there. This exists so that list is one command rather than a paragraph pasted
 * into a task — a pasted list is stale the moment the next dish lands, and it is
 * the same list every time, paid for again on every dispatch.
 *
 * Reads `src/content` directly, because that is what exists. The catalogue plans
 * what to write and is not a record of what has been written.
 */

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const CONTENT = 'src/content';
const MANIFEST = 'src/data/image-credits.json';

const wrap = (items: string[], width = 92): string[] => {
  const lines: string[] = [];
  let line = '';
  for (const item of items) {
    if (line && line.length + item.length + 3 > width) {
      lines.push(line);
      line = '';
    }
    line += (line ? ' · ' : '') + item;
  }
  if (line) lines.push(line);
  return lines;
};

async function jsonRecords(dir: string): Promise<Array<Record<string, unknown>>> {
  const files = await readdir(path.join(CONTENT, dir)).catch(() => []);
  const out: Array<Record<string, unknown>> = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    out.push(JSON.parse(await readFile(path.join(CONTENT, dir, f), 'utf8')));
  }
  return out;
}

/** Frontmatter only, and only the keys this needs. */
async function mdxHeads(dir: string): Promise<Array<Record<string, string>>> {
  const files = await readdir(path.join(CONTENT, dir)).catch(() => []);
  const out: Array<Record<string, string>> = [];
  for (const f of files) {
    if (!f.endsWith('.mdx')) continue;
    const raw = await readFile(path.join(CONTENT, dir, f), 'utf8');
    const head: Record<string, string> = { file: f, slug: f.replace(/\.mdx$/, '') };
    for (const line of raw.split(/\r?\n/).slice(1)) {
      if (line === '---') break;
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m?.[1] && m[2]) head[m[1]] = m[2];
    }
    out.push(head);
  }
  return out;
}

/**
 * A recipe is a DIRECTORY: index.mdx, about.mdx, and one file per extra version.
 * The version count is what sizes a batch, so it is what gets printed.
 */
async function recipeDirs(): Promise<Array<{ slug: string; versions: string[] }>> {
  const dirs = await readdir(path.join(CONTENT, 'recipes'), { withFileTypes: true }).catch(() => []);
  const out: Array<{ slug: string; versions: string[] }> = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const files = await readdir(path.join(CONTENT, 'recipes', d.name)).catch(() => []);
    const versions = files
      .filter((f) => f.endsWith('.mdx') && f !== 'index.mdx' && f !== 'about.mdx')
      .map((f) => f.replace(/\.mdx$/, ''));
    out.push({ slug: d.name, versions });
  }
  return out;
}

async function main(): Promise<void> {
  const only = process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2));
  const want = (name: string): boolean => only.length === 0 || only.includes(name);

  if (want('ingredients')) {
    const records = await jsonRecords('ingredients');
    console.log(`\nINGREDIENTS (${records.length}) — id, then the Form ids on it`);
    for (const line of wrap(
      records
        .map((r) => {
          const forms = ((r['forms'] as Array<{ id: string }> | undefined) ?? []).map((f) => f.id);
          const plain = forms.length <= 1;
          return plain ? String(r['id']) : `${String(r['id'])}[${forms.join('|')}]`;
        })
        .sort(),
    )) {
      console.log('  ' + line);
    }
  }

  if (want('components')) {
    const comps = await mdxHeads('components');
    console.log(`\nCOMPONENTS (${comps.length}) — reusable step bundles. Reuse, never re-author`);
    for (const line of wrap(comps.map((c) => c['id'] ?? c['slug'] ?? '').sort())) {
      console.log('  ' + line);
    }
  }

  if (want('techniques')) {
    const techs = await mdxHeads('techniques');
    console.log(`\nTECHNIQUES (${techs.length})`);
    for (const line of wrap(techs.map((t) => t['id'] ?? t['slug'] ?? '').sort())) {
      console.log('  ' + line);
    }
  }

  if (want('recipes')) {
    const recipes = await recipeDirs();
    const total = recipes.reduce((n, r) => n + 1 + r.versions.length, 0);
    console.log(`\nDISHES ALREADY WRITTEN (${recipes.length} dishes · ${total} recipes)`);
    for (const line of wrap(
      recipes
        .map((r) => (r.versions.length ? `${r.slug}[${r.versions.join('|')}]` : r.slug))
        .sort(),
    )) {
      console.log('  ' + line);
    }
  }

  if (want('images')) {
    /**
     * What still has no photograph.
     *
     * The gap an author leaves here is not on their own dish's page — it is a
     * blank tile on the checklist of every OTHER dish that names the same
     * ingredient. So it is printed as a list of work rather than as a count.
     *
     * The manifest is an ARRAY of records carrying `slug` and `kind`, not a
     * keyed object; a record present for one kind says nothing about another.
     */
    const manifest: Array<{ slug?: string; kind?: string }> = existsSync(MANIFEST)
      ? (JSON.parse(await readFile(MANIFEST, 'utf8')) as Array<{ slug?: string; kind?: string }>)
      : [];
    const have = new Set(manifest.map((m) => `${m.kind ?? ''}:${m.slug ?? ''}`));
    const has = (kind: string, id: string): boolean => have.has(`${kind}:${id}`);

    const [ingredients, comps, recipes] = await Promise.all([
      jsonRecords('ingredients'),
      mdxHeads('components'),
      recipeDirs(),
    ]);

    const missing: Array<[string, string[]]> = [
      ['recipe', recipes.map((r) => r.slug).filter((id) => !has('recipe', id))],
      ['ingredient', ingredients.map((i) => String(i['id'])).filter((id) => !has('ingredient', id))],
      [
        'component',
        comps.map((c) => String(c['id'] ?? c['slug'] ?? '')).filter((id) => id && !has('component', id)),
      ],
    ];

    const total = missing.reduce((n, [, ids]) => n + ids.length, 0);
    console.log(`\nWITHOUT A PHOTOGRAPH (${total}) — adopt with --kind matching the heading`);
    for (const [kind, ids] of missing) {
      if (!ids.length) continue;
      console.log(`  --kind ${kind} (${ids.length})`);
      for (const line of wrap(ids.sort(), 86)) console.log('    ' + line);
    }
    if (total === 0) console.log('  Nothing. Every record on the site has one.');
  }

  console.log('\nReuse what is here. A near-duplicate poisons every figure that reads it.\n');
}

await main();
