import { test, expect, beforeEach } from 'bun:test';
import { Window } from 'happy-dom';
import { detectRegionLock } from '../src/lib/region-lock';

beforeEach(() => {
  const w = new Window({ url: 'https://store.steampowered.com/app/22350/' });
  (w as unknown as { SyntaxError: typeof SyntaxError }).SyntaxError = SyntaxError;
  Object.assign(globalThis, { document: w.document, DOMParser: w.DOMParser });
});

function docFrom(html: string): Document {
  return new (globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser().parseFromString(html, 'text/html');
}

test('region-locked error page → true', () => {
  const doc = docFrom(`<body class="redeemwalletcode"><div id="error_box">Во время обработки вашего запроса произошла ошибка:<br><span class="error">Данный товар недоступен в вашем регионе</span></div></body>`);
  expect(detectRegionLock(doc)).toBe(true);
});
test('normal app page (has apphub/purchase) → false', () => {
  const doc = docFrom(`<body class="app application"><div class="apphub_AppName">Game</div><div class="game_area_purchase"></div><div id="error_box">Ой, извините</div></body>`);
  expect(detectRegionLock(doc)).toBe(false);
});
test('error page with non-region reason → false', () => {
  const doc = docFrom(`<body class="redeemwalletcode"><div id="error_box"><span class="error">Этот товар больше не доступен</span></div></body>`);
  expect(detectRegionLock(doc)).toBe(false);
});
test('no error_box, no product → false', () => {
  const doc = docFrom(`<body></body>`);
  expect(detectRegionLock(doc)).toBe(false);
});
