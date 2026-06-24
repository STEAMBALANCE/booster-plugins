import {
  ContextKind,
  Capability,
  type PluginContext,
} from '@steambalance/booster-framework';
import { installAddFundsWeb } from './install';
import { ADDFUNDS_URL_PATTERNS } from './url-patterns';

declare const sb: { plugins: { register: (m: unknown) => void } };
declare const __SB_PLUGIN_VERSION__: string;

sb.plugins.register({
  id: 'booster-addfunds',
  version: __SB_PLUGIN_VERSION__,
  apiVersion: 1,
  displayName: 'SteamBalance — AddFunds',
  description: 'Дополнительная строка «Пополнить кошелёк» на Steam-странице /steamaccount/addfunds.', // strings-allow-cyrillic
  contextKinds: [ContextKind.Web],
  urlPatterns: ADDFUNDS_URL_PATTERNS,
  capabilities: [
    Capability.Ui,
    Capability.Steam,
    Capability.Configs,
    Capability.Bus,
    Capability.Pages,
  ],
  async init(ctx: PluginContext): Promise<() => void> {
    return await installAddFundsWeb(ctx);
  },
});
