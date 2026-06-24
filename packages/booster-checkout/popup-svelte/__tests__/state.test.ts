// booster-plugins/packages/booster-checkout/popup-svelte/__tests__/state.test.ts
//
// Unit tests for state.svelte.ts derived helpers (currencySym, receiveAmount,
// payAmountRub, payDisabled, formatMoney). The reactive `ui` store itself
// is exercised end-to-end via bridge.test.ts.

import { test, expect, beforeEach } from 'bun:test';
import {
  ui, currencySym, receiveAmount, payAmountRub,
  payDisabled, formatMoney,
  applyPaymentMethods, _setMethodHealHandler, type PaymentMethod,
  validAmount, clampAmountToCalcBounds,
  derivedPay, derivedDesiredFromPay,
} from '../lib/state.svelte';

beforeEach(() => {
  ui.amount = 0; ui.methodId = '';
  ui.menuOpen = false; ui.methodOpen = false;
  ui.lastEdited = 'pay'; ui.desiredBalance = 0;
  ui.userLogin = ''; ui.userCurrency = null; ui.userBalance = null;
  ui.urls.support = ''; ui.urls.popupLogoLink = '';
  ui.urls.balanceCalcApi = ''; ui.urls.balanceAddApi = '';
  ui.paymentMethods = []; ui.paymentMethodsLoading = false; ui.paymentMethodsError = null;
  ui.initSeen = false; ui.emailReceived = false;
  ui.pendingPay = false;
  ui.calc = null; ui.calcLoading = false; ui.calcError = null;
  ui.paySubmitting = false;
});

test('ui.urls: defaults to 4 empty string fields', () => {
  expect(ui.urls.support).toBe('');
  expect(ui.urls.popupLogoLink).toBe('');
  expect(ui.urls.balanceCalcApi).toBe('');
  expect(ui.urls.balanceAddApi).toBe('');
});

test('ui: lastEdited defaults to "pay"', () => {
  expect(ui.lastEdited).toBe('pay');
});

test('ui: desiredBalance defaults to 0', () => {
  expect(ui.desiredBalance).toBe(0);
});

test('currencySym returns ₽ for RUB, ₸ for KZT, $ for USD', () => {
  expect(currencySym('RUB')).toBe('₽');
  expect(currencySym('KZT')).toBe('₸');
  expect(currencySym('USD')).toBe('$');
});

test('currencySym returns string fallback for unknown currency', () => {
  expect(currencySym(null)).toBe('');
  expect(currencySym('XXX')).toBe('XXX');  // unknown returns code as-is
});

test('receiveAmount returns RUB amount when user is RUB', () => {
  ui.userCurrency = 'RUB';
  ui.calc = { amount: 1100, amountToBalance: 1000, amountToBalanceUSD: 13, amountToBalanceKZT: 6234, minAmount: 50, maxAmount: 15000 };
  expect(receiveAmount()).toBe(1000);
});

test('receiveAmount returns USD amount when user is USD', () => {
  ui.userCurrency = 'USD';
  ui.calc = { amount: 1100, amountToBalance: 1000, amountToBalanceUSD: 13, amountToBalanceKZT: 6234, minAmount: 50, maxAmount: 15000 };
  expect(receiveAmount()).toBe(13);
});

test('receiveAmount returns null for non-{RUB,KZT,USD} currency (UAH wallet)', () => {
  ui.userCurrency = 'UAH';
  ui.calc = { amount: 1100, amountToBalance: 1000, amountToBalanceUSD: 13, amountToBalanceKZT: 6234, minAmount: 50, maxAmount: 15000 };
  expect(receiveAmount()).toBeNull();
});

test('payAmountRub returns calc.amount (always RUB)', () => {
  ui.calc = { amount: 1100.15, amountToBalance: 1000, amountToBalanceUSD: 13, amountToBalanceKZT: 6234, minAmount: 50, maxAmount: 15000 };
  expect(payAmountRub()).toBe(1100.15);
});

test('payDisabled true when calcLoading', () => {
  ui.amount = 100; ui.calc = { amount: 110, amountToBalance: 100, amountToBalanceUSD: 1, amountToBalanceKZT: 600, minAmount: 50, maxAmount: 15000 };
  ui.calcLoading = true;
  expect(payDisabled()).toBe(true);
});

test('payDisabled true when calcError', () => {
  ui.amount = 100; ui.calc = { amount: 110, amountToBalance: 100, amountToBalanceUSD: 1, amountToBalanceKZT: 600, minAmount: 50, maxAmount: 15000 };
  ui.calcError = 'network';
  expect(payDisabled()).toBe(true);
});

test('payDisabled false when valid + calc ready + no errors', () => {
  ui.amount = 100; ui.calc = { amount: 110, amountToBalance: 100, amountToBalanceUSD: 1, amountToBalanceKZT: 600, minAmount: 50, maxAmount: 15000 };
  // Methods must be present for pay to be enabled — submitting /api/balance/add
  // requires a non-empty paymentId, which is sourced from the active method.
  ui.paymentMethods = [{ type: 'paypalych-sbp', name: 'СБП', imageUrl: 'http://x/sbp.svg' }];
  ui.methodId = 'paypalych-sbp';
  expect(payDisabled()).toBe(false);
});

test('formatMoney 2-decimal default', () => {
  expect(formatMoney(1234.56)).toBe('1234.56');
  expect(formatMoney(100)).toBe('100');             // trailing .00 stripped
  expect(formatMoney(100.5)).toBe('100.50');        // single-decimal padded to 2
  expect(formatMoney(1234.5600000001)).toBe('1234.56'); // float drift handled
});

// applyPaymentMethods — single mutator covering first-init, normal refresh,
// backend-drop fallback, empty-list clear, and the "heal-on-arrival" calc
// re-fire (when methodId transitions "" → non-empty and amount > 0).

const m1: PaymentMethod = { type: 'paypalych-sbp',  name: 'СБП',   imageUrl: 'http://x/sbp.svg' };
const m2: PaymentMethod = { type: 'paypalych-card', name: 'Карта', imageUrl: 'http://x/visa.svg' };

test('applyPaymentMethods first-init (methodId empty) selects fresh[0]', () => {
  ui.methodId = '';
  ui.paymentMethods = [];
  applyPaymentMethods([m1, m2]);
  expect(ui.paymentMethods.length).toBe(2);
  expect(ui.methodId).toBe('paypalych-sbp');
});

test('applyPaymentMethods preserves current selection on normal refresh', () => {
  ui.methodId = 'paypalych-card';
  applyPaymentMethods([m1, m2]);
  expect(ui.methodId).toBe('paypalych-card');
});

test('applyPaymentMethods falls back to fresh[0] when backend drops current method', () => {
  ui.methodId = 'paypalych-card';
  applyPaymentMethods([m1]);
  expect(ui.methodId).toBe('paypalych-sbp');
});

test('applyPaymentMethods empty list clears methodId', () => {
  ui.methodId = 'paypalych-sbp';
  applyPaymentMethods([]);
  expect(ui.methodId).toBe('');
  expect(ui.paymentMethods.length).toBe(0);
});

test('applyPaymentMethods fires heal handler when prevMethodId="" and amount>0', () => {
  ui.methodId = '';
  ui.amount   = 1000;
  let calls = 0;
  _setMethodHealHandler(() => { calls++; });
  applyPaymentMethods([m1]);
  expect(calls).toBe(1);
  _setMethodHealHandler(null);   // restore for other tests
});

test('applyPaymentMethods does NOT fire heal handler when amount=0', () => {
  ui.methodId = '';
  ui.amount   = 0;
  let calls = 0;
  _setMethodHealHandler(() => { calls++; });
  applyPaymentMethods([m1]);
  expect(calls).toBe(0);
  _setMethodHealHandler(null);
});

test('applyPaymentMethods does NOT fire heal handler when prevMethodId was non-empty', () => {
  ui.methodId = 'paypalych-card';
  ui.amount   = 1000;
  let calls = 0;
  _setMethodHealHandler(() => { calls++; });
  applyPaymentMethods([m1, m2]);  // m2 still in list → methodId preserved
  expect(calls).toBe(0);
  _setMethodHealHandler(null);
});

test('payDisabled true when paymentMethods is empty', () => {
  ui.paymentMethods = [];
  ui.amount = 1000;
  ui.calc = {
    amount: 1000, amountToBalance: 980, amountToBalanceUSD: 10,
    amountToBalanceKZT: 4500, minAmount: 100, maxAmount: 100000,
  };
  ui.calcLoading = false;
  ui.calcError = null;
  ui.paySubmitting = false;
  expect(payDisabled()).toBe(true);
});

test('payDisabled true when ui.calc.notice is set', () => {
  ui.amount = 10; ui.methodId = 'sbp';
  ui.paymentMethods = [{ type: 'sbp', name: 'СБП', imageUrl: '' }];
  ui.calc = {
    amount: 55.11, amountToBalance: 50.1,
    amountToBalanceUSD: 0.68, amountToBalanceKZT: 319.6,
    minAmount: 50, maxAmount: 15000,
    notice: 'Минимальная сумма: 50 ₽',  // strings-allow-cyrillic
  };
  expect(payDisabled()).toBe(true);
});

test('payDisabled false when ui.calc lacks notice', () => {
  ui.amount = 1000; ui.methodId = 'sbp';
  ui.paymentMethods = [{ type: 'sbp', name: 'СБП', imageUrl: '' }];
  ui.calc = {
    amount: 1100, amountToBalance: 1000,
    amountToBalanceUSD: 13, amountToBalanceKZT: 6234,
    minAmount: 50, maxAmount: 15000,
  };
  expect(payDisabled()).toBe(false);
});

// Defensive truthy-check: backend contract is notice-absent OR non-empty
// string, but `notice: ""` (a future backend bug) under `!== undefined`
// would disable the button with an empty label. `!!notice` falls through.
test('payDisabled false when ui.calc.notice is an empty string', () => {
  ui.amount = 1000; ui.methodId = 'sbp';
  ui.paymentMethods = [{ type: 'sbp', name: 'СБП', imageUrl: '' }];
  ui.calc = {
    amount: 1100, amountToBalance: 1000,
    amountToBalanceUSD: 13, amountToBalanceKZT: 6234,
    minAmount: 50, maxAmount: 15000,
    notice: '',
  };
  expect(payDisabled()).toBe(false);
});

// validAmount + clampAmountToCalcBounds — client-side soft-clamp restored
// 2026-05-15 per spec bug-4-calc-soft-clamp.md. validAmount is the pure
// bounds predicate; clampAmountToCalcBounds is the pure mutation called
// on input blur. Zero stays zero (treated as "empty input", not "below
// min") so the field doesn't auto-fill the moment the user clears it.

test('validAmount returns false when calc not loaded', () => {
  expect(validAmount()).toBe(false);
});

test('validAmount returns false for amount below min', () => {
  ui.calc = { amount: 100, amountToBalance: 100, amountToBalanceUSD: 1,
              amountToBalanceKZT: 500, minAmount: 100, maxAmount: 15000 };
  ui.amount = 50;
  expect(validAmount()).toBe(false);
});

test('validAmount returns false for amount above max', () => {
  ui.calc = { amount: 100, amountToBalance: 100, amountToBalanceUSD: 1,
              amountToBalanceKZT: 500, minAmount: 100, maxAmount: 15000 };
  ui.amount = 20000;
  expect(validAmount()).toBe(false);
});

test('validAmount returns true at exactly min boundary', () => {
  ui.calc = { amount: 100, amountToBalance: 100, amountToBalanceUSD: 1,
              amountToBalanceKZT: 500, minAmount: 100, maxAmount: 15000 };
  ui.amount = 100;
  expect(validAmount()).toBe(true);
});

test('validAmount returns true at exactly max boundary', () => {
  ui.calc = { amount: 100, amountToBalance: 100, amountToBalanceUSD: 1,
              amountToBalanceKZT: 500, minAmount: 100, maxAmount: 15000 };
  ui.amount = 15000;
  expect(validAmount()).toBe(true);
});

test('clampAmountToCalcBounds: no-op when calc absent', () => {
  ui.amount = 50;
  clampAmountToCalcBounds();
  expect(ui.amount).toBe(50);
});

test('clampAmountToCalcBounds: clamps too-small to min', () => {
  ui.calc = { amount: 100, amountToBalance: 100, amountToBalanceUSD: 1,
              amountToBalanceKZT: 500, minAmount: 100, maxAmount: 15000 };
  ui.amount = 5;
  clampAmountToCalcBounds();
  expect(ui.amount).toBe(100);
});

test('clampAmountToCalcBounds: clamps too-large to max', () => {
  ui.calc = { amount: 100, amountToBalance: 100, amountToBalanceUSD: 1,
              amountToBalanceKZT: 500, minAmount: 100, maxAmount: 15000 };
  ui.amount = 99999;
  clampAmountToCalcBounds();
  expect(ui.amount).toBe(15000);
});

test('clampAmountToCalcBounds: no-op for in-range amount', () => {
  ui.calc = { amount: 500, amountToBalance: 500, amountToBalanceUSD: 5,
              amountToBalanceKZT: 2500, minAmount: 100, maxAmount: 15000 };
  ui.amount = 500;
  clampAmountToCalcBounds();
  expect(ui.amount).toBe(500);
});

test('clampAmountToCalcBounds: does not raise zero amount', () => {
  // zero = "empty input" — clamping to min would be confusing.
  ui.calc = { amount: 100, amountToBalance: 100, amountToBalanceUSD: 1,
              amountToBalanceKZT: 500, minAmount: 100, maxAmount: 15000 };
  ui.amount = 0;
  clampAmountToCalcBounds();
  expect(ui.amount).toBe(0);
});

// payDisabled — primary client-side bounds gate (validAmount) plus the
// retained backend `notice` cross-check. The placeholder ASCII notice
// string keeps no-hardcoded-ru.test.ts happy without a pragma — the
// payDisabled logic only checks truthiness, never content.

test('payDisabled true when amount out of range (client-side)', () => {
  ui.calc = { amount: 100, amountToBalance: 100, amountToBalanceUSD: 1,
              amountToBalanceKZT: 500, minAmount: 100, maxAmount: 15000 };
  ui.amount = 5;  // below min
  ui.paymentMethods = [{ type: 't', name: 'T', imageUrl: '' }];
  ui.methodId = 't';
  expect(payDisabled()).toBe(true);
});

test('payDisabled true when notice set (cross-check) even for in-range', () => {
  ui.calc = { amount: 100, amountToBalance: 100, amountToBalanceUSD: 1,
              amountToBalanceKZT: 500, minAmount: 100, maxAmount: 15000,
              notice: 'method-temporarily-unavailable' };
  ui.amount = 500;  // in range
  ui.paymentMethods = [{ type: 't', name: 'T', imageUrl: '' }];
  ui.methodId = 't';
  expect(payDisabled()).toBe(true);
});

test('payDisabled false when amount in range AND no notice', () => {
  ui.calc = { amount: 500, amountToBalance: 500, amountToBalanceUSD: 5,
              amountToBalanceKZT: 2500, minAmount: 100, maxAmount: 15000 };
  ui.amount = 500;
  ui.paymentMethods = [{ type: 't', name: 'T', imageUrl: '' }];
  ui.methodId = 't';
  expect(payDisabled()).toBe(false);
});

// derivedPay tests — covers the simple "ceil(desired - balance) in
// wallet currency" formula. No ratio multiplication: ui.amount is
// already in wallet-currency units (same input the user types in
// pay-input pre-feature), so the credit-to-add is just the delta.

test('derivedPay returns 0 when desiredBalance is 0', () => {
  ui.userBalance = 100;
  ui.desiredBalance = 0;
  expect(derivedPay()).toBe(0);
});

test('derivedPay returns 0 when desired < balance', () => {
  ui.userBalance = 3000;
  ui.desiredBalance = 2500;
  expect(derivedPay()).toBe(0);
});

test('derivedPay returns 0 when desired === balance', () => {
  ui.userBalance = 3000;
  ui.desiredBalance = 3000;
  expect(derivedPay()).toBe(0);
});

test('derivedPay: RUB anchor — balance 2177.35, desired 3000 → 823', () => {
  // User's spec example: needed = 822.65 → ceil → 823.
  ui.userBalance = 2177.35;
  ui.desiredBalance = 3000;
  expect(derivedPay()).toBe(823);
});

test('derivedPay: always rounds UP for fractional balance', () => {
  // needed = 100.01 → ceil 101 (Math.round would give 100, asserts ceil).
  ui.userBalance = 0.01;
  ui.desiredBalance = 100.02;
  expect(derivedPay()).toBe(101);
});

test('derivedPay: KZT — balance 2860, desired 3000 → 140 KZT credit', () => {
  // No ratio multiplication: needed_kzt = 140 → ui.amount = 140.
  // Backend will tell us the RUB pay-required + apply any
  // method-specific min/max check; that's not derivedPay's concern.
  ui.userBalance = 2860;
  ui.desiredBalance = 3000;
  expect(derivedPay()).toBe(140);
});

test('derivedPay: USD — balance 5, desired 18 → 13 USD credit', () => {
  ui.userBalance = 5;
  ui.desiredBalance = 18;
  expect(derivedPay()).toBe(13);
});

test('derivedPay: balance null is treated as 0 (pre-init seeding window)', () => {
  ui.userBalance = null;
  ui.desiredBalance = 1000;
  expect(derivedPay()).toBe(1000);
});

test('derivedDesiredFromPay returns balance + receive for RUB', () => {
  ui.userCurrency = 'RUB';
  ui.userBalance = 2177.35;
  ui.amount = 1000;
  ui.calc = { amount: 1000, amountToBalance: 1000, amountToBalanceUSD: 13, amountToBalanceKZT: 6234, minAmount: 50, maxAmount: 15000 };
  expect(derivedDesiredFromPay()).toBeCloseTo(2177.35 + 1000, 4);
});

test('derivedDesiredFromPay returns balance + receiveUSD for USD', () => {
  ui.userCurrency = 'USD';
  ui.userBalance = 5;
  ui.amount = 1100;
  ui.calc = { amount: 1100, amountToBalance: 1000, amountToBalanceUSD: 13, amountToBalanceKZT: 6234, minAmount: 50, maxAmount: 15000 };
  expect(derivedDesiredFromPay()).toBeCloseTo(18, 4);
});

test('derivedDesiredFromPay returns balance + receiveKZT for KZT', () => {
  ui.userCurrency = 'KZT';
  ui.userBalance = 5000;
  ui.amount = 1100;
  ui.calc = { amount: 1100, amountToBalance: 1000, amountToBalanceUSD: 13, amountToBalanceKZT: 6234, minAmount: 50, maxAmount: 15000 };
  expect(derivedDesiredFromPay()).toBeCloseTo(5000 + 6234, 4);
});

test('derivedDesiredFromPay returns null when calc is null', () => {
  ui.userCurrency = 'RUB';
  ui.userBalance = 100;
  ui.amount = 100;
  ui.calc = null;
  expect(derivedDesiredFromPay()).toBeNull();
});

test('derivedDesiredFromPay returns null when notice is set', () => {
  ui.userCurrency = 'RUB';
  ui.userBalance = 100;
  ui.amount = 10;
  ui.calc = { amount: 55.11, amountToBalance: 50.1, amountToBalanceUSD: 0.68, amountToBalanceKZT: 319.6, minAmount: 50, maxAmount: 15000, notice: 'too small' };
  expect(derivedDesiredFromPay()).toBeNull();
});

test('derivedDesiredFromPay returns null for unsupported currency', () => {
  ui.userCurrency = 'UAH';
  ui.userBalance = 100;
  ui.amount = 1100;
  ui.calc = { amount: 1100, amountToBalance: 1000, amountToBalanceUSD: 13, amountToBalanceKZT: 6234, minAmount: 50, maxAmount: 15000 };
  expect(derivedDesiredFromPay()).toBeNull();
});

test('derivedDesiredFromPay treats null userBalance as 0', () => {
  ui.userCurrency = 'RUB';
  ui.userBalance = null;  // pre-init window
  ui.amount = 1000;
  ui.calc = { amount: 1000, amountToBalance: 1000, amountToBalanceUSD: 13, amountToBalanceKZT: 6234, minAmount: 50, maxAmount: 15000 };
  expect(derivedDesiredFromPay()).toBe(1000);
});

test('derivedDesiredFromPay returns null when ui.amount is 0 (cleared pay-input)', () => {
  // Defensive: this case is unreachable in production today because
  // runCalc clears ui.calc when amount=0 (so the !ui.calc guard above
  // fires first). But derivedDesiredFromPay still carries the
  // amount-zero guard as a belt-and-suspenders against a future
  // change that preserves ui.calc — pay-mode "Итого" must never
  // surface a stale receive sum after the user backspaces to empty.
  ui.userCurrency = 'RUB';
  ui.userBalance = 1000;
  ui.amount = 0;
  ui.calc = { amount: 1000, amountToBalance: 1000, amountToBalanceUSD: 13, amountToBalanceKZT: 6234, minAmount: 50, maxAmount: 15000 };
  expect(derivedDesiredFromPay()).toBeNull();
});

