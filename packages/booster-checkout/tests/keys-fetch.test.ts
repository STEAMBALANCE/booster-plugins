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
});
