import type { KeyItem } from './keys-api';
import { readBlockPrice } from './edition-price';

// A real, paid edition/bundle block — the only kind we attach our «СКОРО»
// fallback chip to. Steam reuses `.game_area_purchase_game` for the free demo
// download row ("Загрузить … Demo", tagged `demo_above_purchase`, no subid, no
// price) and for free-to-play / "В библиотеку" rows; none of those should carry
// our chip. Signal: a positive final price in the block (shared reader). Demo /
// free / install rows have none, so they fall out.
export function isPurchasableBlock(block: HTMLElement): boolean {
  if (block.classList.contains('demo_above_purchase')) return false;
  const price = readBlockPrice(block);
  return price != null && price > 0;
}

function toId(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function readBlockSubid(block: HTMLElement): number | null {
  const input = block.querySelector('input[name="subid"]') as HTMLInputElement | null;
  const fromInput = toId(input?.value);
  if (fromInput != null) return fromInput;
  // `[^a-zA-Z]` guard: a bundle block's `addBundleToCart( 42206)` must not be
  // read as a sub id (different id space — see PackageType).
  const m = /(?:^|[^a-zA-Z])addToCart\(\s*(\d+)/.exec(block.innerHTML);
  return m ? toId(m[1]) : null;
}

// Bundle counterpart of readBlockSubid. A bundle purchase row on an /app/ page
// is a `.game_area_purchase_game` like any edition, but carries a BUNDLE id
// instead of a sub id: `<input type="hidden" name="bundleid">` inside its
// `add_bundle_to_cart_<id>` form, an `addBundleToCart( <id>)` cart link, and a
// `data-ds-bundleid` attribute on the enclosing
// `.game_area_purchase_game_wrapper` (CDP-verified on /app/2300320).
export function readBlockBundleId(block: HTMLElement): number | null {
  const input = block.querySelector('input[name="bundleid"]') as HTMLInputElement | null;
  const fromInput = toId(input?.value);
  if (fromInput != null) return fromInput;
  const m = /addBundleToCart\(\s*(\d+)/.exec(block.innerHTML);
  const fromLink = m ? toId(m[1]) : null;
  if (fromLink != null) return fromLink;
  // Wrapper-attribute fallback — only for a block that is not itself a package
  // row, so an edition block nested under a bundle wrapper can never inherit
  // the wrapper's bundle id.
  if (readBlockSubid(block) != null) return null;
  return toId(block.closest('[data-ds-bundleid]')?.getAttribute('data-ds-bundleid'));
}

// Pair each purchase block with the offer that sells exactly that product.
// Matching is id-space aware: a 'bundle' offer may only pair with a block's
// bundle id and a 'package' offer only with its sub id — the two spaces overlap
// numerically, so an id-only match could sell the wrong product. An offer with
// no packageType (pre-bundle backend) keeps the legacy sub-id behaviour.
export function matchItemsToBlocks(
  items: KeyItem[], blocks: HTMLElement[],
): Array<{ block: HTMLElement; item: KeyItem }> {
  const out: Array<{ block: HTMLElement; item: KeyItem }> = [];
  for (const block of blocks) {
    const subid = readBlockSubid(block);
    const bundleId = readBlockBundleId(block);
    if (subid == null && bundleId == null) continue;
    const item = items.find((it) => it.packageId != null && (
      it.packageType === 'bundle' ? it.packageId === bundleId : it.packageId === subid
    ));
    if (item) out.push({ block, item });
  }
  return out;
}
