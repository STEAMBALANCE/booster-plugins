import { describe, test, expect } from 'bun:test';
import { fetchKeys } from '../src/main/keys-fetch';

const sb = { version: '1.0.0' } as any;
const ALAN = { success: true, data: { items: [
  { id: 1988, name: 'Alan Wake (global)', is_active: true, app_id: 108710, region_label: 'Global',
    package: { type: 'package', id: 13533, product_type: 'base' }, price: 129.58, old_price: null, discount_percent: 0 },
  { id: 1987, name: 'AN', is_active: true, app_id: 108710, region_label: 'Global',
    package: null, price: 73.71, old_price: 99.0, discount_percent: 26 },
  { bad: 'no id' },
]}};
function fakeFetch(body: unknown, ok = true) {
  const fn = async (url: string) => {
    (fn as any).url = url;
    return { ok, json: async () => body };
  };
  return fn as any;
}

describe('fetchKeys', () => {
  test('parses items, drops malformed, maps fields', async () => {
    const f = fakeFetch(ALAN);
    const items = await fetchKeys(sb, { appid: 108710, paymentId: 'paypalych-sbp', storeCountry: 'RU' }, f);
    expect(items.length).toBe(2);
    expect(items[0]).toEqual({ itemId: 1988, name: 'Alan Wake (global)', isActive: true, regionLabel: 'Global',
      packageId: 13533, productType: 'base', price: 129.58, oldPrice: null, discountPercent: 0 });
    expect(items[1].packageId).toBeNull();
    expect(items[1].oldPrice).toBe(99.0);
    expect((f as any).url).toContain('store_country=RU');
    expect((f as any).url).toContain('appid=108710');
    expect((f as any).url).toContain('paymentId=paypalych-sbp');
  });
  test('omits store_country when undefined', async () => {
    const f = fakeFetch({ success: true, data: { items: [] } });
    await fetchKeys(sb, { appid: 1, paymentId: 'p' }, f);
    expect((f as any).url).not.toContain('store_country');
  });
  test('http error → []', async () => {
    expect(await fetchKeys(sb, { appid: 1, paymentId: 'p' }, fakeFetch(null, false))).toEqual([]);
  });

  // Verbatim sample from the updated backend (GET steam_keys?appid=108710).
  // Locks in that the new extra fields (is_quick_purchase, steam_*, image,
  // category_id, discount_end, package.type) are ignored and every consumed
  // field still maps correctly. Catalog responses carry no order uid — uid
  // only comes from the POST purchase (see keys-order.ts).
  test('parses the updated backend catalog shape', async () => {
    const LIVE = { success: true, data: { name: 'Steam Keys', short_name: 'steam_keys', is_visible: 0, categories: [], items: [
      { id: 1986, name: "Alan Wake Collector’s Edition", is_active: true, is_quick_purchase: false, category_id: null, image: null, app_id: 108710, region_label: 'Global', package: { type: 'package', id: 13535, product_type: 'game' }, steam_price: 104, steam_old_price: 699, steam_discount_percent: 85, steam_discount_end: 1783616400, price: 163.59, old_price: 699, discount_percent: 77 },
      { id: 1987, name: "Alan Wake’s American Nightmare", is_active: true, is_quick_purchase: false, category_id: null, image: null, app_id: 108710, region_label: 'Global', package: { type: 'package', id: 14562, product_type: 'game' }, steam_price: 52, steam_old_price: 350, steam_discount_percent: 85, steam_discount_end: 1783616400, price: 77.13, old_price: 350, discount_percent: 78 },
      { id: 1988, name: 'Alan Wake', is_active: true, is_quick_purchase: false, category_id: null, image: null, app_id: 108710, region_label: 'Global', package: { type: 'package', id: 13533, product_type: 'game' }, steam_price: 82, steam_old_price: 549, steam_discount_percent: 85, steam_discount_end: 1783616400, price: 135.62, old_price: 549, discount_percent: 75 },
    ]}};
    const items = await fetchKeys(sb, { appid: 108710, paymentId: 'paypalych-sbp', storeCountry: 'RU' }, fakeFetch(LIVE));
    expect(items.length).toBe(3);
    expect(items[0]).toEqual({ itemId: 1986, name: "Alan Wake Collector’s Edition", isActive: true, regionLabel: 'Global', packageId: 13535, productType: 'game', price: 163.59, oldPrice: 699, discountPercent: 77 });
    expect(items[1]).toEqual({ itemId: 1987, name: "Alan Wake’s American Nightmare", isActive: true, regionLabel: 'Global', packageId: 14562, productType: 'game', price: 77.13, oldPrice: 350, discountPercent: 78 });
    expect(items[2]).toEqual({ itemId: 1988, name: 'Alan Wake', isActive: true, regionLabel: 'Global', packageId: 13533, productType: 'game', price: 135.62, oldPrice: 549, discountPercent: 75 });
  });
});
