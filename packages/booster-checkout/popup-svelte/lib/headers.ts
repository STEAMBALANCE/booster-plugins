// packages/booster-checkout/popup-svelte/lib/headers.ts
//
// Builds the booster headers (+ optional Content-Type) for popup
// fetches. The popup runs in its own V8 context (separate IIFE,
// inlined as HTML at build time) — the C++ injector's
// __SB_PLUGINS_MANIFEST__ prefix is NOT visible here, and there's no
// `sb` instance to read `.version` from. The plugin's OWN version is a
// build-time define (__SB_PLUGIN_VERSION__ — equals the bundle filename
// version, so it changes only when the plugin version changes). Injector
// + framework versions arrive at RUNTIME over the BroadcastChannel `init`
// message (bridge.ts → window.__SB_BOOSTER_VERSIONS__) and are deliberately NOT baked in: that keeps this
// popup bundle's bytes independent of injector/framework releases, so an
// unchanged plugin re-builds byte-identical under its immutable CDN URL.
//
// Keep in lockstep with `src/main/headers.ts` on the CRLF defense policy —
// divergence silently breaks the booster header contract.

declare const __SB_PLUGIN_VERSION__: string;

declare global {
  interface Window {
    /** Injector + framework versions delivered at runtime by the main-
     *  shell over the BroadcastChannel `init` message (bridge.ts), which
     *  sources them from window.__SB_PLUGINS_MANIFEST__ + sb.version. The
     *  popup has no framework instance, so this is the only path for the
     *  live stack versions to reach it. Read per-call so a version that
     *  arrives after module init is still picked up. */
    __SB_BOOSTER_VERSIONS__?: { injector?: string; framework?: string };
    /** Machine UUID delivered at runtime by the main-shell over the
     *  BroadcastChannel `init` message (bridge.ts). Read per-call. */
    __SB_BOOSTER_UUID__?: string;
  }
}

// Avoid `Headers` (Fetch global type collision).
type HeaderMap = Record<string, string>;

export function getBoosterHeaders(contentType?: string): HeaderMap {
  // Injector + framework versions are read at runtime from
  // window.__SB_BOOSTER_VERSIONS__ (set by bridge.ts from the init
  // message). Read per-call so a version that lands after module init is
  // honoured. Guard `window` for non-DOM bun-test contexts. Missing →
  // empty → header omitted.
  const vers =
    (typeof window !== 'undefined') ? window.__SB_BOOSTER_VERSIONS__ : undefined;
  const injector: string =
    (typeof vers?.injector === 'string') ? vers.injector : '';
  const framework: string =
    (typeof vers?.framework === 'string') ? vers.framework : '';
  // The plugin's own version is the one value still baked at build time
  // (typeof-guarded so `bun test` without the define resolves to '').
  // It equals the bundle filename version, so baking it never drifts the
  // immutable-CDN bytes.
  const pluginVersion: string =
    (typeof __SB_PLUGIN_VERSION__ !== 'undefined') ? __SB_PLUGIN_VERSION__ : '';

  const uuid: string =
    (typeof window !== 'undefined' && typeof (window as { __SB_BOOSTER_UUID__?: unknown }).__SB_BOOSTER_UUID__ === 'string')
      ? (window as { __SB_BOOSTER_UUID__: string }).__SB_BOOSTER_UUID__ : '';

  const h: HeaderMap = { 'x-booster': 'true' };
  // CRLF defense on every header-bound value. injector/framework now flow
  // from the untrusted popup realm via BC (window.__SB_BOOSTER_VERSIONS__),
  // so they get the same smuggling guard as the plugin version and the C++
  // MakeBoosterHeaders emitter. bridge.ts also drops CRLF on ingestion —
  // this is defense in depth.
  if (injector && !/[\r\n]/.test(injector))   h['x-booster-injector']  = injector;
  if (framework && !/[\r\n]/.test(framework)) h['x-booster-framework'] = framework;
  if (uuid && !/[\r\n]/.test(uuid)) h['x-booster-uuid'] = uuid;
  if (pluginVersion && !/[\r\n]/.test(pluginVersion))
    h['x-booster-plugins'] = `booster-checkout@${pluginVersion}`;
  // CR/LF defense — mirrors the C++ MakeBoosterHeaders guard. The popup
  // never sources contentType from anything untrusted (always a literal
  // like 'application/json' at the call site), but the cost of dropping
  // a smuggled CRLF here is zero and the cost of NOT dropping it on a
  // future call site that forgets to validate is much higher.
  if (contentType && !/[\r\n]/.test(contentType)) h['Content-Type'] = contentType;
  return h;
}
