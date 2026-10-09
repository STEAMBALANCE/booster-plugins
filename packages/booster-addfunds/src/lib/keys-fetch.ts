// Direct sb.net fetch of the steam-keys list — mirrors booster-checkout's
// main/keys-fetch.ts::fetchKeys byte-for-byte (same endpoint, same query
// shape, same never-throw contract). Used by lib/keys-client.ts's requestKeys
// when checkout has broadcast a usable paymentId (lib/keys-config.ts);
// otherwise the bus round-trip (requestKeysViaBus) stays the source of truth.
import type { SbApi } from '@steambalance/booster-framework/api-types';
import { STEAM_KEYS_API } from '../urls';
import { keysTargetParam, type KeysTarget } from './keys-target';
import { toKeyItem, type KeyItem } from './keys-api';

export async function fetchKeysDirect(
  sb: SbApi,
  args: { target: KeysTarget; paymentId: string; storeCountry?: string | null },
  signal?: AbortSignal,
): Promise<KeyItem[]> {
  try {
    // One query field per Steam id space — `appid` / `sub` / `bundle`; see
    // lib/keys-target.ts. Sending the wrong one returns the wrong product's keys.
    const q = new URLSearchParams({ paymentId: args.paymentId, [keysTargetParam(args.target)]: String(args.target.id) });
    if (args.storeCountry) q.set('store_country', args.storeCountry);
    const r = await sb.net.fetch(`${STEAM_KEYS_API}?${q.toString()}`, { method: 'GET', ...(signal ? { signal } : {}) });
    if (!r.ok) return [];
    const body = await r.json() as unknown;
    const items = (body as { data?: { items?: unknown } })?.data?.items;
    if (!Array.isArray(items)) return [];
    return items.map(toKeyItem).filter((x): x is KeyItem => x !== null);
  } catch { return []; }
}
