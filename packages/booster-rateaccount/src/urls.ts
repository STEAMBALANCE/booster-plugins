// Business-facing URL owned by this plugin. Per project convention plugins
// hardcode their own URLs here; framework code never hardcodes URLs.
//
// The front-end ORIGIN is build-parameterised so a dev-channel release can
// point the plugin at a test front-end without that host appearing as a
// literal in the repo (`release.ts --front-url <url>`). Absent an override
// the constant below resolves byte-identically to production.

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
  // Non-bundled path — build.ts imports this module in the Bun runtime,
  // where release.ts has exported SB_FRONT_URL.
  const fromEnv =
    typeof process !== 'undefined' ? (process.env?.['SB_FRONT_URL'] ?? '') : '';
  return (fromDefine || fromEnv || PROD_FRONT_ORIGIN).replace(/\/+$/, '');
}

/** Origin (scheme + host) the URL below is built from. */
export const FRONT_ORIGIN = resolveFrontOrigin();

export const RATE_ACCOUNT_URL = `${FRONT_ORIGIN}/c/3f4d`;
