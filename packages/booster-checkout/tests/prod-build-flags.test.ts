/**
 * Regression guard: production build must not ship a sourcemap file.
 *
 * Root cause of the original bug: build.ts had
 *   sourcemap: isProd ? 'external' : 'inline'
 * which is inverted — 'external' generates a .map file and should be
 * used only in dev. Production must use 'none'. Fixed in Phase 9.
 *
 * This test runs `bun run build.ts` with SB_PRODUCTION=1 and asserts
 * that no .map file appears alongside the output bundle. The inverse
 * (dev build emits .map) is verified by the existing prod-build-flags
 * test in booster-addfunds, and transitively by any dev run of build.ts.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CHECKOUT_ROOT = resolve(import.meta.dir, '..');
const OUT_DIR = join(CHECKOUT_ROOT, 'out');

// Bundle filename embeds package.json::version (see build.ts) — read the
// version from the same source so a version bump doesn't break this test.
const PKG_VERSION = (
  JSON.parse(readFileSync(join(CHECKOUT_ROOT, 'package.json'), 'utf8')) as {
    version: string;
  }
).version;
const BUNDLE = join(OUT_DIR, `booster-checkout-${PKG_VERSION}.js`);
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
    cwd: CHECKOUT_ROOT,
    env: { ...process.env, SB_PRODUCTION: '1' },
    stdio: 'pipe',
  });
  expect(r.status).toBe(0);
  // Bundle must exist.
  expect(existsSync(BUNDLE)).toBe(true);
  // .map must NOT exist — a sourcemap leak would expose production source.
  expect(existsSync(MAP_FILE)).toBe(false);
});
