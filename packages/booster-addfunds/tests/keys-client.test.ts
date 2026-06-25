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
  const p = client.requestKeys(108710, new AbortController().signal);
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
  const p = client.requestKeys(1, new AbortController().signal);
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

test('requestKeys: aborting the signal resolves []', async () => {
  const bus = makeBus(); const sb = { bus } as any;
  const client = createKeysClient(sb, { timeoutMs: 5000, retryMs: 1000 });
  const ctrl = new AbortController();
  const p = client.requestKeys(1, ctrl.signal);
  ctrl.abort();
  expect(await p).toEqual([]);
  client.dispose();
});

test('requestKeys: keys.ready re-sends the pending request', async () => {
  const bus = makeBus(); const sb = { bus } as any;
  const client = createKeysClient(sb, { timeoutMs: 5000, retryMs: 10000 }); // long retry so re-send is from ready, not the interval
  const p = client.requestKeys(108710, new AbortController().signal);
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
