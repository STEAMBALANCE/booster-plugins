// booster-plugins/packages/booster-addfunds/tests/cart-page.test.ts
//
// Tests for registerCartPage — the /cart/ page-router handler that
// renders the shared branded TopupBar AFTER the cart's "Ваша корзина"
// header, ONLY when the wallet balance is below the cart total, prefilled
// with the shortfall (ceil(total - balance)). The bar shows / hides /
// updates reactively as the cart total or the balance changes.
//
// Cross-target user data (currency/balance) arrives over the bus as
// `booster-checkout.user.snapshot` payloads, surfaced through the shared
// user-snapshot service (BC doesn't cross to store.steampowered.com).
//
// happy-dom does not run scripts; we drive mount/unmount directly and
// simulate main-shell's broadcast via `fireBus`. The reactive tests rely
// on happy-dom's MutationObserver firing on childList + characterData
// mutations (verified). To cross the 200ms render debounce, await
// tick(400).

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Window } from 'happy-dom';
import { registerCartPage } from '../src/pages/cart';

function installDom(): Window {
  const w = new Window({ url: 'https://store.steampowered.com/cart/' });
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
  return w;
}

function setBody(html: string): void {
  document.body.innerHTML = html;
}

const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface SbStub {
  sb: any;
  pageReg: { name: string; match: { url: RegExp | ((u: URL) => boolean) }; mount: any }[];
  busPubs: { topic: string; data: unknown }[];
  fireBus: (topic: string, data: unknown) => void;
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
  };
}

const SNAPSHOT_KEYS = [
  'window', 'document', 'history', 'location', 'MutationObserver',
  'Event', 'KeyboardEvent', 'HTMLElement', 'HTMLInputElement',
  'HTMLButtonElement', 'addEventListener', 'removeEventListener',
] as const;
let snapGlobals: Record<string, unknown> = {};

const findMount = (pageReg: SbStub['pageReg']) =>
  pageReg.find((p) => p.name === 'booster-addfunds-cart')!.mount;

describe('registerCartPage', () => {
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

  test('balance < total → bar prefilled with ceil(shortfall) after "Ваша корзина"', async () => {
    const { sb, pageReg, fireBus } = makeSbStub();
    registerCartPage(sb);
    fireBus('booster-checkout.user.snapshot', { accountName: 'u', currency: 'KZT', balance: 5000 });
    setBody(`<div class="panel"><div class="hdr">Ваша корзина</div></div>
             <div class="t"><div>Общая стоимость</div><div>19 031,00₸</div></div>`);
    await findMount(pageReg)({ url: new URL('https://store.steampowered.com/cart/'), signal: new AbortController().signal });
    await tick();
    const bar = document.getElementById('booster-topup-bar')!;
    expect(bar).not.toBeNull();
    expect((bar.querySelector('.booster-topup-input') as HTMLInputElement).value).toBe('14031'); // ceil(19031-5000)
    expect(bar.querySelector('.booster-topup-label')!.textContent).toBe('Вам не хватает баланса');
  });

  test('balance >= total → no bar', async () => {
    const { sb, pageReg, fireBus } = makeSbStub();
    registerCartPage(sb);
    fireBus('booster-checkout.user.snapshot', { accountName: 'u', currency: 'KZT', balance: 99999 });
    setBody(`<div class="hdr">Ваша корзина</div><div class="t"><div>Общая стоимость</div><div>19 031,00₸</div></div>`);
    await findMount(pageReg)({ url: new URL('https://store.steampowered.com/cart/'), signal: new AbortController().signal });
    await tick();
    expect(document.getElementById('booster-topup-bar')).toBeNull();
  });

  test('no snapshot → no bar; no total → no bar', async () => {
    // With NO snapshot fired, no bar (balance unknown).
    const { sb, pageReg, fireBus } = makeSbStub();
    registerCartPage(sb);
    setBody(`<div class="hdr">Ваша корзина</div><div class="t"><div>Общая стоимость</div><div>19 031,00₸</div></div>`);
    await findMount(pageReg)({ url: new URL('https://store.steampowered.com/cart/'), signal: new AbortController().signal });
    await tick();
    expect(document.getElementById('booster-topup-bar')).toBeNull();
    // Snapshot present but no "Общая стоимость" total in the DOM → still no bar.
    fireBus('booster-checkout.user.snapshot', { accountName: 'u', currency: 'KZT', balance: 5000 });
    setBody(`<div class="hdr">Ваша корзина</div><div class="t">no total here</div>`);
    await tick(400);
    expect(document.getElementById('booster-topup-bar')).toBeNull();
  });

  test('reactive: total drops below balance after mutation → bar removed', async () => {
    const { sb, pageReg, fireBus } = makeSbStub();
    registerCartPage(sb);
    fireBus('booster-checkout.user.snapshot', { accountName: 'u', currency: 'KZT', balance: 5000 });
    setBody(`<div class="hdr">Ваша корзина</div><div class="t"><div>Общая стоимость</div><div class="val">19 031,00₸</div></div>`);
    await findMount(pageReg)({ url: new URL('https://store.steampowered.com/cart/'), signal: new AbortController().signal });
    await tick();
    expect(document.getElementById('booster-topup-bar')).not.toBeNull();
    // user removes an item → total now below balance
    (document.querySelector('.val') as HTMLElement).textContent = '4 000,00₸';
    await tick(400); // cross the debounce
    expect(document.getElementById('booster-topup-bar')).toBeNull();
  });

  test('reactive: balance update via new snapshot recomputes', async () => {
    const { sb, pageReg, fireBus } = makeSbStub();
    registerCartPage(sb);
    fireBus('booster-checkout.user.snapshot', { accountName: 'u', currency: 'KZT', balance: 5000 });
    setBody(`<div class="hdr">Ваша корзина</div><div class="t"><div>Общая стоимость</div><div>19 031,00₸</div></div>`);
    await findMount(pageReg)({ url: new URL('https://store.steampowered.com/cart/'), signal: new AbortController().signal });
    await tick();
    expect(document.getElementById('booster-topup-bar')).not.toBeNull();
    fireBus('booster-checkout.user.snapshot', { accountName: 'u', currency: 'KZT', balance: 99999 }); // topped up
    await tick();
    expect(document.getElementById('booster-topup-bar')).toBeNull();
  });
});
