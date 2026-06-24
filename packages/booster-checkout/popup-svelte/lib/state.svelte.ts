// booster-plugins/packages/booster-checkout/popup-svelte/lib/state.svelte.ts
//
// Single $state object pattern для cross-module reactive sharing.
// Файл-расширение `.svelte.ts` обязательно — Svelte preprocessor
// компилирует runes здесь. `export let x = $state(0)` is invalid in
// .svelte.ts; the runes-compiler accepts only an outer `$state(obj)`
// wrapped value whose inner properties become reactive.
//
// PII discipline: email is NEVER stored here. It lives in bridge.ts module
// scope and is passed into submitPay() per-call. Anything in `ui` is fair
// game for component reads / dev-tools inspection.

// Currency table — single source of truth in booster-plugins/packages/booster-checkout/src/lib/currency.ts.
// Re-exported here so existing popup-svelte consumers keep working.
export {
  CURRENCY_SYM,
  DEFAULT_AMOUNT_BY_CURRENCY,
  currencySym,
  defaultAmountForCurrency,
} from '../../src/lib/currency';

export interface CalcResp {
  amount: number;            // ★ к оплате в RUB (всегда)
  amountToBalance: number;   // зачисление, RUB
  amountToBalanceUSD: number;
  amountToBalanceKZT: number;
  minAmount: number;
  maxAmount: number;
  // Бэк выставляет когда введённая сумма выходит за допустимые границы
  // (min/max/...). UI: показать на pay button + disable submit +
  // degrad'ить receive/total к '—'. Отсутствует когда оплата допустима.
  notice?: string;
}

// Payment method entry. The dynamic /api/payments list materialises as
// this shape; `type` is sent verbatim as the `paymentId` body field on
// calc / add. `imageUrl` is the resolved CDN URL (popup renders via
// <img src>). `badge` is an optional backend-driven label (e.g. "~0%").
export interface PaymentMethod {
  type: string;
  name: string;
  imageUrl: string;
  badge?: string;
}

export const ui = $state({
  // User input
  amount:        0 as number,
  // methodId is the currently-selected PaymentMethod.type. Empty string
  // means "no methods loaded yet" — applyPaymentMethods seeds the first
  // entry's type on first non-empty arrival. The old 'sbp'|'card' literal
  // union is gone; the dynamic /api/payments list drives this now.
  methodId:      '' as string,
  menuOpen:      false,
  methodOpen:    false,
  // Which numeric input was edited last. Drives display-binding in
  // App.svelte (desiredText / payLabel branches) and the desired-mode
  // debounce cancellation in onPayInput. 'pay' on popup open (default
  // amount is seeded into ui.amount by bridge.ts's resetTransientUI /
  // init handler).
  lastEdited:    'pay' as 'pay' | 'desired',
  // Raw integer typed into the desired-balance input. 0 = empty
  // (matches ui.amount's "empty" sentinel). Only meaningful when
  // lastEdited === 'desired'.
  desiredBalance: 0 as number,

  // Init from main-shell (read-only after seed)
  userLogin:     '',
  userCurrency:  null as string | null,
  userBalance:   null as number | null,
  // Popup-needed URLs forwarded by main-shell from the plugin's
  // hardcoded URLS constants (src/urls.ts), packed into a single object
  // and sent over BC. Empty-string defaults are the pre-init window (BC
  // init message hasn't arrived yet — sub-100 ms cold path); bridge.ts
  // populates these on the {kind:'init'} envelope.
  urls: {
    support:        '',
    popupLogoLink:  '',
    telegram:       '',
    balanceCalcApi: '',
    balanceAddApi:  '',
  },
  initSeen:      false,
  emailReceived: false,
  pendingPay:    false,

  // Dynamic payment methods (replaces the legacy paymentIds map).
  paymentMethods:        [] as PaymentMethod[],
  paymentMethodsLoading: false,
  paymentMethodsError:   null as string | null,

  // Calc
  calc:          null as CalcResp | null,
  calcLoading:   false,
  calcError:     null as string | null,

  // Pay
  paySubmitting: false,
  // Non-null = the add request failed; holds the human-readable error
  // text (backend `message`, or a generic fallback). Drives the in-popup
  // PayErrorModal. Transient — reset by bridge.ts resetTransientUI.
  payError: null as string | null,
});

// Returns the wallet-currency credit amount derived from calc, or null
// when wallet currency is anything other than {RUB,KZT,USD} — backend
// only quotes those three. Caller (App.svelte) renders "—" for null.
export function receiveAmount(): number | null {
  if (!ui.calc) return null;
  switch (ui.userCurrency) {
    case 'USD': return ui.calc.amountToBalanceUSD;
    case 'KZT': return ui.calc.amountToBalanceKZT;
    case 'RUB': return ui.calc.amountToBalance;
    default:    return null;  // unsupported currency → "—"
  }
}

export function payAmountRub(): number | null {
  return ui.calc?.amount ?? null;
}

// Single source of truth for "amount is within bounds". Boundary
// values themselves (minAmount=100, amount=100) pass. Returns false
// before calc lands (defensive — payDisabled also gates on !ui.calc).
// Restored 2026-05-15 per spec bug-4-calc-soft-clamp.md.
export function validAmount(): boolean {
  if (!ui.calc) return false;
  return ui.amount >= ui.calc.minAmount && ui.amount <= ui.calc.maxAmount;
}

// Snap amount to nearest boundary. Called on input blur (onchange
// event). Pure mutation on ui.amount; subsequent $effect in App.svelte
// re-fires calc with the clamped value, the backend then returns a
// valid calc (no notice) and pay-button enables.
//
// Guarded by ui.calc presence: if calc hasn't arrived yet, blur is a
// no-op — the user's typed value stays, the eventual calc-arrival
// $effect will recalculate the bounds.
//
// Zero is treated as "empty input" (the user cleared the field), not
// as "below min" — we don't clamp 0 → minAmount. Restored 2026-05-15.
export function clampAmountToCalcBounds(): void {
  if (!ui.calc) return;
  if (ui.amount > 0 && ui.amount < ui.calc.minAmount) {
    ui.amount = ui.calc.minAmount;
  } else if (ui.amount > ui.calc.maxAmount) {
    ui.amount = ui.calc.maxAmount;
  }
}

// Disabled when:
//   - amount пуст (0) — UI не позволит submit пустой формы
//   - calc вообще ещё не подъехал (init не завершился)
//   - amount вне допустимых границ (client-side primary gate)
//   - calc в полёте / failed на transport-уровне
//   - submit уже в полёте
//   - бэк вернул notice (secondary cross-check — backend policy reject
//     can flag in-range amounts too, e.g. "Метод временно недоступен")
//   - методы оплаты не загружены
export function payDisabled(): boolean {
  // Ordering: cheap structural gates first (amount/calc presence),
  // then validAmount (which dereferences ui.calc — already guarded
  // internally but the !ui.calc gate above short-circuits anyway),
  // then notice cross-check. The `!validAmount()` check is technically
  // redundant with `!ui.calc` (validAmount returns false when !calc);
  // kept for clarity at the gate boundary — the intent "amount is
  // in bounds" is named, not inferred. Per code-review M3.
  //
  // Truthy check on `notice` (not `!== undefined`) — backend contract is
  // "absent or non-empty string". A defensive `!!` guards against a future
  // backend bug shipping `notice: ""` (which under `!== undefined` would
  // disable the button with an empty label).
  return ui.amount <= 0
      || !ui.calc                 // ← short-circuit before validAmount deref
      || !validAmount()           // ← primary client-side bounds gate
      || ui.calcLoading || ui.calcError !== null
      || ui.paySubmitting
      || !!ui.calc.notice         // ← retained as cross-check
      || ui.paymentMethods.length === 0;
}

// Callback registry — api.ts registers scheduleCalc here at module-init
// so applyPaymentMethods can re-fire calc on heal-on-arrival (user typed
// an amount before methods arrived → once methods land, kick a calc so
// the pay-flow becomes available). Done via a callback registry rather
// than a dynamic import() — popup runs as an IIFE bundle without network
// fetch, so dynamic import is unsupported. Static circular import would
// be possible but less hygienic.
let methodHealHandler: (() => void) | null = null;
export function _setMethodHealHandler(fn: (() => void) | null): void {
  methodHealHandler = fn;
}

// Single mutator for the payment-methods slice of `ui`. Covers:
//   * First-init (empty selection → pick fresh[0])
//   * Normal refresh (preserve current selection if still in the list)
//   * Backend drop (current method gone → fall back to fresh[0])
//   * Empty list (clear selection)
// Heal-on-arrival: when methodId transitions from "" to non-empty AND
// the user has already typed a positive amount, fire the heal handler
// so api.ts re-runs calc (the original calc was no-op'd by the empty
// methodId guard).
export function applyPaymentMethods(fresh: PaymentMethod[]): void {
  const prevMethodId = ui.methodId;
  ui.paymentMethods = fresh;
  if (fresh.length === 0) { ui.methodId = ''; return; }
  if (!fresh.some(m => m.type === ui.methodId)) {
    ui.methodId = fresh[0].type;
  }
  if (prevMethodId === '' && ui.methodId !== '' && ui.amount > 0) {
    methodHealHandler?.();
  }
}

// 2-decimal default; trailing ".00" stripped for clean display ("100" not
// "100.00") but ".50"/".75" preserved. toFixed(2) rounds float-drift
// (1234.5600000001 → "1234.56").
export function formatMoney(n: number): string {
  const fixed = n.toFixed(2);
  if (fixed.endsWith('.00')) return fixed.slice(0, -3);
  return fixed;
}

// Inverse calc — what value should the user type in the pay-input to
// reach `desiredBalance` after the top-up?
//
// `ui.amount` semantics (pre-existing, unchanged): the user-typed
// amount IS what they want credited to their wallet, in their wallet
// currency. The backend's /api/balance/calc receives this value plus
// the wallet currency code and figures out the RUB pay-required +
// returns wallet-currency credit. So no ratio multiplication is
// needed here — credit-to-add equals `desired - balance` in wallet
// units. Round UP so the resulting balance is ≥ desired even when
// the difference is fractional (RUB balance "2177.35", desired 3000
// → needed 822.65 → ceil 823).
//
// Returns 0 when desired is empty or ≤ balance (caller falls into
// payDisabled's `ui.amount <= 0` gate); a positive integer otherwise.
export function derivedPay(): number {
  if (ui.desiredBalance <= 0) return 0;
  const balance = ui.userBalance ?? 0;
  const needed = ui.desiredBalance - balance;
  if (needed <= 0) return 0;
  return Math.ceil(needed);
}

// Forward derivation: what TotalBox shows in pay-mode (lastEdited === 'pay').
// Returns null when calc isn't available, notice is set (pay value
// is invalid so the implied total is meaningless), wallet currency
// is unsupported (receive itself is null), OR ui.amount is 0 (no
// in-flight pay → "Итого" should reflect "nothing to add" and not
// show a stale receive sum).
// Caller fallback is '—'.
export function derivedDesiredFromPay(): number | null {
  if (!ui.calc || ui.calc.notice) return null;
  if (ui.amount <= 0) return null;
  const balance = ui.userBalance ?? 0;
  const receive = receiveAmount();
  if (receive === null) return null;
  return balance + receive;
}
