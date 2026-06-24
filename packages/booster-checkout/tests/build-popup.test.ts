// Smoke-test что buildSveltePopup возвращает HTML строку с inlined CSS+JS.
import { test, expect } from 'bun:test';
import { buildSveltePopup } from '../scripts/build-popup';
import { resolve } from 'node:path';

const opts = {
  entryFile: resolve(import.meta.dir, '../popup-svelte/App.svelte'),
  iconBaseDir: resolve(import.meta.dir, '../assets/icons'),
  imageBaseDir: resolve(import.meta.dir, '../assets/images'),
};

test('buildSveltePopup returns valid HTML containing token + scoped class hash', async () => {
  const popupHtml = await buildSveltePopup({ ...opts, isProd: false });
  // basic shape
  expect(popupHtml).toContain('<!DOCTYPE html>');
  expect(popupHtml).toContain('<style>');
  expect(popupHtml).toContain('<script>');
  // CSS-token survived the pipeline
  expect(popupHtml).toContain('--booster-brand-green');
  // Svelte scoped class hash присутствует — proof что Svelte скомпилировался
  expect(popupHtml).toMatch(/svelte-[a-z0-9]{6,}/);
  // No webfont shipped — popup inherits Steam runtime "Motiva Sans".
  // (Detailed font-policy assertions live in popup-html.test.ts.)
  expect(popupHtml).not.toContain('fonts.googleapis.com');
  expect(popupHtml).not.toContain('@font-face');
});

test('popup bundle carries NO injector/framework version tokens (runtime-only)', async () => {
  // Immutable-CDN byte-stability guard: injector + framework versions are
  // delivered at runtime via window.__SB_BOOSTER_VERSIONS__ (bridge.ts), so
  // they must never be baked into the popup bundle — otherwise a framework/
  // injector bump would change the plugin's bytes without a plugin version
  // bump. A bare (unsubstituted) token surviving here would also be a dead
  // undefined identifier at runtime. Prod build = the shipped shape.
  const popupHtml = await buildSveltePopup({ ...opts, isProd: true });
  expect(popupHtml).not.toContain('__SB_INJECTOR_VERSION__');
  expect(popupHtml).not.toContain('__SB_FRAMEWORK_VERSION__');
});

test('buildSveltePopup includes autoprefixer output (PostCSS pipeline check)', async () => {
  // Catches silent regression if svelte-preprocess({postcss:true}) doesn't
  // pass component <style> through autoprefixer. Per code-review M-5.
  const popupHtml = await buildSveltePopup({ ...opts, isProd: true });
  // user-select / appearance / etc. typically picks up -webkit- prefix.
  expect(popupHtml).toMatch(/-webkit-(user-select|appearance)/);
});

test('buildSveltePopup production build is smaller than dev', async () => {
  const dev  = await buildSveltePopup({ ...opts, isProd: false });
  const prod = await buildSveltePopup({ ...opts, isProd: true });
  expect(prod.length).toBeLessThan(dev.length);
});

test('buildSveltePopup inlines Svelte component scoped CSS', async () => {
  // Regression coverage: bun-plugin-svelte extracts component <style>
  // blocks into a separate CSS asset. Without explicit collection in
  // build-popup.ts they get silently dropped — ALL component visual
  // styling disappears (PayButton.bg, MethodPicker.menu position, etc.).
  // (Caught originally by spec review at commit 02ab245.)
  //
  // Assertions use stable markers that survive PostCSS:
  //   - scoped class hash on PayButton's `.pay` selector (proof bundle has
  //     compiled component output, not just tokens.css/reset.css)
  //   - radial-gradient (InfoRow's dotted leader, unique to this component)
  //   - rotate(180deg) (MethodPicker's chevron-on-open)
  // (rgba() and hex colours are postcss-preset-env-transformed in both
  // dev and prod, so we don't assert on raw colour syntax here.)
  const popupHtml = await buildSveltePopup({ ...opts, isProd: false });
  expect(popupHtml).toMatch(/\.pay\.svelte-[a-z0-9]+/);
  expect(popupHtml).toContain('radial-gradient');
  expect(popupHtml).toContain('rotate(180deg)');
});
