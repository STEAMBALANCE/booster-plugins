// URL composition helpers — extracted from src/index.ts for
// direct unit testing. Pure functions, no side effects, no globals.

/**
 * Build the orders URL: appends each stored order uid as a repeated
 * `uid[]` query param (URLSearchParams encodes the brackets — backends
 * like PHP/Laravel/Express(qs) decode `uid%5B%5D` into an array). Uses
 * the URL object so any pre-existing query in the base is preserved.
 */
export function buildOrdersUrl(baseUrl: string, uids: readonly string[]): string {
  const u = new URL(baseUrl);
  for (const id of uids) u.searchParams.append('uid[]', id);
  return u.toString();
}

/**
 * Build the support URL: takes the base Jivo chat URL and tags it with
 * the booster's 5-UTM scheme so support dashboards can slice traffic by
 * app build, Steam client build, and host OS.
 *
 *   utm_source   = desktop_app
 *   utm_medium   = support
 *   utm_campaign = app_<app version>
 *   utm_content  = steam_<steam client version>
 *   utm_term     = os_<OS version>
 *
 * Empty / missing dimension → `unknown` so the slot stays present (Jivo
 * loses the dimension entirely if the param is absent). Versions are
 * sourced by env-info.ts — see that module for resolution order
 * (manifest prefix + navigator.userAgent + UA Client Hints).
 */
export function buildSupportUrl(
  baseUrl: string,
  env: { appVersion: string; steamVersion: string; osVersion: string },
): string {
  const u = new URL(baseUrl);
  u.searchParams.set('utm_source',   'desktop_app');
  u.searchParams.set('utm_medium',   'support');
  u.searchParams.set('utm_campaign', 'app_'   + (env.appVersion   || 'unknown'));
  u.searchParams.set('utm_content',  'steam_' + (env.steamVersion || 'unknown'));
  u.searchParams.set('utm_term',     'os_'    + (env.osVersion    || 'unknown'));
  return u.toString();
}
