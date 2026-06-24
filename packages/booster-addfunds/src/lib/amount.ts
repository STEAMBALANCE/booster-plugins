// Parse a localized money string into a plain number. Handles KZ/RU (space
// thousands, comma decimal: "19 031,00₸") and USD (dot decimal: "$15.00").
// \s already covers nbsp/narrow-nbsp/thin-space; the trailing-separator strip
// stops the "." in "руб." being read as a decimal point.
const WS = /[\s   ]/g;

export function parseAmount(input: string): number | null {
  const s = (input ?? '')
    .replace(WS, '')
    .replace(/[^0-9.,]/g, '')
    .replace(/^[.,]+|[.,]+$/g, '');
  if (!s) return null;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  let decimalSep: ',' | '.' | null = null;
  if (hasComma && hasDot) {
    decimalSep = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
  } else if (hasComma || hasDot) {
    const sep = hasComma ? ',' : '.';
    if (/^\d{1,2}$/.test(s.slice(s.lastIndexOf(sep) + 1))) decimalSep = sep;
  }
  let normalized: string;
  if (decimalSep) {
    const at = s.lastIndexOf(decimalSep);
    const intPart = s.slice(0, at).replace(/[.,]/g, '');
    const fracPart = s.slice(at + 1).replace(/[.,]/g, '');
    normalized = `${intPart}.${fracPart}`;
  } else {
    normalized = s.replace(/[.,]/g, '');
  }
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}
