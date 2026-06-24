// booster-plugins/packages/booster-checkout/popup-svelte/lib/desired-debounce.ts
//
// 400 ms debounce for the desired-input → pay-amount derivation.
// Lives in its own module so:
//   1. Tests can flush the pending commit synchronously via the
//      `_flushDesiredCommitForTest` seam.
//   2. bridge.ts's resetTransientUI can cancel a pending commit on
//      popup-hide (otherwise a stale derivedPay write would fire
//      ~400 ms into the next-popup-open and clobber the fresh default
//      ui.amount).
//
// Per user spec: when typing fast in the desired-input, the pay-amount
// should settle 400 ms after the last keystroke, not flicker per char.
// Sets ui.calcLoading=true immediately so the pay-button locks on the
// first keystroke (matches scheduleCalc's behavior for pay-input).

import { ui } from './state.svelte';

let pending: {
  timer: ReturnType<typeof setTimeout>;
  commit: () => void;
} | null = null;

const DEBOUNCE_MS = 400;

export function scheduleDesiredCommit(commit: () => void): void {
  if (pending !== null) clearTimeout(pending.timer);
  ui.calcLoading = true;
  const timer = setTimeout(() => {
    pending = null;
    commit();
  }, DEBOUNCE_MS);
  pending = { timer, commit };
}

export function cancelDesiredCommit(): void {
  if (pending !== null) {
    clearTimeout(pending.timer);
    pending = null;
  }
}

// Test seam: synchronously fire whatever's pending. No-op if nothing
// scheduled. Production code must not call this.
export function _flushDesiredCommitForTest(): void {
  if (pending === null) return;
  clearTimeout(pending.timer);
  const { commit } = pending;
  pending = null;
  commit();
}
