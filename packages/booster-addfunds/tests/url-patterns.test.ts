import { test, expect } from 'bun:test';
import { pluginMeta } from '../src/plugin-meta';

// pluginMeta.urlPatterns is the ELIGIBILITY gate: the framework applies it ONCE
// at bootstrap (bootstrap.ts::filterEligiblePlugins against location.href) to
// decide whether the plugin runs on this page. It must match every URL form
// Steam actually loads — crucially an app page opened at `app/<id>?snr=...`
// (query string present BEFORE Steam client-side adds the SEO slug). That
// no-slug form is how /app/ pages reached from the store home first load
// (live CDP, Blasphemous 2: nav url = app/2114740?snr=1_4_4__40_1).
const matchesAny = (url: string): boolean =>
  pluginMeta.urlPatterns.some((p) => new RegExp(p).test(url));

test('app urlPattern matches /app/ pages including the query-first (no-slug) form', () => {
  expect(matchesAny('https://store.steampowered.com/app/2114740/Blasphemous_2/')).toBe(true);
  expect(matchesAny('https://store.steampowered.com/app/2114740')).toBe(true);
  expect(matchesAny('https://store.steampowered.com/app/2114740/')).toBe(true);
  expect(matchesAny('https://store.steampowered.com/app/2114740?snr=1_4_4__40_1')).toBe(true); // regression guard
  expect(matchesAny('https://store.steampowered.com/app/2114740#section')).toBe(true);
});

test('addfunds urlPattern matches the addfunds page including the query form', () => {
  expect(matchesAny('https://store.steampowered.com/steamaccount/addfunds')).toBe(true);
  expect(matchesAny('https://store.steampowered.com/steamaccount/addfunds/')).toBe(true);
  expect(matchesAny('https://store.steampowered.com/steamaccount/addfunds?from=email')).toBe(true);
});

test('cart urlPattern matches /cart/ with optional query/hash', () => {
  expect(matchesAny('https://store.steampowered.com/cart/')).toBe(true);
  expect(matchesAny('https://store.steampowered.com/cart')).toBe(true);
  expect(matchesAny('https://store.steampowered.com/cart/?foo=1')).toBe(true);
});

test('urlPatterns do NOT over-match unrelated paths', () => {
  expect(matchesAny('https://store.steampowered.com/')).toBe(false);
  expect(matchesAny('https://store.steampowered.com/appdata/123')).toBe(false); // not /app/
  expect(matchesAny('https://store.steampowered.com/app/abc')).toBe(false);     // non-numeric id
  expect(matchesAny('https://evil.com/app/123')).toBe(false);                   // wrong host
});
