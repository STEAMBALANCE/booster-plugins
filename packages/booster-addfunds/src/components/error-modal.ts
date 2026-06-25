// Steam-styled error modal shown over the store page when a key purchase fails.
// Replaces the old inline error chip next to the «Купить» button: a centred
// overlay card carries the title, the actual failure message, and a Close button.
// Plain DOM, no Svelte. CSS injected once via <style id="booster-error-modal-style">.
import { LL } from '../i18n';
import { CLOSE_SVG } from '../lib/icons';
import ERROR_MODAL_CSS_RAW from './error-modal.css' with { type: 'text' };

declare const __SB_ERROR_MODAL_CSS__: string | undefined;
const ERROR_MODAL_CSS =
  typeof __SB_ERROR_MODAL_CSS__ !== 'undefined' ? __SB_ERROR_MODAL_CSS__ : ERROR_MODAL_CSS_RAW;

function ensureErrorModalStyles(): void {
  if (document.getElementById('booster-error-modal-style')) return;
  const s = document.createElement('style');
  s.id = 'booster-error-modal-style';
  s.textContent = ERROR_MODAL_CSS;
  document.head.appendChild(s);
}

// Teardown of the modal currently on screen. Tracked at module scope so the
// single-instance replace path can fully unwind the prior instance (its
// document-level keydown listener included), not just detach the overlay node.
let activeClose: (() => void) | null = null;

/**
 * Mounts a fixed overlay showing `message` as the failure detail. Dismissed via
 * the Close button, the corner ×, Esc, or a backdrop click. Self-removes on
 * dismiss. A second call replaces any modal already open (single instance).
 */
export function openErrorModal(message: string): void {
  ensureErrorModalStyles();

  // Single instance — a new error supersedes a stale one, fully tearing it down.
  activeClose?.();

  const overlay = document.createElement('div');
  overlay.id = 'booster-error-modal-overlay';

  const card = document.createElement('div');
  card.className = 'booster-error-card';
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'booster-error-title');
  card.setAttribute('aria-describedby', 'booster-error-body');

  const closeX = document.createElement('button');
  closeX.type = 'button';
  closeX.className = 'booster-error-close-x';
  closeX.setAttribute('aria-label', LL.addfunds.keys_error_modal_close());
  closeX.innerHTML = CLOSE_SVG;
  card.appendChild(closeX);

  const title = document.createElement('h2');
  title.id = 'booster-error-title';
  title.className = 'booster-error-title';
  title.textContent = LL.addfunds.keys_error_modal_title();
  card.appendChild(title);

  const body = document.createElement('p');
  body.id = 'booster-error-body';
  body.className = 'booster-error-body';
  // Backend messages may carry \r\n; normalize so pre-wrap renders evenly.
  body.textContent = message.replace(/\r\n/g, '\n');
  card.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'booster-error-actions';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'booster-error-close-btn';
  closeBtn.textContent = LL.addfunds.keys_error_modal_close();
  actions.appendChild(closeBtn);

  card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  closeBtn.focus();

  function close(): void {
    if (activeClose === close) activeClose = null;
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
  }
  activeClose = close;

  function onKeyDown(e: Event): void {
    if ((e as KeyboardEvent).key === 'Escape') close();
  }

  document.addEventListener('keydown', onKeyDown);
  closeX.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  // Backdrop click: only when the overlay itself (not the card) is clicked.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
}
