import type { KeyItem } from './keys-api';

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
