// No framework imports here yet — the mock uses only a native AbortSignal.
// (Do NOT import ScopeApi from '@steambalance/booster-framework/api-types': it is not
//  re-exported from that subpath and would fail to resolve.)

export interface RegionKey {
  id: string;
  gameName: string;
  discountPercent: number;     // 0 → no badge
  priceRub: number;            // current price, ₽
  originalPriceRub?: number;   // struck-through; omit when no discount
  platform: 'windows';
}

// MOCK. TODO: replace with the real region-keys API endpoint (urls.ts +
// host-allowlist + sb.scope.fetch). The signal is threaded now so the swap is
// mechanical. Returns [] for unknown apps so the caller hides the block.
//
// INTERIM (see lib/coming-soon.ts): the real API isn't wired yet, so we ship an
// EMPTY result — the region keys-block (incl. its title) stays hidden because
// pages/app.ts::mountRegion bails on keys.length === 0. The sample below is
// preserved verbatim for the live swap; restore it (or wire the real fetch) and
// flip KEYS_COMING_SOON when the endpoint lands.
const MOCK: Record<string, RegionKey[]> = {
  default: [
    { id: 'k1', gameName: '007 First Light - Deluxe Edition', discountPercent: 32, priceRub: 1599, originalPriceRub: 2351, platform: 'windows' },
  ],
};

export async function fetchRegionKeys(appId: number, signal: AbortSignal): Promise<RegionKey[]> {
  if (signal.aborted) return [];
  await new Promise<void>((r) => setTimeout(r, 0)); // simulate tiny delay (no Math.random/Date)
  if (signal.aborted) return [];
  void appId;
  void MOCK; // INTERIM: sample preserved for the live swap; not returned yet.
  return []; // INTERIM: API pending — empty result hides the region keys-block.
}

// -- Unified keys API (forward-looking contract) ---------------------------
// Both the region-locked keys block AND the normal-page edition offer are fed
// by ONE endpoint: keys-by-app-id. (We sell keys even for region-blocked games
// -- same data, two presentations.) These types mirror the real response shape.
// TODO(api): when the endpoint is wired, add `fetchKeys(appId, signal):
// Promise<EditionKey[]>` here and migrate BOTH keys-block (off fetchRegionKeys)
// and edition-offer onto it.
export interface EditionKey {
  item_id: number;
  service_short_name: string;   // e.g. 'steam_keys'
  name: string | null;
  edition: string | null;
  product_type: number;
  region_label: string;         // region label data from API (not UI copy)
  price: number;                // our price, whole wallet units
}
export interface KeysResponse {
  success: boolean;
  appid: number;
  store_country: string;        // ISO, e.g. 'RU'
  keys: EditionKey[];
}
