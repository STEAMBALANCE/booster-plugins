import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Window } from 'happy-dom';
import { readBlockSubid, matchItemsToBlocks } from '../src/lib/edition-match';
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

const item = (over: Partial<KeyItem>): KeyItem => ({ itemId: 1, name: 'X', isActive: true, regionLabel: 'Global', packageId: null, productType: 'base', price: 1, oldPrice: null, discountPercent: 0, ...over });

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
test('matchItemsToBlocks pairs by packageId', () => {
  const a = w.document.createElement('div'); a.innerHTML = '<input name="subid" value="13533">';
  const b = w.document.createElement('div'); b.innerHTML = '<input name="subid" value="13535">';
  const items = [item({ itemId: 10, packageId: 13535 }), item({ itemId: 11, packageId: 13533 }), item({ itemId: 12, packageId: 999 })];
  const pairs = matchItemsToBlocks(items, [a as any, b as any]);
  expect(pairs.map((p) => p.item.itemId)).toEqual([11, 10]);
});
