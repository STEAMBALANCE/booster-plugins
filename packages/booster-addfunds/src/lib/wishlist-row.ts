// Readers for one row of Steam's wishlist (`store.steampowered.com/wishlist/…`).
//
// The wishlist is a React app with build-hashed class names, so nothing here
// keys off a class. Three anchors, all CDP-verified on the live page
// (2026-11-01):
//
//   - the row: react-beautiful-dnd's `data-rfd-draggable-id="WishlistItem-<appid>-<n>"`
//     (the list is drag-sortable) — the app id rides in it;
//   - the purchase column: the row grid's NAMED area `purchase` (Steam's CSS:
//     grid-template-areas "dragger capsule title remove" / "… mid mid" /
//     "… lower purchase") — it holds Steam's price + «Добавить в корзину»;
//   - the purchase option: React props. The row's StoreItem carries
//     `best_purchase_option` — the exact package (or bundle) Steam's own button
//     adds to the cart. It is NOT in the DOM, so it is read off the React fiber
//     React leaves on every host node (`__reactFiber$<rand>`). Field names are
//     the IStoreBrowseService StoreItem protobuf's, not minified identifiers.
//
// Every reader returns null when its anchor is missing — the page module then
// mounts nothing rather than guess which product a row sells.

export const WISHLIST_ROW_SELECTOR = '[data-rfd-draggable-id^="WishlistItem-"]';

/** What Steam's own button in a row sells: a sub (package) or a bundle. */
export interface PurchaseOption {
  kind: 'package' | 'bundle';
  id: number;
}

function toId(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
}

export function readRowAppId(row: HTMLElement): number | null {
  const m = /^WishlistItem-(\d+)-/.exec(row.getAttribute('data-rfd-draggable-id') ?? '');
  return m ? toId(m[1]) : null;
}

// Grid items sit a level or two under the row (row → panel → areas); the bound
// keeps the scan to a handful of getComputedStyle calls per row.
const PURCHASE_AREA_MAX_DEPTH = 3;

function gridAreaName(el: HTMLElement): string {
  // Chrome reports a named area as "purchase"; the longhand form
  // ("purchase / purchase / …") is normalized to its first part.
  return (getComputedStyle(el).gridArea ?? '').split('/')[0]!.trim();
}

/** The row's purchase column — Steam's price + cart cluster lives in it. */
export function findPurchaseColumn(row: HTMLElement): HTMLElement | null {
  let level: HTMLElement[] = [row];
  for (let depth = 0; depth < PURCHASE_AREA_MAX_DEPTH; depth++) {
    level = level.flatMap((el) => [...el.children] as HTMLElement[]);
    const hit = level.find((el) => gridAreaName(el) === 'purchase');
    if (hit) return hit;
  }
  return null;
}

// From the purchase column's own fiber the row component holding `item` is one
// level up today; the bound leaves room for a wrapper or two without walking
// into unrelated ancestors.
const FIBER_MAX_DEPTH = 12;

interface Fiber { memoizedProps?: unknown; return?: Fiber | null; alternate?: Fiber | null }

function fiberOf(el: HTMLElement): Fiber | null {
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  return key ? ((el as unknown as Record<string, Fiber>)[key] ?? null) : null;
}

// A StoreItem for this app with a usable best_purchase_option → that option.
function optionOf(v: unknown, appid: number): PurchaseOption | null {
  if (!v || typeof v !== 'object') return null;
  const item = v as { appid?: unknown; id?: unknown; best_purchase_option?: unknown };
  if (toId(item.appid) !== appid && toId(item.id) !== appid) return null;
  const o = item.best_purchase_option as { packageid?: unknown; bundleid?: unknown } | null | undefined;
  if (!o || typeof o !== 'object') return null;
  const pkg = toId(o.packageid);
  if (pkg != null) return { kind: 'package', id: pkg };
  const bundle = toId(o.bundleid);
  return bundle != null ? { kind: 'bundle', id: bundle } : null;
}

function optionInProps(fiber: Fiber | null | undefined, appid: number): PurchaseOption | null {
  const props = fiber?.memoizedProps;
  if (!props || typeof props !== 'object') return null;
  for (const v of Object.values(props as Record<string, unknown>)) {
    const opt = optionOf(v, appid);
    if (opt) return opt;
  }
  return null;
}

/** What Steam's button under `from` (the purchase column) sells for `appid`. */
export function readPurchaseOption(from: HTMLElement, appid: number): PurchaseOption | null {
  let fiber = fiberOf(from);
  for (let depth = 0; fiber && depth < FIBER_MAX_DEPTH; depth++, fiber = fiber.return ?? null) {
    // React stamps a node with the fiber it was created with and never
    // re-points it, while every update flips which half of the
    // current/alternate pair is live. So after every other update the stamped
    // chain is stale — a row React reused for another app still describes the
    // previous one there. Read both halves; the appid check keeps the right one.
    const opt = optionInProps(fiber, appid) ?? optionInProps(fiber.alternate, appid);
    if (opt) return opt;
  }
  return null;
}
