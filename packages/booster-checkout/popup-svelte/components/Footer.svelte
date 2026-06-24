<!-- booster-plugins/packages/booster-checkout/popup-svelte/components/Footer.svelte -->
<script lang="ts">
  import { ICON_SAFETY } from '../lib/icons';
  import { LL } from '../../src/i18n';
</script>

<footer class="footer">
  <span class="icon">{@html ICON_SAFETY}</span>
  <span class="label">{LL.checkout.footer.secure_note()}</span>
</footer>

<style>
  /* margin-top: auto pins the footer to the bottom of the popup's flex
   * column. Math (TotalBox is always shown — no conditional hide): the
   * section stack is
   *   24 + 8 + 32 + 8 + 40 + 8 + 32 + 8 + 32 = 192 px above PayButton's
   * bottom; add 12 for Footer = 204 px content. Inside the 220 px
   * content area that's 16 px slack → auto absorbs 16. Footer never
   * overflows past popup-y=240. If layout ever DOES overflow, `auto`
   * clamps to 0 and the footer is clipped — there is no minimum-gap
   * guarantee; we detect this regression via the 248 px popup height. */
  .footer {
    display: flex; align-items: center; justify-content: center;
    gap: 4px; height: 12px;
    margin-top: auto;
  }
  .icon { display: inline-flex; opacity: 0.5; }
  .icon :global(svg) { width: 10px; height: 10px; }
  /* Figma 245:343: Motiva Sans Medium 10/12 (weight 500). Footer copy
   * is supporting reassurance text, not a heading — Medium weight + 0.5
   * opacity matches Steam's own footer micro-copy on similar popups.
   * (Steam's runtime ships only 400/700; 500 falls back to 400 — see
   * tokens.css typography comment.) */
  .label {
    font: var(--booster-fw-medium) 10px/12px var(--booster-font-stack);
    color: var(--booster-text-primary);
    opacity: 0.5;
  }
</style>
