<!-- booster-plugins/packages/booster-checkout/popup-svelte/components/AmountRow.svelte -->
<script lang="ts">
  import MethodPicker from './MethodPicker.svelte';
  import type { PaymentMethod } from '../lib/state.svelte';
  import { LL } from '../../src/i18n';
  import { parseDigitsWithCaretPreservation } from '../lib/numeric-input';

  interface Props {
    amount: number;
    onAmountChange: (n: number) => void;
    onAmountCommit: () => void;
    currencySymbol: string;
    methods: PaymentMethod[];
    methodSelectedType: string;
    methodOpen: boolean;
    methodLoading: boolean;
    methodPastThreshold: boolean;
    onMethodToggle: () => void;
    onMethodSelect: (type: string) => void;
  }
  let {
    amount, onAmountChange, onAmountCommit, currencySymbol,
    methods, methodSelectedType, methodOpen,
    methodLoading, methodPastThreshold,
    onMethodToggle, onMethodSelect,
  }: Props = $props();

  // Pay-amount input handler. parseDigitsWithCaretPreservation does the
  // strip+caret math; we just adapt the result into the callback shape.
  // pattern="\d*" + inputmode="numeric" stay as autofill/keypad hints —
  // the util is the actual filter on every input event (paste/IME/key).
  function handleInput(e: Event): void {
    const el = e.currentTarget as HTMLInputElement;
    onAmountChange(parseDigitsWithCaretPreservation(el));
  }
</script>

<div class="row">
  <div class="amount-cell">
    <input
      class="amount-input"
      type="text" inputmode="numeric" pattern="\d*"
      value={amount > 0 ? amount : ''}
      placeholder={LL.checkout.amount.placeholder()}
      onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
      oninput={handleInput}
      onchange={onAmountCommit}
    />
    <!-- Reserve space pre-init: render a placeholder ₽ with visibility
         hidden when userCurrency is null, so the input width is stable
         across the init message arrival. -->
    <span class="suffix" class:invisible={!currencySymbol}>{currencySymbol || '₽'}</span>
  </div>
  <MethodPicker
    methods={methods}
    selectedType={methodSelectedType}
    open={methodOpen}
    loading={methodLoading}
    pastThreshold={methodPastThreshold}
    onToggle={onMethodToggle}
    onSelect={onMethodSelect}
  />
</div>

<style>
  /* Figma 230:53: all inter-section gaps in payment-popup are 8 px.
   * AmountRow sits 8 px below the 24 px header. */
  .row { display: flex; gap: 8px; height: 32px; margin-top: 8px; }
  /* min-width: 0 here is load-bearing: without it, the default
   * `min-width: auto` on flex children expands the cell to its intrinsic
   * content width, which shoves the right-hand picker (also flex:1) below
   * its 165 px Figma slot. Symmetric with `.picker { min-width: 0 }` so
   * both flex children shrink equally. */
  .amount-cell {
    display: flex; align-items: center;
    flex: 1; min-width: 0;
    height: 32px; padding: 0 12px;
    background: var(--booster-surface-2);
    border-radius: var(--booster-radius-sm);
    border: 1px solid transparent;
    transition: border-color .12s ease;
  }
  .amount-cell:focus-within { border-color: var(--booster-surface-hover); }

  .amount-input {
    flex: 1; min-width: 0;
    background: transparent; border: none; outline: none;
    color: var(--booster-text-primary);
    font: 700 14px/16px var(--booster-font-stack);
  }
  .amount-input::placeholder { color: var(--booster-text-muted); }
  .suffix {
    color: var(--booster-text-primary);
    font: 700 14px/16px var(--booster-font-stack);
    margin-left: 4px;
  }
  .suffix.invisible { visibility: hidden; }
</style>
