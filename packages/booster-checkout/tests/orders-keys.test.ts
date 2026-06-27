import { test, expect } from 'bun:test';
import { wireOrdersKeyActivation } from '../src/main/orders-keys';
import type { ActivateOutcome } from '@steambalance/booster-framework/api-types';

function fakeHandle() {
  let cb: ((d?: unknown) => void) | null = null;
  const sent: unknown[] = [];
  return {
    on(_e: 'message', fn: (d?: unknown) => void) { cb = fn; return () => { cb = null; }; },
    postMessage(d: unknown) { sent.push(d); },
    _fire(d: unknown) { cb && cb(d); },
    _sent: sent,
  };
}

function req(requestId: unknown, key: unknown) {
  return { __sbEmbed: true, v: 1, type: 'sb:event', name: 'activate-key', data: { requestId, key } };
}

// flush microtasks: the handler runs deps.activate in a detached async IIFE.
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const okOutcome: ActivateOutcome = { ok: true, products: [], transactionId: 'tx1' };
const failOutcome: ActivateOutcome = { ok: false, code: 'already_owned', resultDetail: 9, message: 'owned' };

test('happy path: posts outcome on success', async () => {
  const h = fakeHandle();
  const calls: string[] = [];
  wireOrdersKeyActivation(h as any, { activate: async (k) => { calls.push(k); return okOutcome; } });
  h._fire(req(7, 'AAAAA-BBBBB-CCCCC'));
  await flush();
  expect(calls).toEqual(['AAAAA-BBBBB-CCCCC']);
  expect(h._sent).toEqual([
    { __sbEmbed: true, v: 1, type: 'sb:event', name: 'activate-key-result', data: { requestId: 7, outcome: okOutcome } },
  ]);
});

test('business failure: outcome.ok=false passed through as outcome (not error)', async () => {
  const h = fakeHandle();
  wireOrdersKeyActivation(h as any, { activate: async () => failOutcome });
  h._fire(req(8, 'KEY'));
  await flush();
  expect(h._sent).toEqual([
    { __sbEmbed: true, v: 1, type: 'sb:event', name: 'activate-key-result', data: { requestId: 8, outcome: failOutcome } },
  ]);
});

test('activate throws: posts error', async () => {
  const h = fakeHandle();
  wireOrdersKeyActivation(h as any, { activate: async () => { throw new Error('boom'); } });
  h._fire(req(9, 'KEY'));
  await flush();
  expect(h._sent).toEqual([
    { __sbEmbed: true, v: 1, type: 'sb:event', name: 'activate-key-result', data: { requestId: 9, error: 'boom' } },
  ]);
});

test('invalid key (empty / too long / non-string): error, activate not called', async () => {
  for (const bad of ['', 'x'.repeat(257), 123, null, undefined]) {
    const h = fakeHandle();
    let called = false;
    wireOrdersKeyActivation(h as any, { activate: async () => { called = true; return okOutcome; } });
    h._fire(req(1, bad));
    await flush();
    expect(called).toBe(false);
    expect(h._sent).toEqual([
      { __sbEmbed: true, v: 1, type: 'sb:event', name: 'activate-key-result', data: { requestId: 1, error: 'invalid product key' } },
    ]);
  }
});

test('accepts keys at length boundaries (1 and 256): activate called, outcome posted', async () => {
  for (const good of ['x', 'x'.repeat(256)]) {
    const h = fakeHandle();
    const calls: string[] = [];
    wireOrdersKeyActivation(h as any, { activate: async (k) => { calls.push(k); return okOutcome; } });
    h._fire(req(3, good));
    await flush();
    expect(calls).toEqual([good]);
    expect(h._sent).toEqual([
      { __sbEmbed: true, v: 1, type: 'sb:event', name: 'activate-key-result', data: { requestId: 3, outcome: okOutcome } },
    ]);
  }
});

test('unsubscribe detaches listener: no reply, activate not called after unwire', async () => {
  const h = fakeHandle();
  let called = false;
  const unwire = wireOrdersKeyActivation(h as any, { activate: async () => { called = true; return okOutcome; } });
  unwire();
  h._fire(req(5, 'KEY'));
  await flush();
  expect(called).toBe(false);
  expect(h._sent).toEqual([]);
});

test('bad requestId (missing / NaN / non-number): nothing posted, activate not called', async () => {
  for (const bad of [undefined, NaN, '5', null]) {
    const h = fakeHandle();
    let called = false;
    wireOrdersKeyActivation(h as any, { activate: async () => { called = true; return okOutcome; } });
    h._fire(req(bad, 'KEY'));
    await flush();
    expect(called).toBe(false);
    expect(h._sent).toEqual([]);
  }
});

test('foreign messages ignored', async () => {
  const h = fakeHandle();
  let called = false;
  wireOrdersKeyActivation(h as any, { activate: async () => { called = true; return okOutcome; } });
  h._fire({ type: 'other' });
  h._fire({ __sbEmbed: true, v: 1, type: 'sb:ready' });
  h._fire({ __sbEmbed: true, v: 1, type: 'sb:event', name: 'something-else', data: { requestId: 1, key: 'K' } });
  h._fire(null);
  await flush();
  expect(called).toBe(false);
  expect(h._sent).toEqual([]);
});

test('oversize outcome: downgraded to compact error (not silently dropped)', async () => {
  const h = fakeHandle();
  const big = { ok: true, products: [], transactionId: 'x', filler: 'x'.repeat(17000) } as unknown as ActivateOutcome;
  wireOrdersKeyActivation(h as any, { activate: async () => big });
  h._fire(req(42, 'KEY'));
  await flush();
  expect(h._sent).toEqual([
    { __sbEmbed: true, v: 1, type: 'sb:event', name: 'activate-key-result', data: { requestId: 42, error: 'activation response too large' } },
  ]);
});
