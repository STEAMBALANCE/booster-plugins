// booster-plugins/packages/booster-addfunds/src/pages/app.ts
//
// Store-context page handler for Steam product pages
// (`store.steampowered.com/app/<id>`). Two branches, decided on mount:
//
//   - Region-locked page (detectRegionLock true) — Steam renders its generic
//     "unavailable in your region" error template (#error_box, no product DOM).
//     We request keys for the app id over the bus and, if any exist, insert our
//     branded keys block immediately after #error_box. No keys → leave the page
//     untouched.
//
//   - Normal app page — request keys for the app id; each KeyItem that matches a
//     native edition block (by subid) gets an edition-offer chip in that block's
//     purchase row, and the topup bar is hidden (mutual exclusion). No match
//     (empty result or unknown subids) → branded TopupBar at the top of the
//     editions column (.leftcol.game_description_column) PLUS one dimmed «СКОРО»
//     chip on the first edition block. Submitting the bar publishes
//     `booster-addfunds.topup-requested` on the cross-target bus — booster-checkout's
//     main-shell popup subscribes and pre-fills the amount.
//
// Keys data + purchases flow over sb.bus via createKeysClient (the wire fetch +
// checkout window live in booster-checkout's main-shell). Cross-target user data
// (currency/balance) arrives over the bus as `booster-checkout.user.snapshot`
// payloads, surfaced through the shared user-snapshot service.
//
// Plain DOM by design (store BrowserView has no Svelte runtime); CSS is scoped
// via #booster-topup-bar / #booster-keys-block / .booster-eo so it can't leak
// onto Steam's own layout.

import type { SbApi, PageContext } from '@steambalance/booster-framework/api-types';
import { detectRegionLock } from '../lib/region-lock';
import { parseAppId } from '../lib/app-id';
import { readFirstEditionPrice } from '../lib/edition-price';
import { matchItemsToBlocks } from '../lib/edition-match';
import { createKeysClient } from '../lib/keys-client';
import type { KeyItem } from '../lib/keys-api';
import { buildEditionOfferChip, ensureEditionOfferStyles } from '../components/edition-offer-chip';
import { buildKeysBlock, ensureKeysStyles } from '../components/keys-block';
import { openEmailModal as realOpenEmailModal } from '../components/email-modal';
import { buildTopupBar, ensureTopupStyles } from '../components/topup-bar';
import { ensureSnapshotService, type UserSnapshot } from '../lib/user-snapshot';
import { currencySym, defaultAmountForCurrency } from '../lib/currency';
import { waitForElement } from '../lib/wait-for-element';
import { LL } from '../i18n';

// Build-time-inlined PNG logo (data:image/png;base64,…). Bypasses
// store.steampowered.com's img-src CSP that would block our CDN URL. Resolved via
// typeof guard so the bun `define` substitution can be absent (e.g. when imported
// by a `bun test` run that loads source directly). Empty-string fallback keeps
// tests deterministic.
declare const __SB_ADDFUNDS_LOGO_DATA_URI__: string;
const LOGO = typeof __SB_ADDFUNDS_LOGO_DATA_URI__ !== 'undefined' ? __SB_ADDFUNDS_LOGO_DATA_URI__ : '';

// Both the chip and the keys-block row expose this handle so runPurchase can drive
// either presentation uniformly.
interface PurchaseHandle {
  setBusy(b: boolean): void;
  setError(m: string | null): void;
}

interface KeysClient {
  requestKeys(appid: number, signal: AbortSignal): Promise<KeyItem[]>;
  purchaseKey(itemId: number, email?: string): Promise<{ status: 'ok' | 'email-required' | 'error'; error?: string }>;
  dispose(): void;
}

interface AppPageDeps {
  /** Keys transport seam. Default: the real bus client `createKeysClient(sb)`. */
  keysClient?: KeysClient;
  /** Email-entry modal seam. Default: the real `openEmailModal`. */
  openEmailModal?: () => Promise<string | null>;
}

export function registerAppPage(sb: SbApi, deps: AppPageDeps = {}): void {
  const keysClient = deps.keysClient ?? createKeysClient(sb);
  const openEmailModal = deps.openEmailModal ?? realOpenEmailModal;
  const snap = ensureSnapshotService(sb);

  // Drive a key purchase from either the chip or a keys-block row. The handle's
  // busy/error state lives on the originating control. setBusy(false) BEFORE the
  // modal await (per spec) so the loader isn't spinning while the user types; it
  // re-arms only after a valid email is entered.
  async function runPurchase(item: KeyItem, handle: PurchaseHandle): Promise<void> {
    handle.setError(null);
    handle.setBusy(true);
    let r = await keysClient.purchaseKey(item.itemId);
    if (r.status === 'email-required') {
      handle.setBusy(false);
      const email = await openEmailModal();
      if (!email) return;            // cancel → nothing sent, loader already off
      handle.setBusy(true);
      r = await keysClient.purchaseKey(item.itemId, email);
    }
    handle.setBusy(false);
    if (r.status === 'error') handle.setError(LL.addfunds.keys_purchase_error());
    // r.status === 'ok' → checkout already opened the payment window
  }

  async function mountRegion(ctx: PageContext): Promise<(() => void) | void> {
    const errBox = await waitForElement<HTMLElement>('#error_box', ctx.signal);
    if (!errBox || ctx.signal.aborted) return;
    const appId = parseAppId(ctx.url.toString());
    if (appId == null) return;
    const items = await keysClient.requestKeys(appId, ctx.signal);
    if (ctx.signal.aborted || items.length === 0) return;
    ensureKeysStyles();
    const block = buildKeysBlock(items, {
      onBuy: (item, row) => { void runPurchase(item, row); },
      logoUrl: LOGO,
    });
    errBox.parentElement?.insertBefore(block, errBox.nextSibling);
    return () => {
      try { block.remove(); } catch { /* detached */ }
      document.getElementById('booster-keys-style')?.remove();
    };
  }

  async function mountNormal(ctx: PageContext): Promise<(() => void) | void> {
    // Anchor on the purchase/editions block (#game_area_purchase); the topup bar
    // lands at the very TOP of its column (.leftcol.game_description_column).
    const buyArea = await waitForElement<HTMLElement>('#game_area_purchase', ctx.signal);
    if (!buyArea || ctx.signal.aborted) return;
    const col = buyArea.parentElement;
    if (!col) return;

    const appId = parseAppId(ctx.url.toString());
    const items = appId != null ? await keysClient.requestKeys(appId, ctx.signal) : [];
    if (ctx.signal.aborted) return;

    const teardowns: Array<() => void> = [];

    // Topup bar ("Пополнить"), inserted as the first element of the editions
    // column. Idempotent: a second mount on the same DOM is a no-op.
    const mountTopupBar = (): void => {
      if (document.getElementById('booster-topup-bar')) return;
      const bar = buildTopupBar({
        heading: LL.addfunds.row_label(),
        ariaLabel: LL.addfunds.row_aria_label(),
        placeholder: '',
        currencySymbol: '',
        logoUrl: LOGO,
        onSubmit: (amount) => { sb.bus.publish('booster-addfunds.topup-requested', { amount }); },
      });
      // No top margin: the bar is the first element of the left column, so it must
      // align with the top of the right column.
      bar.root.style.marginTop = '0';
      const apply = (s: UserSnapshot): void => {
        const def = defaultAmountForCurrency(s.currency);
        bar.setCurrency(currencySym(s.currency), def > 0 ? String(def) : '');
      };
      const unsub = snap.subscribe(apply); // fires immediately if cache exists
      // Prefill with the first edition's price when readable; `apply` only touches
      // the symbol/placeholder (never input.value) so this prefill survives later
      // snapshot updates.
      const editionPrice = readFirstEditionPrice(document);
      if (editionPrice != null) bar.setAmount(editionPrice);
      ensureTopupStyles();
      col.insertBefore(bar.root, col.firstChild);
      teardowns.push(() => {
        unsub();
        try { bar.root.remove(); } catch { /* detached */ }
        document.getElementById('booster-topup-style')?.remove();
      });
    };

    // Mount the edition offer chip for a matched KeyItem into its block's native
    // action row (flex host so our chip pins right). Idempotent via the
    // booster-dist-host guard. The shared stylesheet is reference-counted on
    // teardown so one chip's removal never strips styles from sibling chips.
    const mountChip = (block: HTMLElement, item: KeyItem): void => {
      const action = block.querySelector('.game_purchase_action') as HTMLElement | null;
      if (!action || action.classList.contains('booster-dist-host')) return;
      ensureEditionOfferStyles();
      action.classList.add('booster-dist-host');
      if (item.packageId != null) action.dataset.sbKeysSubid = String(item.packageId);
      const chip = buildEditionOfferChip({ item, onBuy: () => void runPurchase(item, chip) });
      action.appendChild(chip.root);
      teardowns.push(() => {
        try { chip.root.remove(); action.classList.remove('booster-dist-host'); delete action.dataset.sbKeysSubid; } catch { /* detached */ }
        if (document.querySelectorAll('.booster-eo').length === 0) document.getElementById('booster-edition-offer-style')?.remove();
      });
    };

    // Empty-state «СКОРО» chip — same host wiring as mountChip but a dimmed no-op
    // button. Also a `.booster-eo`, so the refcounted style teardown covers it.
    const mountComingSoonChip = (block: HTMLElement): void => {
      const action = block.querySelector('.game_purchase_action') as HTMLElement | null;
      if (!action || action.classList.contains('booster-dist-host')) return;
      ensureEditionOfferStyles();
      action.classList.add('booster-dist-host');
      const chip = buildEditionOfferChip({ comingSoon: true });
      action.appendChild(chip.root);
      teardowns.push(() => {
        try { chip.root.remove(); action.classList.remove('booster-dist-host'); } catch { /* detached */ }
        if (document.querySelectorAll('.booster-eo').length === 0) document.getElementById('booster-edition-offer-style')?.remove();
      });
    };

    const blocks = [...buyArea.querySelectorAll('.game_area_purchase_game')] as HTMLElement[];
    const pairs = matchItemsToBlocks(items, blocks);
    if (pairs.length > 0) {
      for (const { block, item } of pairs) mountChip(block, item);
    } else {
      mountTopupBar();
      if (blocks[0]) mountComingSoonChip(blocks[0]);
    }

    if (teardowns.length === 0) return;
    return () => { for (const t of teardowns) t(); };
  }

  sb.pages.register({
    name: 'booster-addfunds-app',
    match: { url: /store\.steampowered\.com\/app\/\d+/ },
    mount: async (ctx: PageContext) => {
      if (document.readyState === 'loading') {
        await new Promise<void>((r) => document.addEventListener('DOMContentLoaded', () => r(), { once: true, signal: ctx.signal }));
      }
      if (ctx.signal.aborted) return;
      if (detectRegionLock(document)) return mountRegion(ctx);
      return mountNormal(ctx);
    },
  });
}
