/**
 * SteamBalance booster business URLs, owned and hardcoded by the checkout
 * plugin (allowed here per the URLs convention; plugins own their own URL
 * constants). The retired manifest v1 `urls` block no longer carries these.
 *
 * Changing a URL requires a new plugin release and a sha256 bump in the
 * manifest. If you fork this plugin for a different backend, change these.
 *
 * The front-end ORIGIN is build-parameterised so a dev-channel release can
 * point the whole plugin at a test front-end without a literal of that host
 * living in the repo (`release.ts --front-url <url>`, see
 * booster-injector/docs/release-pipeline.md § Dev-канал). Absent any
 * override every constant below resolves byte-identically to production.
 */

// Injected by build.ts via bun's `define`. Declared (not imported) because
// the identifier does not exist outside a bundled build — the `typeof`
// guard in resolveFrontOrigin keeps that from throwing.
declare const __SB_FRONT_ORIGIN__: string | undefined;

/** Production front-end. The default for every build that passes no override. */
const PROD_FRONT_ORIGIN = 'https://steambalance.cc';

function resolveFrontOrigin(): string {
  // Bundled path — bun's `define` substitutes a string literal here.
  const fromDefine =
    typeof __SB_FRONT_ORIGIN__ === 'string' ? __SB_FRONT_ORIGIN__ : '';
  // Non-bundled path — this module is also imported by build.ts (to feed the
  // define) and by plugin-meta.ts (allowedHosts), both of which run in the
  // Bun runtime where release.ts has exported SB_FRONT_URL.
  const fromEnv =
    typeof process !== 'undefined' ? (process.env?.['SB_FRONT_URL'] ?? '') : '';
  return (fromDefine || fromEnv || PROD_FRONT_ORIGIN).replace(/\/+$/, '');
}

/** Origin (scheme + host) every business URL below is built from. */
export const FRONT_ORIGIN = resolveFrontOrigin();

/** Bare host of FRONT_ORIGIN — the value that must reach the signed
 *  manifest's `allowedHosts` for sb.net calls to pass the native gate
 *  (see plugin-meta.ts). */
export const FRONT_HOST = new URL(FRONT_ORIGIN).host;

export const URLS = {
  paymentMethodsApi:  `${FRONT_ORIGIN}/api/payments`,
  balanceCalcApi:     `${FRONT_ORIGIN}/api/balance/calc`,
  balanceAddApi:      `${FRONT_ORIGIN}/api/balance/add`,
  orders:             `${FRONT_ORIGIN}/booster/orders`,
  catalog:            `${FRONT_ORIGIN}/c/b810`,
  faq:                `${FRONT_ORIGIN}/booster/faq`,
  terms:              `${FRONT_ORIGIN}/booster/terms`,
  privacy:            `${FRONT_ORIGIN}/booster/privacy`,
  telegram:           `${FRONT_ORIGIN}/c/0eb9`,
  paymentImagesBase:  `${FRONT_ORIGIN}/assets/images/payments`,
  // Logo click-through link (brand site home). NOT the image source —
  // the popup renders the logo from a build-time data-URI (IMG_LOGO_DATA_URI).
  popupLogoLink:      FRONT_ORIGIN,
  // Jivo is an external chat service, not part of the front-end: it does NOT
  // follow --front-url. Override it separately if a dev channel ever needs
  // its own support channel.
  support:            'https://jivo.chat/OdRu6JcBYZ',
  about:              FRONT_ORIGIN,
  steamKeysApi:       `${FRONT_ORIGIN}/api/services/steam_keys`,
} as const;
