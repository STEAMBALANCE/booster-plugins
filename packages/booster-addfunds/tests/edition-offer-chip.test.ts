import { test, expect, beforeEach } from 'bun:test';
import { Window } from 'happy-dom';
import { buildEditionOfferChip } from '../src/components/edition-offer-chip';
import type { EditionOffer } from '../src/lib/edition-offer';

beforeEach(() => {
  const w = new Window({ url: 'https://store.steampowered.com/app/570/' });
  (w as unknown as { SyntaxError: typeof SyntaxError }).SyntaxError = SyntaxError;
  Object.assign(globalThis, {
    document: w.document, HTMLElement: w.HTMLElement,
    HTMLButtonElement: w.HTMLButtonElement, Event: w.Event,
  });
});

const offer: EditionOffer = { ourPrice: 5168, steamPrice: 7600, discountPercent: 32, currencySymbol: '₸' };

test('renders badge, struck "was", "now", and a no-op buy button with swirl', () => {
  const el = buildEditionOfferChip(offer);
  expect(el.id).toBe('booster-edition-offer');
  expect(el.getAttribute('aria-label')).toBe('Предложение SteamBalance — купить дешевле');
  expect(el.querySelector('.booster-eo-discount')!.textContent).toBe('-32%');
  expect(el.querySelector('.booster-eo-was')!.textContent).toBe('7 600 ₸');
  expect(el.querySelector('.booster-eo-now')!.textContent).toBe('5 168 ₸');
  const buy = el.querySelector('.booster-eo-buy') as HTMLButtonElement;
  expect(buy.getAttribute('type')).toBe('button');
  expect(buy.textContent).toContain('Купить');
  expect(el.querySelector('.booster-eo-buy .booster-eo-buy-icon svg')).not.toBeNull();
  expect(() => buy.dispatchEvent(new Event('click'))).not.toThrow();
});

test('discountPercent 0 → no badge; steamPrice<=ourPrice → no struck "was"', () => {
  const el = buildEditionOfferChip({ ourPrice: 7600, steamPrice: 7600, discountPercent: 0, currencySymbol: '₸' });
  expect(el.querySelector('.booster-eo-discount')).toBeNull();
  expect(el.querySelector('.booster-eo-was')).toBeNull();
  expect(el.querySelector('.booster-eo-now')!.textContent).toBe('7 600 ₸');
});

test('showDiscount:false hides the discount badge even when discountPercent > 0', () => {
  const el = buildEditionOfferChip(offer, { showDiscount: false });
  expect(el.querySelector('.booster-eo-discount')).toBeNull();
  // prices + buy still present (only discount hidden)
  expect(el.querySelector('.booster-eo-prices')).not.toBeNull();
  expect(el.querySelector('.booster-eo-buy')).not.toBeNull();
});

test('showPrice:false hides the entire prices block but keeps discount + buy', () => {
  const el = buildEditionOfferChip(offer, { showPrice: false });
  expect(el.querySelector('.booster-eo-prices')).toBeNull();
  expect(el.querySelector('.booster-eo-was')).toBeNull();
  expect(el.querySelector('.booster-eo-now')).toBeNull();
  expect(el.querySelector('.booster-eo-discount')).not.toBeNull();
  expect(el.querySelector('.booster-eo-buy')).not.toBeNull();
});

test('comingSoon:true → only the buy button with a «СКОРО» badge inside it, root marked', () => {
  // The interim coming-soon preset: discount + price hidden, badge added.
  const el = buildEditionOfferChip(offer, { showDiscount: false, showPrice: false, comingSoon: true });
  expect(el.classList.contains('booster-eo--soon')).toBe(true);
  expect(el.querySelector('.booster-eo-discount')).toBeNull();
  expect(el.querySelector('.booster-eo-prices')).toBeNull();
  const buy = el.querySelector('.booster-eo-buy') as HTMLButtonElement;
  expect(buy).not.toBeNull();
  expect(buy.textContent).toContain('Купить');
  // «СКОРО» badge lives INSIDE the button (so it positions relative to it).
  const badge = buy.querySelector('.booster-eo-soon');
  expect(badge).not.toBeNull();
  expect(badge!.textContent).toBe('СКОРО');
});

test('comingSoon defaults off → no badge, no soon modifier', () => {
  const el = buildEditionOfferChip(offer);
  expect(el.classList.contains('booster-eo--soon')).toBe(false);
  expect(el.querySelector('.booster-eo-soon')).toBeNull();
});
