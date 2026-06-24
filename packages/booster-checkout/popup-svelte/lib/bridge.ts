// booster-plugins/packages/booster-checkout/popup-svelte/lib/bridge.ts
//
// BroadcastChannel('sb_cmd') wire bridge. Same channel as ui.ts and relay
// use; popup-postMessage events from main shell land here, popup-message
// events we post are picked up by ui.ts in main.
//
// Trust boundary: same-origin (steambalance.host). The popupId+kind filter
// is rejection-of-unrelated-traffic, NOT a security boundary — any
// same-origin context could forge these. Same threat model as the previous
// window.opener filter (which was also same-origin trust).
//
// PII discipline: email is held LOCALLY in this module — never written
// into the ui $state tree. submitPayWithEmail reads it directly before
// composing the /add request and passes it to api.submitPay() which
// conditionally spreads it into the body.
//
// Two-phase init contract (preserved from src/popup.html):
//   1. Main shell posts kind:'init' with login/currency/balance and a
//      nested `urls` object (support, popupLogoLink, balanceCalcApi,
//      balanceAddApi) sourced from the plugin's hardcoded URLS constants
//      (src/urls.ts) and forwarded by the main shell over BC.
//      Spurious empty fields do NOT overwrite existing values.
//      Payment methods arrive separately via kind:'payment-methods' driven
//      by the dynamic /api/payments fetch in the booster-checkout IIFE.
//   2. Main shell posts kind:'email' with the user's saved email
//      (may be empty string — meaning "user has none on file").
//   pendingPay is set when the user clicks pay before both arrived; once
//   both flags trip, drain triggers payAndNavigate automatically.

import { submitPay, scheduleCalc, cancelPendingCalc } from './api';
import { cancelDesiredCommit } from './desired-debounce';
import {
  ui, applyPaymentMethods, defaultAmountForCurrency,
  type PaymentMethod,
} from './state.svelte';

// Must match the wire-side popupId emitted by ui.ts after the per-plugin
// UI wrapper auto-prefixes it (spec H4: <plugin-id>__<user-id>). The
// install side calls sb.ui.attachPopup({ id: 'sb_topup' }) and the
// framework's createPluginUi rewrites that to 'booster-checkout__sb_topup'.
// The popup is booster-checkout's own embedded build, so the prefix is known.
const POPUP_ID = 'booster-checkout__sb_topup';
const CHANNEL = 'sb_cmd';

let bc: BroadcastChannel | null = null;
let email = '';   // local-only PII (never goes into ui state)

export function initBridge(): void {
  // Idempotent: re-entry would leak the previous channel + its listener
  // (production never calls this twice — main.ts:18 is the only caller —
  // but guarding cheaply hardens against future re-init patterns).
  if (bc) return;
  bc = new BroadcastChannel(CHANNEL);
  bc.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if ((m as { popupId?: string }).popupId !== POPUP_ID) return;
    if ((m as { kind?: string }).kind !== 'popup-postMessage') return;
    const d = (m as { data?: unknown }).data;
    if (!d || typeof d !== 'object') return;
    handleIncoming(d as Record<string, unknown>);
  });

  // Synchronous local hide-reset: fires the moment CEF flips the
  // popup's visibilityState to 'hidden' (verified via CDP trace —
  // Steam's HideWindow propagates to document.visibilityState before
  // Chromium's hidden-tab throttling kicks in). The 'hidden' BC
  // round-trip is subject to that throttling and can land in the same
  // JS tick as the next 'shown' AFTER the popup re-paints with stale
  // state — that's the user-visible "dropdowns close on their own"
  // flash. This local listener runs synchronously in the popup's own
  // event loop, no IPC dependency, so the reset completes before any
  // re-show paint regardless of how the BC roundtrip is throttled.
  //
  // The BC 'hidden' kind is kept as belt-and-suspenders (and so that
  // cross-realm tests that drive 'hidden' via postMessage still see
  // the reset effect). Cheap insurance — both paths call the same
  // idempotent helper.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') resetTransientUI();
    });
  }
}

// Reset the popup's transient UI state (input value, open dropdowns,
// in-flight / stale calc data, pendingPay flag). Session-level state
// (login / host / payment methods / methodId / balance / currency /
// initSeen / emailReceived) is preserved — those came from init or
// payment-methods and survive across opens by design.
//
// Also cancels any pending scheduleCalc debounce timer. Without this,
// a setTimeout(runCalc, 400) armed just before hide would still fire
// while the popup is hidden, issuing a wasted /api/balance/calc whose
// result the next 'shown'-side reset would discard anyway.
//
// Idempotent: running this twice in a row with the same `userCurrency`
// (and same prefillAmount) produces the same final state. That's
// load-bearing — three call sites invoke this: the visibilitychange
// listener (synchronous, local, no IPC), the 'hidden' BC handler
// (cross-context redundant), and the 'shown' BC handler (race-defence
// — see its caller comment). The second and third calls must not
// visibly perturb state.
//
// `prefillAmount` (default null) lets the 'shown' handler seed the
// amount input from a cross-target `booster-addfunds.topup-requested` publish (see
// main-shell.ts::openTopupWithAmount). When null, falls back to the
// currency-specific default (RUB → 1000, KZT → 7000, USD → 15,
// others → 0; see defaultAmountForCurrency).
function resetTransientUI(prefillAmount: number | null = null): void {
  cancelPendingCalc();
  // Cancel any pending desired-input → pay-amount debounce commit;
  // otherwise the 500 ms timer would fire ~during the next popup-open
  // and clobber the freshly-seeded default ui.amount with a stale
  // derivedPay write from the prior session.
  cancelDesiredCommit();
  ui.amount = prefillAmount !== null
    ? prefillAmount
    : defaultAmountForCurrency(ui.userCurrency);
  ui.menuOpen = false;
  ui.methodOpen = false;
  ui.calc = null;
  ui.calcError = null;
  ui.calcLoading = false;
  ui.pendingPay = false;
  ui.payError = null;
  // Reset two-way-bind state to default pay-mode with empty desired.
  ui.lastEdited = 'pay';
  ui.desiredBalance = 0;
}

function handleIncoming(d: Record<string, unknown>): void {
  if (d.kind === 'init') {
    // Spurious empty init guard: only assign non-empty strings. A mid-
    // account-switch race in the main-shell could otherwise zero out a
    // working state. Cleared values are intentionally re-seeded by the
    // main-shell via popup.postMessage if it ever needs to reset.
    if (typeof d.login === 'string' && d.login)              ui.userLogin = d.login;
    if (typeof d.currency === 'string' && d.currency)        ui.userCurrency = d.currency;
    // Defensive: only assign valid finite number; ignore null/undefined to
    // avoid wiping a previously-correct balance during a momentarily stale
    // onUserChange snapshot. balance:0 IS valid (empty wallet).
    if (typeof d.balance === 'number' && Number.isFinite(d.balance))
      ui.userBalance = d.balance;
    // Narrow the nested `urls` object — defensive cast since BC payload
    // is `unknown` until verified. Per-field typeof check protects
    // against partial / malformed payloads (defense in depth — the
    // main-shell forwards these from the plugin's hardcoded URLS
    // constants in src/urls.ts).
    const urls = (d as { urls?: unknown }).urls;
    if (urls && typeof urls === 'object') {
      const u = urls as Record<string, unknown>;
      if (typeof u.support        === 'string') ui.urls.support        = u.support;
      if (typeof u.popupLogoLink  === 'string') ui.urls.popupLogoLink  = u.popupLogoLink;
      if (typeof u.telegram       === 'string') ui.urls.telegram       = u.telegram;
      if (typeof u.balanceCalcApi === 'string') ui.urls.balanceCalcApi = u.balanceCalcApi;
      if (typeof u.balanceAddApi  === 'string') ui.urls.balanceAddApi  = u.balanceAddApi;
    }
    // Stack versions (injector + framework) for the popup's booster
    // headers — delivered at runtime, NOT baked into the bundle (see
    // headers.ts; keeps the immutable-CDN bytes plugin-version-stable).
    // Main-shell sources them from window.__SB_PLUGINS_MANIFEST__ + sb.version
    // and forwards over BC. Accept a field only when it's a non-empty,
    // CRLF-free string: the spurious-empty guard (like login/currency above)
    // stops a mid-switch re-init from zeroing a working version, and the
    // CRLF drop is the same header-smuggling defense — these values are
    // header-bound and arrive over the untrusted BC realm.
    const versions = (d as { versions?: unknown }).versions;
    if (versions && typeof versions === 'object' && typeof window !== 'undefined') {
      const vv = versions as Record<string, unknown>;
      const ok = (x: unknown): x is string =>
        typeof x === 'string' && x.length > 0 && !/[\r\n]/.test(x);
      const w = window as { __SB_BOOSTER_VERSIONS__?: { injector?: string; framework?: string } };
      const cur = w.__SB_BOOSTER_VERSIONS__ ?? {};
      w.__SB_BOOSTER_VERSIONS__ = {
        injector:  ok(vv.injector)  ? vv.injector  : cur.injector,
        framework: ok(vv.framework) ? vv.framework : cur.framework,
      };
    }
    // Machine UUID for booster headers — delivered at runtime over BC
    // (same trust boundary as versions). Inline predicate mirrors the
    // `ok` guard inside the versions block above (ok is block-local).
    const rawUuid = (d as { uuid?: unknown }).uuid;
    if (typeof rawUuid === 'string' && rawUuid.length > 0 && !/[\r\n]/.test(rawUuid) && typeof window !== 'undefined') {
      (window as { __SB_BOOSTER_UUID__?: string }).__SB_BOOSTER_UUID__ = rawUuid;
    }
    // initSeen — "init message arrived AND key pay-flow fields are set".
    // ui.urls.balanceAddApi is the URL submitPay hits; without it the
    // drain can't fire. Previously gated on ui.host (same semantic — host
    // composed into the same /api/balance/add URL).
    ui.initSeen = !!(ui.userLogin && ui.urls.balanceAddApi);
    // On any init where the user hasn't typed yet (amount === 0), seed
    // amount from the wallet currency default (RUB → 1000, KZT → 7000,
    // USD → 15; other currencies → 0). The user-hasn't-typed guard
    // protects the race where init arrives AFTER the user already
    // typed into the field — we don't want to clobber their input.
    // The 'shown' handler unconditionally re-applies the default on
    // each re-open (transient reset), so symmetric guard isn't needed
    // there.
    if (ui.amount === 0) {
      ui.amount = defaultAmountForCurrency(ui.userCurrency);
    }
  } else if (d.kind === 'payment-methods') {
    // Defensive validation — never trust the wire blindly even on a
    // same-origin BC. Drop any item that's not a fully-formed
    // PaymentMethod.
    const methods = Array.isArray(d.methods)
      ? (d.methods as unknown[]).filter((x): x is PaymentMethod =>
          x !== null && typeof x === 'object'
          && typeof (x as Record<string, unknown>).type === 'string'
          && typeof (x as Record<string, unknown>).name === 'string'
          && typeof (x as Record<string, unknown>).imageUrl === 'string')
      : [];
    applyPaymentMethods(methods);
    ui.paymentMethodsLoading = !!d.loading;
    ui.paymentMethodsError =
      (typeof d.error === 'string' && d.error) ? d.error : null;
  } else if (d.kind === 'email') {
    email = (typeof d.email === 'string') ? d.email : '';
    ui.emailReceived = true;
  } else if (d.kind === 'hidden') {
    // Popup just became hidden (Steam closed it on outside-click, or
    // the framework's relay called popup.hide() programmatically).
    // Cross-realm redundant signal — the popup-local visibilitychange
    // listener in initBridge has typically already run resetTransientUI
    // synchronously by the time this BC arrives. Kept for the test
    // harness (which drives 'hidden' via postFromOutside without
    // actually flipping document.visibilityState) and for defense in
    // depth in case CEF ever drops a visibilitychange event.
    resetTransientUI();
  } else if (d.kind === 'shown') {
    // Popup just became visible. Race-defence reset: when CEF throttles
    // the popup while hidden, both 'hidden' and 'shown' can arrive in
    // the same JS tick AFTER re-show — meaning the popup's first paint
    // after re-show uses the pre-reset (stale) state. The local
    // visibilitychange listener defends against most of that window
    // (it fires synchronously on the hidden flip, before throttling),
    // but a paint can still race the reset on truly slow PCs. This
    // 'shown'-side reset ensures the second paint after re-show is
    // clean. Idempotent — re-assigning the same defaults is a no-op
    // for the reactive graph. Session-level state (login/host/
    // paymentMethods/methodId/balance/userCurrency) is preserved —
    // those came from init / payment-methods and shouldn't be wiped.
    //
    // `prefillAmount` (optional) is the carry from main-shell when the
    // current show was triggered by a cross-target `booster-addfunds.topup-requested`
    // publish (addfunds page → main-shell::openTopupWithAmount). The
    // single-envelope contract avoids a race where a separate
    // `kind:'prefill'` message could be clobbered by the 'shown' reset
    // running afterwards. Validates: finite number > 0; fractional
    // values are floored — same shape as the publish-side filter in
    // main-shell.ts's bus subscriber.
    const rawPrefill = (d as { prefillAmount?: unknown }).prefillAmount;
    const prefillAmount = typeof rawPrefill === 'number'
                         && Number.isFinite(rawPrefill)
                         && rawPrefill > 0
      ? Math.floor(rawPrefill)
      : null;
    resetTransientUI(prefillAmount);
    // Kick a fresh calc explicitly. The App.svelte $effect tracking
    // (ui.amount, ui.methodId) only re-runs when one of those changes —
    // on re-open both may already equal their previous-open values
    // (pre-filled default + sticky payment method), so the effect does
    // NOT re-fire even though we just wiped ui.calc to null above.
    // Without this call, the popup re-opens showing "Получите: —"
    // and a disabled pay-button until the user manually edits the
    // amount field. scheduleCalc is debounced 400ms and idempotent,
    // so calling it here is safe even if the $effect ALSO fires.
    scheduleCalc();
    // Auto-focus the amount input so the user can start typing
    // immediately after opening the popup (one click → amount field
    // focused → digits flow). queueMicrotask defers past the current
    // tick so Svelte's reactive state updates (the resets above) flush
    // first; otherwise the focus call may race with a re-render that
    // momentarily blurs the input.
    queueMicrotask(() => {
      // Guard for bun's runtime (no DOM in unit-test context); production
      // always has `document` because the popup's CEF page hosts it.
      // Avoid `instanceof HTMLInputElement` since some test runs leave
      // that constructor undefined even when `document` is shimmed.
      if (typeof document === 'undefined') return;
      const inp = document.querySelector('.amount-input') as HTMLElement | null;
      inp?.focus?.();
    });
  }

  // Drain pendingPay if init+email both arrived.
  if (ui.pendingPay && ui.initSeen && ui.emailReceived) {
    ui.pendingPay = false;
    void payAndNavigate();
  }
}

export function postSupport(): void {
  if (!bc) return;
  bc.postMessage({ kind: 'popup-message', popupId: POPUP_ID, data: { kind: 'support' } });
}

export function postOpenDoc(doc: 'terms' | 'privacy' | 'faq'): void {
  if (!bc) return;
  bc.postMessage({ kind: 'popup-message', popupId: POPUP_ID, data: { kind: 'open-doc', doc } });
}

// PayErrorModal's «FAQ» — тонкий алиас над единым open-doc путём.
export function postFaq(): void {
  postOpenDoc('faq');
}

export function postMenuAction(action: 'orders' | 'settings'): void {
  if (!bc) return;
  bc.postMessage({ kind: 'popup-message', popupId: POPUP_ID, data: { kind: 'menu-action', action } });
}

// Popup → main shell: request a fresh /api/payments fetch. The
// booster-checkout main-shell IIFE listens for this on the popup-message BC
// and re-runs the fetchPaymentMethods routine.
export function postRefreshPaymentMethods(): void {
  if (!bc) return;
  bc.postMessage({
    kind: 'popup-message',
    popupId: POPUP_ID,
    data: { kind: 'refresh-payment-methods' },
  });
}

// Test seam — resets module-local state (BroadcastChannel + email)
// so each test starts from a clean slate. Production never calls
// this; initBridge() is called once at popup mount.
export function _resetForTest(): void {
  if (bc) bc.close();
  bc = null;
  email = '';
}

export async function payAndNavigate(): Promise<void> {
  if (!ui.initSeen || !ui.emailReceived) {
    ui.pendingPay = true;
    return;
  }
  const res = await submitPay(email || undefined);
  if (!res || !bc) return;
  const { redirectUrl, uid } = res;
  // uid rides to main even without redirectUrl — order is already created
  // and must appear in «Мои Заказы». Navigation only when url is present.
  if (!redirectUrl && !uid) return;
  bc.postMessage({
    kind: 'popup-message',
    popupId: POPUP_ID,
    data: { kind: 'navigate', url: redirectUrl ?? '', uid: uid ?? undefined },
  });
}
