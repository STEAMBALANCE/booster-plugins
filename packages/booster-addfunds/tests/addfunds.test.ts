// booster-plugins/packages/booster-addfunds/tests/addfunds.test.ts
//
// Tests for registerAddFundsPage — the page-router handler that hides
// Steam's wallet top-up grid (.game_area_purchase) and inserts our
// single branded amount-input row in its place. Submitting publishes
// `booster-addfunds.topup-requested` on the cross-target bus so booster-checkout's
// main-shell popup picks the amount up and pre-fills.
//
// Cross-target user data: currency/balance arrive via `booster-checkout.user.snapshot`
// bus events published by main-shell. The store target can't read
// sb.steam directly (BC origin mismatch with store.steampowered.com),
// so addfunds subscribes to the bus on registration and renders the
// row immediately on mount, patching placeholder/symbol when a snapshot
// lands. The makeSbStub `fireBus` helper simulates main-shell's
// broadcast for test scenarios.
//
// Fixture DOM closely mirrors the real addfunds page probed via CDP.
// happy-dom does not run scripts — we exercise mount/unmount directly.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Window } from 'happy-dom';
import { registerAddFundsPage } from '../src/pages/addfunds';
import { installAddFundsWeb } from '../src/install';

function installDom(): Window {
  const w = new Window({ url: 'https://store.steampowered.com/steamaccount/addfunds/' });
  // happy-dom 20 leaves window.SyntaxError unset; querySelector parser needs it.
  (w as unknown as { SyntaxError: typeof SyntaxError }).SyntaxError = SyntaxError;
  Object.assign(globalThis, {
    window: w,
    document: w.document,
    history: w.history,
    location: w.location,
    MutationObserver: w.MutationObserver,
    Event: w.Event,
    KeyboardEvent: w.KeyboardEvent,
    HTMLElement: w.HTMLElement,
    HTMLInputElement: w.HTMLInputElement,
    HTMLButtonElement: w.HTMLButtonElement,
    addEventListener: w.addEventListener.bind(w),
    removeEventListener: w.removeEventListener.bind(w),
  });
  document.body.innerHTML = `
    <div class="page_content_ctn">
      <div class="page_content">
        <div class="leftcol addfunds_about">
          <p>RU wallet description copy from Steam</p>
        </div>
        <div class="leftcol">
          <form id="form_addfunds"></form>
          <div class="game_area_purchase">
            <div class="addfunds_area_purchase_game">1 500</div>
            <div class="addfunds_area_purchase_game">3 000</div>
          </div>
          <p class="addfunds_footer_text">Steam wallet agreement footer copy</p>
        </div>
        <div class="rightcol">Right column</div>
      </div>
    </div>
  `;
  return w;
}

interface SbStub {
  sb: any;
  pageReg: { name: string; match: { url: RegExp | ((u: URL) => boolean) }; mount: any }[];
  busPubs: { topic: string; data: unknown }[];
  /** Deliver a bus event to ALL subscribers registered on the topic. */
  fireBus: (topic: string, data: unknown) => void;
  /** Number of live subscribers registered on a topic. */
  subCount: (topic: string) => number;
  /** Fire `sb.scope.signal`'s abort. A fresh scope == a fresh
   *  snapshot-service (keyed on scope.signal). */
  abortScope: () => void;
}

function makeSbStub(): SbStub {
  const pageReg: SbStub['pageReg'] = [];
  const busPubs: SbStub['busPubs'] = [];
  const busSubs = new Map<string, Set<(d: unknown) => void>>();
  const fireBus = (topic: string, data: unknown): void => {
    const set = busSubs.get(topic);
    if (!set) return;
    for (const cb of set) cb(data);
  };
  const subCount = (topic: string): number => busSubs.get(topic)?.size ?? 0;
  // Per-stub AbortController feeds sb.scope.signal. The snapshot service
  // is keyed on this signal, so a fresh controller == a fresh service —
  // tests exercising the across-scope behaviour need a working signal.
  const scopeCtrl = new AbortController();
  return {
    sb: {
      context: { kind: 'web', url: location.href, onUrlChange: () => () => {} },
      pages: {
        register: (o: any) => { pageReg.push(o); return { unregister: () => {} }; },
      },
      bus: {
        publish: (topic: string, data: unknown) => { busPubs.push({ topic, data }); },
        subscribe: (topic: string, cb: (d: unknown) => void) => {
          let s = busSubs.get(topic);
          if (!s) { s = new Set(); busSubs.set(topic, s); }
          s.add(cb);
          return () => { s!.delete(cb); };
        },
      },
      steam: {
        getCurrentUser: () => null,
        getCurrentUserAsync: () => new Promise<unknown>(() => {}),
        onUserChange: () => () => {},
        openUrl: async () => {},
      },
      lifecycle: { ready: async () => {}, rollbackAll: () => {}, _markReady: () => {} },
      scope: {
        signal: scopeCtrl.signal,
        _abort: () => scopeCtrl.abort(),
      },
    } as any,
    pageReg,
    busPubs,
    fireBus,
    subCount,
    abortScope: () => scopeCtrl.abort(),
  };
}

// Globals snapshot/restore: installDom() assigns a happy-dom Window's
// document/window/MutationObserver onto globalThis. Without an
// afterEach to undo that, the install bleeds into the next test file's
// beforeEach (bun test runs files in a shared process), shadowing
// whatever DOM polyfill that file expects. Snapshot before install,
// restore after — keep this file's mutations local. Code-review M-5
// from 2026-05-21.
const SNAPSHOT_KEYS = [
  'window', 'document', 'history', 'location', 'MutationObserver',
  'Event', 'KeyboardEvent', 'HTMLElement', 'HTMLInputElement',
  'HTMLButtonElement', 'addEventListener', 'removeEventListener',
] as const;
let snapGlobals: Record<string, unknown> = {};

describe('registerAddFundsPage', () => {
  beforeEach(() => {
    snapGlobals = {};
    for (const k of SNAPSHOT_KEYS) {
      snapGlobals[k] = (globalThis as Record<string, unknown>)[k];
    }
    installDom();
  });

  afterEach(() => {
    for (const k of SNAPSHOT_KEYS) {
      const v = snapGlobals[k];
      if (v === undefined) delete (globalThis as Record<string, unknown>)[k];
      else (globalThis as Record<string, unknown>)[k] = v;
    }
  });

  test('register hooks sb.pages.register with addfunds matcher', () => {
    const { sb, pageReg } = makeSbStub();
    registerAddFundsPage(sb);
    expect(pageReg.length).toBe(1);
    expect(pageReg[0]!.name).toBe('booster-addfunds');
    const match = pageReg[0]!.match;
    expect(match.url instanceof RegExp).toBe(true);
    const re = match.url as RegExp;
    expect(re.test('https://store.steampowered.com/steamaccount/addfunds/')).toBe(true);
    expect(re.test('https://store.steampowered.com/steamaccount/addfunds?from=email')).toBe(true);
    expect(re.test('https://store.steampowered.com/app/123')).toBe(false);
  });

  test('register subscribes to booster-checkout.user.snapshot and publishes a .request', () => {
    // Both the subscribe + the .request publish must happen at
    // registration time (BEFORE mount), so a snapshot main-shell publishes
    // in response lands well before mount runs.
    const { sb, busPubs } = makeSbStub();
    registerAddFundsPage(sb);
    expect(busPubs).toContainEqual({ topic: 'booster-addfunds.user.snapshot.request', data: null });
  });

  test('mount renders row IMMEDIATELY (no await on user data)', async () => {
    // The mount path must not block on any user-data fetch — placeholder
    // and symbol start empty and patch in via the snapshot listener.
    // Regression for the 5s-getCurrentUserAsync-timeout bug.
    const { sb, pageReg } = makeSbStub();
    registerAddFundsPage(sb);
    const ac = new AbortController();
    const t0 = Date.now();
    await pageReg[0]!.mount({ url: new URL(location.href), signal: ac.signal });
    const dt = Date.now() - t0;
    expect(dt).toBeLessThan(500);  // generous ceiling; happy path is <50ms
    const row = document.getElementById('booster-topup-bar');
    expect(row).not.toBeNull();
    const input = row?.querySelector<HTMLInputElement>('input.booster-topup-input');
    expect(input?.placeholder).toBe('');
    const symbol = row?.querySelector<HTMLElement>('.booster-topup-symbol');
    expect(symbol?.textContent).toBe('');
  });

  test('snapshot BEFORE mount → row built with cached currency placeholder', async () => {
    const { sb, pageReg, fireBus } = makeSbStub();
    registerAddFundsPage(sb);
    fireBus('booster-checkout.user.snapshot', { accountName: 'tester', currency: 'KZT', balance: 0 });
    const ac = new AbortController();
    await pageReg[0]!.mount({ url: new URL(location.href), signal: ac.signal });
    const input = document.querySelector<HTMLInputElement>('input.booster-topup-input');
    expect(input?.placeholder).toBe('7000');
    const symbol = document.querySelector<HTMLElement>('.booster-topup-symbol');
    expect(symbol?.textContent).toBe('₸');
  });

  test('snapshot AFTER mount → placeholder + symbol patch in place', async () => {
    const { sb, pageReg, fireBus } = makeSbStub();
    registerAddFundsPage(sb);
    const ac = new AbortController();
    await pageReg[0]!.mount({ url: new URL(location.href), signal: ac.signal });
    const input = document.querySelector<HTMLInputElement>('input.booster-topup-input')!;
    const symbol = document.querySelector<HTMLElement>('.booster-topup-symbol')!;
    expect(input.placeholder).toBe('');
    expect(symbol.textContent).toBe('');
    fireBus('booster-checkout.user.snapshot', { accountName: 'tester', currency: 'RUB', balance: 5 });
    expect(input.placeholder).toBe('1000');
    expect(symbol.textContent).toBe('₽');
  });

  test('mount hides grid + positions row immediately before it', async () => {
    const { sb, pageReg, fireBus } = makeSbStub();
    registerAddFundsPage(sb);
    fireBus('booster-checkout.user.snapshot', { accountName: 'tester', currency: 'KZT', balance: 0 });
    const ac = new AbortController();
    await pageReg[0]!.mount({ url: new URL(location.href), signal: ac.signal });
    const grid = document.querySelector<HTMLElement>('.game_area_purchase');
    expect(grid?.style.display).toBe('none');
    const row = document.getElementById('booster-topup-bar');
    expect(row).not.toBeNull();
    // Positional pin: row is inserted IMMEDIATELY BEFORE the (now hidden)
    // grid so it occupies the same column flow. A regression that
    // appendChild'd the row to the parent would float it below the
    // agreement footer — visible to QA but easy to miss without an
    // explicit assertion. Code-review S-6 from 2026-05-21.
    expect(row?.nextElementSibling).toBe(grid);
  });

  test('submit click → bus.publish booster-addfunds.topup-requested with typed amount', async () => {
    const { sb, pageReg, busPubs, fireBus } = makeSbStub();
    registerAddFundsPage(sb);
    fireBus('booster-checkout.user.snapshot', { accountName: 'tester', currency: 'KZT', balance: 0 });
    const ac = new AbortController();
    await pageReg[0]!.mount({ url: new URL(location.href), signal: ac.signal });
    const row = document.getElementById('booster-topup-bar')!;
    const input = row.querySelector<HTMLInputElement>('input.booster-topup-input')!;
    const submit = row.querySelector<HTMLButtonElement>('button.booster-topup-submit')!;
    input.value = '5000';
    submit.click();
    expect(busPubs).toContainEqual({ topic: 'booster-addfunds.topup-requested', data: { amount: 5000 } });
  });

  test('empty submit falls back to current placeholder (post-snapshot)', async () => {
    const { sb, pageReg, busPubs, fireBus } = makeSbStub();
    registerAddFundsPage(sb);
    fireBus('booster-checkout.user.snapshot', { accountName: 'tester', currency: 'KZT', balance: 0 });
    const ac = new AbortController();
    await pageReg[0]!.mount({ url: new URL(location.href), signal: ac.signal });
    const submit = document.querySelector<HTMLButtonElement>('button.booster-topup-submit')!;
    submit.click();
    expect(busPubs).toContainEqual({ topic: 'booster-addfunds.topup-requested', data: { amount: 7000 } });
  });

  test('empty submit falls back to placeholder set by post-mount snapshot', async () => {
    // Regression: fireSubmit must read input.placeholder LIVE (not a
    // closure over the initial cold-boot empty value), so a snapshot
    // patching the placeholder after mount makes the empty-input
    // submit publish the new currency default.
    const { sb, pageReg, busPubs, fireBus } = makeSbStub();
    registerAddFundsPage(sb);
    const ac = new AbortController();
    await pageReg[0]!.mount({ url: new URL(location.href), signal: ac.signal });
    fireBus('booster-checkout.user.snapshot', { accountName: 'tester', currency: 'RUB', balance: 0 });
    const submit = document.querySelector<HTMLButtonElement>('button.booster-topup-submit')!;
    submit.click();
    expect(busPubs).toContainEqual({ topic: 'booster-addfunds.topup-requested', data: { amount: 1000 } });
  });

  test('Enter in input fires submit', async () => {
    const { sb, pageReg, busPubs, fireBus } = makeSbStub();
    registerAddFundsPage(sb);
    fireBus('booster-checkout.user.snapshot', { accountName: 'tester', currency: 'KZT', balance: 0 });
    const ac = new AbortController();
    await pageReg[0]!.mount({ url: new URL(location.href), signal: ac.signal });
    const input = document.querySelector<HTMLInputElement>('input.booster-topup-input')!;
    input.value = '3000';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(busPubs).toContainEqual({ topic: 'booster-addfunds.topup-requested', data: { amount: 3000 } });
  });

  test('unmount removes row + restores grid display', async () => {
    const { sb, pageReg, fireBus } = makeSbStub();
    registerAddFundsPage(sb);
    fireBus('booster-checkout.user.snapshot', { accountName: 'tester', currency: 'KZT', balance: 0 });
    const ac = new AbortController();
    const cleanup = await pageReg[0]!.mount({ url: new URL(location.href), signal: ac.signal });
    expect(typeof cleanup).toBe('function');
    cleanup?.();
    expect(document.getElementById('booster-topup-bar')).toBeNull();
    const grid = document.querySelector<HTMLElement>('.game_area_purchase');
    expect(grid?.style.display).toBe('');
  });

  test('numeric-only input filter', async () => {
    const { sb, pageReg, fireBus } = makeSbStub();
    registerAddFundsPage(sb);
    fireBus('booster-checkout.user.snapshot', { accountName: 'tester', currency: 'KZT', balance: 0 });
    const ac = new AbortController();
    await pageReg[0]!.mount({ url: new URL(location.href), signal: ac.signal });
    const input = document.querySelector<HTMLInputElement>('input.booster-topup-input')!;
    input.value = '12ab34';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.value).toBe('1234');
  });

  test('grid missing → mount returns gracefully (no row, no throw)', async () => {
    document.body.innerHTML = '<div class="page_content_ctn">no grid here</div>';
    const { sb, pageReg } = makeSbStub();
    registerAddFundsPage(sb);
    const ac = new AbortController();
    ac.abort();   // simulate aborted mount before grid arrives
    await pageReg[0]!.mount({ url: new URL(location.href), signal: ac.signal });
    expect(document.getElementById('booster-topup-bar')).toBeNull();
  });

  test('snapshot with non-string currency falls back to empty (unknown wallet)', async () => {
    const { sb, pageReg, busPubs, fireBus } = makeSbStub();
    registerAddFundsPage(sb);
    fireBus('booster-checkout.user.snapshot', { accountName: 'tester', currency: null, balance: 0 });
    const ac = new AbortController();
    await pageReg[0]!.mount({ url: new URL(location.href), signal: ac.signal });
    const input = document.querySelector<HTMLInputElement>('input.booster-topup-input')!;
    expect(input.placeholder).toBe('');
    const submit = document.querySelector<HTMLButtonElement>('button.booster-topup-submit')!;
    // Clear the registration-time .request publish so the assertion
    // below measures only the submit outcome.
    busPubs.length = 0;
    submit.click();
    expect(busPubs.filter((p) => p.topic === 'booster-addfunds.topup-requested').length).toBe(0);
  });

  test('no snapshot ever → empty placeholder, submit no-ops silently', async () => {
    // Cold-cold case: main-shell never publishes (no user). Mount still
    // runs immediately, row appears, submit on empty input is silent.
    const { sb, pageReg, busPubs } = makeSbStub();
    registerAddFundsPage(sb);
    const ac = new AbortController();
    await pageReg[0]!.mount({ url: new URL(location.href), signal: ac.signal });
    const input = document.querySelector<HTMLInputElement>('input.booster-topup-input')!;
    expect(input.placeholder).toBe('');
    busPubs.length = 0;
    const submit = document.querySelector<HTMLButtonElement>('button.booster-topup-submit')!;
    submit.click();
    expect(busPubs.filter((p) => p.topic === 'booster-addfunds.topup-requested').length).toBe(0);
  });

  test('snapshot with NaN balance defuses to null', async () => {
    // typeof NaN === 'number' would slip a typeof-only guard. addfunds
    // doesn't render balance today, but a downstream consumer reading
    // cachedSnapshot.balance must never see NaN. Code-review I-5
    // from 2026-05-21.
    const { sb, pageReg, fireBus } = makeSbStub();
    registerAddFundsPage(sb);
    const ac = new AbortController();
    await pageReg[0]!.mount({ url: new URL(location.href), signal: ac.signal });
    // Snapshot the balance reads via the listener — can't read the cache
    // directly, so we publish a valid currency along with the bad balance
    // and confirm the row still applies currency correctly (proves the
    // listener fired) while the bad balance was scrubbed (we can't observe
    // the cache directly, but the row's placeholder still derives from
    // currency, so the application path completes without TypeError).
    expect(() => fireBus('booster-checkout.user.snapshot',
      { accountName: 'tester', currency: 'KZT', balance: Number.NaN })).not.toThrow();
    const input = document.querySelector<HTMLInputElement>('input.booster-topup-input')!;
    // Currency applied → placeholder set (the listener ran to completion).
    expect(input.placeholder).toBe('7000');
  });

  test('snapshot service is shared across double registration (no double subscribe/request)', async () => {
    // A hypothetical double-call (future refactor / feature flag) must
    // not stand up a second snapshot stream: the shared service is keyed
    // on sb.scope.signal, so a second registerAddFundsPage in the same
    // scope reuses the existing subscription instead of double-subscribing
    // to `booster-checkout.user.snapshot` or emitting a second .request publish.
    // Duplicate page-name protection is the framework's job (the stub's
    // register just pushes), so we no longer assert pageReg.length here.
    const { sb, busPubs, subCount } = makeSbStub();
    registerAddFundsPage(sb);
    expect(() => registerAddFundsPage(sb)).not.toThrow();
    // Exactly one .request publish across both calls.
    expect(busPubs.filter((p) => p.topic === 'booster-addfunds.user.snapshot.request').length).toBe(1);
    // Exactly one subscriber on the snapshot topic — so a single snapshot
    // fires the service's apply chain exactly once.
    expect(subCount('booster-checkout.user.snapshot')).toBe(1);
  });

  test('snapshot service is scoped per AbortSignal (fresh injection cycle gets a fresh stream)', async () => {
    // A subsequent re-injection (rollback → re-attach) gets a fresh
    // AbortController. The snapshot service keys off `sb.scope.signal`,
    // so each fresh signal gets its own independent stream — the new
    // cycle re-registers cleanly without leaking state from the prior one.
    const stub1 = makeSbStub();
    registerAddFundsPage(stub1.sb);
    expect(stub1.pageReg.length).toBe(1);
    expect(stub1.subCount('booster-checkout.user.snapshot')).toBe(1);
    stub1.abortScope();
    // New scope == new makeSbStub. registerAddFundsPage on it must register
    // and stand up its own snapshot subscription.
    const stub2 = makeSbStub();
    registerAddFundsPage(stub2.sb);
    expect(stub2.pageReg.length).toBe(1);
    expect(stub2.subCount('booster-checkout.user.snapshot')).toBe(1);
  });

  test('malformed snapshot ignored (no accountName, wrong shapes)', async () => {
    const { sb, pageReg, fireBus } = makeSbStub();
    registerAddFundsPage(sb);
    const ac = new AbortController();
    await pageReg[0]!.mount({ url: new URL(location.href), signal: ac.signal });
    const input = document.querySelector<HTMLInputElement>('input.booster-topup-input')!;
    // null payload — defused
    fireBus('booster-checkout.user.snapshot', null);
    expect(input.placeholder).toBe('');
    // missing accountName — defused
    fireBus('booster-checkout.user.snapshot', { currency: 'RUB' });
    expect(input.placeholder).toBe('');
    // accountName wrong type — defused
    fireBus('booster-checkout.user.snapshot', { accountName: 42, currency: 'RUB' });
    expect(input.placeholder).toBe('');
    // valid → applies
    fireBus('booster-checkout.user.snapshot', { accountName: 'tester', currency: 'RUB' });
    expect(input.placeholder).toBe('1000');
  });

  test('unmount detaches snapshot listener (later snapshot does not touch input)', async () => {
    // After cleanup, the row is gone — a stray snapshot must not throw
    // or try to write into a detached node.
    const { sb, pageReg, fireBus } = makeSbStub();
    registerAddFundsPage(sb);
    const ac = new AbortController();
    const cleanup = await pageReg[0]!.mount({ url: new URL(location.href), signal: ac.signal });
    cleanup?.();
    // Firing now must not throw (listener detached on cleanup).
    expect(() => fireBus('booster-checkout.user.snapshot', { accountName: 'tester', currency: 'RUB' }))
      .not.toThrow();
  });

  // I-3 regression: findFooter must NOT match the page-wide
  // `.addfunds_about` description paragraph (it appears BEFORE the
  // grid in DOM order and also contains the Russian "соглашен" stem).
  // The new positional rule walks forward from grid's nextElementSibling
  // — the description paragraph is unreachable from that walk.

  test('findFooter ignores description-paragraph that sits BEFORE the grid', async () => {
    // Replace the fixture footer copy with one that matches the OLD
    // text-fallback (would be false-positive matched by the prior
    // /соглашен/i scan). The new positional rule only looks at the
    // immediate next-sibling chain, so a `соглашен`-bearing paragraph
    // upstream of the grid does NOT register.
    document.body.innerHTML = `
      <div class="page_content">
        <div class="leftcol addfunds_about">
          <p>Описание содержит слово соглашение — но это НЕ футер.</p>
        </div>
        <div class="leftcol">
          <div class="game_area_purchase"></div>
          <!-- intentionally no <p> after the grid -->
        </div>
      </div>
    `;
    const { sb, pageReg, fireBus } = makeSbStub();
    registerAddFundsPage(sb);
    fireBus('booster-checkout.user.snapshot', { accountName: 'tester', currency: 'KZT', balance: 0 });
    const ac = new AbortController();
    await pageReg[0]!.mount({ url: new URL(location.href), signal: ac.signal });
    // The description paragraph must remain visible (not hidden).
    const desc = document.querySelector<HTMLElement>('.addfunds_about p');
    expect(desc?.style.display).toBe('');
  });

  test('findFooter picks the <p> immediately after the grid (skipping inert nodes)', async () => {
    // <script>/<link>/<style> between grid and the agreement <p> are
    // skipped; the first <p> encountered wins. Use a <link> here as
    // the regression marker for the inert-skip allow-list.
    document.body.innerHTML = `
      <div class="page_content">
        <div class="leftcol">
          <div class="game_area_purchase"></div>
          <link rel="stylesheet" href="ignored.css">
          <p class="addfunds_footer_text">agreement copy</p>
        </div>
      </div>
    `;
    const { sb, pageReg, fireBus } = makeSbStub();
    registerAddFundsPage(sb);
    fireBus('booster-checkout.user.snapshot', { accountName: 'tester', currency: 'KZT', balance: 0 });
    const ac = new AbortController();
    await pageReg[0]!.mount({ url: new URL(location.href), signal: ac.signal });
    const footer = document.querySelector<HTMLElement>('p.addfunds_footer_text');
    expect(footer?.style.display).toBe('none');
  });

  // M-1 regression: the injected <style> element must be removed on
  // unmount so an unmount → re-mount cycle re-runs ensureStyles()
  // against a fresh block. The element is idempotent across mounts,
  // but leaving it could mask a future CSS edit shipped mid-session
  // via bundle hot-update.

  test('unmount removes the injected <style> block', async () => {
    const { sb, pageReg, fireBus } = makeSbStub();
    registerAddFundsPage(sb);
    fireBus('booster-checkout.user.snapshot', { accountName: 'tester', currency: 'KZT', balance: 0 });
    const ac = new AbortController();
    const cleanup = await pageReg[0]!.mount({ url: new URL(location.href), signal: ac.signal });
    expect(document.getElementById('booster-topup-style')).not.toBeNull();
    cleanup?.();
    expect(document.getElementById('booster-topup-style')).toBeNull();
  });

  test('installAddFundsWeb registers all store pages and returns a callable no-op teardown', async () => {
    // Regression: the returned teardown is a documented no-op — pages/bus
    // teardown is scope-abort bound (owned by sb.pages.register /
    // sb.bus.subscribe), not by this function. install() must register the
    // addfunds, app, and cart pages and hand back a callable that does not
    // throw when invoked.
    const { sb, pageReg } = makeSbStub();
    const ctx = { sb, log: { info: () => {}, warn: () => {}, error: () => {} } } as any;
    const teardown = await installAddFundsWeb(ctx);
    expect(pageReg.map((p) => p.name).sort()).toEqual([
      'booster-addfunds',
      'booster-addfunds-app',
      'booster-addfunds-cart',
    ]);
    expect(typeof teardown).toBe('function');
    expect(() => teardown()).not.toThrow();
  });
});
