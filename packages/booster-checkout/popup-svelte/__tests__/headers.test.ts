// booster-plugins/packages/booster-checkout/popup-svelte/__tests__/headers.test.ts
//
// Tests for the popup-IIFE getBoosterHeaders. The plugin's OWN version is
// a build-time define (__SB_PLUGIN_VERSION__); injector + framework
// versions arrive at RUNTIME via window.__SB_BOOSTER_VERSIONS__ (set by
// bridge.ts from the BC init message). The popup has no access to the
// C++-injected __SB_PLUGINS_MANIFEST__ global or the framework `sb`
// instance, so this runtime channel is the only stack-version source.

import { test, expect, beforeEach } from 'bun:test';
import { getBoosterHeaders } from '../lib/headers';

// beforeEach seeds the plugin-version define on globalThis (so the
// `typeof __SB_PLUGIN_VERSION__` guard resolves to the seed) and a fresh
// `window` carrying the runtime injector/framework versions — mirroring
// what bridge.ts writes on the init message. Production substitutes the
// plugin define at build time via Bun.build({define:…}); this seam
// keeps the test self-contained and cwd-independent.
beforeEach(() => {
  (globalThis as any).__SB_PLUGIN_VERSION__ = '0.0.0-dev';
  (globalThis as any).window = {
    __SB_BOOSTER_VERSIONS__: { injector: '0.0.0-dev', framework: '0.0.0-dev' },
  };
});

test('plugin define + runtime versions resolve to all three version headers', () => {
  const h = getBoosterHeaders();
  expect(h['x-booster']).toBe('true');
  expect(h['x-booster-injector']).toBe('0.0.0-dev');
  expect(h['x-booster-framework']).toBe('0.0.0-dev');
  expect(h['x-booster-plugins']).toBe('booster-checkout@0.0.0-dev');
});

test('per-call re-resolution: a runtime injector-version change is honoured', () => {
  // headers.ts re-reads window.__SB_BOOSTER_VERSIONS__ on every call, so
  // a version that lands after module init (the init BC message arrives
  // asynchronously) is picked up without re-importing.
  (globalThis as any).window.__SB_BOOSTER_VERSIONS__.injector = '9.9.9';
  const h = getBoosterHeaders();
  expect(h['x-booster-injector']).toBe('9.9.9');
});

test('empty version values omit the corresponding header', () => {
  (globalThis as any).window.__SB_BOOSTER_VERSIONS__ = { injector: '', framework: '' };
  (globalThis as any).__SB_PLUGIN_VERSION__ = '';
  const h = getBoosterHeaders();
  expect(h['x-booster']).toBe('true');
  expect(h['x-booster-injector']).toBeUndefined();
  expect(h['x-booster-framework']).toBeUndefined();
  expect(h['x-booster-plugins']).toBeUndefined();
});

test('cold-start window (no __SB_BOOSTER_VERSIONS__ yet) omits stack-version headers', () => {
  // Before the init BC message lands the popup has no stack versions. The
  // plugin-version header still emits from the baked define.
  (globalThis as any).window = {};
  const h = getBoosterHeaders();
  expect(h['x-booster-injector']).toBeUndefined();
  expect(h['x-booster-framework']).toBeUndefined();
  expect(h['x-booster-plugins']).toBe('booster-checkout@0.0.0-dev');
});

test('omits x-booster-injector/framework when the runtime version contains CRLF', () => {
  // injector/framework now arrive over the untrusted BC realm, so a
  // smuggled \r\n must drop the header rather than forge an extra one —
  // defense in depth matching the C++ MakeBoosterHeaders emitter.
  (globalThis as any).window.__SB_BOOSTER_VERSIONS__ = {
    injector:  '1.0.0\r\nX-Smuggled: yes',
    framework: '2.0.0\nX-Evil: 1',
  };
  const h = getBoosterHeaders();
  expect(h['x-booster-injector']).toBeUndefined();
  expect(h['x-booster-framework']).toBeUndefined();
});

test('omits x-booster-plugins when version contains CRLF', () => {
  // Symmetric with the native injector's C++ MakeBoosterHeaders HasCrlf
  // guard. A smuggled \r or \n in
  // the bun-define-baked __SB_PLUGIN_VERSION__ would let a poisoned
  // build forge an extra header on the wire; the value check must drop
  // the header entirely rather than emit the smuggled bytes.
  (globalThis as any).__SB_PLUGIN_VERSION__ = "1.0.0\r\nX-Smuggled: yes";
  const h = getBoosterHeaders();
  expect(h['x-booster-plugins']).toBeUndefined();
});

test('contentType argument adds Content-Type header', () => {
  const h = getBoosterHeaders('application/json');
  expect(h['Content-Type']).toBe('application/json');
});

test('no contentType argument omits Content-Type', () => {
  const h = getBoosterHeaders();
  expect(h['Content-Type']).toBeUndefined();
});

test('contentType containing CR or LF is dropped (CRLF defense)', () => {
  // Mirrors the C++ MakeBoosterHeaders CRLF guard. Header-smuggling is
  // a non-issue in practice (contentType is always a literal at the
  // call site), but defense-in-depth matters for future call sites.
  const hCr = getBoosterHeaders('application/json\rX-Smuggled: yes');
  expect(hCr['Content-Type']).toBeUndefined();
  const hLf = getBoosterHeaders('application/json\nX-Smuggled: yes');
  expect(hLf['Content-Type']).toBeUndefined();
});

test('attaches x-booster-uuid from window global', () => {
  (globalThis as any).window = {
    __SB_BOOSTER_VERSIONS__: { injector: '0.0.0-dev', framework: '0.0.0-dev' },
    __SB_BOOSTER_UUID__: 'uuid-1',
  };
  expect(getBoosterHeaders()['x-booster-uuid']).toBe('uuid-1');
});
test('omits x-booster-uuid when global absent', () => {
  (globalThis as any).window = { __SB_BOOSTER_VERSIONS__: {} };
  expect(getBoosterHeaders()['x-booster-uuid']).toBeUndefined();
});
test('drops a CRLF-bearing uuid', () => {
  (globalThis as any).window = { __SB_BOOSTER_UUID__: 'a\r\nb' };
  expect(getBoosterHeaders()['x-booster-uuid']).toBeUndefined();
});

