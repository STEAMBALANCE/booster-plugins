import type { PluginContext } from '@steambalance/booster-framework';
import type {
  OpenWindowHandle,
  OpenExternalWindowHandle,
  AttachedPopupHandle,
  HeaderButtonHandle,
} from '@steambalance/booster-framework/api-types';
import {
  type PaymentMethod,
  readCache,
  fetchPaymentMethods,
} from './payment-methods';
import { getStackVersions } from './headers';
import { URLS } from '../urls';
import { buildOrdersUrl, buildSupportUrl } from './urls-helper';
import { appendOrderUid, sanitizeStoredUids, isValidUid } from './order-uids';
import { readSupportEnvInfo } from './env-info';
import { wireOrdersEmbed } from './orders-embed';
import { LL } from '../i18n';

declare const __SB_POPUP_HTML__: string;
// Inline SVG (15×12 "S6" mark) for the Steam-toolbar header pill. Wide
// SteamBalance wordmark logo.png stays inside the popup (build-popup.ts
// inlines it independently); this icon is for the narrow toolbar button.
declare const __SB_HEADER_ICON_SVG__: string;

// Reserved popup/window ids (single namespace, enforced relay-side
// in window-handlers.ts via idTaken). Add new ids here so future
// features don't collide.
const POPUP_DROPDOWN = 'sb_topup';
const WINDOW_SUPPORT = 'sb_support';
const WINDOW_PAYMENT = 'sb_topup_payment';
const WINDOW_ORDERS  = 'sb_orders';
const WINDOW_FAQ     = 'sb_faq';

const POPUP_W = 378;
const POPUP_H = 248;

/**
 * Main-shell plugin install entry. Invoked by the plugin host when this
 * plugin is registered against the Main context. Returns a cleanup
 * function the host invokes on rollback / re-injection.
 *
 * Booster URLs are imported from `../urls` (hardcoded in the plugin
 * source). No manifest URLs block read here.
 */
export async function installMain(ctx: PluginContext): Promise<() => void> {
  const sb = ctx.sb;

  // Local order-uid history for «Мои Заказы» (last 20, FIFO).
  // Source of truth: plugin-config 'order_uids'; in-memory copy kept in
  // sync so the orders-handler can build the URL without awaiting.
  const ORDER_UIDS_KEY = 'order_uids';
  let orderUids: string[] = [];

  async function persistOrderUid(uid: string): Promise<void> {
    if (!isValidUid(uid)) return;
    orderUids = appendOrderUid(orderUids, uid);
    try {
      await ctx.configs?.write(ORDER_UIDS_KEY, orderUids);
    } catch (e) {
      ctx.log.warn(`order_uids write failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const cleanups: Array<() => void | Promise<void>> = [];
  // Shared popup handle type for refs that get assigned after attachPopup
  // resolves (popupRef, and the `popup` local further down). Awaited via
  // the framework's own return type so a future signature change there
  // propagates here without a manual sync.
  type PopupHandle = Awaited<ReturnType<typeof sb.ui.attachPopup>>;

  // Module-local payment methods state. Hydrated synchronously from the
  // localStorage cache on every popup boot; updated in place by
  // refreshPaymentMethods. The popup mirrors this via BC `payment-methods`
  // snapshots — every state transition (loading start, fetch resolve,
  // fetch reject) is followed by a postPaymentMethodsIfPossible call.
  let paymentMethodsCache: PaymentMethod[] = readCache();
  let paymentMethodsLoading = false;
  let paymentMethodsError: string | null = null;

  // popupRef is assigned once attachPopup resolves. Snapshots emitted
  // before that point are dropped (the attach branch posts the current
  // snapshot when popupRef becomes available, covering the cold path).
  let popupRef: PopupHandle | null = null;

  function postPaymentMethodsIfPossible(): void {
    if (!popupRef) return;
    popupRef.postMessage({
      kind: 'payment-methods',
      methods: paymentMethodsCache,
      loading: paymentMethodsLoading,
      error: paymentMethodsError,
    });
  }

  async function refreshPaymentMethods(): Promise<void> {
    if (paymentMethodsLoading) return;   // idempotent — coalesce concurrent kicks
    paymentMethodsLoading = true;
    paymentMethodsError = null;          // clear stale error on every retry start
    postPaymentMethodsIfPossible();
    try {
      const result = await fetchPaymentMethods(sb);
      if (result !== null) {
        paymentMethodsCache = result;
        paymentMethodsError = null;
      } else if (paymentMethodsCache.length === 0) {
        // Surface error only when there's nothing to display. Stale-
        // while-revalidate otherwise: a non-empty cache stays visible
        // and the user can keep using the popup until the next refresh.
        paymentMethodsError = LL.checkout.payment_methods_error_toast();
      }
    } finally {
      paymentMethodsLoading = false;
      postPaymentMethodsIfPossible();
    }
  }

  // Kick off the first fetch BEFORE lifecycle.ready so the network
  // request and the bootstrap handshake overlap.
  void refreshPaymentMethods();

  await sb.lifecycle.ready();

  // Load order-uid history after ready — avoids blocking bootstrap
  // with a config-IPC call (overlap with refreshPaymentMethods preserved).
  try {
    const raw = await ctx.configs?.read(ORDER_UIDS_KEY);
    orderUids = sanitizeStoredUids(raw);
  } catch { orderUids = []; }

  // ── booster-addfunds.topup-requested cross-target subscriber ────────────────────────────
  // The store-target addfunds page publishes
  // `sb.bus.publish('booster-addfunds.topup-requested', { amount })` from the in-page
  // «Пополнить кошелёк Steam» button. The receiving side is here in the
  // main-shell, because the popup + toolbar button live in this realm.
  //
  // Two cold-boot races bracket the buffer:
  //   1. Publish lands BEFORE `await sb.ui.attachPopup` resolves —
  //      subscribe FIRST (before the await) so the event isn't lost.
  //   2. Publish lands AFTER attachPopup but BEFORE the toolbar button
  //      is registered (button is added near the end of this function).
  //      Without the button rect, `openTopupWithAmount` would fall into
  //      the fallback-position branch (top-right corner of the viewport)
  //      every time the user happened to be on addfunds during a hot
  //      re-injection — visually worse than briefly buffering. So the
  //      `popupReadyForTopup` gate flips only AFTER both popup AND
  //      toolbar button are ready.
  // Invalid amounts (NaN, ≤0, missing, non-number) are silently dropped —
  // the publisher is in another target so any boundary mismatch (forged
  // BC, future schema drift) gets defused here without surfacing.
  const pendingTopups: number[] = [];
  let popupReadyForTopup = false;
  let topupPopupRef: AttachedPopupHandle | null = null;
  let topupButtonRef: HeaderButtonHandle | null = null;
  // Single-source-of-truth carry: set by openTopupWithAmount BEFORE
  // popup.show(), consumed by the popup.on('show') handler when it
  // posts the {kind:'shown', prefillAmount?} envelope. Cleared after
  // consumption so a subsequent organic show (user clicks toolbar
  // button) doesn't re-apply a stale prefill. The two-call sequence
  // (show → on('show') callback) executes inside a single relay
  // round-trip, so no other publish can race in between.
  let pendingPrefillAmount: number | null = null;

  function openTopupWithAmount(amount: number): void {
    if (!topupPopupRef) return;   // defensive — should never happen post-ready
    const p = topupPopupRef;
    const rect = topupButtonRef?.getRect();
    let x: number; let y: number;
    if (rect && rect.right > 0 && rect.bottom > 0) {
      // Anchor: same screen-coords formula that addHeaderButton's own
      // togglePopup sugar uses (window.screenX + rect.right - popup.width,
      // window.screenY + rect.bottom) — keeps the popup aligned with
      // the toolbar button as if the user had clicked it directly.
      x = window.screenX + rect.right - p.width;
      y = window.screenY + rect.bottom;
    } else {
      // Defensive fallback — happens if the main-shell window is
      // minimized (rect.right === 0) or the button rect is otherwise
      // degenerate. Top-right of the viewport is a sane "you can still
      // see it" position; the user can switch to the main shell from
      // the taskbar if it's hidden.
      x = window.screenX + window.innerWidth - p.width - 16;
      y = window.screenY + 40;
    }
    // Set the prefill carry BEFORE show(): the relay's popup-show-event
    // fires the on('show') handler below, which reads & clears the
    // carry while composing the {kind:'shown'} envelope. Single envelope
    // = no race with the unconditional resetTransientUI() the popup
    // runs on every 'shown' (previously a separate {kind:'prefill'}
    // message could be clobbered by the reset).
    pendingPrefillAmount = amount;
    p.show({ x, y });
  }

  const unsubTopupOpen = sb.bus.subscribe('booster-addfunds.topup-requested', (data) => {
    const d = data as { amount?: unknown } | null;
    const raw = d?.amount;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return;
    // Floor — payment endpoints expect an integer, and a fractional
    // publish is almost certainly a JS-arithmetic rounding artefact in
    // the publisher (price * units, etc.).
    const amount = Math.floor(raw);
    if (!popupReadyForTopup) {
      pendingTopups.push(amount);
      return;
    }
    openTopupWithAmount(amount);
  });
  cleanups.push(unsubTopupOpen);

  // ── booster-checkout.user.snapshot broadcaster ───────────────────────────
  // Store-target plugins (addfunds) can't read sb.steam directly — the
  // BroadcastChannel that backs sb.steam doesn't cross to
  // store.steampowered.com. Publish accountName/currency/balance over
  // the bus so subscribers on store targets can render currency-aware
  // UI. Subscribe to `booster-addfunds.user.snapshot.request` so a store-
  // target subscriber that came up AFTER our first publish can still
  // get a fresh snapshot (no buffering at the bus layer — explicit pull).
  // Wired BEFORE attachPopup await for the same reason the topup
  // subscriber is: a request publish landing during boot must not be
  // lost.
  // Topic names are bound to the publisher's plugin id (booster-framework
  // bus enforces strict topic-prefix=plugin-id at publish; spec H5).
  function publishUserSnapshot(): void {
    const u = sb.steam.getCurrentUser();
    if (!u) return;
    sb.bus.publish('booster-checkout.user.snapshot', {
      accountName: u.accountName,
      currency: u.currency ?? null,
      balance: u.balance ?? null,
    });
  }
  const unsubSnapshotReq = sb.bus.subscribe('booster-addfunds.user.snapshot.request', () => {
    publishUserSnapshot();
  });
  cleanups.push(unsubSnapshotReq);

  // Pre-allocate the native dropdown popup once. Show / hide / toggle on it
  // are fire-and-forget BC posts — relay drives the same SteamClient.Window
  // BrowserView throughout the session, never spawning extra popups. Defaults
  // for flagOpts produce STEAM_DROPDOWN_FLAGS = 4538634 (Steam Notifications-
  // matching native border / no taskbar / etc.).
  const popup = await sb.ui.attachPopup({
    id: POPUP_DROPDOWN,
    html: __SB_POPUP_HTML__,
    width: POPUP_W,
    height: POPUP_H,
    hideOnBlur: true,
    // Disable the native 1 px CEF border. The popup root paints its
    // own `1px solid #000` via --booster-popup-stroke in tokens.css —
    // keeping the native border on stacks a second black ring AND
    // shrinks the content area by 2 px (breaking the Figma-pinned
    // 165 px AmountRow slot). Single CSS border is the source of
    // truth for the pixel-perfect 378 × 248 layout.
    nativeBorder: false,
  });
  popupRef = popup;
  topupPopupRef = popup;
  // Note: `popupReadyForTopup` does NOT flip here — it flips AFTER the
  // toolbar button is registered below, so `openTopupWithAmount` always
  // has a button rect to anchor to. Otherwise a publish landing in this
  // tiny window between attach and button-add would unnecessarily fall
  // into the viewport-corner fallback.

  // Emit the current payment-methods snapshot now that the popup is
  // attached. If initialFetch already resolved, this carries fresh data;
  // otherwise it carries the cache (or [] if cold) + loading=true. The
  // refresh's own postPaymentMethodsIfPossible calls before this point
  // were no-ops (popupRef was still null).
  postPaymentMethodsIfPossible();

  let paymentHandle: OpenExternalWindowHandle | null = null;
  let paymentOpenInFlight = false;

  // Support modal state. supportHandle reuse — second click while window is
  // open re-focuses (bringToFront) instead of opening a duplicate.
  // supportInFlight gates the await window: openWindow does a BC roundtrip
  // to relay; a fast double-click during that gap would otherwise fire two
  // openWindow calls (the handle isn't yet assigned). The two flags are
  // distinct: in-flight covers [click → resolve], handle covers [resolve →
  // close].
  let supportHandle: OpenWindowHandle | null = null;
  let supportInFlight = false;

  // Orders modal state. Same reuse + in-flight pattern as the support
  // branch: ordersHandle covers [resolve → close], ordersInFlight
  // covers [click → resolve] (the openWindow await window during which
  // a second click should not spawn a duplicate request).
  let ordersHandle: OpenWindowHandle | null = null;
  let ordersInFlight = false;

  // FAQ modal state — same reuse + in-flight pattern as orders/support.
  let faqHandle: OpenWindowHandle | null = null;
  let faqInFlight = false;

  // popup → main: user clicked "Pay" / "?" → navigate / open support modal.
  popup.on('message', async (data: unknown) => {
    const d = data as { kind?: string; url?: unknown } | null;
    if (d?.kind === 'navigate') {
      const rawUid = (d as { uid?: unknown }).uid;
      if (typeof rawUid === 'string') void persistOrderUid(rawUid);
      const url = (d as { url?: unknown }).url;
      if (typeof url !== 'string' || !url) return;

      // Reuse path: window already open → atomic URL swap via relay.
      if (paymentHandle) {
        try {
          paymentHandle.setUrl(url);  // throws sync on invalid URL
        } catch (e) {
          console.error('[booster-checkout] payment setUrl failed:', e);
          return;  // не hide — юзер видит popup и может ретраить
        }
        popup.hide();
        return;
      }

      if (paymentOpenInFlight) return;  // double-click race during await
      paymentOpenInFlight = true;
      try {
        // React TitleBar внутри окна — персонализированный заголовок с
        // login'ом для ясности "это пополнение моего аккаунта". Windows
        // taskbar — обобщённый, чтобы не светить login в системной панели
        // задач (это видят все, кому виден экран). taskbarTitle опускается
        // если login ещё не загрузился — тогда оба места fallback'ят на
        // "Пополнение аккаунта" (см. behavior matrix taskbarTitle=undefined
        // → fallback на title).
        const login = sb.steam.getCurrentUser()?.accountName;
        const reactTitle = login
          ? LL.checkout.popup.window_title({ login })
          : LL.checkout.popup.window_title_no_login();
        const handle = await sb.ui.openExternalWindow({
          id: WINDOW_PAYMENT,
          url,
          title: reactTitle,
          taskbarTitle: LL.checkout.popup.window_title_no_login(),
        });
        paymentHandle = handle;
        handle.on('close', () => { paymentHandle = null; });
        // popup.hide AFTER openExternalWindow resolves — same ordering
        // rationale as the support branch below: hiding earlier triggers a
        // popup-blur race that closes the popup before the payment window
        // is up.
        popup.hide();
      } catch (e) {
        console.error('[booster-checkout] openExternalWindow payment failed:', e);
      } finally {
        paymentOpenInFlight = false;
      }
    } else if (d?.kind === 'refresh-payment-methods') {
      // Popup's "Обновить" button on the error screen. Idempotent: a
      // refresh already in flight is a no-op. The state mutation
      // (loading=true, error=null) emits its own snapshot at start.
      void refreshPaymentMethods();
    } else if (d?.kind === 'menu-action' && (d as { action?: unknown }).action === 'orders') {
      if (ordersHandle) {
        try { ordersHandle.bringToFront(); } catch {}
        popup.hide();
        return;
      }
      if (ordersInFlight) return;
      ordersInFlight = true;
      try {
        const url = buildOrdersUrl(URLS.orders, orderUids);
        const handle = await sb.ui.openWindow({
          id: WINDOW_ORDERS,
          url,
          title: LL.checkout.popup.orders_window_title(),
          width: 720, height: 640, minWidth: 560, minHeight: 420,
        });
        ordersHandle = handle;
        handle.on('close', () => { ordersHandle = null; });
        wireOrdersEmbed(handle, { source: 'booster-checkout' });
        popup.hide();
      } catch (e) {
        console.error('[booster-checkout] openWindow orders failed:', e);
      } finally {
        ordersInFlight = false;
      }
    } else if (d?.kind === 'menu-action' && (d as { action?: unknown }).action === 'settings') {
      // Settings UI not shipped this sprint; row is hidden by
      // App.svelte (showSettings=false default). Defensive log in
      // case a forged BC message reaches here.
      console.warn('[booster-checkout] settings click ignored — not shipped');
    } else if (d?.kind === 'support') {
      // URLS.support is hardcoded in `../urls.ts` (compile-time constant),
      // so a runtime guard is unnecessary here.
      if (supportHandle) {
        try { supportHandle.bringToFront(); } catch {}
        popup.hide();
        return;
      }
      if (supportInFlight) return;        // double-click race during await
      supportInFlight = true;
      try {
        // Jivo widget breakpoint: 360px wide content fills the iframe
        // edge-to-edge without gutters; any wider and the content stays
        // ~360 with empty space on the sides (visible as white bars
        // against our white iframe bg). Height is adaptive — Jivo's
        // chat list scrolls and the input bar floats, so any height ≥
        // ~500 looks proportionate. Width fixed at 360 to lock the
        // sweet spot; height = ~78% of main shell, clamped.
        //
        // 1080p main (1392 logical) → 360×~755
        // 4K main (3840 logical)    → 360×900 (capped)
        // 1366×768 laptop           → 360×~600
        //
        // RESIZABLE flag is still on (modal default) so users can drag
        // taller/shorter if they prefer; SetMinSize floors at 360×480
        // so the chat never clips below Jivo's breakpoint.
        const mh = window.outerHeight || 800;
        const width  = 360;
        const height = Math.max(560, Math.min(900, Math.round(mh * 0.78)));
        // UTM tag the Jivo URL with app + Steam + OS versions so support
        // dashboards can slice tickets by build. env-info resolves each
        // dimension on its own (manifest prefix for app, navigator.userAgent
        // for Steam build, UA-CH platformVersion for OS with UA fallback);
        // any unresolved slot falls back to `unknown` inside buildSupportUrl.
        const env = await readSupportEnvInfo();
        const supportUrl = buildSupportUrl(URLS.support, env);
        const handle = await sb.ui.openWindow({
          id: WINDOW_SUPPORT, url: supportUrl, title: LL.checkout.popup.support_window_title(),
          width, height, minWidth: 360, minHeight: 480,
        });
        supportHandle = handle;
        handle.on('close', () => { supportHandle = null; });
        // popup.hide AFTER openWindow resolves — hiding earlier races with
        // popup-show (the popup-blur on focus-loss to the modal would have
        // already closed it).
        popup.hide();
      } catch (e) {
        console.error('[booster-checkout] openWindow support failed:', e);
      } finally {
        supportInFlight = false;
      }
    } else if (d?.kind === 'faq') {
      if (faqHandle) {
        try { faqHandle.bringToFront(); } catch {}
        popup.hide();
        return;
      }
      if (faqInFlight) return;
      faqInFlight = true;
      try {
        const handle = await sb.ui.openWindow({
          id: WINDOW_FAQ,
          url: URLS.faq,
          title: LL.checkout.popup.faq_window_title(),
          width: 720, height: 640, minWidth: 560, minHeight: 420,
        });
        faqHandle = handle;
        handle.on('close', () => { faqHandle = null; });
        popup.hide();
      } catch (e) {
        console.error('[booster-checkout] openWindow faq failed:', e);
      } finally {
        faqInFlight = false;
      }
    }
  });

  // Init flow: two distinct phases (per spec).
  //
  // sendInitCore — login/currency/balance + the popup-needed urls block.
  //                NO email key. Popup sees init, marks initSeen=true,
  //                but emailReceived stays false → pending Pay defers.
  //                Payment methods arrive via a separate `payment-methods`
  //                BC kind driven by the dynamic payments fetch.
  // sendInitEmail — separate kind:'email' message. Popup marks emailReceived
  //                 (regardless of value — empty string means "Steam returned
  //                 no email", popup omits the email field in submit body).
  function sendInitCore(): void {
    const user = sb.steam.getCurrentUser();
    popup.postMessage({
      kind: 'init',
      login:          user?.accountName ?? '',
      currency:       user?.currency ?? null,
      // balance:0 IS a valid empty wallet; bridge.ts assigns only finite
      // numbers so passing null on cold-start is correctly ignored.
      balance:        user?.balance ?? null,
      // Popup-needed URLs forwarded as a single object — historically the
      // trust boundary between the plugin bundle (manifest-signed) and the
      // popup (untrusted realm). URLs are compile-time constants in this
      // plugin today; the wire shape is preserved purely for popup-side
      // compatibility.
      urls: {
        support:        URLS.support,
        popupLogoLink:      URLS.popupLogoLink,
        balanceCalcApi: URLS.balanceCalcApi,
        balanceAddApi:  URLS.balanceAddApi,
      },
      // Stack versions for the popup's booster headers. Delivered at
      // runtime (not baked into the popup bundle) so the popup's bytes
      // stay independent of injector/framework releases — see
      // popup-svelte/lib/headers.ts. Sourced identically to the main-
      // shell headers via the shared getStackVersions helper.
      versions: getStackVersions(sb),
      uuid: (typeof window !== 'undefined'
        && typeof (window as { __SB_BOOSTER_UUID__?: unknown }).__SB_BOOSTER_UUID__ === 'string')
        ? (window as { __SB_BOOSTER_UUID__: string }).__SB_BOOSTER_UUID__ : undefined,
    });
  }

  async function sendInitEmail(): Promise<void> {
    const user = sb.steam.getCurrentUser();
    if (!user) return;
    const email = await user.email();
    popup.postMessage({ kind: 'email', email: email ?? '' });
  }

  // Sync initial seed — currency/login are available immediately when the
  // cache is populated. If null (cold-start ~100ms window) sendInitCore
  // posts init with an empty login; the popup ignores empty logins (does
  // not assign). The onUserChange below re-seeds when a snapshot arrives.
  sendInitCore();
  void sendInitEmail();
  // Initial bus publish — covers the common case where addfunds attaches
  // AFTER main-shell and main-shell's cache is already populated by the
  // time addfunds subscribes. Cold-cold (no user yet) is a no-op; the
  // onUserChange below publishes when the first snapshot lands.
  publishUserSnapshot();

  // onUserChange creates a fresh SteamUser instance per snapshot, so each
  // callback re-fires sendInitEmail's BC roundtrip. Relay-side cache
  // (cleared on accountName change) means SteamClient is hit at most once
  // per account.
  // Re-seed on every snapshot diff (account switch, balance update).
  const unsubUserChange = sb.steam.onUserChange((user) => {
    if (!user) return;
    sendInitCore();
    void sendInitEmail();
    // Cross-target broadcast — store-page subscribers update their
    // currency-aware UI on account switch / balance change.
    publishUserSnapshot();
  });
  cleanups.push(unsubUserChange);

  // Re-seed on popup show (defensive — in case the snapshot changed
  // between shows). onUserChange covers the proactive case; this is a
  // pull on click.
  //
  // The 'shown' BC message tells the popup to reset transient UI state
  // (amount/dropdowns) and focus the amount input. Without it, a user
  // who opens the popup, types 500, clicks outside (Steam closes the
  // popup via hideOnBlur), then re-opens it would see "500" still in
  // the field and the previous dropdown still open — not the clean
  // start the design intends. Method choice (SBP/Card) is preserved
  // across shows because it's a sticky preference, not transient input.
  popup.on('show', () => {
    sendInitCore();
    void sendInitEmail();
    // Consume the prefill carry (set by openTopupWithAmount just before
    // popup.show()). When present, the popup-side bridge seeds ui.amount
    // from this value instead of the currency default — single-envelope
    // contract defuses the race that a separate `kind:'prefill'` post
    // had with the unconditional resetTransientUI() that 'shown' runs.
    const prefillAmount = pendingPrefillAmount;
    pendingPrefillAmount = null;
    popup.postMessage({ kind: 'shown', prefillAmount });
    // Re-emit current payment-methods snapshot + kick a fresh fetch
    // (idempotent if one is in flight). Lets the popup observe any
    // freshly-cached methods on every re-open without waiting for the
    // network round-trip, then upgrades to live data when it lands.
    postPaymentMethodsIfPossible();
    void refreshPaymentMethods();
  });

  // The 'hidden' BC message is a redundant signal — the popup-side
  // bridge has its own document.visibilitychange listener that resets
  // transient state synchronously on the hidden flip (no IPC lag, beats
  // CEF's hidden-tab throttling). This BC path is kept as belt-and-
  // suspenders in case CEF ever drops a visibilitychange event, and
  // for the test harness which drives 'hidden' via postFromOutside
  // without flipping real document.visibilityState.
  popup.on('hide', () => {
    popup.postMessage({ kind: 'hidden' });
  });

  // togglePopup sugar: addHeaderButton itself computes screen-coords from
  // the button rect + popup.width and posts popup-toggle. Mutually
  // exclusive with onClick.
  //
  // Wrapped in try/catch so a registration failure (toolbar layout
  // missing the expected anchor, framework rollback racing init, etc.)
  // does NOT prevent the bus-subscriber buffer from draining. Without
  // the button rect, openTopupWithAmount falls into the viewport-corner
  // fallback — visually degraded but still functional. The throw is
  // logged so a regression surfaces at log-review time. Code-review
  // I-4 from 2026-05-21.
  try {
    topupButtonRef = sb.ui.addHeaderButton({
      id: 'booster-topup',
      label: LL.checkout.popup.button_label(),
      tooltip: LL.checkout.popup.button_tooltip(),
      placement: 'before-profile',
      // Brand-green pill. Icon is the inline 15×12 "S6" SVG mark from
      // assets/icons/sb.svg — narrow enough to sit comfortably in the
      // toolbar pill (the wider SteamBalance wordmark logo.png is used
      // only inside the popup, not here). Framework wraps strings starting
      // with `data:image/` in <img>; SVG strings flow through innerHTML
      // and render as proper SVG elements with their `fill="white"` paths
      // contrasting against the brand-green background.
      variant: 'brand',
      icon: __SB_HEADER_ICON_SVG__,
      togglePopup: popup,
    });
  } catch (e) {
    console.error('[booster-checkout] addHeaderButton failed; topup buffer will drain via fallback position', e);
    topupButtonRef = null;
  }

  // Flip the gate unconditionally — buffer can drain even when the
  // toolbar button registration failed (openTopupWithAmount falls into
  // its viewport-corner fallback when topupButtonRef is null). Drain
  // is in-order (FIFO) so a publisher firing two amounts in succession
  // ends up with the LAST prefill winning at the popup (each
  // `openTopupWithAmount` reposts a fresh prefill via the 'shown'
  // envelope).
  //
  // splice(0) over `while shift` so the iteration is a single
  // local-array walk — same observable behaviour, idiomatic flush
  // pattern. Code-review M-2 from 2026-05-21.
  popupReadyForTopup = true;
  const drain = pendingTopups.splice(0);
  for (const amount of drain) openTopupWithAmount(amount);

  // Toolbar button teardown — host invokes this on rollback / re-injection.
  // Pushed AFTER the (try/catch) registration above; null-guarded because
  // a registration failure leaves topupButtonRef === null but everything
  // else above still needs unwinding.
  cleanups.push(() => {
    if (topupButtonRef) topupButtonRef.remove();
  });

  // AttachedPopupHandle has no explicit destroy() in the public API —
  // popup window lifecycle is owned by the host (relay-side BrowserView
  // pool). The host tears the popup down when this plugin is unloaded.
  // The `popup.on('message' | 'show' | 'hide', …)` handlers above return
  // unsubscribe functions; in steady state they're released alongside
  // popup teardown. If a future Phase-B revision exposes popup.destroy(),
  // wire it here.

  return () => {
    // LIFO cleanup — reverse order of registration so dependents are
    // torn down before the things they depend on.
    for (let i = cleanups.length - 1; i >= 0; i--) {
      try {
        cleanups[i]();
      } catch (e) {
        ctx.log.warn(`cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };
}
