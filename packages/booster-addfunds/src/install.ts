import type { PluginContext } from '@steambalance/booster-framework';
import { registerAddFundsPage } from './pages/addfunds';
import { registerAppPage } from './pages/app';
import { registerCartPage } from './pages/cart';

/**
 * Web-context plugin entry point. Installed by the plugin runner when
 * sb.context.kind === ContextKind.Web ('web') (Steam store BrowserView).
 * Registers the AddFunds, App, and Cart pages; future store-page modules
 * slot in here next to them (register* calls), all behind a single
 * sb.lifecycle.ready() await so framework state is settled before any DOM
 * observers attach.
 *
 * Teardown of pages and bus subscribers is NOT owned by the returned
 * function: sb.pages.register and sb.bus.subscribe bind their lifecycle
 * to the plugin scope's AbortSignal, and the framework aborts that scope
 * on rollback/re-injection — so registrations unwind automatically. The
 * returned teardown is therefore a documented no-op kept only to satisfy
 * the init() → cleanup contract.
 */
export async function installAddFundsWeb(ctx: PluginContext): Promise<() => void> {
  const sb = ctx.sb;

  // Wait for framework ready — parity with main-shell and a clear seam
  // future modules can subscribe to.
  await sb.lifecycle.ready();

  registerAddFundsPage(sb);
  registerAppPage(sb);
  registerCartPage(sb);
  // Page lifecycle is owned by sb.pages.register internally; no manual cleanup needed
  // here (the plugin scope abort propagates to all page registrations).
  // Future: registerOtherStorePages(sb) here.

  // No-op: pages/bus teardown is scope-abort bound (see JSDoc above).
  return () => {};
}
