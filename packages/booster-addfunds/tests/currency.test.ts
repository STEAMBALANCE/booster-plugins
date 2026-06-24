import { test, expect } from 'bun:test';
import { fmtMoney } from '../src/lib/currency';

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
