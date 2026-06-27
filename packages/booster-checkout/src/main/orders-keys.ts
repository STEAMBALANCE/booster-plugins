import type { ActivateOutcome } from '@steambalance/booster-framework/api-types';

// Минимальный структурный вид handle'а sb.ui.openWindow, который мы используем
// (зеркало приватного EmbedHandle из orders-embed.ts — держим локально, чтобы
// не создавать связности; handle.on поддерживает несколько независимых
// listener'ов, поэтому рукопожатие в wireOrdersEmbed нас не касается).
interface EmbedHandle {
  on(event: 'message', cb: (d?: unknown) => void): () => void;
  postMessage(data: unknown): void;
}

export interface OrdersKeyActivationDeps {
  /** Активация ключа фреймворком — sb.keys.activate (Capability.Keys). */
  activate(key: string): Promise<ActivateOutcome>;
}

// Зеркало WINDOW_MESSAGE_MAX_BYTES из booster-framework/src/relay/protocol.ts
// (не реэкспортится из entry пакета, поэтому синхронизируем вручную — тот же
// приём, что TITLE_MIN/MAX в keys-install.ts). Framework МОЛЧА дропает
// postMessage сверх лимита (ui.ts) — дропнутый success-ответ повесил бы Promise
// страницы, поэтому пред-проверяем размер и шлём компактный {error}.
const RESPONSE_MAX_BYTES = 16 * 1024;

const REQUEST_NAME = 'activate-key';
const RESULT_NAME = 'activate-key-result';
const KEY_MAX = 256;

function result(requestId: number, data: Record<string, unknown>): Record<string, unknown> {
  return { __sbEmbed: true, v: 1, type: 'sb:event', name: RESULT_NAME, data: { requestId, ...data } };
}

function byteLength(v: unknown): number {
  return new TextEncoder().encode(JSON.stringify(v)).length;
}

/** Подключить embed-шину окна заказов к активации ключей фреймворком. Страница
 *  шлёт {type:'sb:event', name:'activate-key', data:{requestId, key}}; мы зовём
 *  deps.activate и отвечаем name:'activate-key-result' с {requestId, outcome}
 *  (пайплайн отработал — бизнес-успех ИЛИ отказ внутри outcome.ok) либо
 *  {requestId, error} (валидация/транспорт/oversize → страница reject'ит).
 *  Возвращает unsubscribe. */
export function wireOrdersKeyActivation(handle: EmbedHandle, deps: OrdersKeyActivationDeps): () => void {
  return handle.on('message', (d) => {
    const m = d as { __sbEmbed?: unknown; type?: unknown; name?: unknown; data?: unknown } | null;
    if (!m || m.__sbEmbed !== true || m.type !== 'sb:event' || m.name !== REQUEST_NAME) return;
    const data = m.data as { requestId?: unknown; key?: unknown } | null;
    // Нет корреляции → некуда отвечать; тихо игнорируем.
    if (!data || typeof data.requestId !== 'number' || !Number.isFinite(data.requestId)) return;
    const requestId = data.requestId;
    const key = data.key;
    if (typeof key !== 'string' || key.length < 1 || key.length > KEY_MAX) {
      handle.postMessage(result(requestId, { error: 'invalid product key' }));
      return;
    }
    void (async () => {
      try {
        const outcome = await deps.activate(key);
        const reply = result(requestId, { outcome });
        if (byteLength(reply) > RESPONSE_MAX_BYTES) {
          handle.postMessage(result(requestId, { error: 'activation response too large' }));
          return;
        }
        handle.postMessage(reply);
      } catch (e) {
        handle.postMessage(result(requestId, { error: e instanceof Error ? e.message : String(e) }));
      }
    })();
  });
}
