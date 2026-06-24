// booster-plugins/packages/booster-checkout/src/main/payment-methods.ts
//
// Fetch + localStorage cache for the dynamic payments endpoint.
// Stale-while-revalidate: cache has no TTL, the IIFE re-fetches on
// every popup show + at bootstrap. All wire-format validation happens
// here so the popup (which subscribes via the payment-methods BC kind)
// never receives malformed data.
//
// URLs come from the plugin's URLS constant (hardcoded per-plugin;
// URL changes require a new plugin release and sha256 bump in manifest).
// `paymentMethodsApi` (full endpoint URL) and `paymentImagesBase`
// are guaranteed present + non-empty by construction — so this module
// reads them without per-call guards.

import type { SbApi } from '@steambalance/booster-framework/api-types';
import { getBoosterHeaders } from './headers';
import { URLS } from '../urls';

// Mirror of PaymentMethod in popup-svelte/lib/state.svelte.ts. The
// two files can't share a type via import (separate IIFE bundles —
// see headers.ts), so the shape is duplicated. Bridge.ts BC handler
// validates against the same field set, so a drift here is caught
// at the popup boundary.
export interface PaymentMethod {
  type: string;
  name: string;
  imageUrl: string;
  badge?: string;
}

const CACHE_KEY = 'sb:paymentMethods';

// Resolve image URL — passes through absolute (http[s]://, //) URLs;
// for filename-only entries, prefixes with the plugin-configured
// paymentImagesBase (e.g. https://steambalance.cc/assets/images/payments).
export function buildImageUrl(image: string): string {
  if (/^https?:\/\//i.test(image) || image.startsWith('//')) return image;
  return `${URLS.paymentImagesBase}/${image}`;
}

export function readCache(): PaymentMethod[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is PaymentMethod =>
      x !== null && typeof x === 'object'
      && typeof (x as Record<string, unknown>).type === 'string'
      && ((x as Record<string, unknown>).type as string).length > 0
      && typeof (x as Record<string, unknown>).name === 'string'
      && typeof (x as Record<string, unknown>).imageUrl === 'string');
  } catch {
    return [];
  }
}

function writeCache(methods: PaymentMethod[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CACHE_KEY, JSON.stringify(methods));
  } catch {
    // localStorage quota / disabled — silent failure. Methods remain in
    // memory for this session; next boot will re-fetch.
  }
}

export async function fetchPaymentMethods(sb: SbApi): Promise<PaymentMethod[] | null> {
  // URLS.paymentMethodsApi is guaranteed non-empty by construction
  // (hardcoded in urls.ts; URL changes require a new plugin release).
  try {
    const r = await fetch(URLS.paymentMethodsApi, {
      method: 'GET',
      headers: getBoosterHeaders(sb),   // no Content-Type for GET
    });
    if (!r.ok) {
      return null;
    }
    // Narrow defensively via `unknown` — a `as {...}` cast on r.json() lets
    // a malformed body (e.g. backend returns `null` or an array) slip past
    // the type system silently. Guard each field before reading.
    const body = await r.json() as unknown;
    if (body === null || typeof body !== 'object') return null;
    const obj = body as { success?: unknown; data?: unknown };
    if (obj.success !== true || !Array.isArray(obj.data)) return null;
    const dataArr = obj.data as unknown[];
    const methods: PaymentMethod[] = [];
    for (const raw of dataArr) {
      if (raw === null || typeof raw !== 'object') continue;
      const r2 = raw as { type?: unknown; name?: unknown; image?: unknown; badge?: unknown };
      if (typeof r2.type !== 'string' || !r2.type) continue;
      if (typeof r2.name !== 'string') continue;
      if (typeof r2.image !== 'string' || !r2.image) continue;
      const m: PaymentMethod = {
        type: r2.type,
        name: r2.name,
        imageUrl: buildImageUrl(r2.image),
      };
      if (typeof r2.badge === 'string' && r2.badge) m.badge = r2.badge;
      methods.push(m);
    }
    writeCache(methods);
    return methods;
  } catch {
    return null;
  }
}
