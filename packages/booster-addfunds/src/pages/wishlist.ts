// booster-plugins/packages/booster-addfunds/src/pages/wishlist.ts
//
// Store-context page handler for Steam's wishlist
// (`store.steampowered.com/wishlist/id/<vanity>/`, `/wishlist/profiles/<id>/`).
// Every row Steam sells gets our edition-offer chip right under Steam's own
// price + «Добавить в корзину» — but only when we have a key for the very
// product that button sells (the row's best_purchase_option, see
// lib/wishlist-row.ts). No key → the row is left untouched: unlike an /app/
// page there is no «СКОРО» twin and no topup bar, a list where most rows wear a
// dimmed chip reads as noise.
//
// The wishlist is a virtualized React list: only the rows in view exist, they
// mount/unmount as the user scrolls, and React may re-render a row's purchase
// column at any time (dropping our chip with it). So instead of a one-shot
// mount, a debounced DOM watch rescans the rendered rows and (re)mounts
// whatever is missing. Keys are asked once per app per page view — a row that
// scrolls back in, or re-renders, is served from the cache. Several requests
// run at once here, which keys-client supports (one waiter per reqId); a
// lookup that got no answer is asked again after a pause (retryLater).
//
// The chip, its styles and the purchase flow are lib/purchase-mount.ts's,
// shared with the /app/ and package pages.

import type { SbApi, PageContext } from '@steambalance/booster-framework/api-types';
import { createKeysClient } from '../lib/keys-client';
import { createPurchaseMounter, type KeysClient } from '../lib/purchase-mount';
import { findOffer } from '../lib/edition-match';
import type { KeyItem } from '../lib/keys-api';
import type { KeysTarget } from '../lib/keys-target';
import { WISHLIST_ROW_SELECTOR, readRowAppId, findPurchaseColumn, readPurchaseOption } from '../lib/wishlist-row';

interface WishlistKeysClient extends KeysClient {
  /** Keys, [] for "none", or null when no answer came back (lib/keys-client.ts). */
  queryKeys(target: KeysTarget, signal: AbortSignal): Promise<KeyItem[] | null>;
}

interface WishlistPageDeps {
  /** Keys transport seam. Default: the real bus client `createKeysClient(sb)`. */
  keysClient?: WishlistKeysClient;
  /** Email-entry modal seam. Default: the real `openEmailModal`. */
  openEmailModal?: () => Promise<string | null>;
  /** Purchase-error modal seam. Default: the real `openErrorModal`. */
  openErrorModal?: (message: string) => void;
  /** Delay between a DOM mutation and the row rescan, ms. Tests pass 0. */
  scanDelayMs?: number;
  /** Pause before asking again about an app whose lookup got no answer, ms. */
  retryDelayMs?: number;
  /** DOM-change subscription seam; returns the unsubscribe. Default: a
   *  MutationObserver on document.body. Tests drive it by hand because
   *  happy-dom holds an observer's callback through a WeakRef, so it goes
   *  silent after the first GC. */
  watchDom?: (onChange: () => void) => () => void;
}

// childList catches rows mounting/unmounting and columns re-rendering; the
// draggable-id attribute catches a row element React updates IN PLACE for
// another app — without it the old app's chip (and its Buy) would linger there.
function watchBody(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['data-rfd-draggable-id'],
  });
  return () => observer.disconnect();
}

// Coalesces a React commit's burst of mutations into one rescan, while keeping
// the chip's appearance on a freshly scrolled-in row below perception.
const SCAN_DELAY_MS = 50;

// Keys requests in flight at once. There is no batch endpoint (one request per
// app), and a fast scroll renders dozens of rows in passing; on the bus path
// each in-flight request is also re-published every second until answered.
const MAX_IN_FLIGHT = 4;

// A lookup that got no answer (bus timeout — on a cold start checkout's main
// shell may come up after the first round timed out — or a failed fetch) is
// asked again after a pause, a few times at most: a backend that stays down
// isn't asked about every visible row forever. The pause also keeps a DOM
// change from re-asking right away.
const RETRY_DELAY_MS = 10_000;
const MAX_LOOKUPS = 3;

const rowSelectorFor = (appid: number): string => `[data-rfd-draggable-id^="WishlistItem-${appid}-"]`;

export function registerWishlistPage(sb: SbApi, deps: WishlistPageDeps = {}): void {
  const keysClient = deps.keysClient ?? createKeysClient(sb);
  const scanDelayMs = deps.scanDelayMs ?? SCAN_DELAY_MS;
  const retryDelayMs = deps.retryDelayMs ?? RETRY_DELAY_MS;
  const watchDom = deps.watchDom ?? watchBody;
  const mount = createPurchaseMounter(sb, {
    keysClient,
    openEmailModal: deps.openEmailModal,
    openErrorModal: deps.openErrorModal,
  });

  function mountList(ctx: PageContext): () => void {
    const offers = new Map<number, Promise<KeyItem[]>>();
    // App → its lookups that got no answer so far.
    const unanswered = new Map<number, number>();
    // Row element → the app its chip sells + that chip's teardown.
    const chips = new Map<HTMLElement, { appid: number; teardown: () => void }>();
    const pending = new Set<HTMLElement>();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = 0;
    const queue: Array<() => void> = [];

    function schedule(): void {
      if (timer == null && !disposed) timer = setTimeout(scan, scanDelayMs);
    }

    function drain(): void {
      while (inFlight < MAX_IN_FLIGHT && queue.length > 0) queue.shift()!();
    }

    // No answer for this app: [] stands in its cache entry for the pause, then
    // the entry is dropped and a rescan asks again for its row if still shown.
    function retryLater(appid: number): void {
      const n = (unanswered.get(appid) ?? 0) + 1;
      unanswered.set(appid, n);
      if (n >= MAX_LOOKUPS) return;           // give up: [] for the page view
      // schedule() is a no-op once torn down.
      setTimeout(() => { offers.delete(appid); schedule(); }, retryDelayMs);
    }

    // Keys for one app, asked once per page view (again only after no answer,
    // see retryLater) and served from the cache when its row scrolls back in or
    // re-renders. Never rejects.
    function offersFor(appid: number): Promise<KeyItem[]> {
      const cached = offers.get(appid);
      if (cached) return cached;
      let resolve!: (items: KeyItem[]) => void;
      const p = new Promise<KeyItem[]>((r) => { resolve = r; });
      offers.set(appid, p);
      queue.push(() => {
        // Scrolled away while queued: skip, and forget the entry so the row
        // asks again if it comes back.
        if (disposed || !document.querySelector(rowSelectorFor(appid))) {
          offers.delete(appid);
          resolve([]);
          return;
        }
        inFlight++;
        keysClient.queryKeys({ kind: 'app', id: appid }, ctx.signal)
          .catch((): null => null)
          .then((items) => {
            inFlight--;
            if (items == null) retryLater(appid);
            resolve(items ?? []);
            drain();
          });
      });
      drain();
      return p;
    }

    async function handleRow(row: HTMLElement): Promise<void> {
      const appid = readRowAppId(row);
      if (appid == null || pending.has(row)) return;
      const mounted = chips.get(row);
      if (mounted) {
        const chip = row.querySelector<HTMLElement>('.booster-eo');
        if (mounted.appid === appid && chip) {
          // React appends a child it swaps for another type (cart button →
          // «in cart») after our chip; put the chip back at the bottom.
          if (chip.nextElementSibling) chip.parentElement?.appendChild(chip);
          return;
        }
        // React re-rendered the column (chip gone) or reused the row for
        // another app — drop the stale entry and mount afresh.
        mounted.teardown();
        chips.delete(row);
      }
      const col = findPurchaseColumn(row);
      if (!col) return;                       // region-locked / not for sale
      const option = readPurchaseOption(col, appid);
      if (!option) return;                    // can't tell what Steam sells → don't guess
      pending.add(row);
      try {
        const items = await offersFor(appid);
        if (disposed || ctx.signal.aborted || !row.isConnected) return;
        // React re-rendered the row while we waited; the rescan that change
        // triggered skipped this busy row, so look again now.
        if (!row.contains(col) || readRowAppId(row) !== appid) { schedule(); return; }
        // Inactive keys would render a dimmed «Скоро в продаже» chip — noise
        // the list leaves out, and it must not shadow an active duplicate.
        const active = items.filter((i) => i.isActive);
        const item = option.kind === 'bundle' ? findOffer(active, null, option.id) : findOffer(active, option.id, null);
        if (item) chips.set(row, { appid, teardown: mount.appendChip(col, item) });
      } finally {
        pending.delete(row);
      }
    }

    function scan(): void {
      timer = null;
      if (disposed) return;
      // Rows the virtualizer unmounted take their chip with them; forget them.
      for (const [row, m] of chips) if (!row.isConnected) { m.teardown(); chips.delete(row); }
      for (const row of document.querySelectorAll<HTMLElement>(WISHLIST_ROW_SELECTOR)) void handleRow(row);
    }

    const unwatch = watchDom(schedule);
    scan();

    return () => {
      disposed = true;
      unwatch();
      if (timer != null) clearTimeout(timer);
      for (const m of chips.values()) m.teardown();
      chips.clear();
    };
  }

  sb.pages.register({
    name: 'booster-addfunds-wishlist',
    match: { url: /^https:\/\/store\.steampowered\.com\/wishlist\// },
    mount: async (ctx: PageContext) => {
      if (document.readyState === 'loading') {
        await new Promise<void>((r) => document.addEventListener('DOMContentLoaded', () => r(), { once: true, signal: ctx.signal }));
      }
      if (ctx.signal.aborted) return;
      return mountList(ctx);
    },
  });
}
