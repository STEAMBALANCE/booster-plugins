import { test, expect, beforeEach } from 'bun:test';
import { Window } from 'happy-dom';
import { buildTopupBar } from '../src/components/topup-bar';

let w: Window;
beforeEach(() => {
  w = new Window({ url: 'https://store.steampowered.com/app/1/' });
  (w as unknown as { SyntaxError: typeof SyntaxError }).SyntaxError = SyntaxError;
  Object.assign(globalThis, {
    window: w, document: w.document, Event: w.Event, KeyboardEvent: w.KeyboardEvent,
    HTMLElement: w.HTMLElement, HTMLInputElement: w.HTMLInputElement, HTMLButtonElement: w.HTMLButtonElement,
  });
});

test('placeholder mode + heading + currency', () => {
  const bar = buildTopupBar({ heading: 'Пополнение баланса', placeholder: '1000', currencySymbol: '₽', logoUrl: '', onSubmit: () => {} });
  expect(bar.root.id).toBe('booster-topup-bar');
  expect(bar.root.querySelector('.booster-topup-label')!.textContent).toBe('Пополнение баланса');
  expect(bar.input.placeholder).toBe('1000');
  expect(bar.input.value).toBe('');
  expect(bar.symbol.textContent).toBe('₽');
});

test('amount mode prefills the input', () => {
  const bar = buildTopupBar({ heading: 'Вам не хватает баланса', amount: 500, currencySymbol: '₸', logoUrl: '', onSubmit: () => {} });
  expect(bar.input.value).toBe('500');
});

test('submit uses input, falls back to placeholder; numeric filter; Enter', () => {
  const got: number[] = [];
  const bar = buildTopupBar({ heading: 'h', placeholder: '1000', currencySymbol: '₽', logoUrl: '', onSubmit: (a) => got.push(a) });
  bar.input.value = '12a3'; bar.input.dispatchEvent(new w.Event('input'));
  expect(bar.input.value).toBe('123');
  bar.submit.click();
  expect(got.at(-1)).toBe(123);
  bar.input.value = '';
  bar.submit.click();
  expect(got.at(-1)).toBe(1000);
});

test('container aria-label: defaults to heading, overridable', () => {
  const def = buildTopupBar({ heading: 'Пополнение баланса', currencySymbol: '₽', logoUrl: '', onSubmit: () => {} });
  expect(def.root.getAttribute('aria-label')).toBe('Пополнение баланса');
  expect(def.input.getAttribute('aria-label')).toBe('Пополнение баланса');
  const over = buildTopupBar({ heading: 'Пополнение баланса', ariaLabel: 'Пополнить баланс через SteamBalance', currencySymbol: '₽', logoUrl: '', onSubmit: () => {} });
  expect(over.root.getAttribute('aria-label')).toBe('Пополнить баланс через SteamBalance');
  expect(over.input.getAttribute('aria-label')).toBe('Пополнение баланса'); // input still reads heading
});

test('setters update DOM', () => {
  const bar = buildTopupBar({ heading: 'A', placeholder: '', currencySymbol: '', logoUrl: '', onSubmit: () => {} });
  bar.setHeading('B'); expect(bar.root.querySelector('.booster-topup-label')!.textContent).toBe('B');
  bar.setAmount(700); expect(bar.input.value).toBe('700');
  bar.setAmount(null); expect(bar.input.value).toBe('');
  bar.setCurrency('$', '15'); expect(bar.symbol.textContent).toBe('$'); expect(bar.input.placeholder).toBe('15');
});
