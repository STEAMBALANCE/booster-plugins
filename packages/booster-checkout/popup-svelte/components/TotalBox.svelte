<!-- booster-plugins/packages/booster-checkout/popup-svelte/components/TotalBox.svelte -->
<script lang="ts">
  import { parseDigitsWithCaretPreservation } from '../lib/numeric-input';

  interface Props {
    label: string;            // "Итого на балансе будет"
    displayValue: string;     // raw user input (desired-mode) OR formatted derived total (pay-mode) OR '—'
    currencySymbol: string;   // wallet currency symbol (or '' pre-init)
    editable: boolean;        // true → <input>; false → <span> fallback
    placeholder: string;      // shown when input empty AND editable
    onInput: (value: number) => void;
    onCommit: () => void;
  }
  let {
    label, displayValue, currencySymbol,
    editable, placeholder, onInput, onCommit,
  }: Props = $props();

  // Shared digit-only handler used by AmountRow too. See
  // lib/numeric-input.ts. parseInt(0) sentinel for empty inputs flows
  // through to ui.desiredBalance.
  function handleInput(e: Event): void {
    const el = e.currentTarget as HTMLInputElement;
    onInput(parseDigitsWithCaretPreservation(el));
  }
</script>

<!--
  Figma 252:12 split-frame: left label-cell (transparent fill, 2 px
  border, left corners rounded), right input-cell (#3d4450 fill, no
  border, right corners rounded). The seam is invisible because the
  right cell's background equals the left cell's border color — DO NOT
  add border-right on the left or border-left on the right; the design
  intentionally lets fill continue the border.
-->
<div class="box">
  <span class="label-cell"><span class="label">{label}</span></span>
  <span class="input-cell">
    {#if editable}
      <input
        class="desired-input"
        type="text" inputmode="numeric" pattern="\d*"
        value={displayValue}
        placeholder={placeholder}
        onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
        oninput={handleInput}
        onchange={onCommit}
      />
    {:else}
      <span class="amount-static">{displayValue}</span>
    {/if}
    <!-- Suffix is ALWAYS rendered — same pattern as AmountRow. Lives
         outside the {#if} so editable and read-only modes share the
         same `number + suffix` layout (figma Frame_1000003045 green
         #2ee4a2 for both digits and currency glyph). Hidden via
         `visibility: hidden` when currencySymbol is empty (pre-init
         window — keeps width stable across the BC init arrival). -->
    <span class="suffix" class:invisible={!currencySymbol}>{currencySymbol || '₽'}</span>
  </span>
</div>

<style>
  /* Outer wrapper: 32 px tall, 8 px above (matches all popup section
   * gaps per App.svelte's layout comment). Static 193 + 145 split per
   * design.xml frame 252:12 — label-cell is FIXED at 193 px so the
   * label "Итого на балансе будет" never wraps/squishes; input-cell
   * fills the remainder (≈145 px on a standard 338 px-content popup). */
  .box {
    display: flex; align-items: stretch;
    height: 32px; margin-top: 8px;
  }
  .label-cell {
    flex: 0 0 193px;
    display: flex; align-items: center;
    padding: 0 12px;
    border: 2px solid var(--booster-surface-2);
    border-right: none;
    /* Corners per design.xml: 4 px (--booster-radius-md). */
    border-top-left-radius: var(--booster-radius-md);
    border-bottom-left-radius: var(--booster-radius-md);
    /* box-sizing: border-box inherited from reset.css — 2 px border
     * absorbed inside the cell width so layout stays predictable. */
  }
  .label {
    white-space: nowrap;
    font: var(--booster-fw-medium) 12px/12px var(--booster-font-stack);
    color: var(--booster-text-primary);
  }
  .input-cell {
    flex: 1 1 auto;
    min-width: 0;
    /* gap: 8 px matches design.xml frame 252:15 `itemSpacing="8"` between
     * the number text and the currency suffix. */
    display: flex; align-items: center; justify-content: flex-end;
    gap: 8px;
    padding: 0 12px;
    background: var(--booster-surface-2);
    /* Corners per design.xml: 4 px. */
    border-top-right-radius: var(--booster-radius-md);
    border-bottom-right-radius: var(--booster-radius-md);
  }
  .desired-input {
    flex: 1; min-width: 0;
    background: transparent; border: none; outline: none;
    text-align: right;
    color: var(--booster-total-green);
    font: var(--booster-fw-bold) 14px/16px var(--booster-font-stack);
  }
  .desired-input::placeholder { color: var(--booster-text-muted); }
  .amount-static {
    /* Read-only fallback: identical typography to the input so the
     * cell doesn't visibly shift when the user's wallet currency is
     * unsupported. */
    text-align: right;
    color: var(--booster-total-green);
    font: var(--booster-fw-bold) 14px/16px var(--booster-font-stack);
  }
  .suffix {
    color: var(--booster-total-green);
    font: var(--booster-fw-bold) 14px/16px var(--booster-font-stack);
  }
  .suffix.invisible { visibility: hidden; }
</style>
