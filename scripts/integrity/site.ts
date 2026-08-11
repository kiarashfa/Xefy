import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Whole-site check, run over the built output.
 *
 * The content checks in `checks.ts` validate content against its own schemas
 * before a build. This validates the *site* after one: every internal link
 * lands on a page that exists, every image resolves to a file, every same-page
 * anchor finds its target, and every page holds together as a document — one
 * `h1`, a language, unique ids, and a name on everything a keyboard can reach.
 *
 * These are the failures that survive a green content check, because none of
 * them is visible in the source of any one file. A nav item pointing at a route
 * nobody built looks fine everywhere except in a browser, and a link whose only
 * content is a decorative image looks fine to everyone who can see it.
 *
 *   node scripts/integrity/site.ts [--dist dist] [--base /Xefy]
 */

type Kind = 'link' | 'image' | 'anchor' | 'document' | 'name';

interface Finding {
  page: string;
  kind: Kind;
  target: string;
  detail: string;
}

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1]! : fallback;
};

const DIST = flag('dist', 'dist');
const BASE = flag('base', '/Xefy');

async function htmlFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await htmlFiles(full)));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const exists = async (p: string): Promise<boolean> =>
  stat(p)
    .then(() => true)
    .catch(() => false);

/** Where a URL path lands on disk: a directory means its index.html. */
async function resolveTarget(urlPath: string): Promise<string | null> {
  const withoutBase = urlPath.startsWith(BASE) ? urlPath.slice(BASE.length) : urlPath;
  const clean = decodeURIComponent(withoutBase).replace(/^\/+/, '');
  const direct = path.join(DIST, clean);

  if (await exists(direct)) {
    // A directory is only reachable if something serves its index.
    const info = await stat(direct);
    if (!info.isDirectory()) return direct;
    const index = path.join(direct, 'index.html');
    return (await exists(index)) ? index : null;
  }
  const asIndex = path.join(DIST, clean, 'index.html');
  return (await exists(asIndex)) ? asIndex : null;
}

const ATTR = /(?:href|src)\s*=\s*"([^"]+)"/g;
const IDS = /\bid\s*=\s*"([^"]+)"/g;

/**
 * The document-level invariants. Each is something that cannot be seen by
 * looking at one template, and each breaks the page for somebody: a duplicate
 * id sends every `aria-labelledby` and in-page link to whichever copy came
 * first, and a control with no accessible name is simply unusable by anyone
 * not looking at the screen.
 */
function auditDocument(html: string, rel: string, findings: Finding[]): void {
  const ids = [...html.matchAll(IDS)].map((m) => m[1]!);
  for (const id of new Set(ids.filter((v, i) => ids.indexOf(v) !== i))) {
    findings.push({ page: rel, kind: 'document', target: `#${id}`, detail: 'id used more than once' });
  }

  const headings = (html.match(/<h1\b/g) ?? []).length;
  if (headings !== 1) {
    findings.push({ page: rel, kind: 'document', target: '<h1>', detail: `${headings} on the page, expected exactly one` });
  }

  if (!/<html[^>]*\blang=/.test(html)) {
    findings.push({ page: rel, kind: 'document', target: '<html>', detail: 'no lang attribute' });
  }

  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\balt\s*=/.test(m[0])) {
      findings.push({ page: rel, kind: 'name', target: m[0].slice(0, 60), detail: 'image has no alt attribute' });
    }
  }

  // A link or button whose only content is a decorative image reaches a screen
  // reader as nothing at all.
  for (const [, attrs = '', inner = ''] of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
    const text = inner.replace(/<[^>]*>/g, '').trim();
    if (!text && !/aria-label=/.test(attrs) && !/alt="[^"]+"/.test(inner)) {
      findings.push({ page: rel, kind: 'name', target: `<a${attrs.slice(0, 50)}>`, detail: 'link has no accessible name' });
    }
  }
  for (const [, attrs = '', inner = ''] of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const text = inner.replace(/<[^>]*>/g, '').trim();
    if (!text && !/aria-label=/.test(attrs)) {
      findings.push({ page: rel, kind: 'name', target: `<button${attrs.slice(0, 50)}>`, detail: 'button has no accessible name' });
    }
  }
}

async function run(): Promise<void> {
  const pages = await htmlFiles(DIST);
  const findings: Finding[] = [];
  let checked = 0;

  for (const page of pages) {
    const html = await readFile(page, 'utf8');
    const rel = path.relative(DIST, page).replace(/\\/g, '/');
    const ids = new Set([...html.matchAll(IDS)].map((m) => m[1]!));

    auditDocument(html, rel, findings);

    for (const match of html.matchAll(ATTR)) {
      const raw = match[1]!;

      // External, protocol-relative, and non-navigating schemes are out of
      // scope: this check is about what the build did or did not produce.
      if (/^(https?:|mailto:|tel:|data:|\/\/)/.test(raw)) continue;

      const [target = '', fragment] = raw.split('#');
      checked += 1;

      if (target === '') {
        if (fragment && !ids.has(fragment)) {
          findings.push({ page: rel, kind: 'anchor', target: raw, detail: 'no element with that id on this page' });
        }
        continue;
      }
      if (!target.startsWith('/')) continue; // every internal URL here is absolute

      const resolved = await resolveTarget(target.split('?')[0]!);
      if (!resolved) {
        const kind = /\.(png|jpe?g|webp|avif|svg|gif|ico)$/i.test(target) ? 'image' : 'link';
        findings.push({ page: rel, kind, target, detail: 'nothing was built at that path' });
      }
    }
  }

  console.log(`Site check — ${pages.length} page(s), ${checked} internal reference(s)\n`);

  if (findings.length === 0) {
    console.log('0 problem(s)');
    return;
  }

  const byPage = new Map<string, Finding[]>();
  for (const f of findings) byPage.set(f.page, [...(byPage.get(f.page) ?? []), f]);
  for (const [page, list] of byPage) {
    console.log(`  ${page}`);
    for (const f of list) console.log(`    • ${f.kind}: ${f.target} — ${f.detail}`);
  }
  console.log(`\n${findings.length} problem(s)`);
  process.exitCode = 1;
}

await run();
