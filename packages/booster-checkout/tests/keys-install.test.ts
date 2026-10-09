import { describe, test, expect } from 'bun:test';
import { installKeysBridge } from '../src/main/keys-install';
import { appendOrderUid } from '../src/main/order-uids';

// Payments (resolveKeysPaymentId) is fetchImpl-served throughout this suite —
// NOT migrated. Keys-list + order POST go through sb.net (see makeSb's `net`).
const PAYMENTS_OK = { success: true, data: [{ value: 'p', can_pay_services: true, disabled: false }] };
const paymentsFetch = (async () => ({ ok: true, status: 200, json: async () => PAYMENTS_OK })) as any;

// sb.net.fetch fake serving N back-to-back order POSTs with scripted uids.
// Lets a single bridge handle N back-to-back purchases without fighting the
// localStorage paymentId cache.
function orderNetFetch(orderUids: Array<string | undefined>) {
  let post = 0;
  return (async (_url: string, _init?: { method?: string }) => {
    const uid = orderUids[Math.min(post++, orderUids.length - 1)];
    return { ok: true, status: 200, headers: {}, json: async () => ({ success: true, data: { redirectUrl: 'https://pay/x', ...(uid !== undefined ? { uid } : {}) } }), text: async () => '' };
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
// Default `sb.net.fetch` — resolves keys-list to no items and any order POST
// to a generic failure, unless a test overrides it via `opts.netFetch`.
const defaultNetFetch = (async () => ({
  ok: true, status: 200, headers: {},
  json: async () => ({ success: true, data: { items: [] } }),
  text: async () => '',
})) as any;

function makeSb(bus: any, opts: { email?: string; country?: string; netFetch?: typeof fetch } = {}) {
  return {
    version: '1', bus,
    steam: {
      getStoreCountry: async () => opts.country,
      getCurrentUser: () => ({ accountName: 'tester', email: async () => opts.email }),
    },
    net: { fetch: opts.netFetch ?? defaultNetFetch },
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
    const keys = { success: true, data: { items: [
      { id: 7, name: 'X', is_active: true, region_label: 'Global', package: { id: 99, product_type: 'base' }, price: 10, old_price: null, discount_percent: 0 },
    ]}};
    // Payments (resolveKeysPaymentId) is still fetchImpl-served; the keys-list
    // GET (fetchKeys) now goes through sb.net.
    const netFetch = (async () => ({ ok: true, status: 200, headers: {}, json: async () => keys, text: async () => '' })) as any;
    installKeysBridge(makeSb(bus, { country: 'RU', netFetch }), { openPayment: async () => true, fetchImpl: paymentsFetch });
    bus.publish('booster-addfunds.keys.request', { reqId: 'r1', appid: 108710 });
    await new Promise((r) => setTimeout(r, 5));
    const resp = bus.published.find((p) => p.topic === 'booster-checkout.keys.response');
    expect(resp).toBeTruthy();
    expect((resp!.data as any).reqId).toBe('r1');
    expect((resp!.data as any).items[0].itemId).toBe(7);
  });

  test('purchase with steam email → opens payment, ok result', async () => {
    const bus = makeBus();
    const order = { success: true, data: { redirectUrl: 'https://pay/x', uid: 'u' } };
    const netFetch = (async () => ({ ok: true, status: 200, headers: {}, json: async () => order, text: async () => '' })) as any;
    let openedUrl = '';
    installKeysBridge(makeSb(bus, { email: 'a@b.c', netFetch }), { openPayment: async (u) => { openedUrl = u; return true; }, fetchImpl: paymentsFetch });
    bus.publish('booster-addfunds.keys.purchase', { reqId: 'p1', itemId: 7 });
    await new Promise((r) => setTimeout(r, 5));
    expect(openedUrl).toBe('https://pay/x');
    const res = bus.published.find((p) => p.topic === 'booster-checkout.keys.purchase-result');
    expect((res!.data as any)).toMatchObject({ reqId: 'p1', ok: true });
  });

  test('purchase sends steam login (accountName) alongside the email in the order body', async () => {
    const bus = makeBus();
    const order = { success: true, data: { redirectUrl: 'https://pay/x', uid: 'u' } };
    let postBody: any;
    const netFetch = (async (_u: string, init?: { body?: string }) => { postBody = JSON.parse(init!.body as string); return { ok: true, status: 200, headers: {}, json: async () => order, text: async () => '' }; }) as any;
    installKeysBridge(makeSb(bus, { email: 'a@b.c', netFetch }), { openPayment: async () => true, fetchImpl: paymentsFetch });
    bus.publish('booster-addfunds.keys.purchase', { reqId: 'p1', itemId: 7 });
    await new Promise((r) => setTimeout(r, 5));
    expect(postBody).toMatchObject({ account: 'a@b.c', login: 'tester' });
  });

  test('null steam user (cold start) with a bus email still proceeds, sends login: ""', async () => {
    // Reachable path: addfunds forwards a typed email over the bus (so `account` is
    // truthy, email-required is skipped) while getCurrentUser() is still null in the
    // ~100ms snapshot window / post-rollback. Purchase must NOT block — login: ''.
    const bus = makeBus();
    const order = { success: true, data: { redirectUrl: 'https://pay/x', uid: 'u' } };
    let postBody: any;
    const netFetch = (async (_u: string, init?: { body?: string }) => { postBody = JSON.parse(init!.body as string); return { ok: true, status: 200, headers: {}, json: async () => order, text: async () => '' }; }) as any;
    const sb = { version: '1', bus, steam: { getStoreCountry: async () => undefined, getCurrentUser: () => null }, net: { fetch: netFetch } } as any;
    let opened = false;
    installKeysBridge(sb, { openPayment: async () => { opened = true; return true; }, fetchImpl: paymentsFetch });
    bus.publish('booster-addfunds.keys.purchase', { reqId: 'p1', itemId: 7, email: 'typed@user.com' });
    await new Promise((r) => setTimeout(r, 5));
    expect(postBody).toMatchObject({ account: 'typed@user.com', login: '' });
    expect(opened).toBe(true);
  });

  test('successful order persists its uid via onOrderUid before opening payment', async () => {
    const bus = makeBus();
    const netFetch = orderNetFetch(['a5273b1e-87b4-435f-95ed-e85995b8951d']);
    const events: string[] = [];
    let persistedUid: string | undefined;
    installKeysBridge(makeSb(bus, { email: 'a@b.c', netFetch }), {
      openPayment: async () => { events.push('open'); return true; },
      onOrderUid: (uid) => { events.push('persist'); persistedUid = uid; },
      fetchImpl: paymentsFetch,
    });
    bus.publish('booster-addfunds.keys.purchase', { reqId: 'p1', itemId: 7 });
    await new Promise((r) => setTimeout(r, 5));
    expect(persistedUid).toBe('a5273b1e-87b4-435f-95ed-e85995b8951d');
    expect(events).toEqual(['persist', 'open']); // order recorded even if the window never opens
  });

  test('failed order does not persist a uid', async () => {
    const bus = makeBus();
    const order = { success: false, message: 'Платёжный метод недоступен' };
    const netFetch = (async () => ({ ok: true, status: 200, headers: {}, json: async () => order, text: async () => '' })) as any;
    let persisted = false;
    installKeysBridge(makeSb(bus, { email: 'a@b.c', netFetch }), {
      openPayment: async () => true,
      onOrderUid: () => { persisted = true; },
      fetchImpl: paymentsFetch,
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
    installKeysBridge(makeSb(bus, { email: 'a@b.c', netFetch: orderNetFetch(["'; DROP TABLE orders;--"]) }), {
      openPayment: async () => true,
      onOrderUid: (uid) => { store = appendOrderUid(store, uid); },
      fetchImpl: paymentsFetch,
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
    installKeysBridge(makeSb(bus, { email: 'a@b.c', netFetch: orderNetFetch([u1, u2]) }), {
      openPayment: async () => true,
      onOrderUid: (uid) => { store = appendOrderUid(store, uid); },
      fetchImpl: paymentsFetch,
    });
    bus.publish('booster-addfunds.keys.purchase', { reqId: 'p1', itemId: 7 });
    await new Promise((r) => setTimeout(r, 5));
    bus.publish('booster-addfunds.keys.purchase', { reqId: 'p2', itemId: 8 });
    await new Promise((r) => setTimeout(r, 5));
    expect(store).toEqual([u1, u2]);
  });

  test('order failure forwards the server human message in purchase-result', async () => {
    const bus = makeBus();
    const order = { success: false, message: 'Платёжный метод недоступен' };
    const netFetch = (async () => ({ ok: true, status: 200, headers: {}, json: async () => order, text: async () => '' })) as any;
    installKeysBridge(makeSb(bus, { email: 'a@b.c', netFetch }), { openPayment: async () => true, fetchImpl: paymentsFetch });
    bus.publish('booster-addfunds.keys.purchase', { reqId: 'p1', itemId: 7 });
    await new Promise((r) => setTimeout(r, 5));
    const res = bus.published.find((p) => p.topic === 'booster-checkout.keys.purchase-result');
    expect((res!.data as any).ok).toBe(false);
    expect((res!.data as any).message).toBe('Платёжный метод недоступен');
  });

  test('purchase forwards sanitized window titles to openPayment', async () => {
    const bus = makeBus();
    const order = { success: true, data: { redirectUrl: 'https://pay/x', uid: 'u' } };
    const netFetch = (async () => ({ ok: true, status: 200, headers: {}, json: async () => order, text: async () => '' })) as any;
    let gotTitles: any;
    installKeysBridge(makeSb(bus, { email: 'a@b.c', netFetch }), { openPayment: async (_u, t) => { gotTitles = t; return true; }, fetchImpl: paymentsFetch });
    bus.publish('booster-addfunds.keys.purchase', { reqId: 'p1', itemId: 7, windowTitle: 'Покупка ключа — «Game X»', windowTaskbarTitle: 'Покупка ключа' });
    await new Promise((r) => setTimeout(r, 5));
    expect(gotTitles).toEqual({ title: 'Покупка ключа — «Game X»', taskbarTitle: 'Покупка ключа' });
  });

  test('purchase drops forged out-of-range / non-string titles to undefined', async () => {
    const bus = makeBus();
    const order = { success: true, data: { redirectUrl: 'https://pay/x', uid: 'u' } };
    const netFetch = (async () => ({ ok: true, status: 200, headers: {}, json: async () => order, text: async () => '' })) as any;
    let gotTitles: any;
    installKeysBridge(makeSb(bus, { email: 'a@b.c', netFetch }), { openPayment: async (_u, t) => { gotTitles = t; return true; }, fetchImpl: paymentsFetch });
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

  test('publishes keys.config with resolved paymentId + storeCountry at init', async () => {
    const bus = makeBus();
    installKeysBridge(makeSb(bus, { country: 'RU' }), { openPayment: async () => true, fetchImpl: paymentsFetch });
    await new Promise((r) => setTimeout(r, 5));
    const cfg = bus.published.find((p) => p.topic === 'booster-checkout.keys.config');
    expect(cfg).toBeTruthy();
    expect(cfg!.data).toEqual({ paymentId: 'p', storeCountry: 'RU' });
  });

  test('publishes keys.config with paymentId:null when no usable payment method is available', async () => {
    const bus = makeBus();
    const noPayments = okFetch({ success: true, data: [] });
    installKeysBridge(makeSb(bus, { country: 'KZ' }), { openPayment: async () => true, fetchImpl: noPayments });
    await new Promise((r) => setTimeout(r, 5));
    const cfg = bus.published.find((p) => p.topic === 'booster-checkout.keys.config');
    expect(cfg).toBeTruthy();
    expect(cfg!.data).toEqual({ paymentId: null, storeCountry: 'KZ' });
  });

  test('publishes keys.config with storeCountry:null when getStoreCountry yields nothing', async () => {
    const bus = makeBus();
    installKeysBridge(makeSb(bus), { openPayment: async () => true, fetchImpl: paymentsFetch });
    await new Promise((r) => setTimeout(r, 5));
    const cfg = bus.published.find((p) => p.topic === 'booster-checkout.keys.config');
    expect(cfg!.data).toEqual({ paymentId: 'p', storeCountry: null });
  });

  test('re-publishes keys.config on booster-addfunds.keys.config.request', async () => {
    const bus = makeBus();
    installKeysBridge(makeSb(bus, { country: 'RU' }), { openPayment: async () => true, fetchImpl: paymentsFetch });
    await new Promise((r) => setTimeout(r, 5));
    const before = bus.published.filter((p) => p.topic === 'booster-checkout.keys.config').length;
    bus.publish('booster-addfunds.keys.config.request', null);
    await new Promise((r) => setTimeout(r, 5));
    const after = bus.published.filter((p) => p.topic === 'booster-checkout.keys.config');
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)!.data).toEqual({ paymentId: 'p', storeCountry: 'RU' });
  });

  test('external-purchase with steam email → order placed, result carries orderUid', async () => {
    const bus = makeBus();
    const uid = 'a5273b1e-87b4-435f-95ed-e85995b8951d';
    installKeysBridge(makeSb(bus, { email: 'a@b.c', netFetch: orderNetFetch([uid]) }), {
      openPayment: async () => true, fetchImpl: paymentsFetch,
    });
    bus.publish('booster-checkout.keys.external-purchase', { reqId: 'e1', itemId: 7, gameName: 'Earth 2160' });
    await new Promise((r) => setTimeout(r, 5));
    const res = bus.published.find((p) => p.topic === 'booster-checkout.keys.external-purchase-result');
    expect(res!.data).toMatchObject({ reqId: 'e1', ok: true, orderUid: uid });
  });

  test('external-purchase without steam email → no-email (NO email-required, no modal)', async () => {
    const bus = makeBus();
    installKeysBridge(makeSb(bus, { email: undefined }), { openPayment: async () => true, fetchImpl: paymentsFetch });
    bus.publish('booster-checkout.keys.external-purchase', { reqId: 'e2', itemId: 7 });
    await new Promise((r) => setTimeout(r, 5));
    const res = bus.published.find((p) => p.topic === 'booster-checkout.keys.external-purchase-result');
    expect(res!.data).toMatchObject({ reqId: 'e2', ok: false, error: 'no-email' });
    expect(bus.published.some((p) => p.topic === 'booster-checkout.keys.email-required')).toBe(false);
  });

  test('external-purchase builds the payment-window title from gameName', async () => {
    const bus = makeBus();
    let gotTitles: any;
    installKeysBridge(makeSb(bus, { email: 'a@b.c', netFetch: orderNetFetch(['a5273b1e-87b4-435f-95ed-e85995b8951d']) }), {
      openPayment: async (_u, t) => { gotTitles = t; return true; }, fetchImpl: paymentsFetch,
    });
    bus.publish('booster-checkout.keys.external-purchase', { reqId: 'e3', itemId: 7, gameName: 'Earth 2160' });
    await new Promise((r) => setTimeout(r, 5));
    expect(gotTitles.title).toContain('Earth 2160');
    expect(typeof gotTitles.taskbarTitle).toBe('string');
  });

  test('external-purchase with no payment method → no-payment', async () => {
    const bus = makeBus();
    const noPayments = okFetch({ success: true, data: [] });
    installKeysBridge(makeSb(bus, { email: 'a@b.c' }), { openPayment: async () => true, fetchImpl: noPayments });
    bus.publish('booster-checkout.keys.external-purchase', { reqId: 'e4', itemId: 7 });
    await new Promise((r) => setTimeout(r, 5));
    const res = bus.published.find((p) => p.topic === 'booster-checkout.keys.external-purchase-result');
    expect(res!.data).toMatchObject({ reqId: 'e4', ok: false, error: 'no-payment' });
  });

  test('external-purchase order failure forwards server message', async () => {
    const bus = makeBus();
    const order = { success: false, message: 'Регион недоступен' };
    const netFetch = (async () => ({ ok: true, status: 200, headers: {}, json: async () => order, text: async () => '' })) as any;
    installKeysBridge(makeSb(bus, { email: 'a@b.c', netFetch }), { openPayment: async () => true, fetchImpl: paymentsFetch });
    bus.publish('booster-checkout.keys.external-purchase', { reqId: 'e5', itemId: 7 });
    await new Promise((r) => setTimeout(r, 5));
    const res = bus.published.find((p) => p.topic === 'booster-checkout.keys.external-purchase-result');
    expect((res!.data as any).ok).toBe(false);
    expect((res!.data as any).message).toBe('Регион недоступен');
  });
});

// The store side (booster-addfunds) addresses three Steam id spaces — app, sub
// (package) and bundle — and names the bus field after the backend query field
// it wants. /app/ keeps the legacy `appid` shape so an older store bundle and a
// newer main-shell still talk to each other.
describe('installKeysBridge — keys target', () => {
  function keysNet(capture: { url: string }) {
    return (async (url: string) => {
      capture.url = url;
      return { ok: true, status: 200, headers: {}, json: async () => ({ success: true, data: { items: [] } }), text: async () => '' };
    }) as any;
  }

  test('a sub request fetches the sub id space and echoes sub back', async () => {
    const bus = makeBus(); const cap = { url: '' };
    installKeysBridge(makeSb(bus, { country: 'RU', netFetch: keysNet(cap) }), { openPayment: async () => true, fetchImpl: paymentsFetch });
    bus.publish('booster-addfunds.keys.request', { reqId: 'r-sub', sub: 1010506 });
    await new Promise((r) => setTimeout(r, 5));
    expect(cap.url).toContain('sub=1010506');
    expect(cap.url).not.toContain('appid=');
    const resp = bus.published.find((p) => p.topic === 'booster-checkout.keys.response')!;
    expect(resp.data as any).toMatchObject({ reqId: 'r-sub', sub: 1010506 });
  });

  test('a bundle request fetches the bundle id space and echoes bundle back', async () => {
    const bus = makeBus(); const cap = { url: '' };
    installKeysBridge(makeSb(bus, { country: 'RU', netFetch: keysNet(cap) }), { openPayment: async () => true, fetchImpl: paymentsFetch });
    bus.publish('booster-addfunds.keys.request', { reqId: 'r-bun', bundle: 42206 });
    await new Promise((r) => setTimeout(r, 5));
    expect(cap.url).toContain('bundle=42206');
    expect(cap.url).not.toContain('appid=');
    const resp = bus.published.find((p) => p.topic === 'booster-checkout.keys.response')!;
    expect(resp.data as any).toMatchObject({ reqId: 'r-bun', bundle: 42206 });
  });

  test('an app request still fetches appid and echoes appid back', async () => {
    const bus = makeBus(); const cap = { url: '' };
    installKeysBridge(makeSb(bus, { country: 'RU', netFetch: keysNet(cap) }), { openPayment: async () => true, fetchImpl: paymentsFetch });
    bus.publish('booster-addfunds.keys.request', { reqId: 'r-app', appid: 108710 });
    await new Promise((r) => setTimeout(r, 5));
    expect(cap.url).toContain('appid=108710');
    const resp = bus.published.find((p) => p.topic === 'booster-checkout.keys.response')!;
    expect(resp.data as any).toMatchObject({ reqId: 'r-app', appid: 108710 });
  });

  test('a request naming no id space at all is ignored', async () => {
    const bus = makeBus(); const cap = { url: '' };
    installKeysBridge(makeSb(bus, { country: 'RU', netFetch: keysNet(cap) }), { openPayment: async () => true, fetchImpl: paymentsFetch });
    bus.publish('booster-addfunds.keys.request', { reqId: 'r-none' });
    await new Promise((r) => setTimeout(r, 5));
    expect(cap.url).toBe('');
    expect(bus.published.some((p) => p.topic === 'booster-checkout.keys.response')).toBe(false);
  });
});
