# DLC price plaques on the game page — design

- **Date:** 2026-08-25
- **Status:** **PAUSED — design presented, awaiting approval on two open points** (see
  [Open questions](#open-questions)). Nothing implemented yet; no code touched.
- **Package:** `booster-plugins/packages/booster-addfunds`
- **Figma file:** SteamBooster, page `App`, frame **`2324:962` «Страница игры для ДЛЦ»**
- **Research artefacts:** `C:\Users\ank\Documents\.sb-dlc-research\` (screenshots +
  fetched Steam HTML + prod API dump; regenerable — commands in
  [Appendix A](#appendix-a--how-to-regenerate-the-research-artefacts))

---

## 1. Goal

Show SteamBalance prices for a game's DLC directly in Steam's own
«Контент для этой игры» section on `store.steampowered.com/app/<id>`, so a user
sees per-DLC pricing without going through Steam's full-cart flow.

Today `booster-addfunds` only decorates the **editions** area
(`#game_area_purchase`); the DLC section is untouched. A grep for `dlc` across
all four repos returns nothing.

## 2. Scope (as agreed with the operator, 2026-08-25)

**In scope**

- Per-row price plaques inside `#gameAreaDLCSection` on `/app/<gameid>`.

**Explicitly OUT of scope** (operator decisions — do not re-litigate without asking)

| Decision | Answer |
|---|---|
| Surfaces | **Only `/app/<gameid>`.** The `/dlc/<appid>/<slug>/` listing page (Figma frame `2372:1334` «Страница ДЛС») is a **separate future task**. |
| «Купить доп. контент» button (Figma `2324:1060`) | **Not built.** Steam's native footer (`#dlc_purchase_action`, «Добавить в корзину весь доп. контент») is **not touched at all**. |
| Struck-through grey price | **`old_price` from our backend** (not scraped from Steam's DOM). Rendered only when `oldPrice > price`. |
| Click on the plaque | **Navigates to the DLC's own page.** The row is already an `<a href="/app/<dlcid>">`, so we attach **no click handlers** and the native navigation does the work. Purchase then happens there via the existing edition-offer chip. |

## 3. Backend findings (decisive — verified 2026-08-25 against production)

The dev backend `http://192.168.1.139/api/` has an **empty** `steam_keys` service
(`items: []` for every query, filtered or not; `/api/services` lists no steam
service at all). Production `https://steambalance.cc/api/` has real data, so the
contract below was probed there.

```
GET /api/services/steam_keys?paymentId=paypalych-sbp&store_country=RU&appid=…
```

| Query | Result |
|---|---|
| `appid=1144200` (Ready or Not, base) | 4 items, all `app_id: 1144200` — base (sub 389471), Digital Deluxe (sub 1559731), 2 with `package: null`. **No DLC.** |
| `appid=3015760` (Home Invasion DLC) | 1 item: `id 7064`, `package:{type:"package", id:1072587, product_type:"dlc"}`, `steam_price:385`, `price:354`, `old_price:385`, `discount_percent:8` |
| `appid=3174120` (Dark Waters DLC) | 1 item: `id 7065`, `package.id 1126169`, `product_type:"dlc"` |
| `appid=2951990` (Void Shadows DLC) | 1 item: `id 1230`, `package.id 1051120`, `product_type:"dlc"` |
| `sub=1072587`, `sub=1126169` | **empty** |
| `appid=3015760,3174120`, `appids=…`, `appid[]=…`, `app_id=…` | **empty** |

Three consequences that shape the whole design:

1. **DLC items are keyed by the DLC's own appid.** A query on the base game's
   appid never returns them. Every DLC row must be asked for separately, using
   the row's `data-ds-appid`.
2. **`sub=` is useless for DLC** — it returns nothing even for a sub id that is
   demonstrably present as `package.id` in the appid-keyed answer.
3. **There is no batch parameter.** N rows ⇒ N requests (Ready or Not: 4 rows,
   Rogue Trader: 9 rows).

Bonus: items carry `product_type: "dlc"` (a clean discriminator) and
`steam_price` / `steam_old_price` / `steam_discount_percent` alongside our
`price` / `old_price` / `discount_percent`. In every sample `old_price ==
steam_price`, so rendering our `old_price` is visually identical to comparing
against Steam's price. **No change to the `KeyItem` wire shape is needed** —
`toKeyItem` already parses `old_price` and `discount_percent`.

### Example products (operator-supplied, for QA)

1. **Ready or Not** — appid 1144200, base sub 389471 (item 7842 on dev)
   - DLC Home Invasion — appid 3015760, sub 1072587 (dev item 7841)
   - DLC Dark Waters — appid 3174120, sub 1126169 (dev item 7839)
2. **Warhammer 40,000: Rogue Trader** — appid 2186680 (richest case: base +
   edition-bundles + DLC; the operator's note says "4 DLC" but lists three —
   the live page actually renders **9** DLC rows, which is why it is the worst
   case for request fan-out)
   - base sub 782856; editions bundle 36541 (Deluxe), bundle 36542 (Voidfarer)
   - DLC Deluxe Pack — appid 2682660, sub 960934
   - DLC Season Pass — appid 2687230, sub 962479
   - DLC Void Shadows — appid 2951990, sub 1051120
3. **ELDEN RING** — appid 1245620; base sub 440408; edition-with-DLC sub 1010506
   - DLC Shadow of the Erdtree Premium Bundle — appid 2778590, sub 1010529
     (no "bare" Shadow of the Erdtree exists — only the Premium Bundle and the
     Deluxe edition)

> The dev item ids (7842/7841/7839) do **not** exist in production; production
> uses 7063/7064/7065 for the Ready or Not family.

## 4. Steam DOM ground truth

Fetched from live Steam (`/app/1144200`, `/app/2186680`, saved in the research
folder). Server-rendered — no JS needed to see it.

```html
<div id="gameAreaDLCSection" class="game_area_dlc_section">
  <h2 class="gradientbg">Контент для этой игры
    <span class="note"><a href="…/dlc/1144200/Ready_or_Not/">Просмотреть все <em>(4)</em></a></span>
  </h2>
  <div class="game_area_dlc_list">
    <form name="add_all_dlc_to_cart" action="…/cart/" method="POST">
      <div class="tableView">
        <div class="gameDlcBlocks">

          <a class="game_area_dlc_row dlc_highlight odd ds_collapse_flag ds_collapse_flag_tiny"
             id="dlc_row_3015760"
             href="https://store.steampowered.com/app/3015760/Ready_or_Not_Home_Invasion/?snr=…"
             data-ds-appid="3015760" data-ds-itemkey="App_3015760" …>
            <div class="capsule_container"><img class="capsule" …></div>   <!-- optional -->
            <div class="game_area_dlc_name">Ready or Not: Home Invasion</div>
            <div class="game_area_dlc_price">385 руб.</div>
            <input type="hidden" name="subid[]" value="1072587">
          </a>
          …

          <!-- native footer — WE DO NOT TOUCH THIS -->
          <div id="dlc_purchase_action" class="game_purchase_action game_purchase_action_bg">
            <div class="game_purchase_price price">1475 руб.</div>
            <div class="btn_addtocart">
              <a class="btn_green_steamui btn_medium" href="javascript:addAllDlcToCart();">
                <span>Добавить в корзину весь доп. контент</span></a>
            </div>
          </div>
```

Notes worth keeping:

- Every row carries **both** `data-ds-appid` and `input[name="subid[]"]`.
- Rows that are **not purchasable have no `subid[]`**: Rogue Trader's free
  «The Shovel DLC» (price text «Бесплатно») and the unreleased «Appearance
  Pack» (price text «N/A»).
- `#dlc_purchase_action` can arrive as `style="display: none;"` (it does on
  Rogue Trader). Irrelevant now that the bottom chip is out of scope, but worth
  remembering if it ever comes back.
- Rogue Trader's section carries `game_area_dlc_expanded` (9 rows) — collapse /
  expand behaviour exists; see the known limitation in §9.

## 5. Figma design tokens

### 5.1 Row plaque — `2372:1259` (and siblings `2372:1293 / 1305 / 1311 / 1299`)

Frame 136×22, horizontal auto-layout, `itemSpacing: 9`, padding `3px 6px 3px
10px`, fill `#546371`.

| Element | Node | Style |
|---|---|---|
| struck old price | `2372:1250` | `10px` / `line-height 16` / `#ffffff` @ `opacity .5` / `STRIKETHROUGH` |
| price group | `2372:1280` | horizontal, `itemSpacing: 4` |
| swirl vector | `2372:1278` | 10×8, fill `#42e5ab` |
| our price | `2372:1248` | `12px` / `line-height 16` / `#42e5ab` |

The same plaque appears on the out-of-scope `/dlc/` canvas as `2372:1444`, with
padding `1px 6px 1px 10px` and fill `#06080a`.

**The frame fill is not a design token.** `#546371` (game page) and `#06080a`
(DLC listing) are simply the host row's own background — the designer pasted a
real Steam screenshot and masked the native price area behind the plaque. In
the live DOM the plaque is transparent.

**The frame padding is likewise not transferable.** `3px 6px 3px 10px` is
spacing to the neighbour and to the row edge *inside that mask*; in the live DOM
the host `.game_area_dlc_price` already provides it. Applying the padding would
push the plaque off the row's right edge.

Only the rows that have one of our offers get a plaque; rows without (299 ₽,
149 ₽ in the mock) are left completely alone.

### 5.2 Bottom chip — `2324:1060` (OUT OF SCOPE, recorded for the future)

Byte-for-byte the existing `.booster-eo` edition-offer chip: black container
`radius 2` `padding 3`, `-32%` badge `#664cfe` `radius 3`, price stack (`10px`
50 % strike / `12px`, `itemSpacing −4`), green button `#34a37b` `radius 2` +
swirl, `14px` Motiva Sans Medium. Only the label changes → «Купить доп.
контент». The hidden variant layers («Подарить», «скоро» badge `#ea2445`) are
the ones the component already has.

## 6. Architecture

`pages/app.ts` gains a third branch in its existing `Promise.allSettled`,
alongside `mountNormal` and `mountRegionGames`:

```
mountDlcPlaques(ctx)
  1. waitForElement('#gameAreaDLCSection', ctx.signal)   // 5s; null → game has no DLC → silent exit
  2. rows = section.querySelectorAll('a.game_area_dlc_row')
     per row: appid  ← data-ds-appid  (fallback: id="dlc_row_<appid>")
              subid  ← input[name="subid[]"].value  (may be absent)
  3. unique appids → keysClient.requestKeys({kind:'app', id}, ctx.signal)
     concurrency 4, hard cap 12 rows (log how many were dropped — never truncate silently)
  4. offer for a row:  packageId === subid
                    →  else first isActive && productType === 'dlc'
                    →  else none.   isActive is required; an inactive item gets NO plaque
                       (the «СКОРО» empty state does not exist on this surface)
  5. mount the plaque
```

### 6.1 New files

| File | Responsibility |
|---|---|
| `src/lib/dlc-rows.ts` | Parse `#gameAreaDLCSection` into `{ row, appid, subid }[]`. Pure DOM reading, no I/O. |
| `src/lib/dlc-offers.ts` | Per-appid offer resolution: concurrency-capped fan-out over `keysClient.requestKeys`, plus the row↔item pick rule from step 4. |
| `src/components/dlc-price-plaque.ts` + `.css` | The plaque itself. Plain DOM, styles injected once, ref-counted teardown — same shape as `edition-offer-chip.ts`. |
| `src/lib/dlc-cache.ts` | *(only if approach C is chosen — see §10)* localStorage cache keyed by appid, TTL 10 min, modelled on `catalogue-api.ts`'s `readCache` / `writeCache` / `decide`. |

### 6.2 Component CSS (scoped `.booster-dlcp`, mirrors `.booster-eo` conventions)

```css
.booster-dlcp {
  display: inline-flex; align-items: center; gap: 9px;      /* 2372:1259 itemSpacing */
  font-family: 'Motiva Sans', 'Nunito Sans', Arial, sans-serif;
}
.booster-dlcp .booster-dlcp-was {                            /* 2372:1250 */
  opacity: .5; font-size: 10px; line-height: 16px;
  text-decoration: line-through; color: #fff;
}
.booster-dlcp .booster-dlcp-now {                            /* 2372:1280 */
  display: inline-flex; align-items: center; gap: 4px;
  color: #42e5ab; font-size: 12px; line-height: 16px;
}
.booster-dlcp .booster-dlcp-icon { width: 10px; height: 8px; }  /* 2372:1278 */
```

`was` renders only when `oldPrice != null && oldPrice > price`. Money via the
existing `fmtMoneyKeys`. Icon via the existing `SB_SWIRL_SVG` (`viewBox 14×12`
scaled to 10×8 — same proportion, `fill: currentColor`).

### 6.3 Mounting into a row

Host is the native `.game_area_dlc_price`, which keeps Steam's own alignment
and right-hand padding for free.

The native price is **hidden, not destroyed**: its child nodes (text nodes
included) are wrapped into `<span class="booster-dlcp-native" hidden>` and the
plaque is appended after it. Teardown unwraps. Rationale: the operator chose
`old_price` from the backend as the struck value, so leaving Steam's own price
visible would put three numbers in a row where the mock shows two.

- **No click handlers.** The row's native `<a>` navigates to `/app/<dlcid>`.
- **Idempotency:** a `data-sb-dlc` guard attribute on the row.
- **Teardown:** remove plaques, unwrap natives, ref-counted removal of
  `<style id="booster-dlc-plaque-style">` once the last `.booster-dlcp` is gone.

## 7. Required change to existing code

**`src/lib/keys-client.ts` — mandatory, and easy to miss.**

`requestKeysViaBus` keeps a single in-flight slot:

```ts
let activeListReqId: string | null = null;
…
sb.bus.subscribe('booster-checkout.keys.response', (data) => {
  if (d.reqId !== activeListReqId) return;      // ← everything but the newest is dropped
  const w = listWaiters.get(d.reqId);
  …
});
```

With N concurrent requests only the last one's response is accepted; the others
time out after 6 s and resolve `[]`. Fix: drop `activeListReqId` and gate on
`listWaiters.has(d.reqId)` — the map already provides identical stale-response
protection, since the entry is deleted in `finish`. Two lines.

Check `tests/keys-client.test.ts` first, in case single-flight is asserted as a
contract there.

Nothing else changes: `edition-match.ts`, `purchase-mount.ts`, `keys-fetch.ts`,
the bus protocol and the `KeyItem` shape all stay as they are. No change in
`booster-checkout`.

New strings go into `packages/booster-addfunds/strings/ru.json` under the
`addfunds` key (aria-label for the plaque), then `gen-strings`. Remember the
`no-hardcoded-ru` guard.

## 8. Error handling / edge cases

- No `#gameAreaDLCSection`, no rows, or a silent backend → page left untouched.
- A row with no `subid[]` (free «The Shovel DLC», unreleased «N/A») is **still
  queried** by its appid: a DLC unavailable in the user's region is the highest
  value case for us. Matching then falls back to `product_type: 'dlc'`.
- Region-locked page (`detectRegionLock`) → the existing `mountRegion` branch
  runs; there is no DLC section on Steam's error template.
- The whole branch is structurally non-throwing (`try { … } catch { return }`),
  exactly like `mountRegionGames`, so a failure here can never strand
  `mountNormal`'s teardown.
- `ctx.signal.aborted` is re-checked after every await (`sb.net` does not wire
  `AbortSignal` in v1 — see the note in `keys-client.ts`).

## 9. Known limitation

If Steam adds rows after we mount (`game_area_dlc_expanded` on Rogue Trader),
those rows stay bare. No `MutationObserver` in v1 — check the behaviour in live
Steam first and only then decide whether it is worth the complexity.

## 10. Open questions

**Both must be answered before implementation starts.**

### Q1 — how to damp N requests per page

| | Approach | Cost |
|---|---|---|
| **A** | Concurrency cap 4 only, no cache | Simplest; up to 9 requests every time a game page opens |
| **C** *(recommended)* | A + localStorage cache keyed by appid, TTL 10 min, modelled on `catalogue-api.ts` | One small module + tests; repeat visits and back-navigation are free |
| **B** | Batch endpoint on the backend (`appids=1,2,3`) | 1 request per page, cheapest in production — but blocked on backend work |

Recommendation: ship **C** now; **B** later as a pure optimisation behind the
same interface (no client-side change).

### Q2 — dev backend has no data

`http://192.168.1.139/api/services/steam_keys` returns `items: []` for
everything. Unit tests don't need it (the whole package tests against fixtures
and injected seams), but live in-Steam QA on it will show nothing. Either seed
dev with items 7842/7841/7839, or point live QA at production during
development.

## 11. Test plan

happy-dom, per-package `bun --cwd packages/booster-addfunds test` (never a bare
root `bun test` — `bunfig.toml` is per-package).

| File | Cases |
|---|---|
| `tests/dlc-rows.test.ts` *(new)* | appid/subid parsing; `id="dlc_row_…"` fallback; rows without `subid[]`; malformed ids |
| `tests/dlc-price-plaque.test.ts` *(new)* | markup; `was` shown/hidden by `oldPrice > price`; `fmtMoneyKeys` formatting; aria-label |
| `tests/dlc-mount.test.ts` *(new)* | native price hidden and restored; idempotency via `data-sb-dlc`; teardown; ref-counted stylesheet removal |
| `tests/app-page.test.ts` *(extend)* | no section → no-op; concurrency cap; partial/empty responses; abort mid-flight |
| `tests/keys-client.test.ts` *(extend)* | concurrent bus requests each receive their own response |

Row fixtures should be lifted from the real HTML in the research folder
(`ron.html`, `rt.html`) rather than hand-written.

---

## Appendix A — how to regenerate the research artefacts

Saved under `C:\Users\ank\Documents\.sb-dlc-research\` — screenshots
(`dlc-page.png`, `row-plaque.png`, `bottom-block.png`, `bottom-native.png`,
`dlc-own-page.png`), Steam HTML (`ron.html`, `rt.html`, `dlcbrowse.html`) and
the prod API dump (`prod_ron.json`). None of it is committed.

```bash
# Steam store HTML (server-rendered, no auth needed)
curl -s -H 'Accept-Language: ru,en;q=0.9' \
     -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126 Safari/537.36' \
     -H 'Cookie: birthtime=283993201; Steam_Language=russian' \
     'https://store.steampowered.com/app/1144200/?cc=ru&l=russian' -o ron.html

# production keys API — paymentId comes from /api/payments
curl -s 'https://steambalance.cc/api/payments'
curl -s 'https://steambalance.cc/api/services/steam_keys?paymentId=paypalych-sbp&store_country=RU&appid=3015760'
```

Figma: the MCP server is stdio and only binds `ws://127.0.0.1:1994` while a
client has it spawned — the Figma plugin must be running for any
`figma-mcp-go` tool to answer, otherwise every call returns
`plugin not connected`. Relevant node ids are listed in §5.

## Appendix B — where things live

- `packages/booster-addfunds/src/pages/app.ts` — the `/app/` page handler this
  feature plugs into
- `packages/booster-addfunds/src/lib/purchase-mount.ts` — shared mounting core
  (chip / «СКОРО» / topup bar / keys block); **not modified** by this feature
- `packages/booster-addfunds/src/lib/edition-match.ts` — sub/bundle id-space
  matching for the editions area; the DLC matcher is deliberately separate
  because DLC is keyed by appid, not by sub
- `packages/booster-addfunds/src/lib/keys-client.ts` — the bus/direct transport
  that needs the concurrency fix (§7)
- `packages/booster-addfunds/src/components/edition-offer-chip.{ts,css}` — the
  pattern the new plaque component follows
- `packages/booster-addfunds/src/lib/catalogue-api.ts` — the localStorage cache
  pattern to copy for approach C
