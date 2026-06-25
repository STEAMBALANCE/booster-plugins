import { describe, test, expect } from 'bun:test';
import { installKeysBridge } from '../src/main/keys-install';

function makeBus() {
  const subs = new Map<string, Set<(d: unknown) => void>>();
  const published: Array<{ topic: string; data: unknown }> = [];
  return {
    published,
    publish: (topic: string, data: unknown) => {
      published.push({ topic, data });
      subs.get(topic)?.forEach((cb) => cb(data));
    },
    subscribe: (topic: string, cb: (d: unknown) => void) => {
      let s = subs.get(topic); if (!s) { s = new Set(); subs.set(topic, s); }
      s.add(cb); return () => s!.delete(cb);
    },
  };
}
function makeSb(bus: any, opts: { email?: string; country?: string } = {}) {
  return {
    version: '1', bus,
    steam: {
      getStoreCountry: async () => opts.country,
      getCurrentUser: () => ({ accountName: 'tester', email: async () => opts.email }),
    },
  } as any;
}
const okFetch = (body: unknown, ok = true) => (async () => ({ ok, status: ok ? 200 : 500, json: async () => body })) as any;

describe('installKeysBridge', () => {
  test('publishes keys.ready on install', () => {
    const bus = makeBus();
    installKeysBridge(makeSb(bus), { openPayment: async () => true, fetchImpl: okFetch({}) });
    expect(bus.published.some((p) => p.topic === 'booster-checkout.keys.ready')).toBe(true);
  });

  test('keys.request → keys.response with parsed items', async () => {
    const bus = makeBus();
    const payments = { success: true, data: [{ value: 'paypalych-sbp', can_pay_services: true, disabled: false }] };
    const keys = { success: true, data: { items: [
      { id: 7, name: 'X', is_active: true, region_label: 'Global', package: { id: 99, product_type: 'base' }, price: 10, old_price: null, discount_percent: 0 },
    ]}};
    let call = 0;
    const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => (call++ === 0 ? payments : keys) })) as any;
    installKeysBridge(makeSb(bus, { country: 'RU' }), { openPayment: async () => true, fetchImpl });
    bus.publish('booster-addfunds.keys.request', { reqId: 'r1', appid: 108710 });
    await new Promise((r) => setTimeout(r, 5));
    const resp = bus.published.find((p) => p.topic === 'booster-checkout.keys.response');
    expect(resp).toBeTruthy();
    expect((resp!.data as any).reqId).toBe('r1');
    expect((resp!.data as any).items[0].itemId).toBe(7);
  });

  test('purchase with steam email → opens payment, ok result', async () => {
    const bus = makeBus();
    const payments = { success: true, data: [{ value: 'p', can_pay_services: true, disabled: false }] };
    const order = { success: true, data: { redirectUrl: 'https://pay/x', uid: 'u' } };
    let call = 0;
    const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => (call++ === 0 ? payments : order) })) as any;
    let openedUrl = '';
    installKeysBridge(makeSb(bus, { email: 'a@b.c' }), { openPayment: async (u) => { openedUrl = u; return true; }, fetchImpl });
    bus.publish('booster-addfunds.keys.purchase', { reqId: 'p1', itemId: 7 });
    await new Promise((r) => setTimeout(r, 5));
    expect(openedUrl).toBe('https://pay/x');
    const res = bus.published.find((p) => p.topic === 'booster-checkout.keys.purchase-result');
    expect((res!.data as any)).toMatchObject({ reqId: 'p1', ok: true });
  });

  test('order failure forwards the server human message in purchase-result', async () => {
    const bus = makeBus();
    const payments = { success: true, data: [{ value: 'p', can_pay_services: true, disabled: false }] };
    const order = { success: false, message: 'Платёжный метод недоступен' };
    let call = 0;
    const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => (call++ === 0 ? payments : order) })) as any;
    installKeysBridge(makeSb(bus, { email: 'a@b.c' }), { openPayment: async () => true, fetchImpl });
    bus.publish('booster-addfunds.keys.purchase', { reqId: 'p1', itemId: 7 });
    await new Promise((r) => setTimeout(r, 5));
    const res = bus.published.find((p) => p.topic === 'booster-checkout.keys.purchase-result');
    expect((res!.data as any).ok).toBe(false);
    expect((res!.data as any).message).toBe('Платёжный метод недоступен');
  });

  test('purchase forwards sanitized window titles to openPayment', async () => {
    const bus = makeBus();
    const payments = { success: true, data: [{ value: 'p', can_pay_services: true, disabled: false }] };
    const order = { success: true, data: { redirectUrl: 'https://pay/x', uid: 'u' } };
    let call = 0;
    const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => (call++ === 0 ? payments : order) })) as any;
    let gotTitles: any;
    installKeysBridge(makeSb(bus, { email: 'a@b.c' }), { openPayment: async (_u, t) => { gotTitles = t; return true; }, fetchImpl });
    bus.publish('booster-addfunds.keys.purchase', { reqId: 'p1', itemId: 7, windowTitle: 'Покупка ключа — «Game X»', windowTaskbarTitle: 'Покупка ключа' });
    await new Promise((r) => setTimeout(r, 5));
    expect(gotTitles).toEqual({ title: 'Покупка ключа — «Game X»', taskbarTitle: 'Покупка ключа' });
  });

  test('purchase drops forged out-of-range / non-string titles to undefined', async () => {
    const bus = makeBus();
    const payments = { success: true, data: [{ value: 'p', can_pay_services: true, disabled: false }] };
    const order = { success: true, data: { redirectUrl: 'https://pay/x', uid: 'u' } };
    let call = 0;
    const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => (call++ === 0 ? payments : order) })) as any;
    let gotTitles: any;
    installKeysBridge(makeSb(bus, { email: 'a@b.c' }), { openPayment: async (_u, t) => { gotTitles = t; return true; }, fetchImpl });
    bus.publish('booster-addfunds.keys.purchase', { reqId: 'p1', itemId: 7, windowTitle: 'x'.repeat(201), windowTaskbarTitle: 42 });
    await new Promise((r) => setTimeout(r, 5));
    expect(gotTitles).toBeDefined();
    expect(gotTitles.title).toBeUndefined();
    expect(gotTitles.taskbarTitle).toBeUndefined();
  });

  test('purchase without email → email-required', async () => {
    const bus = makeBus();
    installKeysBridge(makeSb(bus, { email: undefined }), { openPayment: async () => true, fetchImpl: okFetch({}) });
    bus.publish('booster-addfunds.keys.purchase', { reqId: 'p2', itemId: 7 });
    await new Promise((r) => setTimeout(r, 5));
    expect(bus.published.some((p) => p.topic === 'booster-checkout.keys.email-required' && (p.data as any).reqId === 'p2')).toBe(true);
  });
});
