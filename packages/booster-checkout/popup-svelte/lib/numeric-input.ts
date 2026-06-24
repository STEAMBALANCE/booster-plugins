// booster-plugins/packages/booster-checkout/popup-svelte/lib/numeric-input.ts
//
// Shared digit-only input parser with caret preservation. Used by
// AmountRow (pay-amount input) and TotalBox (desired-balance input).
//
// TWO-PHASE STRIP (Bug 1 fix, 2026-05-26):
//   Phase 1: truncate at first `.` or `,` — drops the fractional tail
//     (formatMoney emits "1234.56" for KZT/USD; without phase 1 the
//     dot was silently stripped and the integer became 123456).
//     Comma is treated as a decimal/separator and truncates — formatMoney
//     never emits comma; paste with comma is a paste-only edge case
//     where degrading to "1" is safer than promoting to a giant number.
//   Phase 2: existing `\D` strip on the integer part — removes any
//     remaining non-digits (ASCII space, NBSP, etc.) and recomputes
//     the caret.
//
// Returns the parsed positive integer, or 0 for empty / non-digit
// inputs. Callers (Svelte components) treat 0 as the "empty input"
// sentinel that propagates into `ui.amount`/`ui.desiredBalance` and
// is then gated by `payDisabled()`.
//
// Caret-clamp behaviour (`caretInTruncated = min(caret, truncated.length)`)
// is exercised by tests in `__tests__/numeric-input.test.ts`:
//   "two-phase: caret math correct for '1 234.56' caret=5"
//   "two-phase: caret clamps when source caret beyond truncated part"
// Don't change either side without updating the other.

export function parseDigitsWithCaretPreservation(
  el: HTMLInputElement,
): number {
  const raw = el.value;
  // Phase 1: drop fractional tail. ANY `.` or `,` triggers truncation
  // at the first occurrence — biasing toward "drop fractional, never
  // promote it into the integer part" (the original bug was the
  // opposite — "1234.56" became 123456).
  const sepIdx = raw.search(/[.,]/);
  const truncated = sepIdx >= 0 ? raw.slice(0, sepIdx) : raw;

  // Phase 2: existing digit-only strip on the integer part.
  const cleaned = truncated.replace(/\D/g, '');
  if (raw !== cleaned) {
    const caret = el.selectionStart ?? raw.length;
    // Caret in truncated coordinates: clamp to truncated length so a
    // caret past the dot (now-gone tail) lands at end-of-integer.
    const caretInTruncated = Math.min(caret, truncated.length);
    const strippedBeforeCaret = truncated
      .slice(0, caretInTruncated)
      .replace(/\d/g, '')
      .length;
    el.value = cleaned;
    const newCaret = Math.max(0, caretInTruncated - strippedBeforeCaret);
    el.setSelectionRange(newCaret, newCaret);
  }
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
