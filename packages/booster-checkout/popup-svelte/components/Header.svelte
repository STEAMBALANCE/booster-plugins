<!-- booster-plugins/packages/booster-checkout/popup-svelte/components/Header.svelte -->
<script lang="ts">
  // ВСЕ ассеты импортятся из icons.ts (unified asset entry-point).
  // logo data-uri живёт в icons.ts через build-time `define` substitution.
  import { ICON_GEAR, ICON_CHEVRON_DOWN, IMG_LOGO_DATA_URI } from '../lib/icons';
  import { LL } from '../../src/i18n';
  import { ui } from '../lib/state.svelte';

  interface Props {
    menuOpen: boolean;
    onMenuToggle: () => void;
  }
  let { menuOpen, onMenuToggle }: Props = $props();

  // Keyboard: Enter/Space natively trigger button click; Esc-to-close +
  // focus restore on close are tracked in BACKLOG (a11y wiring).
  function handleClick(e: MouseEvent): void {
    e.stopPropagation();
    onMenuToggle();
  }
</script>

<header class="header">
  {#if ui.urls.popupLogoLink}
    <a class="logo-link" href={ui.urls.popupLogoLink} target="_blank" rel="noopener noreferrer">
      <img class="logo" src={IMG_LOGO_DATA_URI} alt="SteamBalance" />
    </a>
  {:else}
    <!--
      Pre-init state: BC init message hasn't arrived yet (sub-100 ms cold
      path) — logo is non-interactive but visible. After init, popupLogoLink
      becomes a non-empty string and Svelte's reactive swap renders the <a>.
    -->
    <span class="logo-link" aria-disabled="true">
      <img class="logo" src={IMG_LOGO_DATA_URI} alt="SteamBalance" />
    </span>
  {/if}
  <button
    type="button" class="menu-trigger" onclick={handleClick}
    aria-haspopup="menu" aria-expanded={menuOpen}
  >
    <span class="icon-gear">{@html ICON_GEAR}</span>
    <span class="label">{LL.checkout.header.menu_button()}</span>
    <span class="chevron" class:open={menuOpen}>{@html ICON_CHEVRON_DOWN}</span>
  </button>
</header>

<style>
  .header {
    display: flex; align-items: center; justify-content: space-between;
    height: 24px; flex-shrink: 0;
  }
  .logo-link {
    display: inline-flex;
    cursor: pointer;
    outline: none;
    -webkit-tap-highlight-color: transparent;
  }
  .logo-link:focus,
  .logo-link:focus-visible { outline: none; }
  .logo {
    height: 18px; width: auto;
    object-fit: contain;
    transition: filter .15s ease;
  }
  .logo-link:hover .logo {
    filter: brightness(1.15);
  }
  /* Figma 230:53 header pill: 6 px between gear, label, and chevron.
   * The popup's 8 px section-gap rule applies to OUTER sections (header
   * ⟷ AmountRow ⟷ info-rows etc.); this pill uses the tighter 6 px
   * cluster spacing per the design source. */
  .menu-trigger {
    display: flex; align-items: center; gap: 6px;
    height: 24px; padding: 6px 4px;
    background: transparent; border: none; cursor: pointer;
    color: var(--booster-text-secondary);
    font: 700 10px/12px var(--booster-font-stack);
    transition: color .12s ease;
    /* UA focus ring suppressed; popup is a one-shot brand surface where
     * keyboard navigation is not a primary path. If keyboard affordance
     * becomes required, add `:focus-visible { outline: 2px solid
     * var(--booster-brand-green); outline-offset: -2px; }` rather than
     * reinstating the UA white ring. */
    outline: none;
  }
  .menu-trigger:hover { color: var(--booster-text-primary); }
  .menu-trigger:focus,
  .menu-trigger:focus-visible { outline: none; }
  /* Idle: 0.5 opacity — gear reads as secondary chrome aligned with the
   * label's muted color. Hover lifts to 1.0 in sync with the label
   * going white, so the whole trigger pill brightens uniformly. */
  .icon-gear {
    display: inline-flex;
    opacity: 0.5;
    transition: opacity .12s ease;
  }
  .menu-trigger:hover .icon-gear { opacity: 1; }
  .icon-gear :global(svg) { width: 10px; height: 10px; display: block; }
  .label { letter-spacing: 0.02em; }
  .chevron { display: inline-flex; transition: transform .12s ease; }
  .chevron :global(svg) { width: 8px; height: 8px; display: block; }
  .chevron.open { transform: rotate(180deg); }
</style>
