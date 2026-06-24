// Universal "Пополнялка" bar. Plain DOM (store target has no Svelte). CSS
// scoped via #booster-topup-bar. Ported from the original buildRow; adds a
// configurable heading, optional prefilled amount (vs placeholder), and
// setHeading/setAmount/setCurrency for the reactive cart usage.
import { LL } from '../i18n';
import SB_TOPUP_CSS_RAW from './topup-bar.css' with { type: 'text' };

declare const __SB_TOPUP_CSS__: string | undefined;
const SB_TOPUP_CSS = typeof __SB_TOPUP_CSS__ !== 'undefined' ? __SB_TOPUP_CSS__ : SB_TOPUP_CSS_RAW;

export interface TopupBarOptions {
  heading: string;
  amount?: number;          // present → prefill input; absent → placeholder mode
  placeholder?: string;
  currencySymbol: string;
  logoUrl: string;
  // Accessible name for the bar container. Defaults to `heading`; addfunds
  // passes a distinct label so the container reads the same as the original.
  ariaLabel?: string;
  onSubmit: (amount: number) => void;
}
export interface TopupBar {
  root: HTMLElement;
  input: HTMLInputElement;
  symbol: HTMLSpanElement;
  submit: HTMLButtonElement;
  setHeading(s: string): void;
  setAmount(n: number | null): void;
  setCurrency(symbol: string, placeholder: string): void;
}

export function ensureTopupStyles(): void {
  if (document.getElementById('booster-topup-style')) return;
  const s = document.createElement('style');
  s.id = 'booster-topup-style';
  s.textContent = SB_TOPUP_CSS;
  document.head.appendChild(s);
}

export function buildTopupBar(opts: TopupBarOptions): TopupBar {
  const root = document.createElement('div');
  root.id = 'booster-topup-bar';
  root.setAttribute('data-sb', '1');
  root.setAttribute('aria-label', opts.ariaLabel ?? opts.heading);

  const inner = document.createElement('div');
  inner.className = 'booster-topup-inner';

  const left = document.createElement('div');
  left.className = 'booster-topup-left';
  const logo = document.createElement('img');
  logo.src = opts.logoUrl;
  logo.alt = 'SteamBalance';
  logo.className = 'booster-topup-logo';
  const label = document.createElement('span');
  label.className = 'booster-topup-label';
  label.textContent = opts.heading;
  left.appendChild(logo);
  left.appendChild(label);

  const right = document.createElement('div');
  right.className = 'booster-topup-right';

  const inputWrap = document.createElement('div');
  inputWrap.className = 'booster-topup-input-wrap';
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.placeholder = opts.placeholder ?? '';
  if (opts.amount != null && opts.amount > 0) input.value = String(opts.amount);
  input.className = 'booster-topup-input';
  input.maxLength = 12;
  input.setAttribute('aria-label', opts.heading);
  input.addEventListener('input', () => {
    const v = input.value.replace(/[^\d]/g, '');
    if (v !== input.value) input.value = v;
  });
  const symbol = document.createElement('span');
  symbol.className = 'booster-topup-symbol';
  symbol.textContent = opts.currencySymbol;
  inputWrap.appendChild(input);
  inputWrap.appendChild(symbol);

  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'booster-topup-submit';
  submit.textContent = LL.addfunds.submit_button();

  function fireSubmit(): void {
    const raw = input.value.trim();
    const fromInput = raw ? parseInt(raw, 10) : 0;
    if (Number.isFinite(fromInput) && fromInput > 0) { opts.onSubmit(fromInput); return; }
    const ph = input.placeholder ? parseInt(input.placeholder, 10) : 0;
    if (Number.isFinite(ph) && ph > 0) { opts.onSubmit(ph); return; }
  }
  submit.addEventListener('click', fireSubmit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); fireSubmit(); }
  });

  right.appendChild(inputWrap);
  right.appendChild(submit);
  inner.appendChild(left);
  inner.appendChild(right);
  root.appendChild(inner);

  return {
    root, input, symbol, submit,
    setHeading: (s) => { label.textContent = s; root.setAttribute('aria-label', s); input.setAttribute('aria-label', s); },
    setAmount: (n) => { input.value = n != null && n > 0 ? String(n) : ''; },
    setCurrency: (sym, ph) => { symbol.textContent = sym; input.placeholder = ph; },
  };
}
