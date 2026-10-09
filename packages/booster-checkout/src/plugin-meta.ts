import type { PluginMeta } from '@steambalance/booster-framework/testing';
import { FRONT_HOST } from './urls';

// version is a placeholder; overridden at build time from package.json::version
// (see build.ts). Only capabilities and contextKinds are read from this file
// at runtime via sidecar protocol.
//
// allowedHosts tracks FRONT_HOST: this file is read by build.ts (Bun runtime,
// where SB_FRONT_URL is visible) and emitted into the sidecar → signed
// manifest. A dev-channel build whose URLs moved but whose allowedHosts did
// not would fail every sb.net call with "net_fetch: host not allowed".
export const pluginMeta: PluginMeta = {
  id: 'booster-checkout',
  version: '0.0.0',
  apiVersion: 1,
  contextKinds: ['main'],
  urlPatterns: [],
  grantedCapabilities: ['ui', 'steam', 'configs', 'bus', 'keys', 'net'],
  allowedHosts: [FRONT_HOST],
  subscribeTopics: [
    'booster-addfunds.topup-requested',
    'booster-addfunds.user.snapshot.request',
    'booster-addfunds.keys.request',
    'booster-addfunds.keys.purchase',
    'booster-addfunds.keys.config.request',
  ],
};
