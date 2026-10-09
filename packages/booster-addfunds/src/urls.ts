// Business-facing URLs owned by this plugin. Per project convention plugins
// hardcode their own URLs here; framework code never hardcodes URLs.
//
// The front-end ORIGIN is build-parameterised so a dev-channel release can
// point the plugin at a test front-end without that host appearing as a
// literal in the repo (`release.ts --front-url <url>`). Absent an override
// every constant below resolves byte-identically to production.

// Injected by build.ts via bun's `define`. Declared (not imported) because
// the identifier does not exist outside a bundled build — the `typeof`
// guard below keeps that from throwing.
declare const __SB_FRONT_ORIGIN__: string | undefined;

/** Production front-end. The default for every build that passes no override. */
const PROD_FRONT_ORIGIN = 'https://steambalance.cc';

function resolveFrontOrigin(): string {
  // Bundled path — bun's `define` substitutes a string literal here.
  const fromDefine =
    typeof __SB_FRONT_ORIGIN__ === 'string' ? __SB_FRONT_ORIGIN__ : '';
  // Non-bundled path — build.ts (feeding the define) and plugin-meta.ts
  // (allowedHosts) import this module in the Bun runtime, where release.ts
  // has exported SB_FRONT_URL.
  const fromEnv =
    typeof process !== 'undefined' ? (process.env?.['SB_FRONT_URL'] ?? '') : '';
  return (fromDefine || fromEnv || PROD_FRONT_ORIGIN).replace(/\/+$/, '');
}

/** Origin (scheme + host) every business URL below is built from. */
export const FRONT_ORIGIN = resolveFrontOrigin();

/** Bare host of FRONT_ORIGIN — must reach the signed manifest's
 *  `allowedHosts` or every sb.net call fails the native host gate
 *  (see plugin-meta.ts). */
export const FRONT_HOST = new URL(FRONT_ORIGIN).host;

/** SteamBalance games catalog, opened in the main Steam window from the
 *  catalog item injected into Steam's store supernav dropdown (main context,
 *  main/install.ts). */
export const STORE_MENU_CATALOG_URL = `${FRONT_ORIGIN}/c/e6c5`;

/** SteamBalance games catalog, opened from the persistent catalog button in the
 *  Steam store page top-nav bar (page context, pages/catalog-nav.ts). */
export const STORE_NAV_CATALOG_URL = `${FRONT_ORIGIN}/c/a3bd`;

/** Backend endpoint for the region-games carousel, fetched via sb.net. */
export const CATALOGUE_API = `${FRONT_ORIGIN}/api/booster/catalogue`;

/** Promo link opened when the region-games carousel background is clicked. */
export const REGION_GAMES_PROMO_URL = `${FRONT_ORIGIN}/c/5533`;

/** Steam-keys list endpoint, fetched directly via sb.net once checkout has
 *  broadcast paymentId + storeCountry (see lib/keys-config.ts). Same
 *  endpoint booster-checkout's main-shell fetches for the bus fallback. */
export const STEAM_KEYS_API = `${FRONT_ORIGIN}/api/services/steam_keys`;
