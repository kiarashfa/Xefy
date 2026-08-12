#!/usr/bin/env node
/**
 * Image sourcing: Wikimedia Commons first, Open Food Facts for coverage gaps.
 *
 * The pipeline is deliberately split into two commands, because the step
 * between them is a judgment call that should not be automated. `search`
 * gathers candidates and says what each one costs in licence terms; `adopt`
 * takes one title chosen by a person. Blind auto-selection was considered and
 * ruled out: the top search hit for a dish is regularly a photograph of
 * something adjacent to it, and no amount of ranking fixes that.
 *
 * Usage:
 *   node scripts/data/images.ts search "margherita pizza"
 *   node scripts/data/images.ts review "margherita pizza" --slug margherita-pizza
 *   node scripts/data/images.ts adopt "File:Pizza.jpg" --slug margherita-pizza \
 *        --kind recipe --alt "A margherita pizza, blistered at the edge"
 *   node scripts/data/images.ts off "san marzano tomatoes"
 *   node scripts/data/images.ts list
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assessLicense, VERDICT_RANK, type LicenseAssessment } from './licensing.ts';
import {
  MODIFICATION_NOTE,
  OUTPUT_SIZES,
  treat,
  untreated,
  type OutputSize,
} from './image-treatment.ts';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const IMAGE_DIR = path.join(ROOT, 'public', 'images');
const CREDITS = path.join(ROOT, 'src', 'data', 'image-credits.json');
const REVIEW_DIR = path.join(ROOT, 'image-review');

/** Wikimedia asks for a descriptive User-Agent that can be contacted. */
const UA = 'XefyImagePipeline/0.1 (https://github.com/kiarashfa/Xefy; static recipe reference)';

export interface ImageCredit {
  slug: string;
  kind: 'recipe' | 'ingredient' | 'technique';
  alt: string;
  source: 'Wikimedia Commons' | 'Open Food Facts';
  sourceUrl: string;
  title: string;
  author?: string | undefined;
  credit?: string | undefined;
  license: string;
  licenseUrl?: string | undefined;
  shareAlike: boolean;
  attributionRequired: boolean;
  /** ShareAlike requires modifications to be indicated. */
  modified: string;
  retrieved: string;
  originalWidth?: number | undefined;
  originalHeight?: number | undefined;
  files: Record<string, string>;
}

/* ------------------------------------------------------------------ *
 * Wikimedia Commons
 * ------------------------------------------------------------------ */

interface Candidate {
  title: string;
  pageUrl: string;
  fileUrl: string;
  width: number;
  height: number;
  mime: string;
  license: string;
  licenseUrl?: string | undefined;
  author?: string | undefined;
  credit?: string | undefined;
  description?: string | undefined;
  assessment: LicenseAssessment;
}

const stripHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

async function commonsApi(params: Record<string, string>): Promise<any> {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Commons responded ${res.status} ${res.statusText}`);
  return res.json();
}

function toCandidate(page: any): Candidate | null {
  const info = page.imageinfo?.[0];
  if (!info) return null;
  const meta = info.extmetadata ?? {};
  const license = stripHtml(meta.LicenseShortName?.value) || 'unknown';
  const usageTerms = stripHtml(meta.UsageTerms?.value);

  return {
    title: page.title,
    pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
    fileUrl: info.url,
    width: info.width,
    height: info.height,
    mime: info.mime,
    license,
    licenseUrl: stripHtml(meta.LicenseUrl?.value) || undefined,
    author: stripHtml(meta.Artist?.value) || undefined,
    credit: stripHtml(meta.Credit?.value) || undefined,
    description: stripHtml(meta.ImageDescription?.value) || undefined,
    assessment: assessLicense(license, usageTerms),
  };
}

async function findCandidates(query: string, limit: number): Promise<Candidate[]> {
  const data = await commonsApi({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6', // File:
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size|mime',
  });

  const pages: any[] = data.query?.pages ?? [];
  return pages
    .map(toCandidate)
    .filter((c): c is Candidate => c !== null)
    // Photographs only, and big enough to crop a 1200px square out of.
    .filter((c) => c.mime.startsWith('image/') && !c.mime.includes('svg'))
    .sort(
      (a, b) =>
        VERDICT_RANK[a.assessment.verdict] - VERDICT_RANK[b.assessment.verdict] ||
        b.width * b.height - a.width * a.height,
    );
}

async function byTitle(title: string): Promise<Candidate> {
  const normalised = title.startsWith('File:') ? title : `File:${title}`;
  const data = await commonsApi({
    action: 'query',
    titles: normalised,
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size|mime',
  });
  const page = data.query?.pages?.[0];
  const candidate = page && toCandidate(page);
  if (!candidate) throw new Error(`No Commons file called "${normalised}"`);
  return candidate;
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

const MIN_EDGE = OUTPUT_SIZES.hero;

function describe(c: Candidate, index: number): void {
  const small = Math.min(c.width, c.height) < MIN_EDGE;
  const marks = [
    c.assessment.verdict.toUpperCase(),
    small ? `TOO SMALL (${c.width}×${c.height})` : `${c.width}×${c.height}`,
  ].join(' · ');

  console.log(`\n${index + 1}. ${c.title}`);
  console.log(`   ${marks}`);
  console.log(`   ${c.license} — ${c.assessment.reason}`);
  if (c.author) console.log(`   by ${c.author}`);
  if (c.description) console.log(`   "${c.description.slice(0, 110)}"`);
  console.log(`   ${c.pageUrl}`);
}

async function search(query: string, limit: number): Promise<void> {
  const candidates = await findCandidates(query, limit);
  if (candidates.length === 0) {
    console.log(`No Commons photographs for "${query}". Try Open Food Facts: images.ts off "${query}"`);
    return;
  }

  console.log(`Candidates for "${query}", least encumbered first:`);
  candidates.forEach(describe);

  console.log(
    '\nPrefer public domain and CC BY over CC BY-SA where the photograph is as good;' +
      '\nan image smaller than ' + MIN_EDGE + 'px on its short edge cannot make a hero crop.' +
      '\n\nLook at them first:  images.ts review "' + query + '" --slug <slug>' +
      '\nThen:                images.ts adopt "<File:Title>" --slug <slug> --kind recipe --alt "…"',
  );
}

/**
 * Downloads the candidates and writes both a graded and an ungraded crop of
 * each, so the choice is made by looking rather than by reading metadata.
 */
async function review(query: string, slug: string, limit: number): Promise<void> {
  const candidates = (await findCandidates(query, limit)).filter(
    (c) => c.assessment.verdict !== 'rejected' && Math.min(c.width, c.height) >= MIN_EDGE,
  );

  const dir = path.join(REVIEW_DIR, slug);
  await mkdir(dir, { recursive: true });

  const index: string[] = [];
  for (const [i, c] of candidates.entries()) {
    const raw = await fetchImage(c.fileUrl);
    const n = String(i + 1).padStart(2, '0');
    await writeFile(path.join(dir, `${n}-before.webp`), await untreated(raw, 'card'));
    await writeFile(path.join(dir, `${n}-after.webp`), await treat(raw, 'card'));
    index.push(`${n}  ${c.assessment.verdict.padEnd(10)} ${c.license.padEnd(16)} ${c.title}`);
    console.log(`  wrote ${n}-before/after.webp  ${c.title}`);
  }

  await writeFile(path.join(dir, 'candidates.txt'), `${index.join('\n')}\n`, 'utf8');
  console.log(`\n${candidates.length} candidate(s) in image-review/${slug}/. Compare, then adopt the one you want.`);
}

async function readCredits(): Promise<ImageCredit[]> {
  try {
    return JSON.parse(await readFile(CREDITS, 'utf8')) as ImageCredit[];
  } catch {
    return [];
  }
}

async function adopt(
  title: string,
  slug: string,
  kind: ImageCredit['kind'],
  alt: string,
): Promise<void> {
  if (!slug || !alt) {
    console.error('--slug and --alt are both required. Alt text is not optional on a real page.');
    process.exit(1);
  }

  const candidate = await byTitle(title);
  if (candidate.assessment.verdict === 'rejected') {
    console.error(`Refusing: ${candidate.license} — ${candidate.assessment.reason}`);
    process.exit(1);
  }
  if (Math.min(candidate.width, candidate.height) < MIN_EDGE) {
    console.error(
      `Refusing: ${candidate.width}×${candidate.height} is too small for a ${MIN_EDGE}px square crop.`,
    );
    process.exit(1);
  }

  const raw = await fetchImage(candidate.fileUrl);

  const folder = `${kind}s`;
  const outDir = path.join(IMAGE_DIR, folder);
  await mkdir(outDir, { recursive: true });

  const files: Record<string, string> = {};
  for (const size of Object.keys(OUTPUT_SIZES) as OutputSize[]) {
    const name = size === 'hero' ? `${slug}.webp` : `${slug}-${size}.webp`;
    await writeFile(path.join(outDir, name), await treat(raw, size));
    files[size] = `images/${folder}/${name}`;
  }

  const credit: ImageCredit = {
    slug,
    kind,
    alt,
    source: 'Wikimedia Commons',
    sourceUrl: candidate.pageUrl,
    title: candidate.title,
    author: candidate.author,
    credit: candidate.credit,
    license: candidate.license,
    licenseUrl: candidate.licenseUrl,
    shareAlike: candidate.assessment.shareAlike,
    attributionRequired: candidate.assessment.attributionRequired,
    modified: MODIFICATION_NOTE,
    retrieved: new Date().toISOString().slice(0, 10),
    originalWidth: candidate.width,
    originalHeight: candidate.height,
    files,
  };

  const credits = (await readCredits()).filter((c) => !(c.slug === slug && c.kind === kind));
  credits.push(credit);
  credits.sort((a, b) => a.kind.localeCompare(b.kind) || a.slug.localeCompare(b.slug));
  await writeFile(CREDITS, `${JSON.stringify(credits, null, 2)}\n`, 'utf8');

  // An ingredient record points at its own thumbnail, and adopting an image
  // without setting it leaves the file on disk and the page unchanged — a
  // silent no-op that looks exactly like success. The record is the only place
  // the site reads, so writing it here is what makes adoption mean anything.
  if (kind === 'ingredient') {
    const record = path.join('src/content/ingredients', `${slug}.json`);
    try {
      const data = JSON.parse(await readFile(record, 'utf8'));
      data.image = files.thumb;
      await writeFile(record, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    } catch {
      console.log(`  note: no ingredient record at ${record}; its image field is unset.`);
    }
  }

  console.log(`Adopted "${candidate.title}" as ${kind}/${slug}`);
  for (const [size, file] of Object.entries(files)) console.log(`  ${size.padEnd(6)} ${file}`);
  console.log(`  ${candidate.license}${candidate.author ? ` · ${candidate.author}` : ''}`);
  if (candidate.assessment.shareAlike) {
    console.log('  ShareAlike: the graded image is offered under the same licence, and the');
    console.log('  modification is recorded. Both appear on /attributions/.');
  }
}

/* ------------------------------------------------------------------ *
 * Open Food Facts — the secondary source for coverage gaps
 * ------------------------------------------------------------------ */

/**
 * Open Food Facts serves 503s fairly readily under load, and a coverage-gap
 * lookup failing is a nuisance rather than an emergency, so this retries once
 * and then says so plainly.
 */
async function offFetch(url: URL): Promise<any | null> {
  for (const attempt of [1, 2]) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return res.json();
    if (attempt === 1 && res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    console.log(
      `Open Food Facts responded ${res.status}. It is frequently busy — worth retrying in a minute.`,
    );
    return null;
  }
  return null;
}

/** The API hands back a 400px rendition; the original is what a hero needs. */
const fullSize = (imageUrl: string) => imageUrl.replace(/\.(\d+)\.400\.jpg$/, '.$1.full.jpg');

/**
 * Downloads one image, with retries.
 *
 * Open Food Facts' image host in particular refuses connections often enough
 * that a single attempt fails perhaps half the time, and losing a whole batch of
 * curation work to one flaky socket is not a useful outcome. The JSON side has
 * had a retry since it was written; the images never did.
 */
async function fetchImage(url: string): Promise<Buffer> {
  let last: unknown;
  for (const attempt of [1, 2, 3, 4]) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (error) {
      last = error;
      if (attempt < 4) await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
  throw new Error(`Could not download ${url} after four attempts: ${String(last)}`);
}

async function offSearch(query: string): Promise<void> {
  // v2 filters by category and is the maintained endpoint; the older CGI search
  // is the only one that takes free text, so both are tried.
  const v2 = new URL('https://world.openfoodfacts.org/api/v2/search');
  v2.searchParams.set('categories_tags_en', query);
  v2.searchParams.set('fields', 'code,product_name,brands,image_front_url');
  v2.searchParams.set('page_size', '10');

  let data = await offFetch(v2);
  if (!data?.products?.length) {
    const legacy = new URL('https://world.openfoodfacts.org/cgi/search.pl');
    legacy.searchParams.set('search_terms', query);
    legacy.searchParams.set('search_simple', '1');
    legacy.searchParams.set('action', 'process');
    legacy.searchParams.set('json', '1');
    legacy.searchParams.set('page_size', '10');
    data = await offFetch(legacy);
  }
  if (!data) return;

  const usable = (data.products ?? []).filter((p: any) => p.image_front_url || p.image_url);
  if (usable.length === 0) {
    console.log(`No Open Food Facts products with images for "${query}".`);
    return;
  }

  console.log(
    `Open Food Facts candidates for "${query}". These are packaging photographs, so they` +
      '\nsuit ingredients Commons covers poorly and almost never suit a finished dish.' +
      '\nContributions are CC BY-SA 3.0 and need attributing to Open Food Facts and the' +
      '\ncontributor — and a photograph of a branded tin is rarely what an ingredient page' +
      '\nwants, so treat this as a last resort rather than a parallel source.\n',
  );
  for (const [i, p] of usable.entries()) {
    console.log(`${i + 1}. ${p.product_name || '(unnamed)'} ${p.brands ? `— ${p.brands}` : ''}`);
    console.log(`   barcode ${p.code}`);
    console.log(`   ${fullSize(p.image_front_url || p.image_url)}`);
    console.log(`   https://world.openfoodfacts.org/product/${p.code}`);
  }
  console.log(
    `\nReview one before taking it:  images.ts off-review <barcode> --slug <s>` +
      `\nThen:                         images.ts off-adopt <barcode> --slug <s> --kind ingredient --alt "…"`,
  );
}

/** The product record behind one barcode, with its front image resolved. */
async function offProduct(
  barcode: string,
): Promise<{ name: string; brands: string; image: string; page: string } | null> {
  const url = new URL(`https://world.openfoodfacts.org/api/v2/product/${barcode}`);
  url.searchParams.set('fields', 'code,product_name,brands,image_front_url,image_url');
  const data = await offFetch(url);
  const p = data?.product;
  const image = p?.image_front_url || p?.image_url;
  if (!p || !image) {
    console.error(`No Open Food Facts product with an image for barcode ${barcode}.`);
    return null;
  }
  return {
    name: p.product_name || '(unnamed)',
    brands: p.brands || '',
    image: fullSize(image),
    page: `https://world.openfoodfacts.org/product/${barcode}`,
  };
}

/** Same treatment, same before/after pair — an OFF image is never taken unseen either. */
async function offReview(barcode: string, slug: string): Promise<void> {
  const product = await offProduct(barcode);
  if (!product) return;

  const dir = path.join(REVIEW_DIR, slug);
  await mkdir(dir, { recursive: true });
  const raw = await fetchImage(product.image);
  await writeFile(path.join(dir, `off-${barcode}-before.webp`), await untreated(raw, 'card'));
  await writeFile(path.join(dir, `off-${barcode}-after.webp`), await treat(raw, 'card'));
  console.log(`  wrote off-${barcode}-before/after.webp  ${product.name} — ${product.brands}`);
}

/**
 * Adopting from Open Food Facts.
 *
 * The `off` command could search and nothing could take what it found, which
 * made §16's secondary source advice a dead end in practice. It stays a last
 * resort — these are packaging photographs of one brand's tin, and an ingredient
 * page usually wants the food — but "last resort" and "impossible" are different
 * things, and the ingredients Commons covers badly are exactly the ones that
 * need it.
 *
 * Contributions are CC BY-SA 3.0, so the ShareAlike obligation and the
 * attribution are recorded the same way a Commons image's are.
 */
async function offAdopt(
  barcode: string,
  slug: string,
  kind: ImageCredit['kind'],
  alt: string,
): Promise<void> {
  if (!slug || !alt) {
    console.error('--slug and --alt are both required. Alt text is not optional on a real page.');
    process.exit(1);
  }
  const product = await offProduct(barcode);
  if (!product) process.exit(1);

  const raw = await fetchImage(product!.image);

  const folder = `${kind}s`;
  const outDir = path.join(IMAGE_DIR, folder);
  await mkdir(outDir, { recursive: true });

  const files: Record<string, string> = {};
  for (const size of Object.keys(OUTPUT_SIZES) as OutputSize[]) {
    const name = size === 'hero' ? `${slug}.webp` : `${slug}-${size}.webp`;
    await writeFile(path.join(outDir, name), await treat(raw, size));
    files[size] = `images/${folder}/${name}`;
  }

  const credit: ImageCredit = {
    slug,
    kind,
    alt,
    source: 'Open Food Facts',
    sourceUrl: product!.page,
    title: `${product!.name}${product!.brands ? ` — ${product!.brands}` : ''} (${barcode})`,
    author: 'Open Food Facts contributors',
    credit: 'Open Food Facts',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
    shareAlike: true,
    attributionRequired: true,
    modified: MODIFICATION_NOTE,
    retrieved: new Date().toISOString().slice(0, 10),
    files,
  };

  const credits = (await readCredits()).filter((c) => !(c.slug === slug && c.kind === kind));
  credits.push(credit);
  credits.sort((a, b) => a.kind.localeCompare(b.kind) || a.slug.localeCompare(b.slug));
  await writeFile(CREDITS, `${JSON.stringify(credits, null, 2)}\n`, 'utf8');

  if (kind === 'ingredient') {
    const record = path.join('src/content/ingredients', `${slug}.json`);
    try {
      const data = JSON.parse(await readFile(record, 'utf8'));
      data.image = files.thumb;
      await writeFile(record, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    } catch {
      console.log(`  note: no ingredient record at ${record}; its image field is unset.`);
    }
  }

  console.log(`Adopted Open Food Facts ${barcode} as ${kind}/${slug}`);
  console.log(`  ${credit.title}`);
  console.log('  CC BY-SA 3.0 · Open Food Facts contributors');
  console.log('  ShareAlike: the graded image is offered under the same licence, and the');
  console.log('  modification is recorded. Both appear on /attributions/.');
}

async function list(): Promise<void> {
  const credits = await readCredits();
  if (credits.length === 0) {
    console.log('No images adopted yet.');
    return;
  }
  console.log(`${credits.length} image(s):\n`);
  for (const c of credits) {
    console.log(`  ${c.kind.padEnd(11)} ${c.slug.padEnd(24)} ${c.license.padEnd(16)} ${c.author ?? ''}`);
  }
  const sa = credits.filter((c) => c.shareAlike).length;
  if (sa > 0) console.log(`\n${sa} under ShareAlike; the attributions page states the licence per image.`);
}

/* ------------------------------------------------------------------ */

const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
};
const positional = () => {
  const out: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i]!.startsWith('--')) {
      i += 1;
      continue;
    }
    out.push(rest[i]!);
  }
  return out;
};

const limit = Number(flag('limit') ?? 8);

// A network hiccup should read as a sentence, not a stack trace.
process.on('unhandledRejection', (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

switch (command) {
  case 'search':
    await search(positional().join(' '), limit);
    break;
  case 'review':
    await review(positional().join(' '), flag('slug') ?? 'unsorted', limit);
    break;
  case 'adopt':
    await adopt(
      positional()[0] ?? '',
      flag('slug') ?? '',
      (flag('kind') as ImageCredit['kind']) ?? 'recipe',
      flag('alt') ?? '',
    );
    break;
  case 'off':
    await offSearch(positional().join(' '));
    break;
  case 'off-review':
    await offReview(positional()[0] ?? '', flag('slug') ?? 'unsorted');
    break;
  case 'off-adopt':
    await offAdopt(
      positional()[0] ?? '',
      flag('slug') ?? '',
      (flag('kind') as ImageCredit['kind']) ?? 'ingredient',
      flag('alt') ?? '',
    );
    break;
  case 'list':
    await list();
    break;
  default:
    console.log(
      'Image sourcing for Xefy.\n\n' +
        '  search <query> [--limit n]        candidates, with what each licence costs\n' +
        '  review <query> --slug <s>         download and grade them so you can look\n' +
        '  adopt "<File:Title>" --slug <s>   process and record one\n' +
        '         --kind recipe|ingredient|technique --alt "…"\n' +
        '  off <query>                       Open Food Facts, for coverage gaps\n' +
        '  off-review <barcode> --slug <s>   download and grade one of them\n' +
        '  off-adopt <barcode> --slug <s>    process and record it\n' +
        '         --kind ingredient --alt "…"\n' +
        '  list                              what has been adopted\n',
    );
}
