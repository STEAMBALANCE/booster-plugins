// booster-plugins/packages/booster-checkout/popup-svelte/__tests__/header.test.ts
//
// Reactive-logo tests for Header.svelte: <a href={ui.urls.popupLogoLink}>
// when the URL is set, <span aria-disabled="true"> in the pre-init
// window when it's empty.
//
// Component-level rendering uses Svelte 5's `mount()` directly into a
// happy-dom Window — same approach as menu-dropdown.test.ts. The
// MUTATED_GLOBAL_KEYS list bridges happy-dom's Window-instance
// constructors onto globalThis so Svelte's component runtime can find
// them.

import { test, expect, afterEach } from 'bun:test';
import type { Component } from 'svelte';
import { mount, unmount } from 'svelte';
import { Window } from 'happy-dom';
import Header from '../components/Header.svelte';
import { ui } from '../lib/state.svelte';
import { URLS } from '../../src/urls';

// Mirror the DOM-constructor list popup-render-helper / menu-dropdown
// test use so Svelte's runtime sees a fully-stocked globalThis.
const MUTATED_GLOBAL_KEYS = [
  'window', 'document', 'MutationObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle',
  'Element', 'HTMLElement', 'Node', 'Text', 'Comment',
  'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent',
  'KeyboardEvent', 'InputEvent', 'FocusEvent', 'MessageEvent',
  'HTMLInputElement', 'HTMLButtonElement', 'HTMLDivElement',
  'HTMLImageElement', 'HTMLAnchorElement', 'HTMLSpanElement',
  'HTMLUListElement', 'HTMLLIElement',
  // HTMLMediaElement: not used by Header.svelte today, but kept in
  // sync with TotalBox.test.ts where Svelte 5's onfocus runtime path
  // references it. Defensive — the next handler added to Header.svelte
  // won't trip the same `ReferenceError: HTMLMediaElement is not
  // defined` we hit in commit 2c67f9f.
  'HTMLMediaElement',
  'SVGElement', 'SVGSVGElement',
] as const;

interface Mounted {
  instance: ReturnType<typeof mount>;
  win: Window;
  saved: Map<string, unknown>;
}
const live: Mounted[] = [];

function installGlobals(win: Window): Map<string, unknown> {
  const saved = new Map<string, unknown>();
  for (const key of MUTATED_GLOBAL_KEYS) saved.set(key, (globalThis as any)[key]);
  (globalThis as any).window = win;
  (globalThis as any).document = win.document;
  (win as unknown as { SyntaxError: typeof SyntaxError }).SyntaxError = SyntaxError;
  (globalThis as any).MutationObserver = (win as any).MutationObserver;
  for (const name of MUTATED_GLOBAL_KEYS) {
    if (name === 'window' || name === 'document' || name === 'MutationObserver'
        || name === 'requestAnimationFrame' || name === 'cancelAnimationFrame'
        || name === 'getComputedStyle') continue;
    const ctor = (win as any)[name];
    if (ctor !== undefined) (globalThis as any)[name] = ctor;
  }
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

function renderHeader(): { win: Window; doc: Document; close: () => void } {
  const win = new Window();
  const saved = installGlobals(win);
  const target = win.document.body as unknown as HTMLElement;
  const instance = mount(Header as unknown as Component, {
    target,
    props: { menuOpen: false, onMenuToggle: () => {} },
  });
  const m: Mounted = { instance, win, saved };
  live.push(m);
  return {
    win,
    doc: win.document as unknown as Document,
    close: () => {
      const idx = live.indexOf(m);
      if (idx === -1) return;
      try { unmount(instance); } catch { /* already torn down */ }
      live.splice(idx, 1);
      if (live.length === 0) restoreGlobals(saved);
    },
  };
}

afterEach(() => {
  while (live.length > 0) {
    const m = live.pop()!;
    try { unmount(m.instance); } catch { /* already torn down */ }
    restoreGlobals(m.saved);
  }
  // Reset ui.urls so per-test seeding starts from a clean slate.
  ui.urls.support = '';
  ui.urls.popupLogoLink = '';
  ui.urls.balanceCalcApi = '';
  ui.urls.balanceAddApi = '';
});

test('Header: renders <a> with href when popupLogoLink url present', () => {
  ui.urls.popupLogoLink = 'https://example.test/site';
  const { doc, close } = renderHeader();

  const anchor = doc.querySelector('a.logo-link') as HTMLAnchorElement | null;
  expect(anchor).not.toBeNull();
  expect(anchor?.getAttribute('href')).toBe('https://example.test/site');
  expect(anchor?.getAttribute('target')).toBe('_blank');
  expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
  expect(doc.querySelector('span.logo-link')).toBeNull();
  close();
});

test('Header: renders <span aria-disabled> when popupLogoLink empty', () => {
  ui.urls.popupLogoLink = '';
  const { doc, close } = renderHeader();

  expect(doc.querySelector('a.logo-link')).toBeNull();
  const span = doc.querySelector('span.logo-link');
  expect(span).not.toBeNull();
  expect(span?.getAttribute('aria-disabled')).toBe('true');
  close();
});

test('Header: logo inert before init, becomes active after init (reactive transition)', async () => {
  // Pre-init: ui.urls.popupLogoLink is empty → <span aria-disabled>. After
  // BC init lands (popup-side bridge assigns ui.urls.popupLogoLink from the
  // main-shell-forwarded urls block), Svelte's reactivity must swap the
  // {#if} branch to the <a> element without remount. This test exercises
  // that transition directly via ui.urls.popupLogoLink mutation (the same
  // mutation bridge.ts performs on receiving {kind:'init'}).
  ui.urls.popupLogoLink = '';   // pre-init state
  const { doc, close } = renderHeader();

  // Span rendered initially.
  expect(doc.querySelector('span.logo-link')).not.toBeNull();
  expect(doc.querySelector('a.logo-link')).toBeNull();

  // BC init lands — reactivity should swap to <a>. Flush microtasks
  // (Svelte effects) + DOM update (setTimeout 0), matching the pattern
  // popup-render-helper uses for post-mount settles.
  ui.urls.popupLogoLink = 'https://example.test/site';
  await new Promise(resolve => queueMicrotask(resolve));
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(doc.querySelector('a.logo-link')?.getAttribute('href')).toBe('https://example.test/site');
  expect(doc.querySelector('span.logo-link')).toBeNull();
  close();
});

test('URLS.popupLogoLink is the brand site home, not an image asset (regression)', () => {
  // The logo link's href is ui.urls.popupLogoLink, forwarded from URLS.popupLogoLink.
  // A regression once shipped the logo PNG asset URL here, so clicking the
  // logo opened the image instead of the site. Guard: bare origin, no image.
  expect(URLS.popupLogoLink).toBe('https://steambalance.cc');
  expect(new URL(URLS.popupLogoLink).pathname).toBe('/');
  expect(URLS.popupLogoLink).not.toMatch(/\.(png|jpe?g|svg|webp|gif)$/i);
});
