// Локальное хранилище uid созданных заказов для stateless «Мои Заказы».
// Чистые функции — без I/O, тестируются изолированно. install.ts оборачивает
// их в ctx.configs read/write.
export const MAX_ORDER_UIDS = 20;

// uuid-подобный: hex + дефисы, 8..64 символа, минимум одна hex-цифра
// (отсекает строки из одних дефисов). Защита от инъекции в query при
// сборке ?uid[]=... (та же дисциплина, что у прежнего токена).
const UID_RE = /^(?=.*[0-9a-fA-F])[0-9a-fA-F-]{8,64}$/;

export function isValidUid(uid: unknown): uid is string {
  // CRLF-чек избыточен (класс [0-9a-fA-F-] и так исключает \r\n, $ без /m
  // не матчит перед встроенным переводом строки) — оставлен как явная
  // defense-in-depth, согласовано со спекой.
  return typeof uid === 'string' && UID_RE.test(uid) && !/[\r\n]/.test(uid);
}

// Добавить новый uid в конец, дедупнуть, ограничить последними 20.
// Невалидный uid игнорируется (возвращается копия исходного списка).
export function appendOrderUid(list: readonly string[], uid: string): string[] {
  if (!isValidUid(uid)) return [...list];
  const without = list.filter((x) => x !== uid);
  const next = [...without, uid];
  return next.length > MAX_ORDER_UIDS
    ? next.slice(next.length - MAX_ORDER_UIDS)
    : next;
}

// Привести прочитанное из конфига к валидному массиву (мусор → []).
export function sanitizeStoredUids(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidUid).slice(-MAX_ORDER_UIDS);
}
