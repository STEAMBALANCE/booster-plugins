import { test, expect, beforeEach } from 'bun:test';
import { Window } from 'happy-dom';
import { buildKeysBlock } from '../src/components/keys-block';
import type { KeyItem } from '../src/lib/keys-api';

beforeEach(() => {
  const w = new Window({ url: 'https://store.steampowered.com/app/1/' });
  (w as unknown as { SyntaxError: typeof SyntaxError }).SyntaxError = SyntaxError;
  Object.assign(globalThis, {
    document: w.document, HTMLElement: w.HTMLElement,
    HTMLButtonElement: w.HTMLButtonElement, Event: w.Event,
  });
});

const base: KeyItem = { itemId: 7, name: 'Game X', isActive: true, regionLabel: 'Global', packageId: 13533, productType: 'base', price: 129.58, oldPrice: 199, discountPercent: 35 };

test('title + one row per item: name, region chip, price, discount, struck old price, buy', () => {
  const el = buildKeysBlock([base], { onBuy: () => {} });
  expect(el.id).toBe('booster-keys-block');
  expect(el.querySelector('.booster-keys-title')!.textContent).toBe('У нас имеются ключи для игры в вашем регионе!');
  const rows = el.querySelectorAll('.booster-keys-row');
  expect(rows.length).toBe(1);
  expect(rows[0]!.querySelector('.booster-keys-name')!.textContent).toBe('Купить Game X');
  expect(rows[0]!.querySelector('.booster-keys-region')!.textContent).toBe('Global');
  expect(rows[0]!.querySelector('.booster-keys-price')!.textContent).toBe('129,58 ₽');
  expect(rows[0]!.querySelector('.booster-keys-discount')!.textContent).toBe('-35%');
  expect(rows[0]!.querySelector('.booster-keys-orig')!.textContent).toBe('199 ₽');
  expect(rows[0]!.querySelector('.booster-keys-buy')!.textContent).toContain('Купить');
});

test('buy fires onBuy with the item and a row handle (setBusy)', () => {
  let got: { item: KeyItem; row: { setBusy(b: boolean): void } } | null = null;
  const el = buildKeysBlock([base], { onBuy: (item, row) => { got = { item, row }; } });
  (el.querySelector('.booster-keys-buy') as HTMLButtonElement).click();
  expect(got!.item.itemId).toBe(7);
  expect(typeof got!.row.setBusy).toBe('function');
});

test('inactive item → "Скоро в продаже", no buy button', () => {
  const el = buildKeysBlock([{ ...base, isActive: false }], { onBuy: () => {} });
  const row = el.querySelector('.booster-keys-row')!;
  expect(row.classList.contains('booster-keys-row--inactive')).toBe(true);
  expect(row.querySelector('.booster-keys-buy')).toBeNull();
  expect(row.textContent).toContain('Скоро в продаже');
});

test('no discount → no badge, no struck price', () => {
  const el = buildKeysBlock([{ ...base, discountPercent: 0, oldPrice: null }], { onBuy: () => {} });
  expect(el.querySelector('.booster-keys-discount')).toBeNull();
  expect(el.querySelector('.booster-keys-orig')).toBeNull();
});

test('multiple items → multiple rows; row handle affects only that row', () => {
  const items: KeyItem[] = [base, { ...base, itemId: 8, name: 'Y' }];
  const handles: Array<{ setBusy(b: boolean): void }> = [];
  const el = buildKeysBlock(items, { onBuy: (_i, row) => handles.push(row) });
  const buys = el.querySelectorAll('.booster-keys-buy');
  expect(buys.length).toBe(2);
  (buys[0] as HTMLButtonElement).click();
  (buys[1] as HTMLButtonElement).click();
  handles[0]!.setBusy(true);
  expect((buys[0] as HTMLButtonElement).disabled).toBe(true);
  expect((buys[1] as HTMLButtonElement).disabled).toBe(false);
});
