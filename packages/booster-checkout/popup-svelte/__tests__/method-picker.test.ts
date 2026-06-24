// booster-plugins/packages/booster-checkout/popup-svelte/__tests__/method-picker.test.ts
//
// DOM-render tests for the dynamic-methods MethodPicker. Mounts the
// full popup via renderPopup() (the only sanctioned way to drive
// Svelte 5 mount in bun:test — see popup-render-helper.ts).

import { test, expect, afterEach } from 'bun:test';
import { renderPopup, closeAllPopups } from '../../tests/popup-render-helper';

afterEach(() => { closeAllPopups(); });

const m1 = { type: 'paypalych-sbp',  name: 'СБП',   imageUrl: 'https://x/sbp.svg' };
const m2 = { type: 'paypalych-card', name: 'Карта', imageUrl: 'https://x/visa.svg', badge: '~0%' };

async function seedInit(h: Awaited<ReturnType<typeof renderPopup>>): Promise<void> {
  h.postFromMain({ kind: 'init', login: 'u',
                   currency: 'RUB', balance: 0,
                   urls: { support: '', popupLogoLink: '',
                           balanceCalcApi: 'https://test.local/api/balance/calc',
                           balanceAddApi:  'https://test.local/api/balance/add' } });
  h.postFromMain({ kind: 'email', email: 'u@example' });
  await h.flush();
}

test('MethodPicker renders methods with name + <img> after BC payment-methods inbound', async () => {
  const h = await renderPopup();
  await seedInit(h);
  h.postFromMain({ kind: 'payment-methods',
                   methods: [m1, m2], loading: false, error: null });
  await h.flush();

  const trigger = h.document.querySelector('.picker .trigger') as HTMLElement | null;
  expect(trigger).not.toBeNull();
  // Selected (first) method's icon visible on trigger.
  const triggerImg = trigger!.querySelector('img');
  expect(triggerImg).not.toBeNull();
  expect(triggerImg!.getAttribute('src')).toBe('https://x/sbp.svg');
  expect(triggerImg!.getAttribute('alt')).toBe('СБП');

  // Open the dropdown.
  (trigger as unknown as HTMLButtonElement).click();
  await h.flush();

  const items = h.document.querySelectorAll('.picker .menu .item');
  expect(items.length).toBe(2);

  // Badge present on m2 only.
  const badges = h.document.querySelectorAll('.picker .menu .badge');
  expect(badges.length).toBe(1);
  expect(badges[0].textContent?.trim()).toBe('~0%');
});

test('MethodPicker shows spinner inside .icon when methods empty + loading + pastThreshold', async () => {
  // The 300 ms gate is driven by App.svelte's $effect (cluster 5b).
  // For this task — testing the PICKER template — we drive `loading=true`
  // + `methods=[]`, then wait past 300 ms so the App.svelte $effect
  // flips pastThreshold to true.
  const h = await renderPopup();
  await seedInit(h);
  h.postFromMain({ kind: 'payment-methods',
                   methods: [], loading: true, error: null });
  await h.flush(350);

  const spinner = h.document.querySelector('.picker .spinner');
  expect(spinner).not.toBeNull();
});

test('MethodPicker hides spinner before 300 ms gate', async () => {
  // App.svelte's pastThreshold $effect should NOT have fired yet at
  // 50 ms — the picker stays plain (icon empty, no spinner).
  const h = await renderPopup();
  await seedInit(h);
  h.postFromMain({ kind: 'payment-methods',
                   methods: [], loading: true, error: null });
  await h.flush(50);

  const spinner = h.document.querySelector('.picker .spinner');
  expect(spinner).toBeNull();
});

test('Selected menu item carries a check mark; unselected does not', async () => {
  // Figma 245:347 payment-method-selector: the lit row is marked with
  // an 8x6 white check icon at the right edge (--booster-radius-md group:
  // 245:366). Unselected rows have no such mark. This pins both: the
  // selected row has exactly one .check, the unselected row has zero.
  const h = await renderPopup();
  await seedInit(h);
  h.postFromMain({ kind: 'payment-methods',
                   methods: [m1, m2], loading: false, error: null });
  await h.flush();

  (h.document.querySelector('.picker .trigger') as HTMLButtonElement | null)?.click();
  await h.flush();

  const items = h.document.querySelectorAll('.picker .menu .item');
  expect(items.length).toBe(2);
  // First item (m1) is the seeded-default selection — should be active +
  // carry the check.
  expect(items[0].classList.contains('active')).toBe(true);
  expect(items[0].querySelectorAll('.check').length).toBe(1);
  // Second item is unselected — no check.
  expect(items[1].classList.contains('active')).toBe(false);
  expect(items[1].querySelectorAll('.check').length).toBe(0);

  // Switching selection moves the check.
  ((items[1] as HTMLElement).querySelector('button') as HTMLButtonElement).click();
  await h.flush();
  // Reopen dropdown — clicking an item closes it via App.svelte.
  (h.document.querySelector('.picker .trigger') as HTMLButtonElement | null)?.click();
  await h.flush();

  const items2 = h.document.querySelectorAll('.picker .menu .item');
  expect(items2[0].querySelectorAll('.check').length).toBe(0);
  expect(items2[1].querySelectorAll('.check').length).toBe(1);
});

test('Clicking a menu item changes the selected method', async () => {
  const h = await renderPopup();
  await seedInit(h);
  h.postFromMain({ kind: 'payment-methods',
                   methods: [m1, m2], loading: false, error: null });
  await h.flush();

  (h.document.querySelector('.picker .trigger') as HTMLButtonElement | null)?.click();
  await h.flush();

  const items = h.document.querySelectorAll('.picker .menu .item button');
  (items[1] as HTMLButtonElement).click();
  await h.flush();

  const triggerImg = h.document.querySelector('.picker .trigger img');
  expect(triggerImg?.getAttribute('src')).toBe('https://x/visa.svg');
  expect(triggerImg?.getAttribute('alt')).toBe('Карта');
});
