#!/usr/bin/env bun
import { build } from 'bun';
import { mkdirSync, existsSync, readFileSync, writeFileSync, watch } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildSveltePopup } from './scripts/build-popup';
import { validatePluginMeta } from '@steambalance/booster-framework/testing';
import { pluginMeta as basePluginMeta } from './src/plugin-meta';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
// package.json::version is the only source (matches booster-addfunds).
const version: string = pkg.version as string;
const pluginMeta = { ...basePluginMeta, version };
const isProd = process.env['SB_PRODUCTION'] === '1';

// Validate at startup before doing any heavy build work.
const vr = validatePluginMeta(pluginMeta);
if (!vr.ok) {
  console.error('[booster-checkout] plugin-meta invalid:', vr.error);
  process.exit(1);
}

if (!existsSync('out')) mkdirSync('out');

async function buildOnce(): Promise<void> {
  // Inline SVG for the Steam toolbar header pill button. The 15×12 "S6" mark
  // from assets/icons/sb.svg — distinct from the wider SteamBalance wordmark
  // (logo.png) used inside the popup. Inlined at build time so the framework's
  // addHeaderButton receives a literal SVG string (rendered via innerHTML).
  const headerIconSvg = readFileSync(join(import.meta.dir, 'assets/icons/sb.svg'), 'utf-8');

  const popupHtml = await buildSveltePopup({
    entryFile: join(import.meta.dir, 'popup-svelte/App.svelte'),
    isProd,
    iconBaseDir: join(import.meta.dir, 'assets/icons'),
    imageBaseDir: join(import.meta.dir, 'assets/images'),
    // Only the plugin's own version is baked. Injector + framework
    // versions reach the popup at runtime over BC (see build-popup.ts /
    // popup-svelte/lib/headers.ts), so this bundle's bytes don't change
    // when injector/framework bump while the plugin source is untouched.
    pluginVersion: version,
  });

  const result = await build({
    entrypoints: ['src/index.ts'],
    outdir: resolve(import.meta.dir, 'out'),
    naming: `booster-checkout-${version}.js`,
    format: 'iife',
    target: 'browser',
    minify: isProd,
    sourcemap: isProd ? 'none' : 'external',
    define: {
      __SB_POPUP_HTML__:        JSON.stringify(popupHtml),
      __SB_PLUGIN_VERSION__:    JSON.stringify(version),
      __SB_PRODUCTION__:        JSON.stringify(isProd),
      __SB_HEADER_ICON_SVG__:   JSON.stringify(headerIconSvg),
    },
  });

  if (!result.success) {
    for (const m of result.logs) console.error(m);
    throw new Error('build failed');
  }

  const sidecarName = `booster-checkout-${version}.meta.json`;
  writeFileSync(
    resolve(import.meta.dir, 'out', sidecarName),
    JSON.stringify(pluginMeta, null, 2) + '\n'
  );

  console.log(`built: out/booster-checkout-${version}.js + ${sidecarName}${isProd ? ' [prod]' : ' [dev]'}`);
}

const WATCH_DEBOUNCE_MS = 100;
const SRC_DIRS = [
  resolve(import.meta.dir, 'src'),
  resolve(import.meta.dir, 'popup-svelte'),
];

async function watchAndRebuild(): Promise<void> {
  console.log('[booster-checkout build:watch] watching:', SRC_DIRS.join(', '));
  let inFlight = false;
  let pending = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function fire(): void {
    if (inFlight) { pending = true; return; }
    inFlight = true;
    void buildOnce()
      .catch((e) => { console.error('[booster-checkout build:watch] build failed:', e); })
      .finally(() => {
        inFlight = false;
        if (pending) { pending = false; fire(); }
      });
  }

  const watchers = SRC_DIRS.map((dir) =>
    watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      // Ignore generated outputs to avoid rebuild loops.
      if (filename.startsWith('generated' + (process.platform === 'win32' ? '\\' : '/'))) return;
      // Trigger on .ts/.svelte/.css/.json edits only.
      if (!/\.(ts|svelte|css|json)$/.test(filename)) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(fire, WATCH_DEBOUNCE_MS);
    }));

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      if (debounceTimer) clearTimeout(debounceTimer);
      for (const w of watchers) w.close();
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
