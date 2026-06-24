import { test, expect, beforeEach } from 'bun:test';
import { Window } from 'happy-dom';
import { readFirstEditionPrice, readFirstEditionPriceInfo } from '../src/lib/edition-price';

beforeEach(() => {
  const w = new Window({ url: 'https://store.steampowered.com/app/570/' });
  (w as unknown as { SyntaxError: typeof SyntaxError }).SyntaxError = SyntaxError;
  Object.assign(globalThis, { document: w.document });
});

test('prefers data-price-final (minor units ÷100)', () => {
  document.body.innerHTML = `<div id="game_area_purchase">
    <div class="game_purchase_price price" data-price-final="760000">7 600₸</div>
    <div class="game_purchase_price price" data-price-final="1013400">10 134₸</div>
  </div>`;
  expect(readFirstEditionPrice(document)).toBe(7600); // first edition
});

test('falls back to parsing the displayed price text when no data-price-final', () => {
  document.body.innerHTML = `<div id="game_area_purchase">
    <div class="game_purchase_price price">1 234,00₽</div>
  </div>`;
  expect(readFirstEditionPrice(document)).toBe(1234);
});

test('uses discount_final_price when present (text fallback)', () => {
  document.body.innerHTML = `<div id="game_area_purchase">
    <div class="discount_final_price">1 599₽</div>
  </div>`;
  expect(readFirstEditionPrice(document)).toBe(1599);
});

test('no purchase area → null', () => {
  document.body.innerHTML = `<div class="leftcol"></div>`;
  expect(readFirstEditionPrice(document)).toBeNull();
});

test('free game / unparseable → null', () => {
  document.body.innerHTML = `<div id="game_area_purchase"><div class="game_purchase_price price">Бесплатно</div></div>`;
  expect(readFirstEditionPrice(document)).toBeNull();
});

test('zero / negative data-price-final → null', () => {
  document.body.innerHTML = `<div id="game_area_purchase"><div data-price-final="0">0₽</div></div>`;
  expect(readFirstEditionPrice(document)).toBeNull();
});

test('readFirstEditionPriceInfo returns amount + suffix symbol (₸)', () => {
  document.body.innerHTML = `<div id="game_area_purchase">
    <div class="game_purchase_price price" data-price-final="760000">7 600₸</div>
  </div>`;
  expect(readFirstEditionPriceInfo(document)).toEqual({ amount: 7600, currencySymbol: '₸' });
});

test('readFirstEditionPriceInfo prefers discount_final_price and reads ₽', () => {
  document.body.innerHTML = `<div id="game_area_purchase">
    <div class="discount_block" data-price-final="67000">
      <div class="discount_pct">-33%</div>
      <div class="discount_original_price">1 000₽</div>
      <div class="discount_final_price">670₽</div>
    </div>
  </div>`;
  expect(readFirstEditionPriceInfo(document)).toEqual({ amount: 670, currencySymbol: '₽' });
});

test('readFirstEditionPriceInfo → null when no usable price', () => {
  document.body.innerHTML = `<div id="game_area_purchase"><div class="game_purchase_price price">Бесплатно</div></div>`;
  expect(readFirstEditionPriceInfo(document)).toBeNull();
});
