// Canonical keys data shape shared across addfunds UI. The wire fetch lives in
// booster-checkout (main-shell) by default — see spec "Hard architectural
// constraint"; addfunds receives KeyItem[] over sb.bus (see lib/keys-client.ts).
// checkout duplicates this shape in its own bundle — separate IIFEs can't share
// a type by import. addfunds ALSO fetches this shape directly via sb.net when
// checkout has broadcast a paymentId (see lib/keys-fetch.ts) — toKeyItem below
// is the parser for that direct path, itself a duplicate of checkout's own
// main/keys-fetch.ts::toKeyItem (same backend response shape).
/** Steam id-space `packageId` belongs to — the backend's `package.type`.
 *  'package' → sub id (`input[name="subid"]`), 'bundle' → bundle id
 *  (`input[name="bundleid"]`). The two spaces overlap numerically, so
 *  edition-match.ts never pairs an offer to a block on the id alone. */
export type PackageType = 'package' | 'bundle';

export interface KeyItem {
  itemId: number;
  name: string;
  isActive: boolean;
  regionLabel: string;
  packageId: number | null;
  /** null = backend sent no `package.type` (pre-bundle backend) → treated as
   *  the sub-id space, the only one that existed back then. */
  packageType: PackageType | null;
  productType: string | null;
  price: number;        // ₽, float
  oldPrice: number | null;
  discountPercent: number;
}

function toPackageType(v: unknown): PackageType | null {
  return v === 'package' || v === 'bundle' ? v : null;
}

export function toKeyItem(raw: unknown): KeyItem | null {
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
