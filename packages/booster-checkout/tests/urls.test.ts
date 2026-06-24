import { test, expect } from 'bun:test';
import { URLS } from '../src/urls';

test('URLS.faq is the https FAQ page (openWindow requires https)', () => {
  expect(URLS.faq).toBe('https://steambalance.cc/booster/faq');
  expect(URLS.faq.startsWith('https://')).toBe(true);
});
