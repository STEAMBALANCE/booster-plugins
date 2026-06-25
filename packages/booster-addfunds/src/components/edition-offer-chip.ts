// Edition offer chip — embedded in an edition's purchase row on a normal /app/
// page. Plain DOM (store target has no Svelte), styles injected once via
// <style id="booster-edition-offer-style"> and scoped on the .booster-eo class.
// Visual = distribution.xml frame 319:908. Now keys-driven: an active KeyItem
// renders price/discount + a live «Купить» button; an inactive item shows a
// "Скоро в продаже" label with no button; the standalone comingSoon empty-state
// keeps the dimmed «Купить» + «СКОРО» badge.
import type { KeyItem } from '../lib/keys-api';
import { fmtMoneyKeys } from '../lib/currency';
import { SB_SWIRL_SVG } from '../lib/icons';
import { LL } from '../i18n';
import SB_EDITION_OFFER_CSS_RAW from './edition-offer-chip.css' with { type: 'text' };

declare const __SB_EDITION_OFFER_CSS__: string | undefined;
const SB_EDITION_OFFER_CSS =
  typeof __SB_EDITION_OFFER_CSS__ !== 'undefined' ? __SB_EDITION_OFFER_CSS__ : SB_EDITION_OFFER_CSS_RAW;

export function ensureEditionOfferStyles(): void {
  if (document.getElementById('booster-edition-offer-style')) return;
  const s = document.createElement('style');
  s.id = 'booster-edition-offer-style';
  s.textContent = SB_EDITION_OFFER_CSS;
  document.head.appendChild(s);
}

export interface EditionChipOptions {
  /** Real offer; omit for the comingSoon empty-state. */
  item?: KeyItem;
  /** Empty-state «СКОРО» badge variant (dimmed no-op button). */
  comingSoon?: boolean;
  /** Wired for real active items only. */
  onBuy?: () => void;
}

export interface EditionChip {
  root: HTMLElement;
  setBusy(b: boolean): void;
}

export function buildEditionOfferChip(opts: EditionChipOptions): EditionChip {
  const item = opts.item;
  const comingSoon = opts.comingSoon ?? false;
  const inactive = item != null && item.isActive === false;

  const root = document.createElement('div');
  root.className = 'booster-eo';
  root.setAttribute('data-sb', '1');
  root.setAttribute('aria-label', LL.addfunds.edition_offer_aria_label());
  if (comingSoon) root.classList.add('booster-eo--soon');
  if (inactive) root.classList.add('booster-eo--inactive');

  let buy: HTMLButtonElement | null = null;

  if (inactive) {
    // Inactive item: "Скоро в продаже" label, no buy button, no price.
    const label = document.createElement('span');
    label.className = 'booster-eo-inactive-label';
    label.textContent = LL.addfunds.keys_item_coming_soon();
    root.appendChild(label);
  } else {
    // Active item OR the standalone comingSoon empty-state.
    if (item) {
      if (item.discountPercent > 0) {
        const badge = document.createElement('span');
        badge.className = 'booster-eo-discount';
        badge.textContent = `-${item.discountPercent}%`;
        root.appendChild(badge);
      }
      const prices = document.createElement('div');
      prices.className = 'booster-eo-prices';
      if (item.oldPrice != null && item.oldPrice > item.price) {
        const was = document.createElement('span');
        was.className = 'booster-eo-was';
        was.textContent = fmtMoneyKeys(item.oldPrice);
        prices.appendChild(was);
      }
      const now = document.createElement('span');
      now.className = 'booster-eo-now';
      now.textContent = fmtMoneyKeys(item.price);
      prices.appendChild(now);
      root.appendChild(prices);
    }

    buy = document.createElement('button');
    buy.type = 'button';
    buy.className = 'booster-eo-buy';
    buy.textContent = LL.addfunds.keys_buy_button();
    const icon = document.createElement('span');
    icon.className = 'booster-eo-buy-icon';
    icon.innerHTML = SB_SWIRL_SVG;
    buy.appendChild(icon);
    if (comingSoon) {
      // «СКОРО» badge lives inside the button so it positions relative to it
      // (centered on the top edge, protruding 50% up — CSS owns the geometry).
      const soon = document.createElement('span');
      soon.className = 'booster-eo-soon';
      soon.textContent = LL.addfunds.edition_offer_soon_badge();
      buy.appendChild(soon);
    }
    if (opts.onBuy) {
      const onBuy = opts.onBuy;
      buy.addEventListener('click', () => onBuy());
    }
    root.appendChild(buy);
  }

  return {
    root,
    setBusy(b: boolean): void {
      if (!buy) return;
      buy.disabled = b;
      buy.classList.toggle('booster-eo-buy--busy', b);
    },
  };
}
