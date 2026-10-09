import { test, expect } from 'bun:test';
import { parseKeysTarget, keysTargetParam } from '../src/lib/keys-target';

test('parses an /app/<id> url as the app target', () => {
  expect(parseKeysTarget('https://store.steampowered.com/app/2198610/DREDGE/')).toEqual({ kind: 'app', id: 2198610 });
});

test('parses a /sub/<id> url as the sub target', () => {
  expect(parseKeysTarget('https://store.steampowered.com/sub/1010506/')).toEqual({ kind: 'sub', id: 1010506 });
});

test('parses a /bundle/<id> url as the bundle target', () => {
  expect(parseKeysTarget('https://store.steampowered.com/bundle/42206/Farming_Simulator_25_Year_1_Bundle/'))
    .toEqual({ kind: 'bundle', id: 42206 });
});

test('keeps parsing when the url carries a query string', () => {
  expect(parseKeysTarget('https://store.steampowered.com/sub/1010506/?snr=1_6_4__420')).toEqual({ kind: 'sub', id: 1010506 });
});

test('returns null for a store page that sells nothing addressable', () => {
  expect(parseKeysTarget('https://store.steampowered.com/cart/')).toBeNull();
  expect(parseKeysTarget('https://store.steampowered.com/')).toBeNull();
});

test('returns null for a non-numeric or zero id', () => {
  expect(parseKeysTarget('https://store.steampowered.com/sub/abc/')).toBeNull();
  expect(parseKeysTarget('https://store.steampowered.com/bundle/0/')).toBeNull();
});

// A product path that appears only in the query string is NOT the page's own
// product — matching it would query keys for the wrong package.
test('ignores a product path that lives in the query string', () => {
  expect(parseKeysTarget('https://store.steampowered.com/login/?redir=/sub/1010506/')).toBeNull();
});

test('maps each target kind to the backend query/bus field name', () => {
  expect(keysTargetParam({ kind: 'app', id: 1 })).toBe('appid');
  expect(keysTargetParam({ kind: 'sub', id: 1 })).toBe('sub');
  expect(keysTargetParam({ kind: 'bundle', id: 1 })).toBe('bundle');
});
