// booster-plugins/packages/booster-addfunds/tests/package-page.test.ts
//
// Tests for registerPackagePage — the handler for Steam's two package-page
// types, /sub/<id> and /bundle/<id>. Both render the SAME shape: one
// `#game_area_purchase_top` under the package header and one
// `#game_area_purchase_bottom` under the price breakdown, each holding a single
// `.game_area_purchase_game` for the very same product. That is where our two
// «Купить» chips go.
//
// The fixtures below are trimmed from the live pages (store.steampowered.com/
// sub/1010506 and /bundle/42206, fetched 2026-08-20) — the id-carrying markup is
// verbatim, because the id readers in lib/edition-match.ts key off exactly it:
// the sub page's bottom block has NO subid input and is only addressable through
// its `addToCart( 1010506, 1 )` link.
//
// happy-dom does not run scripts; we drive mount/unmount directly. Keys come
// from an injected keysClient (no real bus round-trip).

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Window } from 'happy-dom';
import { registerPackagePage } from '../src/pages/package';
import type { KeyItem } from '../src/lib/keys-api';
import type { KeysTarget } from '../src/lib/keys-target';

function installDom(url: string): Window {
  const w = new Window({ url });
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

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

// --- fixtures ---------------------------------------------------------------

const priceRow = (final: string, cartHref: string): string => `
  <div class="game_purchase_action">
    <div class="game_purchase_action_bg">
      <div class="game_purchase_price price" data-price-final="${final}">5999 руб.</div>
      <div class="btn_addtocart"><a class="btn_green_steamui btn_medium" href="${cartHref}"><span>В корзину</span></a></div>
    </div>
  </div>`;

// /sub/1010506 — top block carries the hidden subid input, bottom block carries
// only the addToCart link (live shape).
const SUB_BODY = `
<div class="leftcol game_description_column">
  <div id="package_header_container"><img class="package_header"></div>
  <div id="game_area_purchase_top" class="game_area_purchase tablet_hidden">
    <div class="game_area_purchase_game">
      <form name="add_to_cart_1010506"><input type="hidden" name="subid" value="1010506"></form>
      <h1>Купить ELDEN RING Shadow of the Erdtree Deluxe Edition</h1>
      ${priceRow('599900', 'javascript:addToCart( 1010506);')}
    </div>
  </div>
  <div class="package_totals_row"><div class="price">5999 руб.</div></div>
  <div id="game_area_purchase_bottom" class="game_area_purchase">
    <div class="game_area_purchase_game_wrapper">
      <div class="game_area_purchase_game">
        <h1>Купить ELDEN RING Shadow of the Erdtree Deluxe Edition</h1>
        ${priceRow('599900', 'javascript:addToCart( 1010506, 1 );')}
      </div>
    </div>
  </div>
  <div id="col_package_content"></div>
</div>`;

// /bundle/42206 — both blocks carry data-ds-bundleid; the top one also has the
// hidden bundleid input.
const BUNDLE_BODY = `
<div class="leftcol game_description_column">
  <div id="package_header_container"><img class="package_header"></div>
  <div id="game_area_purchase_top" class="game_area_purchase tablet_hidden">
    <div class="game_area_purchase_game bundle ds_no_flags" data-ds-bundleid="42206">
      <form name="add_bundle_to_cart_42206"><input type="hidden" name="bundleid" value="42206"></form>
      <h1>Купить Farming Simulator 25: Year 1 Bundle</h1>
      ${priceRow('403750', 'javascript:addBundleToCart( 42206);')}
    </div>
  </div>
  <div id="package_savings_bar"><div class="savings">712 руб.</div></div>
  <div id="game_area_purchase_bottom" class="game_area_purchase">
    <div class="game_area_purchase_game bundle ds_no_flags" data-ds-bundleid="42206">
      <h1>Купить Farming Simulator 25: Year 1 Bundle</h1>
      ${priceRow('403750', 'javascript:addBundleToCart( 42206, 1 );')}
    </div>
  </div>
</div>`;

const REGION_LOCKED_BODY = `
<div id="error_box"><h2>Ой, извините!</h2><div>Этот товар недоступен в вашем регионе.</div></div>`;

const item = (over: Partial<KeyItem> = {}): KeyItem => ({
  itemId: 1, name: 'ELDEN RING Shadow of the Erdtree Deluxe Edition', isActive: true, regionLabel: 'Global',
  packageId: 1010506, packageType: 'package', productType: 'base', price: 4299, oldPrice: 5999, discountPercent: 28,
  ...over,
});

const bundleItem = (over: Partial<KeyItem> = {}): KeyItem =>
  item({ itemId: 2, name: 'Farming Simulator 25: Year 1 Bundle', packageId: 42206, packageType: 'bundle', ...over });

// --- stubs ------------------------------------------------------------------

interface PurchaseResult { status: 'ok' | 'email-required' | 'error'; error?: string; message?: string }
interface WindowTitles { title: string; taskbarTitle: string }

function makeKeysClient(opts: { items?: KeyItem[]; purchaseSeq?: PurchaseResult[] } = {}) {
  const purchases: Array<{ itemId: number; email?: string; titles?: WindowTitles }> = [];
  const targets: KeysTarget[] = [];
  let n = 0;
  return {
    purchases,
    targets,
    requestKeys: async (target: KeysTarget): Promise<KeyItem[]> => { targets.push(target); return opts.items ?? []; },
    purchaseKey: async (itemId: number, email?: string, titles?: WindowTitles): Promise<PurchaseResult> => {
      purchases.push({ itemId, email, titles });
      const seq = opts.purchaseSeq;
      const r = seq ? (seq[Math.min(n, seq.length - 1)] ?? { status: 'ok' as const }) : { status: 'ok' as const };
      n++;
      return r;
    },
    dispose(): void {},
  };
}

function makeSbStub() {
  const pageReg: Array<{ name: string; match: { url: RegExp | ((u: URL) => boolean) }; mount: any }> = [];
  const busSubs = new Map<string, Set<(d: unknown) => void>>();
  const published: Array<{ topic: string; data: unknown }> = [];
  const scopeCtrl = new AbortController();
  return {
    pageReg,
    published,
    sb: {
      context: { kind: 'web', url: location.href, onUrlChange: () => () => {} },
      pages: { register: (o: any) => { pageReg.push(o); return { unregister: () => {} }; } },
      bus: {
        publish: (topic: string, data: unknown) => { published.push({ topic, data }); },
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
      scope: { signal: scopeCtrl.signal, _abort: () => scopeCtrl.abort() },
    } as any,
  };
}

const SUB_URL = 'https://store.steampowered.com/sub/1010506/';
const BUNDLE_URL = 'https://store.steampowered.com/bundle/42206/Farming_Simulator_25_Year_1_Bundle/';

const reg = (pageReg: ReturnType<typeof makeSbStub>['pageReg']) =>
  pageReg.find((p) => p.name === 'booster-addfunds-package')!;
const mountCtx = (url: string, signal = new AbortController().signal) => ({ url: new URL(url), signal });

// Mount the package page against `body` at `url` and return the teardown.
async function mountPage(url: string, body: string, opts: {
  items?: KeyItem[]; purchaseSeq?: PurchaseResult[];
} = {}) {
  installDom(url);
  document.body.innerHTML = body;
  const stub = makeSbStub();
  const keysClient = makeKeysClient(opts);
  registerPackagePage(stub.sb, { keysClient, measureOverflow: () => 0 } as any);
  const teardown = await reg(stub.pageReg).mount(mountCtx(url));
  await tick();
  return { stub, keysClient, teardown };
}

let win: Window | null = null;
beforeEach(() => { win = null; });
afterEach(() => { win?.close?.(); });

// --- tests ------------------------------------------------------------------

describe('registerPackagePage — page matching', () => {
  test('registers a handler that matches both package page types and nothing else', () => {
    installDom(SUB_URL);
    const stub = makeSbStub();
    registerPackagePage(stub.sb, { keysClient: makeKeysClient() } as any);
    const m = reg(stub.pageReg).match.url as RegExp;
    expect(m.test(SUB_URL)).toBe(true);
    expect(m.test(BUNDLE_URL)).toBe(true);
    expect(m.test('https://store.steampowered.com/app/570/')).toBe(false);
    expect(m.test('https://store.steampowered.com/cart/')).toBe(false);
  });
});

describe('registerPackagePage — /sub/<id>', () => {
  test('asks the backend for the sub id space, not the app one', async () => {
    const { keysClient } = await mountPage(SUB_URL, SUB_BODY, { items: [item()] });
    expect(keysClient.targets).toEqual([{ kind: 'sub', id: 1010506 }]);
  });

  test('puts a «Купить» chip in BOTH purchase blocks', async () => {
    await mountPage(SUB_URL, SUB_BODY, { items: [item()] });
    expect(document.querySelectorAll('.booster-eo').length).toBe(2);
    expect(document.querySelector('#game_area_purchase_top .booster-eo-buy')).not.toBeNull();
    expect(document.querySelector('#game_area_purchase_bottom .booster-eo-buy')).not.toBeNull();
  });

  test('marks both chip hosts with the sub id they sell', async () => {
    await mountPage(SUB_URL, SUB_BODY, { items: [item()] });
    expect(document.querySelectorAll('[data-sb-keys-subid="1010506"]').length).toBe(2);
    expect(document.querySelector('[data-sb-keys-bundleid]')).toBeNull();
  });

  test('buying from the BOTTOM block purchases that block\'s offer', async () => {
    const { keysClient } = await mountPage(SUB_URL, SUB_BODY, { items: [item({ itemId: 77 })] });
    (document.querySelector('#game_area_purchase_bottom .booster-eo-buy') as HTMLButtonElement).click();
    await tick();
    expect(keysClient.purchases.map((p) => p.itemId)).toEqual([77]);
  });
});

describe('registerPackagePage — /bundle/<id>', () => {
  test('asks the backend for the bundle id space', async () => {
    const { keysClient } = await mountPage(BUNDLE_URL, BUNDLE_BODY, { items: [bundleItem()] });
    expect(keysClient.targets).toEqual([{ kind: 'bundle', id: 42206 }]);
  });

  test('puts a «Купить» chip in BOTH purchase blocks', async () => {
    await mountPage(BUNDLE_URL, BUNDLE_BODY, { items: [bundleItem()] });
    expect(document.querySelectorAll('.booster-eo').length).toBe(2);
    expect(document.querySelector('#game_area_purchase_top .booster-eo-buy')).not.toBeNull();
    expect(document.querySelector('#game_area_purchase_bottom .booster-eo-buy')).not.toBeNull();
  });

  test('marks both chip hosts with the bundle id they sell', async () => {
    await mountPage(BUNDLE_URL, BUNDLE_BODY, { items: [bundleItem()] });
    expect(document.querySelectorAll('[data-sb-keys-bundleid="42206"]').length).toBe(2);
    expect(document.querySelector('[data-sb-keys-subid]')).toBeNull();
  });

  // The two id spaces overlap numerically: a package offer whose id happens to
  // equal this bundle's id must never be sold as the bundle.
  test('a package-type offer carrying the same number is not sold as the bundle', async () => {
    await mountPage(BUNDLE_URL, BUNDLE_BODY, { items: [item({ packageId: 42206, packageType: 'package' })] });
    expect(document.querySelector('[data-sb-keys-bundleid]')).toBeNull();
  });
});

// The page asked the backend about exactly one product, so anything it answers
// with is about that product — even when the payload carries no usable
// package.id to match on. /app/ pages must NOT do this (they sell many
// products at once), which is why the fallback lives here.
describe('registerPackagePage — id-less answer', () => {
  test('mounts the offer anyway when the backend sends no package id', async () => {
    await mountPage(SUB_URL, SUB_BODY, { items: [item({ packageId: null, packageType: null, itemId: 55 })] });
    expect(document.querySelectorAll('.booster-eo-buy').length).toBe(2);
  });

  test('prefers a properly matched offer over the fallback', async () => {
    const { keysClient } = await mountPage(SUB_URL, SUB_BODY, {
      items: [item({ packageId: null, packageType: null, itemId: 55 }), item({ itemId: 66 })],
    });
    (document.querySelector('#game_area_purchase_top .booster-eo-buy') as HTMLButtonElement).click();
    await tick();
    expect(keysClient.purchases.map((p) => p.itemId)).toEqual([66]);
  });
});

describe('registerPackagePage — nothing on sale', () => {
  test('shows the topup bar as the first element of the left column', async () => {
    await mountPage(SUB_URL, SUB_BODY, { items: [] });
    const col = document.querySelector('.leftcol.game_description_column')!;
    expect(col.firstElementChild?.id).toBe('booster-topup-bar');
  });

  test('shows a dimmed «СКОРО» chip in both blocks, with no buy wired up', async () => {
    const { keysClient } = await mountPage(SUB_URL, SUB_BODY, { items: [] });
    expect(document.querySelectorAll('.booster-eo--soon').length).toBe(2);
    (document.querySelector('#game_area_purchase_bottom .booster-eo-buy') as HTMLButtonElement | null)?.click();
    await tick();
    expect(keysClient.purchases).toEqual([]);
  });

  test('prefills the bar with the package price', async () => {
    await mountPage(SUB_URL, SUB_BODY, { items: [] });
    expect((document.querySelector('#booster-topup-bar input') as HTMLInputElement).value).toBe('5999');
  });

  test('no topup bar when an offer did mount (mutual exclusion)', async () => {
    await mountPage(SUB_URL, SUB_BODY, { items: [item()] });
    expect(document.getElementById('booster-topup-bar')).toBeNull();
  });
});

describe('registerPackagePage — region-locked package page', () => {
  test('inserts the keys block right after #error_box', async () => {
    await mountPage(SUB_URL, REGION_LOCKED_BODY, { items: [item()] });
    const block = document.getElementById('booster-keys-block');
    expect(block).not.toBeNull();
    expect(document.getElementById('error_box')!.nextElementSibling).toBe(block);
    expect(document.querySelector('.booster-eo')).toBeNull();
  });

  test('leaves a region-locked page untouched when we have no keys', async () => {
    await mountPage(SUB_URL, REGION_LOCKED_BODY, { items: [] });
    expect(document.getElementById('booster-keys-block')).toBeNull();
  });
});

describe('registerPackagePage — teardown', () => {
  test('removes every chip and its stylesheet', async () => {
    const { teardown } = await mountPage(SUB_URL, SUB_BODY, { items: [item()] });
    expect(document.querySelectorAll('.booster-eo').length).toBe(2);
    teardown!();
    expect(document.querySelectorAll('.booster-eo').length).toBe(0);
    expect(document.getElementById('booster-edition-offer-style')).toBeNull();
    expect(document.querySelector('[data-sb-keys-subid]')).toBeNull();
  });

  test('removes the topup bar and the «СКОРО» chips', async () => {
    const { teardown } = await mountPage(SUB_URL, SUB_BODY, { items: [] });
    teardown!();
    expect(document.getElementById('booster-topup-bar')).toBeNull();
    expect(document.querySelectorAll('.booster-eo').length).toBe(0);
  });
});
