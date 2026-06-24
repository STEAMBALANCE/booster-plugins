// booster-plugins/packages/booster-checkout/popup-svelte/__tests__/bridge.test.ts
//
// Coverage for bridge.ts state-machine logic: init/email handlers,
// popupId/kind filters, defensive guards, pendingPay drain. Without
// these tests the spec § 5.4 "spurious empty init does not overwrite"
// invariant is paper-only.
//
// Bun's runtime doesn't ship a BroadcastChannel implementation, so we
// install a minimal in-memory polyfill before importing bridge.ts.
// Setting it on globalThis makes `new BroadcastChannel(name)` resolve to
// our class for both this test file AND the imported bridge module.

import { test, expect, beforeEach, afterEach } from 'bun:test';
import { ui } from '../lib/state.svelte';

class InMemoryBC extends EventTarget {
  static channels = new Map<string, Set<InMemoryBC>>();
  constructor(public readonly name: string) {
    super();
    let s = InMemoryBC.channels.get(name);
    if (!s) { s = new Set(); InMemoryBC.channels.set(name, s); }
    s.add(this);
  }
  postMessage(data: unknown): void {
    const peers = InMemoryBC.channels.get(this.name) ?? new Set();
    for (const p of peers) {
      if (p === this) continue;
      p.dispatchEvent(new MessageEvent('message', { data }));
    }
  }
  close(): void {
    InMemoryBC.channels.get(this.name)?.delete(this);
  }
}
(globalThis as { BroadcastChannel: typeof InMemoryBC }).BroadcastChannel = InMemoryBC;

import {
  initBridge, postSupport, postMenuAction, payAndNavigate, _resetForTest,
  postRefreshPaymentMethods, postFaq,
} from '../lib/bridge';
import {
  _setMethodHealHandler, type PaymentMethod,
} from '../lib/state.svelte';

// Matches bridge.ts's POPUP_ID. The framework's createPluginUi wrapper
// auto-prefixes the user-supplied 'sb_topup' to '<plugin-id>__sb_topup'
// (spec H4); the popup-side bridge filters BC traffic by this prefixed
// form, and these tests must mirror the wire format.
const POPUP_ID = 'booster-checkout__sb_topup';

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  // Reset the heal handler: api.ts registers scheduleCalc() at module-init,
  // and importing bridge.ts pulls api.ts in transitively. State.test.ts
  // installs its own handler in some tests and restores null — but file
  // ordering under `bun test` is non-deterministic, so any test that mutates
  // ui.methodId or applyPaymentMethods through bridge.handleIncoming could
  // accidentally trigger a stale calc fetch if the api-registered handler
  // is still wired. Force null here so payment-methods bridge tests don't
  // race with the calc loop.
  _setMethodHealHandler(null);
  // Reset ui state
  ui.amount = 0; ui.methodId = '';
  ui.menuOpen = false; ui.methodOpen = false;
  ui.userLogin = ''; ui.userCurrency = null; ui.userBalance = null;
  ui.urls.support = ''; ui.urls.popupLogoLink = '';
  ui.urls.balanceCalcApi = ''; ui.urls.balanceAddApi = '';
  ui.paymentMethods = []; ui.paymentMethodsLoading = false; ui.paymentMethodsError = null;
  ui.initSeen = false; ui.emailReceived = false;
  ui.pendingPay = false;
  ui.calc = null; ui.calcLoading = false; ui.calcError = null;
  ui.paySubmitting = false;
  ui.lastEdited = 'pay'; ui.desiredBalance = 0;
  // Clear bridge module state (BC closed + email reset) so prior test's
  // local email cannot leak into a subsequent test's submitPay body.
  _resetForTest();
  // Clear any prior BC state — drops both bridge's subscriber AND any
  // outside-poster instances created via postFromOutside.
  InMemoryBC.channels.clear();
  initBridge();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function postFromOutside(data: unknown): void {
  const bc = new InMemoryBC('sb_cmd');
  bc.postMessage({ kind: 'popup-postMessage', popupId: POPUP_ID, data });
  bc.close();
}

// Subscribes a peer BC to capture outgoing popup-message wire posts.
function captureOutgoing(): { messages: Array<{ kind: string; data?: unknown }>; bc: InMemoryBC } {
  const messages: Array<{ kind: string; data?: unknown }> = [];
  const bc = new InMemoryBC('sb_cmd');
  bc.addEventListener('message', (e: Event) => {
    const m = (e as MessageEvent).data as { kind?: string; popupId?: string; data?: unknown };
    if (m?.kind === 'popup-message' && m.popupId === POPUP_ID) {
      messages.push({ kind: (m.data as { kind: string }).kind, data: m.data });
    }
  });
  return { messages, bc };
}

test('init message populates ui fields when complete', () => {
  postFromOutside({
    kind: 'init',
    login: 'testuser',
    currency: 'RUB', balance: 1000,
    urls: {
      support:        'https://j.chat/x',
      popupLogoLink:      'https://l.test/x',
      balanceCalcApi: 'https://c.test/x',
      balanceAddApi:  'https://a.test/x',
    },
  });
  expect(ui.userLogin).toBe('testuser');
  expect(ui.urls.support).toBe('https://j.chat/x');
  expect(ui.urls.popupLogoLink).toBe('https://l.test/x');
  expect(ui.urls.balanceCalcApi).toBe('https://c.test/x');
  expect(ui.urls.balanceAddApi).toBe('https://a.test/x');
  expect(ui.userCurrency).toBe('RUB');
  expect(ui.userBalance).toBe(1000);
  // initSeen — gated on login + balanceAddApi (the URL submitPay hits).
  expect(ui.initSeen).toBe(true);
});

test('bridge init: populates ui.urls from BC payload', () => {
  postFromOutside({
    kind: 'init',
    login: 'user',
    currency: 'RUB',
    balance: 1000,
    urls: {
      support:        'https://j.test/x',
      popupLogoLink:      'https://l.test/x',
      balanceCalcApi: 'https://c.test/x',
      balanceAddApi:  'https://a.test/x',
    },
  });
  expect(ui.urls.support).toBe('https://j.test/x');
  expect(ui.urls.popupLogoLink).toBe('https://l.test/x');
  expect(ui.urls.balanceCalcApi).toBe('https://c.test/x');
  expect(ui.urls.balanceAddApi).toBe('https://a.test/x');
});

test('bridge init: missing urls field leaves ui.urls empty', () => {
  postFromOutside({ kind: 'init', login: 'user' });  // no urls field
  expect(ui.urls.support).toBe('');
  expect(ui.urls.popupLogoLink).toBe('');
  expect(ui.urls.balanceCalcApi).toBe('');
  expect(ui.urls.balanceAddApi).toBe('');
});

test('bridge init: partial urls populates only known fields', () => {
  postFromOutside({
    kind: 'init',
    urls: {
      support:        'https://j.test/x',
      balanceCalcApi: 'https://c.test/x',
      // popupLogoLink and balanceAddApi missing
    },
  });
  expect(ui.urls.support).toBe('https://j.test/x');
  expect(ui.urls.balanceCalcApi).toBe('https://c.test/x');
  expect(ui.urls.popupLogoLink).toBe('');     // unchanged from default
  expect(ui.urls.balanceAddApi).toBe(''); // unchanged from default
});

test('init pre-fills ui.amount with currency-specific default when user has not typed', () => {
  // User-requested pre-fill so the popup opens ready-to-pay rather than
  // with an empty field. RUB → 1000, KZT → 7000, USD → 15; other
  // currencies → 0 (empty input). Mirror-test of the 'shown' handler
  // case below — both code paths in bridge.ts (init + shown) must seed
  // the default so the popup is ready on first open AND on every
  // re-open.
  postFromOutside({
    kind: 'init', login: 'u',
    currency: 'RUB', balance: 0,
    urls: { support: '', popupLogoLink: '', balanceCalcApi: '', balanceAddApi: 'https://h.local/api/balance/add' },
  });
  expect(ui.amount).toBe(1000);
});

test('init does NOT overwrite user-typed amount with currency default', () => {
  // Race-protection: if the user somehow typed into the field BEFORE
  // init arrived (or if a stale init message arrives mid-session), the
  // pre-fill guard must not clobber the user's input. The guard is
  // `ui.amount === 0` in bridge.ts.
  ui.amount = 500;  // user typed
  postFromOutside({
    kind: 'init', login: 'u',
    currency: 'RUB', balance: 0,
    urls: { support: '', popupLogoLink: '', balanceCalcApi: '', balanceAddApi: 'https://h.local/api/balance/add' },
  });
  expect(ui.amount).toBe(500);  // preserved, NOT bumped to 1000
});

test('init pre-fill is 0 (empty input) for currencies without a configured default', () => {
  // UAH (Hryvnia) is in CURRENCY_SYM but not in DEFAULT_AMOUNT_BY_CURRENCY.
  // The user sees an empty input rather than a misleading number.
  postFromOutside({
    kind: 'init', login: 'u',
    currency: 'UAH', balance: 0,
    urls: { support: '', popupLogoLink: '', balanceCalcApi: '', balanceAddApi: 'https://h.local/api/balance/add' },
  });
  expect(ui.amount).toBe(0);
});

test('spurious empty init does NOT overwrite existing state (defense per spec § 5.4)', () => {
  // Seed with valid data
  postFromOutside({
    kind: 'init', login: 'testuser',
    currency: 'RUB', balance: 1000,
    urls: { support: '', popupLogoLink: '', balanceCalcApi: '', balanceAddApi: 'https://h.local/api/balance/add' },
  });
  // Send empty init
  postFromOutside({ kind: 'init', login: '', currency: '', balance: null });
  // Все поля сохранились
  expect(ui.userLogin).toBe('testuser');
  expect(ui.urls.balanceAddApi).toBe('https://h.local/api/balance/add');
  expect(ui.userBalance).toBe(1000);   // ★ balance NOT wiped (per code-review I-2)
});

test('init sets window.__SB_BOOSTER_UUID__ from uuid field', () => {
  const prev = (globalThis as { window?: unknown }).window;
  (globalThis as { window: Record<string, unknown> }).window = {};
  try {
    postFromOutside({ kind: 'init', login: 'u', uuid: 'test-uuid-x' });
    const w = (globalThis as { window: { __SB_BOOSTER_UUID__?: string } }).window;
    expect(w.__SB_BOOSTER_UUID__).toBe('test-uuid-x');

    // CRLF defense: smuggled \r\n must not set the value.
    postFromOutside({ kind: 'init', login: 'u', uuid: 'bad\r\nuuid' });
    expect(w.__SB_BOOSTER_UUID__).toBe('test-uuid-x');  // unchanged

    // Empty string must not set (spurious-empty guard).
    postFromOutside({ kind: 'init', login: 'u', uuid: '' });
    expect(w.__SB_BOOSTER_UUID__).toBe('test-uuid-x');  // unchanged
  } finally {
    if (prev === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = prev;
  }
});

test('init forwards stack versions into window.__SB_BOOSTER_VERSIONS__', () => {
  // Versions arrive at runtime (NOT baked into the popup bundle) so the
  // popup booster headers stay version-independent — see headers.ts.
  // Bun's test env has no DOM by default; seed a bare window so the bridge
  // guard sees it.
  const prev = (globalThis as { window?: unknown }).window;
  (globalThis as { window: Record<string, unknown> }).window = {};
  try {
    postFromOutside({
      kind: 'init', login: 'u',
      versions: { injector: '0.0.18', framework: '0.0.18' },
    });
    const w = (globalThis as {
      window: { __SB_BOOSTER_VERSIONS__?: { injector?: string; framework?: string } };
    }).window;
    expect(w.__SB_BOOSTER_VERSIONS__).toEqual({ injector: '0.0.18', framework: '0.0.18' });

    // Spurious-empty guard: a later re-init carrying empty version strings
    // (e.g. a mid-account-switch race) must NOT zero a working version.
    postFromOutside({ kind: 'init', login: 'u', versions: { injector: '', framework: '' } });
    expect(w.__SB_BOOSTER_VERSIONS__).toEqual({ injector: '0.0.18', framework: '0.0.18' });

    // CRLF defense: a smuggled \r\n is header-injection bait — dropped on
    // ingestion (keeps the prior working value).
    postFromOutside({ kind: 'init', login: 'u', versions: { injector: '9.9.9\r\nX-Evil: 1', framework: '8.8.8' } });
    expect(w.__SB_BOOSTER_VERSIONS__).toEqual({ injector: '0.0.18', framework: '8.8.8' });
  } finally {
    if (prev === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = prev;
  }
});

test('popupId filter — wrong popupId is ignored', () => {
  const bc = new InMemoryBC('sb_cmd');
  bc.postMessage({
    kind: 'popup-postMessage', popupId: 'OTHER',
    data: { kind: 'init', login: 'wrong' },
  });
  bc.close();
  expect(ui.userLogin).toBe('');  // unchanged
});

test('kind filter — non-popup-postMessage kind is ignored', () => {
  const bc = new InMemoryBC('sb_cmd');
  bc.postMessage({
    kind: 'popup-message',  // outgoing kind, not incoming
    popupId: POPUP_ID,
    data: { kind: 'init', login: 'wrong' },
  });
  bc.close();
  expect(ui.userLogin).toBe('');
});

test('email message stores email locally and sets emailReceived flag', () => {
  postFromOutside({ kind: 'email', email: 'test@example.com' });
  expect(ui.emailReceived).toBe(true);
  // (email value held LOCALLY in bridge.ts module — not in ui state per
  // PII discipline. Verifying its presence in submitPay body is covered by
  // api.test.ts via the email parameter; here we only assert the flag.)
});

test('pendingPay drain triggers payAndNavigate (fires fetch + posts navigate) when init+email both arrive', async () => {
  // Strengthened per code-review I-4: assert not just the flag flip but
  // that submitPay's fetch fired AND a popup-message {kind:'navigate'}
  // landed on the wire. Without these, the spec § 5.4 "queued pay actually
  // resumes" guarantee would be paper-only.
  let addCallCount = 0;
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    if (String(url).includes('/api/balance/add')) {
      addCallCount++;
      return new Response(JSON.stringify({ data: { redirectUrl: 'https://pay.example/x' } }));
    }
    return new Response('null');
  }) as typeof fetch;
  const { messages } = captureOutgoing();

  ui.amount = 100;
  ui.pendingPay = true;

  postFromOutside({
    kind: 'init', login: 'testuser',
    currency: 'RUB', balance: 1000,
    urls: { support: '', popupLogoLink: '', balanceCalcApi: 'https://h.local/api/balance/calc', balanceAddApi: 'https://h.local/api/balance/add' },
  });
  expect(ui.pendingPay).toBe(true);  // still pending — email not yet

  postFromOutside({ kind: 'email', email: '' });
  expect(ui.pendingPay).toBe(false);  // drain flipped

  // Wait for the void-fired payAndNavigate microtask chain to complete.
  await new Promise((r) => setTimeout(r, 30));
  expect(addCallCount).toBe(1);
  const navigates = messages.filter(m => m.kind === 'navigate');
  expect(navigates.length).toBe(1);
  expect((navigates[0]?.data as { url: string }).url).toBe('https://pay.example/x');
  expect((navigates[0]?.data as { uid?: string }).uid).toBeUndefined();
});

test('postSupport posts {kind:support} on the wire', () => {
  const { messages } = captureOutgoing();
  postSupport();
  expect(messages.length).toBe(1);
  expect(messages[0]?.kind).toBe('support');
});

test('postMenuAction posts {kind:menu-action, action:...}', () => {
  const { messages } = captureOutgoing();
  postMenuAction('orders');
  postMenuAction('settings');
  expect(messages.map(m => (m.data as { action: string }).action))
    .toEqual(['orders', 'settings']);
});

test('email leak guard: prior test email does not appear in subsequent submitPay body', async () => {
  // Seeds email then resets — verifies _resetForTest() actually clears the
  // module-local email so cross-test pollution is impossible.
  postFromOutside({ kind: 'email', email: 'leaky@example.com' });
  _resetForTest();
  initBridge();   // re-attach BC listener after reset

  let capturedBody = '';
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = init?.body as string;
    return new Response(JSON.stringify({ data: { redirectUrl: 'https://x' } }));
  }) as typeof fetch;

  ui.amount = 100; ui.urls.balanceAddApi = 'https://h.local/api/balance/add'; ui.userLogin = 'u';
  ui.methodId = 'paypalych-sbp';
  ui.initSeen = true; ui.emailReceived = true;
  await payAndNavigate();
  const body = JSON.parse(capturedBody);
  expect(body).not.toHaveProperty('email');
});

test('shown message resets transient UI state but preserves session state', () => {
  // Seed session state via init + email so initSeen / emailReceived
  // flip to true. Each of those should ALSO survive 'shown' — they
  // gate the pay-flow drain (bridge.ts handleIncoming pendingPay
  // logic) and resetting them would force a redundant re-handshake
  // on every popup re-open.
  postFromOutside({
    kind: 'init', login: 'testuser',
    currency: 'KZT',
    balance: 2000,
    urls: { support: 'https://j.chat/x', popupLogoLink: '', balanceCalcApi: '', balanceAddApi: 'https://h.local/api/balance/add' },
  });
  postFromOutside({ kind: 'email', email: 'matrix@example.com' });
  expect(ui.initSeen).toBe(true);
  expect(ui.emailReceived).toBe(true);

  // Simulate user activity: typed amount, opened dropdown, got calc back.
  ui.amount = 500;
  ui.menuOpen = true;
  ui.methodOpen = true;
  ui.methodId = 'paypalych-card';  // sticky preference — must survive
  ui.calc = { amount: 550, amountToBalance: 500, amountToBalanceUSD: 5, amountToBalanceKZT: 3000, minAmount: 50, maxAmount: 15000 };
  ui.calcError = 'network';
  ui.calcLoading = true;
  ui.pendingPay = true;

  // Steam closes popup on outside-click; framework re-shows it → 'shown'.
  postFromOutside({ kind: 'shown' });

  // Transient state cleared. Amount resets to the currency-specific
  // default (KZT → 7000) — user-requested pre-fill so the popup opens
  // ready-to-pay rather than with an empty field. RUB → 1000, USD → 15,
  // other currencies → 0. (See defaultAmountForCurrency in state.svelte.ts.)
  expect(ui.amount).toBe(7000);
  expect(ui.menuOpen).toBe(false);
  expect(ui.methodOpen).toBe(false);
  expect(ui.calc).toBeNull();
  expect(ui.calcError).toBeNull();
  // calcLoading is TRUE after 'shown' because the handler calls
  // scheduleCalc() to kick a fresh calc; scheduleCalc now flips
  // calcLoading=true synchronously so the pay-button locks during
  // the re-open debounce window (user spec: button stays disabled
  // until backend has responded).
  expect(ui.calcLoading).toBe(true);
  expect(ui.pendingPay).toBe(false);

  // Session state preserved (login, urls, currency, balance,
  // methodId, initSeen, emailReceived).
  expect(ui.userLogin).toBe('testuser');
  expect(ui.urls.balanceAddApi).toBe('https://h.local/api/balance/add');
  expect(ui.userCurrency).toBe('KZT');
  expect(ui.userBalance).toBe(2000);
  expect(ui.urls.support).toBe('https://j.chat/x');
  expect(ui.methodId).toBe('paypalych-card');  // user's last choice persisted
  expect(ui.initSeen).toBe(true);
  expect(ui.emailReceived).toBe(true);
});

test('hidden message resets transient UI state but preserves session state', () => {
  // Mirror of the 'shown' reset test, exercising the proactive reset
  // path. On slow PCs the 'shown' reset arrives ~1 frame after the
  // popup re-renders, causing a visible "dropdowns close on their own"
  // flash. The 'hidden' handler resets the same transient state WHILE
  // the popup is invisible (between close-via-blur and re-show), so
  // the next re-open paints from a clean slate immediately.
  postFromOutside({
    kind: 'init', login: 'testuser',
    currency: 'KZT',
    balance: 2000,
    urls: { support: 'https://j.chat/x', popupLogoLink: '', balanceCalcApi: '', balanceAddApi: 'https://h.local/api/balance/add' },
  });
  postFromOutside({ kind: 'email', email: 'matrix@example.com' });

  // Simulate user activity: typed amount, opened dropdown, got calc back.
  ui.amount = 500;
  ui.menuOpen = true;
  ui.methodOpen = true;
  ui.methodId = 'paypalych-card';  // sticky preference — must survive
  ui.calc = { amount: 550, amountToBalance: 500, amountToBalanceUSD: 5, amountToBalanceKZT: 3000, minAmount: 50, maxAmount: 15000 };
  ui.calcError = 'network';
  ui.calcLoading = true;
  ui.pendingPay = true;

  // Steam closes popup on outside-click; framework relays popup-hide-event
  // → main shell's popup.on('hide') sends `kind:'hidden'`.
  postFromOutside({ kind: 'hidden' });

  // Transient state cleared. Amount resets to currency default (KZT → 7000).
  expect(ui.amount).toBe(7000);
  expect(ui.menuOpen).toBe(false);
  expect(ui.methodOpen).toBe(false);
  expect(ui.calc).toBeNull();
  expect(ui.calcError).toBeNull();
  expect(ui.calcLoading).toBe(false);
  expect(ui.pendingPay).toBe(false);

  // Session state preserved (login, urls, currency, balance,
  // methodId, initSeen, emailReceived). Same invariants as the 'shown'
  // reset case.
  expect(ui.userLogin).toBe('testuser');
  expect(ui.urls.balanceAddApi).toBe('https://h.local/api/balance/add');
  expect(ui.userCurrency).toBe('KZT');
  expect(ui.userBalance).toBe(2000);
  expect(ui.urls.support).toBe('https://j.chat/x');
  expect(ui.methodId).toBe('paypalych-card');
  expect(ui.initSeen).toBe(true);
  expect(ui.emailReceived).toBe(true);
});

test('hidden envelope: also clears lastEdited and desiredBalance', () => {
  // Seed transient state typical for an active desired-mode session.
  ui.lastEdited = 'desired';
  ui.desiredBalance = 3000;

  // Steam closes popup → kind:'hidden' → resetTransientUI runs.
  postFromOutside({ kind: 'hidden' });

  expect(ui.lastEdited).toBe('pay');
  expect(ui.desiredBalance).toBe(0);
});

test('hidden does NOT kick a calc fetch (popup is hidden, fetch would be wasteful)', async () => {
  // 'shown' kicks scheduleCalc(); 'hidden' MUST NOT. Firing a calc for
  // a hidden popup would bill /api/balance/calc for no rendered output,
  // and would race with the 'shown' kick that follows on re-open. The
  // reset must clear ui.calc but not schedule a replacement.
  let calcCallCount = 0;
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    if (String(url).includes('/api/balance/calc')) {
      calcCallCount++;
      return new Response(JSON.stringify({
        success: true,
        data: { amount: 1100, amountToBalance: 1000, amountToBalanceUSD: 11,
                amountToBalanceKZT: 6500, minAmount: 50, maxAmount: 15000 },
      }));
    }
    return new Response('null');
  }) as typeof fetch;

  postFromOutside({
    kind: 'init', login: 'u',
    currency: 'RUB', balance: 1000,
    urls: { support: '', popupLogoLink: '', balanceCalcApi: 'https://h.local/api/balance/calc', balanceAddApi: 'https://h.local/api/balance/add' },
  });
  postFromOutside({ kind: 'email', email: 'u@example' });
  postFromOutside({
    kind: 'payment-methods',
    methods: [{ type: 'paypalych-sbp', name: 'СБП', imageUrl: 'http://x/sbp.svg' }],
    loading: false, error: null,
  });
  // Initial-mount calc fires via applyPaymentMethods's heal handler
  // (prevMethodId='' + amount=1000 + non-empty methods). Wait for that
  // to drain so the count below measures only post-'hidden' activity.
  await new Promise(r => setTimeout(r, 500));
  const baselineCalls = calcCallCount;

  // Now fire 'hidden'. The reset clears ui.calc but MUST NOT enqueue
  // a fresh /calc round-trip.
  postFromOutside({ kind: 'hidden' });
  await new Promise(r => setTimeout(r, 500));

  expect(calcCallCount).toBe(baselineCalls);
});

test('hidden cancels a pending debounced calc (no fetch fires post-hide)', async () => {
  // Stronger version of the no-wasted-fetch invariant: arm scheduleCalc()
  // directly, then fire 'hidden' BEFORE the 400 ms debounce elapses. The
  // 'hidden' handler must cancel the pending timer so runCalc never
  // fires while the popup is hidden. Without cancelPendingCalc() in
  // resetTransientUI(), the timer would still fire after the reset and
  // issue a wasted /api/balance/calc — the calcId monotonic guard would
  // protect correctness but the wasted network round-trip is still
  // observable here.
  const { scheduleCalc } = await import('../lib/api');
  let calcCallCount = 0;
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    if (String(url).includes('/api/balance/calc')) {
      calcCallCount++;
      return new Response(JSON.stringify({
        success: true,
        data: { amount: 1100, amountToBalance: 1000, amountToBalanceUSD: 11,
                amountToBalanceKZT: 6500, minAmount: 50, maxAmount: 15000 },
      }));
    }
    return new Response('null');
  }) as typeof fetch;

  // Seed enough state that runCalc would actually fire (amount +
  // balanceCalcApi + methodId all valid). Skip BC routing — drive ui
  // directly so the initial-mount heal-handler calc doesn't fire and
  // contaminate the count.
  ui.userLogin = 'u';
  ui.urls.balanceCalcApi = 'https://h.local/api/balance/calc';
  ui.userCurrency = 'RUB';
  ui.userBalance = 1000;
  ui.amount = 1234;
  ui.methodId = 'paypalych-sbp';
  ui.paymentMethods = [{ type: 'paypalych-sbp', name: 'СБП', imageUrl: 'http://x/sbp.svg' }];

  scheduleCalc();  // arms a 400ms setTimeout(runCalc)

  // Fire 'hidden' immediately — well before the debounce elapses.
  postFromOutside({ kind: 'hidden' });

  // Wait past the 400 ms debounce; if cancelPendingCalc didn't fire,
  // the armed timer would have run runCalc by now.
  await new Promise(r => setTimeout(r, 500));

  expect(calcCallCount).toBe(0);
});

test('shown message kicks a fresh calc even when amount + methodId did not change', async () => {
  // Re-open invariant: on every 'shown' message the popup must issue
  // a fresh /api/balance/calc round-trip so the previous-open's now-
  // stale wallet balance + receive amount get refreshed. The App.svelte
  // $effect tracking (ui.amount, ui.methodId) only re-runs when one of
  // those changes — on re-open both can equal their previous-open
  // values (sticky method preference + same currency default). Without
  // bridge.ts calling scheduleCalc() explicitly inside the 'shown'
  // handler, the popup re-opens with calc=null and the user sees
  // "Получите: —" + a disabled pay button until they manually edit
  // the amount. This regression test pins that explicit kick.
  let calcCallCount = 0;
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    if (String(url).includes('/api/balance/calc')) {
      calcCallCount++;
      return new Response(JSON.stringify({
        success: true,
        data: { amount: 1100, amountToBalance: 1000, amountToBalanceUSD: 11,
                amountToBalanceKZT: 6500, minAmount: 50, maxAmount: 15000 },
      }));
    }
    return new Response('null');
  }) as typeof fetch;

  // Seed init + methods so calc has everything it needs.
  postFromOutside({
    kind: 'init', login: 'u',
    currency: 'RUB', balance: 1000,
    urls: { support: '', popupLogoLink: '', balanceCalcApi: 'https://h.local/api/balance/calc', balanceAddApi: 'https://h.local/api/balance/add' },
  });
  postFromOutside({ kind: 'email', email: 'u@example' });
  postFromOutside({
    kind: 'payment-methods',
    methods: [{ type: 'paypalych-sbp', name: 'СБП', imageUrl: 'http://x/sbp.svg' }],
    loading: false, error: null,
  });

  // ui.amount was just pre-filled to 1000 (RUB default), methodId is
  // 'paypalych-sbp'. Re-fire 'shown' with identical state — neither
  // value changes, so the App.svelte $effect would NOT re-fire.
  postFromOutside({ kind: 'shown' });

  // Wait past the 400 ms scheduleCalc debounce.
  await new Promise(r => setTimeout(r, 500));

  expect(calcCallCount).toBeGreaterThan(0);
});

test('balance:undefined ignored (no wipe) but balance:0 honored', () => {
  postFromOutside({
    kind: 'init', login: 'a', currency: 'RUB', balance: 1500,
  });
  expect(ui.userBalance).toBe(1500);
  // Stale init w/o balance field
  postFromOutside({ kind: 'init', login: 'a' });
  expect(ui.userBalance).toBe(1500);  // not wiped
  // balance:0 — valid (юзер с пустым кошельком)
  postFromOutside({ kind: 'init', login: 'a', balance: 0 });
  expect(ui.userBalance).toBe(0);     // honored
});

// payment-methods inbound kind — the dynamic /api/payments list is fetched
// in the booster-checkout IIFE and pushed over BC as its own kind.

test('payment-methods inbound updates ui via applyPaymentMethods', () => {
  ui.paymentMethods = [];
  ui.methodId = '';
  ui.paymentMethodsLoading = false;
  ui.paymentMethodsError = null;

  const m1: PaymentMethod = { type: 'paypalych-sbp',  name: 'СБП',   imageUrl: 'http://x/sbp.svg' };
  const m2: PaymentMethod = { type: 'paypalych-card', name: 'Карта', imageUrl: 'http://x/visa.svg' };

  postFromOutside({
    kind: 'payment-methods', methods: [m1, m2],
    loading: true, error: null,
  });

  expect(ui.paymentMethods.length).toBe(2);
  expect(ui.methodId).toBe('paypalych-sbp');
  expect(ui.paymentMethodsLoading).toBe(true);
  expect(ui.paymentMethodsError).toBeNull();
});

test('payment-methods inbound with error string is captured', () => {
  postFromOutside({
    kind: 'payment-methods', methods: [], loading: false, error: 'network',
  });
  expect(ui.paymentMethodsError).toBe('network');
});

test('payment-methods inbound filters malformed items', () => {
  postFromOutside({
    kind: 'payment-methods',
    methods: [
      { type: 'good', name: 'G', imageUrl: 'http://x/g.svg' },     // valid
      { type: 'b' },                                               // missing name/url
      { name: 'C', imageUrl: 'http://x/c.svg' },                   // missing type
      'not-an-object',                                             // not object
      null,                                                        // null
    ],
    loading: false, error: null,
  });
  expect(ui.paymentMethods.length).toBe(1);
  expect(ui.paymentMethods[0].type).toBe('good');
});

test('postRefreshPaymentMethods posts a refresh envelope on BC', async () => {
  const { messages, bc } = captureOutgoing();
  postRefreshPaymentMethods();
  // InMemoryBC dispatches synchronously today, but every other BC-roundtrip
  // test in this file awaits a tiny timeout for consistency — defense
  // against a future polyfill that batches deliveries on a microtask.
  await new Promise((r) => setTimeout(r, 5));
  const refresh = messages.find(m => (m.data as { kind?: string })?.kind === 'refresh-payment-methods');
  expect(refresh).toBeDefined();
  bc.close();
});

test('payAndNavigate posts navigate envelope carrying uid when submitPay returns {redirectUrl, uid}', async () => {
  const UID = 'order-uid-abc123';
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    if (String(url).includes('/api/balance/add')) {
      return new Response(JSON.stringify({ data: { redirectUrl: 'https://pay.example/r', uid: UID } }));
    }
    return new Response('null');
  }) as typeof fetch;

  const { messages } = captureOutgoing();

  postFromOutside({
    kind: 'init', login: 'u',
    currency: 'RUB', balance: 1000,
    urls: { support: '', popupLogoLink: '', balanceCalcApi: '', balanceAddApi: 'https://h.local/api/balance/add' },
  });
  postFromOutside({ kind: 'email', email: '' });
  ui.amount = 100;

  await payAndNavigate();

  const nav = messages.find(m => m.kind === 'navigate');
  expect(nav).toBeDefined();
  expect((nav?.data as { url: string }).url).toBe('https://pay.example/r');
  expect((nav?.data as { uid?: string }).uid).toBe(UID);
});

// ── prefill via 'shown' envelope ────────────────────────────────────────
//
// The prefill amount (from a cross-target booster-addfunds.topup-requested publish)
// is carried into the popup via the `prefillAmount` field on the
// {kind:'shown'} envelope — NOT a separate {kind:'prefill'} message.
// Single envelope = no race between the prefill write and the
// unconditional resetTransientUI() that 'shown' runs.
//
// Tests below pin both halves of the contract: prefillAmount writes to
// ui.amount when present; falls back to defaultAmountForCurrency when
// absent or invalid. Invariant: existing 'shown' tests above (currency-
// default fallback) cover the no-prefill path. Code-review C-1 from
// 2026-05-21 removed the standalone 'prefill' kind handler.

test('shown with prefillAmount seeds ui.amount + sets lastEdited=pay', () => {
  // Seed pre-existing state that the reset must clear.
  ui.userCurrency = 'KZT';  // would otherwise default to 7000
  ui.amount = 0;
  ui.lastEdited = 'desired';
  ui.desiredBalance = 999;
  postFromOutside({ kind: 'shown', prefillAmount: 5000 });
  expect(ui.amount).toBe(5000);  // prefill wins over currency default
  expect(ui.lastEdited).toBe('pay');
  expect(ui.desiredBalance).toBe(0);
});

test('shown without prefillAmount falls back to currency default (KZT → 7000)', () => {
  ui.userCurrency = 'KZT';
  ui.amount = 0;
  postFromOutside({ kind: 'shown' });
  expect(ui.amount).toBe(7000);
});

test('shown with prefillAmount=null falls back to currency default', () => {
  ui.userCurrency = 'RUB';
  ui.amount = 0;
  postFromOutside({ kind: 'shown', prefillAmount: null });
  expect(ui.amount).toBe(1000);
});

test('shown with prefillAmount=0 falls back to currency default (treated as invalid)', () => {
  ui.userCurrency = 'RUB';
  ui.amount = 0;
  postFromOutside({ kind: 'shown', prefillAmount: 0 });
  expect(ui.amount).toBe(1000);
});

test('shown with prefillAmount=NaN falls back to currency default', () => {
  ui.userCurrency = 'USD';
  ui.amount = 0;
  postFromOutside({ kind: 'shown', prefillAmount: NaN });
  expect(ui.amount).toBe(15);  // USD default
});

test('shown with prefillAmount=negative falls back to currency default', () => {
  ui.userCurrency = 'RUB';
  ui.amount = 0;
  postFromOutside({ kind: 'shown', prefillAmount: -50 });
  expect(ui.amount).toBe(1000);
});

test('shown with prefillAmount=fractional → floored', () => {
  ui.userCurrency = 'KZT';
  ui.amount = 0;
  postFromOutside({ kind: 'shown', prefillAmount: 5000.7 });
  expect(ui.amount).toBe(5000);
});

test('shown with prefillAmount overrides any prior ui.amount even when non-zero', () => {
  // The 'shown' reset is unconditional (unlike the 'init' guard that
  // preserves a user-typed amount). When the popup is being re-opened
  // via openTopupWithAmount, the carried prefill MUST land — the user
  // hasn't typed yet (popup was hidden), so there's no input to protect.
  ui.userCurrency = 'KZT';
  ui.amount = 1234;  // stale from a prior open
  postFromOutside({ kind: 'shown', prefillAmount: 5000 });
  expect(ui.amount).toBe(5000);
});

test('postFaq posts a faq popup-message envelope', () => {
  const cap = captureOutgoing();
  postFaq();
  const faq = cap.messages.find(m => m.kind === 'faq');
  expect(faq).toBeTruthy();
  cap.bc.close();
});

test('resetTransientUI (via hidden) clears ui.payError', () => {
  ui.payError = 'boom';
  postFromOutside({ kind: 'hidden' });   // → handleIncoming → resetTransientUI
  expect(ui.payError).toBeNull();
});
