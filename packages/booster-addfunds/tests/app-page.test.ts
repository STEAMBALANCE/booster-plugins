// booster-plugins/packages/booster-addfunds/tests/app-page.test.ts
//
// Tests for registerAppPage — the /app/ page-router handler. Two branches:
//   - region-locked page (detectRegionLock true) → fetch region keys and,
//     if any, insert the keys block immediately after #error_box;
//   - normal app page → topup bar and the keys offer chip are mutually
//     exclusive (KEYS_COMING_SOON-gated): the bar lands at the top of the
//     editions column (.leftcol.game_description_column), the chip in the
//     first purchase row.
//
// happy-dom does not run scripts; we drive mount/unmount directly. The
// stub mirrors addfunds.test.ts: it provides sb.scope.signal (a real
// AbortSignal — ensureSnapshotService keys a WeakMap on it) and the bus
// (the snapshot service subscribes + publishes on it). registerAppPage
// accepts an optional 2nd arg { fetchRegionKeys } so tests inject a
// deterministic keys fetcher.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Window } from 'happy-dom';
import { registerAppPage } from '../src/pages/app';
import type { RegionKey } from '../src/lib/keys-api';

function installDom(): Window {
  const w = new Window({ url: 'https://store.steampowered.com/app/570/' });
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

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

const keyFixture: RegionKey = {
  id: 'k1',
  gameName: 'Game X',
  discountPercent: 32,
  priceRub: 1599,
  originalPriceRub: 2351,
  platform: 'windows',
};

interface SbStub {
  sb: any;
  pageReg: { name: string; match: { url: RegExp | ((u: URL) => boolean) }; mount: any }[];
}

function makeSbStub(): SbStub {
  const pageReg: SbStub['pageReg'] = [];
  const busSubs = new Map<string, Set<(d: unknown) => void>>();
  const scopeCtrl = new AbortController();
  return {
    sb: {
      context: { kind: 'web', url: location.href, onUrlChange: () => () => {} },
      pages: {
        register: (o: any) => { pageReg.push(o); return { unregister: () => {} }; },
      },
      bus: {
        publish: () => {},
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
  };
}

// Globals snapshot/restore (see addfunds.test.ts code-review M-5): installDom
// assigns happy-dom globals onto globalThis; undo after each test so the
// install does not bleed into the next file's beforeEach.
const SNAPSHOT_KEYS = [
  'window', 'document', 'history', 'location', 'MutationObserver',
  'Event', 'KeyboardEvent', 'HTMLElement', 'HTMLInputElement',
  'HTMLButtonElement', 'addEventListener', 'removeEventListener',
] as const;
let snapGlobals: Record<string, unknown> = {};

describe('registerAppPage', () => {
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

  test('normal app page → topup bar at the top of the editions/buy column', async () => {
    const { sb, pageReg } = makeSbStub();
    registerAppPage(sb);
    // Real Steam structure: the queue-actions panel sits above the content; the
    // "Издания"/"Купить" blocks live in .leftcol.game_description_column as
    // #game_area_purchase. The bar must land at the TOP of that column (above
    // the editions), NOT nested in the queue panel.
    setBody(`
      <div class="queue_and_playtime"><div id="queueCtn" class="queue_ctn"><div id="queueActionsCtn" class="queue_actions_ctn">В желаемое</div></div></div>
      <div class="leftcol game_description_column">
        <a class="franchise_notice">collection</a>
        <div id="game_area_purchase" class="game_area_purchase">
          <div class="game_purchase_price price" data-price-final="760000">7 600₸</div>
        </div>
      </div>`);
    const reg = pageReg.find((p) => p.name === 'booster-addfunds-app')!;
    await reg.mount({ url: new URL('https://store.steampowered.com/app/570/'), signal: new AbortController().signal });
    await tick();
    const bar = document.getElementById('booster-topup-bar')!;
    expect(bar).not.toBeNull();
    // Not nested in the queue panel.
    expect(bar.closest('#queueCtn')).toBeNull();
    // In the editions/buy column, as its first (top) element — above #game_area_purchase.
    const col = document.querySelector('.leftcol.game_description_column')!;
    expect(bar.parentElement).toBe(col);
    expect(col.firstElementChild).toBe(bar);
    // Prefilled with the first edition's price (data-price-final 760000 ÷ 100).
    expect((bar.querySelector('.booster-topup-input') as HTMLInputElement).value).toBe('7600');
  });

  test('normal app page with no readable price → bar stays empty (placeholder)', async () => {
    const { sb, pageReg } = makeSbStub();
    registerAppPage(sb);
    setBody(`
      <div class="leftcol game_description_column">
        <div id="game_area_purchase" class="game_area_purchase">
          <div class="game_purchase_price price">Бесплатно</div>
        </div>
      </div>`);
    const reg = pageReg.find((p) => p.name === 'booster-addfunds-app')!;
    await reg.mount({ url: new URL('https://store.steampowered.com/app/570/'), signal: new AbortController().signal });
    await tick();
    const bar = document.getElementById('booster-topup-bar')!;
    expect(bar).not.toBeNull();
    expect((bar.querySelector('.booster-topup-input') as HTMLInputElement).value).toBe('');
  });

  test('region page + keys → keys block after #error_box', async () => {
    const { sb, pageReg } = makeSbStub();
    registerAppPage(sb, { fetchRegionKeys: async () => [keyFixture] });
    setBody(`<div class="redeemwalletcode_marker"></div><div id="error_box"><span class="error">Данный товар недоступен в вашем регионе</span></div>`);
    const reg = pageReg.find((p) => p.name === 'booster-addfunds-app')!;
    await reg.mount({ url: new URL('https://store.steampowered.com/app/22350/'), signal: new AbortController().signal });
    await tick();
    const block = document.getElementById('booster-keys-block')!;
    expect(block).not.toBeNull();
    expect(document.getElementById('error_box')!.nextElementSibling).toBe(block);
  });

  test('region page + no keys → nothing', async () => {
    const { sb, pageReg } = makeSbStub();
    registerAppPage(sb, { fetchRegionKeys: async () => [] });
    setBody(`<div id="error_box"><span class="error">Данный товар недоступен в вашем регионе</span></div>`);
    const reg = pageReg.find((p) => p.name === 'booster-addfunds-app')!;
    await reg.mount({ url: new URL('https://store.steampowered.com/app/22350/'), signal: new AbortController().signal });
    await tick();
    expect(document.getElementById('booster-keys-block')).toBeNull();
    expect(document.getElementById('booster-topup-bar')).toBeNull();
  });

  test('normal page → first action gets booster-dist-host + our chip last; other blocks untouched', async () => {
    const { sb, pageReg } = makeSbStub();
    registerAppPage(sb, { comingSoon: false }); // live mode: full chip from the DOM-derived offer
    setBody(`
      <div class="leftcol game_description_column">
        <div id="game_area_purchase" class="game_area_purchase">
          <div class="game_area_purchase_game_wrapper">
            <div class="game_area_purchase_game">
              <h2 class="title">Купить Game X</h2>
              <div class="game_purchase_action">
                <div class="game_purchase_action_bg">
                  <div class="game_purchase_price price" data-price-final="760000">7 600₸</div>
                  <div class="btn_addtocart"><a class="btn_green_steamui">В корзине</a></div>
                </div>
              </div>
            </div>
          </div>
          <div class="game_area_purchase_game">
            <div class="game_purchase_action"><div class="game_purchase_action_bg">
              <div class="game_purchase_price price" data-price-final="290000">2 900₸</div>
            </div></div>
          </div>
        </div>
      </div>`);
    const reg = pageReg.find((p) => p.name === 'booster-addfunds-app')!;
    await reg.mount({ url: new URL('https://store.steampowered.com/app/570/'), signal: new AbortController().signal });
    await tick();
    const blocks = document.querySelectorAll('.game_area_purchase_game');
    const action = blocks[0]!.querySelector('.game_purchase_action') as HTMLElement;
    expect(action.classList.contains('booster-dist-host')).toBe(true);
    const chip = document.getElementById('booster-edition-offer')!;
    expect(chip).not.toBeNull();
    expect(action.lastElementChild).toBe(chip);
    expect(chip.querySelector('.booster-eo-now')!.textContent).toBe('5 168 ₸'); // 7600 -32%
    expect(chip.querySelector('.booster-eo-was')!.textContent).toBe('7 600 ₸');
    // second block untouched
    expect(blocks[1]!.querySelector('#booster-edition-offer')).toBeNull();
    expect(blocks[1]!.querySelector('.game_purchase_action')!.classList.contains('booster-dist-host')).toBe(false);
  });

  test('edition offer is idempotent across a re-mount', async () => {
    const { sb, pageReg } = makeSbStub();
    registerAppPage(sb);
    setBody(`<div class="leftcol game_description_column"><div id="game_area_purchase"><div class="game_area_purchase_game"><div class="game_purchase_action"><div class="game_purchase_action_bg"><div class="game_purchase_price price" data-price-final="760000">7 600₸</div></div></div></div></div></div>`);
    const reg = pageReg.find((p) => p.name === 'booster-addfunds-app')!;
    const sig = new AbortController().signal;
    await reg.mount({ url: new URL('https://store.steampowered.com/app/570/'), signal: sig });
    await tick();
    await reg.mount({ url: new URL('https://store.steampowered.com/app/570/'), signal: sig });
    await tick();
    expect(document.querySelectorAll('#booster-edition-offer').length).toBe(1);
  });

  test('region page → no edition offer (mountRegion path untouched)', async () => {
    const { sb, pageReg } = makeSbStub();
    registerAppPage(sb, { fetchRegionKeys: async () => [keyFixture] });
    setBody(`<div class="redeemwalletcode_marker"></div><div id="error_box"><span class="error">Данный товар недоступен в вашем регионе</span></div>`);
    const reg = pageReg.find((p) => p.name === 'booster-addfunds-app')!;
    await reg.mount({ url: new URL('https://store.steampowered.com/app/22350/'), signal: new AbortController().signal });
    await tick();
    expect(document.getElementById('booster-edition-offer')).toBeNull();
  });

  // DOM with a first edition that carries a final price → installs the chip.
  const editionBody = `
    <div class="leftcol game_description_column">
      <div id="game_area_purchase" class="game_area_purchase">
        <div class="game_area_purchase_game">
          <div class="game_purchase_action">
            <div class="game_purchase_action_bg">
              <div class="game_purchase_price price" data-price-final="760000">7 600₸</div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  test('interim (coming-soon) normal page → topup bar AND a dimmed «Купить»-only chip with «СКОРО»', async () => {
    // Interim: keys API not wired. Пополнялка всегда видна; оффер сведён к одной
    // кнопке «Купить» с плашкой «СКОРО» (без скидки/цены).
    const { sb, pageReg } = makeSbStub();
    registerAppPage(sb, { comingSoon: true });
    setBody(editionBody);
    const reg = pageReg.find((p) => p.name === 'booster-addfunds-app')!;
    await reg.mount({ url: new URL('https://store.steampowered.com/app/570/'), signal: new AbortController().signal });
    await tick();
    expect(document.getElementById('booster-topup-bar')).not.toBeNull();
    const chip = document.getElementById('booster-edition-offer')!;
    expect(chip).not.toBeNull();
    expect(chip.classList.contains('booster-eo--soon')).toBe(true);
    expect(chip.querySelector('.booster-eo-now')).toBeNull();   // price hidden
    expect(chip.querySelector('.booster-eo-discount')).toBeNull(); // discount hidden
    const badge = chip.querySelector('.booster-eo-buy .booster-eo-soon');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('СКОРО');
  });

  test('live + keys (resolveEditionOffer → offer) → full chip, topup hidden (mutual exclusion)', async () => {
    const { sb, pageReg } = makeSbStub();
    const offer = { ourPrice: 5168, steamPrice: 7600, discountPercent: 32, currencySymbol: '₸' };
    registerAppPage(sb, { comingSoon: false, resolveEditionOffer: async () => offer });
    setBody(editionBody);
    const reg = pageReg.find((p) => p.name === 'booster-addfunds-app')!;
    await reg.mount({ url: new URL('https://store.steampowered.com/app/570/'), signal: new AbortController().signal });
    await tick();
    const chip = document.getElementById('booster-edition-offer')!;
    expect(chip).not.toBeNull();
    expect(chip.querySelector('.booster-eo-now')!.textContent).toBe('5 168 ₸');
    expect(chip.classList.contains('booster-eo--soon')).toBe(false);
    expect(document.getElementById('booster-topup-bar')).toBeNull(); // keys present → topup скрыта
  });

  test('live + no keys (resolveEditionOffer → null) → topup shown, no chip', async () => {
    const { sb, pageReg } = makeSbStub();
    registerAppPage(sb, { comingSoon: false, resolveEditionOffer: async () => null });
    setBody(editionBody);
    const reg = pageReg.find((p) => p.name === 'booster-addfunds-app')!;
    await reg.mount({ url: new URL('https://store.steampowered.com/app/570/'), signal: new AbortController().signal });
    await tick();
    expect(document.getElementById('booster-edition-offer')).toBeNull();
    expect(document.getElementById('booster-topup-bar')).not.toBeNull(); // нет ключей → пополнялка
  });

  test('interim teardown removes both the topup bar and the chip', async () => {
    const { sb, pageReg } = makeSbStub();
    registerAppPage(sb, { comingSoon: true });
    setBody(editionBody);
    const reg = pageReg.find((p) => p.name === 'booster-addfunds-app')!;
    const teardown = await reg.mount({ url: new URL('https://store.steampowered.com/app/570/'), signal: new AbortController().signal });
    await tick();
    expect(document.getElementById('booster-topup-bar')).not.toBeNull();
    expect(document.getElementById('booster-edition-offer')).not.toBeNull();
    expect(typeof teardown).toBe('function');
    (teardown as () => void)();
    expect(document.getElementById('booster-topup-bar')).toBeNull();
    expect(document.getElementById('booster-edition-offer')).toBeNull();
  });

  test('live: signal aborted while resolving the offer → nothing mounts', async () => {
    const { sb, pageReg } = makeSbStub();
    const ctrl = new AbortController();
    registerAppPage(sb, {
      comingSoon: false,
      // Resolve an offer but abort mid-flight: the post-await guard must bail.
      resolveEditionOffer: async () => { ctrl.abort(); return { ourPrice: 5168, steamPrice: 7600, discountPercent: 32, currencySymbol: '₸' }; },
    });
    setBody(editionBody);
    const reg = pageReg.find((p) => p.name === 'booster-addfunds-app')!;
    const teardown = await reg.mount({ url: new URL('https://store.steampowered.com/app/570/'), signal: ctrl.signal });
    await tick();
    expect(document.getElementById('booster-edition-offer')).toBeNull();
    expect(document.getElementById('booster-topup-bar')).toBeNull();
    expect(teardown).toBeUndefined();
  });
});
