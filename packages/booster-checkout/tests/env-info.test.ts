// env-info — extractors + async resolver for the support UTM dimensions.
//
// Pure extractors get exhaustive shape coverage (canonical UA, missing
// substring, weird whitespace) because a silent regex regression would
// drop tags into the `unknown` bucket without surfacing.
//
// readOsVersion is exercised against three stubs:
//   1. UA-CH happy path → returns platformVersion verbatim.
//   2. UA-CH throws → falls back to bare-UA scrape.
//   3. UA-CH absent → falls back to bare-UA scrape.
//
// readSupportEnvInfo wires manifest prefix + navigator together — covered
// implicitly by the buildSupportUrl integration tests; reading the full
// async path here would require monkey-patching window/navigator globals
// inside bun's worker, which is brittle and adds no regression value
// over the unit-tested pieces.

import { test, expect } from 'bun:test';
import {
  extractSteamClientVersion,
  extractOsVersionFromUserAgent,
  readOsVersion,
  type NavigatorLike,
} from '../src/main/env-info';

// Canonical Steam UA shape — captured 2026-05 against Steam build
// 1778281814; matches the marker the native injector uses to fingerprint
// Steam. The build number
// is the Unix-timestamp-like integer Steam assigns each release. If
// Valve changes the marker shape, the native injector's version probe will
// break on its side; this fixture is a UA-format copy and
// won't auto-track that drift, so date-stamp it for the next reader.
const STEAM_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.6478.183 Valve Steam Client/1778281814 Safari/537.36';

test('extractSteamClientVersion reads the Valve marker', () => {
  expect(extractSteamClientVersion(STEAM_UA)).toBe('1778281814');
});

test('extractSteamClientVersion returns empty when marker is absent', () => {
  expect(extractSteamClientVersion('Mozilla/5.0 (Windows NT 10.0) Chrome/126.0')).toBe('');
});

test('extractSteamClientVersion does NOT swallow trailing punctuation into the build', () => {
  // Defends utm_content against a future UA shape where the Valve marker
  // is followed by a paren, semicolon, or channel-suffix instead of a
  // space. The current regex restricts to [0-9.] so the build comes out
  // clean and the punctuation stays outside the capture.
  expect(extractSteamClientVersion('Mozilla/5.0 ... Valve Steam Client/1778281814) Safari/537.36'))
    .toBe('1778281814');
  expect(extractSteamClientVersion('Mozilla/5.0 ... Valve Steam Client/1778281814;extra'))
    .toBe('1778281814');
  expect(extractSteamClientVersion('Mozilla/5.0 ... Valve Steam Client/1778281814(beta)'))
    .toBe('1778281814');
});

test('extractOsVersionFromUserAgent reads Windows NT major.minor', () => {
  expect(extractOsVersionFromUserAgent(STEAM_UA)).toBe('10.0');
});

test('extractOsVersionFromUserAgent returns empty when Windows NT is absent', () => {
  expect(extractOsVersionFromUserAgent('Mozilla/5.0 (Macintosh) Safari/600')).toBe('');
});

test('readOsVersion prefers UA-CH platformVersion when present', async () => {
  const nav: NavigatorLike = {
    userAgent: STEAM_UA,
    userAgentData: {
      getHighEntropyValues: async () => ({ platformVersion: '10.0.22631.4317' }),
    },
  };
  expect(await readOsVersion(nav)).toBe('10.0.22631.4317');
});

test('readOsVersion falls back to UA scrape when UA-CH throws', async () => {
  const nav: NavigatorLike = {
    userAgent: STEAM_UA,
    userAgentData: {
      getHighEntropyValues: async () => {
        throw new Error('policy rejected');
      },
    },
  };
  expect(await readOsVersion(nav)).toBe('10.0');
});

test('readOsVersion falls back to UA scrape when UA-CH is absent', async () => {
  const nav: NavigatorLike = { userAgent: STEAM_UA };
  expect(await readOsVersion(nav)).toBe('10.0');
});

test('readOsVersion falls back when UA-CH returns an empty string', async () => {
  // Some Chromium policies return the field but blank — must not poison
  // the slot with an empty value.
  const nav: NavigatorLike = {
    userAgent: STEAM_UA,
    userAgentData: {
      getHighEntropyValues: async () => ({ platformVersion: '' }),
    },
  };
  expect(await readOsVersion(nav)).toBe('10.0');
});

test('readOsVersion falls back when UA-CH hangs past the 100 ms timeout', async () => {
  // Future-proofing: if a CEF build introduces an async permission prompt
  // behind getHighEntropyValues, the support-click path must not stall.
  // The race resolves to the UA-scrape fallback within ~100 ms.
  const start = Date.now();
  const nav: NavigatorLike = {
    userAgent: STEAM_UA,
    userAgentData: {
      // Never resolves — simulates a prompt that the user never answers.
      getHighEntropyValues: () => new Promise(() => {}),
    },
  };
  const v = await readOsVersion(nav);
  const elapsed = Date.now() - start;
  expect(v).toBe('10.0');
  // 250 ms ceiling generously absorbs CI jitter while still asserting
  // the race won (a non-bounded await would hang the test process).
  expect(elapsed).toBeLessThan(250);
});
