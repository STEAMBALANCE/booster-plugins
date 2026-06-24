// booster-plugins/packages/booster-checkout/popup-svelte/lib/api.ts
//
// Network layer для popup: calc loop (debounced + monotonic id-guard) and
// submitPay (POST /api/balance/add). Все network state mutations идут в
// `ui` reactive store; UI-компоненты subscribe через $derived.
//
// Email omission: see bridge.ts:submitPayWithEmail. submitPay accepts an
// optional email param to keep PII out of the api.ts module signature
// when called without it.

import { ui, _setMethodHealHandler, type CalcResp } from './state.svelte';
import { getBoosterHeaders } from './headers';
import { LL } from '../../src/i18n';

// Module-local id counter — incremented per runCalc call. The async
// callback compares `myId === calcId` after the await; mismatch means a
// newer call has fired and this response is stale, so drop it without
// touching `ui.calc`.
let calcId = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

// 400 ms debounce balances "feels responsive" against "don't hammer
// the backend during fast typing". Per user spec.
//
// calcLoading is flipped to true immediately (not after the timer
// fires) so the pay-button locks on the first keystroke — clicking
// a stale pay-amount during the debounce window would be wrong
// (the next calc may reject the new amount).
export function scheduleCalc(): void {
  clearTimeout(timer);
  ui.calcLoading = true;
  timer = setTimeout(runCalc, 400);
}

// Cancel any pending debounced calc. Called by bridge.ts's
// resetTransientUI() on popup hide so a setTimeout(runCalc, 400) armed
// just before the user clicked outside doesn't fire while the popup is
// hidden — that would issue a wasted /api/balance/calc round-trip whose
// result would land after the reset, then immediately get wiped by the
// next 'shown' re-reset, then the 'shown'-side scheduleCalc would
// re-fire 400 ms later. The monotonic `calcId` guard in runCalc still
// prevents stale-data writes, but skipping the network entirely is
// cleaner. Idempotent — safe to call when no timer is armed.
export function cancelPendingCalc(): void {
  if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
}

async function runCalc(): Promise<void> {
  const myId = ++calcId;
  // Reset path: clear ui.calc when there's nothing meaningful to
  // display (empty input, balanceCalcApi not yet seeded, or no method
  // selected yet). Without the clear, pay-button's payLabel cascade
  // would surface a stale `ui.calc.notice` from a previous in-flight
  // amount after the user backspaces to empty.
  //
  // The empty-balanceCalcApi guard triggers in the narrow window
  // between popup-mount and BC init arrival (~50-100 ms cold path);
  // BC init populates ui.urls.* from the plugin's hardcoded URLS
  // constants (src/urls.ts), forwarded by the main shell.
  //
  // The empty-methodId guard is the popup-side counterpart to the
  // dynamic /api/payments fetch: until methods arrive (or if they fail
  // outright), composing a calc body without a paymentId would 400 the
  // backend. applyPaymentMethods re-fires us via the heal handler the
  // moment methodId transitions "" → non-empty with amount > 0.
  //
  // The empty-userLogin guard mirrors submitPay: the calc body now carries
  // login, so we don't fire calc until the account is seeded. login can lag
  // balanceCalcApi — on cold start init seeds the URLs while login is still
  // empty (the account snapshot lands ~100 ms later in a follow-up init).
  // The App.svelte calc-driver effect tracks ui.userLogin, so calc re-fires
  // the moment login arrives.
  if (ui.amount <= 0 || !ui.urls.balanceCalcApi || !ui.methodId || !ui.userLogin) {
    ui.calc = null; ui.calcLoading = false; ui.calcError = null;
    return;
  }
  ui.calcLoading = true; ui.calcError = null;
  try {
    const r = await fetch(ui.urls.balanceCalcApi, {
      method: 'POST',
      headers: getBoosterHeaders('application/json'),
      body: JSON.stringify({
        amount: ui.amount,
        paymentId: ui.methodId,
        // login mirrors AddRequest — backend scopes the calc to the account.
        login: ui.userLogin,
        // Wallet currency drives the conversion; the user always pays
        // in RUB but the credited amount lands in the wallet currency.
        // Hardcoding 'RUB' produced wrong amountToBalance for KZT/USD
        // wallets (regression vs pre-redesign popup.html — see commit
        // history for the legacy currency-select dropdown). Fall back
        // to 'RUB' only if init hasn't seeded the field yet.
        currency: ui.userCurrency ?? 'RUB',
      }),
    });
    if (myId !== calcId) return;
    if (!r.ok) { ui.calcError = `HTTP ${r.status}`; return; }
    const body = await r.json() as { success: boolean; data: CalcResp };
    ui.calc = body.data;
  } catch {
    if (myId !== calcId) return;
    ui.calcError = 'network';
  } finally {
    if (myId === calcId) ui.calcLoading = false;
  }
}

// Test seam — exposed only for unit tests, no production caller.
export async function _runCalcForTest(): Promise<void> {
  return runCalc();
}
export function _resetIdsForTest(): void {
  calcId = 0;
  if (timer) { clearTimeout(timer); timer = undefined; }
}

// /api/balance/add submission.
export interface AddRequest {
  paymentId: string;
  amount: number;
  login: string;
  currency: string;
  email?: string;
}

// Backend add-response shape. Errors are signalled by `success:false`
// and/or a non-2xx status, with human-readable text in `message` (which
// may carry \r\n). Success carries redirectUrl/uid top-level or under `data`.
interface AddResponse {
  success?: boolean;
  message?: string;
  data?: { redirectUrl?: string; uid?: string };
  redirectUrl?: string;
  uid?: string;
}

export interface SubmitPayResult {
  redirectUrl: string | null;
  uid: string | null;
}

// Register the heal handler with state.svelte at module-init so
// applyPaymentMethods can re-fire calc on heal-on-arrival. See the
// applyPaymentMethods comment in state.svelte.ts for the contract.
_setMethodHealHandler(scheduleCalc);

export async function submitPay(email?: string): Promise<SubmitPayResult | null> {
  // Guard mirrors runCalc — empty balanceAddApi means BC init hasn't
  // arrived yet; we must not POST to "" (which would 404 against the
  // popup's own origin and confuse the pay-flow drain).
  if (!ui.urls.balanceAddApi || !ui.userLogin) return null;
  // email: omit when empty/undefined (backend may treat "" as a clear-email
  // request). bridge.ts holds the latest email locally — never in `ui` —
  // and passes it via this parameter.
  const body: AddRequest = {
    paymentId: ui.methodId,
    amount: ui.amount,
    login: ui.userLogin,
    // Match calc currency: user's wallet currency, fallback RUB.
    currency: ui.userCurrency ?? 'RUB',
    ...(email ? { email } : {}),
  };
  ui.paySubmitting = true;
  try {
    const r = await fetch(ui.urls.balanceAddApi, {
      method: 'POST',
      headers: getBoosterHeaders('application/json'),
      body: JSON.stringify(body),
    });
    // Read the body unconditionally — the backend sometimes returns
    // {success:false, message} WITH HTTP 200, so status alone is not a
    // reliable signal. Non-JSON bodies degrade to null.
    let respBody: AddResponse | null = null;
    try { respBody = await r.json() as AddResponse; } catch { respBody = null; }
    // Error path: non-2xx OR a declared failure. A declared failure wins
    // even if a redirectUrl is inconsistently present — never navigate.
    if (!r.ok || (respBody && respBody.success === false)) {
      ui.payError = (respBody && typeof respBody.message === 'string' && respBody.message)
        ? respBody.message
        : LL.checkout.pay_error.generic();
      return null;
    }
    const redirectUrl = respBody?.data?.redirectUrl ?? respBody?.redirectUrl ?? null;
    const uid = respBody?.data?.uid ?? respBody?.uid ?? null;
    return { redirectUrl, uid };
  } catch {
    // Transport failure (network/DNS/abort) — no backend message, so a
    // generic fallback ensures the pay click never silently no-ops.
    ui.payError = LL.checkout.pay_error.generic();
    return null;
  } finally {
    ui.paySubmitting = false;
  }
}
