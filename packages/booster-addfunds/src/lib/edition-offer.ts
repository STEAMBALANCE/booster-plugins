// View-model + provider for the normal-page edition offer chip. The real keys
// API (see EditionKey/KeysResponse in keys-api.ts) will supply our price per
// variant; until then this MOCK derives our price from the on-page Steam price.
// steamPrice ALWAYS comes from the DOM (it is Steam's price, not ours), so the
// discount percent is computed identically in mock and real modes.

export interface EditionOffer {
  ourPrice: number;        // "now"
  steamPrice: number;      // "was" (struck) -- from DOM
  discountPercent: number; // max(0, round((steamPrice-ourPrice)/steamPrice*100))
  currencySymbol: string;
}

// Single mock knob: sets ourPrice ONLY, never the displayed badge.
const MOCK_DISCOUNT_PCT = 32;

export async function getEditionOffer(
  appId: number,
  steamPrice: number,
  currencySymbol: string,
  signal: AbortSignal,
): Promise<EditionOffer | null> {
  if (signal.aborted || steamPrice <= 0) return null;
  await new Promise<void>((r) => setTimeout(r, 0)); // seam: stands in for await fetch (no Math.random/Date)
  if (signal.aborted) return null;
  void appId; // TODO(api): const k = (await fetchKeys(appId, signal))[0]; ourPrice = k.price;
  const ourPrice = Math.round(steamPrice * (1 - MOCK_DISCOUNT_PCT / 100));
  // ALWAYS derive the badge from the two numbers actually shown; clamp >= 0 so a
  // real-API ourPrice >= steamPrice yields no badge (component hides it at 0).
  const discountPercent = Math.max(0, Math.round(((steamPrice - ourPrice) / steamPrice) * 100));
  return { ourPrice, steamPrice, discountPercent, currencySymbol };
}
