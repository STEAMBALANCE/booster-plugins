import { test, expect } from 'bun:test';
import { wireOrdersEmbed } from '../src/main/orders-embed';

function fakeHandle() {
  let cb: ((d?: unknown) => void) | null = null;
  const sent: unknown[] = [];
  return {
    on(_e: 'message', fn: (d?: unknown) => void) { cb = fn; return () => { cb = null; }; },
    postMessage(d: unknown) { sent.push(d); },
    _fire(d: unknown) { cb && cb(d); },
    _sent: sent,
  };
}

test('sends embed-payload on sb:ready', () => {
  const h = fakeHandle();
  wireOrdersEmbed(h as any, { source: 'booster-checkout' });
  h._fire({ __sbEmbed: true, v: 1, type: 'sb:ready' });
  expect(h._sent).toEqual([{ __sbEmbed: true, v: 1, type: 'sb:embed-payload', source: 'booster-checkout' }]);
});

test('ignores non-ready / foreign messages', () => {
  const h = fakeHandle();
  wireOrdersEmbed(h as any, { source: 'booster-checkout' });
  h._fire({ type: 'other' });
  h._fire({ __sbEmbed: true, type: 'sb:event', name: 'x' });
  h._fire(null);
  expect(h._sent).toEqual([]);
});
