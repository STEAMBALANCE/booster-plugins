// urls-helper — pure URL composers. Regression coverage for the two
// query-tag contracts shipped to live backends:
//   - buildOrdersUrl: uid[]=<id> repeated params (identity-free orders page)
//   - buildSupportUrl: 5-UTM scheme used by JivoChat dashboards
//     (utm_source / utm_medium / utm_campaign / utm_content / utm_term).
// A regression on the tag names or on the `unknown` fallback silently
// breaks version-level support analytics, so each dimension gets its
// own assertion.

import { test, expect, describe } from 'bun:test';
import { buildOrdersUrl, buildSupportUrl } from '../src/main/urls-helper';

describe('buildOrdersUrl', () => {
  const BASE = 'https://steambalance.cc/booster/orders';
  test('empty list → base unchanged', () => {
    expect(buildOrdersUrl(BASE, [])).toBe(`${BASE}`);
  });
  test('appends uid[] params, URL-encoded brackets', () => {
    const u = buildOrdersUrl(BASE, ['a1b2c3d4', 'e5f6a7b8']);
    expect(u).toContain('uid%5B%5D=a1b2c3d4');
    expect(u).toContain('uid%5B%5D=e5f6a7b8');
  });
  test('preserves existing query', () => {
    const u = buildOrdersUrl(`${BASE}?lang=ru`, ['a1b2c3d4']);
    expect(u).toContain('lang=ru');
    expect(u).toContain('uid%5B%5D=a1b2c3d4');
  });
});

test('buildSupportUrl emits all five UTM params with proper prefixes', () => {
  const u = buildSupportUrl('https://jivo.chat/OdRu6JcBYZ', {
    appVersion:   '0.0.14',
    steamVersion: '1778281814',
    osVersion:    '10.0.22631.4317',
  });
  const parsed = new URL(u);
  expect(parsed.origin + parsed.pathname).toBe('https://jivo.chat/OdRu6JcBYZ');
  expect(parsed.searchParams.get('utm_source')).toBe('desktop_app');
  expect(parsed.searchParams.get('utm_medium')).toBe('support');
  expect(parsed.searchParams.get('utm_campaign')).toBe('app_0.0.14');
  expect(parsed.searchParams.get('utm_content')).toBe('steam_1778281814');
  expect(parsed.searchParams.get('utm_term')).toBe('os_10.0.22631.4317');
});

test('buildSupportUrl empty dimensions fall back to `unknown` (slot stays present)', () => {
  const u = buildSupportUrl('https://jivo.chat/OdRu6JcBYZ', {
    appVersion: '', steamVersion: '', osVersion: '',
  });
  const parsed = new URL(u);
  // Source / medium are constants — never affected by missing data.
  expect(parsed.searchParams.get('utm_source')).toBe('desktop_app');
  expect(parsed.searchParams.get('utm_medium')).toBe('support');
  // Per-dimension fallback: prefix is preserved, only the value becomes `unknown`.
  expect(parsed.searchParams.get('utm_campaign')).toBe('app_unknown');
  expect(parsed.searchParams.get('utm_content')).toBe('steam_unknown');
  expect(parsed.searchParams.get('utm_term')).toBe('os_unknown');
});

test('buildSupportUrl mixed missing dimensions only swap the empty slots', () => {
  // Asserts no cross-talk: a missing osVersion must not bleed into the
  // app slot, and vice versa.
  const u = buildSupportUrl('https://jivo.chat/OdRu6JcBYZ', {
    appVersion: '0.0.14', steamVersion: '', osVersion: '10.0',
  });
  const parsed = new URL(u);
  expect(parsed.searchParams.get('utm_campaign')).toBe('app_0.0.14');
  expect(parsed.searchParams.get('utm_content')).toBe('steam_unknown');
  expect(parsed.searchParams.get('utm_term')).toBe('os_10.0');
});
