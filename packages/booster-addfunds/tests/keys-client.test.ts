import { describe, test, expect } from 'bun:test';
import { createKeysClient } from '../src/lib/keys-client';

function makeBus() {
  const subs = new Map<string, Set<(d: unknown) => void>>();
  const published: Array<{ topic: string; data: any }> = [];
  return {
    published,
    publish: (topic: string, data: unknown) => { published.push({ topic, data }); subs.get(topic)?.forEach((cb) => cb(data)); },
    subscribe: (topic: string, cb: (d: unknown) => void) => { let s = subs.get(topic); if (!s) { s = new Set(); subs.set(topic, s); } s.add(cb); return () => s!.delete(cb); },
    emit: (topic: string, data: unknown) => subs.get(topic)?.forEach((cb) => cb(data)),
  };
}

test('requestKeys resolves on matching response', async () => {
  const bus = makeBus(); const sb = { bus } as any;
  const client = createKeysClient(sb, { timeoutMs: 500, retryMs: 100 });
  const p = client.requestKeys({ kind: 'app', id: 108710 }, new AbortController().signal);
  await new Promise((r) => setTimeout(r, 5));
  const req = bus.published.find((x) => x.topic === 'booster-addfunds.keys.request');
  expect(req).toBeTruthy();
  bus.emit('booster-checkout.keys.response', { reqId: req!.data.reqId, appid: 108710, items: [{ itemId: 1 }] });
  expect(await p).toEqual([{ itemId: 1 }]);
  client.dispose();
});

test('requestKeys ignores stale reqId then times out → []', async () => {
  const bus = makeBus(); const sb = { bus } as any;
  const client = createKeysClient(sb, { timeoutMs: 200, retryMs: 1000 });
  const p = client.requestKeys({ kind: 'app', id: 1 }, new AbortController().signal);
  bus.emit('booster-checkout.keys.response', { reqId: 'other:9', appid: 1, items: [{ itemId: 99 }] });
  expect(await p).toEqual([]);
  client.dispose();
});

test('purchaseKey → email-required then ok', async () => {
  const bus = makeBus(); const sb = { bus } as any;
  const client = createKeysClient(sb, { timeoutMs: 500, retryMs: 100 });
  const p1 = client.purchaseKey(7);
  await new Promise((r) => setTimeout(r, 5));
  const req = bus.published.find((x) => x.topic === 'booster-addfunds.keys.purchase');
  bus.emit('booster-checkout.keys.email-required', { reqId: req!.data.reqId });
  expect(await p1).toEqual({ status: 'email-required' });
  const p2 = client.purchaseKey(7, 'a@b.c');
  await new Promise((r) => setTimeout(r, 5));
  const req2 = bus.published.filter((x) => x.topic === 'booster-addfunds.keys.purchase').at(-1)!;
  expect(req2.data.email).toBe('a@b.c');
  bus.emit('booster-checkout.keys.purchase-result', { reqId: req2.data.reqId, ok: true });
  expect(await p2).toEqual({ status: 'ok' });
  client.dispose();
});

test('purchaseKey forwards window titles on the bus payload', async () => {
  const bus = makeBus(); const sb = { bus } as any;
  const client = createKeysClient(sb, { timeoutMs: 500, retryMs: 100 });
  const titles = { title: 'Покупка ключа — «Game X»', taskbarTitle: 'Покупка ключа' };
  const p = client.purchaseKey(7, 'a@b.c', titles);
  await new Promise((r) => setTimeout(r, 5));
  const req = bus.published.find((x) => x.topic === 'booster-addfunds.keys.purchase')!;
  expect(req.data.windowTitle).toBe(titles.title);
  expect(req.data.windowTaskbarTitle).toBe(titles.taskbarTitle);
  bus.emit('booster-checkout.keys.purchase-result', { reqId: req.data.reqId, ok: true });
  expect(await p).toEqual({ status: 'ok' });
  client.dispose();
});

test('purchaseKey without titles omits the window-title fields', async () => {
  const bus = makeBus(); const sb = { bus } as any;
  const client = createKeysClient(sb, { timeoutMs: 500, retryMs: 100 });
  client.purchaseKey(7);
  await new Promise((r) => setTimeout(r, 5));
  const req = bus.published.find((x) => x.topic === 'booster-addfunds.keys.purchase')!;
  expect('windowTitle' in req.data).toBe(false);
  expect('windowTaskbarTitle' in req.data).toBe(false);
  client.dispose();
});

test('requestKeys: aborting the signal resolves []', async () => {
  const bus = makeBus(); const sb = { bus } as any;
  const client = createKeysClient(sb, { timeoutMs: 5000, retryMs: 1000 });
  const ctrl = new AbortController();
  const p = client.requestKeys({ kind: 'app', id: 1 }, ctrl.signal);
  ctrl.abort();
  expect(await p).toEqual([]);
  client.dispose();
});

test('requestKeys: prefers direct fetch when keysConfig has a paymentId, no bus publish', async () => {
  const bus = makeBus(); const sb = { bus } as any;
  const keysConfig = { get: () => ({ paymentId: 'paypalych-sbp', storeCountry: 'RU' }) };
  let directArgs: any;
  const fetchKeysDirect = async (_sb: any, args: any) => { directArgs = args; return [{ itemId: 1 }]; };
  const client = createKeysClient(sb, { timeoutMs: 500, retryMs: 100, keysConfig, fetchKeysDirect } as any);
  const items = await client.requestKeys({ kind: 'app', id: 1909950 }, new AbortController().signal);
  expect(items).toEqual([{ itemId: 1 }]);
  expect(directArgs).toEqual({ target: { kind: 'app', id: 1909950 }, paymentId: 'paypalych-sbp', storeCountry: 'RU' });
  expect(bus.published.some((x) => x.topic === 'booster-addfunds.keys.request')).toBe(false);
  client.dispose();
});

test('requestKeys: an empty direct result is a final answer, not a failure — no bus fallback', async () => {
  const bus = makeBus(); const sb = { bus } as any;
  const keysConfig = { get: () => ({ paymentId: 'paypalych-sbp', storeCountry: 'RU' }) };
  const fetchKeysDirect = async () => [];
  const client = createKeysClient(sb, { timeoutMs: 500, retryMs: 100, keysConfig, fetchKeysDirect } as any);
  const items = await client.requestKeys({ kind: 'app', id: 1909950 }, new AbortController().signal);
  expect(items).toEqual([]);
  expect(bus.published.some((x) => x.topic === 'booster-addfunds.keys.request')).toBe(false);
  client.dispose();
});

test('requestKeys: falls back to the bus when keysConfig has no paymentId yet', async () => {
  const bus = makeBus(); const sb = { bus } as any;
  const keysConfig = { get: () => null };
  let directCalled = false;
  const fetchKeysDirect = async () => { directCalled = true; return []; };
  const client = createKeysClient(sb, { timeoutMs: 500, retryMs: 100, keysConfig, fetchKeysDirect } as any);
  const p = client.requestKeys({ kind: 'app', id: 108710 }, new AbortController().signal);
  await new Promise((r) => setTimeout(r, 5));
  const req = bus.published.find((x) => x.topic === 'booster-addfunds.keys.request');
  expect(req).toBeTruthy();
  expect(directCalled).toBe(false);
  bus.emit('booster-checkout.keys.response', { reqId: req!.data.reqId, appid: 108710, items: [{ itemId: 5 }] });
  expect(await p).toEqual([{ itemId: 5 }]);
  client.dispose();
});

test('requestKeys: falls back to the bus when keysConfig paymentId is null (no payment method)', async () => {
  const bus = makeBus(); const sb = { bus } as any;
  const keysConfig = { get: () => ({ paymentId: null, storeCountry: 'RU' }) };
  const client = createKeysClient(sb, { timeoutMs: 500, retryMs: 100, keysConfig } as any);
  const p = client.requestKeys({ kind: 'app', id: 108710 }, new AbortController().signal);
  await new Promise((r) => setTimeout(r, 5));
  const req = bus.published.find((x) => x.topic === 'booster-addfunds.keys.request');
  expect(req).toBeTruthy();
  bus.emit('booster-checkout.keys.response', { reqId: req!.data.reqId, appid: 108710, items: [] });
  expect(await p).toEqual([]);
  client.dispose();
});

test('requestKeys: falls back to the bus when the direct fetch throws', async () => {
  const bus = makeBus(); const sb = { bus } as any;
  const keysConfig = { get: () => ({ paymentId: 'paypalych-sbp', storeCountry: 'RU' }) };
  const fetchKeysDirect = async () => { throw new Error('boom'); };
  const client = createKeysClient(sb, { timeoutMs: 500, retryMs: 100, keysConfig, fetchKeysDirect } as any);
  const p = client.requestKeys({ kind: 'app', id: 108710 }, new AbortController().signal);
  await new Promise((r) => setTimeout(r, 5));
  const req = bus.published.find((x) => x.topic === 'booster-addfunds.keys.request');
  expect(req).toBeTruthy();
  bus.emit('booster-checkout.keys.response', { reqId: req!.data.reqId, appid: 108710, items: [{ itemId: 9 }] });
  expect(await p).toEqual([{ itemId: 9 }]);
  client.dispose();
});

test('requestKeys: with no keysConfig at all (option omitted) behaves exactly like before — bus only', async () => {
  const bus = makeBus(); const sb = { bus } as any;
  const client = createKeysClient(sb, { timeoutMs: 500, retryMs: 100 });
  const p = client.requestKeys({ kind: 'app', id: 108710 }, new AbortController().signal);
  await new Promise((r) => setTimeout(r, 5));
  const req = bus.published.find((x) => x.topic === 'booster-addfunds.keys.request');
  expect(req).toBeTruthy();
  bus.emit('booster-checkout.keys.response', { reqId: req!.data.reqId, appid: 108710, items: [{ itemId: 1 }] });
  expect(await p).toEqual([{ itemId: 1 }]);
  client.dispose();
});

test('requestKeys: keys.ready re-sends the pending request', async () => {
  const bus = makeBus(); const sb = { bus } as any;
  const client = createKeysClient(sb, { timeoutMs: 5000, retryMs: 10000 }); // long retry so re-send is from ready, not the interval
  const p = client.requestKeys({ kind: 'app', id: 108710 }, new AbortController().signal);
  await new Promise((r) => setTimeout(r, 5));
  const before = bus.published.filter((x: any) => x.topic === 'booster-addfunds.keys.request').length;
  bus.emit('booster-checkout.keys.ready', {});
  const after = bus.published.filter((x: any) => x.topic === 'booster-addfunds.keys.request');
  expect(after.length).toBe(before + 1);          // ready triggered a re-send
  const reqId = after.at(-1).data.reqId;
  bus.emit('booster-checkout.keys.response', { reqId, appid: 108710, items: [{ itemId: 9 }] });
  expect(await p).toEqual([{ itemId: 9 }]);
  client.dispose();
});

// --- keys target on the wire ------------------------------------------------
// Bus payload field name mirrors the backend query field (lib/keys-target.ts).
// An /app/ request MUST keep publishing the legacy `{ reqId, appid }` shape so
// an older booster-checkout main-shell keeps answering it.

test('requestKeys publishes the legacy {reqId, appid} bus shape for an app target', async () => {
  const bus = makeBus(); const sb = { bus } as any;
  const client = createKeysClient(sb, { timeoutMs: 200, retryMs: 1000 });
  const p = client.requestKeys({ kind: 'app', id: 108710 }, new AbortController().signal);
  await new Promise((r) => setTimeout(r, 5));
  const req = bus.published.find((x) => x.topic === 'booster-addfunds.keys.request')!;
  expect(req.data.appid).toBe(108710);
  expect(Object.keys(req.data).sort()).toEqual(['appid', 'reqId']);
  bus.emit('booster-checkout.keys.response', { reqId: req.data.reqId, appid: 108710, items: [] });
  await p;
  client.dispose();
});

test('requestKeys publishes a sub field on the bus for a sub target', async () => {
  const bus = makeBus(); const sb = { bus } as any;
  const client = createKeysClient(sb, { timeoutMs: 200, retryMs: 1000 });
  const p = client.requestKeys({ kind: 'sub', id: 1010506 }, new AbortController().signal);
  await new Promise((r) => setTimeout(r, 5));
  const req = bus.published.find((x) => x.topic === 'booster-addfunds.keys.request')!;
  expect(req.data.sub).toBe(1010506);
  expect('appid' in req.data).toBe(false);
  bus.emit('booster-checkout.keys.response', { reqId: req.data.reqId, sub: 1010506, items: [{ itemId: 3 }] });
  expect(await p).toEqual([{ itemId: 3 }]);
  client.dispose();
});

test('requestKeys publishes a bundle field on the bus for a bundle target', async () => {
  const bus = makeBus(); const sb = { bus } as any;
  const client = createKeysClient(sb, { timeoutMs: 200, retryMs: 1000 });
  const p = client.requestKeys({ kind: 'bundle', id: 42206 }, new AbortController().signal);
  await new Promise((r) => setTimeout(r, 5));
  const req = bus.published.find((x) => x.topic === 'booster-addfunds.keys.request')!;
  expect(req.data.bundle).toBe(42206);
  expect('appid' in req.data).toBe(false);
  bus.emit('booster-checkout.keys.response', { reqId: req.data.reqId, bundle: 42206, items: [{ itemId: 4 }] });
  expect(await p).toEqual([{ itemId: 4 }]);
  client.dispose();
});

test('requestKeys hands the whole target to the direct fetch', async () => {
  const bus = makeBus(); const sb = { bus } as any;
  const keysConfig = { get: () => ({ paymentId: 'paypalych-sbp', storeCountry: 'RU' }) };
  let directArgs: any;
  const fetchKeysDirect = async (_sb: any, args: any) => { directArgs = args; return []; };
  const client = createKeysClient(sb, { timeoutMs: 200, retryMs: 1000, keysConfig, fetchKeysDirect } as any);
  await client.requestKeys({ kind: 'bundle', id: 42206 }, new AbortController().signal);
  expect(directArgs).toEqual({ target: { kind: 'bundle', id: 42206 }, paymentId: 'paypalych-sbp', storeCountry: 'RU' });
  client.dispose();
});
