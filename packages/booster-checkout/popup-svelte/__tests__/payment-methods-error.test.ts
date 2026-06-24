// booster-plugins/packages/booster-checkout/popup-svelte/__tests__/payment-methods-error.test.ts
//
// DOM-render tests for the full-popup error screen + the App.svelte
// mode switch that mounts it. Uses renderPopup() for component-level
// integration coverage.

import { test, expect, afterEach } from 'bun:test';
import { renderPopup, closeAllPopups } from '../../tests/popup-render-helper';

afterEach(() => { closeAllPopups(); });

async function seedInit(h: Awaited<ReturnType<typeof renderPopup>>): Promise<void> {
  h.postFromMain({ kind: 'init', login: 'u',
                   currency: 'RUB', balance: 0,
                   urls: { support: '', popupLogoLink: '',
                           balanceCalcApi: 'https://test.local/api/balance/calc',
                           balanceAddApi:  'https://test.local/api/balance/add' } });
  h.postFromMain({ kind: 'email', email: 'u@example' });
  await h.flush();
}

test('error screen renders title + subtitle + Обновить button on hard failure', async () => {
  const h = await renderPopup();
  await seedInit(h);
  h.postFromMain({
    kind: 'payment-methods', methods: [], loading: false, error: 'network',
  });
  await h.flush();

  const text = h.document.body.textContent ?? '';
  expect(text).toContain('Не удалось загрузить методы оплаты');
  expect(text).toContain('Попробуйте позже');

  const btn = Array.from(h.document.querySelectorAll('button'))
    .find(b => b.textContent?.trim() === 'Обновить');
  expect(btn).toBeDefined();
});

test('error screen replaces the normal body (no AmountRow / .pay button)', async () => {
  const h = await renderPopup();
  await seedInit(h);
  h.postFromMain({
    kind: 'payment-methods', methods: [], loading: false, error: 'network',
  });
  await h.flush();

  // Pay button shouldn't render in error mode.
  const pay = h.document.querySelector('.pay');
  expect(pay).toBeNull();
  // .picker (MethodPicker) shouldn't render either.
  expect(h.document.querySelector('.picker')).toBeNull();
});

test('normal body returns when methods load after an error', async () => {
  const h = await renderPopup();
  await seedInit(h);
  h.postFromMain({
    kind: 'payment-methods', methods: [], loading: false, error: 'network',
  });
  await h.flush();
  // Error mode confirmed.
  expect(h.document.querySelector('.pay')).toBeNull();

  // Methods arrive — mode switches back to normal body.
  h.postFromMain({
    kind: 'payment-methods',
    methods: [{ type: 'paypalych-sbp', name: 'СБП', imageUrl: 'http://x/sbp.svg' }],
    loading: false, error: null,
  });
  await h.flush();

  expect(h.document.querySelector('.pay')).not.toBeNull();
  expect(h.document.querySelector('.picker')).not.toBeNull();
});

test('clicking Обновить posts refresh-payment-methods on BC', async () => {
  // renderPopup() wipes the InMemoryBC channel registry on entry, so
  // the peer must be created AFTER the mount — otherwise it gets
  // unregistered before any postMessage delivery and never receives
  // the outbound popup-message.
  const h = await renderPopup();
  const peer = new (globalThis as any).BroadcastChannel('sb_cmd');
  const received: Array<{ kind?: string; popupId?: string; data?: any }> = [];
  peer.addEventListener('message', (e: MessageEvent) => {
    const m = e.data as any;
    if (m?.kind === 'popup-message') received.push(m);
  });

  await seedInit(h);
  h.postFromMain({
    kind: 'payment-methods', methods: [], loading: false, error: 'network',
  });
  await h.flush();

  const btn = Array.from(h.document.querySelectorAll('button'))
    .find(b => b.textContent?.trim() === 'Обновить') as HTMLButtonElement | undefined;
  expect(btn).toBeDefined();
  btn!.click();
  await h.flush();

  const refresh = received.find(m =>
    m?.popupId === 'booster-checkout__sb_topup' && m?.data?.kind === 'refresh-payment-methods');
  expect(refresh).toBeDefined();

  peer.close();
});

test('error screen does NOT render while methods are present (stale-while-revalidate)', async () => {
  // Verifies the spec's "showErrorScreen requires methods empty AND
  // error non-null" — a non-empty cache shouldn't surface the error
  // screen even if the API call later fails.
  const h = await renderPopup();
  await seedInit(h);
  h.postFromMain({
    kind: 'payment-methods',
    methods: [{ type: 'paypalych-sbp', name: 'СБП', imageUrl: 'http://x/sbp.svg' }],
    loading: false, error: 'transient',
  });
  await h.flush();

  const text = h.document.body.textContent ?? '';
  expect(text).not.toContain('Не удалось загрузить методы оплаты');
  expect(h.document.querySelector('.pay')).not.toBeNull();
});
