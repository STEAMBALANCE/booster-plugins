// __tests__/build-watch.test.ts
import { test, expect, afterAll } from 'bun:test';
import { spawn } from 'bun';
import { writeFileSync, rmSync, statSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const TRIGGER_FILE = resolve(ROOT, 'src/__watch_test_trigger__.ts');
const SVELTE_TRIGGER = resolve(ROOT, 'popup-svelte/__watch_test_trigger__.svelte');

const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const outFile = resolve(ROOT, `out/booster-checkout-${pkg.version}.js`);

// The watch test intentionally runs without SB_PRODUCTION=1 to exercise the
// real watcher; dev builds emit sourcemap: 'external' → .map alongside the
// bundle. We track and clean up this file so watch tests do not leave stale
// dev artifacts that trip the assertNoSourcemapLeak guard in `just release`.
const devMapFile = `${outFile}.map`;

function cleanDevArtifacts(): void {
  try { rmSync(TRIGGER_FILE); } catch {}
  try { rmSync(SVELTE_TRIGGER); } catch {}
  try { rmSync(devMapFile); } catch {}
}

afterAll(cleanDevArtifacts);

/**
 * Wait for outFile's mtime to be newer than `since` AND stable
 * (unchanged for `stabilityMs`). Returns the stable mtime or throws on timeout.
 */
async function waitForMtimeNewerAndStable(
  since: number,
  stabilityMs: number,
  timeoutMs: number,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let lastMtime = 0;
  let stableAt = 0;

  while (Date.now() < deadline) {
    try {
      const mt = statSync(outFile).mtimeMs;
      if (mt > since) {
        if (mt !== lastMtime) {
          lastMtime = mt;
          stableAt = Date.now();
        } else if (Date.now() - stableAt >= stabilityMs) {
          return lastMtime;
        }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  if (lastMtime > since) return lastMtime; // best-effort
  throw new Error(`mtime never updated beyond ${since} within ${timeoutMs}ms`);
}

async function runWatchRebuildTest(triggerPath: string, triggerContent: string): Promise<void> {
  try { rmSync(triggerPath); } catch {}

  const testStartMs = Date.now();

  const child = spawn({
    cmd: ['bun', 'run', 'build.ts', '--watch'],
    cwd: ROOT,
    // Use 'ignore' to avoid pipe-buffer blocking the child process.
    stdout: 'ignore',
    stderr: 'ignore',
  });

  // Wait for initial build: mtime > testStartMs AND stable for 500ms (up to 12s).
  const initialMtime = await waitForMtimeNewerAndStable(testStartMs, 500, 12000);

  // Verify process is still alive (--watch keeps it running)
  expect(child.exitCode).toBeNull();

  // Trigger watcher
  writeFileSync(triggerPath, triggerContent);

  // Wait for rebuild — allow 7s (debounce 100ms + build ~3.3s + margin)
  const editDeadline = Date.now() + 7000;
  let rebuilt = false;
  while (Date.now() < editDeadline) {
    try {
      const mt = statSync(outFile).mtimeMs;
      if (mt > initialMtime) { rebuilt = true; break; }
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }

  try { rmSync(triggerPath); } catch {}
  expect(rebuilt).toBe(true);

  child.kill();
  await child.exited;

  // Remove the dev .map file immediately after each watch run so it is not
  // visible to other concurrent test files that use assertNoSourcemapLeak.
  try { rmSync(devMapFile); } catch {}
}

test('build --watch rebuilds within 7s after src edit', async () => {
  await runWatchRebuildTest(TRIGGER_FILE, `// watch trigger\n`);
}, 30000);

test('build --watch rebuilds within 7s after popup-svelte edit', async () => {
  await runWatchRebuildTest(SVELTE_TRIGGER, `<!-- watch trigger -->\n`);
}, 30000);
