import { test, expect, afterEach } from 'bun:test';
import { renderPopup, closeAllPopups } from '../../tests/popup-render-helper';
import { ui } from '../lib/state.svelte';

afterEach(() => { closeAllPopups(); });

test('App shows PayErrorModal when ui.payError is set, over the popup', async () => {
  const h = await renderPopup();
  ui.payError = 'строка1\r\nстрока2';                                            // strings-allow-cyrillic
  await h.flush();
  expect(h.document.querySelector('.pe-overlay')).toBeTruthy();
  expect((h.document.querySelector('.pe-title')?.textContent ?? '').trim()).toBe('Упс!'); // strings-allow-cyrillic
  expect(h.document.querySelector('.pe-body')?.textContent ?? '').toContain('строка2'); // strings-allow-cyrillic
  h.close();
});

test('App close X clears payError (modal disappears)', async () => {
  const h = await renderPopup();
  ui.payError = 'boom';
  await h.flush();
  (h.document.querySelector('.pe-close') as HTMLButtonElement).click();
  await h.flush();
  expect(ui.payError).toBeNull();
  expect(h.document.querySelector('.pe-overlay')).toBeNull();
  h.close();
});

test('App FAQ button clears payError and posts a faq message', async () => {
  const h = await renderPopup();
  const seen: any[] = [];
  const peer = new BroadcastChannel('sb_cmd');
  peer.addEventListener('message', (e: any) => seen.push(e.data));
  ui.payError = 'boom';
  await h.flush();
  const btns = Array.from(h.document.querySelectorAll('.pe-btn')) as HTMLButtonElement[];
  btns[0].click();  // FAQ
  await h.flush();
  expect(ui.payError).toBeNull();
  expect(seen.some(m => m?.kind === 'popup-message' && m?.data?.kind === 'faq')).toBe(true);
  peer.close(); h.close();
});

test('App support button clears payError and posts a support message', async () => {
  const h = await renderPopup();
  const seen: any[] = [];
  const peer = new BroadcastChannel('sb_cmd');
  peer.addEventListener('message', (e: any) => seen.push(e.data));
  ui.payError = 'boom';
  await h.flush();
  const btns = Array.from(h.document.querySelectorAll('.pe-btn')) as HTMLButtonElement[];
  btns[1].click();  // support
  await h.flush();
  expect(ui.payError).toBeNull();
  expect(seen.some(m => m?.kind === 'popup-message' && m?.data?.kind === 'support')).toBe(true);
  peer.close(); h.close();
});
