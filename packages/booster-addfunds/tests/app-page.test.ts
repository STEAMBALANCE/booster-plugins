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
import { CACHE_KEY, TTL_MS, type FetchResult } from '../src/lib/catalogue-api';

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
  // Real /app/ pages carry the right META column `.rightcol.game_meta_data`
  // (the one mountRegionGames targets — a bare `.rightcol` matches the wrong
  // top glance column live). Seeded unconditionally, WITH a child, so the
  // `.rightcol.game_meta_data`-with-children lookup resolves synchronously in
  // every test (avoids the fixed 5s timeout — see M2). Region-locked bodies
  // never reach the mountRegionGames call, so the extra div there is inert.
  document.body.innerHTML = html + '<div class="rightcol game_meta_data"><div class="block"></div></div>';
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

const item = (over: Partial<KeyItem> = {}): KeyItem => ({
  itemId: 1, name: 'Game X', isActive: true, regionLabel: 'Global',
  packageId: 13533, packageType: 'package', productType: 'base', price: 129.58, oldPrice: 199, discountPercent: 35,
  ...over,
});

interface PurchaseResult { status: 'ok' | 'email-required' | 'error'; error?: string; message?: string }

interface WindowTitles { title: string; taskbarTitle: string }

interface TestKeysClient {
  requestKeys: (appid: number, signal: AbortSignal) => Promise<KeyItem[]>;
  purchaseKey: (itemId: number, email?: string, titles?: WindowTitles) => Promise<PurchaseResult>;
  dispose(): void;
  purchases: Array<{ itemId: number; email?: string; titles?: WindowTitles }>;
}

function makeKeysClient(opts: {
  items?: KeyItem[];
  requestKeys?: (appid: number, signal: AbortSignal) => Promise<KeyItem[]>;
  purchaseSeq?: PurchaseResult[];
} = {}): TestKeysClient {
  const purchases: Array<{ itemId: number; email?: string; titles?: WindowTitles }> = [];
  let n = 0;
  return {
    purchases,
    requestKeys: opts.requestKeys ?? (async () => opts.items ?? []),
    purchaseKey: async (itemId: number, email?: string, titles?: WindowTitles): Promise<PurchaseResult> => {
      purchases.push({ itemId, email, titles });
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
  fireBus: (topic: string, data: unknown) => void;
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
    fireBus: (topic: string, data: unknown) => { for (const cb of busSubs.get(topic) ?? []) cb(data); },
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

// Live /app/2300320 shape: the base game's edition block (subid) followed by two
// bundle rows — each a `.game_area_purchase_game` inside a
// `…_wrapper[data-ds-bundleid]`, carrying a hidden `bundleid` input and an action
// row with TWO native clusters («Информация о наборе» + discount/cart).
const bundleRow = (id: number): string => `
  <div class="game_area_purchase_game_wrapper dynamic_bundle_description" data-ds-bundleid="${id}">
    <div class="game_area_purchase_game_dropdown_subscription game_area_purchase_game">
      <form name="add_bundle_to_cart_${id}"><input type="hidden" name="bundleid" value="${id}"></form>
      <div class="game_purchase_action">
        <div class="game_purchase_action_bg">
          <div class="btn_addtocart btn_packageinfo"><a href="/bundle/${id}/">info</a></div>
        </div>
        <div class="game_purchase_action_bg">
          <div class="discount_block game_purchase_discount" data-price-final="334075"></div>
          <div class="btn_addtocart"><a href="javascript:addBundleToCart( ${id});">cart</a></div>
        </div>
      </div>
    </div>
  </div>`;

const bundleBody = `
  <div class="leftcol game_description_column">
    <div id="game_area_purchase" class="game_area_purchase">
      <div class="editions_purchase_options_container"><div class="game_area_purchase_game_wrapper">
        <div class="game_area_purchase_game">
          <form name="add_to_cart_825695"><input type="hidden" name="subid" value="825695"></form>
          <div class="game_purchase_action"><div class="game_purchase_action_bg">
            <div class="game_purchase_price price" data-price-final="195000">1950</div>
            <div class="btn_addtocart"><a href="javascript:addToCart(825695);">cart</a></div>
          </div></div>
        </div>
      </div></div>
      ${bundleRow(56040)}
      ${bundleRow(42206)}
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

  test('normal page, bundle + package offers → a chip on every matching block', async () => {
    const { sb, pageReg } = makeSbStub();
    // Verbatim steam_keys?appid=2300320 answer: bundle 42206, bundle 56040,
    // package 825695. The page also renders bundle 73995, which is NOT on offer.
    const keysClient = makeKeysClient({ items: [
      item({ itemId: 2266, name: 'FS25 - Year 1 Bundle', packageId: 42206, packageType: 'bundle' }),
      item({ itemId: 2269, name: 'FS25 - Highlands', packageId: 56040, packageType: 'bundle' }),
      item({ itemId: 2270, name: 'FS25', packageId: 825695, packageType: 'package' }),
    ] });
    registerAppPage(sb, { keysClient });
    setBody(bundleBody);
    await reg(pageReg).mount(mountCtx('https://store.steampowered.com/app/2300320/'));
    await tick();
    expect(document.querySelectorAll('.booster-eo').length).toBe(3);
    expect(document.getElementById('booster-topup-bar')).toBeNull();
    // Each chip landed in the block that sells that exact product.
    expect(document.querySelector('[data-sb-keys-subid="825695"] .booster-eo')).not.toBeNull();
    expect(document.querySelector('[data-ds-bundleid="42206"] [data-sb-keys-bundleid="42206"] .booster-eo')).not.toBeNull();
    expect(document.querySelector('[data-ds-bundleid="56040"] [data-sb-keys-bundleid="56040"] .booster-eo')).not.toBeNull();
    // The chip sits after both native clusters of the bundle's action row.
    const action = document.querySelector('[data-ds-bundleid="42206"] .game_purchase_action')!;
    expect(action.lastElementChild!.classList.contains('booster-eo')).toBe(true);
    expect(action.querySelectorAll('.game_purchase_action_bg').length).toBe(2);
  });

  // fitChip: the bundle row's native cluster («Информация о наборе» + discount/cart)
  // leaves too little room for the full chip, so it steps down through its compact
  // levels. happy-dom has no layout engine, hence the injected measurement.
  test('crowded action row → chip drops the discount badge (compact level 1)', async () => {
    const { sb, pageReg } = makeSbStub();
    // First read overflows, the read after level 1 fits.
    const reads = [44, 0];
    registerAppPage(sb, {
      keysClient: makeKeysClient({ items: [item({ itemId: 2266, packageId: 42206, packageType: 'bundle' })] }),
      measureOverflow: () => reads.shift() ?? 0,
    });
    setBody(bundleBody);
    await reg(pageReg).mount(mountCtx('https://store.steampowered.com/app/2300320/'));
    await tick();
    const chip = document.querySelector('.booster-eo')!;
    expect(chip.classList.contains('booster-eo--compact')).toBe(true);
    expect(chip.classList.contains('booster-eo--tight')).toBe(false);
    expect(chip.querySelector('.booster-eo-buy')).not.toBeNull();   // buy button always survives
  });

  test('still crowded after level 1 → chip also drops the struck price (level 2)', async () => {
    const { sb, pageReg } = makeSbStub();
    registerAppPage(sb, {
      keysClient: makeKeysClient({ items: [item({ itemId: 2266, packageId: 42206, packageType: 'bundle' })] }),
      measureOverflow: () => 80,
    });
    setBody(bundleBody);
    await reg(pageReg).mount(mountCtx('https://store.steampowered.com/app/2300320/'));
    await tick();
    const chip = document.querySelector('.booster-eo')!;
    expect(chip.classList.contains('booster-eo--compact')).toBe(true);
    expect(chip.classList.contains('booster-eo--tight')).toBe(true);
    expect(chip.querySelector('.booster-eo-now')).not.toBeNull();   // final price always survives
  });

  test('roomy action row → chip keeps the full design', async () => {
    const { sb, pageReg } = makeSbStub();
    registerAppPage(sb, {
      keysClient: makeKeysClient({ items: [item({ itemId: 101, packageId: 13533 })] }),
      measureOverflow: () => 0,
    });
    setBody(oneBlockBody);
    await reg(pageReg).mount(mountCtx());
    await tick();
    const chip = document.querySelector('.booster-eo')!;
    expect(chip.classList.contains('booster-eo--compact')).toBe(false);
    expect(chip.querySelector('.booster-eo-discount')).not.toBeNull();
  });

  test('buy on a bundle chip purchases the bundle offer, not the base game', async () => {
    const { sb, pageReg } = makeSbStub();
    const keysClient = makeKeysClient({ items: [
      item({ itemId: 2266, name: 'FS25 - Year 1 Bundle', packageId: 42206, packageType: 'bundle' }),
      item({ itemId: 2270, name: 'FS25', packageId: 825695, packageType: 'package' }),
    ] });
    registerAppPage(sb, { keysClient });
    setBody(bundleBody);
    await reg(pageReg).mount(mountCtx('https://store.steampowered.com/app/2300320/'));
    await tick();
    (document.querySelector('[data-ds-bundleid="42206"] .booster-eo-buy') as HTMLButtonElement).click();
    await tick();
    expect(keysClient.purchases.map((p) => p.itemId)).toEqual([2266]);
    expect(keysClient.purchases[0]!.titles!.title).toContain('FS25 - Year 1 Bundle');
  });

  test('bundle-only offer still counts as a match → no topup bar, no «СКОРО»', async () => {
    const { sb, pageReg } = makeSbStub();
    registerAppPage(sb, { keysClient: makeKeysClient({ items: [
      item({ itemId: 2266, packageId: 42206, packageType: 'bundle' }),
    ] }) });
    setBody(bundleBody);
    await reg(pageReg).mount(mountCtx('https://store.steampowered.com/app/2300320/'));
    await tick();
    expect(document.querySelectorAll('.booster-eo').length).toBe(1);
    expect(document.querySelector('.booster-eo--soon')).toBeNull();
    expect(document.getElementById('booster-topup-bar')).toBeNull();
  });

  test('bundle chip is removed on unmount, marker attribute included', async () => {
    const { sb, pageReg } = makeSbStub();
    registerAppPage(sb, { keysClient: makeKeysClient({ items: [
      item({ itemId: 2266, packageId: 42206, packageType: 'bundle' }),
    ] }) });
    setBody(bundleBody);
    const teardown = await reg(pageReg).mount(mountCtx('https://store.steampowered.com/app/2300320/'));
    await tick();
    teardown!();
    expect(document.querySelector('.booster-eo')).toBeNull();
    expect(document.querySelector('[data-sb-keys-bundleid]')).toBeNull();
    expect(document.querySelector('.booster-dist-host')).toBeNull();
  });

  test('buy → purchaseKey carries game-scoped window titles (game name in heading, not in taskbar)', async () => {
    const { sb, pageReg } = makeSbStub();
    const keysClient = makeKeysClient({ items: [item({ itemId: 101, name: 'Half-Life', packageId: 13533 })] });
    registerAppPage(sb, { keysClient });
    setBody(oneBlockBody);
    await reg(pageReg).mount(mountCtx());
    await tick();
    (document.querySelector('.booster-eo-buy') as HTMLButtonElement).click();
    await tick();
    const titles = keysClient.purchases[0]!.titles!;
    expect(titles).toBeDefined();
    expect(titles.title).toContain('Half-Life');     // window heading is game-scoped
    expect(titles.taskbarTitle).not.toContain('Half-Life'); // taskbar caption stays generic
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

  // Demo download block (Steam's `demo_above_purchase`, no subid, no price) sits
  // ABOVE the paid edition. The «СКОРО» fallback chip must skip it and land on
  // the priced edition — never on the demo's "Загрузить" row.
  const demoThenEditionBody = `
    <div class="leftcol game_description_column">
      <div id="game_area_purchase" class="game_area_purchase">
        <div class="game_area_purchase_game demo_above_purchase">
          <div class="game_purchase_action"><div class="game_purchase_action_bg">
            <a class="btn_green_steamui btn_medium" href="steam://install/3044590"><span>Загрузить</span></a>
          </div></div>
        </div>
        <div class="game_area_purchase_game">
          <div class="game_purchase_action"><div class="game_purchase_action_bg">
            <div class="game_purchase_price price" data-price-final="20200">202 руб.</div>
          </div></div>
        </div>
      </div>
    </div>`;

  test('normal page, demo block + paid edition, no match → «СКОРО» chip lands on the paid edition, not the demo', async () => {
    const { sb, pageReg } = makeSbStub();
    registerAppPage(sb, { keysClient: makeKeysClient({ items: [item({ packageId: 99999 })] }) });
    setBody(demoThenEditionBody);
    await reg(pageReg).mount(mountCtx());
    await tick();
    const chips = document.querySelectorAll('.booster-eo');
    expect(chips.length).toBe(1);
    const demoAction = document.querySelector('.demo_above_purchase .game_purchase_action')!;
    const paidAction = document.querySelectorAll('.game_area_purchase_game')[1]!.querySelector('.game_purchase_action')!;
    expect(demoAction.querySelector('.booster-eo')).toBeNull();
    expect(demoAction.classList.contains('booster-dist-host')).toBe(false);
    expect(paidAction.querySelector('.booster-eo')).not.toBeNull();
  });

  test('normal page, ONLY a demo block, no match → topup bar but no «СКОРО» chip', async () => {
    const { sb, pageReg } = makeSbStub();
    registerAppPage(sb, { keysClient: makeKeysClient({ items: [item({ packageId: 99999 })] }) });
    setBody(`
      <div class="leftcol game_description_column">
        <div id="game_area_purchase" class="game_area_purchase">
          <div class="game_area_purchase_game demo_above_purchase">
            <div class="game_purchase_action"><div class="game_purchase_action_bg">
              <a class="btn_green_steamui btn_medium" href="steam://install/3044590"><span>Загрузить</span></a>
            </div></div>
          </div>
        </div>
      </div>`);
    await reg(pageReg).mount(mountCtx());
    await tick();
    expect(document.getElementById('booster-topup-bar')).not.toBeNull();
    expect(document.querySelector('.booster-eo')).toBeNull();
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
    expect(keysClient.purchases[1]!).toMatchObject({ itemId: 101, email: 'buyer@mail.com' });
    // Both attempts (pre- and post-email) carry the same window titles.
    expect(keysClient.purchases[0]!.titles).toBeDefined();
    expect(keysClient.purchases[1]!.titles).toEqual(keysClient.purchases[0]!.titles);
  });

  test('purchase error with a human backend message → modal shows that message', async () => {
    const { sb, pageReg } = makeSbStub();
    const keysClient = makeKeysClient({
      items: [item({ itemId: 101, packageId: 13533 })],
      purchaseSeq: [{ status: 'error', message: 'Платёжный метод временно недоступен' }],
    });
    const errors: string[] = [];
    registerAppPage(sb, { keysClient, openErrorModal: (m) => errors.push(m) });
    setBody(oneBlockBody);
    await reg(pageReg).mount(mountCtx());
    await tick();
    (document.querySelector('.booster-eo-buy') as HTMLButtonElement).click();
    await tick();
    expect(errors).toEqual(['Платёжный метод временно недоступен']);
  });

  test('purchase error with only a machine code (no message) → generic fallback, code not shown', async () => {
    const { sb, pageReg } = makeSbStub();
    const keysClient = makeKeysClient({
      items: [item({ itemId: 101, packageId: 13533 })],
      purchaseSeq: [{ status: 'error', error: 'no-payment' }],
    });
    const errors: string[] = [];
    registerAppPage(sb, { keysClient, openErrorModal: (m) => errors.push(m) });
    setBody(oneBlockBody);
    await reg(pageReg).mount(mountCtx());
    await tick();
    (document.querySelector('.booster-eo-buy') as HTMLButtonElement).click();
    await tick();
    expect(errors.length).toBe(1);
    expect(errors[0]).toBeTruthy();
    expect(errors[0]).not.toBe('no-payment'); // machine code never reaches the user
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

  describe('region-games carousel', () => {
    test('.rightcol present + fresh cache → inserts #booster-region-games as the first child of .rightcol', async () => {
      const { sb, pageReg } = makeSbStub();
      registerAppPage(sb, { keysClient: makeKeysClient({ items: [] }) });
      setBody(editionBody);
      const now = Date.now();
      window.localStorage.setItem(CACHE_KEY, JSON.stringify({
        items: [{ link: 'https://steambalance.cc/x', cover: 'https://cdn/x.jpg' }],
        fetchedAt: now,
        attemptedAt: now,
      }));
      await reg(pageReg).mount(mountCtx());
      await tick();
      const rightcol = document.querySelector('.rightcol')!;
      const block = document.getElementById('booster-region-games');
      expect(block).not.toBeNull();
      expect(rightcol.firstElementChild).toBe(block);
    });

    // mountRegionGames wraps its whole body in try{...}catch{return;} (see app.ts),
    // so it structurally cannot reject — this holds regardless of whether the page
    // mount combines it with Promise.all or Promise.allSettled. What this test
    // actually proves: a broken fetchCatalogue doesn't break the page mount or
    // strand mountNormal's own teardown.
    test('throwing fetchCatalogue + no cache → page mount resolves (never rejects), no block, sibling topup bar still mounts+tears down', async () => {
      const { sb, pageReg } = makeSbStub();
      registerAppPage(sb, {
        keysClient: makeKeysClient({ items: [] }),
        fetchCatalogue: async () => { throw new Error('boom'); },
      });
      setBody(editionBody);
      const ctrl = new AbortController();
      let rejected = false;
      const teardown = await reg(pageReg)
        .mount(mountCtx('https://store.steampowered.com/app/570/', ctrl.signal))
        .catch((): undefined => { rejected = true; return undefined; });
      expect(rejected).toBe(false);
      await tick();
      expect(document.getElementById('booster-region-games')).toBeNull();
      expect(document.getElementById('booster-topup-bar')).not.toBeNull();
      expect(typeof teardown).toBe('function');
      (teardown as () => void)();
      expect(document.getElementById('booster-topup-bar')).toBeNull();
    });

    describe('mountRegionGames DOM wiring', () => {
      test('cold ok (no cache) → inserts #booster-region-games as first child of .rightcol, cache written', async () => {
        const { sb, pageReg } = makeSbStub();
        const NOW = 1_700_000_000_000;
        registerAppPage(sb, {
          keysClient: makeKeysClient({ items: [] }),
          now: () => NOW,
          fetchCatalogue: async () => ({ status: 'ok', items: [{ link: 'https://steambalance.cc/a', cover: 'https://cdn/a.jpg' }] }),
        });
        setBody(editionBody);
        expect(window.localStorage.getItem(CACHE_KEY)).toBeNull();
        await reg(pageReg).mount(mountCtx());
        await tick();
        const rightcol = document.querySelector('.rightcol')!;
        const block = document.getElementById('booster-region-games');
        expect(block).not.toBeNull();
        expect(rightcol.firstElementChild).toBe(block);
        const cached = JSON.parse(window.localStorage.getItem(CACHE_KEY)!);
        expect(cached).toEqual({ items: [{ link: 'https://steambalance.cc/a', cover: 'https://cdn/a.jpg' }], fetchedAt: NOW, attemptedAt: NOW });
      });

      // Integration: the page feeds the account region into the carousel fetch.
      // Region is sb.steam.getStoreCountry ('RU' in the stub), upper-cased;
      // currency comes from the snapshot (null here — its omission is covered by
      // catalogue-api's own unit test).
      test('passes country from getStoreCountry into fetchCatalogue', async () => {
        const { sb, pageReg } = makeSbStub();
        let seen: any;
        registerAppPage(sb, {
          keysClient: makeKeysClient({ items: [] }),
          now: () => 1_700_000_000_000,
          fetchCatalogue: async (_sb: any, params: any) => { seen = params; return { status: 'ok', items: [{ link: 'https://steambalance.cc/a', cover: 'https://cdn/a.jpg' }] }; },
        });
        setBody(editionBody);
        await reg(pageReg).mount(mountCtx());
        await tick();
        expect(seen).toBeDefined();
        expect(seen.country).toBe('RU');
        expect(seen.currency).toBeNull();
      });

      test('upper-cases and passes snapshot currency into fetchCatalogue', async () => {
        const { sb, pageReg, fireBus } = makeSbStub();
        let seen: any;
        registerAppPage(sb, {
          keysClient: makeKeysClient({ items: [] }),
          now: () => 1_700_000_000_000,
          fetchCatalogue: async (_sb: any, params: any) => { seen = params; return { status: 'ok', items: [{ link: 'https://steambalance.cc/a', cover: 'https://cdn/a.jpg' }] }; },
        });
        fireBus('booster-checkout.user.snapshot', { accountName: 'u', currency: 'kzt', balance: 0 });
        setBody(editionBody);
        await reg(pageReg).mount(mountCtx());
        await tick();
        expect(seen.country).toBe('RU');
        expect(seen.currency).toBe('KZT');
      });

      test('empty result with a stale-cache block already shown → block is removed, cache written as empty-marker', async () => {
        const { sb, pageReg } = makeSbStub();
        const NOW = 1_700_000_000_000;
        const STALE = NOW - TTL_MS - 1000;
        window.localStorage.setItem(CACHE_KEY, JSON.stringify({
          items: [{ link: 'https://steambalance.cc/x', cover: 'https://cdn/x.jpg' }],
          fetchedAt: STALE,
          attemptedAt: STALE,
        }));
        let resolveFetch!: (r: FetchResult) => void;
        registerAppPage(sb, {
          keysClient: makeKeysClient({ items: [] }),
          now: () => NOW,
          fetchCatalogue: () => new Promise<FetchResult>((resolve) => { resolveFetch = resolve; }),
        });
        setBody(editionBody);
        const mountPromise = reg(pageReg).mount(mountCtx());
        await tick(); // let the synchronous stale-cache render (insert) run before the fetch settles
        // Confirm the stale-cache block is actually shown first — the "hide" behaviour
        // below only means something if it was on-screen beforehand.
        expect(document.getElementById('booster-region-games')).not.toBeNull();
        resolveFetch({ status: 'empty' });
        await mountPromise;
        await tick();
        expect(document.getElementById('booster-region-games')).toBeNull();
        const cached = JSON.parse(window.localStorage.getItem(CACHE_KEY)!);
        expect(cached).toEqual({ items: [], fetchedAt: NOW, attemptedAt: NOW });
      });

      test('stale ok revalidate → already-shown block is NOT rebuilt (same node identity), cache refreshed', async () => {
        const { sb, pageReg } = makeSbStub();
        const NOW = 1_700_000_000_000;
        const STALE = NOW - TTL_MS - 1000;
        window.localStorage.setItem(CACHE_KEY, JSON.stringify({
          items: [{ link: 'https://steambalance.cc/x', cover: 'https://cdn/x.jpg' }],
          fetchedAt: STALE,
          attemptedAt: STALE,
        }));
        let resolveFetch!: (r: FetchResult) => void;
        registerAppPage(sb, {
          keysClient: makeKeysClient({ items: [] }),
          now: () => NOW,
          fetchCatalogue: () => new Promise<FetchResult>((resolve) => { resolveFetch = resolve; }),
        });
        setBody(editionBody);
        const mountPromise = reg(pageReg).mount(mountCtx());
        await tick(); // let the synchronous stale-cache render (insert) run before the fetch settles
        const blockBefore = document.getElementById('booster-region-games');
        expect(blockBefore).not.toBeNull();
        resolveFetch({ status: 'ok', items: [{ link: 'https://steambalance.cc/y', cover: 'https://cdn/y.jpg' }] });
        await mountPromise;
        await tick();
        const blockAfter = document.getElementById('booster-region-games');
        expect(blockAfter).toBe(blockBefore); // same node — no rebuild, no animation reset
        const cached = JSON.parse(window.localStorage.getItem(CACHE_KEY)!);
        expect(cached).toEqual({ items: [{ link: 'https://steambalance.cc/y', cover: 'https://cdn/y.jpg' }], fetchedAt: NOW, attemptedAt: NOW });
      });
    });

    test('region-locked page never invokes mountRegionGames (no fetch, no block)', async () => {
      const { sb, pageReg } = makeSbStub();
      let called = false;
      registerAppPage(sb, {
        keysClient: makeKeysClient({ items: [item({ packageId: 22350 })] }),
        fetchCatalogue: async () => { called = true; return { status: 'ok', items: [] }; },
      });
      setBody(`<div class="redeemwalletcode_marker"></div><div id="error_box"><span class="error">Данный товар недоступен в вашем регионе</span></div>`);
      await reg(pageReg).mount(mountCtx('https://store.steampowered.com/app/22350/'));
      await tick();
      expect(document.getElementById('booster-region-games')).toBeNull();
      expect(called).toBe(false);
    });
  });
});
