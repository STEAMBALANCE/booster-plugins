import { test, expect, beforeEach } from 'bun:test';
import { Window } from 'happy-dom';
import { openEmailModal, isValidEmail } from '../src/components/email-modal';

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

// --- isValidEmail unit tests ---

test('isValidEmail: valid addresses return true', () => {
  expect(isValidEmail('user@example.com')).toBe(true);
  expect(isValidEmail('a@b.co')).toBe(true);
  expect(isValidEmail('test+tag@domain.org')).toBe(true);
});

test('isValidEmail: invalid addresses return false', () => {
  expect(isValidEmail('')).toBe(false);
  expect(isValidEmail('notanemail')).toBe(false);
  expect(isValidEmail('@domain.com')).toBe(false);
  expect(isValidEmail('user@')).toBe(false);
  expect(isValidEmail('user @example.com')).toBe(false);
});

// --- openEmailModal integration tests ---

test('opening modal appends an overlay to document.body', async () => {
  const promise = openEmailModal();
  const overlay = document.getElementById('booster-email-modal-overlay');
  expect(overlay).not.toBeNull();
  // cleanup
  overlay!.querySelector<HTMLButtonElement>('.booster-email-cancel')!.dispatchEvent(new Event('click'));
  await promise;
});

test('cancel button resolves null and removes the overlay', async () => {
  const promise = openEmailModal();
  const overlay = document.getElementById('booster-email-modal-overlay');
  expect(overlay).not.toBeNull();
  overlay!.querySelector<HTMLButtonElement>('.booster-email-cancel')!.dispatchEvent(new Event('click'));
  const result = await promise;
  expect(result).toBeNull();
  expect(document.getElementById('booster-email-modal-overlay')).toBeNull();
});

test('Esc keydown on document resolves null and removes the overlay', async () => {
  const promise = openEmailModal();
  expect(document.getElementById('booster-email-modal-overlay')).not.toBeNull();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const result = await promise;
  expect(result).toBeNull();
  expect(document.getElementById('booster-email-modal-overlay')).toBeNull();
});

test('backdrop click (directly on overlay) resolves null and removes the overlay', async () => {
  const promise = openEmailModal();
  const overlay = document.getElementById('booster-email-modal-overlay');
  expect(overlay).not.toBeNull();
  // dispatch directly on the overlay (not the inner card)
  overlay!.dispatchEvent(new Event('click', { bubbles: false }));
  const result = await promise;
  expect(result).toBeNull();
  expect(document.getElementById('booster-email-modal-overlay')).toBeNull();
});

test('invalid email + confirm shows error message and does NOT resolve or remove overlay', async () => {
  let settled = false;
  const promise = openEmailModal().then(v => { settled = true; return v; });
  const overlay = document.getElementById('booster-email-modal-overlay');
  const input = overlay!.querySelector<HTMLInputElement>('input[type="email"]')!;
  const confirmBtn = overlay!.querySelector<HTMLButtonElement>('.booster-email-confirm')!;

  input.value = 'notvalid';
  confirmBtn.dispatchEvent(new Event('click'));

  // let any pending microtasks flush
  await Promise.resolve();

  expect(settled).toBe(false);
  expect(document.getElementById('booster-email-modal-overlay')).not.toBeNull();
  const errorEl = overlay!.querySelector('.booster-email-error');
  expect(errorEl).not.toBeNull();
  expect(errorEl!.textContent).toBeTruthy();

  // cleanup
  overlay!.querySelector<HTMLButtonElement>('.booster-email-cancel')!.dispatchEvent(new Event('click'));
  await promise;
});

test('valid email + confirm resolves that email and removes overlay', async () => {
  const promise = openEmailModal();
  const overlay = document.getElementById('booster-email-modal-overlay');
  const input = overlay!.querySelector<HTMLInputElement>('input[type="email"]')!;
  const confirmBtn = overlay!.querySelector<HTMLButtonElement>('.booster-email-confirm')!;

  input.value = 'test@example.com';
  confirmBtn.dispatchEvent(new Event('click'));

  const result = await promise;
  expect(result).toBe('test@example.com');
  expect(document.getElementById('booster-email-modal-overlay')).toBeNull();
});
