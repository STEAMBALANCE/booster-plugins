import { test, expect, beforeEach } from 'bun:test';
import { Window } from 'happy-dom';
import { buildKeysBlock } from '../src/components/keys-block';
import type { RegionKey } from '../src/lib/keys-api';

beforeEach(() => {
  const w = new Window({ url: 'https://store.steampowered.com/app/1/' });
  (w as unknown as { SyntaxError: typeof SyntaxError }).SyntaxError = SyntaxError;
  Object.assign(globalThis, { document: w.document, HTMLElement: w.HTMLElement });
});

const key: RegionKey = { id: 'k1', gameName: 'Game X', discountPercent: 32, priceRub: 1599, originalPriceRub: 2351, platform: 'windows' };

test('renders title + a row per key with label, discount, prices, buy, windows icon', () => {
  const el = buildKeysBlock([key], { logoUrl: '' });
  expect(el.id).toBe('booster-keys-block');
  expect(el.querySelector('.booster-keys-title')!.textContent).toBe('У нас имеются ключи для игры в вашем регионе!');
  const rows = el.querySelectorAll('.booster-keys-row');
  expect(rows.length).toBe(1);
  expect(rows[0]!.querySelector('.booster-keys-name')!.textContent).toBe('Купить Game X');
  expect(rows[0]!.querySelector('.booster-keys-discount')!.textContent).toBe('-32%');
  expect(rows[0]!.querySelector('.booster-keys-price')!.textContent).toContain('1 599');
  expect(rows[0]!.querySelector('.booster-keys-orig')!.textContent).toContain('2 351');
  expect(rows[0]!.querySelector('.booster-keys-buy')!.textContent).toBe('Купить');
  expect(rows[0]!.querySelector('.booster-keys-buy .booster-keys-buy-icon svg')).not.toBeNull(); // SB logo in the buy button
  expect(rows[0]!.querySelector('.booster-keys-os')).not.toBeNull();
  // The price/discount/buy cluster lives on the black chip; the Windows icon
  // is a direct child of the row (not inside the chip).
  expect(rows[0]!.querySelector('.booster-keys-actions .booster-keys-buy')).not.toBeNull();
  expect(rows[0]!.querySelector('.booster-keys-actions .booster-keys-os')).toBeNull();
});

test('no discount → no badge, no struck price', () => {
  const el = buildKeysBlock([{ ...key, discountPercent: 0, originalPriceRub: undefined }], { logoUrl: '' });
  expect(el.querySelector('.booster-keys-discount')).toBeNull();
  expect(el.querySelector('.booster-keys-orig')).toBeNull();
});
