import { test, expect } from 'bun:test';
import { URLS } from '../src/urls';

test('URLS.faq is the https FAQ page (openWindow requires https)', () => {
  expect(URLS.faq).toBe('https://steambalance.cc/booster/faq');
  expect(URLS.faq.startsWith('https://')).toBe(true);
});

test('URLS.terms / privacy are the https doc pages', () => {
  expect(URLS.terms).toBe('https://steambalance.cc/booster/terms');
  expect(URLS.privacy).toBe('https://steambalance.cc/booster/privacy');
  expect(URLS.terms.startsWith('https://')).toBe(true);
  expect(URLS.privacy.startsWith('https://')).toBe(true);
});

test('URLS.telegram is the brand telegram channel link', () => {
  expect(URLS.telegram).toBe('https://steambalance.cc/c/0eb9');
  expect(URLS.telegram.startsWith('https://')).toBe(true);
});
