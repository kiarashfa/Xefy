#!/usr/bin/env node
/**
 * Runs the content integrity checks and reports everything it finds in one
 * pass. Exits non-zero on any failure, so `npm run build` and CI stop before a
 * page with a wrong number can be published.
 *
 * Usage:
 *   node scripts/integrity/run.ts                  # fail on errors, report warnings
 *   node scripts/integrity/run.ts --strict         # also fail on warnings
 *   node scripts/integrity/run.ts --content <dir>  # check a fixture set instead
 *   node scripts/integrity/run.ts --expect-failure # succeed only if problems are found
 */
import path from 'node:path';
import { loadContent, DEFAULT_CONTENT, ROOT } from '../../src/lib/content/disk.ts';
import { runChecks, type Finding } from './checks.ts';

const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
/** Inverts the exit code, so a fixture of known-bad content can be asserted on. */
const expectFailure = argv.includes('--expect-failure');
const contentFlag = argv.indexOf('--content');
const contentRoot =
  contentFlag === -1 ? DEFAULT_CONTENT : path.resolve(ROOT, argv[contentFlag + 1] ?? '');

const ANSI = {
  reset:'[0m',
  dim: '[2m',
  bold: '[1m',
  red: '[31m',
  yellow: '[33m',
  green: '[32m',
  cyan: '[36m',
};

// CI logs and piped output are read as plain text; colour there is noise.
const useColour = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const c = Object.fromEntries(
  Object.entries(ANSI).map(([key, code]) => [key, useColour ? code : '']),
) as typeof ANSI;

function group(findings: Finding[]): Map<string, Finding[]> {
  const out = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = out.get(f.file) ?? [];
    list.push(f);
    out.set(f.file, list);
  }
  return out;
}

function print(title: string, colour: string, findings: Finding[]) {
  if (findings.length === 0) return;
  console.log(`\n${colour}${c.bold}${title}${c.reset}`);
  for (const [file, list] of group(findings)) {
    console.log(`  ${c.cyan}${file}${c.reset}`);
    for (const f of list) {
      console.log(`    ${colour}•${c.reset} ${f.message} ${c.dim}[${f.check}]${c.reset}`);
    }
  }
}

const content = await loadContent(contentRoot);

if (contentRoot !== DEFAULT_CONTENT) {
  console.log(`${c.dim}Checking ${path.relative(ROOT, contentRoot) || contentRoot}${c.reset}`);
}

const counts =
  `${content.recipeVersions.length} recipe version(s), ` +
  `${content.ingredients.length} ingredient(s), ` +
  `${content.components.length} component(s), ` +
  `${content.techniques.length} technique(s)`;
console.log(`${c.bold}Content integrity${c.reset} ${c.dim}— ${counts}${c.reset}`);

if (content.schemaErrors.length > 0) {
  console.log(`\n${c.red}${c.bold}Schema violations${c.reset}`);
  for (const [file, list] of group(
    content.schemaErrors.map((e) => ({
      check: 'schema',
      severity: 'fail' as const,
      file: e.file,
      message: `${e.path}: ${e.message}`,
    })),
  )) {
    console.log(`  ${c.cyan}${file}${c.reset}`);
    for (const f of list) console.log(`    ${c.red}•${c.reset} ${f.message}`);
  }
}

const { findings, pending } = await runChecks(content);
const failures = findings.filter((f) => f.severity === 'fail');
const warnings = findings.filter((f) => f.severity === 'warn');

print('Failures', c.red, failures);
print('Warnings', c.yellow, warnings);

if (pending.length > 0) {
  console.log(`\n${c.dim}Not yet covered:${c.reset}`);
  for (const p of pending) {
    console.log(`  ${c.dim}· ${p.check} — awaiting ${p.waitingOn}${c.reset}`);
  }
}

const failureCount = failures.length + content.schemaErrors.length;
console.log('');
if (failureCount === 0 && warnings.length === 0) {
  console.log(`${c.green}✓ No integrity problems found.${c.reset}`);
} else {
  console.log(
    `${failureCount > 0 ? c.red : c.green}${failureCount} failure(s)${c.reset}, ` +
      `${warnings.length > 0 ? c.yellow : c.dim}${warnings.length} warning(s)${c.reset}`,
  );
}

const failed = failureCount > 0 || (strict && warnings.length > 0);

if (expectFailure) {
  // Used to assert that the checks still catch known-bad fixtures. A check
  // nobody has watched fire is a check nobody knows works.
  if (failed) {
    console.log(`${c.green}✓ Known-bad fixtures were caught, as expected.${c.reset}`);
    process.exit(0);
  }
  console.log(`${c.red}✗ Expected these fixtures to be caught, but nothing was found.${c.reset}`);
  process.exit(1);
}

if (failed) process.exit(1);
