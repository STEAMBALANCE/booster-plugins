interface EmbedHandle {
  on(event: 'message', cb: (d?: unknown) => void): () => void;
  postMessage(data: unknown): void;
}

/** Подписать orders-окно на embed-рукопожатие: на `sb:ready` от страницы
 *  ответить enrichment-пейлоадом. Отправка только после рукопожатия —
 *  до него у страницы ещё нет listener'а. Возвращает unsubscribe. */
export function wireOrdersEmbed(handle: EmbedHandle, payload: Record<string, unknown>): () => void {
  return handle.on('message', (d) => {
    const m = d as Record<string, unknown> | null;
    if (!m || m.__sbEmbed !== true || m.type !== 'sb:ready') return;
    handle.postMessage({ ...payload, __sbEmbed: true, v: 1 /* embed protocol ver, см. SB_EMBED_V в booster-framework/protocol.ts */, type: 'sb:embed-payload' });
  });
}
