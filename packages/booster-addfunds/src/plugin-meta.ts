import type { PluginMeta } from '@steambalance/booster-framework/testing';
import { ADDFUNDS_URL_PATTERNS } from './url-patterns';

// version is a placeholder; overridden at build time by reading
// package.json::version (see build.ts). NO env-var override — release.ts
// also reads package.json::version for addfunds; one source of truth. If
// an override is ever needed, change BOTH build.ts AND release.ts.
export const pluginMeta: PluginMeta = {
  id: 'booster-addfunds',
  version: '0.0.0',
  apiVersion: 1,
  contextKinds: ['web'],
  // Shared with index.ts via ./url-patterns so the bundle's register() patterns
  // and this manifest-sidecar source stay byte-identical (crossValidate subset).
  urlPatterns: ADDFUNDS_URL_PATTERNS,
  grantedCapabilities: ['ui', 'steam', 'configs', 'bus', 'pages'],
};
