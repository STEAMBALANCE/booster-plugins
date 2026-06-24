import {
  ContextKind,
  Capability,
  type PluginContext,
} from '@steambalance/booster-framework';

import { installMain } from './main/install';

declare const sb: { plugins: { register: (m: unknown) => void } };
declare const __SB_PLUGIN_VERSION__: string;

sb.plugins.register({
  id: 'booster-checkout',
  version: __SB_PLUGIN_VERSION__,
  apiVersion: 1,
  displayName: 'SteamBalance — Пополнить', // strings-allow-cyrillic
  description: 'Кнопка «Пополнить» в шапке Steam, popup, оплата, поддержка, заказы.', // strings-allow-cyrillic
  contextKinds: [ContextKind.Main],
  capabilities: [
    Capability.Ui,
    Capability.Steam,
    Capability.Configs,
    Capability.Bus,
  ],
  async init(ctx: PluginContext): Promise<() => void> {
    if (ctx.contextKind !== ContextKind.Main) return () => {};
    return installMain(ctx);
  },
});
