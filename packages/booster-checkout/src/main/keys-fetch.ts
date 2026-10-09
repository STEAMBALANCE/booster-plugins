import type { SbApi } from '@steambalance/booster-framework/api-types';
import { URLS } from '../urls';

/** Steam id-space `packageId` belongs to — the backend's `package.type`.
 *  'package' → sub id (`input[name="subid"]`), 'bundle' → bundle id
 *  (`input[name="bundleid"]`). The two spaces overlap numerically, so a
 *  consumer must never match on the id alone. */
export type PackageType = 'package' | 'bundle';

export interface KeyItem {
  itemId: number;
  name: string;
  isActive: boolean;
  regionLabel: string;
  packageId: number | null;
  /** null = backend sent no `package.type` (pre-bundle backend) → consumers
   *  treat the id as a sub id, the only space that existed back then. */
  packageType: PackageType | null;
  productType: string | null;
  price: number;
  oldPrice: number | null;
  discountPercent: number;
}

function toPackageType(v: unknown): PackageType | null {
  return v === 'package' || v === 'bundle' ? v : null;
}

function toKeyItem(raw: unknown): KeyItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'number' || typeof r.price !== 'number') return null;
  const pkg = (r.package && typeof r.package === 'object') ? r.package as Record<string, unknown> : null;
  return {
    itemId: r.id,
    name: typeof r.name === 'string' ? r.name : '',
    isActive: r.is_active === true,
    regionLabel: typeof r.region_label === 'string' ? r.region_label : '',
    packageId: pkg && typeof pkg.id === 'number' ? pkg.id : null,
    packageType: pkg ? toPackageType(pkg.type) : null,
    productType: pkg && typeof pkg.product_type === 'string' ? pkg.product_type : null,
    price: r.price,
    oldPrice: typeof r.old_price === 'number' ? r.old_price : null,
    discountPercent: typeof r.discount_percent === 'number' ? r.discount_percent : 0,
  };
}

// What the keys list is being asked about. Steam addresses three purchasable
// things under three separate id spaces, and the backend takes a different query
// field for each. Mirrors booster-addfunds' lib/keys-target.ts — separate IIFE
// bundles cannot share a type by import.
export type KeysTargetKind = 'app' | 'sub' | 'bundle';

export interface KeysTarget {
  kind: KeysTargetKind;
  id: number;
}

/** Backend query field (and bus payload field) for a target. */
export function keysTargetParam(target: KeysTarget): 'appid' | 'sub' | 'bundle' {
  return target.kind === 'app' ? 'appid' : target.kind;
}

// Read the target out of a booster-addfunds.keys.request payload. Field order is
// the precedence order; a payload naming no id space at all is not answerable
// and yields null (the bridge then ignores the request).
export function readKeysTarget(d: Record<string, unknown>): KeysTarget | null {
  const fields = [['appid', 'app'], ['sub', 'sub'], ['bundle', 'bundle']] as const;
  for (const [field, kind] of fields) {
    const v = d[field];
    if (typeof v === 'number' && Number.isInteger(v) && v > 0) return { kind, id: v };
  }
  return null;
}

export async function fetchKeys(
  sb: SbApi,
  args: { target: KeysTarget; paymentId: string; storeCountry?: string },
): Promise<KeyItem[]> {
  try {
    // One query field per Steam id space — see KeysTarget above.
    const q = new URLSearchParams({ paymentId: args.paymentId, [keysTargetParam(args.target)]: String(args.target.id) });
    if (args.storeCountry) q.set('store_country', args.storeCountry);
    const r = await sb.net.fetch(`${URLS.steamKeysApi}?${q.toString()}`, { method: 'GET' });
    if (!r.ok) return [];
    const body = await r.json() as unknown;
    const items = (body as { data?: { items?: unknown } })?.data?.items;
    if (!Array.isArray(items)) return [];
    return items.map(toKeyItem).filter((x): x is KeyItem => x !== null);
  } catch { return []; }
}
