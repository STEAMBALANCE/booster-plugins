import { describe, test, expect } from 'bun:test';
import { LL } from '../src/i18n';

describe('addfunds namespace strings', () => {
  test('LL.addfunds.row_label', () => {
    expect(LL.addfunds.row_label()).toBe('Пополнение баланса');
  });
  test('LL.addfunds.submit_button', () => {
    expect(LL.addfunds.submit_button()).toBe('Пополнить');
  });
  test('LL.addfunds.row_aria_label', () => {
    expect(LL.addfunds.row_aria_label()).toBe('Пополнить баланс через SteamBalance');
  });
});

test('new addfunds strings resolve', () => {
  expect(LL.addfunds.cart_heading()).toBe('Вам не хватает баланса');
  expect(LL.addfunds.keys_block_title()).toBe('У нас имеются ключи для игры в вашем регионе!');
  expect(LL.addfunds.keys_buy_button()).toBe('Купить');
  expect(LL.addfunds.keys_row_label({ gameName: 'X' })).toBe('Купить X');
  expect(LL.addfunds.keys_block_aria_label()).toBe('Доступные ключи для покупки в вашем регионе');
  expect(LL.addfunds.edition_offer_aria_label()).toBe('Предложение SteamBalance — купить дешевле');
});

test('key-purchase window titles resolve', () => {
  expect(LL.addfunds.keys_purchase_window_taskbar_title()).toBe('Покупка ключа');
  expect(LL.addfunds.keys_purchase_window_title({ gameName: 'Game X' })).toBe('Покупка ключа — «Game X»');
});

test('error-modal strings resolve', () => {
  expect(LL.addfunds.keys_error_modal_title()).toBe('Упс!');
  expect(LL.addfunds.keys_error_modal_close()).toBe('Закрыть');
});
