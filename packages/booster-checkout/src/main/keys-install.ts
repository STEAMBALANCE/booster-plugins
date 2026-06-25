import type { SbApi } from '@steambalance/booster-framework/api-types';
import { resolveKeysPaymentId } from './keys-payment';
import { fetchKeys } from './keys-fetch';
import { postKeysOrder } from './keys-order';

export interface KeysBridgeDeps {
  openPayment: (url: string) => Promise<boolean>;
  fetchImpl?: typeof fetch;
}

async function resolveSteamEmail(sb: SbApi): Promise<string | undefined> {
  // Sync getter (not getCurrentUserAsync, which never resolves with no snapshot —
  // it would leak a pending promise on a not-logged-in shell). Null user → no email.
  const u = sb.steam.getCurrentUser();
  if (!u) return undefined;
  try { return (await u.email()) || undefined; } catch { return undefined; }
}

export function installKeysBridge(sb: SbApi, deps: KeysBridgeDeps): () => void {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const subs: Array<() => void> = [];

  // resolveKeysPaymentId is localStorage-SWR-cached (A1) — no extra memo needed.

  subs.push(sb.bus.subscribe('booster-addfunds.keys.request', (data) => {
    void (async () => {
      const d = data as { reqId?: unknown; appid?: unknown } | null;
      if (!d || typeof d.reqId !== 'string' || typeof d.appid !== 'number') return;
      const reqId = d.reqId; const appid = d.appid;
      let storeCountry: string | undefined;
      try { storeCountry = await sb.steam.getStoreCountry(); } catch { storeCountry = undefined; }
      const paymentId = await resolveKeysPaymentId(sb, fetchImpl);
      if (!paymentId) { sb.bus.publish('booster-checkout.keys.response', { reqId, appid, items: [], error: 'no-payment' }); return; }
      const items = await fetchKeys(sb, { appid, paymentId, storeCountry }, fetchImpl);
      sb.bus.publish('booster-checkout.keys.response', { reqId, appid, items });
    })();
  }));

  subs.push(sb.bus.subscribe('booster-addfunds.keys.purchase', (data) => {
    void (async () => {
      const d = data as { reqId?: unknown; itemId?: unknown; email?: unknown } | null;
      if (!d || typeof d.reqId !== 'string' || typeof d.itemId !== 'number') return;
      const reqId = d.reqId; const itemId = d.itemId;
      const account = (typeof d.email === 'string' && d.email) ? d.email : await resolveSteamEmail(sb);
      if (!account) { sb.bus.publish('booster-checkout.keys.email-required', { reqId }); return; }
      const paymentId = await resolveKeysPaymentId(sb, fetchImpl);
      if (!paymentId) { sb.bus.publish('booster-checkout.keys.purchase-result', { reqId, ok: false, error: 'no-payment' }); return; }
      const res = await postKeysOrder(sb, { paymentId, itemId, account }, fetchImpl);
      if (!res.ok || !res.redirectUrl) { sb.bus.publish('booster-checkout.keys.purchase-result', { reqId, ok: false, error: res.error }); return; }
      const opened = await deps.openPayment(res.redirectUrl);
      sb.bus.publish('booster-checkout.keys.purchase-result', { reqId, ok: opened, error: opened ? undefined : 'window' });
    })();
  }));

  // Cold-boot handshake: announce we're ready so an addfunds page already
  // mounted at injection re-sends its pending keys.request.
  sb.bus.publish('booster-checkout.keys.ready', {});

  return () => { for (const u of subs) u(); };
}
