import { describe, test, expect } from 'bun:test';
import { parseAmount } from '../src/lib/amount';

describe('parseAmount', () => {
  test.each([
    ['19 031,00₸', 19031],
    ['1 234,00₽', 1234],
    ['1 234,00 руб.', 1234],
    ['$15.00', 15],
    ['1,599', 1599],
    ['1.599,00 €', 1599],
    ['1,2345', 12345],
    ['7 600,00₸', 7600],
  ])('parses %p → %p', (input, expected) => {
    expect(parseAmount(input as string)).toBe(expected);
  });
  test.each(['', '   ', 'abc', '₽'])('garbage %p → null', (input) => {
    expect(parseAmount(input)).toBeNull();
  });
});
