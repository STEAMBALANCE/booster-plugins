// Canonical keys data shape shared across addfunds UI. The wire fetch lives in
// booster-checkout (main-shell) — see spec "Hard architectural constraint";
// addfunds receives KeyItem[] over sb.bus (see lib/keys-client.ts). checkout
// duplicates this shape in its own bundle — separate IIFEs can't share a type by
// import.
export interface KeyItem {
  itemId: number;
  name: string;
  isActive: boolean;
  regionLabel: string;
  packageId: number | null;
  productType: string | null;
  price: number;        // ₽, float
  oldPrice: number | null;
  discountPercent: number;
}
