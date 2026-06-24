//
// Smoke test for renderPopup: proves the helper mounts the popup
// Svelte tree without crashing, and that .root (rendered by
// App.svelte's outer wrapping div) is reachable from the document.

import { test, expect, afterEach } from 'bun:test';
import { renderPopup, closeAllPopups } from './popup-render-helper';

afterEach(() => { closeAllPopups(); });

test('renderPopup mounts without crashing and exposes the popup root', async () => {
  const h = await renderPopup();
  const root = h.document.querySelector('.root');
  expect(root).not.toBeNull();
  h.close();
});

test('renderPopup is idempotent — second mount returns a clean tree', async () => {
  const h1 = await renderPopup();
  h1.close();
  const h2 = await renderPopup();
  expect(h2.document.querySelector('.root')).not.toBeNull();
  h2.close();
});
