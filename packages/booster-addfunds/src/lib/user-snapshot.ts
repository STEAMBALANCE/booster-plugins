import type { SbApi } from '@steambalance/booster-framework/api-types';

export interface UserSnapshot {
  accountName: string;
  currency: string | null;
  balance: number | null;
}

export interface SnapshotService {
  get(): UserSnapshot | null;
  /** Subscribe to snapshot updates; fires immediately if a cache exists. */
  subscribe(cb: (s: UserSnapshot) => void): () => void;
}

// One service per injection scope. Keyed on scope.signal so a fresh
// AbortController (re-injection, or an isolated test scope) gets its own
// independent service — and a second ensure call in the same scope reuses
// the existing subscription rather than double-subscribing.
const services = new WeakMap<AbortSignal, SnapshotService>();

export function ensureSnapshotService(sb: SbApi): SnapshotService {
  const existing = services.get(sb.scope.signal);
  if (existing) return existing;

  let cached: UserSnapshot | null = null;
  const listeners = new Set<(s: UserSnapshot) => void>();

  sb.bus.subscribe('booster-checkout.user.snapshot', (data) => {
    const d = data as Partial<UserSnapshot> | null;
    if (!d || typeof d.accountName !== 'string') return;
    cached = {
      accountName: d.accountName,
      currency: typeof d.currency === 'string' ? d.currency : null,
      // typeof NaN === 'number' — guard explicitly.
      balance: typeof d.balance === 'number' && Number.isFinite(d.balance) ? d.balance : null,
    };
    for (const cb of listeners) cb(cached);
  });
  // Nudge main-shell to (re-)publish current snapshot. Covers the
  // cold-boot race where addfunds attaches first and main-shell's
  // initial onUserChange fire has already happened.
  sb.bus.publish('booster-addfunds.user.snapshot.request', null);

  const svc: SnapshotService = {
    get: () => cached,
    subscribe: (cb) => {
      listeners.add(cb);
      if (cached) cb(cached);
      return () => listeners.delete(cb);
    },
  };
  services.set(sb.scope.signal, svc);
  return svc;
}
