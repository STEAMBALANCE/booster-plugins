//
// Tests on the assembled popup HTML (output of buildSveltePopup) — string-
// level assertions on what got inlined. Behavioral state-machine tests
// live in popup-svelte/__tests__/{state,api,bridge}.test.ts; this file
// only asserts that the right artefacts ended up in the production HTML.
//
// Mapping table (per phase-f-tests-cleanup.md / spec § 6.2):
// - Preserved (rephrased): wire kinds (init/email/popup-postMessage/
//   popup-message/sb_cmd/sb_topup), Russian labels, support row visibility.
// - Transformed: init payload field set (no paymentIds — those arrive on a
//   separate payment-methods BC kind from the dynamic /api/payments fetch).
// - Retired: legacy currency-selector RUB/KZT/USD options, type=number
//   amount-input markup, BroadcastChannel literal call-site (now lives in
//   bridge.ts and is unit-tested there), monotonic calcId guard (api.ts
//   test), x-booster header wire (api.ts test), email closure-state line
//   (bridge.ts test), pendingPay state-machine (state.test.ts).
// - New: brand-token survival, NO webfont shipped (popup inherits Steam's
//   runtime Motiva Sans), Svelte scoped class hash, inline SVG markers,
//   prod < dev size, prod ≤ 120 KB cap.
//
// Behavioral coverage retained elsewhere:
// - Calc API debounce 400ms, monotonic calcId, x-booster headers + no
//   is_booster body field: popup-svelte/__tests__/api.test.ts
// - Two-phase init+email gating, pendingPay drain, spurious-empty guard:
//     popup-svelte/__tests__/bridge.test.ts
// - Currency fallback "—", TotalBox hidden on unknown balance, method
//   picker switch, menu open/close: popup-svelte/__tests__/state.test.ts

import { test, expect, beforeAll } from 'bun:test';
import { buildSveltePopup } from '../scripts/build-popup';
import { resolve } from 'node:path';

let popupHtmlDev: string;
let popupHtmlProd: string;

beforeAll(async () => {
  const opts = {
    entryFile: resolve(import.meta.dir, '../popup-svelte/App.svelte'),
    iconBaseDir: resolve(import.meta.dir, '../assets/icons'),
    imageBaseDir: resolve(import.meta.dir, '../assets/images'),
  };
  popupHtmlDev  = await buildSveltePopup({ ...opts, isProd: false });
  popupHtmlProd = await buildSveltePopup({ ...opts, isProd: true });
});

// HTML structural integrity ------------------------------------------------

test('popup HTML is valid (DOCTYPE + <html lang="ru">)', () => {
  expect(popupHtmlDev).toMatch(/^<!DOCTYPE html>/);
  expect(popupHtmlDev).toContain('<html lang="ru">');
});

test('popup HTML mounts root via #root + <script>', () => {
  expect(popupHtmlDev).toContain('<div id="root"></div>');
  expect(popupHtmlDev).toContain('<script>');
});

// Brand tokens survive build pipeline -------------------------------------

test('CSS tokens (--booster-brand-green, --booster-surface-0) inlined', () => {
  expect(popupHtmlDev).toContain('--booster-brand-green');
  expect(popupHtmlDev).toContain('--booster-surface-0');
});

test('brand color #34a37b in rendered output', () => {
  expect(popupHtmlDev).toContain('#34a37b');
});

// Font policy: NO webfont shipped — popup inherits Steam's runtime
// "Motiva Sans". A regression that re-introduces a webfont (Google CDN
// or self-hosted base64) is a "different program" tell and must be loud.

test('NO @font-face block (popup inherits Steam runtime "Motiva Sans")', () => {
  expect(popupHtmlDev).not.toContain('@font-face');
  expect(popupHtmlProd).not.toContain('@font-face');
});

test('NO data:font/woff2 inlined (no shipped webfont bytes)', () => {
  expect(popupHtmlDev).not.toContain('data:font/woff2');
  expect(popupHtmlProd).not.toContain('data:font/woff2');
});

test('NO Google Fonts CDN reference (regional throttling/privacy guard)', () => {
  expect(popupHtmlDev).not.toContain('fonts.googleapis.com');
  expect(popupHtmlDev).not.toContain('fonts.gstatic.com');
});

test('NO Nunito Sans reference (Motiva-only font stack)', () => {
  expect(popupHtmlDev).not.toContain('Nunito Sans');
  expect(popupHtmlProd).not.toContain('Nunito Sans');
});

test('Motiva Sans appears in font-stack (Steam-native face)', () => {
  expect(popupHtmlDev).toContain('Motiva Sans');
});

// Svelte compilation verification -----------------------------------------

test('Svelte scoped class hash present (proof svelte/compiler ran)', () => {
  expect(popupHtmlDev).toMatch(/svelte-[a-z0-9]{6,}/);
});

// Russian copy survives minification --------------------------------------

test('all user-visible Russian labels survive minify', () => {
  for (const html of [popupHtmlDev, popupHtmlProd]) {
    // Header
    expect(html).toContain('МЕНЮ');
    // Amount input placeholder (Figma mockup leftover "500" was replaced
    // by this localised prompt — pin it so a regression to "500" or
    // similar mockup-string is loud).
    expect(html).toContain('Введите сумму');
    // Info rows
    expect(html).toContain('Логин:');
    expect(html).toContain('Получите:');
    // Total
    expect(html).toContain('Итого на балансе будет');
    // Pay button base label (Svelte strings preserved as-is by the runtime;
    // formatted variants like "Оплатить 100 ₽" are composed at runtime).
    expect(html).toContain('Оплатить');
    // Bounds-violation copy is no longer client-side — the backend supplies
    // `data.notice` on /api/balance/calc, which we render verbatim. No HTML
    // pin for that string (it never appears in the static popup template).
    // Footer
    expect(html).toContain('Безопасно и конфиденциально');
    // Menu rows (uppercase as in Figma)
    expect(html).toContain('ПОДДЕРЖКА');
    expect(html).toContain('МОИ ЗАКАЗЫ');
    expect(html).toContain('НАСТРОЙКИ');
  }
});

// Amount input attributes (preserved per spec § 6.2 mapping table) -------

test('amount input has inputmode=numeric + pattern="\\d*" (positive-integer guard)', () => {
  // The intent: amount input MUST reject non-digit characters (e/+/-/.)
  // even via paste / IME / programmatic set. The actual filtering layer
  // is the oninput handler in AmountRow.svelte (handleInput) — it strips
  // non-digits from the element value, writes the cleaned value back,
  // and only forwards positive integers to state. The two HTML attrs
  // (inputmode + pattern) are autofill / mobile-keypad hints, not active
  // guards: pattern only matters for :invalid styling on form submit,
  // and this popup has no form. type="number" was rejected because
  // Chromium reports value="" for visually-invalid input ("5e"), so the
  // strip handler can't see the garbage to erase it.
  // Pin both attrs here so a Svelte upgrade silently dropping unknown
  // attrs is loud, not silent. Note: popupHtmlProd contains the compiled
  // Svelte JS bundle inside <script>, so `pattern="\d*"` from the .svelte
  // source appears in the bundle as JS-source-escaped `pattern="\\d*"`
  // (two literal backslashes). Match that exact form.
  expect(popupHtmlProd).toContain('inputmode="numeric"');
  expect(popupHtmlProd).toMatch(/pattern="\\\\d\*"/);
});

// Wire strings survive minify (BC contract preservation) ------------------

test('wire-protocol strings survive build (BC channel + popup id + kinds)', () => {
  for (const html of [popupHtmlDev, popupHtmlProd]) {
    // BC channel + popup id
    expect(html).toContain('sb_cmd');
    expect(html).toContain('sb_topup');
    // Envelope kinds (popup ↔ main shell)
    expect(html).toContain('popup-postMessage');
    expect(html).toContain('popup-message');
    // Inbound kinds (main → popup)
    expect(html).toContain('init');
    expect(html).toContain('email');
    // 'shown' fires on popup re-open (after Steam closes it via
    // hideOnBlur) — drives the transient-state reset + focus-input in
    // bridge.ts. 'hidden' fires when Steam hides the popup, driving the
    // proactive reset so the next re-open paints from a clean slate
    // (no visible "dropdowns close on their own" flash on slow PCs).
    // A regression to a different kind would silently break the
    // clean-slate UX on re-open.
    expect(html).toContain('shown');
    expect(html).toContain('hidden');
    // Outbound kinds (popup → main)
    expect(html).toContain('navigate');
    expect(html).toContain('support');
    expect(html).toContain('menu-action');
    // menu-action sub-actions
    expect(html).toContain('orders');
    expect(html).toContain('settings');
  }
});

// Inline SVG icons embedded -----------------------------------------------

test('inline SVG icons (chevron 8x8, box/settings/gear 12x12) present', () => {
  // chevron-down.svg = viewBox 0 0 8 8
  expect(popupHtmlDev).toContain('viewBox="0 0 8 8"');
  // box.svg + settings.svg + gear.svg + safety.svg all use viewBox 0 0 12 12
  expect(popupHtmlDev).toContain('viewBox="0 0 12 12"');
});

test('inline SVG markup present (chevron/box/gear/etc. embedded as <svg>)', () => {
  // Sanity check: at least one <svg ...> tag survived the minify/CSS pipeline.
  // The popup-internal SVGs (chevron-down, box, gear, safety, settings,
  // support) stay inline; method icons (SBP/Card etc.) now load from CDN
  // via <img src>. The structural shape is what we pin.
  expect(popupHtmlDev).toMatch(/<svg[^>]*>/);
});

// Production minify proportions -------------------------------------------

test('production HTML smaller than dev', () => {
  expect(popupHtmlProd.length).toBeLessThan(popupHtmlDev.length);
});

// Bundle size cap (POPUP_HTML_MAX_BYTES = 256 KB framework-side; we cap 120 KB)
test('production popup HTML ≤ 120 KB', () => {
  expect(popupHtmlProd.length).toBeLessThan(120 * 1024);
});
