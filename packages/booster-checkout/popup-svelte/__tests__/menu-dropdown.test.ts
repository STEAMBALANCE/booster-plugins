// booster-plugins/packages/booster-checkout/popup-svelte/__tests__/menu-dropdown.test.ts
//
// Visibility-matrix tests for MenuDropdown's three rows:
// - Support row: gated by non-empty supportUrl (existing behavior).
// - Orders row: always visible (no prop gate; tracked locally by uid).
// - Settings row: gated by showSettings prop (default false; UI not
//                  shipped this sprint, code preserved for later).
//
// Component-level rendering uses Svelte 5's `mount()` directly into a
// happy-dom Window — same approach as popup-render-helper.ts but with
// the MenuDropdown component as the mount target rather than App.svelte.

import { test, expect, afterEach } from 'bun:test';
import type { Component } from 'svelte';
import { mount, unmount } from 'svelte';
import { Window } from 'happy-dom';
import MenuDropdown from '../components/MenuDropdown.svelte';

// Mirror the DOM-constructor list popup-render-helper uses so Svelte's
// runtime sees a fully-stocked globalThis. Component-level mount needs
// Element/Node/Text/Comment etc. on globalThis; happy-dom only exposes
// them on the Window instance.
const MUTATED_GLOBAL_KEYS = [
  'window', 'document', 'MutationObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle',
  'Element', 'HTMLElement', 'Node', 'Text', 'Comment',
  'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent',
  'KeyboardEvent', 'InputEvent', 'FocusEvent', 'MessageEvent',
  'HTMLInputElement', 'HTMLButtonElement', 'HTMLDivElement',
  'HTMLImageElement', 'HTMLAnchorElement', 'HTMLSpanElement',
  'HTMLUListElement', 'HTMLLIElement',
  // HTMLMediaElement: not used by MenuDropdown.svelte today, but kept
  // in sync with TotalBox.test.ts where Svelte 5's onfocus runtime
  // path references it. Defensive — the next handler added to
  // MenuDropdown.svelte won't trip the same ReferenceError we hit in
  // commit 2c67f9f.
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

interface RenderProps {
  supportUrl?: string;
  showSettings?: boolean;
  onSupport?: () => void;
  onOrders?: () => void;
  onSettings?: () => void;
}

function renderMenu(props: RenderProps = {}): { win: Window; doc: Document; close: () => void } {
  const win = new Window();
  const saved = installGlobals(win);
  const target = win.document.body as unknown as HTMLElement;
  const instance = mount(MenuDropdown as unknown as Component, {
    target,
    props: {
      supportUrl: props.supportUrl ?? '',
      ...(props.showSettings !== undefined ? { showSettings: props.showSettings } : {}),
      onSupport: props.onSupport ?? (() => {}),
      onOrders: props.onOrders ?? (() => {}),
      onSettings: props.onSettings ?? (() => {}),
    },
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
});

function textsOf(doc: Document, sel: string): string[] {
  return Array.from(doc.querySelectorAll(sel)).map(n => (n.textContent ?? '').trim());
}

test('MenuDropdown renders support row when supportUrl is non-empty', () => {
  const { doc, close } = renderMenu({ supportUrl: 'https://example.com/jivo' });
  const labels = textsOf(doc, '.menu .row .label');
  expect(labels).toContain('ПОДДЕРЖКА');
  close();
});

test('MenuDropdown hides support row when supportUrl is empty', () => {
  const { doc, close } = renderMenu({ supportUrl: '' });
  const labels = textsOf(doc, '.menu .row .label');
  expect(labels).not.toContain('ПОДДЕРЖКА');
  close();
});

test('MenuDropdown always renders orders row', () => {
  const { doc, close } = renderMenu({ supportUrl: '' });
  const labels = textsOf(doc, '.menu .row .label');
  expect(labels).toContain('МОИ ЗАКАЗЫ');
  close();
});

test('MenuDropdown hides settings row by default (showSettings not passed)', () => {
  const { doc, close } = renderMenu({ supportUrl: 'https://example.com/jivo' });
  const labels = textsOf(doc, '.menu .row .label');
  expect(labels).not.toContain('НАСТРОЙКИ');
  close();
});

test('MenuDropdown — orders onclick fires the handler', () => {
  let clicked = 0;
  const { doc, close } = renderMenu({
    supportUrl: '',
    onOrders: () => { clicked++; },
  });
  const rows = Array.from(doc.querySelectorAll('.menu .row')) as HTMLButtonElement[];
  const ordersBtn = rows.find(b => (b.textContent ?? '').includes('МОИ ЗАКАЗЫ'));
  expect(ordersBtn).toBeTruthy();
  ordersBtn!.click();
  expect(clicked).toBe(1);
  close();
});

test('MenuDropdown shows all three rows when support + settings are enabled', () => {
  const { doc, close } = renderMenu({
    supportUrl: 'https://example.com/jivo',
    showSettings: true,
  });
  const labels = textsOf(doc, '.menu .row .label');
  expect(labels).toContain('ПОДДЕРЖКА');
  expect(labels).toContain('МОИ ЗАКАЗЫ');
  expect(labels).toContain('НАСТРОЙКИ');
  close();
});
