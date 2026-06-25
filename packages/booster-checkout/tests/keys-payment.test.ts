import { describe, test, expect } from 'bun:test';
import { resolveKeysPaymentId } from '../src/main/keys-payment';

const sb = { version: '1.0.0' } as any;
function fakeFetch(body: unknown, ok = true): typeof fetch {
  return (async () => ({ ok, json: async () => body })) as any;
}

describe('resolveKeysPaymentId', () => {
  // Real-world shape: the request carries the x-booster header (getBoosterHeaders),
  // so /api/payments returns the BOOSTERED form {type,name,image} — no `value`,
  // no `can_pay_services`. Must pick the first method's `type` (СБП).
  test('boostered shape {type,name}: picks first type', async () => {
    const f = fakeFetch({ success: true, data: [
      { name: 'СБП', type: 'paypalych-sbp', image: 'sbp.svg' },
      { name: 'Карта', type: 'paypalych-card', image: 'visa.svg' },
    ]});
    expect(await resolveKeysPaymentId(sb, f)).toBe('paypalych-sbp');
  });
  test('picks first can_pay_services && !disabled', async () => {
    const f = fakeFetch({ success: true, data: [
      { value: 'x-disabled', can_pay_services: true, disabled: true },
      { value: 'x-nosvc', can_pay_services: false, disabled: false },
      { value: 'paypalych-sbp', can_pay_services: true, disabled: false },
    ]});
    expect(await resolveKeysPaymentId(sb, f)).toBe('paypalych-sbp');
  });
  test('none eligible → null', async () => {
    const f = fakeFetch({ success: true, data: [{ value: 'a', can_pay_services: false, disabled: false }]});
    expect(await resolveKeysPaymentId(sb, f)).toBeNull();
  });
  test('http error → null', async () => {
    expect(await resolveKeysPaymentId(sb, fakeFetch(null, false))).toBeNull();
  });
  test('localStorage SWR: writes cache cold, serves warm', async () => {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    };
    let callCount = 0;
    const f = (async () => {
      callCount++;
      return { ok: true, json: async () => ({ success: true, data: [{ value: 'paypalych-sbp', can_pay_services: true, disabled: false }] }) };
    }) as any;
    expect(await resolveKeysPaymentId(sb, f)).toBe('paypalych-sbp');     // cold → fetch + write
    expect(store.get('sb:keysPaymentId')).toBe('paypalych-sbp');
    expect(await resolveKeysPaymentId(sb, f)).toBe('paypalych-sbp');     // warm → cache
    await Promise.resolve();                                             // let the background refresh promise settle
    expect(callCount).toBe(2);                                           // cold fetch + warm background refresh
    delete (globalThis as any).localStorage;                            // keep later tests deterministic
  });
});
