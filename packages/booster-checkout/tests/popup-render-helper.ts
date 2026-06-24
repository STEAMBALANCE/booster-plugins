//
// Component-level test scaffolding for the popup Svelte tree. Mounts
// the real App.svelte into a happy-dom Window via Svelte 5's
// `mount()` API — bypasses the inline-script execution path that
// happy-dom's sandbox can't handle (Array.isArray missing inside
// <script> tags; see svelte-build.test.ts for the same caveat).
//
// Tests drive state changes via `postFromMain(data)`, which posts a
// `popup-postMessage` envelope onto the in-memory BC; bridge.ts's
// listener consumes it and mutates `ui`. This matches production: in
// real Steam, the main shell posts those envelopes via the relay.
//
// The Svelte module `App.svelte` directly imports the `ui` $state
// singleton from `lib/state.svelte`. Mounting twice across tests
// re-uses the same `ui` instance — caller MUST close + re-seed state
// between tests (see closeAllPopups).

import type { Component } from 'svelte';
import { mount, unmount } from 'svelte';
import { Window } from 'happy-dom';

// Note: under `bun test` the bare `svelte` specifier resolves to
// `index-server.js` (no `browser` condition active), which would stub
// `mount()` to throw `lifecycle_function_unavailable`. setup-svelte-plugin.ts
// installs an onLoad redirect for that path → index-client.js so the
// runtime here gets the real client `mount`/`unmount`.

import App from '../popup-svelte/App.svelte';
import { ui } from '../popup-svelte/lib/state.svelte';
import { initBridge, _resetForTest as resetBridge } from '../popup-svelte/lib/bridge';

interface MountedPopup {
  instance: ReturnType<typeof mount>;
  bc: BroadcastChannel | null;
  win: Window;
  savedGlobals: Map<string, unknown>;
}

const liveMounts: MountedPopup[] = [];

// Names of globals that installGlobals() mutates. Saved before mount, restored
// after teardown — without this the popup helper's happy-dom MessageEvent /
// Element / etc. constructors leak into other test files in the same `bun
// test` process and break tests that rely on bun's native EventTarget (e.g.
// bridge.test.ts: `EventTarget.dispatchEvent(new MessageEvent(...))` rejects a
// happy-dom MessageEvent as "not an instance of Event").
//
// MUTATED_GLOBAL_KEYS tracks every globalThis property that
// installGlobals() sets. If a Svelte component fails to mount with
// "X is not a constructor", add X here so it gets restored on
// teardown — Svelte's client runtime touches DOM constructors as
// bare globals when building template fragments, and any constructor
// happy-dom exposes but we haven't routed will surface as that error.
const MUTATED_GLOBAL_KEYS = [
  'BroadcastChannel', 'window', 'document', 'MutationObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle',
  'Element', 'HTMLElement', 'Node', 'Text', 'Comment',
  'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent',
  'KeyboardEvent', 'InputEvent', 'FocusEvent', 'MessageEvent',
  'HTMLInputElement', 'HTMLButtonElement', 'HTMLDivElement',
  'HTMLImageElement', 'HTMLAnchorElement', 'HTMLMediaElement',
  'HTMLVideoElement', 'HTMLAudioElement', 'HTMLSelectElement',
  'HTMLTextAreaElement', 'HTMLFormElement', 'HTMLLabelElement',
  'HTMLOptionElement', 'HTMLIFrameElement', 'HTMLCanvasElement',
  'HTMLTemplateElement', 'HTMLScriptElement', 'HTMLStyleElement',
  'HTMLLinkElement', 'HTMLMetaElement', 'HTMLSpanElement',
  'HTMLParagraphElement', 'HTMLHeadingElement', 'HTMLUListElement',
  'HTMLOListElement', 'HTMLLIElement', 'HTMLTableElement',
  'HTMLTableRowElement', 'HTMLTableCellElement', 'SVGElement',
  'SVGSVGElement', 'Document', 'ShadowRoot',
  'Window', 'NodeFilter', 'NodeList', 'HTMLCollection',
] as const;

export interface PopupRenderHandle {
  /** happy-dom Window the popup tree is mounted into. */
  win: Window;
  /** Convenience accessor — same as win.document. */
  document: Document;
  /** Posts a `popup-postMessage` envelope onto the popup-bridge BC.
   *  Same shape as `ui.ts → popup-postMessage` in production. */
  postFromMain(data: unknown): void;
  /** Waits N milliseconds — gives Svelte $effect / BC / microtasks
   *  a chance to settle. Default: 5 ms (plenty for synchronous BC
   *  delivery in InMemoryBC + Svelte's reactive flush). */
  flush(ms?: number): Promise<void>;
  /** Tears down this mount: unmount, close BC, reset bridge state.
   *  Idempotent — safe to call from afterEach AND inside a test. */
  close(): void;
}

// In-memory BroadcastChannel polyfill — synchronous delivery so tests
// don't need to await with arbitrary timeouts. Same shape as
// bridge.test.ts's InMemoryBC.
//
// EventTarget vs MessageEvent: `InMemoryBC extends EventTarget` binds
// against bun's native EventTarget at module-load time (BEFORE
// installGlobals overwrites globalThis.MessageEvent with happy-dom's).
// bun's EventTarget rejects a happy-dom MessageEvent ("not an instance
// of Event"), so we capture the bun-native MessageEvent here at module
// load and use that for dispatchEvent — keeping the BC dispatch path
// consistent with the EventTarget binding regardless of what
// installGlobals does to globalThis later.
const BunMessageEvent = MessageEvent;
class InMemoryBC extends EventTarget {
  static channels = new Map<string, Set<InMemoryBC>>();
  constructor(public readonly name: string) {
    super();
    let s = InMemoryBC.channels.get(name);
    if (!s) { s = new Set(); InMemoryBC.channels.set(name, s); }
    s.add(this);
  }
  postMessage(data: unknown): void {
    const peers = InMemoryBC.channels.get(this.name) ?? new Set();
    for (const p of peers) {
      if (p === this) continue;
      p.dispatchEvent(new BunMessageEvent('message', { data }));
    }
  }
  close(): void {
    InMemoryBC.channels.get(this.name)?.delete(this);
  }
}

function installGlobals(win: Window): Map<string, unknown> {
  const saved = new Map<string, unknown>();
  for (const key of MUTATED_GLOBAL_KEYS) {
    saved.set(key, (globalThis as any)[key]);
  }
  (globalThis as any).BroadcastChannel = InMemoryBC;
  (globalThis as any).window   = win;
  (globalThis as any).document = win.document;
  // happy-dom 20 leaves SyntaxError unbound; querySelector throws if absent.
  (win as unknown as { SyntaxError: typeof SyntaxError }).SyntaxError = SyntaxError;
  // MutationObserver pass-through (some Svelte primitives reference it).
  (globalThis as any).MutationObserver = (win as any).MutationObserver;
  // Svelte's client runtime touches several DOM constructors as globals
  // (Element, HTMLElement, Node, Text, Comment, DocumentFragment, plus
  // HTMLMediaElement which is referenced in svelte/internal/client/dom/
  // elements/events.js even for non-media trees) when it builds template
  // fragments. happy-dom exposes these on the Window but doesn't seed them
  // on globalThis — relay them so Svelte's internals don't see `undefined`
  // and crash with `is not a constructor`.
  for (const name of MUTATED_GLOBAL_KEYS) {
    if (name === 'BroadcastChannel' || name === 'window' || name === 'document'
        || name === 'MutationObserver' || name === 'requestAnimationFrame'
        || name === 'cancelAnimationFrame' || name === 'getComputedStyle') {
      // handled above (or below for the last three).
      continue;
    }
    const ctor = (win as any)[name];
    if (ctor !== undefined) (globalThis as any)[name] = ctor;
  }
  // requestAnimationFrame / cancelAnimationFrame — Svelte's render loop
  // schedules flushes via rAF. happy-dom provides them; route to globals.
  (globalThis as any).requestAnimationFrame =
    (win as any).requestAnimationFrame?.bind(win) ?? ((cb: any) => setTimeout(cb, 16));
  (globalThis as any).cancelAnimationFrame =
    (win as any).cancelAnimationFrame?.bind(win) ?? ((id: any) => clearTimeout(id));
  (globalThis as any).getComputedStyle =
    (win as any).getComputedStyle?.bind(win);
  return saved;
}

function restoreGlobals(saved: Map<string, unknown>): void {
  for (const [key, val] of saved) {
    if (val === undefined) delete (globalThis as any)[key];
    else (globalThis as any)[key] = val;
  }
}

function resetUiState(): void {
  // Mirror the bridge.test.ts beforeEach reset so each mount starts
  // from a clean slate. App.svelte reads these fields directly.
  ui.amount = 0;
  ui.methodId = '';
  ui.menuOpen = false;
  ui.methodOpen = false;
  ui.userLogin = '';
  ui.userCurrency = null;
  ui.userBalance = null;
  ui.urls.support = '';
  ui.urls.popupLogoLink = '';
  ui.urls.balanceCalcApi = '';
  ui.urls.balanceAddApi = '';
  ui.initSeen = false;
  ui.emailReceived = false;
  ui.pendingPay = false;
  ui.paymentMethods = [];
  ui.paymentMethodsLoading = false;
  ui.paymentMethodsError = null;
  ui.calc = null;
  ui.calcLoading = false;
  ui.calcError = null;
  ui.paySubmitting = false;
  ui.payError = null;
  // Two-way bind state introduced with the editable TotalBox.
  ui.lastEdited = 'pay';
  ui.desiredBalance = 0;
}

export async function renderPopup(): Promise<PopupRenderHandle> {
  const win = new Window();
  const savedGlobals = installGlobals(win);

  // Clear any stale BC state from prior tests.
  InMemoryBC.channels.clear();
  resetBridge();
  resetUiState();

  // Mount bridge BEFORE mounting Svelte so the App's $effect doesn't
  // race with a missing BC listener.
  initBridge();

  // Mount the Svelte app into happy-dom's document.body. App.svelte
  // takes no props.
  const target = win.document.body as unknown as HTMLElement;
  const instance = mount(App as unknown as Component, { target, props: {} });

  // Two microtasks — let App's $effect run (it calls scheduleCalc()),
  // and any synchronously-emitted BC message settle.
  await new Promise<void>(r => setTimeout(r, 0));
  await new Promise<void>(r => setTimeout(r, 0));

  const mounted: MountedPopup = { instance, bc: null, win, savedGlobals };
  liveMounts.push(mounted);

  // Peer BC used by postFromMain to inject inbound messages.
  const bc = new (globalThis as any).BroadcastChannel('sb_cmd') as BroadcastChannel;
  mounted.bc = bc;

  const handle: PopupRenderHandle = {
    win,
    document: win.document as unknown as Document,
    postFromMain(data: unknown) {
      bc.postMessage({
        kind: 'popup-postMessage',
        // Matches bridge.ts's POPUP_ID. createPluginUi auto-prefixes the
        // bare 'sb_topup' to '<plugin-id>__sb_topup' (spec H4).
        popupId: 'booster-checkout__sb_topup',
        data,
      });
    },
    async flush(ms = 5) {
      await new Promise<void>(r => setTimeout(r, ms));
    },
    close() {
      const idx = liveMounts.indexOf(mounted);
      if (idx === -1) return;
      try { unmount(instance); } catch { /* already torn down */ }
      try { bc.close(); } catch { /* already closed */ }
      liveMounts.splice(idx, 1);
      // Restore globals only when this was the last live mount — nested
      // renderPopup() calls (uncommon but possible across overlapping
      // tests in a single test file) would otherwise restore prematurely
      // and break the older mount's reactivity loop.
      if (liveMounts.length === 0) restoreGlobals(savedGlobals);
    },
  };

  return handle;
}

export function closeAllPopups(): void {
  while (liveMounts.length > 0) {
    const m = liveMounts.pop()!;
    try { unmount(m.instance); } catch { /* already torn down */ }
    try { m.bc?.close(); } catch { /* already closed */ }
    // Restore the globals captured by THIS mount. Each mount saved the
    // pre-mount snapshot, so peeling in LIFO order yields the correct
    // pre-test global state.
    restoreGlobals(m.savedGlobals);
  }
  InMemoryBC.channels.clear();
  resetBridge();
}
