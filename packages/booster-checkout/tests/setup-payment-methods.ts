// booster-plugins/packages/booster-checkout/tests/setup-payment-methods.ts
//
// Shared test env helper for payment-methods.ts and the booster-checkout
// booster-checkout IIFE tests that depend on it. Installs:
//   - a minimal in-memory localStorage
//   - a window stub with __SB_PLUGINS_MANIFEST__ so getBoosterHeaders
//     resolves to deterministic injector + booster-checkout version values
//     inside the fetch path.
//
// Framework version (SbApi.version) is NOT seeded here — callers pass
// an SbApi stub with `.version` directly to fetchPaymentMethods /
// getBoosterHeaders.
//
// Non-destructive: other test files (e.g. ones using happy-dom for the
// main-shell IIFE) install a happy-dom Window on globalThis in their
// beforeEach; clobbering that would break the booster-checkout bundle which
// reads `window.document` during boot. We track what we created vs.
// what we merely augmented, then restore exactly that in uninstall.

let createdLocalStorage = false;
let createdWindow = false;
let augmentedExistingWindow = false;

// Default test manifest prefix — mirrors what the C++ injector emits
// via BuildFrameworkJsWithConfig. `injectorVersion = '1.0.0'` and the
// booster-checkout entry's `version = '3.0.0'` are picked to match the
// legacy stub values the existing header-value assertions rely on
// (1.0.0 / 3.0.0), so per-test rewrites aren't needed.
const TEST_PLUGINS_MANIFEST = {
  injectorVersion: '1.0.0',
  contextKind: 'main',
  userDisabledPlugins: [],
  plugins: [
    {
      id: 'booster-checkout',
      version: '3.0.0',
      apiVersion: 1,
      contextKinds: ['main', 'web'],
      urlPatterns: [],
      grantedCapabilities: [],
      required: true,
    },
  ],
};

export function installPaymentMethodsTestEnv(): void {
  if (!(globalThis as any).localStorage) {
    const store: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
      setItem: (k: string, v: string) => { store[k] = String(v); },
      removeItem: (k: string) => { delete store[k]; },
      clear:    () => { for (const k of Object.keys(store)) delete store[k]; },
      key:      (i: number) => Object.keys(store)[i] ?? null,
      get length() { return Object.keys(store).length; },
    };
    createdLocalStorage = true;
  }
  const w = (globalThis as any).window;
  if (w) {
    // Preserve a pre-existing happy-dom Window; just add the prefix.
    w.__SB_PLUGINS_MANIFEST__ = TEST_PLUGINS_MANIFEST;
    augmentedExistingWindow = true;
  } else {
    (globalThis as any).window = {
      __SB_PLUGINS_MANIFEST__: TEST_PLUGINS_MANIFEST,
    };
    createdWindow = true;
  }
}

export function uninstallPaymentMethodsTestEnv(): void {
  if (createdLocalStorage) {
    delete (globalThis as any).localStorage;
    createdLocalStorage = false;
  }
  if (createdWindow) {
    delete (globalThis as any).window;
    createdWindow = false;
  } else if (augmentedExistingWindow) {
    // Only remove the property we added; leave the pre-existing window
    // (e.g. a happy-dom Window installed by another test file) intact for the rest of the
    // suite's afterEach/beforeEach machinery.
    if ((globalThis as any).window) {
      delete (globalThis as any).window.__SB_PLUGINS_MANIFEST__;
    }
    augmentedExistingWindow = false;
  }
}
