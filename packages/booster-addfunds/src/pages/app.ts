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
//     native purchase block gets an edition-offer chip in that block's purchase
//     row, and the topup bar is hidden (mutual exclusion). Matching is id-space
//     aware (see lib/edition-match.ts): a 'package' offer pairs with an edition
//     block's subid, a 'bundle' offer with a bundle block's bundleid — so a page
//     that sells the base game plus two bundles can carry three chips. No match
//     (empty result or unknown ids) → branded TopupBar at the top of the
//     editions column (.leftcol.game_description_column) PLUS one dimmed «СКОРО»
//     chip on the first edition block. Submitting the bar publishes
//     `booster-addfunds.topup-requested` on the cross-target bus — booster-checkout's
//     main-shell popup subscribes and pre-fills the amount.
//
// The UI itself (chip, «СКОРО» twin, topup bar, keys block, purchase flow) lives
// in lib/purchase-mount.ts, shared with pages/package.ts — this module only picks
// the anchors and decides which branch runs.
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
import { parseKeysTarget } from '../lib/keys-target';
import { matchItemsToBlocks, isPurchasableBlock } from '../lib/edition-match';
import { createKeysClient } from '../lib/keys-client';
import { createPurchaseMounter, type KeysClient } from '../lib/purchase-mount';
import { ensureSnapshotService } from '../lib/user-snapshot';
import { waitForElement, waitForElementBy } from '../lib/wait-for-element';
import { fetchCatalogue as realFetchCatalogue, readCache, writeCache, decide, type Item } from '../lib/catalogue-api';
import { buildRegionGamesBlock, ensureRegionGamesStyles } from '../components/region-games-block';
import { REGION_GAMES_PROMO_URL } from '../urls';

interface AppPageDeps {
  /** Keys transport seam. Default: the real bus client `createKeysClient(sb)`. */
  keysClient?: KeysClient;
  /** Email-entry modal seam. Default: the real `openEmailModal`. */
  openEmailModal?: () => Promise<string | null>;
  /** Purchase-error modal seam. Default: the real `openErrorModal`. */
  openErrorModal?: (message: string) => void;
  /** Catalogue-fetch seam (region-games carousel). Default: the real `fetchCatalogue`. */
  fetchCatalogue?: typeof realFetchCatalogue;
  /** Overflow measurement seam for fitChip, in px (>0 → the row overflows).
   *  Default: the live layout read. Tests inject a value because happy-dom
   *  runs no layout engine and reports every box as 0. */
  measureOverflow?: (host: HTMLElement) => number;
  /** Clock seam for the region-games cache decision. Default: `Date.now`. */
  now?: () => number;
}

export function registerAppPage(sb: SbApi, deps: AppPageDeps = {}): void {
  const keysClient = deps.keysClient ?? createKeysClient(sb);
  const fetchCatalogue = deps.fetchCatalogue ?? realFetchCatalogue;
  const snap = ensureSnapshotService(sb);   // region-games currency; the bar's own copy lives in purchase-mount
  const mount = createPurchaseMounter(sb, {
    keysClient,
    openEmailModal: deps.openEmailModal,
    openErrorModal: deps.openErrorModal,
    measureOverflow: deps.measureOverflow,
  });

  async function mountRegion(ctx: PageContext): Promise<(() => void) | void> {
    const errBox = await waitForElement<HTMLElement>('#error_box', ctx.signal);
    if (!errBox || ctx.signal.aborted) return;
    const target = parseKeysTarget(ctx.url.toString());
    if (target == null) return;
    const items = await keysClient.requestKeys(target, ctx.signal);
    if (ctx.signal.aborted) return;
    return mount.mountKeysBlockAfter(errBox, items) ?? undefined;
  }

  async function mountNormal(ctx: PageContext): Promise<(() => void) | void> {
    // Anchor on the purchase/editions block (#game_area_purchase); the topup bar
    // lands at the very TOP of its column (.leftcol.game_description_column).
    const buyArea = await waitForElement<HTMLElement>('#game_area_purchase', ctx.signal);
    if (!buyArea || ctx.signal.aborted) return;
    const col = buyArea.parentElement;
    if (!col) return;

    const target = parseKeysTarget(ctx.url.toString());
    const items = target != null ? await keysClient.requestKeys(target, ctx.signal) : [];
    if (ctx.signal.aborted) return;

    const teardowns: Array<() => void> = [];
    const push = (t: (() => void) | null): void => { if (t) teardowns.push(t); };

    const blocks = [...buyArea.querySelectorAll('.game_area_purchase_game')] as HTMLElement[];
    const pairs = matchItemsToBlocks(items, blocks);
    if (pairs.length > 0) {
      for (const { block, item } of pairs) push(mount.mountChip(block, item));
    } else {
      push(mount.mountTopupBar(col));
      // «СКОРО» goes on the first real PAID edition — skip the free demo
      // download row (and any free/install block) so the chip never lands on a
      // "Загрузить" block. No purchasable block → no chip (bar still shows).
      const soonTarget = blocks.find(isPurchasableBlock);
      if (soonTarget) push(mount.mountComingSoonChip(soonTarget));
    }

    if (teardowns.length === 0) return;
    return () => { for (const t of teardowns) t(); };
  }

  // Region-games carousel ("Игры недоступные в регионе") — anchored as the
  // first child of the RIGHT META column (`.rightcol.game_meta_data`, the one
  // holding "Может ли эта игра вам понравиться?"), fed by catalogue-api's fetch
  // + 10-min localStorage cache. NB: an /app/ page has multiple `.rightcol`
  // elements (the top glance column + the meta column + an empty responsive
  // duplicate), so a bare `.rightcol` matches the wrong one — target
  // `.rightcol.game_meta_data` and skip the empty duplicate by requiring
  // children. Structurally non-throwing: any failure here must never strand
  // mountNormal's own teardown (see the allSettled combine in the page mount).
  async function mountRegionGames(ctx: PageContext): Promise<(() => void) | void> {
    try {
      const col = await waitForElementBy<HTMLElement>(
        () => [...document.querySelectorAll<HTMLElement>('.rightcol.game_meta_data')]
          .find((c) => c.childElementCount > 0) ?? null,
        ctx.signal,
      );
      if (!col || ctx.signal.aborted) return;
      if (document.getElementById('booster-region-games')) return;
      const now = (deps.now ?? (() => Date.now()))();
      const cache = readCache();
      const d = decide(now, cache);
      let teardown: (() => void) | undefined;
      const insert = (items: Item[]): void => {
        if (ctx.signal.aborted || document.getElementById('booster-region-games')) return;
        ensureRegionGamesStyles();
        const block = buildRegionGamesBlock(items, {
          onBackgroundClick: () => { window.location.assign(REGION_GAMES_PROMO_URL); },
        });
        col.insertBefore(block, col.firstChild);
        teardown = () => {
          try { block.remove(); } catch { /* detached */ }
          document.getElementById('booster-region-games-style')?.remove();
        };
      };
      if (d.render) insert(d.render);
      if (d.shouldFetch) {
        // Region from the store country, currency from the user snapshot — both
        // normalized to the ISO upper-case the backend contract expects. Either
        // may be unknown (cold snapshot / no Steam cap); fetchCatalogue omits
        // whichever is missing rather than sending it blank.
        // getStoreCountry is internally bounded (~3s on a cold steamId) and only
        // gates the FIRST carousel appearance when there's no cache; cached
        // renders above are synchronous. One-time, acceptable — not worth
        // shipping the carousel region-blind to shave a cold-start second.
        const country = (await sb.steam?.getStoreCountry?.())?.toUpperCase() ?? null;
        const currency = snap.get()?.currency?.toUpperCase() ?? null;
        const res = await fetchCatalogue(sb, { country, currency, signal: ctx.signal });
        if (ctx.signal.aborted) return teardown;
        if (res.status === 'ok') {
          writeCache({ items: res.items, fetchedAt: now, attemptedAt: now });
          if (!teardown) insert(res.items);          // cold: first appearance
          // already-shown: do NOT rebuild (avoid animation reset) — fresh items apply next mount
        } else if (res.status === 'empty') {
          writeCache({ items: [], fetchedAt: now, attemptedAt: now });
          if (teardown) { teardown(); teardown = undefined; }  // hide-on-empty (client requirement)
        } else { // error — ALWAYS stamp attemptedAt, even with NO prior cache (I2 backoff):
          // a cold client during a backend outage must not refetch on every game page.
          writeCache({ items: cache?.items ?? [], fetchedAt: cache?.fetchedAt ?? 0, attemptedAt: now });
        }
      }
      return teardown;
    } catch { return; }   // structurally non-throwing
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
      const results = await Promise.allSettled([mountNormal(ctx), mountRegionGames(ctx)]);
      const teardowns = results
        .filter((r): r is PromiseFulfilledResult<(() => void) | void> => r.status === 'fulfilled')
        .map((r) => r.value)
        .filter((v): v is () => void => typeof v === 'function');
      if (teardowns.length === 0) return;
      return () => { for (const t of teardowns) t(); };
    },
  });
}
