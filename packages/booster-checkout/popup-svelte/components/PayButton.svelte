<!-- booster-plugins/packages/booster-checkout/popup-svelte/components/PayButton.svelte -->
<script lang="ts">
  interface Props {
    label: string;             // "Оплатить 1100.08 ₽" / "Расчёт..." / etc
    disabled: boolean;
    onClick?: () => void;
  }
  let { label, disabled, onClick }: Props = $props();

  function handleClick(e: MouseEvent): void {
    e.stopPropagation();
    if (disabled) return;
    onClick?.();
  }
</script>

<button class="pay" type="button" {disabled} onclick={handleClick}>
  {label}
</button>

<style>
  /* Figma 230:142: padding 8/12 with font 14/16 → outer height
   * 16 + 8 + 8 = 32 (UA `<button>` defaults overridden by explicit
   * padding above — without this the button reverts to UA paddings
   * and the 32 px height breaks).
   *
   * margin-top: 8 matches the popup-wide 8 px inter-section gap. The
   * margin is on PayButton (not on TotalBox-bottom) because TotalBox
   * is conditional — pinning it here keeps the gap stable in both
   * has-balance and no-balance states. */
  .pay {
    display: block; width: 100%;
    padding: 8px 12px;
    border: none; border-radius: var(--booster-radius-sm);
    background: var(--booster-brand-green); color: var(--booster-text-primary);
    font: 700 14px/16px var(--booster-font-stack);
    cursor: pointer;
    transition: background-color .12s ease;
    margin-top: 8px;
  }
  .pay:hover:not(:disabled)    { background: var(--booster-brand-green-hover); }
  /* No :active state — Steam's native toolbar buttons don't have a
   * pressed/depressed affordance, so the popup's pay button drops it
   * too. Matches the same change on the toolbar "Пополнить" button
   * (booster-framework/src/api/ui-toolbar-styles.ts). */
  .pay:disabled {
    background: rgba(103, 112, 123, .3);
    color: var(--booster-text-muted);
    cursor: default;
  }
</style>
