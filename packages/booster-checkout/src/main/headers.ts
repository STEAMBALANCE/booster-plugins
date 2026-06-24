// packages/booster-checkout/src/main/headers.ts
//
// Lives in the booster-checkout IIFE bundle (main-context plugin code). The popup
// is a separate IIFE (inlined as HTML at build time) and gets its own
// copy at `popup-svelte/lib/headers.ts` — the two copies share the
// CRLF defense policy but differ on version sourcing:
//   - main IIFE reads __SB_PLUGINS_MANIFEST__ (injector-set at boot)
//     and sb.version (framework instance); both are present in the
//     main-shell V8 context where this IIFE lives.
//   - popup IIFE runs in a different V8 context with no framework
//     and no manifest prefix, so it falls back to bun-define-
//     substituted constants baked at build time.
//
// Builds the booster headers (+ optional Content-Type) for main-IIFE
// fetches. Resolution order:
//   1. window.__SB_PLUGINS_MANIFEST__ — authoritative for injector +
//      per-plugin version; set by the C++ injector via the
//      BuildFrameworkJsWithConfig prefix.
//   2. sb.version — framework's own version (the framework instance
//      passed in by the plugin host).
// Empty / missing version → header omitted (we never emit an empty
// value). Plugin list: each entry is filtered to require both `id`
// and `version` as non-empty strings; empty list → header omitted.
//
// Wire-format contract for `x-booster-plugins`:
//   value = id1@v1;id2@v2 (semicolon-separated, alpha-sorted by id,
//                          empty-id / empty-version pairs dropped).
// Three independent emitters of this format exist:
//   1. THIS file (main-shell IIFE, multi-plugin from __SB_PLUGINS_MANIFEST__)
//   2. popup-svelte/lib/headers.ts (single-plugin, popup IIFE, bun-define
//      baked __SB_PLUGIN_VERSION__)
//   3. the native injector (C++ MakeBoosterHeaders, per-request build)
// All three must agree byte-for-byte.

import type { SbApi } from '@steambalance/booster-framework/api-types';

declare global {
  interface Window {
    /** C++-injected manifest prefix, set by the native injector at boot.
     *  The shape
     *  is also typed by booster-framework/src/plugins/bootstrap.ts
     *  (PluginsManifestPrefix) — only the fields this module reads are
     *  redeclared here so a future field on the prefix doesn't force
     *  a header-file ripple. */
    __SB_PLUGINS_MANIFEST__?: {
      injectorVersion?: string;
      plugins?: Array<{ id?: string; version?: string }>;
    };
    /** Framework-prefetched machine UUID for x-booster-uuid header. */
    __SB_BOOSTER_UUID__?: string;
  }
}

// Avoid `Headers` (Fetch global type collision).
type HeaderMap = Record<string, string>;

/**
 * Live injector + framework versions for the booster headers. Sourced
 * from the C++-injected manifest prefix (injector) and the framework
 * instance (`sb.version`). Both reads are defensive: module-init and
 * bun-test paths run without the prefix / with a partial `sb` stub, so a
 * missing value collapses to '' (→ header omitted).
 *
 * Exported so the popup gets the SAME values at runtime: install.ts
 * forwards `getStackVersions(sb)` in the `init` BC message, and the popup
 * reads them back in popup-svelte/lib/headers.ts. Keeping a single source
 * here is what lets the popup bundle drop its build-time version defines
 * (immutable-CDN byte-stability — the CDN serves each bundle under an
 * immutable versioned URL).
 */
export function getStackVersions(sb: SbApi): { injector: string; framework: string } {
  const pm =
    typeof window !== 'undefined' ? window.__SB_PLUGINS_MANIFEST__ : undefined;
  const injector = (typeof pm?.injectorVersion === 'string') ? pm.injectorVersion : '';
  const framework =
    (sb && typeof (sb as { version?: unknown }).version === 'string')
      ? (sb as { version: string }).version
      : '';
  return { injector, framework };
}

export function getBoosterHeaders(sb: SbApi, contentType?: string): HeaderMap {
  // Read the manifest prefix defensively — the function is called from
  // module-init paths and bun-test runs without the prefix installed,
  // so a missing global must collapse to "no version headers" cleanly.
  const pm =
    typeof window !== 'undefined' ? window.__SB_PLUGINS_MANIFEST__ : undefined;
  const { injector, framework } = getStackVersions(sb);
  // All required plugins, alpha-sorted by id, formatted as id1@v1;id2@v2.
  // Empty pairs (id or version missing) dropped. Empty list → header omitted.
  const pluginPairs: string[] = Array.isArray(pm?.plugins)
    ? pm!.plugins!
        .filter((p): p is { id: string; version: string } =>
          !!p && typeof p.id === 'string' && p.id.length > 0
              && typeof p.version === 'string' && p.version.length > 0
              && !/[\r\n]/.test(p.id) && !/[\r\n]/.test(p.version))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((p) => `${p.id}@${p.version}`)
    : [];

  const h: HeaderMap = { 'x-booster': 'true' };
  // CRLF defense on injector/framework keeps this in lockstep with the
  // popup copy (which sources the same values from the untrusted BC realm)
  // and with the C++ MakeBoosterHeaders emitter, which guards both. Here
  // the source is in-process/trusted, so this is purely belt-and-suspenders.
  if (injector && !/[\r\n]/.test(injector))   h['x-booster-injector']  = injector;
  if (framework && !/[\r\n]/.test(framework)) h['x-booster-framework'] = framework;
  if (pluginPairs.length) h['x-booster-plugins']   = pluginPairs.join(';');
  const rawUuid = typeof window !== 'undefined' ? window.__SB_BOOSTER_UUID__ : undefined;
  if (typeof rawUuid === 'string' && rawUuid && !/[\r\n]/.test(rawUuid)) h['x-booster-uuid'] = rawUuid;
  // CR/LF defense — mirrors the C++ MakeBoosterHeaders guard. The plugin
  // never sources contentType from anything untrusted (always a literal
  // like 'application/json' at the call site), but the cost of dropping
  // a smuggled CRLF here is zero and the cost of NOT dropping it on a
  // future call site that forgets to validate is much higher.
  if (contentType && !/[\r\n]/.test(contentType)) h['Content-Type'] = contentType;
  return h;
}
