import type { PluginMeta } from '@steambalance/booster-framework/testing';

// version is a placeholder; overridden at build time from package.json::version
// (see build.ts). Only capabilities and contextKinds are read from this file
// at runtime via sidecar protocol.
export const pluginMeta: PluginMeta = {
  id: 'booster-checkout',
  version: '0.0.0',
  apiVersion: 1,
  contextKinds: ['main'],
  urlPatterns: [],
  grantedCapabilities: ['ui', 'steam', 'configs', 'bus'],
};
