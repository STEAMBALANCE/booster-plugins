import type { SbApi } from '@steambalance/booster-framework/api-types';
import type { KeyItem } from './keys-api';
import type { KeysConfigService } from './keys-config';
import { fetchKeysDirect as realFetchKeysDirect } from './keys-fetch';
import { keysTargetParam, type KeysTarget } from './keys-target';

let nonceCounter = 0;
function makeNonce(): string {
  // Session-unique enough to disambiguate multiple store tabs on the broadcast bus.
  return `${Date.now().toString(36)}-${(nonceCounter++).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function createKeysClient(sb: SbApi, opts: {
  timeoutMs?: number; retryMs?: number; purchaseTimeoutMs?: number;
  /** Cached checkout paymentId/storeCountry broadcast — see keys-config.ts.
   *  Omitted (default) → requestKeys always uses the bus, unchanged behavior. */
  keysConfig?: KeysConfigService;
  /** Direct sb.net fetch seam — default: the real fetchKeysDirect. Tests
   *  override to simulate a throw and exercise the bus-fallback branch. */
  fetchKeysDirect?: typeof realFetchKeysDirect;
} = {}) {
  const timeoutMs = opts.timeoutMs ?? 6000;
  const retryMs = opts.retryMs ?? 1000;
  // Покупка ключа требует более длительного таймаута: сервер могёт медленнее отвечать на POST,
  // и окно оплаты открывается асинхронно. Если таймаут истечёт слишком рано, пользователь
  // увидит ошибку retry, что может привести к двойному заказу. 30s — достаточно для открытия окна.
  const purchaseTimeoutMs = opts.purchaseTimeoutMs ?? 30000;
  const nonce = makeNonce();
  let counter = 0;
  const nextId = (): string => `${nonce}:${++counter}`;

  let activeListReqId: string | null = null;
  const listWaiters = new Map<string, (items: KeyItem[]) => void>();
  const purchaseWaiters = new Map<string, (r: { status: 'ok' | 'email-required' | 'error'; error?: string; message?: string }) => void>();
  const onReady: Array<() => void> = [];

  const subs: Array<() => void> = [];
  subs.push(sb.bus.subscribe('booster-checkout.keys.response', (data) => {
    const d = data as { reqId?: string; items?: unknown };
    if (!d || typeof d.reqId !== 'string' || d.reqId !== activeListReqId) return;
    const w = listWaiters.get(d.reqId);
    if (w) { listWaiters.delete(d.reqId); w(Array.isArray(d.items) ? d.items as KeyItem[] : []); }
  }));
  subs.push(sb.bus.subscribe('booster-checkout.keys.email-required', (data) => {
    const d = data as { reqId?: string };
    const w = d && typeof d.reqId === 'string' ? purchaseWaiters.get(d.reqId) : undefined;
    if (w && d) { purchaseWaiters.delete(d.reqId!); w({ status: 'email-required' }); }
  }));
  subs.push(sb.bus.subscribe('booster-checkout.keys.purchase-result', (data) => {
    const d = data as { reqId?: string; ok?: boolean; error?: string; message?: string };
    const w = d && typeof d.reqId === 'string' ? purchaseWaiters.get(d.reqId) : undefined;
    if (w && d) { purchaseWaiters.delete(d.reqId!); w(d.ok ? { status: 'ok' } : { status: 'error', error: d.error, message: d.message }); }
  }));
  subs.push(sb.bus.subscribe('booster-checkout.keys.ready', () => { for (const cb of onReady.splice(0)) cb(); }));

  const fetchDirect = opts.fetchKeysDirect ?? realFetchKeysDirect;

  // Preferred path: checkout has broadcast a usable paymentId (keys-config.ts),
  // so fetch the list directly via sb.net — no bus round-trip, no per-page
  // wait on checkout's main-shell. An empty result is a legit "no keys for
  // this region" answer and is returned as-is (NOT treated as a failure).
  // Falls back to the bus (requestKeysViaBus) when no paymentId is cached yet
  // (cold start / no usable payment method) or if the direct fetch itself
  // throws — fetchKeysDirect is designed to never throw, so this catch is
  // belt-and-suspenders, not a normally-taken path.
  function requestKeys(target: KeysTarget, signal: AbortSignal): Promise<KeyItem[]> {
    const cfg = opts.keysConfig?.get();
    if (cfg && cfg.paymentId) {
      // NOTE: sb.net doesn't wire AbortSignal in v1 (NetFetchInit.signal is a
      // no-op), so unlike the bus path this doesn't resolve early on abort —
      // it's bounded by the native fetch's own timeout. Callers (pages/app.ts)
      // re-check ctx.signal.aborted after the await, so a stale result is dropped.
      // storeCountry comes from the broadcast snapshot (may be a session-stale
      // value if the account's store country changed mid-session without a
      // re-broadcast) — acceptable: store country is account-bound/effectively
      // stable per session, and the actual charge is keyed by itemId, not region.
      return fetchDirect(sb, { target, paymentId: cfg.paymentId, storeCountry: cfg.storeCountry }, signal)
        .catch(() => requestKeysViaBus(target, signal));
    }
    return requestKeysViaBus(target, signal);
  }

  function requestKeysViaBus(target: KeysTarget, signal: AbortSignal): Promise<KeyItem[]> {
    const reqId = nextId();
    activeListReqId = reqId;
    return new Promise<KeyItem[]>((resolve) => {
      let done = false;
      const finish = (items: KeyItem[]): void => { if (done) return; done = true; clearInterval(iv); clearTimeout(to); listWaiters.delete(reqId); resolve(items); };
      listWaiters.set(reqId, finish);
      const send = (): void => { if (!done) sb.bus.publish('booster-addfunds.keys.request', { reqId, [keysTargetParam(target)]: target.id }); };
      onReady.push(send);
      send();
      const iv = setInterval(send, retryMs);
      const to = setTimeout(() => finish([]), timeoutMs);
      signal.addEventListener('abort', () => finish([]), { once: true });
    });
  }

  // `titles` carry the payment-window heading (React TitleBar) + taskbar caption.
  // checkout opens the window but only addfunds knows the game name, so both
  // strings ride the bus to the main-shell opener.
  function purchaseKey(
    itemId: number,
    email?: string,
    titles?: { title: string; taskbarTitle: string },
  ): Promise<{ status: 'ok' | 'email-required' | 'error'; error?: string; message?: string }> {
    const reqId = nextId();
    return new Promise((resolve) => {
      let done = false;
      const finish = (r: { status: 'ok' | 'email-required' | 'error'; error?: string; message?: string }): void => { if (done) return; done = true; clearTimeout(to); purchaseWaiters.delete(reqId); resolve(r); };
      purchaseWaiters.set(reqId, finish);
      sb.bus.publish('booster-addfunds.keys.purchase', {
        reqId, itemId,
        ...(email ? { email } : {}),
        ...(titles ? { windowTitle: titles.title, windowTaskbarTitle: titles.taskbarTitle } : {}),
      });
      const to = setTimeout(() => finish({ status: 'error', error: 'timeout' }), purchaseTimeoutMs);
    });
  }

  return { requestKeys, purchaseKey, dispose: () => { for (const u of subs) u(); } };
}
