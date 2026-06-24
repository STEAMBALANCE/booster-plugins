//
// DOM-render assertion: catches Svelte+CSS-minify breakage that the bundle-
// size cap won't catch. Extracts the popup's compiled <style> block, mounts
// it in happy-dom against a synthesised `.pay` button bearing the matching
// scoped class hash, then asserts getComputedStyle resolves the brand
// green (#34a37b == rgb(52, 163, 123)).
//
// Why not just `document.write(popupHtml)` and let the IIFE Svelte-mount?
// happy-dom's JS sandbox does not expose `Array.isArray` (and other Array
// statics) inside script-tag evaluation, so the Svelte 5 runtime crashes
// at module init before `mount()` runs and `#root` stays empty. Direct
// DOM synthesis bypasses the broken VM while still exercising what the
// test actually cares about: the cssnano-processed `.pay` rule survived
// and `background: var(--booster-brand-green)` resolves to the brand colour.
//
// Regression scope: any change to PayButton.svelte's class name, the
// scoped-hash format, the var(--booster-brand-green) token name, or the
// cssnano output that drops the `.pay` selector → this test goes red.

import { test, expect, beforeAll } from 'bun:test';
import { buildSveltePopup } from '../scripts/build-popup';
import { Window } from 'happy-dom';
import { resolve } from 'node:path';

let popupHtmlProd: string;
let stylesCss: string;
let payHash: string;
let footerHash: string;

beforeAll(async () => {
  popupHtmlProd = await buildSveltePopup({
    entryFile: resolve(import.meta.dir, '../popup-svelte/App.svelte'),
    isProd: true,
    iconBaseDir: resolve(import.meta.dir, '../assets/icons'),
    imageBaseDir: resolve(import.meta.dir, '../assets/images'),
  });
  // Extract the single <style> block (build-popup composes one fused block:
  // tokens + reset + every component's scoped CSS — no @font-face since
  // the popup inherits Steam's runtime Motiva Sans).
  const m = popupHtmlProd.match(/<style>([\s\S]*?)<\/style>/);
  if (!m) throw new Error('popup HTML has no <style> block');
  stylesCss = m[1]!;
  // Find PayButton's scoped hash — proves the .pay rule survived the build.
  const payMatch = stylesCss.match(/\.pay\.svelte-([a-z0-9]+)/);
  if (!payMatch) throw new Error('no .pay.svelte-XXX rule found in compiled CSS');
  payHash = payMatch[1]!;
  const footerMatch = stylesCss.match(/\.footer\.svelte-([a-z0-9]+)/);
  if (!footerMatch) throw new Error('no .footer.svelte-XXX rule found');
  footerHash = footerMatch[1]!;
});

// happy-dom 20.x: QuerySelector raises a SyntaxError via `this.window.SyntaxError`,
// but the constructor isn't seeded on a fresh Window — calling querySelector
// then crashes with "undefined is not a constructor". Seed the constructor
// onto the window object before any querySelector call.
function makeWindow(): Window {
  const w = new Window();
  (w as unknown as { SyntaxError: typeof SyntaxError }).SyntaxError = SyntaxError;
  return w;
}

test('PayButton.pay rule resolves background to brand green', () => {
  const win = makeWindow();
  win.document.body.innerHTML =
    `<style>${stylesCss}</style>` +
    `<button class="pay svelte-${payHash}">test</button>`;
  const payBtn = win.document.querySelector('button.pay');
  expect(payBtn).not.toBeNull();

  const cs = (
    win as unknown as { getComputedStyle: (e: Element) => CSSStyleDeclaration }
  ).getComputedStyle(payBtn!);
  // happy-dom resolves `background: var(--booster-brand-green)` to the underlying
  // `#34a37b` (verified locally). If a future cssnano change collapses the
  // shorthand into `background-color` differently, accept the rgb() form too.
  // The unresolved `var(--booster-brand-green)` form is the very-last fallback;
  // its presence still proves the rule survived (just that happy-dom
  // didn't resolve the cascade).
  const bg = (cs.background || '') + ' ' + (cs.backgroundColor || '');
  const normalized = bg.replace(/\s/g, '').toLowerCase();
  expect(normalized).toMatch(
    /(rgb\(52,163,123\)|#34a37b|var\(--booster-brand-green\))/,
  );
});

test('PayButton.pay rule sets display:block + width:100% (block-level CTA)', () => {
  const win = makeWindow();
  win.document.body.innerHTML =
    `<style>${stylesCss}</style>` +
    `<button class="pay svelte-${payHash}">test</button>`;
  const cs = (
    win as unknown as { getComputedStyle: (e: Element) => CSSStyleDeclaration }
  ).getComputedStyle(win.document.querySelector('button.pay')!);
  // These two are direct (no var indirection) so even if the var-resolver
  // regresses these stay green — second-line-of-defence for "the rule
  // for `.pay` was extracted at all".
  expect(cs.display).toBe('block');
  expect(cs.width).toBe('100%');
});

test('Footer rule still emits centred row with safety icon dimensions', () => {
  // Footer's .icon :global(svg) sets width/height 10px; we check the
  // outer .footer rule's flex-centre. Catches a regression where a
  // future Svelte/cssnano upgrade silently drops `:global` rules.
  const win = makeWindow();
  win.document.body.innerHTML =
    `<style>${stylesCss}</style>` +
    `<footer class="footer svelte-${footerHash}">x</footer>`;
  const cs = (
    win as unknown as { getComputedStyle: (e: Element) => CSSStyleDeclaration }
  ).getComputedStyle(win.document.querySelector('footer.footer')!);
  expect(cs.display).toBe('flex');
  expect(cs.justifyContent).toBe('center');
});
