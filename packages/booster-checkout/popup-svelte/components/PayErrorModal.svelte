<!-- booster-plugins/packages/booster-checkout/popup-svelte/components/PayErrorModal.svelte -->
<script lang="ts">
  import { ICON_CLOSE } from '../lib/icons';
  import { LL } from '../../src/i18n';

  interface Props {
    message: string;
    onClose: () => void;
    onFaq: () => void;
    onSupport: () => void;
  }
  let { message, onClose, onFaq, onSupport }: Props = $props();

  // Backend messages may carry \r\n; normalize to \n so `white-space:
  // pre-wrap` renders consistent line breaks across CEF/test runtimes.
  const body = $derived(message.replace(/\r\n/g, '\n'));
</script>

<div class="pe-overlay" role="presentation">
  <div class="pe-scrim"></div>
  <div class="pe-card" role="alertdialog" aria-modal="true">
    <button type="button" class="pe-close" aria-label={LL.checkout.pay_error.close_aria()} onclick={onClose}>
      {@html ICON_CLOSE}
    </button>
    <div class="pe-text">
      <span class="pe-title">{LL.checkout.pay_error.title()}</span>
      <span class="pe-body">{body}</span>
    </div>
    <div class="pe-actions">
      <button type="button" class="pe-btn" onclick={onFaq}>{LL.checkout.pay_error.faq()}</button>
      <button type="button" class="pe-btn" onclick={onSupport}>{LL.checkout.pay_error.support()}</button>
    </div>
  </div>
</div>

<style>
  /* Full-popup overlay (the popup .root is position:relative). z-index 30
   * sits above the menu-overlay (z=10) and the body slot. */
  .pe-overlay {
    position: absolute; inset: 0; z-index: 30;
    display: flex; align-items: center; justify-content: center;
  }
  /* Scrim: #171D25 at ~90% alpha (E5). Clicking it is inert by design —
   * only the X / FAQ / support controls dismiss the modal. */
  .pe-scrim { position: absolute; inset: 0; background: var(--booster-modal-scrim); }
  /* Card per modal-design.xml: #2d333c fill, 5%-white hairline, 4px radius. */
  .pe-card {
    position: relative;
    width: 314px; max-width: calc(100% - 48px);
    max-height: calc(100% - 24px);
    box-sizing: border-box;
    display: flex; flex-direction: column; gap: 8px;
    padding: 16px;
    background: var(--booster-modal-surface);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: var(--booster-radius-md);
  }
  .pe-close {
    position: absolute; top: 14px; right: 14px;
    width: 12px; height: 12px; padding: 0;
    background: none; border: none; cursor: pointer;
    opacity: .7; transition: opacity .12s ease; outline: none;
  }
  .pe-close:hover { opacity: 1; }
  .pe-close:focus, .pe-close:focus-visible { outline: none; }
  .pe-close :global(svg) { width: 12px; height: 12px; display: block; }
  .pe-text {
    display: flex; flex-direction: column;
    padding-right: 16px;            /* keep first line clear of the X */
    overflow-y: auto;
    color: var(--booster-text-primary);
    font: var(--booster-fw-medium) 13px/1.5 var(--booster-font-stack);
    letter-spacing: .02em;
  }
  /* Title reads as a header — bolded vs the 500-weight body. */
  .pe-title { font-weight: var(--booster-fw-bold); }
  .pe-body { white-space: pre-wrap; }
  .pe-actions { display: flex; gap: 8px; }
  .pe-btn {
    flex: 1; height: 32px;
    display: inline-flex; align-items: center; justify-content: center;
    padding: 8px 12px;
    background: var(--booster-brand-green); color: var(--booster-text-primary);
    border: none; border-radius: var(--booster-radius-md);
    font: var(--booster-fw-bold) 10px/16px var(--booster-font-stack);
    cursor: pointer; transition: background-color .12s ease; outline: none;
    white-space: nowrap;
  }
  .pe-btn:hover { background: var(--booster-brand-green-hover); }
  .pe-btn:focus, .pe-btn:focus-visible { outline: none; }
</style>
