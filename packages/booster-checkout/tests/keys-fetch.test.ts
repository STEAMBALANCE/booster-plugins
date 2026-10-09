import { describe, test, expect } from 'bun:test';
import { fetchKeys } from '../src/main/keys-fetch';

const ALAN = { success: true, data: { items: [
  { id: 1988, name: 'Alan Wake (global)', is_active: true, app_id: 108710, region_label: 'Global',
    package: { type: 'package', id: 13533, product_type: 'base' }, price: 129.58, old_price: null, discount_percent: 0 },
  { id: 1987, name: 'AN', is_active: true, app_id: 108710, region_label: 'Global',
    package: null, price: 73.71, old_price: 99.0, discount_percent: 26 },
  { bad: 'no id' },
]}};

// Fake `sb.net.fetch` seam (replaces the old raw fetchImpl 3rd arg). Captures
// the URL + method it was called with in `state` for assertions.
function fakeSb(body: unknown, ok = true) {
  const state = { url: '', method: undefined as string | undefined };
  const sb = {
    version: '1.0.0',
    net: {
      fetch: async (url: string, init?: { method?: string }) => {
        state.url = url;
        state.method = init?.method;
        return { ok, status: ok ? 200 : 500, headers: {}, json: async () => body, text: async () => '' };
      },
    },
  } as any;
  return { sb, state };
}

describe('fetchKeys', () => {
  test('parses items, drops malformed, maps fields', async () => {
    const { sb, state } = fakeSb(ALAN);
    const items = await fetchKeys(sb, { target: { kind: 'app', id: 108710 }, paymentId: 'paypalych-sbp', storeCountry: 'RU' });
    expect(items.length).toBe(2);
    expect(items[0]).toEqual({ itemId: 1988, name: 'Alan Wake (global)', isActive: true, regionLabel: 'Global',
      packageId: 13533, packageType: 'package', productType: 'base', price: 129.58, oldPrice: null, discountPercent: 0 });
    expect(items[1].packageId).toBeNull();
    expect(items[1].packageType).toBeNull();
    expect(items[1].oldPrice).toBe(99.0);
    expect(state.url).toContain('store_country=RU');
    expect(state.url).toContain('appid=108710');
    expect(state.url).toContain('paymentId=paypalych-sbp');
    expect(state.method).toBe('GET');
  });
  test('omits store_country when undefined', async () => {
    const { sb, state } = fakeSb({ success: true, data: { items: [] } });
    await fetchKeys(sb, { target: { kind: 'app', id: 1 }, paymentId: 'p' });
    expect(state.url).not.toContain('store_country');
  });
  test('http error → []', async () => {
    const { sb } = fakeSb(null, false);
    expect(await fetchKeys(sb, { target: { kind: 'app', id: 1 }, paymentId: 'p' })).toEqual([]);
  });

  // Verbatim sample from the updated backend (GET steam_keys?appid=108710).
  // Locks in that the extra fields (is_quick_purchase, steam_*, image,
  // category_id, discount_end) are ignored and every consumed field still maps
  // correctly. Catalog responses carry no order uid — uid only comes from the
  // POST purchase (see keys-order.ts).
  test('parses the updated backend catalog shape', async () => {
    const LIVE = { success: true, data: { name: 'Steam Keys', short_name: 'steam_keys', is_visible: 0, categories: [], items: [
      { id: 1986, name: "Alan Wake Collector’s Edition", is_active: true, is_quick_purchase: false, category_id: null, image: null, app_id: 108710, region_label: 'Global', package: { type: 'package', id: 13535, product_type: 'game' }, steam_price: 104, steam_old_price: 699, steam_discount_percent: 85, steam_discount_end: 1783616400, price: 163.59, old_price: 699, discount_percent: 77 },
      { id: 1987, name: "Alan Wake’s American Nightmare", is_active: true, is_quick_purchase: false, category_id: null, image: null, app_id: 108710, region_label: 'Global', package: { type: 'package', id: 14562, product_type: 'game' }, steam_price: 52, steam_old_price: 350, steam_discount_percent: 85, steam_discount_end: 1783616400, price: 77.13, old_price: 350, discount_percent: 78 },
      { id: 1988, name: 'Alan Wake', is_active: true, is_quick_purchase: false, category_id: null, image: null, app_id: 108710, region_label: 'Global', package: { type: 'package', id: 13533, product_type: 'game' }, steam_price: 82, steam_old_price: 549, steam_discount_percent: 85, steam_discount_end: 1783616400, price: 135.62, old_price: 549, discount_percent: 75 },
    ]}};
    const { sb } = fakeSb(LIVE);
    const items = await fetchKeys(sb, { target: { kind: 'app', id: 108710 }, paymentId: 'paypalych-sbp', storeCountry: 'RU' });
    expect(items.length).toBe(3);
    expect(items[0]).toEqual({ itemId: 1986, name: "Alan Wake Collector’s Edition", isActive: true, regionLabel: 'Global', packageId: 13535, packageType: 'package', productType: 'game', price: 163.59, oldPrice: 699, discountPercent: 77 });
    expect(items[1]).toEqual({ itemId: 1987, name: "Alan Wake’s American Nightmare", isActive: true, regionLabel: 'Global', packageId: 14562, packageType: 'package', productType: 'game', price: 77.13, oldPrice: 350, discountPercent: 78 });
    expect(items[2]).toEqual({ itemId: 1988, name: 'Alan Wake', isActive: true, regionLabel: 'Global', packageId: 13533, packageType: 'package', productType: 'game', price: 135.62, oldPrice: 549, discountPercent: 75 });
  });

  // Verbatim sample from GET steam_keys?appid=2300320 (Farming Simulator 25):
  // two bundle offers + one package offer for the same app. `package.type` is
  // what tells the two id spaces apart — 42206/56040 are BUNDLE ids, 825695 is
  // a sub id — so it must survive the parse (addfunds matches on it).
  test('carries package.type through for bundle offers', async () => {
    const FS25 = { success: true, data: { name: 'Steam Keys', short_name: 'steam_keys', is_visible: 0, categories: [], items: [
      { id: 2266, name: 'Farming Simulator 25 - Year 1 Bundle', is_active: true, is_quick_purchase: false, category_id: null, image: null, app_id: 2300320, region_label: 'СНГ', package: { type: 'bundle', id: 42206, product_type: 'game' }, steam_price: 4037.5, steam_old_price: null, steam_discount_percent: 0, steam_discount_end: null, price: 3702, old_price: 4037.5, discount_percent: 8 },
      { id: 2269, name: 'Farming Simulator 25 - Highlands Fishing Edition', is_active: true, is_quick_purchase: false, category_id: null, image: null, app_id: 2300320, region_label: 'СНГ', package: { type: 'bundle', id: 56040, product_type: 'game' }, steam_price: 3340.75, steam_old_price: null, steam_discount_percent: 0, steam_discount_end: null, price: 3064, old_price: 3340.75, discount_percent: 8 },
      { id: 2270, name: 'Farming Simulator 25', is_active: true, is_quick_purchase: false, category_id: null, image: null, app_id: 2300320, region_label: 'СНГ', package: { type: 'package', id: 825695, product_type: 'game' }, steam_price: 1950, steam_old_price: null, steam_discount_percent: 0, steam_discount_end: null, price: 1789, old_price: 1950, discount_percent: 8 },
    ]}};
    const { sb } = fakeSb(FS25);
    const items = await fetchKeys(sb, { target: { kind: 'app', id: 2300320 }, paymentId: 'paypalych-sbp', storeCountry: 'RU' });
    expect(items.map((i) => [i.packageType, i.packageId])).toEqual([
      ['bundle', 42206], ['bundle', 56040], ['package', 825695],
    ]);
  });

  test('unknown / missing package.type → null (never guessed)', async () => {
    const { sb } = fakeSb({ success: true, data: { items: [
      { id: 1, name: 'no type', is_active: true, package: { id: 10, product_type: 'game' }, price: 1, discount_percent: 0 },
      { id: 2, name: 'junk type', is_active: true, package: { type: 'subscription', id: 11, product_type: 'game' }, price: 1, discount_percent: 0 },
    ]}});
    const items = await fetchKeys(sb, { target: { kind: 'app', id: 1 }, paymentId: 'p' });
    expect(items.map((i) => i.packageType)).toEqual([null, null]);
  });
});

// One query field per Steam id space — sending the wrong one returns another
// product's keys (the sub and bundle id spaces overlap numerically).
describe('fetchKeys — keys target', () => {
  test('builds a sub= query for a package target', async () => {
    const { sb, state } = fakeSb({ success: true, data: { items: [] } });
    await fetchKeys(sb, { target: { kind: 'sub', id: 1010506 }, paymentId: 'p', storeCountry: 'RU' });
    expect(state.url).toContain('sub=1010506');
    expect(state.url).not.toContain('appid=');
  });

  test('builds a bundle= query for a bundle target', async () => {
    const { sb, state } = fakeSb({ success: true, data: { items: [] } });
    await fetchKeys(sb, { target: { kind: 'bundle', id: 42206 }, paymentId: 'p' });
    expect(state.url).toContain('bundle=42206');
    expect(state.url).not.toContain('appid=');
  });

  test('builds an appid= query for an app target', async () => {
    const { sb, state } = fakeSb({ success: true, data: { items: [] } });
    await fetchKeys(sb, { target: { kind: 'app', id: 108710 }, paymentId: 'p' });
    expect(state.url).toContain('appid=108710');
  });
});
