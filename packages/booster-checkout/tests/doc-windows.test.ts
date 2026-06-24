import { test, expect } from 'bun:test';
import {
  DOC_KEYS, isDocKey, DOC_WINDOW_DIMS, docWindowContent,
} from '../src/main/doc-windows';
import { URLS } from '../src/urls';
import { LL } from '../src/i18n';

test('DOC_KEYS is terms/privacy/faq', () => {
  expect([...DOC_KEYS]).toEqual(['terms', 'privacy', 'faq']);
});

test('isDocKey accepts valid keys, rejects everything else', () => {
  for (const k of ['terms', 'privacy', 'faq']) expect(isDocKey(k)).toBe(true);
  for (const x of ['bogus', '', 'orders', 'FAQ', null, undefined, 1, {}]) {
    expect(isDocKey(x)).toBe(false);
  }
});

test('DOC_WINDOW_DIMS matches orders/faq window size', () => {
  expect(DOC_WINDOW_DIMS).toEqual({ width: 720, height: 640, minWidth: 560, minHeight: 420 });
});

test('docWindowContent maps each doc to its url + title', () => {
  expect(docWindowContent('terms')).toEqual({ url: URLS.terms, title: LL.checkout.popup.terms_window_title() });
  expect(docWindowContent('privacy')).toEqual({ url: URLS.privacy, title: LL.checkout.popup.privacy_window_title() });
  expect(docWindowContent('faq')).toEqual({ url: URLS.faq, title: LL.checkout.popup.faq_window_title() });
});
