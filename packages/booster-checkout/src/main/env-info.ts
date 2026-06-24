// Environment-info collector for outbound URL tagging.
//
// Composes three identifiers used by the support UTM scheme:
//   - appVersion   — booster build, taken from the C++-injected manifest
//                    prefix (same source headers.ts uses).
//   - steamVersion — Steam client build, extracted from navigator.userAgent.
//                    Confirmed UA shape: `... Valve Steam Client/<build> ...`
//                    (the same marker the native injector uses to
//                    fingerprint Steam).
//   - osVersion    — Windows version. UA Client Hints
//                    (navigator.userAgentData.getHighEntropyValues) is
//                    preferred because it returns the full
//                    "10.0.22631.4317" form; the bare-UA fallback only
//                    yields the NT major.minor ("10.0"). Missing-on-old-CEF
//                    or rejected-by-policy → graceful UA fallback.
//
// All exports are pure functions over their explicit arguments so unit
// tests can pump synthetic UA strings + stub userAgentData without
// touching the real navigator.

declare global {
  // Must match headers.ts:33 exactly — TS merges `declare global` blocks
  // across the package, and a narrower shape here triggers TS2717. Both
  // files only read `injectorVersion` here; the `plugins?` field is
  // carried for declaration parity, not used at this call site.
  interface Window {
    __SB_PLUGINS_MANIFEST__?: {
      injectorVersion?: string;
      plugins?: Array<{ id?: string; version?: string }>;
    };
  }
  // UA-CH shape — narrow to what we actually read so a future field
  // doesn't force a header ripple.
  interface NavigatorUAData {
    getHighEntropyValues(hints: string[]): Promise<{ platformVersion?: string }>;
  }
  interface Navigator {
    userAgentData?: NavigatorUAData;
  }
}

// Steam build numbers are always numeric (`1778281814` shape — Unix-ish
// timestamps). Restricting the capture to `[0-9.]+` instead of `\S+`
// prevents trailing punctuation in a future UA shape (paren / semicolon /
// channel suffix) from poisoning the utm_content bucket.
const STEAM_UA_RE = /Valve Steam Client\/([0-9.]+)/;
// NT major.minor (e.g. "10.0"). Build number is not in the bare UA — UA-CH
// platformVersion is the only place that surfaces it.
const WINDOWS_NT_RE = /Windows NT (\d+(?:\.\d+)?)/;

export function extractSteamClientVersion(userAgent: string): string {
  const m = STEAM_UA_RE.exec(userAgent);
  return m ? m[1]! : '';
}

export function extractOsVersionFromUserAgent(userAgent: string): string {
  const m = WINDOWS_NT_RE.exec(userAgent);
  return m ? m[1]! : '';
}

// Minimal navigator surface the resolver depends on. Tests inject a stub;
// production passes the real `navigator`.
export interface NavigatorLike {
  userAgent: string;
  userAgentData?: NavigatorUAData;
}

// UA-CH normally resolves synchronously-ish in Chromium, but the spec
// doesn't bound it — a future CEF build that gates `platformVersion`
// behind a permission prompt would otherwise hang the support-click. A
// 100 ms cap keeps the click path responsive at the cost of silently
// dropping the precise build number for the UA fallback.
const UACH_TIMEOUT_MS = 100;

export async function readOsVersion(nav: NavigatorLike): Promise<string> {
  const uad = nav.userAgentData;
  if (uad && typeof uad.getHighEntropyValues === 'function') {
    try {
      const hv = await Promise.race([
        uad.getHighEntropyValues(['platformVersion']),
        new Promise<{ platformVersion?: string }>((_, reject) =>
          setTimeout(() => reject(new Error('uach-timeout')), UACH_TIMEOUT_MS),
        ),
      ]);
      if (typeof hv.platformVersion === 'string' && hv.platformVersion) {
        return hv.platformVersion;
      }
    } catch {
      // UA-CH threw, was rejected by policy, or our race timed it out —
      // fall through to UA scrape either way.
    }
  }
  return extractOsVersionFromUserAgent(nav.userAgent);
}

export interface SupportEnvInfo {
  appVersion: string;
  steamVersion: string;
  osVersion: string;
}

export async function readSupportEnvInfo(): Promise<SupportEnvInfo> {
  const manifest =
    (typeof window !== 'undefined') ? window.__SB_PLUGINS_MANIFEST__ : undefined;
  const appVersion =
    (manifest && typeof manifest.injectorVersion === 'string')
      ? manifest.injectorVersion : '';
  const nav: NavigatorLike | undefined =
    (typeof navigator !== 'undefined') ? navigator : undefined;
  const ua = nav?.userAgent ?? '';
  const steamVersion = extractSteamClientVersion(ua);
  const osVersion = nav ? await readOsVersion(nav) : '';
  return { appVersion, steamVersion, osVersion };
}
