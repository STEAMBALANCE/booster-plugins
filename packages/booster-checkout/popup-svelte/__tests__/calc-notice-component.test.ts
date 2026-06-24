// booster-plugins/packages/booster-checkout/popup-svelte/__tests__/calc-notice-component.test.ts
//
// Component-level tests for bug #1 (data.notice on pay button). Mounts
// the real App.svelte via renderPopup(), drives state via inbound BC
// messages + direct ui.calc mutation, inspects rendered DOM.

import { test, expect, afterEach } from 'bun:test';
import { renderPopup, closeAllPopups } from '../../tests/popup-render-helper';
import { ui } from '../lib/state.svelte';
import { _flushDesiredCommitForTest } from '../lib/desired-debounce';

afterEach(() => { closeAllPopups(); });

async function seedInit(h: Awaited<ReturnType<typeof renderPopup>>): Promise<void> {
  h.postFromMain({ kind: 'init', login: 'demo',
                   currency: 'RUB', balance: 2500.00,
                   urls: { support: '', popupLogoLink: '',
                           balanceCalcApi: '', balanceAddApi: '' } });
  h.postFromMain({ kind: 'email', email: 'u@x' });
  h.postFromMain({ kind: 'payment-methods',
                   methods: [{ type: 'sbp', name: 'СБП', imageUrl: '' }],  // strings-allow-cyrillic
                   loading: false, error: null });
  await h.flush();
}

// Helper: simulate "backend has responded with this calc". Setting
// ui.calc alone is not enough now that scheduleCalc flips
// ui.calcLoading=true synchronously on every ui.amount mutation —
// tests must also clear the loading flag to assert post-response
// state (label, disabled). The leading flush drains any $effect
// queued by a prior ui.amount mutation (which would otherwise re-
// set calcLoading=true after we clear it).
async function settleCalc(h: Awaited<ReturnType<typeof renderPopup>>, calc: typeof ui.calc): Promise<void> {
  await h.flush();
  ui.calc = calc;
  ui.calcLoading = false;
  ui.calcError = null;
  await h.flush();
}

test('R1: notice rendered on pay button when present', async () => {
  const h = await renderPopup();
  await seedInit(h);
  ui.amount = 10;
  await settleCalc(h, {
    amount: 55.11, amountToBalance: 50.1,
    amountToBalanceUSD: 0.68, amountToBalanceKZT: 319.6,
    minAmount: 50, maxAmount: 15000,
    notice: 'Минимальная сумма: 50 ₽',  // strings-allow-cyrillic
  });
  const btn = h.document.querySelector('button.pay') as HTMLButtonElement;
  expect(btn).not.toBeNull();
  expect(btn.textContent?.trim()).toBe('Минимальная сумма: 50 ₽');  // strings-allow-cyrillic
  expect(btn.disabled).toBe(true);
});

test('R4: receive/total degrade to "—" / balance-only when notice set', async () => {
  const h = await renderPopup();
  await seedInit(h);
  ui.amount = 10;
  ui.calc = {
    amount: 55.11, amountToBalance: 50.1,
    amountToBalanceUSD: 0.68, amountToBalanceKZT: 319.6,
    minAmount: 50, maxAmount: 15000,
    notice: 'Минимальная сумма: 50 ₽',  // strings-allow-cyrillic
  };
  await h.flush();
  const rows = h.document.querySelectorAll('.info-rows .row');
  const receiveEl = rows[1]?.querySelector('.value');
  expect(receiveEl?.textContent?.trim()).toBe('—');
  // The TotalBox is now editable; in pay-mode + notice, the input shows
  // empty (no derived total) with placeholder '—'.
  const totalInput = h.document.querySelector('input.desired-input') as HTMLInputElement;
  expect(totalInput).not.toBeNull();
  expect(totalInput.value).toBe('');
  expect(totalInput.placeholder).toBe('—');
});

test('R5: ready label and enabled button when calc lacks notice', async () => {
  const h = await renderPopup();
  await seedInit(h);
  ui.amount = 1000;
  await settleCalc(h, {
    amount: 1100, amountToBalance: 1000,
    amountToBalanceUSD: 13, amountToBalanceKZT: 6234,
    minAmount: 50, maxAmount: 15000,
  });
  const btn = h.document.querySelector('button.pay') as HTMLButtonElement;
  expect(btn.textContent?.trim()).toBe('Оплатить 1100 ₽');  // strings-allow-cyrillic
  expect(btn.disabled).toBe(false);
  // pay-mode: input shows formatted balance + receive = 2500 + 1000 = 3500.
  // Currency suffix is in a separate <span class="suffix">; the input
  // value itself is digit-only.
  const totalInput = h.document.querySelector('input.desired-input') as HTMLInputElement;
  expect(totalInput.value).toBe('3500');
  const suffix = h.document.querySelector('.input-cell .suffix');
  expect(suffix?.textContent?.trim()).toBe('₽');
});

// === Desired-mode bidirectional binding ===

test('D1: typing in desired-input updates ui.amount via derivedPay', async () => {
  const h = await renderPopup();
  await seedInit(h);
  ui.userBalance = 2177.35;
  ui.amount = 1000;
  ui.calc = {
    amount: 1000, amountToBalance: 1000,
    amountToBalanceUSD: 13, amountToBalanceKZT: 6234,
    minAmount: 50, maxAmount: 15000,
  };
  await h.flush();
  const input = h.document.querySelector('input.desired-input') as HTMLInputElement;
  input.value = '3000';
  input.dispatchEvent(new (h.win.Event as unknown as typeof Event)('input', { bubbles: true }));
  await h.flush();
  // ui.desiredBalance + ui.lastEdited update synchronously in the
  // handler; ui.amount is debounced 500 ms. Flush the debounce
  // synchronously for the assertion.
  _flushDesiredCommitForTest();
  await h.flush();
  expect(ui.lastEdited).toBe('desired');
  expect(ui.desiredBalance).toBe(3000);
  // ceil((3000 - 2177.35) * 1.0) = 823.
  expect(ui.amount).toBe(823);
});

test('D2: typing in pay-input switches lastEdited back to "pay"', async () => {
  const h = await renderPopup();
  await seedInit(h);
  ui.userBalance = 2177.35;
  ui.amount = 1000;
  ui.lastEdited = 'desired';
  ui.desiredBalance = 3000;
  ui.calc = {
    amount: 1000, amountToBalance: 1000,
    amountToBalanceUSD: 13, amountToBalanceKZT: 6234,
    minAmount: 50, maxAmount: 15000,
  };
  await h.flush();
  const payInput = h.document.querySelector('input.amount-input') as HTMLInputElement;
  payInput.value = '500';
  payInput.dispatchEvent(new (h.win.Event as unknown as typeof Event)('input', { bubbles: true }));
  await h.flush();
  expect(ui.lastEdited).toBe('pay');
  expect(ui.amount).toBe(500);
});

test('D3a: desired === balance disables pay-button with desired_too_low label', async () => {
  const h = await renderPopup();
  await seedInit(h);
  ui.userBalance = 2500;
  await settleCalc(h, {
    amount: 1000, amountToBalance: 1000,
    amountToBalanceUSD: 13, amountToBalanceKZT: 6234,
    minAmount: 50, maxAmount: 15000,
  });
  const input = h.document.querySelector('input.desired-input') as HTMLInputElement;
  input.value = '2500';
  input.dispatchEvent(new (h.win.Event as unknown as typeof Event)('input', { bubbles: true }));
  // desired_too_low priority is HIGHER than calcLoading in payLabel,
  // so the label is correct even while the debounce/calc is pending —
  // no manual ui.calcLoading=false dance needed here.
  await h.flush();
  const btn = h.document.querySelector('button.pay') as HTMLButtonElement;
  expect(btn.textContent?.trim()).toBe('Желаемый баланс ниже текущего');  // strings-allow-cyrillic
  expect(btn.disabled).toBe(true);
});

test('D3b: 0 < desired < balance — same label and disabled', async () => {
  const h = await renderPopup();
  await seedInit(h);
  ui.userBalance = 2500;
  await settleCalc(h, {
    amount: 1000, amountToBalance: 1000,
    amountToBalanceUSD: 13, amountToBalanceKZT: 6234,
    minAmount: 50, maxAmount: 15000,
  });
  const input = h.document.querySelector('input.desired-input') as HTMLInputElement;
  input.value = '1000';                        // strictly less than balance
  input.dispatchEvent(new (h.win.Event as unknown as typeof Event)('input', { bubbles: true }));
  await h.flush();
  const btn = h.document.querySelector('button.pay') as HTMLButtonElement;
  expect(btn.textContent?.trim()).toBe('Желаемый баланс ниже текущего');  // strings-allow-cyrillic
  expect(btn.disabled).toBe(true);
});

test('D3c: desired_too_low label is shown IMMEDIATELY while typing (during debounce)', async () => {
  // Regression: previously calcLoading priority masked the desired-
  // too-low label with "Расчёт..." for the whole 400+400 ms window
  // following each keystroke. User feedback: "ввожу — зависает на
  // Расчёт... вместо ошибки". Now the desired-too-low check runs
  // BEFORE calcLoading in payLabel.
  const h = await renderPopup();
  await seedInit(h);
  ui.userBalance = 2500;
  await settleCalc(h, {
    amount: 1000, amountToBalance: 1000,
    amountToBalanceUSD: 13, amountToBalanceKZT: 6234,
    minAmount: 50, maxAmount: 15000,
  });
  const input = h.document.querySelector('input.desired-input') as HTMLInputElement;
  input.value = '30';                          // way below balance
  input.dispatchEvent(new (h.win.Event as unknown as typeof Event)('input', { bubbles: true }));
  // DO NOT flush the debounce. The label should already reflect the
  // client-side error — no need to wait for the 400 ms timer.
  await h.flush();
  expect(ui.calcLoading).toBe(true);   // ← debounce armed
  const btn = h.document.querySelector('button.pay') as HTMLButtonElement;
  expect(btn.textContent?.trim()).toBe('Желаемый баланс ниже текущего');  // strings-allow-cyrillic
  expect(btn.disabled).toBe(true);
});

test('D3d: clearing desired-input after a below-balance entry does NOT stick on "Расчёт..."', async () => {
  // Regression for the user-reported "stuck on Расчёт" bug:
  //   1. Enter desired < balance → desired_too_low label shows
  //      (ui.amount drops to 0 via the debounce → runCalc short-
  //      circuit clears calcLoading).
  //   2. Clear the input entirely → ui.desiredBalance=0. The
  //      debounced commit would write ui.amount=0 — but ui.amount
  //      is ALREADY 0, so Svelte 5's value-dedupe means the
  //      calc-driver $effect never re-fires, scheduleCalc never
  //      runs, and calcLoading=true (set by scheduleDesiredCommit)
  //      sticks forever.
  // Fix: onDesiredInput short-circuits when derivedPay() ===
  // ui.amount — cancels the debounce and clears calcLoading
  // explicitly.
  const h = await renderPopup();
  await seedInit(h);
  ui.userBalance = 2500;
  await settleCalc(h, {
    amount: 1000, amountToBalance: 1000,
    amountToBalanceUSD: 13, amountToBalanceKZT: 6234,
    minAmount: 50, maxAmount: 15000,
  });
  const input = h.document.querySelector('input.desired-input') as HTMLInputElement;

  // Step 1: type below-balance value → derivedPay=0, ui.amount goes
  // 1000 → 0 via debounce + runCalc short-circuit, calcLoading clears.
  input.value = '30';
  input.dispatchEvent(new (h.win.Event as unknown as typeof Event)('input', { bubbles: true }));
  await h.flush();
  _flushDesiredCommitForTest();
  await h.flush();
  // Simulate runCalc completing its amount<=0 early-return path:
  // clears ui.calc + calcLoading + calcError (see api.ts:runCalc).
  ui.calc = null;
  ui.calcLoading = false;
  ui.calcError = null;
  await h.flush();
  expect(ui.amount).toBe(0);
  expect(ui.calcLoading).toBe(false);

  // Step 2: clear the input → ui.desiredBalance=0. derivedPay=0
  // matches current ui.amount=0, so the short-circuit must fire:
  // calcLoading stays false, no pending debounce.
  input.value = '';
  input.dispatchEvent(new (h.win.Event as unknown as typeof Event)('input', { bubbles: true }));
  await h.flush();
  expect(ui.desiredBalance).toBe(0);
  expect(ui.amount).toBe(0);
  expect(ui.calcLoading).toBe(false);

  // Pay-button now shows default "Оплатить" (not "Расчёт..."), disabled.
  const btn = h.document.querySelector('button.pay') as HTMLButtonElement;
  expect(btn.textContent?.trim()).toBe('Оплатить');  // strings-allow-cyrillic
  expect(btn.disabled).toBe(true);
});

test('D4: unsupported currency (UAH) renders TotalBox as <span>', async () => {
  const h = await renderPopup();
  h.postFromMain({ kind: 'init', login: 'demo',
                   currency: 'UAH', balance: 100.0,
                   urls: { support: '', popupLogoLink: '',
                           balanceCalcApi: '', balanceAddApi: '' } });
  h.postFromMain({ kind: 'payment-methods',
                   methods: [{ type: 'sbp', name: 'СБП', imageUrl: '' }],  // strings-allow-cyrillic
                   loading: false, error: null });
  await h.flush();
  ui.calc = {
    amount: 1100, amountToBalance: 1000,
    amountToBalanceUSD: 13, amountToBalanceKZT: 6234,
    minAmount: 50, maxAmount: 15000,
  };
  await h.flush();
  expect(h.document.querySelector('input.desired-input')).toBeNull();
  expect(h.document.querySelector('.amount-static')).not.toBeNull();
});

// === Regression: spec C1 ===

test('C1 regression: notice does NOT lock the desired-input', async () => {
  const h = await renderPopup();
  await seedInit(h);
  ui.userBalance = 2177.35;
  ui.calc = {
    amount: 55.11, amountToBalance: 50.1,
    amountToBalanceUSD: 0.68, amountToBalanceKZT: 319.6,
    minAmount: 50, maxAmount: 15000,
    notice: 'Минимальная сумма: 50 ₽',  // strings-allow-cyrillic
  };
  await h.flush();
  // Even with notice, the input is editable and sticky value persists.
  const input = h.document.querySelector('input.desired-input') as HTMLInputElement;
  expect(input).not.toBeNull();
  expect(input.disabled).toBe(false);

  input.value = '2500';
  input.dispatchEvent(new (h.win.Event as unknown as typeof Event)('input', { bubbles: true }));
  await h.flush();
  expect(input.value).toBe('2500');
  expect(ui.desiredBalance).toBe(2500);
});

// === Regression: spec I8 ===

test('I8 regression: resetTransientUI clears desired-mode on popup hide', async () => {
  const h = await renderPopup();
  await seedInit(h);
  ui.userBalance = 2177.35;
  ui.calc = {
    amount: 1000, amountToBalance: 1000,
    amountToBalanceUSD: 13, amountToBalanceKZT: 6234,
    minAmount: 50, maxAmount: 15000,
  };
  await h.flush();
  const input = h.document.querySelector('input.desired-input') as HTMLInputElement;
  input.value = '3000';
  input.dispatchEvent(new (h.win.Event as unknown as typeof Event)('input', { bubbles: true }));
  await h.flush();
  expect(ui.lastEdited).toBe('desired');
  expect(ui.desiredBalance).toBe(3000);

  // Simulate visibility=hidden → BC 'hidden' → resetTransientUI.
  h.postFromMain({ kind: 'hidden' });
  await h.flush();
  expect(ui.lastEdited).toBe('pay');
  expect(ui.desiredBalance).toBe(0);
});

test('D5: cross-mode debounce race — typing in pay-input cancels pending desired-commit', async () => {
  // Regression for the cross-mode race: user types desired (debounce
  // armed) and within 500 ms types in pay-input. Without cancellation
  // the stale derivedPay write would clobber the user's pay value
  // ~500 ms later.
  const h = await renderPopup();
  await seedInit(h);
  ui.userBalance = 2177.35;
  ui.amount = 1000;
  ui.calc = {
    amount: 1000, amountToBalance: 1000,
    amountToBalanceUSD: 13, amountToBalanceKZT: 6234,
    minAmount: 50, maxAmount: 15000,
  };
  await h.flush();

  // Type desired '3000' — schedule debounce, do NOT flush.
  const desired = h.document.querySelector('input.desired-input') as HTMLInputElement;
  desired.value = '3000';
  desired.dispatchEvent(new (h.win.Event as unknown as typeof Event)('input', { bubbles: true }));
  await h.flush();
  expect(ui.lastEdited).toBe('desired');
  expect(ui.desiredBalance).toBe(3000);
  // ui.amount still 1000 because debounce hasn't fired.
  expect(ui.amount).toBe(1000);

  // Switch to pay-input and type 500 BEFORE the desired-commit fires.
  const payInput = h.document.querySelector('input.amount-input') as HTMLInputElement;
  payInput.value = '500';
  payInput.dispatchEvent(new (h.win.Event as unknown as typeof Event)('input', { bubbles: true }));
  await h.flush();
  expect(ui.lastEdited).toBe('pay');
  expect(ui.amount).toBe(500);

  // Now try to flush the (cancelled) desired-commit. If the cancel
  // worked, this is a no-op — ui.amount stays 500. If the cancel was
  // missing, ui.amount would jump to 823.
  _flushDesiredCommitForTest();
  await h.flush();
  expect(ui.amount).toBe(500);
  expect(ui.lastEdited).toBe('pay');
});

test('D6: KZT — min-amount notice (user-screenshot regression)', async () => {
  // Reproduces the user-screenshot scenario: KZT wallet, balance 2860,
  // desired 3000 → derivedPay = 140 KZT credit. The backend's calc
  // returns a notice "Минимальная сумма: 324 ₸" because 140 < min.
  // Asserts (a) derivedPay computes in wallet currency (no ratio
  // multiplication slip), and (b) the notice surfaces on pay-button.
  const h = await renderPopup();
  h.postFromMain({ kind: 'init', login: 'demo',
                   currency: 'KZT', balance: 2860,
                   urls: { support: '', popupLogoLink: '',
                           balanceCalcApi: '', balanceAddApi: '' } });
  h.postFromMain({ kind: 'email', email: 'u@x' });
  h.postFromMain({ kind: 'payment-methods',
                   methods: [{ type: 'sbp', name: 'СБП', imageUrl: '' }],  // strings-allow-cyrillic
                   loading: false, error: null });
  await h.flush();

  const desired = h.document.querySelector('input.desired-input') as HTMLInputElement;
  desired.value = '3000';
  desired.dispatchEvent(new (h.win.Event as unknown as typeof Event)('input', { bubbles: true }));
  await h.flush();
  _flushDesiredCommitForTest();
  await h.flush();
  expect(ui.desiredBalance).toBe(3000);
  expect(ui.amount).toBe(140);   // KZT credit, no ratio applied

  // Simulate backend notice for the below-min amount.
  await settleCalc(h, {
    amount: 25, amountToBalance: 23,
    amountToBalanceUSD: 0.3, amountToBalanceKZT: 140,
    minAmount: 50, maxAmount: 15000,
    notice: 'Минимальная сумма: 324 ₸',  // strings-allow-cyrillic
  });
  const btn = h.document.querySelector('button.pay') as HTMLButtonElement;
  expect(btn.textContent?.trim()).toBe('Минимальная сумма: 324 ₸');  // strings-allow-cyrillic
  expect(btn.disabled).toBe(true);

  // Desired-input still editable and sticky despite notice (C1 invariant).
  expect(desired.disabled).toBe(false);
  expect(desired.value).toBe('3000');
});

// derivedPay is a pure subtraction (no calc/ratio dependency), so
// in-flight-calc-overwrite and method-switch-flicker concerns from
// earlier architecture variants are gone. Existing tests cover the
// behavior: D1 (typing → ui.amount), D2 (typing pay-input → lastEdited
// flips back), D3a/D3b (desired ≤ balance → label+disabled), D5
// (cross-mode debounce cancel), D6 (KZT min-violation regression),
// C1 (notice doesn't lock input), I8 (popup-hide reset).
