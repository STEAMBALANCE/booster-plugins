import { parseAmount } from './amount';

// Read the final price (whole wallet-currency units, rounded) from a purchase
// scope — either the whole `#game_area_purchase` area or a single
// `.game_area_purchase_game` block. Prefers the canonical integer
// `data-price-final` attribute (wallet minor units, ×100 — e.g. "760000" =
// 7600.00₸), which needs no locale parsing; falls back to parsing the displayed
// price text. Returns null when no usable price is found (free/demo block,
// unparseable text). Shared by the topup-bar prefill (#game_area_purchase) and
// the «СКОРО» block filter (per-block) so the price selectors live in one place.
export function readBlockPrice(scope: Element): number | null {
  const raw = scope.querySelector('[data-price-final]')?.getAttribute('data-price-final');
  if (raw != null) {
    const minor = parseInt(raw, 10);
    if (Number.isFinite(minor) && minor > 0) return Math.round(minor / 100);
  }
  const priceEl = scope.querySelector('.discount_final_price, .game_purchase_price.price, .game_purchase_price');
  const v = priceEl ? parseAmount(priceEl.textContent ?? '') : null;
  return v != null && v > 0 ? Math.round(v) : null;
}

// Read the FIRST edition's price from the Steam purchase area
// (#game_area_purchase) on a game page. Returns whole wallet-currency units, or
// null when no usable price is found — the caller then leaves the bar empty with
// its placeholder.
export function readFirstEditionPrice(doc: Document): number | null {
  const gap = doc.querySelector('#game_area_purchase');
  return gap ? readBlockPrice(gap) : null;
}

export interface EditionPriceInfo { amount: number; currencySymbol: string; }

// Like readFirstEditionPrice but also returns the currency symbol scraped from
// the displayed price text (store currency, which may differ from the wallet
// currency). Strips digits, separators, %, and minus wherever they appear, so
// it handles suffix ("7 600₸"), prefix ("CHF 19.00") and multi-char ("R$")
// glyphs. Prefers the final price element so a discount wrapper's concatenated
// text ("-33% 1 000₸ 670₸") never pollutes the symbol.
export function readFirstEditionPriceInfo(doc: Document): EditionPriceInfo | null {
  const amount = readFirstEditionPrice(doc);
  if (amount == null) return null;
  const gap = doc.querySelector('#game_area_purchase');
  const priceEl =
    gap?.querySelector('.discount_final_price') ??
    gap?.querySelector('.game_purchase_price.price, .game_purchase_price');
  const text = priceEl?.textContent ?? '';
  const currencySymbol = text.replace(/[\d\s.,%\u00a0\u202f\u2009-]/g, '').trim();
  return { amount, currencySymbol };
}
