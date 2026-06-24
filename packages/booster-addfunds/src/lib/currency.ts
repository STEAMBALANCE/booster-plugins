// strings-allow-cyrillic: file — AZN currency-symbol glyph ('ман') mirrors Steam's
// localized wallet display; not translatable UI copy.

// 32-currency symbol map. Anything not in this table falls back to the raw ISO
// code (e.g. 'SAR', 'AED') so UI never shows blank text for a known wallet.
// `null` (currency-not-yet-known) → empty string so callers compose without
// conditional.
export const CURRENCY_SYM: Record<string, string> = {
  RUB:'₽', KZT:'₸', USD:'$', EUR:'€', GBP:'£', UAH:'₴', JPY:'¥', KRW:'₩',
  TRY:'₺', INR:'₹', BRL:'R$', PLN:'zł', CZK:'Kč', HUF:'Ft', RON:'lei',
  CHF:'CHF', NOK:'kr', AZN:'ман', ILS:'₪', SAR:'SAR', AED:'AED', ZAR:'R',
  CLP:'CLP$', COP:'COL$', MXN:'Mex$', ARS:'ARS$', PEN:'S/.', TWD:'NT$',
  HKD:'HK$', THB:'฿', IDR:'Rp', MYR:'RM', PHP:'₱',
};

export function currencySym(code: string | null): string {
  if (code === null) return '';
  return CURRENCY_SYM[code] ?? code;
}

// Per-currency default amount the popup pre-fills on open. Numbers are
// "natural" round values in the wallet currency — RUB → 1000 ₽, KZT →
// 7000 ₸, USD → 15 $. Other currencies are not supported by the calc
// backend today and fall back to 0 (empty input). Returning 0 lets
// callers seed `ui.amount` unconditionally.
export const DEFAULT_AMOUNT_BY_CURRENCY: Record<string, number> = {
  RUB: 1000,
  KZT: 7000,
  USD: 15,
};

export function defaultAmountForCurrency(code: string | null): number {
  if (code == null) return 0;
  return DEFAULT_AMOUNT_BY_CURRENCY[code] ?? 0;
}

// ru-RU groups thousands with nbsp (U+00A0) / narrow-nbsp (U+202F) / thin-space
// (U+2009) depending on the ICU build; normalize all three to a plain space so
// output is stable. Always emits "{number} {symbol}" with a space before the
// symbol (per the new-designs chips), regardless of how Steam formats the
// native price. Empty symbol → number only.
const RU_GROUP_SEP = /[\u00a0\u202f\u2009]/g;
export function fmtMoney(n: number, symbol: string): string {
  const num = n.toLocaleString('ru-RU').replace(RU_GROUP_SEP, ' ');
  return symbol ? `${num} ${symbol}` : num;
}
