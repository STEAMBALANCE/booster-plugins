// booster-plugins/packages/booster-checkout/popup-svelte/__tests__/TotalBox.test.ts
//
// Component-level tests for the editable TotalBox. Two render modes:
//   - editable: <input> with green text + green currency suffix
//   - read-only: <span> showing derived total, no caret
// Plus event wiring for onInput.

import { test, expect, afterEach } from 'bun:test';
import { mount, unmount } from 'svelte';
import { Window } from 'happy-dom';
import TotalBox from '../components/TotalBox.svelte';

const MUTATED_GLOBAL_KEYS = [
  'window', 'document', 'MutationObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle',
  'Element', 'HTMLElement', 'Node', 'Text', 'Comment',
  'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent',
  'KeyboardEvent', 'InputEvent', 'FocusEvent', 'MessageEvent',
  'HTMLInputElement', 'HTMLButtonElement', 'HTMLDivElement',
  'HTMLImageElement', 'HTMLAnchorElement', 'HTMLSpanElement',
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
  // Patch SyntaxError onto the win instance so happy-dom's CSS selector
  // parser (SelectorParser.js) can use it for error construction.
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

function mountBox(props: Record<string, unknown>): Mounted {
  const win = new Window();
  const saved = installGlobals(win);
  const root = win.document.createElement('div');
  win.document.body.appendChild(root);
  const instance = mount(TotalBox, {
    target: root as unknown as HTMLElement,
    props,
  });
  const m: Mounted = { instance, win, saved };
  live.push(m);
  return m;
}

afterEach(() => {
  while (live.length > 0) {
    const m = live.pop()!;
    try { unmount(m.instance); } catch { /* already torn down */ }
    restoreGlobals(m.saved);
  }
});

test('editable=true: renders <input>', () => {
  const m = mountBox({
    label: 'Итого',
    displayValue: '3000',
    currencySymbol: '₽',
    editable: true,
    placeholder: 'Желаемый баланс',
    onInput: () => {},
    onCommit: () => {},
  });
  const input = m.win.document.querySelector('input.desired-input');
  expect(input).not.toBeNull();
});

test('editable=false: renders <span>, no input', () => {
  const m = mountBox({
    label: 'Итого',
    displayValue: '—',
    currencySymbol: '',
    editable: false,
    placeholder: '—',
    onInput: () => {},
    onCommit: () => {},
  });
  const input = m.win.document.querySelector('input.desired-input');
  expect(input).toBeNull();
  const span = m.win.document.querySelector('.amount-static');
  expect(span).not.toBeNull();
  expect(span?.textContent?.trim()).toBe('—');
});

test('editable=true: input.value equals displayValue', () => {
  const m = mountBox({
    label: 'Итого',
    displayValue: '3000',
    currencySymbol: '₽',
    editable: true,
    placeholder: 'Желаемый баланс',
    onInput: () => {},
    onCommit: () => {},
  });
  const input = m.win.document.querySelector('input.desired-input') as unknown as HTMLInputElement;
  expect(input.value).toBe('3000');
});

test('editable=true: typing fires onInput with parsed value', () => {
  let received: number | null = null;
  const m = mountBox({
    label: 'Итого',
    displayValue: '',
    currencySymbol: '₽',
    editable: true,
    placeholder: 'Желаемый баланс',
    onInput: (n: number) => { received = n; },
    onCommit: () => {},
  });
  const input = m.win.document.querySelector('input.desired-input') as unknown as HTMLInputElement;
  input.value = '500';
  input.dispatchEvent(new (m.win.Event as unknown as typeof Event)('input', { bubbles: true }));
  expect(received).toBe(500);
});

test('editable=true: blur fires onCommit', () => {
  let committed = 0;
  const m = mountBox({
    label: 'Итого',
    displayValue: '500',
    currencySymbol: '₽',
    editable: true,
    placeholder: 'Желаемый баланс',
    onInput: () => {},
    onCommit: () => { committed++; },
  });
  const input = m.win.document.querySelector('input.desired-input') as unknown as HTMLInputElement;
  input.dispatchEvent(new (m.win.Event as unknown as typeof Event)('change', { bubbles: true }));
  expect(committed).toBe(1);
});

test('label cell contains the label prop', () => {
  const m = mountBox({
    label: 'Итого на балансе будет',  // strings-allow-cyrillic
    displayValue: '1000',
    currencySymbol: '₽',
    editable: false,
    placeholder: '—',
    onInput: () => {},
    onCommit: () => {},
  });
  const label = m.win.document.querySelector('.label');
  expect(label?.textContent?.trim()).toBe('Итого на балансе будет');  // strings-allow-cyrillic
});

test('suffix renders currency symbol in BOTH editable and read-only mode', () => {
  // Editable mode: suffix visible alongside <input>.
  const m1 = mountBox({
    label: 'Итого', displayValue: '1000', currencySymbol: '₽',
    editable: true, placeholder: '', onInput: () => {}, onCommit: () => {},
  });
  expect(m1.win.document.querySelector('.suffix')?.textContent?.trim()).toBe('₽');

  // Read-only mode: suffix still visible (mirrors old "100 ₽" string).
  const m2 = mountBox({
    label: 'Итого', displayValue: '1000', currencySymbol: '₴',
    editable: false, placeholder: '—', onInput: () => {}, onCommit: () => {},
  });
  expect(m2.win.document.querySelector('.suffix')?.textContent?.trim()).toBe('₴');
});

test('editable=true: focus selects full text; first keystroke replaces it', () => {
  const onInputCalls: number[] = [];
  const m = mountBox({
    label: 'Итого',                                   // strings-allow-cyrillic
    displayValue: '1234.56',                          // pay-mode derived (KZT)
    currencySymbol: '$',
    editable: true,
    placeholder: '',
    onInput: (v: number) => onInputCalls.push(v),
    onCommit: () => {},
  });
  // mountBox returns {instance, win, saved} — query via m.win.document.
  const input = m.win.document.querySelector('input.desired-input') as HTMLInputElement;
  expect(input).toBeTruthy();

  // Focus triggers select-all (Layer 1 of Bug 1 fix).
  input.focus();
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(input.value.length);

  // Simulate browser's "replace selection on first key" — set value
  // to the new char, dispatch input. happy-dom drives oninput.
  // Construct the Event from m.win (happy-dom Window) for DOM-consistency.
  input.value = '7';
  input.dispatchEvent(new (m.win as unknown as { Event: typeof Event }).Event('input', { bubbles: true }));

  // Parser saw "7" → integer 7 → onInput(7).
  expect(onInputCalls).toEqual([7]);
});
