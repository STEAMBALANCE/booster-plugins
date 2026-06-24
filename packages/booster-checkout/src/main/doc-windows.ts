// Документные модалки меню: terms / privacy / faq. Чистый helper — валидатор
// forged BC-значений (isDocKey) + контент-маппинг (url+title) + общие габариты.
// install.ts владеет window-id и самим sb.ui.openWindow-вызовом.
import { URLS } from '../urls';
import { LL } from '../i18n';

export const DOC_KEYS = ['terms', 'privacy', 'faq'] as const;
export type DocKey = (typeof DOC_KEYS)[number];

export function isDocKey(x: unknown): x is DocKey {
  return typeof x === 'string' && (DOC_KEYS as readonly string[]).includes(x);
}

// Совпадает с orders/faq окном (см. install.ts).
export const DOC_WINDOW_DIMS = {
  width: 720, height: 640, minWidth: 560, minHeight: 420,
} as const;

export function docWindowContent(doc: DocKey): { url: string; title: string } {
  switch (doc) {
    case 'terms':   return { url: URLS.terms,   title: LL.checkout.popup.terms_window_title() };
    case 'privacy': return { url: URLS.privacy, title: LL.checkout.popup.privacy_window_title() };
    case 'faq':     return { url: URLS.faq,     title: LL.checkout.popup.faq_window_title() };
  }
}
