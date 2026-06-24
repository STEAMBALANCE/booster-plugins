// AUTO-GENERATED from strings/ru.json — DO NOT EDIT.
// Contents: checkout.* and general.* subsets only.

import type { BaseTranslation } from 'typesafe-i18n';

const ru = {
  checkout: {
    amount: {
      placeholder: 'Введите сумму',
    },
    error_screen: {
      retry: 'Обновить',
      subtitle: 'Попробуйте позже',
      title: 'Не удалось загрузить методы оплаты',
    },
    footer: {
      secure_note: 'Безопасно и конфиденциально',
    },
    header: {
      menu_button: 'МЕНЮ',
    },
    info_row: {
      login: 'Логин:',
      receive: 'Получите:',
      total_will_be: 'Итого на балансе будет',
    },
    menu: {
      my_orders: 'МОИ ЗАКАЗЫ',
      settings: 'НАСТРОЙКИ',
      support: 'ПОДДЕРЖКА',
    },
    pay_button: {
      calc_error: 'Ошибка расчёта',
      calculating: 'Расчёт...',
      default: 'Оплатить',
      desired_too_low: 'Желаемый баланс ниже текущего',
      network_error: 'Ошибка сети',
      ready: 'Оплатить {amount:string} ₽',
      submitting: 'Загрузка...',
    },
    pay_error: {
      close_aria: 'Закрыть',
      faq: 'FAQ',
      generic: 'Не удалось обработать запрос. Попробуйте позже или обратитесь в поддержку.',
      support: 'Написать в поддержку',
      title: 'Упс!',
    },
    payment_methods_error_toast: 'Не удалось загрузить методы оплаты',
    popup: {
      button_label: 'Пополнить',
      button_tooltip: 'Пополнить баланс Steam',
      faq_window_title: 'SteamBooster FAQ',
      orders_window_title: 'Мои заказы — SteamBalance',
      support_window_title: 'Поддержка SteamBalance',
      window_title: 'Пополнение аккаунта {login:string}',
      window_title_no_login: 'Пополнение аккаунта',
    },
    total_input: {
      placeholder: 'Желаемый баланс',
    },
  },
  general: {
    product_display_name: 'SteamBooster',
  },
} as const satisfies BaseTranslation;

export default ru;
export type CheckoutTranslation = typeof ru;
