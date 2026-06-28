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

export function readBlockSubid(block: HTMLElement): number | null {
  const input = block.querySelector('input[name="subid"]') as HTMLInputElement | null;
  if (input && input.value) { const n = Number(input.value); if (Number.isInteger(n) && n > 0) return n; }
  const m = /addToCart\((\d+)\)/.exec(block.innerHTML);
  if (m) { const n = Number(m[1]); if (Number.isInteger(n) && n > 0) return n; }
  return null;
}

export function matchItemsToBlocks(
  items: KeyItem[], blocks: HTMLElement[],
): Array<{ block: HTMLElement; item: KeyItem }> {
  const out: Array<{ block: HTMLElement; item: KeyItem }> = [];
  for (const block of blocks) {
    const subid = readBlockSubid(block);
    if (subid == null) continue;
    const item = items.find((it) => it.packageId === subid);
    if (item) out.push({ block, item });
  }
  return out;
}
