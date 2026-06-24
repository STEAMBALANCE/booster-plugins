#!/usr/bin/env bun
import { build } from 'bun';
import { mkdirSync, existsSync, readFileSync, writeFileSync, watch } from 'node:fs';
import { join, resolve } from 'node:path';
import { validatePluginMeta } from '@steambalance/booster-framework/testing';
import { pluginMeta as baseMeta } from './src/plugin-meta';
import { loadCss } from '../../tools/load-css';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
// Version source-of-truth: package.json::version. NO env-var override —
// release.ts also reads package.json::version; one source of truth.
const version: string = (pkg as { version: string }).version;
const pluginMeta = { ...baseMeta, version };
const isProd = process.env['SB_PRODUCTION'] === '1';

// Validate at startup before doing any heavy build work.
const vr = validatePluginMeta(pluginMeta);
if (!vr.ok) {
  console.error('[booster-addfunds] plugin-meta invalid:', vr.error);
  process.exit(1);
}

if (!existsSync('out')) mkdirSync('out');

async function buildOnce(): Promise<void> {
  // Inline logo PNG as data URI (CSP-bypass on store.steampowered.com):
  const logoBytes = readFileSync(join(import.meta.dir, 'assets/images/logo.png'));
  const logoDataUri = `data:image/png;base64,${logoBytes.toString('base64')}`;

  // Scoped TopupBar stylesheet — minified in prod (comments + whitespace
  // stripped), raw in dev. Folds the topup-bar.ts ternary so the raw text
  // import is tree-shaken out of the shipped bundle.
  const topupCss = await loadCss(resolve(import.meta.dir, 'src/components/topup-bar.css'), isProd);
  const keysCss = await loadCss(resolve(import.meta.dir, 'src/components/keys-block.css'), isProd);
  const editionOfferCss = await loadCss(resolve(import.meta.dir, 'src/components/edition-offer-chip.css'), isProd);

  const result = await build({
    entrypoints: ['src/index.ts'],
    outdir: resolve(import.meta.dir, 'out'),
    naming: `booster-addfunds-${version}.js`,
    format: 'iife',
    target: 'browser',
    minify: isProd,
    sourcemap: isProd ? 'none' : 'external',
    define: {
      __SB_ADDFUNDS_LOGO_DATA_URI__: JSON.stringify(logoDataUri),
      __SB_TOPUP_CSS__:              JSON.stringify(topupCss),
      __SB_KEYS_CSS__:               JSON.stringify(keysCss),
      __SB_EDITION_OFFER_CSS__:      JSON.stringify(editionOfferCss),
      __SB_PLUGIN_VERSION__:         JSON.stringify(version),
      __SB_PRODUCTION__:             JSON.stringify(isProd),
    },
  });

  if (!result.success) {
    for (const m of result.logs) console.error(m);
    throw new Error('build failed');
  }

  const sidecarName = `booster-addfunds-${version}.meta.json`;
  writeFileSync(
    resolve(import.meta.dir, 'out', sidecarName),
    JSON.stringify(pluginMeta, null, 2) + '\n'
  );

  console.log(`built: out/booster-addfunds-${version}.js + ${sidecarName}${isProd ? ' [prod]' : ' [dev]'}`);
}

const WATCH_DEBOUNCE_MS = 100;
const SRC_DIR = resolve(import.meta.dir, 'src');

async function watchAndRebuild(): Promise<void> {
  console.log(`[booster-addfunds build:watch] watching ${SRC_DIR}/**`);
  let inFlight = false;
  let pending = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function fire(): void {
    if (inFlight) { pending = true; return; }
    inFlight = true;
    void buildOnce()
      .catch((e) => { console.error('[booster-addfunds build:watch] build failed:', e); })
      .finally(() => {
        inFlight = false;
        if (pending) { pending = false; fire(); }
      });
  }

  const w = watch(SRC_DIR, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    // Ignore generated outputs to avoid rebuild loops.
    if (filename.startsWith('generated' + (process.platform === 'win32' ? '\\' : '/'))) return;
    // Trigger on .ts/.svelte/.css/.json edits only.
    if (!/\.(ts|svelte|css|json)$/.test(filename)) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fire, WATCH_DEBOUNCE_MS);
  });

  // Keep process alive in watch mode until Ctrl+C / SIGTERM.
  await new Promise<void>((resolve) => {
    const stop = (): void => {
      if (debounceTimer) clearTimeout(debounceTimer);
      w.close();
      resolve();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
}

async function main(): Promise<void> {
  const watchMode = process.argv.includes('--watch');
  await buildOnce();
  if (!watchMode) return;
  await watchAndRebuild();
}

if (import.meta.main) await main();
