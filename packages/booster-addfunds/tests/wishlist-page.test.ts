// booster-plugins/packages/booster-addfunds/tests/wishlist-page.test.ts
//
// Tests for registerWishlistPage — our «Купить» chip under Steam's own
// «Добавить в корзину» in every wishlist row we have a key for.
//
// The fixture is trimmed from the live page (store.steampowered.com/wishlist/
// id/ank1/, CDP-dumped 2026-11-01). Steam's class names are build hashes and
// kept only for realism; what the page module relies on is reproduced
// verbatim: the `data-rfd-draggable-id="WishlistItem-<appid>-<n>"` row
// attribute, the grid's named `purchase` area, and the React fiber props that
// carry the row's store item (`item.best_purchase_option`) — the purchase
// option Steam's own button sells.
//
// happy-dom runs no React; the fiber is faked with the same expando shape
// (`__reactFiber$<rand>` → { memoizedProps, return, alternate }) React leaves
// on a node.
// DOM changes are signalled through the page's `watchDom` seam by hand
// (`dom.changed()`): happy-dom 20 holds a MutationObserver callback through a
// WeakRef, so a real observer goes silent after the first GC.

import { describe, test, expect, afterEach } from 'bun:test';
import { Window } from 'happy-dom';
import { registerWishlistPage } from '../src/pages/wishlist';
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
    getComputedStyle: w.getComputedStyle.bind(w),
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

const wait = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));

// --- fixtures ---------------------------------------------------------------

// Steam's row grid (live computed values). Only the area names matter.
const GRID_CSS = `<style>
  .PE-3oq-yIvg- { display: grid; grid-template-areas: "dragger capsule title remove" "dragger capsule mid mid" "dragger capsule lower purchase"; }
  ._5obTMJByPr0- { grid-area: purchase; display: flex; flex-direction: column; align-items: flex-end; }
  .P-zVPa2bdmQ- { grid-area: title; }
  .S5hFnwUsp6o- { grid-area: lower; }
  ._7RIfZsoAbnY- { grid-area: remove; }
</style>`;

interface RowSpec {
  appid: number;
  index: number;
  name: string;
  /** Steam's best_purchase_option; omitted → a region-locked row (no purchase area). */
  option?: { packageid?: number; bundleid?: number; formatted_final_price: string };
}

function rowHtml(r: RowSpec): string {
  const purchase = r.option ? `
      <div class="_5obTMJByPr0-">
        <div class="uIGyst1O6lA-"></div>
        <div class="_6QzykeEsckc-">
          <a class="SxMdVrGe9aY- qBP7nmof-cw-" href="https://store.steampowered.com/app/${r.appid}/"><div class="-HQzBzl6lqI-">${r.option.formatted_final_price}</div></a>
          <div class="E4PXslhR-fI-"><button type="button" role="button" class="LrqeL6o22aQ- Focusable"><span>Добавить в корзину</span></button></div>
        </div>
      </div>` : `
      <div class="S5hFnwUsp6o-">Этот продукт недоступен в вашем регионе.</div>`;
  return `
  <div data-index="${r.index}" class="Panel" style="width: 100%; padding-bottom: 0px;">
    <div class="S2Q8eqrNOA4-" data-rfd-draggable-context-id="«Rboraqi»" data-rfd-draggable-id="WishlistItem-${r.appid}-${r.index}">
      <div class="PE-3oq-yIvg- Panel" tabindex="0" role="button">
        <div class="P-zVPa2bdmQ-"><a href="https://store.steampowered.com/app/${r.appid}/">${r.name}</a></div>
        ${purchase}
        <div class="_7RIfZsoAbnY-"><div class="lgaj8WbBqtc-">Дата добавления: 23 февр. 2022 г.</div></div>
      </div>
    </div>
  </div>`;
}

const ROAD96: RowSpec = { appid: 1466640, index: 1, name: 'Road 96', option: { packageid: 516434, formatted_final_price: '1296 руб' } };
const ELDEN: RowSpec = { appid: 1245620, index: 4, name: 'ELDEN RING', option: { packageid: 440408, formatted_final_price: '3599 руб' } };
const CYBERPUNK: RowSpec = { appid: 1091500, index: 0, name: 'Cyberpunk 2077' };

interface FakeFiber { memoizedProps: unknown; return: FakeFiber | null; alternate?: FakeFiber | null }

const FIBER_KEY = '__reactFiber$q1w2e3';

// The live React shape around a row's purchase column: the column's own fiber
// (a host div) → `th` { wishlistItem, item, narrowLayout } → … → the row.
// `item` is the StoreItem whose best_purchase_option Steam's button sells.
function fiberChain(row: RowSpec): FakeFiber {
  const item = { item_type: 0, id: row.appid, appid: row.appid, name: row.name, best_purchase_option: { ...row.option, package_group: 'default' } };
  const rowFiber: FakeFiber = { memoizedProps: { appid: row.appid, item }, return: null };
  const thFiber: FakeFiber = { memoizedProps: { wishlistItem: { appid: row.appid, priority: row.index }, item, narrowLayout: false }, return: rowFiber };
  return { memoizedProps: { className: '_5obTMJByPr0-' }, return: thFiber };
}

function attachFiberTo(col: HTMLElement, row: RowSpec): void {
  if (!row.option) return;
  (col as unknown as Record<string, unknown>)[FIBER_KEY] = fiberChain(row);
}

function attachFiber(row: RowSpec): void {
  const el = document.querySelector<HTMLElement>(`[data-rfd-draggable-id="WishlistItem-${row.appid}-${row.index}"]`)!;
  const col = el.querySelector<HTMLElement>('._5obTMJByPr0-');
  if (col) attachFiberTo(col, row);
}

// React re-rendering a row's purchase column: a fresh element (our chip gone).
function rerenderColumn(row: RowSpec): void {
  const old = rowEl(row).querySelector<HTMLElement>('._5obTMJByPr0-')!;
  const tpl = document.createElement('div');
  tpl.innerHTML = rowHtml(row);
  const fresh = tpl.querySelector<HTMLElement>('._5obTMJByPr0-')!;
  old.replaceWith(fresh);
  attachFiberTo(fresh, row);
}

// A virtualizer keyed by index updating a row element in place for another app:
// same row + column elements, new draggable id and React props. As React does
// it: the update is rendered into the `alternate` of every fiber on the path
// and the DOM node is never re-pointed, so the column's own fiber chain still
// describes the previous app — the new props sit one `alternate` hop away.
// (React stamps a node once, at creation; after every other update the stamp
// is the stale half of the current/alternate pair.)
function reuseRow(from: RowSpec, to: RowSpec): void {
  const el = rowEl(from);
  el.setAttribute('data-rfd-draggable-id', `WishlistItem-${to.appid}-${from.index}`);
  const col = el.querySelector<HTMLElement>('._5obTMJByPr0-')!;
  let stale = (col as unknown as Record<string, FakeFiber | null>)[FIBER_KEY] ?? null;
  let fresh: FakeFiber | null = fiberChain(to);
  for (; stale && fresh; stale = stale.return, fresh = fresh.return) {
    stale.alternate = fresh;
    fresh.alternate = stale;
  }
}

function listHtml(rows: RowSpec[]): string {
  return `${GRID_CSS}
  <div class="Panel" style="height: 870px; width: 100%; position: relative;">
    <div id="wl-list" style="position: absolute; top: 0px; left: 0px; width: 100%; transform: translateY(0px);">
      ${rows.map(rowHtml).join('')}
    </div>
  </div>`;
}

function addRow(row: RowSpec): void {
  const list = document.getElementById('wl-list')!;
  list.insertAdjacentHTML('beforeend', rowHtml(row));
  attachFiber(row);
}

const roadKey = (over: Partial<KeyItem> = {}): KeyItem => ({
  itemId: 3832, name: 'Road 96', isActive: true, regionLabel: 'СНГ',
  packageId: 516434, packageType: 'package', productType: 'game', price: 1190, oldPrice: 1296, discountPercent: 8,
  ...over,
});
const eldenKey = (over: Partial<KeyItem> = {}): KeyItem => ({
  itemId: 1655, name: 'ELDEN RING', isActive: true, regionLabel: 'СНГ',
  packageId: 440408, packageType: 'package', productType: 'game', price: 3307, oldPrice: 3599, discountPercent: 8,
  ...over,
});

// --- stubs ------------------------------------------------------------------

interface PurchaseResult { status: 'ok' | 'email-required' | 'error'; error?: string; message?: string }

interface KeysClientOpts {
  /** Hold every answer until the test calls release(appid). */
  defer?: boolean;
  /** Reject every request (a client that throws). */
  fail?: boolean;
  /** Answer each app's first N lookups with null — no answer, as a timed-out
   *  bus request or a failed fetch does (see keys-client queryKeys). */
  unanswered?: number;
}

function makeKeysClient(byApp: Record<number, KeyItem[]>, opts: KeysClientOpts = {}) {
  const purchases: number[] = [];
  const targets: KeysTarget[] = [];
  const held = new Map<number, () => void>();
  const asked = new Map<number, number>();
  const queryKeys = (target: KeysTarget): Promise<KeyItem[] | null> => {
    targets.push(target);
    if (opts.fail) return Promise.reject(new Error('keys backend down'));
    const n = (asked.get(target.id) ?? 0) + 1;
    asked.set(target.id, n);
    const answer = n <= (opts.unanswered ?? 0) ? null : byApp[target.id] ?? [];
    if (!opts.defer) return Promise.resolve(answer);
    return new Promise((r) => held.set(target.id, () => r(answer)));
  };
  return {
    purchases,
    targets,
    queryKeys,
    requestKeys: (target: KeysTarget): Promise<KeyItem[]> => queryKeys(target).then((items) => items ?? []),
    purchaseKey: async (itemId: number): Promise<PurchaseResult> => { purchases.push(itemId); return { status: 'ok' }; },
    dispose(): void {},
    release: async (appid: number): Promise<void> => { held.get(appid)?.(); held.delete(appid); await wait(); },
  };
}

function makeSbStub() {
  const pageReg: Array<{ name: string; match: { url: RegExp }; mount: any }> = [];
  const scopeCtrl = new AbortController();
  return {
    pageReg,
    sb: {
      context: { kind: 'web', url: location.href, onUrlChange: () => () => {} },
      pages: { register: (o: any) => { pageReg.push(o); return { unregister: () => {} }; } },
      bus: { publish: () => {}, subscribe: () => () => {} },
      scope: { signal: scopeCtrl.signal, _abort: () => scopeCtrl.abort() },
    } as any,
  };
}

const WISHLIST_URL = 'https://store.steampowered.com/wishlist/id/ank1/';

const reg = (pageReg: ReturnType<typeof makeSbStub>['pageReg']) =>
  pageReg.find((p) => p.name === 'booster-addfunds-wishlist')!;

let teardown: (() => void) | void;

// Stand-in for the page's DOM watch: `changed()` is what a MutationObserver
// would deliver after React touched the list.
function makeDomWatch() {
  let onChange: (() => void) | null = null;
  let watching = false;
  return {
    get watching() { return watching; },
    watch: (cb: () => void) => { onChange = cb; watching = true; return () => { watching = false; }; },
    changed: async () => { onChange?.(); await wait(); },
  };
}

async function mountWishlist(rows: RowSpec[], byApp: Record<number, KeyItem[]>, opts: KeysClientOpts & { retryDelayMs?: number } = {}) {
  installDom(WISHLIST_URL);
  document.body.innerHTML = listHtml(rows);
  for (const r of rows) attachFiber(r);
  const stub = makeSbStub();
  const keysClient = makeKeysClient(byApp, opts);
  const dom = makeDomWatch();
  registerWishlistPage(stub.sb, { keysClient, scanDelayMs: 0, retryDelayMs: opts.retryDelayMs ?? 0, watchDom: dom.watch });
  const ctrl = new AbortController();
  teardown = await reg(stub.pageReg).mount({ url: new URL(WISHLIST_URL), signal: ctrl.signal });
  await wait();
  return { keysClient, ctrl, dom };
}

const rowEl = (r: RowSpec) => document.querySelector<HTMLElement>(`[data-rfd-draggable-id="WishlistItem-${r.appid}-${r.index}"]`)!;
const chipIn = (r: RowSpec) => rowEl(r).querySelector<HTMLElement>('.booster-eo');

afterEach(() => { try { (teardown as (() => void) | undefined)?.(); } catch { /* already gone */ } teardown = undefined; });

// --- tests ------------------------------------------------------------------

describe('registerWishlistPage — page matching', () => {
  test('matches both wishlist URL shapes and nothing else', () => {
    installDom(WISHLIST_URL);
    const stub = makeSbStub();
    registerWishlistPage(stub.sb, { keysClient: makeKeysClient({}) });
    const m = reg(stub.pageReg).match.url;
    expect(m.test('https://store.steampowered.com/wishlist/id/ank1/')).toBe(true);
    expect(m.test('https://store.steampowered.com/wishlist/profiles/76561198000000000/')).toBe(true);
    expect(m.test('https://store.steampowered.com/app/1466640/Road_96/')).toBe(false);
    expect(m.test('https://store.steampowered.com/cart/')).toBe(false);
  });
});

describe('registerWishlistPage — offers', () => {
  test('asks the backend about every row Steam sells, by app id', async () => {
    const { keysClient } = await mountWishlist([ROAD96, ELDEN], {});
    expect(keysClient.targets).toEqual([{ kind: 'app', id: 1466640 }, { kind: 'app', id: 1245620 }]);
  });

  test('puts the chip under Steam\'s price + cart cluster, in the purchase column', async () => {
    await mountWishlist([ROAD96], { 1466640: [roadKey()] });
    const col = rowEl(ROAD96).querySelector('._5obTMJByPr0-')!;
    const chip = chipIn(ROAD96)!;
    expect(chip).not.toBeNull();
    expect(chip.parentElement).toBe(col);
    expect(col.lastElementChild).toBe(chip);
    expect(chip.previousElementSibling?.className).toBe('_6QzykeEsckc-');
  });

  test('shows our price for the offer', async () => {
    await mountWishlist([ROAD96], { 1466640: [roadKey()] });
    expect(chipIn(ROAD96)!.querySelector('.booster-eo-now')!.textContent).toBe('1 190 ₽');
  });

  test('sells the edition Steam\'s own button sells, not another one of the same app', async () => {
    const deluxe = roadKey({ itemId: 9001, name: 'Road 96 Deluxe', packageId: 777777, price: 1890 });
    const { keysClient } = await mountWishlist([ROAD96], { 1466640: [deluxe, roadKey()] });
    chipIn(ROAD96)!.querySelector<HTMLButtonElement>('.booster-eo-buy')!.click();
    await wait();
    expect(keysClient.purchases).toEqual([3832]);
  });

  test('no chip when our only offer is a different edition', async () => {
    await mountWishlist([ROAD96], { 1466640: [roadKey({ packageId: 777777 })] });
    expect(chipIn(ROAD96)).toBeNull();
  });

  // The sub and bundle id spaces overlap numerically (see edition-match.ts).
  test('a bundle purchase option pairs only with a bundle-type offer of that id', async () => {
    const BUNDLE_ROW: RowSpec = { appid: 2300320, index: 2, name: 'Farming Simulator 25', option: { bundleid: 42206, formatted_final_price: '4037 руб' } };
    await mountWishlist([BUNDLE_ROW], { 2300320: [
      roadKey({ itemId: 11, packageId: 42206, packageType: 'package' }),
      roadKey({ itemId: 12, packageId: 42206, packageType: 'bundle' }),
    ] });
    expect(chipIn(BUNDLE_ROW)).not.toBeNull();
    expect(rowEl(BUNDLE_ROW).querySelector('[data-sb-keys-bundleid="42206"]')).not.toBeNull();
  });

  // An inactive key renders as a dimmed «Скоро в продаже» chip — exactly the
  // list noise the wishlist leaves out.
  test('an inactive key gets no chip', async () => {
    await mountWishlist([ROAD96], { 1466640: [roadKey({ isActive: false })] });
    expect(chipIn(ROAD96)).toBeNull();
  });

  test('an active key wins over an inactive duplicate of the same package', async () => {
    const { keysClient } = await mountWishlist([ROAD96], { 1466640: [roadKey({ itemId: 1, isActive: false }), roadKey()] });
    chipIn(ROAD96)!.querySelector<HTMLButtonElement>('.booster-eo-buy')!.click();
    await wait();
    expect(keysClient.purchases).toEqual([3832]);
  });

  test('clicking «Купить» buys that row\'s key', async () => {
    const { keysClient } = await mountWishlist([ROAD96, ELDEN], { 1466640: [roadKey()], 1245620: [eldenKey()] });
    chipIn(ELDEN)!.querySelector<HTMLButtonElement>('.booster-eo-buy')!.click();
    await wait();
    expect(keysClient.purchases).toEqual([1655]);
  });
});

describe('registerWishlistPage — nothing to sell', () => {
  test('a row we have no key for stays untouched — no chip, no «СКОРО»', async () => {
    await mountWishlist([ROAD96], {});
    expect(document.querySelector('.booster-eo')).toBeNull();
  });

  test('a region-locked row (no Steam purchase area) is skipped without a request', async () => {
    const { keysClient } = await mountWishlist([CYBERPUNK, ROAD96], { 1091500: [roadKey()], 1466640: [roadKey()] });
    expect(keysClient.targets).toEqual([{ kind: 'app', id: 1466640 }]);
    expect(chipIn(CYBERPUNK)).toBeNull();
  });

  // Without Steam's purchase option we can't tell which edition the row sells —
  // better no chip than the wrong product.
  test('no chip when the row carries no readable purchase option', async () => {
    const { dom } = await mountWishlist([ROAD96], { 1466640: [roadKey()] });
    // Re-render the row without React data, as a page whose internals changed would.
    rowEl(ROAD96).closest('[data-index]')!.remove();
    document.getElementById('wl-list')!.insertAdjacentHTML('beforeend', rowHtml(ROAD96));
    await dom.changed();
    expect(chipIn(ROAD96)).toBeNull();
  });
});

describe('registerWishlistPage — live list', () => {
  test('a row rendered after mount (scrolled into view) gets its chip', async () => {
    const { dom } = await mountWishlist([ROAD96], { 1466640: [roadKey()], 1245620: [eldenKey()] });
    addRow(ELDEN);
    await dom.changed();
    expect(chipIn(ELDEN)).not.toBeNull();
  });

  test('a re-rendered row gets its chip back without asking the backend again', async () => {
    const { keysClient, dom } = await mountWishlist([ROAD96], { 1466640: [roadKey()] });
    rowEl(ROAD96).closest('[data-index]')!.remove();
    addRow(ROAD96);
    await dom.changed();
    expect(chipIn(ROAD96)).not.toBeNull();
    expect(keysClient.targets).toEqual([{ kind: 'app', id: 1466640 }]);
  });

  // React re-renders the purchase column in place: the row element survives,
  // our chip does not.
  test('a chip dropped by a column re-render comes back', async () => {
    const { dom } = await mountWishlist([ROAD96], { 1466640: [roadKey()] });
    chipIn(ROAD96)!.remove();
    await dom.changed();
    expect(chipIn(ROAD96)).not.toBeNull();
  });

  test('a row reused in place for another app swaps to that app\'s chip', async () => {
    const { dom } = await mountWishlist([ROAD96], { 1466640: [roadKey()], 1245620: [eldenKey()] });
    reuseRow(ROAD96, ELDEN);
    await dom.changed();
    const row = document.querySelector('[data-rfd-draggable-id^="WishlistItem-1245620-"]')!;
    expect(row.querySelectorAll('.booster-eo').length).toBe(1);
    expect(row.querySelector('[data-sb-keys-subid="440408"]')).not.toBeNull();
  });

  // React swapping the column's last child for an element of another type (the
  // cart button turning into an «in cart» badge, say) appends the new one —
  // after our chip, which would then sit above Steam's control.
  test('the chip moves back under an element React appends after it', async () => {
    const { dom } = await mountWishlist([ROAD96], { 1466640: [roadKey()] });
    const col = rowEl(ROAD96).querySelector<HTMLElement>('._5obTMJByPr0-')!;
    col.appendChild(document.createElement('div')).className = 'in-cart';
    await dom.changed();
    expect(col.lastElementChild?.classList.contains('booster-eo')).toBe(true);
    expect(col.querySelectorAll('.booster-eo').length).toBe(1);
  });

  test('a row never carries two chips', async () => {
    const { dom } = await mountWishlist([ROAD96], { 1466640: [roadKey()] });
    // React touching the row (e.g. a category tag added) triggers a rescan.
    rowEl(ROAD96).querySelector('.P-zVPa2bdmQ-')!.appendChild(document.createElement('span'));
    await dom.changed();
    await dom.changed();
    expect(rowEl(ROAD96).querySelectorAll('.booster-eo').length).toBe(1);
  });
});

describe('registerWishlistPage — keys requests', () => {
  // React swapping the column while the row waits for its keys: the rescan it
  // triggers skips the busy row, so the row must look again once keys land.
  test('a column re-rendered while its keys are in flight still gets the chip', async () => {
    const { keysClient, dom } = await mountWishlist([ROAD96], { 1466640: [roadKey()] }, { defer: true });
    rerenderColumn(ROAD96);
    await dom.changed();
    await keysClient.release(1466640);
    expect(chipIn(ROAD96)).not.toBeNull();
  });

  test('teardown while keys are in flight mounts nothing afterwards', async () => {
    const { keysClient } = await mountWishlist([ROAD96], { 1466640: [roadKey()] }, { defer: true });
    (teardown as () => void)();
    teardown = undefined;
    await keysClient.release(1466640);
    expect(document.querySelector('.booster-eo')).toBeNull();
  });

  const SIX: RowSpec[] = [1, 2, 3, 4, 5, 6].map((n) => ({
    appid: 1000 + n, index: n - 1, name: `Game ${n}`, option: { packageid: 2000 + n, formatted_final_price: '100 руб' },
  }));

  test('at most four keys requests run at once', async () => {
    const { keysClient } = await mountWishlist(SIX, {}, { defer: true });
    expect(keysClient.targets.map((t) => t.id)).toEqual([1001, 1002, 1003, 1004]);
    await keysClient.release(1001);
    expect(keysClient.targets.map((t) => t.id)).toEqual([1001, 1002, 1003, 1004, 1005]);
  });

  test('a row scrolled away before its turn is never asked about', async () => {
    const { keysClient } = await mountWishlist(SIX, {}, { defer: true });
    rowEl(SIX[5]!).closest('[data-index]')!.remove();
    for (const id of [1001, 1002, 1003, 1004, 1005]) await keysClient.release(id);
    expect(keysClient.targets.map((t) => t.id)).not.toContain(1006);
  });

  test('a failing keys request leaves the row untouched', async () => {
    const { dom } = await mountWishlist([ROAD96], { 1466640: [roadKey()] }, { fail: true });
    await dom.changed();
    expect(chipIn(ROAD96)).toBeNull();
  });
});

// A lookup can come back empty-handed — the bus timed out on a cold start
// (checkout's main shell not up yet), the backend failed. That is not "no
// keys": remembering it as [] would leave the row bare until a reload.
describe('registerWishlistPage — lookups that got no answer', () => {
  test('a lookup that got no answer is asked again, and the chip appears', async () => {
    const { keysClient } = await mountWishlist([ROAD96], { 1466640: [roadKey()] }, { unanswered: 1 });
    await wait();
    expect(keysClient.targets.length).toBe(2);
    expect(rowEl(ROAD96).querySelectorAll('.booster-eo').length).toBe(1);
  });

  // Asking again on every DOM change would hammer a backend that is down.
  test('it is asked again only after a pause, not on the next page change', async () => {
    const { keysClient, dom } = await mountWishlist([ROAD96], { 1466640: [roadKey()] }, { unanswered: 1, retryDelayMs: 150 });
    await dom.changed();
    expect(keysClient.targets.length).toBe(1);
    await wait(200);
    expect(keysClient.targets.length).toBe(2);
    expect(rowEl(ROAD96).querySelectorAll('.booster-eo').length).toBe(1);
  });

  test('gives up after three lookups without an answer', async () => {
    const { keysClient } = await mountWishlist([ROAD96], { 1466640: [roadKey()] }, { unanswered: Infinity });
    await wait(60);
    expect(keysClient.targets.length).toBe(3);
  });

  test('an empty answer is final — the row is not asked again', async () => {
    const { keysClient, dom } = await mountWishlist([ROAD96], {});
    await wait();
    await dom.changed();
    expect(keysClient.targets.length).toBe(1);
  });

  test('teardown during the pause cancels the next lookup', async () => {
    const { keysClient, dom } = await mountWishlist([ROAD96], { 1466640: [roadKey()] }, { unanswered: 1, retryDelayMs: 60 });
    (teardown as () => void)();
    teardown = undefined;
    await wait(100);
    await dom.changed();
    expect(keysClient.targets.length).toBe(1);
  });
});

describe('registerWishlistPage — teardown', () => {
  test('removes every chip and the chip stylesheet', async () => {
    await mountWishlist([ROAD96, ELDEN], { 1466640: [roadKey()], 1245620: [eldenKey()] });
    expect(document.querySelectorAll('.booster-eo').length).toBe(2);
    (teardown as () => void)();
    teardown = undefined;
    expect(document.querySelectorAll('.booster-eo').length).toBe(0);
    expect(document.getElementById('booster-edition-offer-style')).toBeNull();
  });

  test('stops watching the list', async () => {
    const { dom } = await mountWishlist([ROAD96], { 1466640: [roadKey()], 1245620: [eldenKey()] });
    (teardown as () => void)();
    teardown = undefined;
    expect(dom.watching).toBe(false);
    addRow(ELDEN);
    await dom.changed();
    expect(chipIn(ELDEN)).toBeNull();
  });
});
