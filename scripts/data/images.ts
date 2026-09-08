#!/usr/bin/env node
/**
 * Image sourcing: Wikimedia Commons first, then Openverse, with Open Food
 * Facts for packaged goods.
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
 *   node scripts/data/images.ts review "…" --slug <s> --sheet   # one tiled sheet
 *   node scripts/data/images.ts adopt "File:Pizza.jpg" --slug margherita-pizza \
 *        --kind recipe --alt "A margherita pizza, blistered at the edge"
 *   node scripts/data/images.ts search "buttermilk" --source openverse
 *   node scripts/data/images.ts review "…" --slug <s> --source openverse --sheet
 *   node scripts/data/images.ts adopt <uuid> --source openverse --slug <s> …
 *   node scripts/data/images.ts off "san marzano tomatoes"
 *   node scripts/data/images.ts list
 *
 * Why a second search source. Commons is built by people documenting subjects,
 * and a bottle of cider vinegar is not a subject anyone volunteers to document
 * — so Commons photographs *dishes* well and *shop-bought pantry staples*
 * badly, and no amount of better querying fixes that. Openverse aggregates
 * Flickr, Rawpixel, museums and more under structured licence metadata, which
 * is where the home cook's photograph of a jar of molasses actually lives. It
 * excludes Wikimedia by default here, because that is the primary source and
 * duplicating it wastes sheet slots.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

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
  source: 'Wikimedia Commons' | 'Open Food Facts' | 'Openverse';
  /** For Openverse, the upstream host the photograph actually came from. */
  provider?: string | undefined;
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
  /** Which search source produced it — decides how `adopt` re-fetches it. */
  origin: ImageCredit['source'];
  /** Openverse's UUID. Commons candidates are addressed by title instead. */
  id?: string | undefined;
  /** Openverse's upstream host: flickr, rawpixel, a museum. */
  provider?: string | undefined;
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

/**
 * The formats `sharp` can actually decode.
 *
 * This is an allowlist rather than a "not SVG" blocklist, and the difference is
 * a real bug: Commons also serves DjVu, XCF and other things whose MIME type
 * begins `image/` and which libvips cannot open. One of those in a batch used
 * to throw out of the middle of `review`, losing the whole contact sheet —
 * including the candidates already downloaded — before `candidates.txt` or
 * `sheet.webp` was written. The cost was not really the tokens: a lost sheet
 * looks exactly like a query that found nothing, so a reviewer can record a
 * refusal for a subject whose photograph was sitting in the batch.
 */
const DECODABLE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/tiff',
  'image/avif',
]);

/**
 * A last check by magic bytes, because a Content-Type header can lie and an
 * error page served as `image/jpeg` reaches sharp as a decode failure.
 */
function looksDecodable(b: Buffer): boolean {
  if (b.length < 12) return false;
  const at = (start: number, end: number) => b.toString('latin1', start, end);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true; // JPEG
  if (b[0] === 0x89 && at(1, 4) === 'PNG') return true; // PNG
  if (at(0, 3) === 'GIF') return true; // GIF
  if (at(0, 4) === 'RIFF' && at(8, 12) === 'WEBP') return true; // WebP
  if (at(4, 12) === 'ftypavif') return true; // AVIF
  const tiff =
    (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) ||
    (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00);
  return tiff;
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
    origin: 'Wikimedia Commons',
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
    // Only formats sharp can open. See DECODABLE_MIME.
    .filter((c) => DECODABLE_MIME.has(c.mime.toLowerCase()))
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
 * Openverse — the second search source
 *
 * Same shape of result as Commons, so `review` and `adopt` do not care which
 * one produced a candidate. Three things differ and all three matter:
 *
 *  - It is addressed by UUID, not by `File:` title.
 *  - `sourceUrl` points at the upstream page (the Flickr photo, the museum
 *    record), which is what an attribution should link to — not at Openverse,
 *    which is only the index that found it.
 *  - Wikimedia is excluded by default. It is the primary source already, and a
 *    duplicate costs a slot on the contact sheet.
 * ------------------------------------------------------------------ */

const OPENVERSE = 'https://api.openverse.org/v1/images/';

/** Free-culture licences only. Anything NC or ND is filtered by `assessLicense`. */
const OPENVERSE_LICENCES = 'by,by-sa,cc0,pdm';
const OPENVERSE_PUBLIC_DOMAIN = 'cc0,pdm';

/**
 * Providers excluded by default, and why each is here rather than left to the
 * reviewer's eye.  because it is the primary source already and a
 * duplicate only costs a slot on the contact sheet. The rest because they
 * flood food queries with things that are not food: iNaturalist and the
 * biodiversity libraries answer "buttermilk" with the buttermilk racer, a
 * snake, and "nori" with a genus; svgsilh, Thingiverse and Sketchfab hold no
 * photographs at all. This is the same failure Commons has with museum
 * specimens, and the same answer: keep it out of the sheet rather than spend a
 * look rejecting it.
 *
 * What is deliberately NOT excluded: Rawpixel and the museums carry vintage
 * advertising labels and paintings alongside genuinely good CC0 stock, and
 * telling those apart is a judgement a person makes by looking, not one a
 * provider name can make in advance.
 */
const OPENVERSE_EXCLUDED = [
  'wikimedia',
  'inaturalist',
  'bio_diversity',
  'animaldiversity',
  'WoRMS',
  'sketchfab',
  'thingiverse',
  'svgsilh',
  'spacex',
  'nasa',
];

/** Openverse reports a licence code and version; `assessLicense` reads prose. */
function openverseLicenceName(code: string, version?: string): string {
  const key = String(code ?? '').toLowerCase();
  const v = version ? ` ${version}` : '';
  if (key === 'cc0') return `CC0${v || ' 1.0'}`;
  if (key === 'pdm') return `Public Domain Mark${v || ' 1.0'}`;
  return `CC ${key.toUpperCase()}${v}`;
}

function mimeFromUrl(url: string): string {
  let ext: string | undefined;
  try {
    ext = new URL(url).pathname.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  } catch {
    ext = undefined;
  }
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'tif':
    case 'tiff':
      return 'image/tiff';
    case 'avif':
      return 'image/avif';
    default:
      return 'image/jpeg';
  }
}

function toOpenverseCandidate(r: any): Candidate | null {
  if (!r?.url) return null;
  const license = openverseLicenceName(r.license, r.license_version);
  return {
    origin: 'Openverse',
    id: r.id,
    provider: r.source ?? r.provider ?? undefined,
    title: r.title || String(r.id ?? 'untitled'),
    pageUrl: r.foreign_landing_url || r.url,
    fileUrl: r.url,
    width: Number(r.width ?? 0),
    height: Number(r.height ?? 0),
    mime: mimeFromUrl(r.url),
    license,
    licenseUrl: r.license_url || undefined,
    author: r.creator || undefined,
    credit: r.attribution || undefined,
    description: undefined,
    assessment: assessLicense(license),
  };
}

async function openverseSearch(
  query: string,
  limit: number,
  publicDomainOnly: boolean,
): Promise<Candidate[]> {
  const url = new URL(OPENVERSE);
  url.searchParams.set('q', query);
  url.searchParams.set(
    'license',
    publicDomainOnly ? OPENVERSE_PUBLIC_DOMAIN : OPENVERSE_LICENCES,
  );
  // Openverse indexes whatever size the upstream host serves, and Flickr's
  // default is 1024px — under the hero floor. `large` is what keeps the
  // results usable.
  url.searchParams.set('size', 'large');
  url.searchParams.set('excluded_source', OPENVERSE_EXCLUDED.join(','));
  url.searchParams.set('page_size', String(Math.min(Math.max(limit, 1), 20)));

  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Openverse responded ${res.status} ${res.statusText}`);
  const data: any = await res.json();

  return ((data.results ?? []) as any[])
    .map(toOpenverseCandidate)
    .filter((c): c is Candidate => c !== null)
    .filter((c) => DECODABLE_MIME.has(c.mime))
    .sort(
      (a, b) =>
        VERDICT_RANK[a.assessment.verdict] - VERDICT_RANK[b.assessment.verdict] ||
        b.width * b.height - a.width * a.height,
    );
}

async function openverseById(id: string): Promise<Candidate> {
  const res = await fetch(`${OPENVERSE}${encodeURIComponent(id)}/`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`No Openverse image with id "${id}" (${res.status}).`);
  const candidate = toOpenverseCandidate(await res.json());
  if (!candidate) throw new Error(`Openverse image "${id}" carries no usable file URL.`);
  return candidate;
}

export type SourceName = 'commons' | 'openverse';

const sourceOf = (value: string | undefined): SourceName =>
  String(value ?? 'commons').toLowerCase() === 'openverse' ? 'openverse' : 'commons';

async function candidatesFrom(
  source: SourceName,
  query: string,
  limit: number,
  publicDomainOnly: boolean,
): Promise<Candidate[]> {
  return source === 'openverse'
    ? openverseSearch(query, limit, publicDomainOnly)
    : findCandidates(query, limit);
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
  console.log(`   ${marks}${c.provider ? ` · via ${c.provider}` : ''}`);
  console.log(`   ${c.license} — ${c.assessment.reason}`);
  if (c.author) console.log(`   by ${c.author}`);
  if (c.description) console.log(`   "${c.description.slice(0, 110)}"`);
  console.log(`   ${c.pageUrl}`);
  // Commons is adopted by title, which is printed above; Openverse by UUID,
  // which is not otherwise visible anywhere.
  if (c.origin === 'Openverse' && c.id) console.log(`   adopt id: ${c.id}`);
}

async function search(
  query: string,
  limit: number,
  source: SourceName,
  publicDomainOnly: boolean,
): Promise<void> {
  const candidates = await candidatesFrom(source, query, limit, publicDomainOnly);
  if (candidates.length === 0) {
    console.log(
      source === 'commons'
        ? `No Commons photographs for "${query}". Try: images.ts search "${query}" --source openverse`
        : `No Openverse photographs for "${query}". For a packaged product, try: images.ts off "${query}"`,
    );
    return;
  }

  console.log(`Candidates for "${query}", least encumbered first:`);
  candidates.forEach(describe);

  const via = source === 'openverse' ? ' --source openverse' : '';
  const target = source === 'openverse' ? '<adopt id>' : '"<File:Title>"';
  console.log(
    '\nPrefer public domain and CC BY over CC BY-SA where the photograph is as good;' +
      '\nan image smaller than ' + MIN_EDGE + 'px on its short edge cannot make a hero crop.' +
      (source === 'openverse'
        ? '\nOpenverse indexes drawings, paintings and museum objects alongside' +
          '\nphotographs, so look before believing a title.'
        : '') +
      '\n\nLook at them first:  images.ts review "' + query + '" --slug <slug>' + via + ' --sheet' +
      '\nThen:                images.ts adopt ' + target + ' --slug <slug>' + via +
      ' --kind recipe --alt "…"',
  );
}

/**
 * Downloads the candidates and writes both a graded and an ungraded crop of
 * each, so the choice is made by looking rather than by reading metadata.
 *
 * `--sheet` also tiles the graded crops into one numbered contact sheet. The
 * reason is cost, and it is not marginal: a reviewer that opens five 800 px
 * candidates per subject spends most of a photograph round on images it is
 * about to reject. One sheet is a single, much smaller read, and comparing
 * candidates side by side is a better comparison than looking at them one after
 * another anyway. It is triage only — the sheet is too small to show a
 * watermark, a date stamp, or whether that mince is lamb or beef, so the
 * finalist still gets opened at full size before it is adopted.
 */
async function review(
  query: string,
  slug: string,
  limit: number,
  sheet: boolean,
  source: SourceName = 'commons',
  publicDomainOnly = false,
): Promise<void> {
  const candidates = (await candidatesFrom(source, query, limit, publicDomainOnly)).filter(
    (c) => c.assessment.verdict !== 'rejected' && Math.min(c.width, c.height) >= MIN_EDGE,
  );

  const dir = path.join(REVIEW_DIR, slug);
  await mkdir(dir, { recursive: true });

  const index: string[] = [];
  const tiles: Buffer[] = [];
  const skipped: string[] = [];

  // One unusable candidate must never take the batch with it. `kept` numbers
  // the survivors, so the sheet's tile labels stay aligned with the NN-after
  // files and with candidates.txt even when something in the middle is dropped.
  let kept = 0;
  for (const c of candidates) {
    const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
    let raw: Buffer;
    try {
      raw = await fetchImage(c.fileUrl);
    } catch (error) {
      skipped.push(`${c.title} — download failed: ${reason(error)}`);
      continue;
    }
    if (!looksDecodable(raw)) {
      skipped.push(`${c.title} — not a decodable image (served as ${c.mime})`);
      continue;
    }
    try {
      const n = String(kept + 1).padStart(2, '0');
      await writeFile(path.join(dir, `${n}-before.webp`), await untreated(raw, 'card'));
      await writeFile(path.join(dir, `${n}-after.webp`), await treat(raw, 'card'));
      if (sheet) tiles.push(await treat(raw, 'thumb'));
      index.push(
        `${n}  ${c.assessment.verdict.padEnd(10)} ${c.license.padEnd(16)} ` +
          `${c.origin === 'Openverse' ? `[${c.id}] ` : ''}${c.title}`,
      );
      console.log(`  wrote ${n}-before/after.webp  ${c.title}`);
      kept += 1;
    } catch (error) {
      skipped.push(`${c.title} — could not be processed: ${reason(error)}`);
    }
  }

  await writeFile(path.join(dir, 'candidates.txt'), `${index.join('\n')}\n`, 'utf8');

  if (skipped.length > 0) {
    console.log(`\n  skipped ${skipped.length}, the rest are fine:`);
    for (const line of skipped) console.log(`    ${line}`);
  }

  if (kept === 0) {
    console.log(
      `\nNothing usable survived for "${query}". That is not the same as the ` +
        `search finding nothing — check the skip list above before recording a refusal.`,
    );
    return;
  }

  if (sheet && tiles.length > 0) {
    const file = await writeSheet(dir, tiles);
    console.log(
      `\n${kept} candidate(s). Contact sheet: ${file}\n` +
        `Read the sheet, pick the one that could be right, then read its own ` +
        `NN-after.webp at full size before adopting — the sheet is too small to ` +
        `show a watermark or a date stamp.`,
    );
    return;
  }

  console.log(`\n${kept} candidate(s) in image-review/${slug}/. Compare, then adopt the one you want.`);
}

/**
 * Tiles thumbnails into one sheet, three across, each numbered to match its
 * `NN-after.webp`. The number is drawn as an SVG overlay rather than a font
 * dependency: `sharp` renders SVG text through librsvg, which is already there.
 */
async function writeSheet(dir: string, tiles: Buffer[]): Promise<string> {
  const edge = OUTPUT_SIZES.thumb;
  const gap = 8;
  const cols = Math.min(3, tiles.length);
  const rows = Math.ceil(tiles.length / cols);
  const width = cols * edge + (cols + 1) * gap;
  const height = rows * edge + (rows + 1) * gap;

  const label = (n: number): Buffer =>
    Buffer.from(
      `<svg width="${edge}" height="${edge}">` +
        `<rect x="0" y="0" width="34" height="26" fill="#000" opacity="0.72"/>` +
        `<text x="17" y="19" font-family="sans-serif" font-size="17" font-weight="bold" ` +
        `fill="#fff" text-anchor="middle">${String(n).padStart(2, '0')}</text></svg>`,
    );

  const numbered = await Promise.all(
    tiles.map((tile, i) =>
      sharp(tile)
        .composite([{ input: label(i + 1), top: 0, left: 0 }])
        .toBuffer(),
    ),
  );

  const file = path.join(dir, 'sheet.webp');
  await sharp({
    create: { width, height, channels: 3, background: '#1c1c1a' },
  })
    .composite(
      numbered.map((input, i) => ({
        input,
        top: gap + Math.floor(i / cols) * (edge + gap),
        left: gap + (i % cols) * (edge + gap),
      })),
    )
    .webp({ quality: 82 })
    .toFile(file);

  return path.relative(ROOT, file);
}

/**
 * Points the record at its own photograph. An ingredient is JSON and takes a
 * bare thumbnail path; a recipe and a Component are MDX and take
 * `image: { src, alt }` in frontmatter, against the hero rendition.
 *
 * Recipes get the field on `index.mdx` only. A version file inherits the
 * dish's identity — title, naming, imagery — so a per-version photograph would
 * be a second identity for one dish.
 */
async function writeImageField(
  kind: ImageCredit['kind'],
  slug: string,
  files: Record<string, string>,
  alt: string,
): Promise<void> {
  if (kind === 'ingredient') {
    const record = path.join('src/content/ingredients', `${slug}.json`);
    try {
      const data = JSON.parse(await readFile(record, 'utf8'));
      data.image = files.thumb;
      await writeFile(record, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    } catch {
      console.log(`  note: no ingredient record at ${record}; its image field is unset.`);
    }
    return;
  }

  const record =
    kind === 'recipe'
      ? path.join('src/content/recipes', slug, 'index.mdx')
      : path.join('src/content/components', `${slug}.mdx`);

  let raw: string;
  try {
    raw = await readFile(record, 'utf8');
  } catch {
    console.log(`  note: no record at ${record}; its image field is unset.`);
    return;
  }

  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    console.log(`  note: ${record} has no frontmatter; its image field is unset.`);
    return;
  }

  // JSON.stringify gives a correctly escaped double-quoted YAML scalar.
  const block = `image:\n  src: ${files.hero}\n  alt: ${JSON.stringify(alt)}\n`;
  let front = match[1] ?? '';

  if (/^image:/m.test(front)) {
    front = front.replace(/^image:\n(?:[ \t]+.*\n?)*/m, block);
  } else {
    // Before `ingredients:` where there is one, so identity stays together at
    // the top; otherwise at the end of the frontmatter.
    front = /^ingredients:/m.test(front)
      ? front.replace(/^ingredients:/m, `${block}ingredients:`)
      : `${front.replace(/\n?$/, '\n')}${block}`;
  }

  await writeFile(record, raw.replace(match[0], `---\n${front.replace(/\n?$/, '\n')}---`), 'utf8');
}

async function readCredits(): Promise<ImageCredit[]> {
  try {
    return JSON.parse(await readFile(CREDITS, 'utf8')) as ImageCredit[];
  } catch {
    return [];
  }
}

async function adopt(
  identifier: string,
  slug: string,
  kind: ImageCredit['kind'],
  alt: string,
  source: SourceName = 'commons',
): Promise<void> {
  if (!slug || !alt) {
    console.error('--slug and --alt are both required. Alt text is not optional on a real page.');
    process.exit(1);
  }

  // Commons is addressed by `File:` title, Openverse by UUID.
  const candidate =
    source === 'openverse' ? await openverseById(identifier) : await byTitle(identifier);

  // A Commons title describes itself, so adopting the wrong one is visible in
  // the command you typed. An Openverse UUID is opaque: a stale one copied from
  // another subject adopts a completely unrelated photograph with no error at
  // all — it happened once, and a picture of concrete pavers was written as
  // tortilla chips. So echo what the identifier actually resolved to, and where
  // the subject has been reviewed, check that the id was one of ITS candidates.
  console.log(
    `  resolved: ${candidate.title} (${candidate.width}x${candidate.height})` +
      `${candidate.provider ? ` via ${candidate.provider}` : ''}`,
  );
  if (source === 'openverse') {
    const listed = await readFile(
      path.join(REVIEW_DIR, slug, 'candidates.txt'),
      'utf8',
    ).catch(() => null);
    if (listed !== null && !listed.includes(identifier)) {
      console.log(
        `\n  !! ${identifier} is not among the candidates reviewed for "${slug}".\n` +
          `     That is what a stale or copied UUID looks like. Confirm the title\n` +
          `     above is the photograph you chose, and open the rendition before\n` +
          `     moving on.\n`,
      );
    }
  }
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
  if (!looksDecodable(raw)) {
    console.error(
      `Refusing: ${candidate.fileUrl} did not arrive as a decodable image ` +
        `(declared ${candidate.mime}). Pick another candidate.`,
    );
    process.exit(1);
  }

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
    source: candidate.origin,
    provider: candidate.provider,
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

  // The record is the only place the site reads, so writing it here is what
  // makes adoption mean anything: renditions on disk and a credit in the
  // manifest change no page by themselves.
  //
  // This covered ingredients only for a long time, and the gap was invisible in
  // exactly the way that matters — `adopt` printed success, `check:content` saw
  // no claim to a missing file because there was no claim at all, and 53 dishes
  // carried photographs that no page ever read. The same shape as the
  // `image-file-missing` rule that once covered one collection: write it for
  // every kind, not for the one the bug was first noticed in.
  await writeImageField(kind, slug, files, alt);

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
/**
 * Flags that take no value. Without this set the parser eats the token after
 * every flag, so `review "okra" --sheet --slug okra` swallowed `--slug` and
 * appended `okra` to the query — a silent corruption of the search term that
 * `--sheet` only avoided by being read straight off argv.
 */
const BOOLEAN_FLAGS = new Set(['sheet', 'pd']);

const positional = () => {
  const out: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!;
    if (token.startsWith('--')) {
      if (!BOOLEAN_FLAGS.has(token.slice(2))) i += 1;
      continue;
    }
    out.push(token);
  }
  return out;
};

const limit = Number(flag('limit') ?? 8);
const source = sourceOf(flag('source'));
const publicDomainOnly = rest.includes('--pd');

// A network hiccup should read as a sentence, not a stack trace.
process.on('unhandledRejection', (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

switch (command) {
  case 'search':
    await search(positional().join(' '), limit, source, publicDomainOnly);
    break;
  case 'review':
    await review(
      positional().join(' '),
      flag('slug') ?? 'unsorted',
      limit,
      rest.includes('--sheet'),
      source,
      publicDomainOnly,
    );
    break;
  case 'adopt':
    await adopt(
      positional()[0] ?? '',
      flag('slug') ?? '',
      (flag('kind') as ImageCredit['kind']) ?? 'recipe',
      flag('alt') ?? '',
      source,
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
        '\n' +
        '  --source openverse                search Openverse instead of Commons.\n' +
        '                                    Better for shop-bought pantry staples,\n' +
        '                                    which Commons barely photographs. Adopt\n' +
        '                                    by the UUID printed beside the title.\n' +
        '  --pd                              public domain only (no attribution).\n' +
        '  off <query>                       Open Food Facts, for coverage gaps\n' +
        '  off-review <barcode> --slug <s>   download and grade one of them\n' +
        '  off-adopt <barcode> --slug <s>    process and record it\n' +
        '         --kind ingredient --alt "…"\n' +
        '  list                              what has been adopted\n',
    );
}
