// booster-plugins/packages/booster-checkout/scripts/build-popup.ts
//
// Compiles a Svelte 5 root component + scoped CSS + inlined assets into
// a single self-contained HTML string suitable for inlining into the
// booster-checkout bundle as `__SB_POPUP_HTML__` define.
//
// Two-pass build:
//   1. bun build the Svelte component → JS bundle (inlines all imports
//      including svelte runtime, svelte-preprocess'd CSS as ?raw, asset
//      strings via text loader).
//   2. Wrap into HTML template with tokens.css/reset.css inlined as <style>.
//
// Font policy: the popup deliberately ships NO webfont. Steam's CEF
// runtime exposes "Motiva Sans" to every page it hosts (verified live via
// CDP `document.fonts.check('14px "Motiva Sans"') === true` on the popup
// target). Inheriting Motiva keeps us visually indistinguishable from
// Steam's native popups (Notifications, Friends) — shipping a brand face
// like a custom brand webfont would create a subtle "different program" tell.
// Reference: feedback_steam_native_ux memory + manual sweep on 2026-05-13.
//
// Why two passes (not just bun build with HTML output): bun's HTML loader
// is for entrypoints; we want a JS bundle that becomes the inline <script>.
// Composing the wrapper ourselves lets us control <head>/<style>/<script>
// ordering precisely.

import { build } from 'bun';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadCss } from '../../../tools/load-css';
// NOTE: bun-plugin-svelte's default export is an *already-instantiated*
// plugin (`SveltePlugin({ development: true })`), not a factory. We need
// the named factory `SveltePlugin` to pass our own `preprocess` option.
import { SveltePlugin } from 'bun-plugin-svelte';

export interface BuildSveltePopupOptions {
  // Абсолютный путь до App.svelte. Sibling `main.ts` ищется автоматически
  // (resolve(dirname(entryFile), 'main.ts')) и используется как bun build
  // entrypoint — main.ts вызывает `mount(App, ...)`. App.svelte как
  // entrypoint API parameter сохраняется для read-ability (App.svelte =
  // root component, а main.ts — тривиальный mount glue).
  entryFile: string;
  isProd: boolean;          // production: minify + cssnano
  // iconBaseDir / imageBaseDir — пути до SVG icons и raster/SVG images.
  // Содержимое читается через node:fs at build time и инжектится в bundle
  // через bun `define` substitution (см. icons.ts для consumed constant
  // names). bun-plugin-svelte's pipeline не поддерживает stable-way
  // `with { type: 'text' }` import attributes для .svelte файлов, поэтому
  // define — единственный надёжный способ.
  iconBaseDir: string;
  imageBaseDir: string;
  // The plugin's OWN version, baked as a bun `define` so
  // popup-svelte/lib/headers.ts's `__SB_PLUGIN_VERSION__` resolves inside
  // the popup IIFE bundle. This is the only version baked in: it equals
  // the bundle filename version, so it changes only when the plugin
  // version changes and never drifts the immutable-CDN bytes. Injector +
  // framework versions are NOT baked — they arrive at runtime over the
  // BroadcastChannel init message (see popup-svelte/lib/headers.ts), so
  // an unchanged plugin re-builds byte-identical across injector/framework
  // releases. Optional with a test sentinel default so popup/svelte-build
  // tests that exercise buildSveltePopup directly need not plumb a version.
  pluginVersion?:    string;
}

// JSON.stringify produces a JS string literal safe for inlining as a `define`
// substitution — handles quotes, backslashes, control chars, non-ASCII.
function readSvgAsDefine(p: string): string {
  return JSON.stringify(readFileSync(p, 'utf-8'));
}
function readPngAsDataUriDefine(p: string): string {
  const bytes = readFileSync(p);
  return JSON.stringify(`data:image/png;base64,${bytes.toString('base64')}`);
}

// Bun.build and NODE_ENV are process-wide; bun test may call this helper in parallel.
let buildQueue: Promise<void> = Promise.resolve();

async function withBuildLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = buildQueue;
  let release!: () => void;
  buildQueue = new Promise<void>((resolve) => { release = resolve; });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function buildSveltePopup(opts: BuildSveltePopupOptions): Promise<string> {
  return withBuildLock(() => buildSveltePopupUnlocked(opts));
}

async function buildSveltePopupUnlocked(opts: BuildSveltePopupOptions): Promise<string> {
  const tmp = mkdtempSync(join(tmpdir(), 'booster-popup-build-'));
  try {
    // PostCSS picks up env from process.env.NODE_ENV (svelte-preprocess
    // forwards `to.from` but PostCSS plugins read NODE_ENV). Set it for
    // the duration of this build so cssnano kicks in for prod.
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = opts.isProd ? 'production' : 'development';
    try {
      // Pass 1: compile Svelte → JS bundle.
      // svelte-preprocess({postcss:true}) auto-discovers postcss.config.cjs
      // → autoprefixer + postcss-preset-env + (cssnano in prod) применяются
      // к компонентным <style> блокам.
      //
      // SVG iconки ИНЛАЙНЯТСЯ через define-substitution (см. icons.ts → читает
      // через node:fs at build time, экспортит как const string), а не через
      // bun loader options.
      //
      // Logo data-uri injected через `define` из build.ts.
      const sveltePreprocessMod: any = await import('svelte-preprocess');
      const sveltePreprocess = sveltePreprocessMod.default ?? sveltePreprocessMod.sveltePreprocess;
      // `naming` left as default — bun-plugin-svelte injects a virtual CSS
      // module per .svelte file, and a fixed name like 'popup.js' would
      // collide with the asset name. Default uses entry basename + chunks.
      //
      // Asset defines: SVG icons + logo PNG читаются через node:fs at build
      // time и инжектятся как compile-time константы. `lib/icons.ts`
      // экспортирует typed re-exports этих define-symbols.
      const iconDefs: Record<string, string> = {
        __SB_ICON_BOX__:          readSvgAsDefine(join(opts.iconBaseDir, 'box.svg')),
        __SB_ICON_CHECK__:        readSvgAsDefine(join(opts.iconBaseDir, 'check.svg')),
        __SB_ICON_CHEVRON_DOWN__: readSvgAsDefine(join(opts.iconBaseDir, 'chevron-down.svg')),
        __SB_ICON_CLOSE__:        readSvgAsDefine(join(opts.iconBaseDir, 'close.svg')),
        __SB_ICON_DOCUMENT__:     readSvgAsDefine(join(opts.iconBaseDir, 'document.svg')),
        __SB_ICON_FAQ__:          readSvgAsDefine(join(opts.iconBaseDir, 'faq.svg')),
        __SB_ICON_GEAR__:         readSvgAsDefine(join(opts.iconBaseDir, 'gear.svg')),
        __SB_ICON_SAFETY__:       readSvgAsDefine(join(opts.iconBaseDir, 'safety.svg')),
        __SB_ICON_SETTINGS__:     readSvgAsDefine(join(opts.iconBaseDir, 'settings.svg')),
        __SB_ICON_SUPPORT__:      readSvgAsDefine(join(opts.iconBaseDir, 'support.svg')),
        __SB_ICON_TELEGRAM__:     readSvgAsDefine(join(opts.iconBaseDir, 'telegram.svg')),
        __SB_IMG_LOGO_DATA_URI__: readPngAsDataUriDefine(join(opts.imageBaseDir, 'logo.png')),
        // The plugin's own version, baked for popup-svelte/lib/headers.ts.
        // Injector + framework versions are deliberately NOT baked (they
        // arrive at runtime — see headers.ts), keeping the popup bundle's
        // bytes independent of injector/framework releases. The
        // substitution also prevents a bare __SB_PLUGIN_VERSION__ token
        // from surviving into the inlined popup HTML.
        __SB_PLUGIN_VERSION__:    JSON.stringify(opts.pluginVersion ?? '0.0.0-test'),
      };
      // Sibling main.ts is the actual bun entrypoint — it calls
      // mount(App, ...). App.svelte itself is just a component module
      // (no top-level side-effects), so using it directly as entrypoint
      // would compile but never instantiate the component.
      const mainTs = resolve(dirname(opts.entryFile), 'main.ts');
      const result = await build({
        entrypoints: [mainTs],
        outdir: tmp,
        format: 'iife',          // single immediate-invoke function, all imports inlined
        target: 'browser',
        minify: opts.isProd,
        sourcemap: 'none',
        define: iconDefs,
        plugins: [SveltePlugin({
          development: !opts.isProd,
          preprocess: sveltePreprocess({ postcss: true }),
        })],
      });
      if (!result.success) {
        // Bun's BuildLog has .message — use it (String(l) gives '[object Object]').
        const errors = result.logs.map((l: { message?: string }) => l.message ?? String(l)).join('\n');
        throw new Error(`Svelte build failed:\n${errors}`);
      }

      // Pull the JS entry from build outputs (path is OS-specific; use the
      // BuildArtifact directly so we don't have to guess the basename).
      const jsArtifact = result.outputs.find(o => o.kind === 'entry-point');
      if (!jsArtifact) {
        throw new Error('Svelte build produced no entry-point output');
      }
      const jsBundle = await jsArtifact.text();

      // Collect Svelte component scoped CSS — bun-plugin-svelte extracts
      // each .svelte's <style> block into a virtual CSS module that bun
      // emits as a separate `asset` output. Without this collection the
      // popup HTML's <style> block ends up containing ONLY tokens.css +
      // reset.css; every component visual rule (PayButton brand-green bg,
      // MethodPicker chevron rotation, InfoRow dotted leader, etc.)
      // silently disappears.
      const cssAssets = result.outputs.filter(
        o => o.kind === 'asset' && o.path.endsWith('.css')
      );
      // Component <style> blocks are already cssnano-minified in prod (via the
      // svelte-preprocess PostCSS pipeline) — internally newline-free, each part
      // may carry a trailing newline. In dev join with '\n' for readability; in
      // prod trim each part's trailing newline(s) then join with '' so the
      // composed <style> has zero line breaks. Per-part trailing trim (not a
      // blanket \n strip) so a future component with a multiline string value /
      // url() can't be silently corrupted.
      const componentParts = await Promise.all(cssAssets.map(a => a.text()));
      const componentCss = opts.isProd
        ? componentParts.map(p => p.replace(/\n+$/, '')).join('')
        : componentParts.join('\n');

      // tokens.css + reset.css are plain CSS-vars/reset (not component scoped
      // styles, so they skip the svelte-preprocess pipeline). Minify them
      // directly in prod — strips their comments + whitespace — and keep raw
      // in dev for readable injected <style> debugging.
      const stylesDir = resolve(dirname(opts.entryFile), 'styles');
      const tokensCss = await loadCss(join(stylesDir, 'tokens.css'), opts.isProd);
      const resetCss = await loadCss(join(stylesDir, 'reset.css'), opts.isProd);

      // Compose final HTML wrapper. No @font-face block — Motiva Sans is loaded
      // by Steam's CEF runtime (see header comment). In prod the HTML scaffold
      // and <style> collapse to a single line; the already-minified Svelte JS
      // bundle is inlined as-is (bun keeps its own internal line breaks). Dev
      // keeps it readable.
      const title = 'Пополнение баланса';
      const html = opts.isProd
        ? `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title><style>${tokensCss}${resetCss}${componentCss}</style></head><body><div id="root"></div><script>${jsBundle}</script></body></html>`
        : `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
${tokensCss}
${resetCss}
${componentCss}
</style>
</head>
<body>
<div id="root"></div>
<script>
${jsBundle}
</script>
</body>
</html>`;
      return html;
    } finally {
      // Restore NODE_ENV so we don't leak across calls (test harness
      // composes dev + prod in the same process).
      if (prevEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevEnv;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
