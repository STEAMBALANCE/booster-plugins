// booster-checkout IIFE getBoosterHeaders — version-source coverage.
// After D.9 the main-IIFE reads injector + per-plugin versions from
// window.__SB_PLUGINS_MANIFEST__ (set by the C++ injector) and the
// framework version from sb.version. The popup IIFE is covered separately
// (different module, different version sourcing — see
// popup-svelte/__tests__/headers.test.ts).

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { getBoosterHeaders } from '../src/main/headers';
import type { SbApi } from '@steambalance/booster-framework/api-types';

// Minimal SbApi stub — getBoosterHeaders only reads `.version`. A
// partial-typed cast keeps the test surface small without dragging in
// the full SbApi shape (which couples to dozens of capability sub-APIs).
function sbStub(version: string): SbApi {
  return { version } as unknown as SbApi;
}

let prevPm: unknown;

beforeEach(() => {
  (globalThis as any).window ??= {};
  prevPm = (globalThis as any).window.__SB_PLUGINS_MANIFEST__;
});

afterEach(() => {
  // Use `delete` when the property was originally absent so we don't
  // leave a present-but-undefined key on the window object; the
  // "missing prefix" test relies on `__SB_PLUGINS_MANIFEST__ in window`
  // being false on a freshly-cleaned window.
  if ((globalThis as any).window) {
    if (prevPm === undefined) {
      delete (globalThis as any).window.__SB_PLUGINS_MANIFEST__;
    } else {
      (globalThis as any).window.__SB_PLUGINS_MANIFEST__ = prevPm;
    }
  }
});

// ── Version resolution ──────────────────────────────────────────────────

test('all three version headers when prefix has injectorVersion + booster-checkout plugin entry', () => {
  (globalThis as any).window.__SB_PLUGINS_MANIFEST__ = {
    injectorVersion: '1.2.3',
    contextKind: 'main',
    userDisabledPlugins: [],
    plugins: [{ id: 'booster-checkout', version: '7.8.9', apiVersion: 1 }],
  };
  const h = getBoosterHeaders(sbStub('4.5.6'));
  expect(h['x-booster']).toBe('true');
  expect(h['x-booster-injector']).toBe('1.2.3');
  expect(h['x-booster-framework']).toBe('4.5.6');
  expect(h['x-booster-plugins']).toBe('booster-checkout@7.8.9');
});

test('missing prefix → only framework-version header set', () => {
  // Pre-prefix-installed bootstrap path (test env without the C++
  // injector). sb.version is always available because the framework
  // instance is the caller; injector + plugins are not.
  delete (globalThis as any).window.__SB_PLUGINS_MANIFEST__;
  const h = getBoosterHeaders(sbStub('4.5.6'));
  expect(h['x-booster']).toBe('true');
  expect(h['x-booster-injector']).toBeUndefined();
  expect(h['x-booster-framework']).toBe('4.5.6');
  expect(h['x-booster-plugins']).toBeUndefined();
});

test('multi-plugin prefix → x-booster-plugins lists all, alpha-sorted by id', () => {
  (globalThis as any).window.__SB_PLUGINS_MANIFEST__ = {
    injectorVersion: '1.2.3',
    contextKind: 'main',
    userDisabledPlugins: [],
    plugins: [
      { id: 'booster-other', version: '2.0.0', apiVersion: 1 },
      { id: 'booster-checkout', version: '7.8.9', apiVersion: 1 },
    ],
  };
  const h = getBoosterHeaders(sbStub('4.5.6'));
  expect(h['x-booster-injector']).toBe('1.2.3');
  expect(h['x-booster-framework']).toBe('4.5.6');
  expect(h['x-booster-plugins']).toBe('booster-checkout@7.8.9;booster-other@2.0.0');
});

test('drops plugin entries with empty id or missing version from x-booster-plugins', () => {
  // Pins the defensive predicate in headers.ts: an entry whose id or
  // version is empty / non-string must be silently dropped so a partial
  // prefix (mid-bootstrap race, or a future field shape) can never
  // emit a malformed pair like `@1.0.0` or `booster-other@` on the wire.
  (globalThis as any).window.__SB_PLUGINS_MANIFEST__ = {
    injectorVersion: '1.0.0',
    contextKind: 'main',
    userDisabledPlugins: [],
    plugins: [
      { id: 'booster-checkout', version: '1.0.0', apiVersion: 1 },
      { id: 'booster-other', apiVersion: 1 },              // missing version
      { id: '', version: '2.0.0', apiVersion: 1 },    // empty id
      { id: 'booster-valid', version: '3.0.0', apiVersion: 1 },
    ],
  };
  const h = getBoosterHeaders(sbStub('0.1.0'));
  expect(h['x-booster-plugins']).toBe('booster-checkout@1.0.0;booster-valid@3.0.0');
});

test('drops plugin entries with CRLF in id or version from x-booster-plugins', () => {
  // Symmetric with the native injector's C++ MakeBoosterHeaders HasCrlf
  // guard. A smuggled \r or \n in
  // either field would let a hostile manifest forge an extra header on
  // the wire; the predicate must drop such entries silently rather than
  // emit them.
  (globalThis as any).window.__SB_PLUGINS_MANIFEST__ = {
    injectorVersion: '1.0.0',
    contextKind: 'main',
    userDisabledPlugins: [],
    plugins: [
      { id: 'booster-checkout', version: '1.0.0', apiVersion: 1 },
      { id: "booster-evil\r\nX-Smuggled: yes", version: '2.0.0', apiVersion: 1 },  // CRLF in id
      { id: 'booster-bad', version: "1.0.0\nleaked", apiVersion: 1 },              // LF in version
      { id: 'booster-good', version: '3.0.0', apiVersion: 1 },
    ],
  };
  const h = getBoosterHeaders(sbStub('0.1.0'));
  expect(h['x-booster-plugins']).toBe('booster-checkout@1.0.0;booster-good@3.0.0');
});

test('empty plugins array → x-booster-plugins header omitted', () => {
  (globalThis as any).window.__SB_PLUGINS_MANIFEST__ = {
    injectorVersion: '1.2.3',
    contextKind: 'main',
    userDisabledPlugins: [],
    plugins: [],
  };
  const h = getBoosterHeaders(sbStub('4.5.6'));
  expect(h['x-booster-injector']).toBe('1.2.3');
  expect(h['x-booster-framework']).toBe('4.5.6');
  expect(h['x-booster-plugins']).toBeUndefined();
});

test('empty injectorVersion string → header omitted (no empty header values)', () => {
  (globalThis as any).window.__SB_PLUGINS_MANIFEST__ = {
    injectorVersion: '',
    contextKind: 'main',
    userDisabledPlugins: [],
    plugins: [],
  };
  const h = getBoosterHeaders(sbStub(''));
  expect(h['x-booster']).toBe('true');
  expect(h['x-booster-injector']).toBeUndefined();
  expect(h['x-booster-framework']).toBeUndefined();
  expect(h['x-booster-plugins']).toBeUndefined();
});

test('CRLF in injector / framework version → header omitted (lockstep with popup + C++ emitter)', () => {
  // Parity guard: the popup copy sources these from the untrusted BC realm
  // and drops CRLF; the C++ MakeBoosterHeaders emitter guards both fields
  // too. Keep this in-process copy in lockstep even though its source is
  // trusted, so all three emitters agree.
  (globalThis as any).window.__SB_PLUGINS_MANIFEST__ = {
    injectorVersion: '1.2.3\r\nX-Smuggled: yes',
    contextKind: 'main',
    userDisabledPlugins: [],
    plugins: [],
  };
  const h = getBoosterHeaders(sbStub('4.5.6\nX-Evil: 1'));
  expect(h['x-booster-injector']).toBeUndefined();
  expect(h['x-booster-framework']).toBeUndefined();
});

// ── Content-Type ────────────────────────────────────────────────────────

test('contentType argument sets Content-Type', () => {
  const h = getBoosterHeaders(sbStub('4.5.6'), 'application/json');
  expect(h['Content-Type']).toBe('application/json');
});

test('no contentType → no Content-Type', () => {
  const h = getBoosterHeaders(sbStub('4.5.6'));
  expect(h['Content-Type']).toBeUndefined();
});

test('contentType with CR/LF dropped (CRLF defense)', () => {
  const hCr = getBoosterHeaders(sbStub('4.5.6'), 'application/json\rX-Smuggled: yes');
  const hLf = getBoosterHeaders(sbStub('4.5.6'), 'application/json\nX-Smuggled: yes');
  expect(hCr['Content-Type']).toBeUndefined();
  expect(hLf['Content-Type']).toBeUndefined();
});

// ── x-booster-uuid ──────────────────────────────────────────────────────

describe('main getBoosterHeaders x-booster-uuid', () => {
  test('attaches uuid from window global', () => {
    (globalThis as any).window = { __SB_PLUGINS_MANIFEST__: { injectorVersion: '0.0.0-dev', plugins: [] }, __SB_BOOSTER_UUID__: 'uuid-1' };
    expect(getBoosterHeaders(sbStub('0.0.0-dev'), 'application/json')['x-booster-uuid']).toBe('uuid-1');
  });
  test('omits when absent', () => {
    (globalThis as any).window = { __SB_PLUGINS_MANIFEST__: { plugins: [] } };
    expect(getBoosterHeaders(sbStub('0.0.0-dev'))['x-booster-uuid']).toBeUndefined();
  });
  test('drops CRLF uuid', () => {
    (globalThis as any).window = { __SB_BOOSTER_UUID__: 'a\r\nb' };
    expect(getBoosterHeaders(sbStub('0.0.0-dev'))['x-booster-uuid']).toBeUndefined();
  });
});

