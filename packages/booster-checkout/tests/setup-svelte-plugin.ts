//
// Bun-test preload that registers bun-plugin-svelte so `.svelte.ts`
// modules (which use Svelte 5 runes — `$state`, `$derived`, etc.) get
// compiled by the Svelte compiler before being imported. Without this
// preload, runes throw `ReferenceError: $state is not defined` when
// imported from a vanilla bun-test process.
//
// Used via bunfig.toml's [test].preload entry — only active during
// `bun test`, never during the production booster-checkout bundle (build.ts uses
// the plugin explicitly via Bun.build's `plugins: [...]`).
//
// Per-test version-define seeds (__SB_*_VERSION__) live inside the
// individual test files' beforeEach blocks — those are read per-call
// by getBoosterHeaders so late seeding works.

import { plugin } from 'bun';
import { SveltePlugin } from 'bun-plugin-svelte';
import { compile, compileModule } from 'svelte/compiler';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';

// Bun runtime resolves the bare `svelte` specifier via svelte's exports
// map and — without an active `browser` condition — picks `index-server.js`,
// where `mount()` / `unmount()` are stubs that throw
// `lifecycle_function_unavailable`. We need the real client runtime for
// component-level tests that use popup-render-helper. Bun's plugin
// onResolve hook does NOT fire for bare specifiers at runtime, so the
// redirect happens via onLoad on the resolved server-entry path. The
// loaded content becomes a re-export of the matching client file, which
// the standard svelte exports map resolves identically across versions.
const SVELTE_SERVER_ENTRY = Bun.resolveSync('svelte', import.meta.dir);
const SVELTE_CLIENT_ENTRY = resolvePath(
  dirname(SVELTE_SERVER_ENTRY), 'index-client.js',
);
plugin({
  name: 'booster-svelte-client-redirect',
  setup(builder) {
    builder.onLoad({ filter: /index-server\.js$/ }, (args) => {
      if (args.path !== SVELTE_SERVER_ENTRY) return undefined;
      return {
        contents: `export * from ${JSON.stringify(SVELTE_CLIENT_ENTRY)};`,
        loader: 'js',
      };
    });
  },
});

// First plugin wins for matching onLoad filters. Register a direct
// .svelte / .svelte.ts loader BEFORE the standard SveltePlugin: we compile
// in 'client' mode (needed so Svelte 5's `mount()` is the real one, not
// the index-server.js stub) AND we skip the `import "bun-svelte:*.css"`
// virtual-module trick the standard plugin adds. At runtime bun does NOT
// invoke plugin.onResolve for bare specifiers like `bun-svelte:foo.css`,
// so leaving the import in causes "Cannot find package". Scoped CSS isn't
// needed during component-level unit tests — those assertions live in
// svelte-build.test.ts (CSS extraction) and popup-html.test.ts (built
// bundle).
plugin({
  name: 'booster-svelte-test-loader',
  setup(builder) {
    builder.onLoad({ filter: /\.svelte$/ }, async (args) => {
      const src = readFileSync(args.path, 'utf-8');
      const out = compile(src, {
        generate: 'client',
        dev: true,
        filename: args.path,
        css: 'injected', // bundle scoped CSS into JS (no virtual import)
      });
      return { contents: out.js.code, loader: 'js' };
    });
    builder.onLoad({ filter: /\.svelte\.[tj]s$/ }, async (args) => {
      let src = readFileSync(args.path, 'utf-8');
      if (args.path.endsWith('.ts')) {
        const ts = new Bun.Transpiler({ loader: 'ts' });
        src = await ts.transform(src);
      }
      const out = compileModule(src, {
        generate: 'client',
        dev: true,
        filename: args.path,
      });
      return { contents: out.js.code, loader: 'js' };
    });
  },
});

// Keep SveltePlugin registered as a fallback / legacy hook — some tests
// (build-popup.test.ts, popup-html.test.ts, svelte-build.test.ts) call
// `buildSveltePopup` which invokes `Bun.build` with its own plugin set,
// independent of this preload. Leaving this registered is a no-op for
// `.svelte` / `.svelte.ts` because the booster-svelte-test-loader above is
// already registered first and wins the onLoad race.
plugin(SveltePlugin({ development: true, forceSide: 'client' }));

// Asset-define stubs for popup-svelte/lib/icons.ts. Production substitution
// happens at build-time via Bun.build({define:…}); for `bun test` these
// constants are evaluated at module-init time and would otherwise throw
// `ReferenceError: __SB_ICON_BOX__ is not defined`. Empty strings are fine
// — icons are not exercised by component-level state tests (those tests
// query state, not SVG payloads). svelte-build.test.ts continues to
// produce the real strings via the dedicated buildSveltePopup pipeline.
for (const name of [
  '__SB_ICON_BOX__', '__SB_ICON_CHECK__', '__SB_ICON_CHEVRON_DOWN__',
  '__SB_ICON_CLOSE__',
  '__SB_ICON_GEAR__', '__SB_ICON_SAFETY__', '__SB_ICON_SETTINGS__',
  '__SB_ICON_SUPPORT__', '__SB_IMG_LOGO_DATA_URI__',
]) {
  if ((globalThis as any)[name] === undefined) (globalThis as any)[name] = '';
}
