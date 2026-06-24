/**
 * Regression guard: production build must not ship a sourcemap file.
 *
 * build.ts uses `sourcemap: isProd ? 'none' : 'external'` — production
 * emits no .map, dev emits an external one. A .map file would expose
 * production source, so this test pins the prod behavior.
 *
 * This test runs `bun run build.ts` with SB_PRODUCTION=1 and asserts
 * that no .map file appears alongside the output bundle. The inverse
 * (dev build emits .map) is verified by any dev run of build.ts.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ADDFUNDS_ROOT = resolve(import.meta.dir, '..');
const OUT_DIR = join(ADDFUNDS_ROOT, 'out');

// Bundle filename embeds package.json::version (see build.ts) — read the
// version from the same source so a version bump doesn't break this test.
const PKG_VERSION = (
  JSON.parse(readFileSync(join(ADDFUNDS_ROOT, 'package.json'), 'utf8')) as {
    version: string;
  }
).version;
const BUNDLE = join(OUT_DIR, `booster-addfunds-${PKG_VERSION}.js`);
const MAP_FILE = `${BUNDLE}.map`;

beforeAll(() => {
  // Remove any stale .map file so the assertion measures the build output,
  // not a leftover from a previous dev build.
  if (existsSync(MAP_FILE)) rmSync(MAP_FILE);
});

afterAll(() => {
  // Clean up map file if somehow created (shouldn't happen with correct fix).
  if (existsSync(MAP_FILE)) rmSync(MAP_FILE);
});

test('production build (SB_PRODUCTION=1) does not emit a sourcemap file', () => {
  if (existsSync(MAP_FILE)) rmSync(MAP_FILE);
  const r = spawnSync('bun', ['run', 'build.ts'], {
    cwd: ADDFUNDS_ROOT,
    env: { ...process.env, SB_PRODUCTION: '1' },
    stdio: 'pipe',
  });
  expect(r.status).toBe(0);
  expect(existsSync(BUNDLE)).toBe(true);
  // .map must NOT exist — a sourcemap leak would expose production source.
  expect(existsSync(MAP_FILE)).toBe(false);

  // Inlined scoped stylesheet ships minified: the __SB_TOPUP_CSS__ define
  // folds in the CSS-minified copy and the raw `type: 'text'` import is
  // tree-shaken out. A source-only comment fragment must NOT survive, and the
  // selector must be minified (no space before `{`).
  const bundle = readFileSync(BUNDLE, 'utf8');
  expect(bundle).not.toContain('Top edge alignment');
  expect(bundle).not.toContain('__SB_TOPUP_CSS__');
  expect(bundle).toContain('#booster-topup-bar{');

  // Same folding contract for the keys-block stylesheet: the __SB_KEYS_CSS__
  // define must fold in the CSS-minified copy and the raw define must not
  // survive, with the selector minified (no space before `{`).
  expect(bundle).not.toContain('__SB_KEYS_CSS__');
  expect(bundle).toContain('#booster-keys-block{');
});
