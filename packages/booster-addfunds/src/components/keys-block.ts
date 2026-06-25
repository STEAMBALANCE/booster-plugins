// Keys-for-region block (region-locked /app/ pages). Plain DOM, scoped via
// #booster-keys-block. Matches the keys-for-region design from the project design
// system: each row shows the game name (left) + a static Windows icon (top-right)
// + a region label chip, with the discount/price/buy cluster on a black chip
// absolutely positioned at the bottom-right, straddling the row's bottom edge so
// it protrudes downward. Now keys-driven: one row per KeyItem; active rows carry a
// live «Купить» (→ onBuy(item, rowHandle)); inactive rows show "Скоро в продаже".
import type { KeyItem } from '../lib/keys-api';
import { LL } from '../i18n';
import { SB_SWIRL_SVG, WINDOWS_SVG } from '../lib/icons';
import { fmtMoneyKeys } from '../lib/currency';
import SB_KEYS_CSS_RAW from './keys-block.css' with { type: 'text' };

declare const __SB_KEYS_CSS__: string | undefined;
const SB_KEYS_CSS = typeof __SB_KEYS_CSS__ !== 'undefined' ? __SB_KEYS_CSS__ : SB_KEYS_CSS_RAW;

export interface KeyRowHandle {
  setBusy(b: boolean): void;
}

export interface KeysBlockOptions {
  onBuy: (item: KeyItem, row: KeyRowHandle) => void;
  logoUrl?: string;
}

export function ensureKeysStyles(): void {
  if (document.getElementById('booster-keys-style')) return;
  const s = document.createElement('style');
  s.id = 'booster-keys-style';
  s.textContent = SB_KEYS_CSS;
  document.head.appendChild(s);
}

export function buildKeysBlock(items: KeyItem[], opts: KeysBlockOptions): HTMLElement {
  void opts.logoUrl;
  const root = document.createElement('div');
  root.id = 'booster-keys-block';
  root.setAttribute('data-sb', '1');
  root.setAttribute('aria-label', LL.addfunds.keys_block_aria_label());

  const title = document.createElement('div');
  title.className = 'booster-keys-title';
  title.textContent = LL.addfunds.keys_block_title();
  root.appendChild(title);

  const list = document.createElement('div');
  list.className = 'booster-keys-list';
  for (const item of items) list.appendChild(buildRow(item, opts.onBuy));
  root.appendChild(list);
  return root;
}

function buildRow(item: KeyItem, onBuy: (item: KeyItem, row: KeyRowHandle) => void): HTMLElement {
  // Layout (per design): the gradient row carries the game name + region chip
  // (left) and a static Windows icon (top-right). The price/discount/buy cluster
  // sits on a black chip that is absolutely positioned at the bottom-right,
  // straddling the row's bottom edge. CSS owns the positioning.
  const inactive = item.isActive === false;

  const row = document.createElement('div');
  row.className = 'booster-keys-row';
  if (inactive) row.classList.add('booster-keys-row--inactive');

  const head = document.createElement('div');
  head.className = 'booster-keys-head';
  const name = document.createElement('div');
  name.className = 'booster-keys-name';
  name.textContent = LL.addfunds.keys_row_label({ gameName: item.name });
  head.appendChild(name);
  if (item.regionLabel) {
    const region = document.createElement('span');
    region.className = 'booster-keys-region';
    region.textContent = item.regionLabel;
    head.appendChild(region);
  }
  row.appendChild(head);

  const os = document.createElement('span');
  os.className = 'booster-keys-os';
  os.innerHTML = WINDOWS_SVG; // static Windows icon, always shown (top-right)
  row.appendChild(os);

  const actions = document.createElement('div');
  actions.className = 'booster-keys-actions'; // black chip, bottom-right (CSS)

  let buy: HTMLButtonElement | null = null;

  if (inactive) {
    // Inactive row: "Скоро в продаже" label, no price, no buy.
    const soon = document.createElement('span');
    soon.className = 'booster-keys-inactive-label';
    soon.textContent = LL.addfunds.keys_item_coming_soon();
    actions.appendChild(soon);
  } else {
    if (item.discountPercent > 0) {
      const badge = document.createElement('span');
      badge.className = 'booster-keys-discount';
      badge.textContent = `-${item.discountPercent}%`;
      actions.appendChild(badge);
    }

    const price = document.createElement('div');
    price.className = 'booster-keys-prices';
    if (item.oldPrice != null && item.oldPrice > item.price) {
      const orig = document.createElement('span');
      orig.className = 'booster-keys-orig';
      orig.textContent = fmtMoneyKeys(item.oldPrice);
      price.appendChild(orig);
    }
    const cur = document.createElement('span');
    cur.className = 'booster-keys-price';
    cur.textContent = fmtMoneyKeys(item.price);
    price.appendChild(cur);
    actions.appendChild(price);

    buy = document.createElement('button');
    buy.type = 'button';
    buy.className = 'booster-keys-buy';
    buy.textContent = LL.addfunds.keys_buy_button();
    const buyIcon = document.createElement('span');
    buyIcon.className = 'booster-keys-buy-icon';
    buyIcon.innerHTML = SB_SWIRL_SVG; // SteamBalance mark inside the buy button
    buy.appendChild(buyIcon);
    const handle: KeyRowHandle = {
      setBusy(b: boolean): void { if (buy) { buy.disabled = b; buy.classList.toggle('booster-keys-buy--busy', b); } },
    };
    buy.addEventListener('click', () => onBuy(item, handle));
    actions.appendChild(buy);
  }

  row.appendChild(actions);
  return row;
}
