import { test, expect } from 'bun:test';
import { fmtMoney, fmtMoneyKeys } from '../src/lib/currency';

test('groups thousands ru-RU and appends symbol with a space', () => {
  expect(fmtMoney(5168, '₸')).toBe('5 168 ₸');
  expect(fmtMoney(1599, '₽')).toBe('1 599 ₽');
});

test('no grouping under 1000', () => {
  expect(fmtMoney(670, '₸')).toBe('670 ₸');
});

test('empty symbol → number only (no trailing space)', () => {
  expect(fmtMoney(100, '')).toBe('100');
});

test('fmtMoneyKeys: 2 decimals for fractional, trims .00', () => {
  expect(fmtMoneyKeys(129.58)).toBe('129,58 ₽');
  expect(fmtMoneyKeys(169)).toBe('169 ₽');
  expect(fmtMoneyKeys(4611.95)).toBe('4 611,95 ₽');
});
