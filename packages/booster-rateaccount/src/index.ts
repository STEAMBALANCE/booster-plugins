import { ContextKind, Capability, type PluginContext } from '@steambalance/booster-framework';
import { installMain } from './main/install';

declare const sb: { plugins: { register: (m: unknown) => void } };
declare const __SB_PLUGIN_VERSION__: string;

// Supernav button is hidden for now; flip to true to bring it back.
const SUPERNAV_BUTTON_ENABLED = false;

sb.plugins.register({
  id: 'booster-rateaccount',
  version: __SB_PLUGIN_VERSION__,
  apiVersion: 1,
  displayName: 'SteamBalance — Оцени аккаунт', // strings-allow-cyrillic
  description: 'Кнопка «Оцени аккаунт» в супернаве Steam.', // strings-allow-cyrillic
  contextKinds: [ContextKind.Main],
  capabilities: [Capability.Ui, Capability.Steam],
  async init(ctx: PluginContext): Promise<() => void> {
    if (ctx.contextKind !== ContextKind.Main || !SUPERNAV_BUTTON_ENABLED) return () => {};
    return installMain(ctx);
  },
});
