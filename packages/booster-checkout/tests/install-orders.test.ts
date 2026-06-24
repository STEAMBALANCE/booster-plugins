import { test, expect } from 'bun:test';
import { appendOrderUid, sanitizeStoredUids } from '../src/main/order-uids';
import { buildOrdersUrl } from '../src/main/urls-helper';

test('persist→read→buildUrl roundtrip', () => {
  const UID = 'a5273b1e-87b4-435f-95ed-e85995b8951d';
  let uids = sanitizeStoredUids(null);          // cold start → []
  uids = appendOrderUid(uids, UID);             // create order
  const restored = sanitizeStoredUids(uids);    // reload from "config"
  const url = buildOrdersUrl('https://steambalance.cc/booster/orders', restored);
  expect(url).toContain('uid%5B%5D=' + UID);
});
