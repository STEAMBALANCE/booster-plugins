#!/usr/bin/env bun
/**
 * gen-strings.ts — local code generator for booster-plugins' monorepo strings.
 *
 * This is the per-repo version that runs after the F.3 repo lift. It reads
 * per-package JSON sources:
 *   - packages/booster-checkout/strings/ru.json    (checkout + general)
 *   - packages/booster-addfunds/strings/ru.json    (addfunds + general)
 *
 * Emits per-package generated files:
 *   - packages/booster-checkout/src/generated/messages.ts
 *   - packages/booster-addfunds/src/generated/messages.ts
 *
 * Post-F.3 lift, the `general.*` subtree is sourced exclusively from each
 * package's own strings/ru.json — there's no root strings.json in this repo.
 * Schema matches the root gen-strings.ts at steambooster/scripts/gen-strings.ts
 * (booster-plugins subset) so output is byte-identical pre- and post-lift in the
 * case where each per-package `general` already mirrors what root used to
 * provide (the gen-strings consistency guard enforced this before the lift).
 *
 * Exit codes:
 *   0  — success
 *   1  — schema validation failure (with stderr diagnostic list)
 *   2  — filesystem failure
 *   3  — strings/ru.json missing or unreadable
 *
 * CLI: bun run scripts/gen-strings.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

function findRepoRoot(): string {
  let cur = resolve(process.cwd());
  while (true) {
    if (existsSync(`${cur}/packages/booster-checkout/strings/ru.json`)) return cur;
    if (existsSync(`${cur}/bun.lock`) || existsSync(`${cur}/.git`)) return cur;
    const parent = dirname(cur);
    if (parent === cur) {
      return process.cwd();
    }
    cur = parent;
  }
}

const REPO_ROOT = findRepoRoot();
const CHECKOUT_JSON = join(REPO_ROOT, 'packages', 'booster-checkout', 'strings', 'ru.json');
const ADDFUNDS_JSON = join(REPO_ROOT, 'packages', 'booster-addfunds', 'strings', 'ru.json');

const CHECKOUT_ALLOWED = new Set(['checkout', 'general']);
const ADDFUNDS_ALLOWED = new Set(['addfunds', 'general']);
const ALLOWED_TYPES = new Set(['string', 'number']);

type StringsDict = Record<string, unknown>;
type PluginNamespace = 'checkout' | 'addfunds';

function fail(code: number, msg: string): never {
  process.stderr.write(msg.endsWith('\n') ? msg : msg + '\n');
  process.exit(code);
}

function readJsonAt(path: string, label: string): StringsDict {
  if (!existsSync(path)) {
    fail(3, `${label} not found at ${path}`);
  }
  let raw: string;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) { fail(3, `${label} unreadable: ${e}`); }
  try { return JSON.parse(raw); }
  catch (e) { fail(1, `${label} parse error: ${e}`); }
}

function canonicalize(node: unknown): string {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    return JSON.stringify(node);
  }
  const entries = Object.entries(node as Record<string, unknown>)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => JSON.stringify(k) + ':' + canonicalize(v));
  return '{' + entries.join(',') + '}';
}

/** Verify per-package `general` subtrees are byte-for-byte identical across
 *  the two packages in this monorepo. Drift between booster-checkout/general and
 *  booster-addfunds/general would silently desync `LL.general.*` across plugins.
 *  This guard surfaces any divergence at gen-strings time with a precise diff. */
function assertGeneralBlocksConsistent(
  ckGeneral: StringsDict,
  afGeneral: StringsDict,
): void {
  const refLabel = 'packages/booster-checkout/strings/ru.json';
  const ref = canonicalize(ckGeneral);
  const afEncoded = canonicalize(afGeneral);
  if (afEncoded === ref) return;

  const lines: string[] = [
    `general.* drift detected — per-package general subtrees disagree:`,
    `  ${refLabel} general: ${ref}`,
    `  packages/booster-addfunds/strings/ru.json general: ${afEncoded}`,
    `Both per-package strings/ru.json files must carry an identical 'general' ` +
    `block. Edit each file so the 'general' subtrees match exactly, then re-run ` +
    `gen-strings.`,
  ];
  fail(1, lines.join('\n'));
}

function validate(root: StringsDict, allowed: Set<string>, label: string): void {
  const errors: string[] = [];
  const allowedList = [...allowed].join('/');

  for (const k of Object.keys(root)) {
    if (!allowed.has(k))
      errors.push(`forbidden top-level key '${k}' (allowed: ${allowedList})`);
  }
  for (const required of allowed)
    if (!(required in root)) errors.push(`missing top-level key '${required}'`);

  let leafCount = 0;
  function walk(node: unknown, path: string[]): void {
    if (typeof node === 'string') {
      leafCount++;
      const errorsBefore = errors.length;
      if (node.length === 0) errors.push(`${path.join('.')}: empty value`);
      if (/\s$/.test(node)) errors.push(`${path.join('.')}: trailing whitespace`);
      if (/\r/.test(node)) errors.push(`${path.join('.')}: contains \\r`);
      if (/\{\{|\}\}/.test(node)) errors.push(`${path.join('.')}: forbidden '{{' or '}}'`);
      if (/\$\{/.test(node)) errors.push(`${path.join('.')}: forbidden '\${'`);
      if (/\$\{?SB_|@SB_/.test(node)) errors.push(`${path.join('.')}: contains substitution-like substring`);
      if (/\|/.test(node)) errors.push(`${path.join('.')}: pipe '|' not supported in placeholders`);
      if (errors.length === errorsBefore) {
        const re = /\{([^}]+)\}/g;
        let m;
        while ((m = re.exec(node)) !== null) {
          const inner = m[1];
          const parts = inner.split(':');
          if (parts.length === 1)
            errors.push(`${path.join('.')}: untyped placeholder {${inner}} (use {name:string} or {name:number})`);
          else if (parts.length > 2)
            errors.push(`${path.join('.')}: malformed placeholder {${inner}}`);
          else if (!ALLOWED_TYPES.has(parts[1]))
            errors.push(`${path.join('.')}: unknown placeholder type '${parts[1]}'`);
        }
      }
      return;
    }
    if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
      for (const [k, v] of Object.entries(node)) {
        if (!/^[a-z][a-z0-9_]*$/.test(k))
          errors.push(`${[...path, k].join('.')}: key must match /^[a-z][a-z0-9_]*$/`);
        walk(v, [...path, k]);
      }
      return;
    }
    errors.push(`${path.join('.')}: leaf must be string, got ${typeof node}`);
  }
  for (const top of allowed)
    if (root[top] !== undefined) walk(root[top], [top]);

  if (leafCount > 500) errors.push(`total leaf count ${leafCount} exceeds 500-key cap`);

  if (errors.length > 0) fail(1, errors.map(e => `${label}: ${e}`).join('\n'));
}

function flatten(node: unknown, path: string[], out: Map<string, string>): void {
  if (typeof node === 'string') { out.set(path.join('.'), node); return; }
  if (node && typeof node === 'object')
    for (const [k, v] of Object.entries(node)) flatten(v, [...path, k], out);
}

function escapeForTsLiteral(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '\\\'')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function renderTsNode(node: unknown, indent: number): string {
  if (typeof node === 'string') return `'${escapeForTsLiteral(node)}'`;
  if (node && typeof node === 'object') {
    const entries = Object.entries(node).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    if (entries.length === 0) return '{}';
    const pad = ' '.repeat(indent * 2);
    const inner = entries.map(([k, v]) => `${pad}  ${k}: ${renderTsNode(v, indent + 1)},`).join('\n');
    return `{\n${inner}\n${pad}}`;
  }
  throw new Error(`unexpected node type: ${typeof node}`);
}

function emitTsHeader(contentsLabel: string): string[] {
  return [
    '// AUTO-GENERATED from strings/ru.json — DO NOT EDIT.',
    `// Contents: ${contentsLabel}`,
    '',
    "import type { BaseTranslation } from 'typesafe-i18n';",
    '',
  ];
}

function emitTsFooter(typeName: string): string[] {
  return [
    '',
    'export default ru;',
    `export type ${typeName} = typeof ru;`,
    '',
  ];
}

/** Emit a per-plugin TS dict (post-F.3). The plugin's primary namespace and
 *  `general.*` both come from its own `strings/ru.json` — there's no root
 *  source in this repo. */
function emitTsDictForPackage(pkgDict: StringsDict, primarySub: PluginNamespace): string {
  const primary = (pkgDict[primarySub] ?? {}) as StringsDict;
  const general = (pkgDict.general    ?? {}) as StringsDict;
  const cap = primarySub.charAt(0).toUpperCase() + primarySub.slice(1);
  const lines: string[] = [
    ...emitTsHeader(`${primarySub}.* and general.* subsets only.`),
    'const ru = {',
    `  ${primarySub}: ${renderTsNode(primary, 1)},`,
    `  general: ${renderTsNode(general, 1)},`,
    '} as const satisfies BaseTranslation;',
    ...emitTsFooter(`${cap}Translation`),
  ];
  return lines.join('\n');
}

function writeFileEnsuringDir(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

const ckDict = readJsonAt(CHECKOUT_JSON, 'packages/booster-checkout/strings/ru.json');
const afDict = readJsonAt(ADDFUNDS_JSON, 'packages/booster-addfunds/strings/ru.json');

validate(ckDict, CHECKOUT_ALLOWED, 'packages/booster-checkout/strings/ru.json');
validate(afDict, ADDFUNDS_ALLOWED, 'packages/booster-addfunds/strings/ru.json');

assertGeneralBlocksConsistent(
  (ckDict.general ?? {}) as StringsDict,
  (afDict.general ?? {}) as StringsDict,
);

try {
  writeFileEnsuringDir(
    join(REPO_ROOT, 'packages', 'booster-checkout', 'src', 'generated', 'messages.ts'),
    emitTsDictForPackage(ckDict, 'checkout'));
  writeFileEnsuringDir(
    join(REPO_ROOT, 'packages', 'booster-addfunds', 'src', 'generated', 'messages.ts'),
    emitTsDictForPackage(afDict, 'addfunds'));
} catch (e) {
  fail(2, `gen-strings: filesystem write failed: ${e}`);
}

function countTsKeys(pkg: StringsDict, primarySub: PluginNamespace): number {
  const flatPkg = new Map<string, string>();
  flatten(pkg[primarySub] ?? {}, [primarySub], flatPkg);
  const flatGeneral = new Map<string, string>();
  flatten(pkg.general ?? {}, ['general'], flatGeneral);
  return flatPkg.size + flatGeneral.size;
}

const ckCount = countTsKeys(ckDict, 'checkout');
const afCount = countTsKeys(afDict, 'addfunds');
process.stdout.write(`gen-strings: wrote checkout=${ckCount} addfunds=${afCount} TS keys\n`);
