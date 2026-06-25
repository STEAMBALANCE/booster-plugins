import type { SbApi } from '@steambalance/booster-framework/api-types';
import { getBoosterHeaders } from './headers';
import { URLS } from '../urls';

export interface KeysOrderResult { ok: boolean; redirectUrl?: string; uid?: string; error?: string }

export async function postKeysOrder(
  sb: SbApi,
  args: { paymentId: string; itemId: number; account: string },
  fetchImpl: typeof fetch = fetch,
): Promise<KeysOrderResult> {
  try {
    const r = await fetchImpl(URLS.steamKeysApi, {
      method: 'POST',
      headers: getBoosterHeaders(sb, 'application/json'),
      body: JSON.stringify({ paymentId: args.paymentId, itemId: args.itemId, account: args.account }),
    });
    const body = await r.json().catch(() => ({})) as Record<string, unknown>;
    const data = (body.data && typeof body.data === 'object') ? body.data as Record<string, unknown> : {};
    const redirectUrl = (typeof data.redirectUrl === 'string' ? data.redirectUrl : undefined)
      ?? (typeof body.redirectUrl === 'string' ? body.redirectUrl : undefined);
    const uid = (typeof data.uid === 'string' ? data.uid : undefined)
      ?? (typeof body.uid === 'string' ? body.uid : undefined);
    if (!r.ok || body.success === false || !redirectUrl) {
      const msg = typeof body.message === 'string' ? body.message : `HTTP ${r.status ?? '?'}`;
      return { ok: false, error: msg };
    }
    return { ok: true, redirectUrl, uid };
  } catch (e) {
    return { ok: false, error: 'network' };
  }
}
