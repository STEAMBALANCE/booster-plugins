import type { SbApi, SteamUser } from '@steambalance/booster-framework/api-types';
import { resolveKeysPaymentId } from './keys-payment';
import { fetchKeys, keysTargetParam, readKeysTarget } from './keys-fetch';
import { postKeysOrder } from './keys-order';
import { LL } from '../i18n';

export interface KeysWindowTitles {
  /** React TitleBar heading inside the payment window. */
  title?: string;
  /** Windows native taskbar caption. */
  taskbarTitle?: string;
}

export interface KeysBridgeDeps {
  openPayment: (url: string, titles?: KeysWindowTitles) => Promise<boolean>;
  // Persist the placed order's uid for «Мои заказы». Fired once the backend has
  // created the order (uid present), BEFORE the payment window opens — the order
  // exists regardless of whether the user completes payment, same as the balance
  // top-up flow. Validation/capping lives in the persist sink (install.ts).
  onOrderUid?: (uid: string) => void;
  fetchImpl?: typeof fetch;
}

// Mirror of the framework's private TITLE_MIN/TITLE_MAX in external-window.ts
// (not exported, so kept in sync by hand). openExternalWindow rejects titles
// outside this range with a SYNC throw — which would fire AFTER the order is
// already placed, surfacing a false error / risking a double order. Drop any
// forged / out-of-range value to undefined so the window still opens (it just
// falls back to the page's own title).
const TITLE_MIN = 1;
const TITLE_MAX = 200;
function sanitizeTitle(x: unknown): string | undefined {
  return typeof x === 'string' && x.length >= TITLE_MIN && x.length <= TITLE_MAX ? x : undefined;
}

async function resolveSteamEmail(user: SteamUser | null): Promise<string | undefined> {
  if (!user) return undefined;
  try { return (await user.email()) || undefined; } catch { return undefined; }
}

// Shared order-execution core: resolve payment method → create the order →
// persist its uid → open the native payment window. Used by BOTH the store
// «Купить» flow (booster-addfunds.keys.purchase) and the catalogue flow
// (booster-checkout.keys.external-purchase). Email/login are resolved by each
// caller (they differ only in email policy) and passed in as `account`/`login`.
async function placeKeysOrder(
  sb: SbApi,
  deps: KeysBridgeDeps,
  fetchImpl: typeof fetch,
  input: { itemId: number; account: string; login: string; titles: KeysWindowTitles },
): Promise<{ ok: boolean; orderUid?: string; error?: string; message?: string }> {
  const paymentId = await resolveKeysPaymentId(sb, fetchImpl);
  if (!paymentId) return { ok: false, error: 'no-payment' };
  const res = await postKeysOrder(sb, {
    paymentId, itemId: input.itemId, account: input.account, login: input.login,
  });
  if (!res.ok || !res.redirectUrl) return { ok: false, error: res.error, message: res.message };
  if (res.uid) deps.onOrderUid?.(res.uid);
  const opened = await deps.openPayment(res.redirectUrl, input.titles);
  return { ok: opened, orderUid: res.uid, error: opened ? undefined : 'window' };
}

export function installKeysBridge(sb: SbApi, deps: KeysBridgeDeps): () => void {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const subs: Array<() => void> = [];

  // resolveKeysPaymentId is localStorage-SWR-cached (A1) — no extra memo needed.

  subs.push(sb.bus.subscribe('booster-addfunds.keys.request', (data) => {
    void (async () => {
      const d = data as Record<string, unknown> | null;
      if (!d || typeof d.reqId !== 'string') return;
      // Which Steam id space the store tab is asking about — app / sub / bundle.
      // A payload naming none is unanswerable and dropped.
      const target = readKeysTarget(d);
      if (!target) return;
      const reqId = d.reqId;
      // Echo the requester's own id field back, so a store tab can tell whose
      // answer this is without knowing which id space it asked in.
      const echo = { [keysTargetParam(target)]: target.id };
      let storeCountry: string | undefined;
      try { storeCountry = await sb.steam.getStoreCountry(); } catch { storeCountry = undefined; }
      const paymentId = await resolveKeysPaymentId(sb, fetchImpl);
      if (!paymentId) { sb.bus.publish('booster-checkout.keys.response', { reqId, ...echo, items: [], error: 'no-payment' }); return; }
      const items = await fetchKeys(sb, { target, paymentId, storeCountry });
      sb.bus.publish('booster-checkout.keys.response', { reqId, ...echo, items });
    })();
  }));

  subs.push(sb.bus.subscribe('booster-addfunds.keys.purchase', (data) => {
    void (async () => {
      const d = data as { reqId?: unknown; itemId?: unknown; email?: unknown; windowTitle?: unknown; windowTaskbarTitle?: unknown } | null;
      if (!d || typeof d.reqId !== 'string' || typeof d.itemId !== 'number') return;
      const reqId = d.reqId; const itemId = d.itemId;
      const titles: KeysWindowTitles = {
        title: sanitizeTitle(d.windowTitle),
        taskbarTitle: sanitizeTitle(d.windowTaskbarTitle),
      };
      // Sync getter (not getCurrentUserAsync, which never resolves with no
      // snapshot — it would leak a pending promise on a not-logged-in shell).
      // One read → a consistent email + login pair from the same snapshot.
      const user = sb.steam.getCurrentUser();
      const account = (typeof d.email === 'string' && d.email) ? d.email : await resolveSteamEmail(user);
      if (!account) { sb.bus.publish('booster-checkout.keys.email-required', { reqId }); return; }
      const login = user?.accountName ?? '';
      const r = await placeKeysOrder(sb, deps, fetchImpl, { itemId, account, login, titles });
      // Wire-shape unchanged: no orderUid; error 'window' on window-fail; error/message
      // on order-fail; error 'no-payment' when no method. (message:undefined drops over the wire.)
      sb.bus.publish('booster-checkout.keys.purchase-result', { reqId, ok: r.ok, error: r.error, message: r.message });
    })();
  }));

  // Catalogue flow (steambalance.cc → window.SteamBooster.purchaseKey → framework
  // keysPurchase delegate → this topic). Same order pipeline as the store «Купить»
  // flow, but email comes ONLY from the Steam account (no email-required round-trip,
  // no modal): missing email → {ok:false, error:'no-email'}. Own-prefix topic.
  subs.push(sb.bus.subscribe('booster-checkout.keys.external-purchase', (data) => {
    void (async () => {
      const d = data as { reqId?: unknown; itemId?: unknown; gameName?: unknown } | null;
      if (!d || typeof d.reqId !== 'string' || typeof d.itemId !== 'number') return;
      const reqId = d.reqId; const itemId = d.itemId;
      // Cap gameName so the composed title stays under TITLE_MAX (200); sanitizeTitle
      // is the final net (drops an over-long composed title to undefined → page title).
      const gn = typeof d.gameName === 'string' && d.gameName ? d.gameName.slice(0, 150) : undefined;
      const titles: KeysWindowTitles = {
        title: sanitizeTitle(gn ? LL.checkout.keys.purchase_window_title({ gameName: gn }) : undefined),
        taskbarTitle: sanitizeTitle(LL.checkout.keys.purchase_window_taskbar_title()),
      };
      const user = sb.steam.getCurrentUser();
      const account = await resolveSteamEmail(user);
      if (!account) {
        sb.bus.publish('booster-checkout.keys.external-purchase-result', { reqId, ok: false, error: 'no-email' });
        return;
      }
      const login = user?.accountName ?? '';
      const r = await placeKeysOrder(sb, deps, fetchImpl, { itemId, account, login, titles });
      sb.bus.publish('booster-checkout.keys.external-purchase-result', {
        reqId, ok: r.ok, orderUid: r.orderUid, error: r.error, message: r.message,
      });
    })();
  }));

  // ── booster-checkout.keys.config broadcaster ─────────────────────────────
  // checkout stays the sole owner of paymentId + storeCountry resolution;
  // addfunds can't re-derive these (payment-method resolution is not
  // duplicated). Push the resolved pair so addfunds can fetch the keys list
  // directly via sb.net, skipping the booster-addfunds.keys.request round-trip.
  // paymentId may be null (no usable payment method) — addfunds falls back
  // to the bus path (keys.request/keys.response) in that case.
  async function publishKeysConfig(): Promise<void> {
    let storeCountry: string | undefined;
    try { storeCountry = await sb.steam.getStoreCountry(); } catch { storeCountry = undefined; }
    const paymentId = await resolveKeysPaymentId(sb, fetchImpl);
    sb.bus.publish('booster-checkout.keys.config', { paymentId: paymentId ?? null, storeCountry: storeCountry ?? null });
  }
  subs.push(sb.bus.subscribe('booster-addfunds.keys.config.request', () => { void publishKeysConfig(); }));

  // Cold-boot handshake: announce we're ready so an addfunds page already
  // mounted at injection re-sends its pending keys.request.
  sb.bus.publish('booster-checkout.keys.ready', {});
  void publishKeysConfig();

  return () => { for (const u of subs) u(); };
}
