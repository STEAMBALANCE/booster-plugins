import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Window } from 'happy-dom';
import { readBlockSubid, readBlockBundleId, matchItemsToBlocks, isPurchasableBlock } from '../src/lib/edition-match';
import type { KeyItem } from '../src/lib/keys-api';

let w: Window;
const SNAP_KEYS = ['document', 'HTMLElement'] as const;
let snapGlobals: Record<string, unknown> = {};

beforeEach(() => {
  snapGlobals = {};
  for (const k of SNAP_KEYS) {
    snapGlobals[k] = (globalThis as Record<string, unknown>)[k];
  }
  w = new Window();
  (w as any).SyntaxError = SyntaxError;
  (globalThis as any).document = w.document;
  (globalThis as any).HTMLElement = w.HTMLElement;
});
afterEach(() => {
  for (const k of SNAP_KEYS) {
    (globalThis as Record<string, unknown>)[k] = snapGlobals[k];
  }
});

const item = (over: Partial<KeyItem>): KeyItem => ({ itemId: 1, name: 'X', isActive: true, regionLabel: 'Global', packageId: null, packageType: 'package', productType: 'base', price: 1, oldPrice: null, discountPercent: 0, ...over });

test('readBlockSubid from input', () => {
  const d = w.document.createElement('div'); d.innerHTML = '<input name="subid" value="13533">';
  expect(readBlockSubid(d as any)).toBe(13533);
});
test('readBlockSubid from addToCart fallback', () => {
  const d = w.document.createElement('div'); d.innerHTML = '<a href="javascript:addToCart(15407);">x</a>';
  expect(readBlockSubid(d as any)).toBe(15407);
});
test('readBlockSubid none → null', () => {
  const d = w.document.createElement('div'); d.innerHTML = '<a>bundle/20336</a>';
  expect(readBlockSubid(d as any)).toBeNull();
});
// el helper: build a purchase block with the given class + inner HTML.
const block = (cls: string, html: string): HTMLElement => {
  const d = w.document.createElement('div'); d.className = cls; d.innerHTML = html; return d as any;
};

test('isPurchasableBlock: paid edition (data-price-final > 0) → true', () => {
  expect(isPurchasableBlock(block('game_area_purchase_game', '<div class="game_purchase_price price" data-price-final="20200">202 руб.</div>'))).toBe(true);
});
test('isPurchasableBlock: demo download block (demo_above_purchase) → false', () => {
  expect(isPurchasableBlock(block('game_area_purchase_game demo_above_purchase', '<a class="btn_green_steamui" href="steam://install/3044590">Загрузить</a>'))).toBe(false);
});
test('isPurchasableBlock: demo class wins even if the block carries a price → false', () => {
  // The class early-return must take precedence over any price the demo row
  // might render — otherwise the chip could still land on a priced demo block.
  expect(isPurchasableBlock(block('game_area_purchase_game demo_above_purchase', '<div class="game_purchase_price price" data-price-final="20200">202 руб.</div>'))).toBe(false);
});
test('isPurchasableBlock: free / play block (no price) → false', () => {
  expect(isPurchasableBlock(block('game_area_purchase_game', '<a class="btn_green_steamui">Играть</a>'))).toBe(false);
});
test('isPurchasableBlock: data-price-final="0" (free) → false', () => {
  expect(isPurchasableBlock(block('game_area_purchase_game', '<div class="game_purchase_price price" data-price-final="0">Бесплатно</div>'))).toBe(false);
});
test('isPurchasableBlock: price text only, no data-price-final → true', () => {
  expect(isPurchasableBlock(block('game_area_purchase_game', '<div class="game_purchase_price price">202 руб.</div>'))).toBe(true);
});

test('matchItemsToBlocks pairs by packageId', () => {
  const a = w.document.createElement('div'); a.innerHTML = '<input name="subid" value="13533">';
  const b = w.document.createElement('div'); b.innerHTML = '<input name="subid" value="13535">';
  const items = [item({ itemId: 10, packageId: 13535 }), item({ itemId: 11, packageId: 13533 }), item({ itemId: 12, packageId: 999 })];
  const pairs = matchItemsToBlocks(items, [a as any, b as any]);
  expect(pairs.map((p) => p.item.itemId)).toEqual([11, 10]);
});

// ── bundle rows ──────────────────────────────────────────────────────────────
// Markup mirrors a live /app/ bundle row (verified on /app/2300320): the block
// carries no subid at all — a hidden `bundleid` input inside its
// add_bundle_to_cart form, an `addBundleToCart( <id>)` cart link, and a
// `data-ds-bundleid` attribute on the enclosing wrapper.

// bundleBlock: a `.game_area_purchase_game` inside its `…_wrapper[data-ds-bundleid]`,
// returned already parented so the wrapper-attribute fallback is reachable.
const bundleBlock = (id: number, inner: string): HTMLElement => {
  const wrapper = w.document.createElement('div');
  wrapper.className = 'game_area_purchase_game_wrapper dynamic_bundle_description';
  wrapper.setAttribute('data-ds-bundleid', String(id));
  wrapper.innerHTML = `<div class="game_area_purchase_game_dropdown_subscription game_area_purchase_game">${inner}</div>`;
  return wrapper.firstElementChild as unknown as HTMLElement;
};

test('readBlockSubid ignores a bundle cart link (different id space)', () => {
  const d = w.document.createElement('div');
  d.innerHTML = '<a href="javascript:addBundleToCart( 42206);">В корзину</a>';
  expect(readBlockSubid(d as any)).toBeNull();
});

test('readBlockBundleId from the hidden bundleid input', () => {
  const b = bundleBlock(42206, '<form name="add_bundle_to_cart_42206"><input type="hidden" name="bundleid" value="42206"></form>');
  expect(readBlockBundleId(b)).toBe(42206);
});

test('readBlockBundleId from the addBundleToCart link (space after the paren)', () => {
  const d = w.document.createElement('div');
  d.innerHTML = '<a href="javascript:addBundleToCart( 56040);">В корзину</a>';
  expect(readBlockBundleId(d as any)).toBe(56040);
});

test('readBlockBundleId falls back to the wrapper data-ds-bundleid', () => {
  const b = bundleBlock(73995, '<div class="game_purchase_action"></div>');
  expect(readBlockBundleId(b)).toBe(73995);
});

test('readBlockBundleId: a package block never inherits a wrapper bundle id', () => {
  // Defensive: an edition row nested under a bundle wrapper must stay a package
  // row, or we would sell a bundle from the base game's block.
  const b = bundleBlock(73995, '<input name="subid" value="825695">');
  expect(readBlockBundleId(b)).toBeNull();
  expect(readBlockSubid(b)).toBe(825695);
});

test('readBlockBundleId: plain edition block → null', () => {
  const d = w.document.createElement('div'); d.innerHTML = '<input name="subid" value="13533">';
  expect(readBlockBundleId(d as any)).toBeNull();
});

test('matchItemsToBlocks pairs bundle offers with bundle blocks', () => {
  const pkg = w.document.createElement('div'); pkg.innerHTML = '<input name="subid" value="825695">';
  const b1 = bundleBlock(73995, '<input type="hidden" name="bundleid" value="73995">');
  const b2 = bundleBlock(56040, '<input type="hidden" name="bundleid" value="56040">');
  const b3 = bundleBlock(42206, '<input type="hidden" name="bundleid" value="42206">');
  // Live steam_keys?appid=2300320 answer: two bundles + one package, listed in
  // an order unrelated to the page's block order.
  const items = [
    item({ itemId: 2266, packageId: 42206, packageType: 'bundle' }),
    item({ itemId: 2269, packageId: 56040, packageType: 'bundle' }),
    item({ itemId: 2270, packageId: 825695, packageType: 'package' }),
  ];
  const pairs = matchItemsToBlocks(items, [pkg as any, b1, b2, b3]);
  // 73995 is not on offer → no chip for it.
  expect(pairs.map((p) => p.item.itemId)).toEqual([2270, 2269, 2266]);
  expect(pairs.map((p) => p.block)).toEqual([pkg as any, b2, b3]);
});

test('matchItemsToBlocks never crosses id spaces on a numeric collision', () => {
  const pkg = w.document.createElement('div'); pkg.innerHTML = '<input name="subid" value="42206">';
  const bun = bundleBlock(13533, '<input type="hidden" name="bundleid" value="13533">');
  const items = [
    item({ itemId: 10, packageId: 42206, packageType: 'bundle' }),   // bundle 42206 ≠ sub 42206
    item({ itemId: 11, packageId: 13533, packageType: 'package' }),  // sub 13533 ≠ bundle 13533
  ];
  expect(matchItemsToBlocks(items, [pkg as any, bun])).toEqual([]);
});

test('matchItemsToBlocks: offer with no packageType keeps the legacy subid match', () => {
  const pkg = w.document.createElement('div'); pkg.innerHTML = '<input name="subid" value="13533">';
  const pairs = matchItemsToBlocks([item({ itemId: 10, packageId: 13533, packageType: null })], [pkg as any]);
  expect(pairs.map((p) => p.item.itemId)).toEqual([10]);
});
