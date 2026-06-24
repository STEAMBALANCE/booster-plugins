// Cross-IIFE parity for getBoosterHeaders — Content-Type (CRLF defense).
// Both copies MUST stay identical across the main IIFE and the popup IIFE:
// a smuggled \r\n in contentType is the same threat regardless of which
// copy is composing the request.
//
// **Version-source parity is intentionally NOT asserted here.** After
// D.9 the two copies sit in different V8 contexts:
//   - main IIFE reads __SB_PLUGINS_MANIFEST__ (C++-injected) + sb.version.
//   - popup IIFE reads bun-define-substituted constants baked at build.
// Diverging the version sourcing is a deliberate architectural split —
// see comments at the top of src/main/headers.ts. Per-copy version
// resolution is unit-tested independently (tests/headers.test.ts +
// popup-svelte/__tests__/headers.test.ts).

import { test, expect, beforeEach, afterEach } from 'bun:test';
import type { SbApi } from '@steambalance/booster-framework/api-types';

// Lazy-load both module copies so test bodies decide per-case which
// signature each takes (main IIFE takes `sb`, popup IIFE doesn't).
async function loadMain(): Promise<{
  getBoosterHeaders: (sb: SbApi, contentType?: string) => Record<string, string>;
}> {
  return import('../src/main/headers');
}
async function loadPopup(): Promise<{
  getBoosterHeaders: (contentType?: string) => Record<string, string>;
}> {
  return import('../popup-svelte/lib/headers');
}

function sbStub(version = '4.5.6'): SbApi {
  return { version } as unknown as SbApi;
}

// These tests fabricate a complete `window` per case (each test sets the
// fields it needs and the others must be absent). Unlike `headers.test.ts`
// — which preserves the host environment's `window` and only touches its
// `__SB_*_*` properties — here we delete the whole object between cases so
// state from one case can never leak into the next via shared property
// initialisation order.
beforeEach(() => { delete (globalThis as any).window; });
afterEach(()  => { delete (globalThis as any).window; });

// ── Content-Type CRLF defense — both copies must drop ───────────────────

test('parity: both getBoosterHeaders drop CR/LF in contentType', async () => {
  const main  = await loadMain();
  const popup = await loadPopup();
  const hMain  = main.getBoosterHeaders(sbStub(),  'text/plain\r\nX-Injected: yes');
  const hPopup = popup.getBoosterHeaders('text/plain\r\nX-Injected: yes');
  expect(hMain['Content-Type']).toBeUndefined();
  expect(hPopup['Content-Type']).toBeUndefined();
});

test('parity: both getBoosterHeaders accept clean contentType', async () => {
  const main  = await loadMain();
  const popup = await loadPopup();
  const hMain  = main.getBoosterHeaders(sbStub(),  'application/json');
  const hPopup = popup.getBoosterHeaders('application/json');
  expect(hMain['Content-Type']).toBe('application/json');
  expect(hPopup['Content-Type']).toBe('application/json');
});

