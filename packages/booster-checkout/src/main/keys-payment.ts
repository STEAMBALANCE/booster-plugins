// Resolve the paymentId keys uses: the first usable /api/payments method (СБП).
// IMPORTANT: our requests carry the x-booster header (getBoosterHeaders), so the
// backend returns the BOOSTERED shape {type,name,image} — same shape the topup
// fetchPaymentMethods parses — NOT the un-boostered {value,can_pay_services,
// disabled}. We accept either id field (`type` boostered, `value` un-boostered)
// and skip only explicitly-disabled / can_pay_services===false entries.
// localStorage SWR cache, same pattern as main/payment-methods.ts (guarded on
// typeof localStorage).
import type { SbApi } from '@steambalance/booster-framework/api-types';
import { getBoosterHeaders } from './headers';
import { URLS } from '../urls';

const CACHE_KEY = 'sb:keysPaymentId';

function readCache(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const v = localStorage.getItem(CACHE_KEY);
    return typeof v === 'string' && v ? v : null;
  } catch { return null; }
}
function writeCache(value: string): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(CACHE_KEY, value); } catch { /* quota/disabled — in-memory only this session */ }
}

async function fetchPaymentId(sb: SbApi, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const r = await fetchImpl(URLS.paymentMethodsApi, { method: 'GET', headers: getBoosterHeaders(sb) });
    if (!r.ok) return null;
    const body = await r.json() as unknown;
    if (body === null || typeof body !== 'object') return null;
    const data = (body as { data?: unknown }).data;
    if (!Array.isArray(data)) return null;
    for (const raw of data) {
      if (!raw || typeof raw !== 'object') continue;
      const e = raw as { type?: unknown; value?: unknown; can_pay_services?: unknown; disabled?: unknown };
      const id = (typeof e.type === 'string' && e.type) ? e.type
               : (typeof e.value === 'string' && e.value) ? e.value : '';
      if (!id) continue;
      if (e.disabled === true) continue;
      if (e.can_pay_services === false) continue;  // only present in the un-boostered shape
      return id;  // first usable method = СБП
    }
    return null;
  } catch { return null; }
}

export async function resolveKeysPaymentId(sb: SbApi, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  // SWR: warm cache → return now + refresh in the background; cold → await fetch.
  const cached = readCache();
  const refresh = fetchPaymentId(sb, fetchImpl).then((v) => { if (v) writeCache(v); return v; });
  if (cached) { void refresh; return cached; }
  return await refresh;
}
