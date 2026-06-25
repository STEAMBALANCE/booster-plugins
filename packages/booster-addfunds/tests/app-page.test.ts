// booster-plugins/packages/booster-addfunds/tests/app-page.test.ts
//
// Tests for registerAppPage — the /app/ page-router handler. Two branches:
//   - region-locked page (detectRegionLock true) → request keys over the bus
//     and, if any, insert the keys block immediately after #error_box;
//   - normal app page → request keys; matching editions (by subid) get an
//     edition-offer chip and the topup bar is hidden; no match → topup bar at
//     the top of the editions column + a dimmed «СКОРО» chip on the first block.
//
// happy-dom does not run scripts; we drive mount/unmount directly. Keys come
// from an injected keysClient (no real bus round-trip) and the email modal is an
// injected stub, so purchase flows are deterministic.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Window } from 'happy-dom';
import { registerAppPage } from '../src/pages/app';
import type { KeyItem } from '../src/lib/keys-api';

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

const item = (over: Partial<KeyItem> = {}): KeyItem => ({
  itemId: 1, name: 'Game X', isActive: true, regionLabel: 'Global',
  packageId: 13533, productType: 'base', price: 129.58, oldPrice: 199, discountPercent: 35,
  ...over,
});

interface PurchaseResult { status: 'ok' | 'email-required' | 'error'; error?: string }

interface TestKeysClient {
  requestKeys: (appid: number, signal: AbortSignal) => Promise<KeyItem[]>;
  purchaseKey: (itemId: number, email?: string) => Promise<PurchaseResult>;
  dispose(): void;
  purchases: Array<{ itemId: number; email?: string }>;
}

function makeKeysClient(opts: {
  items?: KeyItem[];
  requestKeys?: (appid: number, signal: AbortSignal) => Promise<KeyItem[]>;
  purchaseSeq?: PurchaseResult[];
} = {}): TestKeysClient {
  const purchases: Array<{ itemId: number; email?: string }> = [];
  let n = 0;
  return {
    purchases,
    requestKeys: opts.requestKeys ?? (async () => opts.items ?? []),
    purchaseKey: async (itemId: number, email?: string): Promise<PurchaseResult> => {
      purchases.push({ itemId, email });
      const seq = opts.purchaseSeq;
      const r = seq ? (seq[Math.min(n, seq.length - 1)] ?? { status: 'ok' }) : { status: 'ok' };
      n++;
      return r;
    },
    dispose(): void {},
  };
}

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
        getStoreCountry: async () => 'RU',
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

const reg = (pageReg: SbStub['pageReg']) => pageReg.find((p) => p.name === 'booster-addfunds-app')!;
const mountCtx = (url = 'https://store.steampowered.com/app/570/', signal = new AbortController().signal) =>
  ({ url: new URL(url), signal });

// DOM with two editions carrying matchable subids.
const twoBlocksBody = `
  <div class="leftcol game_description_column">
    <div id="game_area_purchase" class="game_area_purchase">
      <div class="game_area_purchase_game">
        <div class="game_purchase_action"><div class="game_purchase_action_bg">
          <input name="subid" value="13533">
        </div></div>
      </div>
      <div class="game_area_purchase_game">
        <div class="game_purchase_action"><div class="game_purchase_action_bg">
          <input name="subid" value="13534">
        </div></div>
      </div>
    </div>
  </div>`;

const oneBlockBody = `
  <div class="leftcol game_description_column">
    <div id="game_area_purchase" class="game_area_purchase">
      <div class="game_area_purchase_game">
        <div class="game_purchase_action"><div class="game_purchase_action_bg">
          <input name="subid" value="13533">
        </div></div>
      </div>
    </div>
  </div>`;

// One edition with a readable price but no usable subid → no match → empty branch.
const editionBody = `
  <div class="leftcol game_description_column">
    <div id="game_area_purchase" class="game_area_purchase">
      <div class="game_area_purchase_game">
        <div class="game_purchase_action"><div class="game_purchase_action_bg">
          <div class="game_purchase_price price" data-price-final="760000">7 600₸</div>
        </div></div>
      </div>
    </div>
  </div>`;

const SNAPSHOT_KEYS = [
  'window', 'document', 'history', 'location', 'MutationObserver',
  'Event', 'KeyboardEvent', 'HTMLElement', 'HTMLInputElement',
  'HTMLButtonElement', 'addEventListener', 'removeEventListener',
] as const;
let snapGlobals: Record<string, unknown> = {};

describe('registerAppPage', () => {
  beforeEach(() => {
    snapGlobals = {};
    for (const k of SNAPSHOT_KEYS) snapGlobals[k] = (globalThis as Record<string, unknown>)[k];
    installDom();
  });

  afterEach(() => {
    for (const k of SNAPSHOT_KEYS) {
      const v = snapGlobals[k];
      if (v === undefined) delete (globalThis as Record<string, unknown>)[k];
      else (globalThis as Record<string, unknown>)[k] = v;
    }
  });

  test('normal page, no keys → topup bar at top of editions column, prefilled', async () => {
    const { sb, pageReg } = makeSbStub();
    registerAppPage(sb, { keysClient: makeKeysClient({ items: [] }) });
    setBody(`
      <div class="queue_and_playtime"><div id="queueCtn" class="queue_ctn"><div id="queueActionsCtn" class="queue_actions_ctn">В желаемое</div></div></div>
      <div class="leftcol game_description_column">
        <a class="franchise_notice">collection</a>
        <div id="game_area_purchase" class="game_area_purchase">
          <div class="game_purchase_price price" data-price-final="760000">7 600₸</div>
        </div>
      </div>`);
    await reg(pageReg).mount(mountCtx());
    await tick();
    const bar = document.getElementById('booster-topup-bar')!;
    expect(bar).not.toBeNull();
    expect(bar.closest('#queueCtn')).toBeNull();
    const col = document.querySelector('.leftcol.game_description_column')!;
    expect(bar.parentElement).toBe(col);
    expect(col.firstElementChild).toBe(bar);
    expect((bar.querySelector('.booster-topup-input') as HTMLInputElement).value).toBe('7600');
  });

  test('normal page, no keys + no readable price → bar stays empty (placeholder)', async () => {
    const { sb, pageReg } = makeSbStub();
    registerAppPage(sb, { keysClient: makeKeysClient({ items: [] }) });
    setBody(`
      <div class="leftcol game_description_column">
        <div id="game_area_purchase" class="game_area_purchase">
          <div class="game_purchase_price price">Бесплатно</div>
        </div>
      </div>`);
    await reg(pageReg).mount(mountCtx());
    await tick();
    const bar = document.getElementById('booster-topup-bar')!;
    expect(bar).not.toBeNull();
    expect((bar.querySelector('.booster-topup-input') as HTMLInputElement).value).toBe('');
  });

  test('region page + keys → keys block after #error_box', async () => {
    const { sb, pageReg } = makeSbStub();
    registerAppPage(sb, { keysClient: makeKeysClient({ items: [item({ packageId: 22350 })] }) });
    setBody(`<div class="redeemwalletcode_marker"></div><div id="error_box"><span class="error">Данный товар недоступен в вашем регионе</span></div>`);
    await reg(pageReg).mount(mountCtx('https://store.steampowered.com/app/22350/'));
    await tick();
    const block = document.getElementById('booster-keys-block')!;
    expect(block).not.toBeNull();
    expect(document.getElementById('error_box')!.nextElementSibling).toBe(block);
    expect(document.getElementById('booster-edition-offer-style')).toBeNull(); // region path uses no chip styles
  });

  test('region page + no keys → nothing', async () => {
    const { sb, pageReg } = makeSbStub();
    registerAppPage(sb, { keysClient: makeKeysClient({ items: [] }) });
    setBody(`<div id="error_box"><span class="error">Данный товар недоступен в вашем регионе</span></div>`);
    await reg(pageReg).mount(mountCtx('https://store.steampowered.com/app/22350/'));
    await tick();
    expect(document.getElementById('booster-keys-block')).toBeNull();
    expect(document.getElementById('booster-topup-bar')).toBeNull();
  });

  test('normal page, two matching editions → two chips, no topup, buy → purchaseKey(itemId)', async () => {
    const { sb, pageReg } = makeSbStub();
    const keysClient = makeKeysClient({ items: [
      item({ itemId: 101, packageId: 13533 }),
      item({ itemId: 102, packageId: 13534 }),
    ] });
    registerAppPage(sb, { keysClient, openEmailModal: async () => 'a@b.c' });
    setBody(twoBlocksBody);
    await reg(pageReg).mount(mountCtx());
    await tick();
    const chips = document.querySelectorAll('.booster-eo');
    expect(chips.length).toBe(2);
    expect(document.getElementById('booster-topup-bar')).toBeNull();
    // First chip lives in the first block (subid 13533 → item 101).
    (chips[0]!.querySelector('.booster-eo-buy') as HTMLButtonElement).click();
    await tick();
    expect(keysClient.purchases.length).toBe(1);
    expect(keysClient.purchases[0]!.itemId).toBe(101);
  });

  test('normal page, keys present but none match a subid → topup + a «СКОРО» chip', async () => {
    const { sb, pageReg } = makeSbStub();
    // item packageId 99999 matches no block on the page → empty branch.
    registerAppPage(sb, { keysClient: makeKeysClient({ items: [item({ packageId: 99999 })] }) });
    setBody(editionBody);
    await reg(pageReg).mount(mountCtx());
    await tick();
    expect(document.getElementById('booster-topup-bar')).not.toBeNull();
    const chip = document.querySelector('.booster-eo')!;
    expect(chip).not.toBeNull();
    expect(chip.classList.contains('booster-eo--soon')).toBe(true);
    expect(chip.querySelector('.booster-eo-now')).toBeNull();
    expect(chip.querySelector('.booster-eo-soon')!.textContent).toBe('СКОРО');
  });

  test('purchase needs email → openEmailModal invoked, 2nd purchaseKey carries the email', async () => {
    const { sb, pageReg } = makeSbStub();
    const keysClient = makeKeysClient({
      items: [item({ itemId: 101, packageId: 13533 })],
      purchaseSeq: [{ status: 'email-required' }, { status: 'ok' }],
    });
    let modalCalls = 0;
    registerAppPage(sb, { keysClient, openEmailModal: async () => { modalCalls++; return 'buyer@mail.com'; } });
    setBody(oneBlockBody);
    await reg(pageReg).mount(mountCtx());
    await tick();
    (document.querySelector('.booster-eo-buy') as HTMLButtonElement).click();
    await tick(); await tick();
    expect(modalCalls).toBe(1);
    expect(keysClient.purchases.length).toBe(2);
    expect(keysClient.purchases[0]!.email).toBeUndefined();
    expect(keysClient.purchases[1]!).toEqual({ itemId: 101, email: 'buyer@mail.com' });
  });

  test('purchase needs email but user cancels → no 2nd purchaseKey', async () => {
    const { sb, pageReg } = makeSbStub();
    const keysClient = makeKeysClient({
      items: [item({ itemId: 101, packageId: 13533 })],
      purchaseSeq: [{ status: 'email-required' }, { status: 'ok' }],
    });
    registerAppPage(sb, { keysClient, openEmailModal: async () => null });
    setBody(oneBlockBody);
    await reg(pageReg).mount(mountCtx());
    await tick();
    (document.querySelector('.booster-eo-buy') as HTMLButtonElement).click();
    await tick(); await tick();
    expect(keysClient.purchases.length).toBe(1);
  });

  test('teardown removes the topup bar and the «СКОРО» chip (and the shared style)', async () => {
    const { sb, pageReg } = makeSbStub();
    registerAppPage(sb, { keysClient: makeKeysClient({ items: [] }) });
    setBody(editionBody);
    const teardown = await reg(pageReg).mount(mountCtx());
    await tick();
    expect(document.getElementById('booster-topup-bar')).not.toBeNull();
    expect(document.querySelector('.booster-eo')).not.toBeNull();
    expect(typeof teardown).toBe('function');
    (teardown as () => void)();
    expect(document.getElementById('booster-topup-bar')).toBeNull();
    expect(document.querySelector('.booster-eo')).toBeNull();
    expect(document.getElementById('booster-edition-offer-style')).toBeNull();
  });

  test('multi-chip teardown drops the shared style only after the LAST chip is gone', async () => {
    const { sb, pageReg } = makeSbStub();
    const keysClient = makeKeysClient({ items: [
      item({ itemId: 101, packageId: 13533 }),
      item({ itemId: 102, packageId: 13534 }),
    ] });
    registerAppPage(sb, { keysClient });
    setBody(twoBlocksBody);
    const teardown = await reg(pageReg).mount(mountCtx());
    await tick();
    expect(document.querySelectorAll('.booster-eo').length).toBe(2);
    expect(document.getElementById('booster-edition-offer-style')).not.toBeNull();
    (teardown as () => void)();
    expect(document.querySelectorAll('.booster-eo').length).toBe(0);
    expect(document.getElementById('booster-edition-offer-style')).toBeNull();
  });

  test('region page → no edition chip on the page', async () => {
    const { sb, pageReg } = makeSbStub();
    registerAppPage(sb, { keysClient: makeKeysClient({ items: [item({ packageId: 22350 })] }) });
    setBody(`<div class="redeemwalletcode_marker"></div><div id="error_box"><span class="error">Данный товар недоступен в вашем регионе</span></div>`);
    await reg(pageReg).mount(mountCtx('https://store.steampowered.com/app/22350/'));
    await tick();
    expect(document.querySelector('.booster-eo')).toBeNull();
  });

  test('idempotent across a re-mount → one chip', async () => {
    const { sb, pageReg } = makeSbStub();
    registerAppPage(sb, { keysClient: makeKeysClient({ items: [item({ itemId: 101, packageId: 13533 })] }) });
    setBody(oneBlockBody);
    const sig = new AbortController().signal;
    await reg(pageReg).mount(mountCtx('https://store.steampowered.com/app/570/', sig));
    await tick();
    await reg(pageReg).mount(mountCtx('https://store.steampowered.com/app/570/', sig));
    await tick();
    expect(document.querySelectorAll('.booster-eo').length).toBe(1);
  });

  test('signal aborted after requestKeys resolves → nothing mounts', async () => {
    const { sb, pageReg } = makeSbStub();
    const ctrl = new AbortController();
    registerAppPage(sb, { keysClient: makeKeysClient({
      requestKeys: async () => { ctrl.abort(); return [item({ itemId: 101, packageId: 13533 })]; },
    }) });
    setBody(oneBlockBody);
    const teardown = await reg(pageReg).mount(mountCtx('https://store.steampowered.com/app/570/', ctrl.signal));
    await tick();
    expect(document.querySelector('.booster-eo')).toBeNull();
    expect(document.getElementById('booster-topup-bar')).toBeNull();
    expect(teardown).toBeUndefined();
  });
});
