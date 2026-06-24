import { test, expect, beforeEach } from 'bun:test';
import { Window } from 'happy-dom';
import { findCartTotal } from '../src/lib/cart-total';

beforeEach(() => {
  const w = new Window({ url: 'https://store.steampowered.com/cart/' });
  (w as unknown as { SyntaxError: typeof SyntaxError }).SyntaxError = SyntaxError;
  Object.assign(globalThis, { document: w.document });
});

test('finds total from "Общая стоимость" + sibling value (hashed classes)', () => {
  document.body.innerHTML = `<div class="_2bIzQo"><div class="_2DjadW qV80oa">
      <div class="_3ayrhz">Общая стоимость</div>
      <div class="_2WLaY5">19 031,00₸</div>
    </div></div>`;
  expect(findCartTotal(document)).toBe(19031);
});
test('returns null when no total label present (empty cart)', () => {
  document.body.innerHTML = `<div>Ваша корзина пуста</div>`;
  expect(findCartTotal(document)).toBeNull();
});
test('tolerates nested span / trailing colon in label', () => {
  document.body.innerHTML = `<div><div>Общая стоимость:</div><div>1 234,00₽</div></div>`;
  expect(findCartTotal(document)).toBe(1234);
});
