// Keys-for-region block (region-locked /app/ pages). Plain DOM, scoped via
// #booster-keys-block. Matches the keys-for-region design from the project
// design system: each row shows the game
// name (left) + a static Windows icon (top-right), with the discount/price/buy
// cluster on a black chip absolutely positioned at the bottom-right, straddling
// the row's bottom edge so it protrudes downward. "Купить" is a no-op stub at
// this stage.
import type { RegionKey } from '../lib/keys-api';
import { LL } from '../i18n';
import { SB_SWIRL_SVG, WINDOWS_SVG } from '../lib/icons';
import { fmtMoney } from '../lib/currency';
import SB_KEYS_CSS_RAW from './keys-block.css' with { type: 'text' };

declare const __SB_KEYS_CSS__: string | undefined;
const SB_KEYS_CSS = typeof __SB_KEYS_CSS__ !== 'undefined' ? __SB_KEYS_CSS__ : SB_KEYS_CSS_RAW;

export function ensureKeysStyles(): void {
  if (document.getElementById('booster-keys-style')) return;
  const s = document.createElement('style');
  s.id = 'booster-keys-style';
  s.textContent = SB_KEYS_CSS;
  document.head.appendChild(s);
}

export function buildKeysBlock(keys: RegionKey[], opts: { logoUrl?: string }): HTMLElement {
  void opts;
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
  for (const k of keys) list.appendChild(buildRow(k));
  root.appendChild(list);
  return root;
}

function buildRow(k: RegionKey): HTMLElement {
  // Layout (per design): the gradient row carries the game name (left) and a
  // static Windows icon (top-right). The price/discount/buy cluster sits on a
  // black chip that is absolutely positioned at the bottom-right, straddling
  // the row's bottom edge (it protrudes ~18px below). CSS owns the positioning;
  // `os` and `actions` are direct children of the row so CSS can place them.
  const row = document.createElement('div');
  row.className = 'booster-keys-row';

  const name = document.createElement('div');
  name.className = 'booster-keys-name';
  name.textContent = LL.addfunds.keys_row_label({ gameName: k.gameName });
  row.appendChild(name);

  const os = document.createElement('span');
  os.className = 'booster-keys-os';
  os.innerHTML = WINDOWS_SVG; // static Windows icon, always shown (top-right)
  row.appendChild(os);

  const actions = document.createElement('div');
  actions.className = 'booster-keys-actions'; // black chip, bottom-right (CSS)

  if (k.discountPercent > 0) {
    const badge = document.createElement('span');
    badge.className = 'booster-keys-discount';
    badge.textContent = `-${k.discountPercent}%`;
    actions.appendChild(badge);
  }

  const price = document.createElement('div');
  price.className = 'booster-keys-prices';
  if (k.originalPriceRub != null && k.originalPriceRub > k.priceRub) {
    const orig = document.createElement('span');
    orig.className = 'booster-keys-orig';
    orig.textContent = fmtMoney(k.originalPriceRub, '₽');
    price.appendChild(orig);
  }
  const cur = document.createElement('span');
  cur.className = 'booster-keys-price';
  cur.textContent = fmtMoney(k.priceRub, '₽');
  price.appendChild(cur);
  actions.appendChild(price);

  const buy = document.createElement('button');
  buy.type = 'button';
  buy.className = 'booster-keys-buy';
  buy.textContent = LL.addfunds.keys_buy_button();
  const buyIcon = document.createElement('span');
  buyIcon.className = 'booster-keys-buy-icon';
  buyIcon.innerHTML = SB_SWIRL_SVG; // SteamBalance mark inside the buy button
  buy.appendChild(buyIcon);
  buy.addEventListener('click', () => { /* no-op stub */ });
  actions.appendChild(buy);

  row.appendChild(actions);
  return row;
}
