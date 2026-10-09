import { test, expect } from 'bun:test';
import { fetchKeysDirect } from '../src/lib/keys-fetch';

function makeSb(fetchImpl: any) {
  return { net: { fetch: fetchImpl } } as any;
}

test('parses items from the same shape checkout\'s toKeyItem parses, and builds the right query', async () => {
  const body = { success: true, data: { items: [
    { id: 7, name: 'X', is_active: true, region_label: 'Global', package: { id: 99, product_type: 'base' }, price: 10, old_price: null, discount_percent: 0 },
  ] } };
  let gotUrl = '';
  const sb = makeSb(async (url: string) => { gotUrl = url; return { ok: true, json: async () => body }; });
  const items = await fetchKeysDirect(sb, { target: { kind: 'app', id: 1909950 }, paymentId: 'paypalych-sbp', storeCountry: 'RU' });
  expect(items).toEqual([{
    itemId: 7, name: 'X', isActive: true, regionLabel: 'Global',
    packageId: 99, packageType: null, productType: 'base', price: 10, oldPrice: null, discountPercent: 0,
  }]);
  expect(gotUrl).toContain('paymentId=paypalych-sbp');
  expect(gotUrl).toContain('appid=1909950');
  expect(gotUrl).toContain('store_country=RU');
});

test('keeps bundle offers apart from package offers via package.type', async () => {
  const body = { success: true, data: { items: [
    { id: 2266, name: 'FS25 - Year 1 Bundle', is_active: true, region_label: 'CIS', package: { type: 'bundle', id: 42206, product_type: 'game' }, price: 3702, old_price: 4037.5, discount_percent: 8 },
    { id: 2270, name: 'FS25', is_active: true, region_label: 'CIS', package: { type: 'package', id: 825695, product_type: 'game' }, price: 1789, old_price: 1950, discount_percent: 8 },
  ] } };
  const sb = makeSb(async () => ({ ok: true, json: async () => body }));
  const items = await fetchKeysDirect(sb, { target: { kind: 'app', id: 2300320 }, paymentId: 'p' });
  expect(items.map((i) => [i.packageType, i.packageId])).toEqual([['bundle', 42206], ['package', 825695]]);
});

test('omits store_country from the query when not provided', async () => {
  let gotUrl = '';
  const sb = makeSb(async (url: string) => { gotUrl = url; return { ok: true, json: async () => ({ success: true, data: { items: [] } }) }; });
  await fetchKeysDirect(sb, { target: { kind: 'app', id: 1 }, paymentId: 'p' });
  expect(gotUrl).not.toContain('store_country');
});

test('empty items array is a valid final answer, not a failure', async () => {
  const sb = makeSb(async () => ({ ok: true, json: async () => ({ success: true, data: { items: [] } }) }));
  const items = await fetchKeysDirect(sb, { target: { kind: 'app', id: 1 }, paymentId: 'p' });
  expect(items).toEqual([]);
});

test('returns [] when the response is !ok', async () => {
  const sb = makeSb(async () => ({ ok: false, json: async () => ({}) }));
  const items = await fetchKeysDirect(sb, { target: { kind: 'app', id: 1 }, paymentId: 'p' });
  expect(items).toEqual([]);
});

test('returns [] on a malformed body (no data.items array)', async () => {
  const sb = makeSb(async () => ({ ok: true, json: async () => ({ success: true }) }));
  const items = await fetchKeysDirect(sb, { target: { kind: 'app', id: 1 }, paymentId: 'p' });
  expect(items).toEqual([]);
});

test('never throws — swallows network / json-parse errors', async () => {
  const sb = makeSb(async () => { throw new Error('network down'); });
  const items = await fetchKeysDirect(sb, { target: { kind: 'app', id: 1 }, paymentId: 'p' });
  expect(items).toEqual([]);
});

// --- keys target (app / sub / bundle) ---------------------------------------
// The backend addresses each Steam id space through its own query field, so the
// page module's target must survive the trip to the wire unchanged.

test('builds a sub= query for a package (/sub/<id>) target', async () => {
  let gotUrl = '';
  const sb = makeSb(async (url: string) => { gotUrl = url; return { ok: true, json: async () => ({ success: true, data: { items: [] } }) }; });
  await fetchKeysDirect(sb, { target: { kind: 'sub', id: 1010506 }, paymentId: 'paypalych-sbp', storeCountry: 'RU' });
  expect(gotUrl).toContain('sub=1010506');
  expect(gotUrl).not.toContain('appid=');
  expect(gotUrl).not.toContain('bundle=');
});

test('builds a bundle= query for a bundle (/bundle/<id>) target', async () => {
  let gotUrl = '';
  const sb = makeSb(async (url: string) => { gotUrl = url; return { ok: true, json: async () => ({ success: true, data: { items: [] } }) }; });
  await fetchKeysDirect(sb, { target: { kind: 'bundle', id: 42206 }, paymentId: 'paypalych-sbp', storeCountry: 'RU' });
  expect(gotUrl).toContain('bundle=42206');
  expect(gotUrl).not.toContain('appid=');
  expect(gotUrl).not.toContain('sub=');
});

test('builds an appid= query for an app target', async () => {
  let gotUrl = '';
  const sb = makeSb(async (url: string) => { gotUrl = url; return { ok: true, json: async () => ({ success: true, data: { items: [] } }) }; });
  await fetchKeysDirect(sb, { target: { kind: 'app', id: 1909950 }, paymentId: 'p' });
  expect(gotUrl).toContain('appid=1909950');
});
