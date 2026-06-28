import { describe, test, expect } from 'bun:test';
import { installKeysBridge } from '../src/main/keys-install';
import { appendOrderUid } from '../src/main/order-uids';

// Method-aware fake for the purchase flow: GET → payment methods, POST → order
// with the next scripted uid. Lets a single bridge handle N back-to-back
// purchases without fighting the localStorage paymentId cache.
function purchaseFetch(orderUids: Array<string | undefined>) {
  let post = 0;
  return (async (_url: string, init?: { method?: string }) => {
    if ((init?.method ?? 'GET') === 'POST') {
      const uid = orderUids[Math.min(post++, orderUids.length - 1)];
      return { ok: true, status: 200, json: async () => ({ success: true, data: { redirectUrl: 'https://pay/x', ...(uid !== undefined ? { uid } : {}) } }) };
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: [{ value: 'p', can_pay_services: true, disabled: false }] }) };
  }) as any;
}

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

  test('successful order persists its uid via onOrderUid before opening payment', async () => {
    const bus = makeBus();
    const payments = { success: true, data: [{ value: 'p', can_pay_services: true, disabled: false }] };
    const order = { success: true, data: { redirectUrl: 'https://pay/x', uid: 'a5273b1e-87b4-435f-95ed-e85995b8951d' } };
    let call = 0;
    const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => (call++ === 0 ? payments : order) })) as any;
    const events: string[] = [];
    let persistedUid: string | undefined;
    installKeysBridge(makeSb(bus, { email: 'a@b.c' }), {
      openPayment: async () => { events.push('open'); return true; },
      onOrderUid: (uid) => { events.push('persist'); persistedUid = uid; },
      fetchImpl,
    });
    bus.publish('booster-addfunds.keys.purchase', { reqId: 'p1', itemId: 7 });
    await new Promise((r) => setTimeout(r, 5));
    expect(persistedUid).toBe('a5273b1e-87b4-435f-95ed-e85995b8951d');
    expect(events).toEqual(['persist', 'open']); // order recorded even if the window never opens
  });

  test('failed order does not persist a uid', async () => {
    const bus = makeBus();
    const payments = { success: true, data: [{ value: 'p', can_pay_services: true, disabled: false }] };
    const order = { success: false, message: 'Платёжный метод недоступен' };
    let call = 0;
    const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => (call++ === 0 ? payments : order) })) as any;
    let persisted = false;
    installKeysBridge(makeSb(bus, { email: 'a@b.c' }), {
      openPayment: async () => true,
      onOrderUid: () => { persisted = true; },
      fetchImpl,
    });
    bus.publish('booster-addfunds.keys.purchase', { reqId: 'p1', itemId: 7 });
    await new Promise((r) => setTimeout(r, 5));
    expect(persisted).toBe(false);
  });

  test('a garbage backend uid is rejected by the real persist sink', async () => {
    const bus = makeBus();
    // onOrderUid wired to the SAME validator/cap the production sink uses, so this
    // exercises the real isValidUid gate end-to-end through the keys path.
    let store: string[] = [];
    installKeysBridge(makeSb(bus, { email: 'a@b.c' }), {
      openPayment: async () => true,
      onOrderUid: (uid) => { store = appendOrderUid(store, uid); },
      fetchImpl: purchaseFetch(["'; DROP TABLE orders;--"]),
    });
    bus.publish('booster-addfunds.keys.purchase', { reqId: 'p1', itemId: 7 });
    await new Promise((r) => setTimeout(r, 5));
    expect(store).toEqual([]);
  });

  test('two back-to-back purchases each persist their own uid', async () => {
    const bus = makeBus();
    const u1 = 'a5273b1e-87b4-435f-95ed-e85995b8951d';
    const u2 = 'b1112233-4455-6677-8899-aabbccddeeff';
    let store: string[] = [];
    installKeysBridge(makeSb(bus, { email: 'a@b.c' }), {
      openPayment: async () => true,
      onOrderUid: (uid) => { store = appendOrderUid(store, uid); },
      fetchImpl: purchaseFetch([u1, u2]),
    });
    bus.publish('booster-addfunds.keys.purchase', { reqId: 'p1', itemId: 7 });
    await new Promise((r) => setTimeout(r, 5));
    bus.publish('booster-addfunds.keys.purchase', { reqId: 'p2', itemId: 8 });
    await new Promise((r) => setTimeout(r, 5));
    expect(store).toEqual([u1, u2]);
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
