// Shared mounting core for every store page that sells something we also sell:
// the edition-offer chip, its «СКОРО» empty-state twin, the topup bar, the
// region-locked keys block, and the purchase flow all four drive.
//
// Extracted from pages/app.ts so pages/package.ts (/sub/<id>, /bundle/<id>) can
// reuse it verbatim — the two page types differ only in which DOM they anchor
// to and which id space they query, never in what our UI does once mounted.
// Every mount* returns its own teardown (or null when it declined to mount), so
// a page module just collects the non-null ones.
import type { SbApi } from '@steambalance/booster-framework/api-types';
import type { KeyItem } from './keys-api';
import type { KeysTarget } from './keys-target';
import { buildEditionOfferChip, ensureEditionOfferStyles } from '../components/edition-offer-chip';
import { buildKeysBlock, ensureKeysStyles } from '../components/keys-block';
import { buildTopupBar, ensureTopupStyles } from '../components/topup-bar';
import { openEmailModal as realOpenEmailModal } from '../components/email-modal';
import { openErrorModal as realOpenErrorModal } from '../components/error-modal';
import { ensureSnapshotService, type UserSnapshot } from './user-snapshot';
import { currencySym, defaultAmountForCurrency } from './currency';
import { readFirstEditionPrice } from './edition-price';
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
export interface PurchaseHandle {
  setBusy(b: boolean): void;
}

export interface KeysClient {
  requestKeys(target: KeysTarget, signal: AbortSignal): Promise<KeyItem[]>;
  purchaseKey(itemId: number, email?: string, titles?: { title: string; taskbarTitle: string }): Promise<{ status: 'ok' | 'email-required' | 'error'; error?: string; message?: string }>;
  dispose(): void;
}

export interface PurchaseMountDeps {
  keysClient: KeysClient;
  /** Email-entry modal seam. Default: the real `openEmailModal`. */
  openEmailModal?: () => Promise<string | null>;
  /** Purchase-error modal seam. Default: the real `openErrorModal`. */
  openErrorModal?: (message: string) => void;
  /** Overflow measurement seam for fitChip, in px (>0 → the row overflows).
   *  Default: the live layout read. Tests inject a value because happy-dom
   *  runs no layout engine and reports every box as 0. */
  measureOverflow?: (host: HTMLElement) => number;
}

export interface PurchaseMounter {
  runPurchase(item: KeyItem, handle: PurchaseHandle): Promise<void>;
  mountChip(block: HTMLElement, item: KeyItem): (() => void) | null;
  mountComingSoonChip(block: HTMLElement): (() => void) | null;
  mountTopupBar(col: HTMLElement): (() => void) | null;
  mountKeysBlockAfter(anchor: HTMLElement, items: KeyItem[]): (() => void) | null;
}

export function createPurchaseMounter(sb: SbApi, deps: PurchaseMountDeps): PurchaseMounter {
  const keysClient = deps.keysClient;
  const openEmailModal = deps.openEmailModal ?? realOpenEmailModal;
  const openErrorModal = deps.openErrorModal ?? realOpenErrorModal;
  const measureOverflow = deps.measureOverflow ?? ((host: HTMLElement) => host.scrollWidth - host.clientWidth);
  const snap = ensureSnapshotService(sb);

  // Drive a key purchase from either the chip or a keys-block row. The handle's
  // busy/error state lives on the originating control. setBusy(false) BEFORE the
  // modal await (per spec) so the loader isn't spinning while the user types; it
  // re-arms only after a valid email is entered.
  async function runPurchase(item: KeyItem, handle: PurchaseHandle): Promise<void> {
    handle.setBusy(true);
    // Payment-window titles: generic taskbar caption (no game name leaks into the
    // Windows taskbar), game-scoped heading inside the window. Opened by checkout's
    // main-shell, which has no game name — so both ride the bus with the purchase.
    const titles = {
      title: LL.addfunds.keys_purchase_window_title({ gameName: item.name }),
      taskbarTitle: LL.addfunds.keys_purchase_window_taskbar_title(),
    };
    let r = await keysClient.purchaseKey(item.itemId, undefined, titles);
    if (r.status === 'email-required') {
      handle.setBusy(false);
      const email = await openEmailModal();
      if (!email) return;            // cancel → nothing sent, loader already off
      handle.setBusy(true);
      r = await keysClient.purchaseKey(item.itemId, email, titles);
    }
    handle.setBusy(false);
    if (r.status === 'error') {
      // `message` is the human, server-supplied reason (RU) — show it; machine
      // codes (`error`: timeout/network/no-payment/…) go to the console for
      // diagnostics only, never to a RU user. Shown in a page-level Steam-styled
      // modal, not inline next to the button.
      if (r.error) console.error('[booster-addfunds] key purchase failed:', r.error);
      const msg = (typeof r.message === 'string' && r.message.trim()) ? r.message.trim() : LL.addfunds.keys_purchase_error();
      openErrorModal(msg);
    }
    // r.status === 'ok' → checkout already opened the payment window
  }

  // Step the chip down through its compact levels until the host action row stops
  // overflowing. Needed because the native cluster's width is page-dependent: an
  // edition row holds one .game_purchase_action_bg and has ~280px to spare, while a
  // bundle row holds two («Информация о наборе» + discount/cart) and would push the
  // full chip ~25px past the purchase block (CDP-measured on /app/2300320). Reads
  // layout instead of keying off the offer type, so any future row shape self-fits.
  function fitChip(action: HTMLElement, chip: { setCompact(level: 0 | 1 | 2): void }): void {
    for (const level of [1, 2] as const) {
      if (measureOverflow(action) <= 0) return;
      chip.setCompact(level);
    }
  }

  // Mount the edition offer chip for a matched KeyItem into its block's native
  // action row (flex host so our chip pins right). Works the same for an
  // edition row and a bundle row — a bundle's action just holds two native
  // `.game_purchase_action_bg` clusters («Информация о наборе» + price/cart)
  // instead of one, and both stay left of our chip. Idempotent via the
  // booster-dist-host guard. The shared stylesheet is reference-counted on
  // teardown so one chip's removal never strips styles from sibling chips.
  function mountChip(block: HTMLElement, item: KeyItem): (() => void) | null {
    const action = block.querySelector('.game_purchase_action') as HTMLElement | null;
    if (!action || action.classList.contains('booster-dist-host')) return null;
    ensureEditionOfferStyles();
    action.classList.add('booster-dist-host');
    // Diagnostic marker (data-sb-keys-subid / -bundleid) — named after the id
    // space the offer was matched in, so a QA pass can read which product a
    // chip sells straight off the DOM.
    const idAttr = item.packageType === 'bundle' ? 'sbKeysBundleid' : 'sbKeysSubid';
    if (item.packageId != null) action.dataset[idAttr] = String(item.packageId);
    const chip = buildEditionOfferChip({ item, onBuy: () => void runPurchase(item, chip) });
    action.appendChild(chip.root);
    fitChip(action, chip);
    return () => {
      try { chip.root.remove(); action.classList.remove('booster-dist-host'); delete action.dataset[idAttr]; } catch { /* detached */ }
      if (document.querySelectorAll('.booster-eo').length === 0) document.getElementById('booster-edition-offer-style')?.remove();
    };
  }

  // Empty-state «СКОРО» chip — same host wiring as mountChip but a dimmed no-op
  // button. Also a `.booster-eo`, so the refcounted style teardown covers it.
  function mountComingSoonChip(block: HTMLElement): (() => void) | null {
    const action = block.querySelector('.game_purchase_action') as HTMLElement | null;
    if (!action || action.classList.contains('booster-dist-host')) return null;
    ensureEditionOfferStyles();
    action.classList.add('booster-dist-host');
    const chip = buildEditionOfferChip({ comingSoon: true });
    action.appendChild(chip.root);
    return () => {
      try { chip.root.remove(); action.classList.remove('booster-dist-host'); } catch { /* detached */ }
      if (document.querySelectorAll('.booster-eo').length === 0) document.getElementById('booster-edition-offer-style')?.remove();
    };
  }

  // Topup bar ("Пополнить"), inserted as the first element of the editions
  // column. Idempotent: a second mount on the same DOM is a no-op.
  function mountTopupBar(col: HTMLElement): (() => void) | null {
    if (document.getElementById('booster-topup-bar')) return null;
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
    return () => {
      unsub();
      try { bar.root.remove(); } catch { /* detached */ }
      document.getElementById('booster-topup-style')?.remove();
    };
  }

  // Branded keys block for a region-locked page — Steam renders its generic
  // "unavailable in your region" error template and no product DOM at all, so
  // the block goes straight after the error box.
  function mountKeysBlockAfter(anchor: HTMLElement, items: KeyItem[]): (() => void) | null {
    if (items.length === 0) return null;
    ensureKeysStyles();
    const block = buildKeysBlock(items, {
      onBuy: (item, row) => { void runPurchase(item, row); },
      logoUrl: LOGO,
    });
    anchor.parentElement?.insertBefore(block, anchor.nextSibling);
    return () => {
      try { block.remove(); } catch { /* detached */ }
      document.getElementById('booster-keys-style')?.remove();
    };
  }

  return { runPurchase, mountChip, mountComingSoonChip, mountTopupBar, mountKeysBlockAfter };
}
