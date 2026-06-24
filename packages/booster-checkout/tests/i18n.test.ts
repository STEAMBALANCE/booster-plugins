import { describe, test, expect } from 'bun:test';
import { LL } from '../src/i18n';

describe('checkout namespace strings', () => {
  test('exposes checkout.popup.button_label', () => {
    expect(LL.checkout.popup.button_label()).toBe('Пополнить');
  });

  test('interpolates checkout.popup.window_title with login param', () => {
    expect(LL.checkout.popup.window_title({ login: 'matrix' }))
      .toBe('Пополнение аккаунта matrix');
  });

  test('no-login window title fallback', () => {
    expect(LL.checkout.popup.window_title_no_login())
      .toBe('Пополнение аккаунта');
  });

  test('error toast is plain string', () => {
    expect(LL.checkout.payment_methods_error_toast())
      .toBe('Не удалось загрузить методы оплаты');
  });

  test('error screen title (separate key, same value as toast today)', () => {
    expect(LL.checkout.error_screen.title())
      .toBe('Не удалось загрузить методы оплаты');
  });

  test('pay-button ready interpolates amount', () => {
    expect(LL.checkout.pay_button.ready({ amount: '100.50' }))
      .toBe('Оплатить 100.50 ₽');
  });

  test('LL.checkout.menu.support returns "ПОДДЕРЖКА"', () => {
    expect(LL.checkout.menu.support()).toBe('ПОДДЕРЖКА');
  });

  test('pay_error strings resolve', () => {
    expect(LL.checkout.pay_error.title()).toBe('Упс!');                       // strings-allow-cyrillic
    expect(LL.checkout.pay_error.faq()).toBe('FAQ');
    expect(LL.checkout.pay_error.support()).toBe('Написать в поддержку');        // strings-allow-cyrillic
    expect(LL.checkout.pay_error.close_aria()).toBe('Закрыть');                  // strings-allow-cyrillic
    expect(LL.checkout.pay_error.generic().length).toBeGreaterThan(0);
    expect(LL.checkout.popup.faq_window_title()).toBe('SteamBooster FAQ');
  });
});
