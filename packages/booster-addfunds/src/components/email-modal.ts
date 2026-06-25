// Steam-styled email entry modal for key delivery. Shown when a key purchase
// needs a delivery email and the Steam account email is unavailable.
// Plain DOM, no Svelte. CSS injected once via <style id="booster-email-modal-style">.
import { LL } from '../i18n';
import EMAIL_MODAL_CSS_RAW from './email-modal.css' with { type: 'text' };

declare const __SB_EMAIL_MODAL_CSS__: string | undefined;
const EMAIL_MODAL_CSS =
  typeof __SB_EMAIL_MODAL_CSS__ !== 'undefined' ? __SB_EMAIL_MODAL_CSS__ : EMAIL_MODAL_CSS_RAW;

function ensureEmailModalStyles(): void {
  if (document.getElementById('booster-email-modal-style')) return;
  const s = document.createElement('style');
  s.id = 'booster-email-modal-style';
  s.textContent = EMAIL_MODAL_CSS;
  document.head.appendChild(s);
}

/** Basic email validity check — /^[^\s@]+@[^\s@]+\.[^\s@]+$/. */
export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * Mounts a fixed overlay with an email input.
 * Resolves the entered valid email on confirm, or null on cancel / Esc / backdrop click.
 * Self-removes on resolve.
 */
export function openEmailModal(): Promise<string | null> {
  ensureEmailModalStyles();

  return new Promise<string | null>((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'booster-email-modal-overlay';

    const card = document.createElement('div');
    card.className = 'booster-email-card';

    const title = document.createElement('h2');
    title.className = 'booster-email-title';
    title.textContent = LL.addfunds.keys_email_modal_title();
    card.appendChild(title);

    const hint = document.createElement('p');
    hint.className = 'booster-email-hint';
    hint.textContent = LL.addfunds.keys_email_modal_hint();
    card.appendChild(hint);

    const input = document.createElement('input');
    input.type = 'email';
    input.className = 'booster-email-input';
    input.placeholder = LL.addfunds.keys_email_modal_placeholder();
    card.appendChild(input);

    const error = document.createElement('p');
    error.className = 'booster-email-error';
    card.appendChild(error);

    const actions = document.createElement('div');
    actions.className = 'booster-email-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'booster-email-cancel';
    cancelBtn.textContent = LL.addfunds.keys_email_modal_cancel();
    actions.appendChild(cancelBtn);

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'booster-email-confirm';
    confirmBtn.textContent = LL.addfunds.keys_email_modal_confirm();
    actions.appendChild(confirmBtn);

    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Focus the input so the user can type immediately.
    input.focus();

    function close(result: string | null): void {
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      resolve(result);
    }

    function onKeyDown(e: Event): void {
      if ((e as KeyboardEvent).key === 'Escape') close(null);
    }

    document.addEventListener('keydown', onKeyDown);

    cancelBtn.addEventListener('click', () => close(null));

    // Backdrop click: only fires when clicking the overlay itself, not the card.
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });

    confirmBtn.addEventListener('click', () => {
      const val = input.value.trim();
      if (!isValidEmail(val)) {
        error.textContent = LL.addfunds.keys_email_modal_invalid();
        return;
      }
      close(val);
    });
  });
}
