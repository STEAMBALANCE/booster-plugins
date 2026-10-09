import type { PluginMeta } from '@steambalance/booster-framework/testing';
import { ADDFUNDS_URL_PATTERNS } from './url-patterns';
import { FRONT_HOST } from './urls';

// version is a placeholder; overridden at build time by reading
// package.json::version (see build.ts). NO env-var override — release.ts
// also reads package.json::version for addfunds; one source of truth. If
// an override is ever needed, change BOTH build.ts AND release.ts.
export const pluginMeta: PluginMeta = {
  id: 'booster-addfunds',
  version: '0.0.0',
  apiVersion: 1,
  contextKinds: ['web', 'main'],
  // Shared with index.ts via ./url-patterns so the bundle's register() patterns
  // and this manifest-sidecar source stay byte-identical (crossValidate subset).
  urlPatterns: ADDFUNDS_URL_PATTERNS,
  grantedCapabilities: ['ui', 'steam', 'configs', 'bus', 'pages', 'net'],
  // Tracks FRONT_HOST — a dev-channel build whose URLs moved but whose
  // allowedHosts did not would fail every sb.net call with
  // "net_fetch: host not allowed".
  allowedHosts: [FRONT_HOST],
  subscribeTopics: [
    'booster-checkout.keys.response',
    'booster-checkout.keys.email-required',
    'booster-checkout.keys.purchase-result',
    'booster-checkout.keys.ready',
    'booster-checkout.user.snapshot',
    'booster-checkout.keys.config',
  ],
};
