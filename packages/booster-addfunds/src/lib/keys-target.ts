// What the steam-keys list is being asked about. Steam addresses three
// purchasable things under three separate id spaces — an app (`/app/<id>`), a
// package/sub (`/sub/<id>`) and a bundle (`/bundle/<id>`) — and the backend
// takes a different query field for each (`appid` / `sub` / `bundle`). One
// target value carries both facts so every layer between the page module and
// the wire (keys-client → keys-fetch, and the bus hop into booster-checkout)
// passes it through untouched instead of re-deriving it.
//
// NB the field name doubles as the BUS field name: addfunds publishes
// `{ reqId, appid }` / `{ reqId, sub }` / `{ reqId, bundle }` on
// booster-addfunds.keys.request, so an older checkout that only understands
// `appid` keeps working byte-identically for /app/ pages.

export type KeysTargetKind = 'app' | 'sub' | 'bundle';

export interface KeysTarget {
  kind: KeysTargetKind;
  id: number;
}

/** Backend query field (and bus payload field) for a target. */
export function keysTargetParam(target: KeysTarget): 'appid' | 'sub' | 'bundle' {
  return target.kind === 'app' ? 'appid' : target.kind;
}

// Path only — a product path that appears in the query string (`?redir=/sub/1`)
// belongs to some other page and must never be taken for this one's product.
// Falls back to the raw string when `url` isn't absolute, so a bare pathname
// still parses.
function pathOf(url: string): string {
  try { return new URL(url).pathname; } catch { return url; }
}

/** The product a store URL addresses, or null when it addresses none. */
export function parseKeysTarget(url: string): KeysTarget | null {
  const m = /^\/(app|sub|bundle)\/(\d+)/.exec(pathOf(url));
  if (!m) return null;
  const id = parseInt(m[2] as string, 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { kind: m[1] as KeysTargetKind, id };
}
