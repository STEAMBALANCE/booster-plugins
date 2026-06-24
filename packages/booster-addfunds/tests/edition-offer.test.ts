import { test, expect } from 'bun:test';
import { getEditionOffer } from '../src/lib/edition-offer';

const live = (): AbortSignal => new AbortController().signal;

test('derives ourPrice at -32% and a matching derived discount', async () => {
  const o = await getEditionOffer(570, 7600, '₸', live());
  expect(o).toEqual({ ourPrice: 5168, steamPrice: 7600, discountPercent: 32, currencySymbol: '₸' });
});

test('discount is derived from shown numbers, never the raw constant', async () => {
  // ourPrice = round(49*0.68)=33; derived = round((49-33)/49*100)=33 (not 32)
  const o = await getEditionOffer(570, 49, '₽', live());
  expect(o!.ourPrice).toBe(33);
  expect(o!.discountPercent).toBe(33);
});

test('steamPrice<=0 → null', async () => {
  expect(await getEditionOffer(570, 0, '₽', live())).toBeNull();
});

test('aborted signal → null', async () => {
  const ac = new AbortController(); ac.abort();
  expect(await getEditionOffer(570, 7600, '₽', ac.signal)).toBeNull();
});
