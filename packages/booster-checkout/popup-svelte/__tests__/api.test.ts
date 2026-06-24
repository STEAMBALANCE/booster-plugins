// booster-plugins/packages/booster-checkout/popup-svelte/__tests__/api.test.ts
//
// Unit tests for api.ts (calc loop + submitPay). Calc tests cover the
// monotonic id-guard for stale-response drop and the 400ms debounce.
// submitPay coverage lives further down (email-conditional spread).

import { test, expect, beforeEach, afterEach } from 'bun:test';
import { ui } from '../lib/state.svelte';
import { scheduleCalc, submitPay, _runCalcForTest, _resetIdsForTest } from '../lib/api';
import { LL } from '../../src/i18n';

let originalFetch: typeof fetch;

beforeEach(() => {
  // Save fetch BEFORE any test installs a mock so afterEach can restore it.
  // Without this, a mock installed in test N leaks into test N+1's setup
  // (e.g. early-return tests that rely on no fetch call at all).
  originalFetch = globalThis.fetch;
  // Plugin version is a build-time define (baked); injector + framework
  // versions arrive at runtime via window.__SB_BOOSTER_VERSIONS__ (set by
  // bridge.ts from the BC init message). Seed both seams so the popup-IIFE
  // getBoosterHeaders() resolves real version strings. Production
  // substitutes the plugin define at build time via Bun.build({define:...}).
  (globalThis as any).__SB_PLUGIN_VERSION__ = '7.8.9';
  (globalThis as any).window = {
    __SB_BOOSTER_VERSIONS__: { injector: '1.2.3', framework: '4.5.6' },
  };
  ui.amount = 0; ui.methodId = '';
  ui.urls.support = ''; ui.urls.popupLogoLink = '';
  ui.urls.balanceCalcApi = ''; ui.urls.balanceAddApi = '';
  // Default to a logged-in user: calc + submitPay both guard on userLogin.
  // The empty-login guard path has its own dedicated test below.
  ui.userLogin = 'user';
  ui.paymentMethods = []; ui.paymentMethodsLoading = false; ui.paymentMethodsError = null;
  ui.calc = null; ui.calcLoading = false; ui.calcError = null;
  ui.paySubmitting = false;
  ui.payError = null;
  _resetIdsForTest();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete (globalThis as any).window;
});

test('runCalc no-op when amount = 0 (with methodId set — actually exercises the amount-zero branch)', async () => {
  let fetchCalls = 0;
  globalThis.fetch = (async () => { fetchCalls++; return new Response(''); }) as typeof fetch;
  // Set methodId so the methodId-empty branch doesn't short-circuit
  // first — this test must hit the amount<=0 branch specifically.
  ui.amount = 0;
  ui.methodId = 'paypalych-sbp';
  ui.urls.balanceCalcApi = 'https://test.local/api/balance/calc';
  await _runCalcForTest();
  expect(fetchCalls).toBe(0);
  expect(ui.calc).toBeNull();
  expect(ui.calcLoading).toBe(false);
});

test('runCalc no-op when balanceCalcApi empty', async () => {
  ui.amount = 100; ui.urls.balanceCalcApi = '';
  await _runCalcForTest();
  expect(ui.calc).toBeNull();
});

test('runCalc: guard returns without fetch on empty balanceCalcApi', async () => {
  // Pinned guard contract — empty balanceCalcApi → no fetch, ui.calc stays
  // null. Mirrors the pre-init window where BC init hasn't arrived yet.
  ui.urls.balanceCalcApi = '';
  ui.amount = 100;
  ui.methodId = 'paypalych-sbp';
  let fetchCalls = 0;
  globalThis.fetch = (async () => { fetchCalls++; return new Response(''); }) as typeof fetch;
  await _runCalcForTest();
  expect(fetchCalls).toBe(0);
  expect(ui.calc).toBeNull();
});

test('runCalc no-op when userLogin empty (guard mirrors submitPay)', async () => {
  // login is now part of the calc body (scopes the calc to the account,
  // same as submitPay). Empty login (logged-out / pre-init) must not
  // fire a request.
  ui.amount = 100;
  ui.methodId = 'paypalych-sbp';
  ui.urls.balanceCalcApi = 'https://test.local/api/balance/calc';
  ui.userLogin = '';
  let fetchCalls = 0;
  globalThis.fetch = (async () => { fetchCalls++; return new Response(''); }) as typeof fetch;
  await _runCalcForTest();
  expect(fetchCalls).toBe(0);
  expect(ui.calc).toBeNull();
});

test('runCalc: fetches exact balanceCalcApi URL from ui.urls', async () => {
  ui.urls.balanceCalcApi = 'https://test.example.com/api/balance/calc';
  ui.amount = 100;
  ui.methodId = 'paypalych-sbp';
  ui.userCurrency = 'RUB';

  let seenUrl = '';
  globalThis.fetch = (async (input: Request | string | URL) => {
    seenUrl = String(input);
    return new Response(JSON.stringify({ success: true, data: {
      amount: 110, amountToBalance: 100, amountToBalanceUSD: 1, amountToBalanceKZT: 600,
      minAmount: 50, maxAmount: 15000,
    } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  await _runCalcForTest();
  expect(seenUrl).toBe('https://test.example.com/api/balance/calc');
});

test('runCalc populates ui.calc on successful response', async () => {
  ui.amount = 1000; ui.urls.balanceCalcApi = 'https://test.local/api/balance/calc'; ui.methodId = 'paypalych-sbp';
  const fakeResp = { success: true, data: { amount: 1100, amountToBalance: 1000, amountToBalanceUSD: 13, amountToBalanceKZT: 6234, minAmount: 50, maxAmount: 15000 } };
  globalThis.fetch = (async () => new Response(JSON.stringify(fakeResp))) as typeof fetch;
  await _runCalcForTest();
  expect(ui.calc?.amount).toBe(1100);
  expect(ui.calcLoading).toBe(false);
});

// Bug #1 contract: when backend returns `data.notice`, runCalc must
// propagate it verbatim into ui.calc.notice. A future selective-copy
// refactor of runCalc could silently drop the field while keeping all
// other tests green — this test pins the wire.
test('runCalc propagates data.notice from response body to ui.calc.notice', async () => {
  ui.amount = 1; ui.urls.balanceCalcApi = 'https://test.local/api/balance/calc'; ui.methodId = 'paypalych-sbp';
  const fakeResp = {
    success: true,
    data: {
      amount: 55.11, amountToBalance: 50.1,
      amountToBalanceUSD: 0.68, amountToBalanceKZT: 319.6,
      minAmount: 50, maxAmount: 15000,
      notice: 'Минимальная сумма: 50 ₽',  // strings-allow-cyrillic
    },
  };
  globalThis.fetch = (async () => new Response(JSON.stringify(fakeResp))) as typeof fetch;
  await _runCalcForTest();
  expect(ui.calc?.notice).toBe('Минимальная сумма: 50 ₽');  // strings-allow-cyrillic
});

test('runCalc sets calcError on network failure', async () => {
  ui.amount = 1000; ui.urls.balanceCalcApi = 'https://test.local/api/balance/calc'; ui.methodId = 'paypalych-sbp';
  globalThis.fetch = (async () => { throw new Error('boom'); }) as typeof fetch;
  await _runCalcForTest();
  expect(ui.calcError).toBe('network');
});

test('runCalc stale response is dropped (monotonic id)', async () => {
  ui.amount = 1000; ui.urls.balanceCalcApi = 'https://test.local/api/balance/calc'; ui.methodId = 'paypalych-sbp';
  let resolveFirst!: () => void;
  const firstPromise = new Promise<Response>((r) => {
    resolveFirst = () => r(new Response(JSON.stringify({ success:true, data:{ amount:111, amountToBalance:100, amountToBalanceUSD:1, amountToBalanceKZT:6, minAmount:50, maxAmount:15000 }})));
  });
  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount++;
    if (callCount === 1) return firstPromise;
    return new Response(JSON.stringify({ success:true, data:{ amount:222, amountToBalance:200, amountToBalanceUSD:2, amountToBalanceKZT:12, minAmount:50, maxAmount:15000 }}));
  }) as typeof fetch;

  // Fire two concurrent runCalc'и; первый отстаёт, второй завершается first.
  const p1 = _runCalcForTest();
  const p2 = _runCalcForTest();
  await p2;
  // Сейчас p1 ещё pending. Resolve его — но он должен быть DROPPED (calcId > его id).
  resolveFirst();
  await p1;
  expect(ui.calc?.amount).toBe(222);  // не 111 (stale)
});

test('runCalc sends booster headers + 3 version headers, no is_booster in body', async () => {
  ui.amount = 1000; ui.urls.balanceCalcApi = 'https://test.local/api/balance/calc';
  ui.userCurrency = 'RUB';
  ui.methodId = 'paypalych-sbp';

  let capturedInit: RequestInit | null = null;
  globalThis.fetch = ((_url: string, init: RequestInit) => {
    capturedInit = init;
    return Promise.resolve(new Response(JSON.stringify({
      success: true, data: {
        amount: 1000, amountToBalance: 980,
        amountToBalanceUSD: 10, amountToBalanceKZT: 4500,
        minAmount: 100, maxAmount: 100000,
      },
    }), { status: 200 }));
  }) as typeof fetch;

  await _runCalcForTest();

  expect(capturedInit).not.toBeNull();
  const h = capturedInit!.headers as Record<string, string>;
  expect(h['x-booster']).toBe('true');
  expect(h['x-booster-injector']).toBe('1.2.3');
  expect(h['x-booster-framework']).toBe('4.5.6');
  expect(h['x-booster-plugins']).toBe('booster-checkout@7.8.9');
  expect(h['Content-Type']).toBe('application/json');

  const body = JSON.parse(capturedInit!.body as string);
  expect(body.is_booster).toBeUndefined();
  expect(body.amount).toBe(1000);
  expect(body.paymentId).toBe('paypalych-sbp');
  expect(body.currency).toBe('RUB');
  expect(body.login).toBe('user');
});

test('scheduleCalc debounces 400ms', async () => {
  // Smoke: что scheduleCalc заводит timer и не fires immediately.
  // Slack: 400ms slack (waits 800ms total) чтобы не быть flaky под CI load.
  ui.amount = 1000; ui.urls.balanceCalcApi = 'https://test.local/api/balance/calc'; ui.methodId = 'paypalych-sbp';
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls++;
    return new Response(JSON.stringify({ success:true, data:{ amount:0, amountToBalance:0, amountToBalanceUSD:0, amountToBalanceKZT:0, minAmount:50, maxAmount:15000 }}));
  }) as typeof fetch;
  scheduleCalc();
  expect(fetchCalls).toBe(0);  // не fired immediately
  await new Promise((r) => setTimeout(r, 800));
  // >= 1 (а не === 1) на случай CI-spawn'а лишнего timer
  expect(fetchCalls).toBeGreaterThanOrEqual(1);
});

test('submitPay: fetches exact balanceAddApi URL from ui.urls', async () => {
  ui.urls.balanceAddApi = 'https://test.example.com/api/balance/add';
  ui.userLogin = 'user';
  ui.userCurrency = 'RUB';
  ui.methodId = 'paypalych-sbp';
  ui.amount = 500;

  let seenUrl = '';
  globalThis.fetch = (async (input: Request | string | URL) => {
    seenUrl = String(input);
    return new Response(JSON.stringify({ data: { redirectUrl: 'https://pay/x' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  const r = await submitPay();
  expect(seenUrl).toBe('https://test.example.com/api/balance/add');
  expect(r).toEqual({ redirectUrl: 'https://pay/x', uid: null });
});

test('submitPay: returns null on empty balanceAddApi (new guard)', async () => {
  // New guard — mirrors runCalc. Empty URL means BC init hasn't arrived
  // yet; we must not POST to "" (which would 404 against the popup's
  // own origin).
  ui.urls.balanceAddApi = '';
  ui.userLogin = 'user';
  let fetchCalls = 0;
  globalThis.fetch = (async () => { fetchCalls++; return new Response(''); }) as typeof fetch;
  const r = await submitPay();
  expect(fetchCalls).toBe(0);
  expect(r).toBeNull();
});

test('submitPay: returns null on empty userLogin (guard)', async () => {
  // The !ui.userLogin half of submitPay's guard — empty login (logged-out
  // / pre-init) must not POST a payment with a missing account.
  ui.urls.balanceAddApi = 'https://test.local/api/balance/add';
  ui.userLogin = '';
  let fetchCalls = 0;
  globalThis.fetch = (async () => { fetchCalls++; return new Response(''); }) as typeof fetch;
  const r = await submitPay();
  expect(fetchCalls).toBe(0);
  expect(r).toBeNull();
});

test('submitPay omits email key from body when email empty/undefined', async () => {
  ui.amount = 100; ui.urls.balanceAddApi = 'https://h.local/api/balance/add'; ui.userLogin = 'u';
  ui.methodId = 'paypalych-sbp';
  let capturedBody: string = '';
  globalThis.fetch = (async (_url, init) => {
    capturedBody = init?.body as string;
    return new Response(JSON.stringify({ data: { redirectUrl: 'https://x' } }));
  }) as typeof fetch;

  await submitPay(undefined);
  let body = JSON.parse(capturedBody);
  expect(body).not.toHaveProperty('email');

  await submitPay('');
  body = JSON.parse(capturedBody);
  expect(body).not.toHaveProperty('email');
});

test('submitPay includes email key when truthy string passed', async () => {
  ui.amount = 100; ui.urls.balanceAddApi = 'https://h.local/api/balance/add'; ui.userLogin = 'u';
  ui.methodId = 'paypalych-sbp';
  let capturedBody: string = '';
  globalThis.fetch = (async (_url, init) => {
    capturedBody = init?.body as string;
    return new Response(JSON.stringify({ data: { redirectUrl: 'https://x' } }));
  }) as typeof fetch;

  await submitPay('test@example.com');
  const body = JSON.parse(capturedBody);
  expect(body.email).toBe('test@example.com');
});

// Wallet currency in API bodies. The pre-redesign popup.html read
// currency from a user-facing dropdown; the redesign drops the
// dropdown and always uses ui.userCurrency (seeded by init). A KZT
// or USD wallet that gets RUB-tagged calc requests receives wrong
// amountToBalance numbers — visible regression vs the legacy popup.

test('submitPay returns {redirectUrl, uid} from top-level response', async () => {
  const UID = 'a5273b1e-87b4-435f-95ed-e85995b8951d';
  ui.urls.balanceAddApi = 'https://steambalance.cc/api/balance/add';
  ui.userLogin = 'someuser';
  ui.methodId = 'sbp';
  ui.amount = 1000;
  ui.userCurrency = 'RUB';
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ success: true, redirectUrl: 'https://pally.info/transfer/x', uid: UID }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )) as typeof fetch;
  const res = await submitPay();
  expect(res).toEqual({ redirectUrl: 'https://pally.info/transfer/x', uid: UID });
});

test('submitPay reads uid from data wrapper too', async () => {
  const UID = 'b1c2d3e4-0000-4000-8000-000000000000';
  ui.urls.balanceAddApi = 'https://steambalance.cc/api/balance/add';
  ui.userLogin = 'someuser'; ui.methodId = 'sbp'; ui.amount = 1000; ui.userCurrency = 'RUB';
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ data: { redirectUrl: 'https://pally.info/t/y', uid: UID } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )) as typeof fetch;
  const res = await submitPay();
  expect(res?.uid).toBe(UID);
  expect(res?.redirectUrl).toBe('https://pally.info/t/y');
});

test('runCalc body sends ui.userCurrency (KZT)', async () => {
  ui.amount = 1000; ui.urls.balanceCalcApi = 'https://h.local/api/balance/calc'; ui.userCurrency = 'KZT';
  ui.methodId = 'paypalych-sbp';
  let capturedBody: string = '';
  globalThis.fetch = (async (_url, init) => {
    capturedBody = init?.body as string;
    return new Response(JSON.stringify({ success: true, data: {
      amount: 220, amountToBalance: 200, amountToBalanceUSD: 2,
      amountToBalanceKZT: 1234, minAmount: 50, maxAmount: 15000,
    }}));
  }) as typeof fetch;
  await _runCalcForTest();
  expect(JSON.parse(capturedBody).currency).toBe('KZT');
});

test('runCalc body falls back to RUB when ui.userCurrency null (pre-init)', async () => {
  ui.amount = 1000; ui.urls.balanceCalcApi = 'https://h.local/api/balance/calc'; ui.userCurrency = null;
  ui.methodId = 'paypalych-sbp';
  let capturedBody: string = '';
  globalThis.fetch = (async (_url, init) => {
    capturedBody = init?.body as string;
    return new Response(JSON.stringify({ success: true, data: {
      amount: 1100, amountToBalance: 1000, amountToBalanceUSD: 13,
      amountToBalanceKZT: 6234, minAmount: 50, maxAmount: 15000,
    }}));
  }) as typeof fetch;
  await _runCalcForTest();
  expect(JSON.parse(capturedBody).currency).toBe('RUB');
});

test('runCalc body sends ui.userLogin', async () => {
  ui.amount = 1000; ui.urls.balanceCalcApi = 'https://h.local/api/balance/calc';
  ui.userLogin = 'alice'; ui.userCurrency = 'RUB';
  ui.methodId = 'paypalych-sbp';
  let capturedBody: string = '';
  globalThis.fetch = (async (_url, init) => {
    capturedBody = init?.body as string;
    return new Response(JSON.stringify({ success: true, data: {
      amount: 1100, amountToBalance: 1000, amountToBalanceUSD: 13,
      amountToBalanceKZT: 6234, minAmount: 50, maxAmount: 15000,
    }}));
  }) as typeof fetch;
  await _runCalcForTest();
  expect(JSON.parse(capturedBody).login).toBe('alice');
});

test('runCalc clears ui.calc when amount=0 (empty field) — with methodId set so we hit the amount-zero branch, not the methodId-empty branch', async () => {
  ui.amount = 0;
  ui.methodId = 'paypalych-sbp';
  ui.urls.balanceCalcApi = 'https://h.local/api/balance/calc';
  ui.calc = { amount: 110, amountToBalance: 100, amountToBalanceUSD: 1, amountToBalanceKZT: 600, minAmount: 100, maxAmount: 5000 };
  await _runCalcForTest();
  expect(ui.calc).toBeNull();
});

test('submitPay body sends ui.userCurrency (USD)', async () => {
  ui.amount = 100; ui.urls.balanceAddApi = 'https://h.local/api/balance/add'; ui.userLogin = 'u';
  ui.userCurrency = 'USD';
  ui.methodId = 'paypalych-sbp';
  let capturedBody: string = '';
  globalThis.fetch = (async (_url, init) => {
    capturedBody = init?.body as string;
    return new Response(JSON.stringify({ data: { redirectUrl: 'https://x' } }));
  }) as typeof fetch;
  await submitPay(undefined);
  expect(JSON.parse(capturedBody).currency).toBe('USD');
});

test('submitPay sends booster headers + 3 version headers, no is_booster in body', async () => {
  ui.amount = 1500;
  ui.urls.balanceAddApi = 'https://test.local/api/balance/add';
  ui.userLogin = 'testuser';
  ui.userCurrency = 'RUB';
  ui.methodId = 'paypalych-sbp';

  let capturedInit: RequestInit | null = null;
  globalThis.fetch = ((_url: string, init: RequestInit) => {
    capturedInit = init;
    return Promise.resolve(new Response(JSON.stringify({
      data: { redirectUrl: 'https://pay.example/abc' },
    }), { status: 200 }));
  }) as typeof fetch;

  const result = await submitPay();
  expect(result).toEqual({ redirectUrl: 'https://pay.example/abc', uid: null });

  expect(capturedInit).not.toBeNull();
  const h = capturedInit!.headers as Record<string, string>;
  expect(h['x-booster']).toBe('true');
  expect(h['x-booster-injector']).toBe('1.2.3');
  expect(h['x-booster-framework']).toBe('4.5.6');
  expect(h['x-booster-plugins']).toBe('booster-checkout@7.8.9');
  expect(h['Content-Type']).toBe('application/json');

  const body = JSON.parse(capturedInit!.body as string);
  expect(body.is_booster).toBeUndefined();
  expect(body.paymentId).toBe('paypalych-sbp');
  expect(body.amount).toBe(1500);
  expect(body.login).toBe('testuser');
  expect(body.currency).toBe('RUB');
  expect(body.email).toBeUndefined();
});

test('submitPay forwards email when provided', async () => {
  ui.amount = 500; ui.urls.balanceAddApi = 'https://test.local/api/balance/add';
  ui.userLogin = 'u'; ui.userCurrency = 'RUB';
  ui.methodId = 'paypalych-sbp';

  let capturedInit: RequestInit | null = null;
  globalThis.fetch = ((_url: string, init: RequestInit) => {
    capturedInit = init;
    return Promise.resolve(new Response(JSON.stringify({
      data: { redirectUrl: 'https://pay.example' },
    }), { status: 200 }));
  }) as typeof fetch;

  await submitPay('user@example.com');

  const body = JSON.parse(capturedInit!.body as string);
  expect(body.email).toBe('user@example.com');
  expect(body.is_booster).toBeUndefined();
});

test('submitPay: success:false @ HTTP 400 sets ui.payError to backend message, returns null', async () => {
  ui.urls.balanceAddApi = 'https://test.local/api/balance/add';
  ui.userLogin = 'fnafers3'; ui.methodId = 'paypalych-sbp'; ui.amount = 1000; ui.userCurrency = 'RUB';
  const MSG = 'Пополнение данного аккаунта временно недоступно.';                 // strings-allow-cyrillic
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ success: false, message: MSG }), { status: 400 },
  )) as typeof fetch;
  const r = await submitPay();
  expect(r).toBeNull();
  expect(ui.payError).toBe(MSG);
});

test('submitPay: success:false @ HTTP 200 still surfaces the message', async () => {
  ui.urls.balanceAddApi = 'https://test.local/api/balance/add';
  ui.userLogin = 'u'; ui.methodId = 'paypalych-sbp'; ui.amount = 1000;
  const MSG = 'Что-то пошло не так';                                              // strings-allow-cyrillic
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ success: false, message: MSG }), { status: 200 },
  )) as typeof fetch;
  const r = await submitPay();
  expect(r).toBeNull();
  expect(ui.payError).toBe(MSG);
});

test('submitPay: success:false with empty message falls back to generic', async () => {
  ui.urls.balanceAddApi = 'https://test.local/api/balance/add';
  ui.userLogin = 'u'; ui.methodId = 'paypalych-sbp'; ui.amount = 1000;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ success: false, message: '' }), { status: 400 },
  )) as typeof fetch;
  await submitPay();
  expect(ui.payError).toBe(LL.checkout.pay_error.generic());
});

test('submitPay: success:false wins even if a redirectUrl is present (no navigate)', async () => {
  ui.urls.balanceAddApi = 'https://test.local/api/balance/add';
  ui.userLogin = 'u'; ui.methodId = 'paypalych-sbp'; ui.amount = 1000;
  const MSG = 'Ошибка оплаты';                                                    // strings-allow-cyrillic
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ success: false, message: MSG, redirectUrl: 'https://pally.info/x' }), { status: 200 },
  )) as typeof fetch;
  const r = await submitPay();
  expect(r).toBeNull();
  expect(ui.payError).toBe(MSG);
});

test('submitPay: transport throw sets generic payError, returns null', async () => {
  ui.urls.balanceAddApi = 'https://test.local/api/balance/add';
  ui.userLogin = 'u'; ui.methodId = 'paypalych-sbp'; ui.amount = 1000;
  globalThis.fetch = (async () => { throw new Error('boom'); }) as typeof fetch;
  const r = await submitPay();
  expect(r).toBeNull();
  expect(ui.payError).toBe(LL.checkout.pay_error.generic());
});

test('submitPay: success leaves payError null', async () => {
  ui.urls.balanceAddApi = 'https://test.local/api/balance/add';
  ui.userLogin = 'u'; ui.methodId = 'paypalych-sbp'; ui.amount = 1000;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ success: true, redirectUrl: 'https://pally.info/x', uid: 'abc' }), { status: 200 },
  )) as typeof fetch;
  const r = await submitPay();
  expect(r).toEqual({ redirectUrl: 'https://pally.info/x', uid: 'abc' });
  expect(ui.payError).toBeNull();
});

test('submitPay: not-ready guard does not set payError', async () => {
  ui.urls.balanceAddApi = ''; ui.userLogin = 'u';
  const r = await submitPay();
  expect(r).toBeNull();
  expect(ui.payError).toBeNull();
});
