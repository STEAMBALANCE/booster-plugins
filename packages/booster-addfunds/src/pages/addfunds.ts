// booster-plugins/packages/booster-addfunds/src/pages/addfunds.ts
//
// Store-context page handler for Steam's wallet top-up page
// (`store.steampowered.com/steamaccount/addfunds/`). Hides Steam's
// fixed-tier grid (.game_area_purchase) and best-effort the agreement
// footer beneath it, then inserts our shared branded TopupBar in their
// place. Submitting publishes `booster-addfunds.topup-requested` on the
// cross-target bus — booster-checkout's main-shell popup subscribes and
// pre-fills the typed amount.
//
// Cross-target user data: `sb.steam` (BC-based) doesn't cross to
// store.steampowered.com (different origin). Currency/balance arrive
// over the bus as `booster-checkout.user.snapshot` payloads, surfaced through
// the shared user-snapshot service. Mount renders the bar IMMEDIATELY
// with empty placeholder/symbol; the snapshot subscription patches them
// when a snapshot lands.
//
// Plain DOM by design: the store BrowserView is a separate target with
// no Svelte runtime; bundling Svelte here would balloon the plugin for
// a one-row UI. The bar's CSS is scoped via `#booster-topup-bar` so it
// can't leak onto Steam's own layout.

import type { SbApi, PageContext } from '@steambalance/booster-framework/api-types';
import { currencySym, defaultAmountForCurrency } from '../lib/currency';
import { ensureSnapshotService, type UserSnapshot } from '../lib/user-snapshot';
import { buildTopupBar, ensureTopupStyles } from '../components/topup-bar';
import { waitForElement } from '../lib/wait-for-element';
import { LL } from '../i18n';

// Build-time-inlined PNG logo (data:image/png;base64,…). Bypasses
// store.steampowered.com's img-src CSP that would block our CDN URL.
// See packages/booster-checkout/build.ts for the inlining rationale.
//
// Resolved via typeof guard so the bun `define` substitution can be
// absent (e.g. when this module is imported by a `bun test` run that
// loads source directly, skipping the bundle). The empty-string
// fallback keeps tests deterministic — they don't assert on the logo
// pixels, only on placeholder/symbol/submit behaviour.
declare const __SB_ADDFUNDS_LOGO_DATA_URI__: string;
const ADDFUNDS_LOGO_DATA_URI: string =
  typeof __SB_ADDFUNDS_LOGO_DATA_URI__ !== 'undefined'
    ? __SB_ADDFUNDS_LOGO_DATA_URI__
    : '';

export function registerAddFundsPage(sb: SbApi): void {
  const snap = ensureSnapshotService(sb);

  sb.pages.register({
    name: 'booster-addfunds',
    // Matches '/steamaccount/addfunds', '/steamaccount/addfunds/',
    // '/steamaccount/addfunds?from=…', '/steamaccount/addfunds#hash'.
    // Rejects '/app/123', '/steamaccount/' (no addfunds), etc.
    match: { url: /\/steamaccount\/addfunds\/?($|\?|#)/ },
    mount: async (ctx: PageContext) => {
      // 1. Wait for DOM ready — addfunds is a legacy server-rendered
      //    page; if we land before parser is past <head> the grid
      //    selector misses.
      if (document.readyState === 'loading') {
        await new Promise<void>((resolve) => {
          document.addEventListener('DOMContentLoaded', () => resolve(),
            { once: true, signal: ctx.signal });
        });
      }
      if (ctx.signal.aborted) return;

      // 2. Find the grid container, waiting up to 5s via MutationObserver
      //    in case server-rendering injects it late.
      const grid = await waitForElement<HTMLElement>('.game_area_purchase', ctx.signal);
      if (!grid) {
        console.warn('[booster-addfunds] .game_area_purchase not found');
        return;
      }

      // 3. Build the bar IMMEDIATELY with empty placeholder/symbol. The
      //    snapshot subscription below patches them when a snapshot lands
      //    (often already cached — see snap.subscribe note).
      const bar = buildTopupBar({
        heading: LL.addfunds.row_label(),
        // Distinct container accessible name, preserving the original row's
        // aria-label (the input itself reads the heading).
        ariaLabel: LL.addfunds.row_aria_label(),
        placeholder: '',
        currencySymbol: '',
        // Build-inlined data URI; a CDN URL would CSP-block on
        // store.steampowered.com (see the ADDFUNDS_LOGO_DATA_URI
        // declaration above for full rationale).
        logoUrl: ADDFUNDS_LOGO_DATA_URI,
        onSubmit: (amount) => { sb.bus.publish('booster-addfunds.topup-requested', { amount }); },
      });

      const apply = (s: UserSnapshot): void => {
        const def = defaultAmountForCurrency(s.currency);
        bar.setCurrency(currencySym(s.currency), def > 0 ? String(def) : '');
      };
      // subscribe fires `apply` immediately when a cache already exists,
      // so no explicit initial apply is needed here.
      const unsub = snap.subscribe(apply);

      // 4. Inject styles + hide grid + (best-effort) footer.
      ensureTopupStyles();
      grid.style.display = 'none';
      const footer = findFooter(grid);
      if (footer) footer.style.display = 'none';

      // 5. Insert bar immediately before the (now hidden) grid so it
      //    occupies the same column flow.
      grid.parentElement?.insertBefore(bar.root, grid);

      // 6. Cleanup on page leave / framework rollback.
      return () => {
        unsub();
        try { bar.root.remove(); } catch { /* element already detached */ }
        grid.style.display = '';
        if (footer) footer.style.display = '';
        // Remove the injected <style> so an unmount → re-mount cycle goes
        // through a fresh ensureTopupStyles() block.
        document.getElementById('booster-topup-style')?.remove();
      };
    },
  });
}

// Best-effort locate Steam's agreement footer beneath the grid so it
// can be hidden too. Strictly positional: walk forward from the grid's
// next-sibling, skipping inert (script/link/style) elements; the first
// <p> encountered is the agreement footer. Returns null on no match —
// the page still works without it, just shows a stray line.
//
// Why positional rather than a `/соглашен/i` text fallback: the prior
// regex over-matched the page-wide `.addfunds_about` description
// paragraph (which appears BEFORE the grid in DOM order and also
// contains the agreement word stem). The positional rule is the
// structural fingerprint of Steam's DOM ("the agreement <p> sits
// directly under the grid"), not the user-visible copy.
function findFooter(grid: HTMLElement): HTMLElement | null {
  let n: Element | null = grid.nextElementSibling;
  while (n) {
    if (n.tagName === 'P') return n as HTMLElement;
    if (n.tagName !== 'SCRIPT' && n.tagName !== 'LINK' && n.tagName !== 'STYLE') break;
    n = n.nextElementSibling;
  }
  return null;
}
