import { test, expect, afterEach } from 'bun:test';
import type { Component } from 'svelte';
import { mount, unmount } from 'svelte';
import { Window } from 'happy-dom';
import PayErrorModal from '../components/PayErrorModal.svelte';

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

afterEach(() => {
  while (live.length > 0) {
    const m = live.pop()!;
    try { unmount(m.instance); } catch { /* already torn down */ }
    restoreGlobals(m.saved);
  }
});

interface ModalProps {
  message?: string;
  onClose?: () => void;
  onFaq?: () => void;
  onSupport?: () => void;
}
function renderModal(props: ModalProps = {}): { doc: Document; close: () => void } {
  const win = new Window();
  const saved = installGlobals(win);
  const target = win.document.body as unknown as HTMLElement;
  const instance = mount(PayErrorModal as unknown as Component, {
    target,
    props: {
      message: props.message ?? 'тест-ошибка',                                   // strings-allow-cyrillic
      onClose: props.onClose ?? (() => {}),
      onFaq: props.onFaq ?? (() => {}),
      onSupport: props.onSupport ?? (() => {}),
    },
  });
  const m: Mounted = { instance, win, saved };
  live.push(m);
  return {
    doc: win.document as unknown as Document,
    close: () => {
      const idx = live.indexOf(m); if (idx === -1) return;
      try { unmount(instance); } catch {}
      live.splice(idx, 1);
      if (live.length === 0) restoreGlobals(saved);
    },
  };
}

test('PayErrorModal renders title + message with line breaks', () => {
  const { doc, close } = renderModal({ message: 'строка1\r\nстрока2' });         // strings-allow-cyrillic
  expect((doc.querySelector('.pe-title')?.textContent ?? '').trim()).toBe('Упс!'); // strings-allow-cyrillic
  const body = doc.querySelector('.pe-body')?.textContent ?? '';
  expect(body).toContain('строка1');                                            // strings-allow-cyrillic
  expect(body).toContain('строка2');                                            // strings-allow-cyrillic
  close();
});

test('PayErrorModal close X fires onClose', () => {
  let closed = 0;
  const { doc, close } = renderModal({ onClose: () => { closed++; } });
  (doc.querySelector('.pe-close') as HTMLButtonElement).click();
  expect(closed).toBe(1);
  close();
});

test('PayErrorModal FAQ + support buttons fire their handlers', () => {
  let faq = 0, sup = 0;
  const { doc, close } = renderModal({ onFaq: () => { faq++; }, onSupport: () => { sup++; } });
  const btns = Array.from(doc.querySelectorAll('.pe-btn')) as HTMLButtonElement[];
  expect(btns.length).toBe(2);
  btns[0].click();  // FAQ
  btns[1].click();  // support
  expect(faq).toBe(1);
  expect(sup).toBe(1);
  close();
});
