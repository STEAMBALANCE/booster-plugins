<!-- booster-plugins/packages/booster-checkout/popup-svelte/components/MenuDropdown.svelte -->
<script lang="ts">
  import { ICON_SUPPORT, ICON_BOX, ICON_SETTINGS } from '../lib/icons';
  import { LL } from '../../src/i18n';

  interface Props {
    /** Если '' (или absent) — ПОДДЕРЖКА row скрыт. */
    supportUrl: string;
    /** Гейтит «НАСТРОЙКИ» row. Default false. UI настроек не
     *  отгружается в этом sprint'е; код сохранён для последующего
     *  включения через showSettings=true. */
    showSettings?: boolean;
    onSupport: () => void;
    onOrders: () => void;
    onSettings: () => void;
  }
  let {
    supportUrl,
    showSettings = false,
    onSupport,
    onOrders,
    onSettings,
  }: Props = $props();
</script>

<!-- A11y: Esc-key + arrow-key navigation + focus restore: see BACKLOG. -->
<ul class="menu" role="menu">
  {#if supportUrl}
    <li role="none">
      <button type="button" role="menuitem" class="row" onclick={onSupport}>
        <span class="icon">{@html ICON_SUPPORT}</span>
        <span class="label">{LL.checkout.menu.support()}</span>
      </button>
    </li>
  {/if}
  <li role="none">
    <button type="button" role="menuitem" class="row" onclick={onOrders}>
      <span class="icon">{@html ICON_BOX}</span>
      <span class="label">{LL.checkout.menu.my_orders()}</span>
    </button>
  </li>
  {#if showSettings}
    <li role="none">
      <button type="button" role="menuitem" class="row" onclick={onSettings}>
        <span class="icon">{@html ICON_SETTINGS}</span>
        <span class="label">{LL.checkout.menu.settings()}</span>
      </button>
    </li>
  {/if}
</ul>

<style>
  .menu {
    list-style: none;
    width: 118px;
    border-radius: var(--booster-radius-md);
    overflow: hidden;
  }
  /* Figma menu-popup 245:418: idle item content (icon + label) dims to
   * 50% opacity — applied to the CHILDREN of .row, not .row itself, so
   * the background fill stays at full strength and the row remains
   * visually solid. Hover lifts the content to 100% AND brightens the
   * background — the brighter content vs the brighter bg is what reads
   * as "this row is being targeted". */
  .row {
    display: flex; align-items: center; gap: 11px;
    width: 100%; height: 32px; padding: 0 12px;
    background: var(--booster-surface-2);
    border: none; cursor: pointer;
    color: var(--booster-text-primary);
    font: 700 10px/12px var(--booster-font-stack);
    box-shadow: inset 0 -1px 0 var(--booster-divider);
    transition: background-color .12s ease;
    /* UA focus ring suppressed; popup is a one-shot brand surface where
     * keyboard navigation is not a primary path (consistent with the
     * other interactive elements in the popup). If keyboard affordance
     * becomes required, add `:focus-visible { outline: 2px solid
     * var(--booster-brand-green); outline-offset: -2px; }` here rather than
     * reinstating the UA white ring. */
    outline: none;
  }
  .row:focus,
  .row:focus-visible { outline: none; }
  .row:last-child { box-shadow: none; }
  .row:hover { background: var(--booster-surface-hover); }
  .icon, .label {
    opacity: 0.5;
    transition: opacity .12s ease;
  }
  .row:hover .icon,
  .row:hover .label { opacity: 1; }
  .icon { display: inline-flex; width: 12px; height: 12px; align-items: center; }
  .icon :global(svg) { width: 12px; height: 12px; display: block; }
  .label { white-space: nowrap; }
</style>
