import { test, expect } from 'bun:test';
import { parseAppId } from '../src/lib/app-id';

test('parses app id from /app/<id> urls', () => {
  expect(parseAppId('https://store.steampowered.com/app/2198610/DREDGE/')).toBe(2198610);
  expect(parseAppId('https://store.steampowered.com/app/570/?snr=1')).toBe(570);
  expect(parseAppId('https://store.steampowered.com/cart/')).toBeNull();
  expect(parseAppId('https://store.steampowered.com/app/abc/')).toBeNull();
});
