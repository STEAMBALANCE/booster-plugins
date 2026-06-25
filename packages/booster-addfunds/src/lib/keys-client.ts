import type { SbApi } from '@steambalance/booster-framework/api-types';
import type { KeyItem } from './keys-api';

let nonceCounter = 0;
function makeNonce(): string {
  // Session-unique enough to disambiguate multiple store tabs on the broadcast bus.
  return `${Date.now().toString(36)}-${(nonceCounter++).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function createKeysClient(sb: SbApi, opts: { timeoutMs?: number; retryMs?: number; purchaseTimeoutMs?: number } = {}) {
  const timeoutMs = opts.timeoutMs ?? 6000;
  const retryMs = opts.retryMs ?? 1000;
  // Покупка ключа требует более длительного таймаута: сервер могёт медленнее отвечать на POST,
  // и окно оплаты открывается асинхронно. Если таймаут истечёт слишком рано, пользователь
  // увидит ошибку retry, что может привести к двойному заказу. 30s — достаточно для открытия окна.
  const purchaseTimeoutMs = opts.purchaseTimeoutMs ?? 30000;
  const nonce = makeNonce();
  let counter = 0;
  const nextId = (): string => `${nonce}:${++counter}`;

  let activeListReqId: string | null = null;
  const listWaiters = new Map<string, (items: KeyItem[]) => void>();
  const purchaseWaiters = new Map<string, (r: { status: 'ok' | 'email-required' | 'error'; error?: string; message?: string }) => void>();
  const onReady: Array<() => void> = [];

  const subs: Array<() => void> = [];
  subs.push(sb.bus.subscribe('booster-checkout.keys.response', (data) => {
    const d = data as { reqId?: string; items?: unknown };
    if (!d || typeof d.reqId !== 'string' || d.reqId !== activeListReqId) return;
    const w = listWaiters.get(d.reqId);
    if (w) { listWaiters.delete(d.reqId); w(Array.isArray(d.items) ? d.items as KeyItem[] : []); }
  }));
  subs.push(sb.bus.subscribe('booster-checkout.keys.email-required', (data) => {
    const d = data as { reqId?: string };
    const w = d && typeof d.reqId === 'string' ? purchaseWaiters.get(d.reqId) : undefined;
    if (w && d) { purchaseWaiters.delete(d.reqId!); w({ status: 'email-required' }); }
  }));
  subs.push(sb.bus.subscribe('booster-checkout.keys.purchase-result', (data) => {
    const d = data as { reqId?: string; ok?: boolean; error?: string; message?: string };
    const w = d && typeof d.reqId === 'string' ? purchaseWaiters.get(d.reqId) : undefined;
    if (w && d) { purchaseWaiters.delete(d.reqId!); w(d.ok ? { status: 'ok' } : { status: 'error', error: d.error, message: d.message }); }
  }));
  subs.push(sb.bus.subscribe('booster-checkout.keys.ready', () => { for (const cb of onReady.splice(0)) cb(); }));

  function requestKeys(appid: number, signal: AbortSignal): Promise<KeyItem[]> {
    const reqId = nextId();
    activeListReqId = reqId;
    return new Promise<KeyItem[]>((resolve) => {
      let done = false;
      const finish = (items: KeyItem[]): void => { if (done) return; done = true; clearInterval(iv); clearTimeout(to); listWaiters.delete(reqId); resolve(items); };
      listWaiters.set(reqId, finish);
      const send = (): void => { if (!done) sb.bus.publish('booster-addfunds.keys.request', { reqId, appid }); };
      onReady.push(send);
      send();
      const iv = setInterval(send, retryMs);
      const to = setTimeout(() => finish([]), timeoutMs);
      signal.addEventListener('abort', () => finish([]), { once: true });
    });
  }

  // `titles` carry the payment-window heading (React TitleBar) + taskbar caption.
  // checkout opens the window but only addfunds knows the game name, so both
  // strings ride the bus to the main-shell opener.
  function purchaseKey(
    itemId: number,
    email?: string,
    titles?: { title: string; taskbarTitle: string },
  ): Promise<{ status: 'ok' | 'email-required' | 'error'; error?: string; message?: string }> {
    const reqId = nextId();
    return new Promise((resolve) => {
      let done = false;
      const finish = (r: { status: 'ok' | 'email-required' | 'error'; error?: string; message?: string }): void => { if (done) return; done = true; clearTimeout(to); purchaseWaiters.delete(reqId); resolve(r); };
      purchaseWaiters.set(reqId, finish);
      sb.bus.publish('booster-addfunds.keys.purchase', {
        reqId, itemId,
        ...(email ? { email } : {}),
        ...(titles ? { windowTitle: titles.title, windowTaskbarTitle: titles.taskbarTitle } : {}),
      });
      const to = setTimeout(() => finish({ status: 'error', error: 'timeout' }), purchaseTimeoutMs);
    });
  }

  return { requestKeys, purchaseKey, dispose: () => { for (const u of subs) u(); } };
}
