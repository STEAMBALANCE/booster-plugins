import { describe, test, expect } from 'bun:test';
import { postKeysOrder } from '../src/main/keys-order';
const sb = { version: '1.0.0' } as any;
function fakeFetch(body: unknown, ok = true) {
  const fn = (async (_u: string, init: RequestInit) => { (fn as any).init = init; return { ok, json: async () => body }; }) as any;
  return fn;
}
describe('postKeysOrder', () => {
  test('success → redirectUrl + uid (nested)', async () => {
    const f = fakeFetch({ success: true, data: { redirectUrl: 'https://pay.example/x', uid: 'u1' } });
    const r = await postKeysOrder(sb, { paymentId: 'p', itemId: 5, account: 'a@b.c' }, f);
    expect(r).toEqual({ ok: true, redirectUrl: 'https://pay.example/x', uid: 'u1' });
    expect(JSON.parse((f as any).init.body)).toEqual({ paymentId: 'p', itemId: 5, account: 'a@b.c' });
  });
  test('top-level redirectUrl also accepted', async () => {
    const r = await postKeysOrder(sb, { paymentId: 'p', itemId: 5, account: 'a@b.c' }, fakeFetch({ redirectUrl: 'https://x/y' }));
    expect(r.ok).toBe(true); expect(r.redirectUrl).toBe('https://x/y');
  });
  test('success=false → human message in `message`, machine code in `error`', async () => {
    const r = await postKeysOrder(sb, { paymentId: 'p', itemId: 5, account: 'a@b.c' }, fakeFetch({ success: false, message: 'nope' }));
    expect(r.ok).toBe(false);
    expect(r.message).toBe('nope');          // server-supplied human text → user-facing
    expect(typeof r.error).toBe('string');   // machine code for logs
    expect(r.error).not.toBe('nope');        // never the human text
  });
  test('success=false without a message → no human message, only a machine code', async () => {
    const r = await postKeysOrder(sb, { paymentId: 'p', itemId: 5, account: 'a@b.c' }, fakeFetch({ success: false }));
    expect(r.ok).toBe(false);
    expect(r.message).toBeUndefined();
    expect(typeof r.error).toBe('string');
  });
  test('http error → ok:false', async () => {
    const r = await postKeysOrder(sb, { paymentId: 'p', itemId: 5, account: 'a@b.c' }, fakeFetch(null, false));
    expect(r.ok).toBe(false);
  });
});
