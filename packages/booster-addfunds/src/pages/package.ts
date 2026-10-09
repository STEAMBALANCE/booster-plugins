// booster-plugins/packages/booster-addfunds/src/pages/package.ts
//
// Store-context page handler for Steam's two PACKAGE page types —
// `store.steampowered.com/sub/<id>` (a Steam package) and `/bundle/<id>` (a
// bundle). One module for both: the pages render an identical shape and differ
// only in which id space addresses the product, which is exactly what
// lib/keys-target.ts and lib/edition-match.ts already abstract.
//
// Unlike an /app/ page — which sells several products side by side and shows one
// purchase area — a package page sells ONE product and shows it TWICE: a
// `#game_area_purchase_top` block under the package header, and a
// `#game_area_purchase_bottom` block under the price breakdown. Both get a chip,
// so our «Купить» sits next to Steam's «В корзину» wherever the user is looking.
//
// Branches, decided on mount (same two as pages/app.ts):
//
//   - Region-locked page — Steam renders its generic error template (#error_box,
//     no product DOM). Keys, if any, go into the branded block right after it.
//
//   - Normal page — request keys for this sub/bundle id; every purchase block
//     that matches gets an edition-offer chip. No offer at all → branded TopupBar
//     at the top of the editions column PLUS a dimmed «СКОРО» chip in each block
//     (both, because both blocks sell the same product — a page showing our chip
//     top-only would read as a rendering fault).
//
// All the UI and the purchase flow live in lib/purchase-mount.ts, shared with
// pages/app.ts; this module only picks anchors and decides the branch.

import type { SbApi, PageContext } from '@steambalance/booster-framework/api-types';
import { detectRegionLock } from '../lib/region-lock';
import { parseKeysTarget } from '../lib/keys-target';
import { matchItemsToBlocks, isPurchasableBlock } from '../lib/edition-match';
import { createKeysClient } from '../lib/keys-client';
import { createPurchaseMounter, type KeysClient } from '../lib/purchase-mount';
import type { KeyItem } from '../lib/keys-api';
import { waitForElement, waitForElementBy } from '../lib/wait-for-element';

interface PackagePageDeps {
  /** Keys transport seam. Default: the real bus client `createKeysClient(sb)`. */
  keysClient?: KeysClient;
  /** Email-entry modal seam. Default: the real `openEmailModal`. */
  openEmailModal?: () => Promise<string | null>;
  /** Purchase-error modal seam. Default: the real `openErrorModal`. */
  openErrorModal?: (message: string) => void;
  /** Overflow measurement seam for chip fitting, in px (>0 → the row overflows).
   *  Default: the live layout read. Tests inject a value because happy-dom
   *  runs no layout engine and reports every box as 0. */
  measureOverflow?: (host: HTMLElement) => number;
}

// The offer to mount when the backend answered but no offer could be paired with
// a block by id. Legitimate only here: the request named ONE product
// (`?sub=…` / `?bundle=…`), so every item in the answer is about that product,
// and an item that carries no `package.id` (older backend payload) would
// otherwise strand a real, purchasable key behind a «СКОРО» chip.
//
// Deliberately NOT applied when the items DO carry ids that simply don't match:
// the sub and bundle id spaces overlap numerically, so an id mismatch means the
// answer disagrees with the page about what is being sold — selling it anyway
// could charge the user for the wrong product. /app/ pages never take this path
// at all (they sell many products from one list).
function fallbackOffer(items: KeyItem[]): KeyItem | null {
  if (items.length === 0) return null;
  if (items.some((i) => i.packageId != null)) return null;
  return items.find((i) => i.isActive) ?? null;
}

export function registerPackagePage(sb: SbApi, deps: PackagePageDeps = {}): void {
  const keysClient = deps.keysClient ?? createKeysClient(sb);
  const mount = createPurchaseMounter(sb, {
    keysClient,
    openEmailModal: deps.openEmailModal,
    openErrorModal: deps.openErrorModal,
    measureOverflow: deps.measureOverflow,
  });

  async function requestKeysForPage(ctx: PageContext): Promise<KeyItem[]> {
    const target = parseKeysTarget(ctx.url.toString());
    if (target == null) return [];
    return keysClient.requestKeys(target, ctx.signal);
  }

  async function mountRegion(ctx: PageContext): Promise<(() => void) | void> {
    const errBox = await waitForElement<HTMLElement>('#error_box', ctx.signal);
    if (!errBox || ctx.signal.aborted) return;
    const items = await requestKeysForPage(ctx);
    if (ctx.signal.aborted) return;
    return mount.mountKeysBlockAfter(errBox, items) ?? undefined;
  }

  async function mountNormal(ctx: PageContext): Promise<(() => void) | void> {
    // Both purchase areas keep the `game_area_purchase` CLASS but carry
    // id-suffixed ids (`…_top` / `…_bottom`), so there is no `#game_area_purchase`
    // to anchor on the way an /app/ page does. Wait for the first one to exist,
    // then take them all — server-rendered, so they land together.
    const areas = await waitForElementBy<HTMLElement[]>(() => {
      const found = [...document.querySelectorAll<HTMLElement>('.game_area_purchase')];
      return found.length > 0 ? found : null;
    }, ctx.signal);
    if (!areas || ctx.signal.aborted) return;

    const items = await requestKeysForPage(ctx);
    if (ctx.signal.aborted) return;

    const blocks = areas.flatMap((a) => [...a.querySelectorAll<HTMLElement>('.game_area_purchase_game')]);
    const teardowns: Array<() => void> = [];
    const push = (t: (() => void) | null): void => { if (t) teardowns.push(t); };

    const pairs = matchItemsToBlocks(items, blocks);
    const fallback = pairs.length === 0 ? fallbackOffer(items) : null;
    if (pairs.length > 0) {
      for (const { block, item } of pairs) push(mount.mountChip(block, item));
    } else if (fallback) {
      for (const block of blocks) push(mount.mountChip(block, fallback));
    } else {
      // The topup bar is the first element of the editions column — the same
      // column both purchase areas live in.
      const col = document.querySelector<HTMLElement>('.leftcol.game_description_column') ?? areas[0]?.parentElement;
      if (col) push(mount.mountTopupBar(col));
      // Skip any free/«Загрузить» row the way the /app/ empty state does; on a
      // real package page every block is paid, so this normally hits both.
      for (const block of blocks.filter(isPurchasableBlock)) push(mount.mountComingSoonChip(block));
    }

    if (teardowns.length === 0) return;
    return () => { for (const t of teardowns) t(); };
  }

  sb.pages.register({
    name: 'booster-addfunds-package',
    match: { url: /store\.steampowered\.com\/(sub|bundle)\/\d+/ },
    mount: async (ctx: PageContext) => {
      if (document.readyState === 'loading') {
        await new Promise<void>((r) => document.addEventListener('DOMContentLoaded', () => r(), { once: true, signal: ctx.signal }));
      }
      if (ctx.signal.aborted) return;
      return detectRegionLock(document) ? mountRegion(ctx) : mountNormal(ctx);
    },
  });
}
