import { test, expect, describe } from 'bun:test';
import {
  MAX_ORDER_UIDS, isValidUid, appendOrderUid, sanitizeStoredUids,
} from '../src/main/order-uids';

const UID = 'a5273b1e-87b4-435f-95ed-e85995b8951d';

describe('isValidUid', () => {
  test('accepts uuid', () => expect(isValidUid(UID)).toBe(true));
  test('rejects empty / non-string', () => {
    expect(isValidUid('')).toBe(false);
    expect(isValidUid(123)).toBe(false);
    expect(isValidUid(null)).toBe(false);
  });
  test('rejects CRLF and bad chars', () => {
    expect(isValidUid(`${UID}\r\n`)).toBe(false);
    expect(isValidUid('not a uid!')).toBe(false);
  });
  test('rejects dash-only (no hex digit)', () =>
    expect(isValidUid('--------')).toBe(false));
  test('rejects too long', () => expect(isValidUid('a'.repeat(65))).toBe(false));
});

describe('appendOrderUid', () => {
  test('appends new uid at end', () => {
    expect(appendOrderUid(['a1b2c3d4'], UID)).toEqual(['a1b2c3d4', UID]);
  });
  test('ignores invalid uid (returns copy)', () => {
    expect(appendOrderUid([UID], 'bad!')).toEqual([UID]);
  });
  test('dedups, moves existing to end', () => {
    expect(appendOrderUid(['11111111', UID, '22222222'], UID))
      .toEqual(['11111111', '22222222', UID]);
  });
  test('caps at MAX_ORDER_UIDS, drops oldest', () => {
    const list = Array.from({ length: MAX_ORDER_UIDS }, (_, i) =>
      String(i).padStart(8, '0'));
    const out = appendOrderUid(list, UID);
    expect(out.length).toBe(MAX_ORDER_UIDS);
    expect(out[out.length - 1]).toBe(UID);
    expect(out[0]).toBe('00000001'); // '00000000' dropped
  });
});

describe('sanitizeStoredUids', () => {
  test('non-array → []', () => expect(sanitizeStoredUids('x')).toEqual([]));
  test('filters invalid, caps last 20', () => {
    expect(sanitizeStoredUids([UID, 'bad!', 42])).toEqual([UID]);
  });
});
