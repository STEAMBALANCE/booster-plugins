<!-- booster-plugins/packages/booster-checkout/popup-svelte/App.svelte -->
<script lang="ts">
  import AmountRow from './components/AmountRow.svelte';
  import Footer from './components/Footer.svelte';
  import Header from './components/Header.svelte';
  import InfoRow from './components/InfoRow.svelte';
  import MenuDropdown from './components/MenuDropdown.svelte';
  import PayButton from './components/PayButton.svelte';
  import PayErrorModal from './components/PayErrorModal.svelte';
  import PaymentMethodsError from './components/PaymentMethodsError.svelte';
  import TotalBox from './components/TotalBox.svelte';
  import {
    ui, currencySym, receiveAmount, payAmountRub,
    payDisabled, formatMoney, clampAmountToCalcBounds,
    derivedPay, derivedDesiredFromPay,
  } from './lib/state.svelte';
  import { scheduleCalc } from './lib/api';
  import { scheduleDesiredCommit, cancelDesiredCommit } from './lib/desired-debounce';
  import {
    postSupport, postMenuAction, payAndNavigate, postRefreshPaymentMethods, postFaq, postOpenDoc,
  } from './lib/bridge';
  import { LL } from '../src/i18n';

  // Re-fire calc on amount/methodId/userLogin change. Reading them inside
  // the effect body subscribes to all — Svelte's runes runtime tracks the
  // access. userLogin is tracked because runCalc now guards on it: on cold
  // start, init seeds the URLs while login is still empty (the account
  // snapshot lands ~100 ms later in a follow-up init), so calc must re-fire
  // once login arrives — same shape as methodId's heal-on-arrival.
  $effect(() => {
    ui.amount; ui.methodId; ui.userLogin;
    scheduleCalc();
  });

  // 300 ms optimistic gate for the MethodPicker's mini-spinner. The
  // spinner only appears after methods have been "empty + loading"
  // continuously for ≥300 ms, so a fast network completes silently and
  // the user never sees a flash of spinner. The timer is held in a
  // module-local handle (not state) — only `pastThreshold` is reactive,
  // which avoids the effect-writes-trigger-re-run loop that would
  // happen if we stored the timerId in `ui`.
  let pastThreshold = $state(false);
  let methodPickerTimerId: ReturnType<typeof setTimeout> | null = null;
  // Single-instance assumption: only one <App /> mounts at a time
  // (one popup per Steam session). The module-local timer ID is fine
  // because we don't multiplex multiple popup mounts. Test teardown
  // (popup-render-helper.ts closeAllPopups) unmounts the previous
  // instance before mounting a new one, so the cleanup return from
  // this $effect always fires before the next mount installs a fresh
  // timer.
  $effect(() => {
    const isEmptyLoading =
      ui.paymentMethods.length === 0
      && ui.paymentMethodsLoading
      && ui.paymentMethodsError === null;

    if (isEmptyLoading) {
      if (methodPickerTimerId === null) {
        pastThreshold = false;
        methodPickerTimerId = setTimeout(() => {
          pastThreshold = true;
          methodPickerTimerId = null;
        }, 300);
      }
      return () => {
        if (methodPickerTimerId !== null) {
          clearTimeout(methodPickerTimerId);
          methodPickerTimerId = null;
        }
      };
    }
    if (methodPickerTimerId !== null) {
      clearTimeout(methodPickerTimerId);
      methodPickerTimerId = null;
    }
    pastThreshold = false;
  });

  // Full-popup error mode: shown only when we have NO methods to fall
  // back to AND a hard error is present. A non-empty cache always wins
  // (stale-while-revalidate) — the user can still pay with the cached
  // methods even if the latest /api/payments refresh failed.
  const showErrorScreen = $derived(
    ui.paymentMethods.length === 0 && ui.paymentMethodsError !== null,
  );

  // Wrap function-based helpers via $derived so subscriptions stay explicit.
  const isPayDisabled = $derived(payDisabled());

  // Wallet-currency symbol — shared across receive/total text and
  // AmountRow's input suffix. Single $derived avoids re-computing the
  // 32-currency lookup three times per render.
  const sym = $derived(currencySym(ui.userCurrency));

  // Two-mode display value for the desired-input. In desired-mode shows
  // raw user input (sticky); in pay-mode shows the EXACT derived total
  // (balance + receive) preserving wallet-currency decimals — rounding
  // here would misreport the user's post-pay balance. The Math.ceil
  // rounding lives where it belongs: in derivedPay (pay-amount when
  // user types in desired-mode), NOT in this display.
  //
  // Currency suffix is rendered by TotalBox's separate <span class="suffix">
  // (mirrors AmountRow). Embedding ₽ here would double-render.
  const desiredText = $derived.by(() => {
    if (ui.lastEdited === 'desired') {
      return ui.desiredBalance > 0 ? String(ui.desiredBalance) : '';
    }
    const d = derivedDesiredFromPay();
    if (d === null) return '';
    return formatMoney(d);
  });

  // Editable iff structurally possible: supported wallet currency
  // (matches receiveAmount's three-branch dispatch) AND balance known
  // (post-init). Independent of notice / calcLoading / pay-amount —
  // notice belongs on the pay-button, not as an input lockout.
  const SUPPORTED_DESIRED_CURRENCIES = ['RUB', 'KZT', 'USD'] as const;
  const desiredEditable = $derived(
    ui.userCurrency !== null
    && (SUPPORTED_DESIRED_CURRENCIES as readonly string[]).includes(ui.userCurrency)
    && ui.userBalance !== null
  );

  // Placeholder: editable+desired-mode-empty → "Желаемый баланс";
  // otherwise '—' (pre-init / unsupported / pay-mode display empty).
  const desiredPlaceholder = $derived(
    ui.lastEdited === 'desired'
      ? LL.checkout.total_input.placeholder()
      : '—'
  );

  // Desired-input → pay update debounce. Per user spec: pay-button value
  // should settle 400 ms after the last keystroke, not flicker per
  // character during fast typing. The debounce ONLY delays the
  // `ui.amount = derivedPay()` write — the user's typed digits flow into
  // ui.desiredBalance synchronously so the input never lags.
  // See lib/desired-debounce.ts for the timer module + test seam.
  //
  // Short-circuit when the upcoming commit would not actually change
  // ui.amount (e.g. user clears the input while desiredBalance was
  // already below balance — both states map to derivedPay()=0). Without
  // this guard the same-value write would not re-fire the existing
  // calc-driver $effect (Svelte 5 dedupes by value), so calcLoading=true
  // from the scheduleDesiredCommit call would stick forever, leaving
  // the pay-button frozen on "Расчёт...". Cancel any pending commit
  // and reset the loading flag explicitly in that case.
  function onDesiredInput(value: number): void {
    ui.desiredBalance = value;
    ui.lastEdited = 'desired';
    if (derivedPay() === ui.amount) {
      cancelDesiredCommit();
      ui.calcLoading = false;
      return;
    }
    scheduleDesiredCommit(() => {
      ui.amount = derivedPay();
    });
  }

  // Blur hook — no-op today; placeholder for future soft-clamp.
  function onDesiredCommit(): void { /* no-op */ }

  // Method-switch in desired-mode: re-fire the pay derivation so it
  // matches the new method's expectations. Method switch doesn't
  // change the credit-amount itself (that's just `desired - balance`
  // in wallet currency), but re-asserting the value via the handler
  // path is cheap and keeps state consistent if `derivedPay` ever
  // grows method-specific logic.
  function onMethodSelect(type: string): void {
    ui.methodId = type;
    ui.methodOpen = false;
    if (ui.lastEdited === 'desired' && ui.desiredBalance > 0) {
      ui.amount = derivedPay();
    }
  }

  // pay-input handler: wraps the lastEdited toggle and cancels any
  // pending desired-input debounce. Without the cancel a 500 ms-old
  // commit timer (armed by an earlier desired-input keystroke) would
  // fire AFTER the user has switched to pay-input, overwriting their
  // freshly-typed pay value with the stale derivedPay result.
  function onPayInput(n: number): void {
    cancelDesiredCommit();
    ui.amount = n;
    ui.lastEdited = 'pay';
  }

  // Pay-button label: error/state messages take priority, then the
  // backend-supplied notice (set when amount is outside the allowed
  // range), then the calc'd RUB amount, then a default. The notice
  // string is rendered verbatim — backend is the single source of
  // truth for the boundary-violation copy.
  const payLabel = $derived.by(() => {
    if (ui.paySubmitting) return LL.checkout.pay_button.submitting();
    // Client-side errors take priority over the loading state — they're
    // synchronously knowable (no backend roundtrip needed), so showing
    // "Расчёт..." would just hide actionable feedback during the
    // 400 ms typing-debounce window. Order: synthetic client errors
    // first, calc-pending second, backend-side errors/labels third.
    if (ui.lastEdited === 'desired' && ui.desiredBalance > 0
        && ui.userBalance !== null
        && ui.desiredBalance <= ui.userBalance) {
      return LL.checkout.pay_button.desired_too_low();
    }
    if (ui.calcLoading)   return LL.checkout.pay_button.calculating();
    if (ui.calcError)     return ui.calcError === 'network'
      ? LL.checkout.pay_button.network_error()
      : LL.checkout.pay_button.calc_error();
    if (ui.calc?.notice)  return ui.calc.notice;
    const p = payAmountRub();
    if (p === null) return LL.checkout.pay_button.default();
    return LL.checkout.pay_button.ready({ amount: formatMoney(p) });
  });

  // "Получите: X ₽" — fallback "—" for unsupported currencies (UAH etc.)
  // OR when the backend flagged the amount via `notice` (out-of-range or
  // any other policy rejection): the cached amountToBalance no longer
  // reflects a valid payment, so showing a number would be misleading.
  // The PayButton's notice text already explains what's wrong. Currency
  // symbol falls back to ₽ when wallet currency is not yet known (pre-
  // init <100 ms) so the row matches the TotalBox suffix.
  const receiveText = $derived.by(() => {
    if (ui.calc?.notice) return '—';
    if (ui.amount <= 0) return '—';
    const r = receiveAmount();
    if (r === null) return '—';
    return `${formatMoney(r)} ${sym || '₽'}`;
  });

  // Click-outside selectors target component-scoped class NAMES (not hashes).
  // Svelte preserves both the original `picker` class and the `picker
  // svelte-XXXX` hash on the element, so plain `.picker` matches via
  // `closest()`. Don't rename `.picker` / `.menu-overlay` / `.menu-trigger`
  // without updating this handler. Same applies to `.amount-input` in
  // lib/bridge.ts (focus-on-show selector).
  function handleClickOutside(e: MouseEvent): void {
    if (!ui.menuOpen && !ui.methodOpen) return;
    const target = e.target as HTMLElement;
    if (ui.menuOpen && !target.closest('.menu-overlay') && !target.closest('.menu-trigger'))
      ui.menuOpen = false;
    if (ui.methodOpen && !target.closest('.picker'))
      ui.methodOpen = false;
  }
</script>

<svelte:document onclick={handleClickOutside} />

<div class="root">
  <Header
    menuOpen={ui.menuOpen}
    onMenuToggle={() => { ui.menuOpen = !ui.menuOpen; ui.methodOpen = false; }}
  />

  {#if ui.menuOpen}
    <div class="menu-overlay">
      <MenuDropdown
        supportUrl={ui.urls.support}
        telegramUrl={ui.urls.telegram}
        showSettings={false}
        onOrders={() => { ui.menuOpen = false; postMenuAction('orders'); }}
        onSupport={() => { ui.menuOpen = false; postSupport(); }}
        onTelegram={() => { ui.menuOpen = false; }}
        onTerms={() => { ui.menuOpen = false; postOpenDoc('terms'); }}
        onPrivacy={() => { ui.menuOpen = false; postOpenDoc('privacy'); }}
        onFaq={() => { ui.menuOpen = false; postOpenDoc('faq'); }}
        onSettings={() => { ui.menuOpen = false; postMenuAction('settings'); }}
      />
    </div>
  {/if}

  {#if showErrorScreen}
    <PaymentMethodsError onRefresh={postRefreshPaymentMethods} />
  {:else}
    <!-- Single-child wrapper for the body slot — `display: contents`
     * makes the wrapper transparent to flex layout (children participate
     * in `.root`'s column flow as if it weren't there) while giving
     * Svelte's compiled `{#if}/{:else}` block a single, stable child to
     * mount/unmount. Multiple top-level children in the alternate branch
     * caused happy-dom's sibling traversal to throw (null parentNode)
     * during test runs; flattening to a single child sidesteps that. -->
    <div class="body-slot">
      <AmountRow
        amount={ui.amount}
        onAmountChange={onPayInput}
        onAmountCommit={clampAmountToCalcBounds}
        currencySymbol={sym}
        methods={ui.paymentMethods}
        methodSelectedType={ui.methodId}
        methodOpen={ui.methodOpen}
        methodLoading={ui.paymentMethodsLoading}
        methodPastThreshold={pastThreshold}
        onMethodToggle={() => { ui.methodOpen = !ui.methodOpen; ui.menuOpen = false; }}
        onMethodSelect={onMethodSelect}
      />

      <div class="info-rows">
        <InfoRow label={LL.checkout.info_row.login()} value={ui.userLogin || '—'} />
        <InfoRow label={LL.checkout.info_row.receive()} value={receiveText} />
      </div>

      <TotalBox
        label={LL.checkout.info_row.total_will_be()}
        displayValue={desiredText}
        currencySymbol={sym}
        editable={desiredEditable}
        placeholder={desiredPlaceholder}
        onInput={onDesiredInput}
        onCommit={onDesiredCommit}
      />

      <PayButton
        label={payLabel}
        disabled={isPayDisabled}
        onClick={() => void payAndNavigate()}
      />
    </div>
  {/if}

  <Footer />

  {#if ui.payError !== null}
    <PayErrorModal
      message={ui.payError}
      onClose={() => { ui.payError = null; }}
      onFaq={() => { ui.payError = null; postFaq(); }}
      onSupport={() => { ui.payError = null; postSupport(); }}
    />
  {/if}
</div>

<style>
  /* Native Steam Notifications popup look: solid dark fill with a
   * radial top-left highlight, 1px black outer border, and a pair of
   * inset shadows that draw the inner 1px frame. Values lifted from
   * the live CDP-inspected Notifications target — see tokens.css
   * (--booster-popup-bg-highlight, --booster-popup-inset-shadow). Sharp corners
   * match Steam — no border-radius. */
  .root {
    background: var(--booster-popup-bg-highlight), var(--booster-surface-0);
    border-radius: 0;
    padding: 20px 20px 8px 20px;
    width: 378px; height: 248px;
    border: 1px solid var(--booster-popup-stroke);
    box-shadow: var(--booster-popup-inset-shadow);
    box-sizing: border-box;
    position: relative;
    display: flex; flex-direction: column;
  }
  .menu-overlay {
    position: absolute;
    top: 44px; right: 20px;
    z-index: 10;
  }
  /* Figma 230:53 production layout (NOT spec § 2.2 — that table was
   * derived from an outdated mockup): all inter-section gaps are 8 px,
   * not 12/16. TotalBox is always visible (no conditional hide), so the
   * single layout case is:
   *   24 (header) + 8 + 32 (amount) + 8 + 40 (info-rows) + 8 + 32
   *   (total) + 8 + 32 (pay) + 8 + 12 (footer) = 212 → 8 px slack
   *   absorbed by Footer's margin-top: auto. */
  .info-rows {
    display: flex; flex-direction: column;
    gap: 8px;
    margin-top: 8px;
  }
  /* See comment near .body-slot in template above — transparent flex
   * passthrough so layout is identical to having the children directly
   * inside .root. */
  .body-slot {
    display: contents;
  }
</style>
