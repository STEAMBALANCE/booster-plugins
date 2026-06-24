// booster-plugins/packages/booster-checkout/tests/payment-methods-cache.test.ts

import { test, expect, mock, beforeEach, afterEach } from 'bun:test';
import {
  installPaymentMethodsTestEnv, uninstallPaymentMethodsTestEnv,
} from './setup-payment-methods';
import { URLS } from '../src/urls';
import {
  readCache, fetchPaymentMethods, buildImageUrl,
} from '../src/main/payment-methods';
import type { SbApi } from '@steambalance/booster-framework/api-types';

// fetchPaymentMethods now takes an SbApi so getBoosterHeaders can read
// `sb.version` for the framework-version header. Tests only need a
// `.version` field; the rest of SbApi never reaches `getBoosterHeaders`.
const SB_STUB: SbApi = { version: '2.0.0' } as unknown as SbApi;

const VALID_RESPONSE = {
  success: true,
  data: [
    { name: 'СБП',   type: 'paypalych-sbp',  image: 'sbp.svg' },
    { name: 'Карта', type: 'paypalych-card', image: 'visa.svg', badge: '~0%' },
  ],
};

let originalFetch: typeof fetch;

beforeEach(() => {
  // Snapshot fetch before any test installs a mock — afterEach restores it
  // so a mock installed in test N can't leak into test N+1's setup (and so
  // payment-methods-cache tests don't leave a stale mock behind for any
  // adjacent file under the same `bun test` invocation).
  originalFetch = globalThis.fetch;
  installPaymentMethodsTestEnv();
  // No manifest setup needed: payment-methods.ts now reads URLs from
  // the plugin's URLS constant (hardcoded in src/urls.ts), not sb.manifest.
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  uninstallPaymentMethodsTestEnv();
});

test('readCache returns [] when localStorage empty', () => {
  expect(readCache()).toEqual([]);
});

test('readCache parses valid JSON array of PaymentMethod', () => {
  localStorage.setItem('sb:paymentMethods', JSON.stringify([
    { type: 'paypalych-sbp', name: 'СБП', imageUrl: 'http://x/sbp.svg' },
  ]));
  expect(readCache()).toEqual([
    { type: 'paypalych-sbp', name: 'СБП', imageUrl: 'http://x/sbp.svg' },
  ]);
});

test('readCache returns [] for malformed JSON', () => {
  localStorage.setItem('sb:paymentMethods', '{not-json');
  expect(readCache()).toEqual([]);
});

test('readCache returns [] for non-array root', () => {
  localStorage.setItem('sb:paymentMethods', JSON.stringify({}));
  expect(readCache()).toEqual([]);
});

test('readCache filters items missing required fields', () => {
  localStorage.setItem('sb:paymentMethods', JSON.stringify([
    { type: 'a', name: 'A', imageUrl: 'http://x/a.svg' },     // valid
    { type: 'b' },                                            // missing name/url
    { name: 'C', imageUrl: 'http://x/c.svg' },                // missing type
    { type: '', name: 'D', imageUrl: 'http://x/d.svg' },      // empty type
    null,                                                     // null
    'string',                                                 // not object
  ]));
  expect(readCache()).toEqual([{ type: 'a', name: 'A', imageUrl: 'http://x/a.svg' }]);
});

test('fetchPaymentMethods success path writes cache and returns array', async () => {
  const fetchMock = mock(async (input: Request | string | URL, init?: RequestInit) => {
    // Pin: payment-methods now hits sb.manifest.urls.paymentMethodsApi
    // exactly (no string concatenation, no path templating).
    expect(String(input)).toBe(URLS.paymentMethodsApi);
    const h = (init?.headers ?? {}) as Record<string, string>;
    expect(h['x-booster']).toBe('true');
    expect(h['x-booster-injector']).toBe('1.0.0');
    expect(h['x-booster-framework']).toBe('2.0.0');
    expect(h['x-booster-plugins']).toBe('booster-checkout@3.0.0');
    return new Response(JSON.stringify(VALID_RESPONSE), { status: 200 });
  });
  (globalThis as any).fetch = fetchMock;

  const result = await fetchPaymentMethods(SB_STUB);
  expect(result).not.toBeNull();
  expect(result!.length).toBe(2);
  expect(result![0].type).toBe('paypalych-sbp');
  expect(result![0].imageUrl).toBe(`${URLS.paymentImagesBase}/sbp.svg`);
  expect(result![1].badge).toBe('~0%');

  const stored = JSON.parse(localStorage.getItem('sb:paymentMethods')!);
  expect(stored.length).toBe(2);
});

test('buildImageUrl prefixes filename with paymentImagesBase from sb.manifest', () => {
  expect(buildImageUrl('sbp.svg')).toBe(`${URLS.paymentImagesBase}/sbp.svg`);
});

test('buildImageUrl passes through absolute URL unchanged', () => {
  expect(buildImageUrl('https://cdn.example/sbp.svg')).toBe('https://cdn.example/sbp.svg');
  expect(buildImageUrl('http://cdn.example/sbp.svg')).toBe('http://cdn.example/sbp.svg');
  expect(buildImageUrl('//cdn.example/sbp.svg')).toBe('//cdn.example/sbp.svg');
});

test('fetchPaymentMethods 5xx returns null and leaves cache untouched', async () => {
  localStorage.setItem('sb:paymentMethods', JSON.stringify([
    { type: 'pre', name: 'Pre', imageUrl: 'http://x/p.svg' },
  ]));
  (globalThis as any).fetch = mock(async () => new Response('boom', { status: 500 }));

  const result = await fetchPaymentMethods(SB_STUB);
  expect(result).toBeNull();
  const stored = JSON.parse(localStorage.getItem('sb:paymentMethods')!);
  expect(stored[0].type).toBe('pre');
});

test('fetchPaymentMethods on network throw returns null', async () => {
  (globalThis as any).fetch = mock(async () => { throw new Error('boom'); });
  expect(await fetchPaymentMethods(SB_STUB)).toBeNull();
});

test('fetchPaymentMethods rejects malformed body (success=false)', async () => {
  (globalThis as any).fetch = mock(async () =>
    new Response(JSON.stringify({ success: false, data: [] }), { status: 200 }));
  expect(await fetchPaymentMethods(SB_STUB)).toBeNull();
});

test('fetchPaymentMethods rejects malformed body (data not array)', async () => {
  (globalThis as any).fetch = mock(async () =>
    new Response(JSON.stringify({ success: true, data: 'oops' }), { status: 200 }));
  expect(await fetchPaymentMethods(SB_STUB)).toBeNull();
});

test('fetchPaymentMethods filters out items missing required fields', async () => {
  (globalThis as any).fetch = mock(async () => new Response(JSON.stringify({
    success: true,
    data: [
      { name: 'Good', type: 'g', image: 'g.svg' },        // valid
      { name: 'NoType', image: 'x.svg' },                 // missing type
      { type: 'NoName', image: 'x.svg' },                 // missing name
      { name: 'NoImage', type: 'ni' },                    // missing image
    ],
  }), { status: 200 }));
  const result = await fetchPaymentMethods(SB_STUB);
  expect(result!.length).toBe(1);
  expect(result![0].type).toBe('g');
});

test('fetchPaymentMethods returns methods even if localStorage.setItem throws', async () => {
  // writeCache swallows quota-exceeded etc. to keep the in-memory result
  // path working — the next boot's fetch will try again. Pins that the
  // returned array is the same regardless of cache-write success.
  (globalThis as any).fetch = mock(async () =>
    new Response(JSON.stringify({
      success: true,
      data: [{ name: 'X', type: 'paypalych-x', image: 'x.svg' }],
    }), { status: 200 }));

  const origSetItem = localStorage.setItem;
  (localStorage as any).setItem = () => {
    throw new Error('QuotaExceededError');
  };
  try {
    const result = await fetchPaymentMethods(SB_STUB);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
    expect(result![0].type).toBe('paypalych-x');
  } finally {
    (localStorage as any).setItem = origSetItem;
  }
});

test('buildImageUrl treats javascript: as relative (prefixes CDN path)', () => {
  // The /^https?:\/\//i regex deliberately rejects javascript: so a
  // hostile manifest cannot inject an active URL via the image field.
  // The resulting URL becomes a harmless 404 against the CDN path.
  const out = buildImageUrl('javascript:alert(1)');
  expect(out.startsWith(`${URLS.paymentImagesBase}/`)).toBe(true);
});

test('buildImageUrl treats data: as relative (prefixes CDN path)', () => {
  // Same defensive policy as javascript: — only http/https/protocol-
  // relative pass through.
  const out = buildImageUrl('data:image/svg+xml,<svg/>');
  expect(out.startsWith(`${URLS.paymentImagesBase}/`)).toBe(true);
});
