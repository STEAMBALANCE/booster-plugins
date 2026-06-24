<!-- booster-plugins/packages/booster-checkout/popup-svelte/components/PaymentMethodsError.svelte -->
<script lang="ts">
  import { LL } from '../../src/i18n';

  interface Props {
    onRefresh: () => void;
  }
  let { onRefresh }: Props = $props();
</script>

<!-- No icon. None of the existing icons (SAFETY, BOX, GEAR, SUPPORT,
     CHEVRON_DOWN) read as "error" — SAFETY belongs to Footer, the
     rest are semantically wrong here. Title + subtitle are unambiguous
     in Russian; if a dedicated error/cloud-off icon is wanted later,
     add the asset under packages/booster-checkout/assets/icons/ and wire it through
     build-popup.ts. -->
<div class="error">
  <h2 class="title">{LL.checkout.error_screen.title()}</h2>
  <p class="subtitle">{LL.checkout.error_screen.subtitle()}</p>
  <button type="button" class="btn-refresh" onclick={onRefresh}>
    {LL.checkout.error_screen.retry()}
  </button>
</div>

<style>
  /* Full-popup error screen — fills the body slot between Header and
   * Footer (~160 px tall when the popup is 248 px and the chrome
   * occupies ~88 px). `flex: 1` claims the leftover, then inner
   * `justify-content: center` parks the column vertically. */
  .error {
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 12px;
    padding: 16px 24px;
    flex: 1;
  }
  .title {
    font: var(--booster-fw-bold) 14px/18px var(--booster-font-stack);
    color: var(--booster-text-primary);
    text-align: center;
    margin: 0;
  }
  .subtitle {
    font: var(--booster-fw-medium) 12px/16px var(--booster-font-stack);
    color: var(--booster-text-secondary);
    text-align: center;
    margin: 0;
  }
  /* Mirror PayButton's brand-green palette so the recovery affordance
   * reads as the popup's primary action while in error mode. Slimmer
   * (padding 8/24) than the full-width Pay button — it's a recovery
   * button, not the primary CTA. No :active state — matches PayButton
   * + toolbar brand-button which also dropped :active to stay
   * indistinguishable from Steam-native button affordance. */
  .btn-refresh {
    margin-top: 4px;
    background: var(--booster-brand-green);
    color: var(--booster-text-primary);
    border: none;
    border-radius: var(--booster-radius-sm);
    padding: 8px 24px;
    font: var(--booster-fw-bold) 13px/16px var(--booster-font-stack);
    cursor: pointer;
    transition: background-color .12s ease;
    outline: none;
  }
  .btn-refresh:hover  { background: var(--booster-brand-green-hover); }
  .btn-refresh:focus,
  .btn-refresh:focus-visible { outline: none; }
</style>
