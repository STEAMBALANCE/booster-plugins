import { test, expect } from 'bun:test';
import { ensureSnapshotService } from '../src/lib/user-snapshot';

function makeSb() {
  const subs = new Map<string, Set<(d: unknown) => void>>();
  const pubs: { topic: string; data: unknown }[] = [];
  const ctrl = new AbortController();
  const sb = {
    bus: {
      publish: (topic: string, data: unknown) => pubs.push({ topic, data }),
      subscribe: (t: string, cb: (d: unknown) => void) => {
        let s = subs.get(t); if (!s) { s = new Set(); subs.set(t, s); } s.add(cb);
        return () => s!.delete(cb);
      },
    },
    scope: { signal: ctrl.signal },
  } as any;
  const fire = (t: string, d: unknown) => subs.get(t)?.forEach((cb) => cb(d));
  return { sb, pubs, fire, subs };
}

test('subscribes once, publishes request, caches, notifies', () => {
  const { sb, pubs, fire, subs } = makeSb();
  const svc = ensureSnapshotService(sb);
  expect(pubs).toEqual([{ topic: 'booster-addfunds.user.snapshot.request', data: null }]);
  expect(svc.get()).toBeNull();
  const seen: unknown[] = [];
  svc.subscribe((s) => seen.push(s));
  fire('booster-checkout.user.snapshot', { accountName: 'u', currency: 'KZT', balance: 100 });
  expect(svc.get()).toEqual({ accountName: 'u', currency: 'KZT', balance: 100 });
  expect(seen.at(-1)).toEqual({ accountName: 'u', currency: 'KZT', balance: 100 });
  const svc2 = ensureSnapshotService(sb);
  expect(svc2).toBe(svc);
  expect(subs.get('booster-checkout.user.snapshot')!.size).toBe(1);
});

test('subscribe fires immediately if cache present; ignores malformed', () => {
  const { sb, fire } = makeSb();
  const svc = ensureSnapshotService(sb);
  fire('booster-checkout.user.snapshot', { balance: NaN, accountName: 'u', currency: 'RUB' });
  expect(svc.get()).toEqual({ accountName: 'u', currency: 'RUB', balance: null });
  fire('booster-checkout.user.snapshot', null);
  expect(svc.get()!.accountName).toBe('u');
  const got: unknown[] = [];
  svc.subscribe((s) => got.push(s));
  expect(got.length).toBe(1);
});
