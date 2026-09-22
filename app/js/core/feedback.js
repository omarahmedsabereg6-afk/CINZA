/**
 * User feedback primitives: toasts, bottom sheets, confirmations and haptics.
 *
 * These are the only places that create overlay UI, so dismissal, focus handling
 * and accessibility behave consistently everywhere.
 */
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { el, clear, icon, on } from './dom.js';
import { announce } from './dom.js';
import config from '../config.js';

/* ------------------------------------------------------------------ *
 * Haptics — silently unavailable on the web, never a hard dependency
 * ------------------------------------------------------------------ */
export async function hapticImpact(style = 'light') {
  if (!config.hapticsEnabled) return;
  try {
    const map = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };
    await Haptics.impact({ style: map[style] ?? ImpactStyle.Light });
  } catch {
    /* web, or the device has no vibrator */
  }
}

export async function hapticNotify(type = 'success') {
  if (!config.hapticsEnabled) return;
  try {
    const map = { success: NotificationType.Success, warning: NotificationType.Warning, error: NotificationType.Error };
    await Haptics.notification({ type: map[type] ?? NotificationType.Success });
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * Toast
 * ------------------------------------------------------------------ */
const TOAST_MS = { info: 2600, success: 2400, warn: 4200, error: 5200 };

export function toast(message, { variant = 'info', action, duration } = {}) {
  const region = document.getElementById('toast-region');
  if (!region) return () => {};

  const node = el('div', { class: `banner banner--${variant === 'error' ? 'error' : variant}` });
  node.style.boxShadow = 'var(--e-3)';
  node.style.background = 'var(--c-bg-elev)';
  node.style.borderColor = 'var(--c-line-strong)';
  node.style.animation = 'rise-in var(--dur-base) var(--ease-out)';

  const iconName = { info: 'i-info', success: 'i-eye', warn: 'i-warning', error: 'i-warning' }[variant] ?? 'i-info';
  node.append(icon(iconName));

  const body = el('div', { style: { flex: '1 1 auto', minWidth: '0' } }, [
    el('span', { text: String(message ?? '') }),
  ]);
  node.append(body);

  let timer = null;
  const dismiss = () => {
    if (timer) clearTimeout(timer);
    node.style.animation = 'fade-out var(--dur-fast) var(--ease-out) forwards';
    setTimeout(() => node.remove(), 140);
  };

  if (action?.label) {
    const button = el('button', { class: 'btn btn--sm btn--secondary', type: 'button', text: action.label });
    on(button, 'click', () => {
      dismiss();
      action.onClick?.();
    });
    node.append(button);
  }

  region.append(node);
  // Errors persist longer and are also announced for screen readers.
  if (variant === 'error' || variant === 'warn') announce(String(message ?? ''));
  timer = setTimeout(dismiss, duration ?? TOAST_MS[variant] ?? TOAST_MS.info);

  // Cap the stack so a burst cannot cover the screen.
  while (region.children.length > 3) region.firstElementChild?.remove();

  return dismiss;
}

export const toastError = (error) => toast(error?.text ?? error?.message ?? 'Something went wrong', { variant: 'error' });
export const toastSuccess = (message, options) => toast(message, { variant: 'success', ...options });

/* ------------------------------------------------------------------ *
 * Bottom sheet
 * ------------------------------------------------------------------ */
export function openSheet({ title, content, actions = [], onClose } = {}) {
  const overlayRoot = document.getElementById('overlay-root');
  const scrim = el('div', { class: 'scrim' });
  const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });

  sheet.append(el('div', { class: 'sheet__grabber' }));

  if (title) {
    sheet.append(el('div', { class: 'sheet__header' }, [el('p', { class: 'sheet__title', text: title })]));
  }

  const body = el('div', { class: 'sheet__body' });
  if (typeof content === 'string') body.append(el('p', { class: 't-body', text: content }));
  else if (content instanceof Node) body.append(content);
  else if (Array.isArray(content)) body.append(...content);
  sheet.append(body);

  if (actions.length > 0) {
    const row = el('div', {
      class: 'sheet__body',
      style: { display: 'grid', gap: '8px', paddingTop: '0' },
    });
    for (const action of actions) {
      const button = el('button', {
        class: `btn ${action.variant ? `btn--${action.variant}` : 'btn--secondary'} btn--block`,
        type: 'button',
        text: action.label,
      });
      on(button, 'click', () => {
        close();
        action.onClick?.();
      });
      row.append(button);
    }
    sheet.append(row);
  }

  overlayRoot.append(scrim, sheet);

  const previouslyFocused = document.activeElement;
  const focusable = sheet.querySelector('button, [href], input, select, textarea');
  setTimeout(() => focusable?.focus(), 40);

  function close() {
    scrim.style.animation = 'fade-out var(--dur-fast) var(--ease-out) forwards';
    sheet.style.animation = 'sheet-out var(--dur-base) var(--ease-out) forwards';
    setTimeout(() => {
      scrim.remove();
      sheet.remove();
      previouslyFocused?.focus?.();
      onClose?.();
    }, 190);
  }

  on(scrim, 'click', close);
  const onKey = (event) => {
    if (event.key === 'Escape') {
      document.removeEventListener('keydown', onKey);
      close();
    }
  };
  document.addEventListener('keydown', onKey);

  return { close, element: sheet };
}

/* ------------------------------------------------------------------ *
 * Confirmation
 * ------------------------------------------------------------------ */
export function confirm({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    openSheet({
      title,
      content: message,
      onClose: () => finish(false),
      actions: [
        {
          label: confirmLabel,
          variant: destructive ? 'danger' : 'primary',
          onClick: () => finish(true),
        },
        { label: cancelLabel, variant: 'ghost', onClick: () => finish(false) },
      ],
    });
  });
}

/* ------------------------------------------------------------------ *
 * Action list sheet (used by "More options" and row long-press)
 * ------------------------------------------------------------------ */
export function actionSheet({ title, actions }) {
  return new Promise((resolve) => {
    openSheet({
      title,
      onClose: () => resolve(null),
      content: actions.map((action) => {
        const row = el('button', {
          class: `list-row${action.destructive ? ' list-row--danger' : ''}`,
          type: 'button',
          style: { width: '100%', borderRadius: '12px' },
        });
        row.append(
          el('span', { class: 'list-row__icon' }, [icon(action.icon ?? 'i-info')]),
          el('span', { class: 'list-row__text' }, [el('span', { class: 'list-row__title', text: action.label })]),
          el('span', { class: 'list-row__chevron' }, [icon('i-chevron-right')])
        );
        on(row, 'click', () => {
          // Dismiss the sheet first so the next UI is not behind it.
          document.querySelector('.scrim')?.click();
          setTimeout(() => resolve(action.value ?? action.label), 200);
        });
        return row;
      }),
    });
  });
}

export default {
  toast,
  toastError,
  toastSuccess,
  openSheet,
  confirm,
  actionSheet,
  hapticImpact,
  hapticNotify,
};
