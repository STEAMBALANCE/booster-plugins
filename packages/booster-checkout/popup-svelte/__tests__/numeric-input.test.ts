// booster-plugins/packages/booster-checkout/popup-svelte/__tests__/numeric-input.test.ts
import { test, expect, beforeAll } from 'bun:test';
import { Window } from 'happy-dom';
import { parseDigitsWithCaretPreservation } from '../lib/numeric-input';

let doc: Document;

beforeAll(() => {
  // Window scoped locally — no teardown obligation because the util
  // receives the input element directly and we never mutate globalThis.
  // bun's test isolation GCs the Window between files.
  const win = new Window();
  doc = win.document as unknown as Document;
});

function makeInput(value: string, caret: number): HTMLInputElement {
  const el = doc.createElement('input') as unknown as HTMLInputElement;
  el.value = value;
  el.setSelectionRange(caret, caret);
  return el;
}

test('clean digits-only input passes through unchanged', () => {
  const el = makeInput('1234', 4);
  const n = parseDigitsWithCaretPreservation(el);
  expect(n).toBe(1234);
  expect(el.value).toBe('1234');
});

test('strips non-digits and preserves caret', () => {
  const el = makeInput('1a2b3', 5);
  const n = parseDigitsWithCaretPreservation(el);
  expect(n).toBe(123);
  expect(el.value).toBe('123');
  // 2 non-digits before caret position 5 → newCaret = 5 - 2 = 3.
  expect(el.selectionStart).toBe(3);
});

test('returns 0 for empty input', () => {
  const el = makeInput('', 0);
  expect(parseDigitsWithCaretPreservation(el)).toBe(0);
});

test('returns 0 for non-positive (NaN after strip)', () => {
  const el = makeInput('abc', 3);
  expect(parseDigitsWithCaretPreservation(el)).toBe(0);
  expect(el.value).toBe('');
});

test('handles paste with whitespace "3 000"', () => {
  const el = makeInput('3 000', 5);
  expect(parseDigitsWithCaretPreservation(el)).toBe(3000);
  expect(el.value).toBe('3000');
});

// --- Bug 1 (2026-05-26) two-phase strip: decimal + comma cases ---

test('two-phase: decimal "1234.56" truncates to 1234', () => {
  const el = makeInput('1234.56', 7);
  expect(parseDigitsWithCaretPreservation(el)).toBe(1234);
  expect(el.value).toBe('1234');
});

test('two-phase: thousands-sep "1 234.56" (ASCII space) → 1234', () => {
  const el = makeInput('1 234.56', 8);
  expect(parseDigitsWithCaretPreservation(el)).toBe(1234);
  expect(el.value).toBe('1234');
});

test('two-phase: NBSP thousands "1 234.56" → 1234', () => {
  // U+00A0 explicit — Phase 1 [.,] doesn't truncate NBSP, Phase 2 \D
  // removes it after dot-truncate strips the .56 tail.
  const el = makeInput('1 234.56', 8);
  expect(parseDigitsWithCaretPreservation(el)).toBe(1234);
  expect(el.value).toBe('1234');
});

test('two-phase: comma-decimal "1234,56" → 1234 (RU/EU convention)', () => {
  // formatMoney never emits comma; user paste path. Phase 1 [.,] cuts
  // at the comma — drops fractional, never promotes it.
  const el = makeInput('1234,56', 7);
  expect(parseDigitsWithCaretPreservation(el)).toBe(1234);
});

test('two-phase: comma-as-thousands "1,234.56" → 1 (paste-only degradation)', () => {
  // Phase 1 [.,] truncates at first comma. Degradation acceptable —
  // safety > precision. formatMoney never emits this format.
  const el = makeInput('1,234.56', 8);
  expect(parseDigitsWithCaretPreservation(el)).toBe(1);
});

test('two-phase: caret math correct for "1 234.56" caret=5', () => {
  // caret 5 between "4" and "." in "1 234.56".
  // Phase 1: truncated = "1 234" (len 5)
  // caretInTruncated = min(5, 5) = 5
  // strippedBeforeCaret = 1 (the space)
  // newCaret = 5 - 1 = 4.
  const el = makeInput('1 234.56', 5);
  parseDigitsWithCaretPreservation(el);
  expect(el.value).toBe('1234');
  expect(el.selectionStart).toBe(4);
});

test('two-phase: caret clamps when source caret beyond truncated part', () => {
  // "1234.56" caret=7 (end). Phase 1 truncated "1234" (len 4).
  // caretInTruncated = min(7, 4) = 4. cleaned == "1234"
  // (no non-digits → strippedBeforeCaret=0 → newCaret=4).
  const el = makeInput('1234.56', 7);
  parseDigitsWithCaretPreservation(el);
  expect(el.value).toBe('1234');
  expect(el.selectionStart).toBe(4);
});
