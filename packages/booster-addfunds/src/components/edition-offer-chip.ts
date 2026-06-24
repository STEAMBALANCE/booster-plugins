// Edition offer chip — embedded in the first edition's purchase row on a normal
// /app/ page. Plain DOM (store target has no Svelte), scoped via #booster-edition-offer.
// Visual = distribution.xml frame 319:908 (our offer; the green 319:927 left
// block there is the native Steam block, reference only). The buy button is a no-op stub.
import type { EditionOffer } from '../lib/edition-offer';
import { fmtMoney } from '../lib/currency';
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

/**
 * Presentation options for the edition offer chip. All blocks default to
 * visible (= current behavior); each can be hidden independently.
 *
 * `comingSoon` is the INTERIM preset (no keys API yet): callers pass
 * `{ showDiscount: false, showPrice: false, comingSoon: true }` so only the
 * «Купить» button remains, dimmed, with a «СКОРО» badge straddling its top
 * edge (see edition-offer-chip.css `.booster-eo--soon`). Drop the flag (and
 * the coming-soon module in lib/) to return to the full chip when the API lands.
 */
export interface EditionOfferChipOptions {
  showDiscount?: boolean; // default true (still gated on offer.discountPercent > 0)
  showPrice?: boolean;    // default true
  comingSoon?: boolean;   // default false → adds «СКОРО» badge + dim modifier
}

export function buildEditionOfferChip(
  offer: EditionOffer,
  opts: EditionOfferChipOptions = {},
): HTMLElement {
  const showDiscount = opts.showDiscount ?? true;
  const showPrice = opts.showPrice ?? true;
  const comingSoon = opts.comingSoon ?? false;

  const root = document.createElement('div');
  root.id = 'booster-edition-offer';
  if (comingSoon) root.classList.add('booster-eo--soon');
  root.setAttribute('data-sb', '1');
  root.setAttribute('aria-label', LL.addfunds.edition_offer_aria_label());

  if (showDiscount && offer.discountPercent > 0) {
    const badge = document.createElement('span');
    badge.className = 'booster-eo-discount';
    badge.textContent = `-${offer.discountPercent}%`;
    root.appendChild(badge);
  }

  if (showPrice) {
    const prices = document.createElement('div');
    prices.className = 'booster-eo-prices';
    if (offer.steamPrice > offer.ourPrice) {
      const was = document.createElement('span');
      was.className = 'booster-eo-was';
      was.textContent = fmtMoney(offer.steamPrice, offer.currencySymbol);
      prices.appendChild(was);
    }
    const now = document.createElement('span');
    now.className = 'booster-eo-now';
    now.textContent = fmtMoney(offer.ourPrice, offer.currencySymbol);
    prices.appendChild(now);
    root.appendChild(prices);
  }

  const buy = document.createElement('button');
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
  buy.addEventListener('click', () => { /* no-op stub */ });
  root.appendChild(buy);

  return root;
}
