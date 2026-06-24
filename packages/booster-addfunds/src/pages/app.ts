// booster-plugins/packages/booster-addfunds/src/pages/app.ts
//
// Store-context page handler for Steam product pages
// (`store.steampowered.com/app/<id>`). Two branches, decided on mount:
//
//   - Region-locked page (detectRegionLock true) — Steam renders its
//     generic "unavailable in your region" error template (#error_box,
//     no product DOM). We fetch region keys for the app id and, if any
//     exist, insert our branded keys block immediately after #error_box.
//     No keys → leave the page untouched.
//
//   - Normal app page — the TopupBar and the keys offer chip are mutually
//     exclusive (driven by lib/coming-soon.ts::KEYS_COMING_SOON). LIVE: keys
//     present → full edition-offer chip in the first purchase row, topup hidden;
//     no keys → branded TopupBar at the top of the editions column
//     (.leftcol.game_description_column). INTERIM (API pending): topup ALWAYS
//     shown + a dimmed «Купить»-only chip with a «СКОРО» badge. Submitting the
//     bar publishes `booster-addfunds.topup-requested` on the cross-target bus —
//     booster-checkout's main-shell popup subscribes and pre-fills the amount.
//
// Cross-target user data (currency/balance) arrives over the bus as
// `booster-checkout.user.snapshot` payloads, surfaced through the shared
// user-snapshot service (BC doesn't cross to store.steampowered.com).
// The bar renders immediately with empty placeholder/symbol; the snapshot
// subscription patches them when a snapshot lands.
//
// Plain DOM by design (store BrowserView has no Svelte runtime); CSS is
// scoped via #booster-topup-bar / #booster-keys-block so it can't leak onto Steam's
// own layout.

import type { SbApi, PageContext } from '@steambalance/booster-framework/api-types';
import { detectRegionLock } from '../lib/region-lock';
import { parseAppId } from '../lib/app-id';
import { readFirstEditionPrice, readFirstEditionPriceInfo } from '../lib/edition-price';
import { getEditionOffer, type EditionOffer } from '../lib/edition-offer';
import { buildEditionOfferChip, ensureEditionOfferStyles, type EditionOfferChipOptions } from '../components/edition-offer-chip';
import { fetchRegionKeys as realFetchRegionKeys, type RegionKey } from '../lib/keys-api';
import { KEYS_COMING_SOON } from '../lib/coming-soon';
import { buildKeysBlock, ensureKeysStyles } from '../components/keys-block';
import { buildTopupBar, ensureTopupStyles } from '../components/topup-bar';
import { ensureSnapshotService, type UserSnapshot } from '../lib/user-snapshot';
import { currencySym, defaultAmountForCurrency } from '../lib/currency';
import { waitForElement } from '../lib/wait-for-element';
import { LL } from '../i18n';

// Build-time-inlined PNG logo (data:image/png;base64,…). Bypasses
// store.steampowered.com's img-src CSP that would block our CDN URL.
// Resolved via typeof guard so the bun `define` substitution can be
// absent (e.g. when imported by a `bun test` run that loads source
// directly). Empty-string fallback keeps tests deterministic.
declare const __SB_ADDFUNDS_LOGO_DATA_URI__: string;
const LOGO = typeof __SB_ADDFUNDS_LOGO_DATA_URI__ !== 'undefined' ? __SB_ADDFUNDS_LOGO_DATA_URI__ : '';

interface AppPageDeps {
  fetchRegionKeys?: (appId: number, signal: AbortSignal) => Promise<RegionKey[]>;
  /** INTERIM override (default `KEYS_COMING_SOON`). true → «Купить»-only chip with
   *  a «СКОРО» badge + topup always visible; false → live mutual exclusion (keys
   *  present → full chip, topup hidden; no keys → topup fallback). */
  comingSoon?: boolean;
  /** LIVE-mode keys lookup seam. Resolves our edition offer for the page, or null
   *  when the app has no keys (→ topup fallback). Defaults to the DOM-price-derived
   *  resolver; tests inject a deterministic value to exercise both live branches. */
  resolveEditionOffer?: (sb: SbApi, ctx: PageContext, buyArea: HTMLElement) => Promise<EditionOffer | null>;
}

// First edition block on the page (the one carrying a final price). Shared by the
// keys lookup and the chip mount so both target the same native row.
function firstEditionBlock(buyArea: HTMLElement): HTMLElement | undefined {
  return [...buyArea.querySelectorAll('.game_area_purchase_game')]
    .find((b) => b.querySelector('[data-price-final]')) as HTMLElement | undefined;
}

// Default LIVE resolver: derive our offer from the first edition's on-page Steam
// price. Returns null when there's no eligible block / price / offer (= "no keys")
// — the caller turns null into a topup fallback. When the real keys endpoint lands,
// swap getEditionOffer's body for the API; null MUST mean "no keys for this app".
async function resolveEditionOfferDefault(
  sb: SbApi, ctx: PageContext, buyArea: HTMLElement,
): Promise<EditionOffer | null> {
  void sb;
  if (!firstEditionBlock(buyArea)) return null;
  const appId = parseAppId(ctx.url.toString());
  if (appId == null) return null;
  const info = readFirstEditionPriceInfo(document);
  if (!info) return null;
  return getEditionOffer(appId, info.amount, info.currencySymbol, ctx.signal);
}

// Interim placeholder offer for the «Купить»-only chip: discount + price are hidden
// by the chip options, so these numbers are never displayed.
const PLACEHOLDER_OFFER: EditionOffer = { ourPrice: 0, steamPrice: 0, discountPercent: 0, currencySymbol: '' };

// Mount the edition offer chip into the first edition's native action row (flex
// host so our chip pins right). Idempotent (re-mount safe via the
// booster-dist-host / #booster-edition-offer guards). Returns a teardown, or void
// when there's no eligible action / it's already hosted. Synchronous: the keys
// lookup is done by the caller, so there's no post-await race here.
function mountEditionChip(
  buyArea: HTMLElement, offer: EditionOffer, opts: EditionOfferChipOptions,
): (() => void) | void {
  const block = firstEditionBlock(buyArea);
  if (!block) return;
  const action = block.querySelector('.game_purchase_action') as HTMLElement | null;
  if (!action) return;
  if (action.classList.contains('booster-dist-host') || action.querySelector('#booster-edition-offer')) return;
  ensureEditionOfferStyles();
  action.classList.add('booster-dist-host');
  const chip = buildEditionOfferChip(offer, opts);
  action.appendChild(chip);
  return () => {
    try { action.classList.remove('booster-dist-host'); chip.remove(); } catch { /* detached */ }
    document.getElementById('booster-edition-offer-style')?.remove();
  };
}

export function registerAppPage(sb: SbApi, deps: AppPageDeps = {}): void {
  const fetchRegionKeys = deps.fetchRegionKeys ?? realFetchRegionKeys;
  const comingSoon = deps.comingSoon ?? KEYS_COMING_SOON;
  const resolveEditionOffer = deps.resolveEditionOffer ?? resolveEditionOfferDefault;
  const snap = ensureSnapshotService(sb);

  async function mountRegion(ctx: PageContext): Promise<(() => void) | void> {
    const errBox = await waitForElement<HTMLElement>('#error_box', ctx.signal);
    if (!errBox || ctx.signal.aborted) return;
    const appId = parseAppId(ctx.url.toString());
    if (appId == null) return;
    const keys = await fetchRegionKeys(appId, ctx.signal);
    if (ctx.signal.aborted || keys.length === 0) return;
    ensureKeysStyles();
    const block = buildKeysBlock(keys, { logoUrl: LOGO });
    errBox.parentElement?.insertBefore(block, errBox.nextSibling);
    return () => {
      try { block.remove(); } catch { /* detached */ }
      document.getElementById('booster-keys-style')?.remove();
    };
  }

  async function mountNormal(ctx: PageContext): Promise<(() => void) | void> {
    // Anchor on the purchase/editions block (#game_area_purchase) and place the
    // bar at the very TOP of its column (.leftcol.game_description_column) — the
    // same flow that holds the "Издания"/"Купить" blocks — as a separate element
    // above them, not nested in the Steam queue-actions panel.
    const buyArea = await waitForElement<HTMLElement>('#game_area_purchase', ctx.signal);
    if (!buyArea || ctx.signal.aborted) return;
    const col = buyArea.parentElement;
    if (!col) return;

    const teardowns: Array<() => void> = [];

    // Topup bar ("Пополнить"). Inserted as the first element of the editions
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
      // No top margin: the bar is the first element of the left column, so it
      // must align with the top of the right column (the base #booster-topup-bar rule
      // carries a 16px top margin for the addfunds page — zero it out here).
      bar.root.style.marginTop = '0';
      const apply = (s: UserSnapshot): void => {
        const def = defaultAmountForCurrency(s.currency);
        bar.setCurrency(currencySym(s.currency), def > 0 ? String(def) : '');
      };
      const unsub = snap.subscribe(apply); // fires immediately if cache exists
      // Prefill with the first edition's price when we can read it; otherwise the
      // bar stays empty with its currency placeholder. `apply` only touches the
      // symbol/placeholder (never input.value), so this prefill survives later
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

    if (comingSoon) {
      // INTERIM (keys API pending): the topup bar is ALWAYS shown, and the offer
      // is reduced to a dimmed «Купить» button with a «СКОРО» badge — no keys
      // lookup, no discount/price. Flip KEYS_COMING_SOON (lib/coming-soon.ts) to
      // drop this branch.
      mountTopupBar();
      const t = mountEditionChip(buyArea, PLACEHOLDER_OFFER, { showDiscount: false, showPrice: false, comingSoon: true });
      if (t) teardowns.push(t);
    } else {
      // LIVE: the topup bar and the keys offer are mutually exclusive. Keys
      // present (offer != null) → show the full chip, hide the topup. No keys →
      // topup fallback.
      const offer = await resolveEditionOffer(sb, ctx, buyArea);
      if (ctx.signal.aborted) return;
      if (offer) {
        const t = mountEditionChip(buyArea, offer, { showDiscount: true, showPrice: true });
        if (t) teardowns.push(t);
      } else {
        mountTopupBar();
      }
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
