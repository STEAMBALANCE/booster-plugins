// Extract the Steam app id from a store URL. Null when absent/non-numeric.
export function parseAppId(url: string): number | null {
  const m = /\/app\/(\d+)/.exec(url);
  if (!m) return null;
  const n = parseInt(m[1] as string, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}
