import { test, expect, beforeEach } from 'bun:test';
import { Window } from 'happy-dom';
import { openErrorModal } from '../src/components/error-modal';

beforeEach(() => {
  const w = new Window({ url: 'https://store.steampowered.com/app/570/' });
  (w as unknown as { SyntaxError: typeof SyntaxError }).SyntaxError = SyntaxError;
  Object.assign(globalThis, {
    document: w.document,
    HTMLElement: w.HTMLElement,
    HTMLButtonElement: w.HTMLButtonElement,
    KeyboardEvent: w.KeyboardEvent,
    Event: w.Event,
  });
});

const overlay = () => document.getElementById('booster-error-modal-overlay');

test('opening appends an overlay with the message in the body', () => {
  openErrorModal('Платёжный метод недоступен');
  const o = overlay();
  expect(o).not.toBeNull();
  expect(o!.querySelector('.booster-error-body')!.textContent).toBe('Платёжный метод недоступен');
  expect(o!.querySelector('.booster-error-title')!.textContent).toBe('Упс!');
});

test('Close button removes the overlay', () => {
  openErrorModal('boom');
  overlay()!.querySelector<HTMLButtonElement>('.booster-error-close-btn')!.dispatchEvent(new Event('click'));
  expect(overlay()).toBeNull();
});

test('corner × removes the overlay', () => {
  openErrorModal('boom');
  overlay()!.querySelector<HTMLButtonElement>('.booster-error-close-x')!.dispatchEvent(new Event('click'));
  expect(overlay()).toBeNull();
});

test('Esc keydown removes the overlay', () => {
  openErrorModal('boom');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(overlay()).toBeNull();
});

test('backdrop click (directly on overlay) removes it; click on card does not', () => {
  openErrorModal('boom');
  const o = overlay()!;
  // Click on the card itself — must NOT close.
  o.querySelector('.booster-error-card')!.dispatchEvent(new Event('click', { bubbles: true }));
  expect(overlay()).not.toBeNull();
  // Click directly on the backdrop — closes.
  o.dispatchEvent(new Event('click', { bubbles: false }));
  expect(overlay()).toBeNull();
});

test('CRLF in the message is normalized to LF', () => {
  openErrorModal('line1\r\nline2');
  expect(overlay()!.querySelector('.booster-error-body')!.textContent).toBe('line1\nline2');
});

test('second open replaces the first (single instance)', () => {
  openErrorModal('first');
  openErrorModal('second');
  expect(document.querySelectorAll('#booster-error-modal-overlay').length).toBe(1);
  expect(overlay()!.querySelector('.booster-error-body')!.textContent).toBe('second');
});

test('replace path tears the prior modal down fully — no lingering Esc listener', () => {
  openErrorModal('first');
  openErrorModal('second');
  // Esc closes the single live modal…
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(overlay()).toBeNull();
  // …and a further Esc is an inert no-op (the replaced modal's listener is gone,
  // so nothing throws and no overlay is resurrected).
  expect(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))).not.toThrow();
  expect(overlay()).toBeNull();
});
