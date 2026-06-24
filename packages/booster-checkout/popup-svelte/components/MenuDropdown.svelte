<!-- booster-plugins/packages/booster-checkout/popup-svelte/components/MenuDropdown.svelte -->
<script lang="ts">
  import {
    ICON_SUPPORT, ICON_BOX, ICON_SETTINGS,
    ICON_TELEGRAM, ICON_DOCUMENT, ICON_FAQ,
  } from '../lib/icons';
  import { LL } from '../../src/i18n';

  interface Props {
    /** Если '' (или absent) — ПОДДЕРЖКА row скрыт. */
    supportUrl: string;
    /** Telegram URL — открывается в системном браузере (target=_blank, как
     *  логотип). '' в pre-init окне (init ещё не пришёл) → ряд неинтерактивен. */
    telegramUrl: string;
    /** Гейтит «НАСТРОЙКИ» row. Default false. UI настроек не отгружается. */
    showSettings?: boolean;
    onSupport: () => void;
    onOrders: () => void;
    onTelegram: () => void;
    onTerms: () => void;
    onPrivacy: () => void;
    onFaq: () => void;
    onSettings: () => void;
  }
  let {
    supportUrl,
    telegramUrl,
    showSettings = false,
    onSupport,
    onOrders,
    onTelegram,
    onTerms,
    onPrivacy,
    onFaq,
    onSettings,
  }: Props = $props();
</script>

<!-- A11y: Esc-key + arrow-key navigation + focus restore: see BACKLOG. -->
<ul class="menu" role="menu">
  <li role="none">
    <button type="button" role="menuitem" class="row" onclick={onOrders}>
      <span class="icon">{@html ICON_BOX}</span>
      <span class="label">{LL.checkout.menu.my_orders()}</span>
    </button>
  </li>
  {#if supportUrl}
    <li role="none">
      <button type="button" role="menuitem" class="row" onclick={onSupport}>
        <span class="icon">{@html ICON_SUPPORT}</span>
        <span class="label">{LL.checkout.menu.support()}</span>
      </button>
    </li>
  {/if}
  <li role="none">
    {#if telegramUrl}
      <!-- Системный браузер: Steam CEF отдаёт внешние target=_blank ссылки в
           браузер ОС (как логотип в Header.svelte). onTelegram только закрывает
           меню — навигацию делает href. -->
      <a class="row" role="menuitem" href={telegramUrl}
         target="_blank" rel="noopener noreferrer" onclick={onTelegram}>
        <span class="icon">{@html ICON_TELEGRAM}</span>
        <span class="label">{LL.checkout.menu.telegram()}</span>
      </a>
    {:else}
      <span class="row" aria-disabled="true">
        <span class="icon">{@html ICON_TELEGRAM}</span>
        <span class="label">{LL.checkout.menu.telegram()}</span>
      </span>
    {/if}
  </li>
  <li role="none">
    <button type="button" role="menuitem" class="row" onclick={onTerms}>
      <span class="icon">{@html ICON_DOCUMENT}</span>
      <span class="label">{LL.checkout.menu.terms()}</span>
    </button>
  </li>
  <li role="none">
    <button type="button" role="menuitem" class="row" onclick={onPrivacy}>
      <span class="icon">{@html ICON_DOCUMENT}</span>
      <span class="label">{LL.checkout.menu.privacy()}</span>
    </button>
  </li>
  <li role="none">
    <button type="button" role="menuitem" class="row" onclick={onFaq}>
      <span class="icon">{@html ICON_FAQ}</span>
      <span class="label">{LL.checkout.menu.faq()}</span>
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
    width: 140px;
    border-radius: var(--booster-radius-md);
    overflow: hidden;
  }
  /* Figma menu-popup 245:418: idle item content (icon + label) dims to
   * 50% opacity — applied to the CHILDREN of .row, not .row itself, so
   * the background fill stays at full strength. Hover lifts content to
   * 100% AND brightens the background. */
  .row {
    display: flex; align-items: center; gap: 11px;
    width: 100%; height: 32px; padding: 0 12px;
    background: var(--booster-surface-2);
    border: none; cursor: pointer;
    color: var(--booster-text-primary);
    text-decoration: none;
    font: 700 10px/12px var(--booster-font-stack);
    box-shadow: inset 0 -1px 0 var(--booster-divider);
    transition: background-color .12s ease;
    outline: none;
  }
  .row:focus,
  .row:focus-visible { outline: none; }
  .row:last-child { box-shadow: none; }
  .row:hover { background: var(--booster-surface-hover); }
  .row[aria-disabled="true"] { cursor: default; }
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
