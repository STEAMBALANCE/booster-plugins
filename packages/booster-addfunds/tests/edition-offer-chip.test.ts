import { test, expect, beforeEach } from 'bun:test';
import { Window } from 'happy-dom';
import { buildEditionOfferChip } from '../src/components/edition-offer-chip';
import type { KeyItem } from '../src/lib/keys-api';

beforeEach(() => {
  const w = new Window({ url: 'https://store.steampowered.com/app/570/' });
  (w as unknown as { SyntaxError: typeof SyntaxError }).SyntaxError = SyntaxError;
  Object.assign(globalThis, {
    document: w.document, HTMLElement: w.HTMLElement,
    HTMLButtonElement: w.HTMLButtonElement, Event: w.Event,
  });
});

const base: KeyItem = { itemId: 1, name: 'X', isActive: true, regionLabel: 'Global', packageId: 13533, productType: 'base', price: 129.58, oldPrice: null, discountPercent: 0 };

test('active item: price + buy fires onBuy', () => {
  let clicked = 0;
  const { root } = buildEditionOfferChip({ item: base, onBuy: () => clicked++ });
  expect(root.querySelector('.booster-eo-now')!.textContent).toBe('129,58 ₽');
  (root.querySelector('.booster-eo-buy') as HTMLButtonElement).click();
  expect(clicked).toBe(1);
});

test('discount + old price', () => {
  const { root } = buildEditionOfferChip({ item: { ...base, price: 73.71, oldPrice: 99, discountPercent: 26 } });
  expect(root.querySelector('.booster-eo-was')!.textContent).toBe('99 ₽');
  expect(root.querySelector('.booster-eo-discount')!.textContent).toBe('-26%');
});

test('inactive: Скоро в продаже, no button', () => {
  const { root } = buildEditionOfferChip({ item: { ...base, isActive: false } });
  expect(root.classList.contains('booster-eo--inactive')).toBe(true);
  expect(root.querySelector('.booster-eo-buy')).toBeNull();
});

test('comingSoon badge, no price', () => {
  const { root } = buildEditionOfferChip({ comingSoon: true });
  expect(root.querySelector('.booster-eo-soon')!.textContent).toBe('СКОРО');
  expect(root.querySelector('.booster-eo-now')).toBeNull();
});

test('root uses class booster-eo (not the old singleton id), keeps data-sb', () => {
  const { root } = buildEditionOfferChip({ item: base });
  expect(root.classList.contains('booster-eo')).toBe(true);
  expect(root.id).toBe('');
  expect(root.getAttribute('data-sb')).toBe('1');
});

test('setBusy disables the buy button', () => {
  const { root, setBusy } = buildEditionOfferChip({ item: base, onBuy: () => {} });
  const buy = root.querySelector('.booster-eo-buy') as HTMLButtonElement;
  setBusy(true);
  expect(buy.disabled).toBe(true);
  setBusy(false);
  expect(buy.disabled).toBe(false);
});
