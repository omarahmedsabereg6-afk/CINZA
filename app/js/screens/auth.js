/**
 * AUTH (section 22) — one screen, three modes: sign in, create account, reset.
 *
 * Notes:
 *  - anonymous use is offered up front via "Continue without an account", because
 *    requiring an account to identify a film would be hostile
 *  - the password reset flow is honest about what happens: when the server has no
 *    email provider configured it returns the link directly and says so, rather
 *    than showing "check your inbox" for an email that will never arrive
 *  - errors are rendered inline against the form, not as a toast that disappears
 */
import { el, qs, on, clear, icon } from '../core/dom.js';
import { router } from '../core/router.js';
import { store, actions } from '../core/store.js';
import { toast, hapticNotify } from '../core/feedback.js';
import * as auth from '../services/auth.js';
import * as settings from '../services/settings.js';
import { AppError, Failure } from '../core/errors.js';
import { banner } from '../ui/components.js';

const MODES = {
  login: {
    title: 'Welcome back',
    subtitle: 'Sign in to sync your history and watchlist across devices.',
    submit: 'Sign in',
    switchText: 'No account yet?',
    switchLabel: 'Create one',
  },
  register: {
    title: 'Create your account',
    subtitle: 'Your history and watchlist will follow you across devices.',
    submit: 'Create account',
    switchText: 'Already have an account?',
    switchLabel: 'Sign in',
  },
};

export default {
  title: null,
  tab: null,
  chrome: 'bare',

  async mount({ root }) {
    const form = qs('#auth-form', root);
    const titleNode = qs('#auth-title', root);
    const subtitleNode = qs('#auth-subtitle', root);
    const nameGroup = qs('#auth-name-group', root);
    const nameInput = qs('#auth-name', root);
    const emailInput = qs('#auth-email', root);
    const passwordGroup = qs('#auth-password-group', root);
    const passwordInput = qs('#auth-password', root);
    const passwordHint = qs('#auth-password-hint', root);
    const errorSlot = qs('#auth-error', root);
    const submitButton = qs('#auth-submit', root);
    const submitLabel = qs('#auth-submit-label', root);
    const forgotButton = qs('#auth-forgot', root);
    const switchButton = qs('#auth-switch', root);
    const switchText = qs('#auth-switch-text', root);
    const devSlot = qs('#auth-reset-dev', root);

    let mode = 'login';
    let busy = false;

    /* If we arrived with a reset token, go straight to the reset form. */
    const resetToken = new URLSearchParams((window.location.hash.split('?')[1] ?? '')).get('token');

    function paint() {
      clear(errorSlot);
      const config = MODES[mode] ?? MODES.login;

      titleNode.textContent = resetToken ? 'Choose a new password' : config.title;
      subtitleNode.textContent = resetToken
        ? 'Set a new password for your account. All other sessions will be signed out.'
        : config.subtitle;

      nameGroup.hidden = mode !== 'register' || Boolean(resetToken);
      passwordHint.hidden = mode !== 'register' && !resetToken;
      forgotButton.hidden = mode !== 'login' || Boolean(resetToken);
      switchButton.parentElement.hidden = Boolean(resetToken);

      submitLabel.textContent = resetToken ? 'Set new password' : config.submit;
      passwordInput.autocomplete = mode === 'register' || resetToken ? 'new-password' : 'current-password';

      if (!resetToken) {
        switchText.textContent = config.switchText;
        switchButton.textContent = config.switchLabel;
      }
    }

    function showError(error) {
      clear(errorSlot);
      const appError = error instanceof AppError ? error : new AppError(Failure.UNKNOWN, { cause: error });

      const node = el('div', { class: 'banner banner--error', role: 'alert' });
      node.append(icon('i-warning'));
      const body = el('div');
      body.append(el('strong', { class: 'banner__title', text: appError.title }));
      body.append(el('span', { text: appError.text }));
      node.append(body);

      if (appError.details?.field || Array.isArray(appError.details)) {
        const details = Array.isArray(appError.details) ? appError.details : [appError.details];
        const list_ = el('ul', { style: { marginTop: '6px', paddingLeft: '16px', listStyle: 'disc' } });
        for (const detail of details.slice(0, 4)) {
          list_.append(el('li', { text: `${detail.field ? `${detail.field}: ` : ''}${detail.problem ?? ''}` }));
        }
        body.append(list_);
      }

      errorSlot.append(node);
    }

    /* ------------------------------------------------------------------ *
     * Submit
     * ------------------------------------------------------------------ */
    async function submit(event) {
      event?.preventDefault();
      if (busy) return;

      const email = emailInput.value.trim();
      const password = passwordInput.value;
      const displayName = nameInput.value.trim();

      clear(errorSlot);

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showError(new AppError(Failure.VALIDATION, { message: 'Enter a valid email address.' }));
        emailInput.focus();
        return;
      }

      if (!password || password.length < 8) {
        showError(new AppError(Failure.VALIDATION, { message: 'Passwords must be at least 8 characters.' }));
        passwordInput.focus();
        return;
      }

      busy = true;
      submitButton.disabled = true;
      const original = submitLabel.textContent;
      submitLabel.textContent = 'Working…';

      try {
        if (resetToken) {
          await auth.resetPassword({ token: resetToken, password });
          hapticNotify('success');
          toast('Password changed. Please sign in.', { variant: 'success' });
          window.history.replaceState(null, '', '#/auth');
          window.location.reload();
          return;
        }

        if (mode === 'register') {
          await auth.register({ email, password, displayName: displayName || undefined, region: settings.getRegion() });
        } else {
          await auth.login({ email, password });
        }

        await settings.syncFromSession();
        hapticNotify('success');
        actions.touchHistory();
        actions.touchWatchlist();
        toast(mode === 'register' ? 'Account created.' : 'Signed in.', { variant: 'success' });
        router.navigate('/home', { replace: true });
      } catch (error) {
        hapticNotify('error');
        showError(error);
      } finally {
        busy = false;
        submitButton.disabled = false;
        submitLabel.textContent = original;
      }
    }

    /* ------------------------------------------------------------------ *
     * Forgot password
     * ------------------------------------------------------------------ */
    async function forgotPassword() {
      const email = emailInput.value.trim();
      if (!email) {
        showError(new AppError(Failure.VALIDATION, { message: 'Enter your email address first, then tap "Forgot password".' }));
        emailInput.focus();
        return;
      }

      busy = true;
      submitButton.disabled = true;

      try {
        const result = await auth.forgotPassword(email);
        clear(devSlot);

        // The server tells us how the link was delivered. If it says "development
        // console", it means no email provider exists — so we say that plainly and
        // surface the link instead of pretending an email was sent.
        if (result.devResetUrl) {
          devSlot.append(
            await banner({
              variant: 'warn',
              title: 'No email provider configured',
              text: `${result.notice} In production this link is emailed and never returned.`,
            })
          );

          const link = el('button', { class: 'btn btn--secondary btn--block', type: 'button', text: 'Open the reset link' });
          on(link, 'click', () => {
            const token = result.devResetToken;
            window.location.hash = `#/auth?token=${token}`;
            window.location.reload();
          });
          devSlot.append(el('div', { style: { marginTop: '10px' } }, [link]));
        } else {
          toast(result.message ?? 'If an account exists for that address, a reset link has been sent.', {
            variant: 'info',
            duration: 6000,
          });
        }
      } catch (error) {
        showError(error);
      } finally {
        busy = false;
        submitButton.disabled = false;
      }
    }

    /* ------------------------------------------------------------------ *
     * Wiring
     * ------------------------------------------------------------------ */
    const disposers = [
      on(form, 'submit', submit),
      on(forgotButton, 'click', forgotPassword),
      on(switchButton, 'click', () => {
        mode = mode === 'login' ? 'register' : 'login';
        paint();
        (mode === 'register' ? nameInput : emailInput)?.focus();
      }),
      on(qs('#auth-skip', root), 'click', () => {
        toast('Continuing without an account. History stays on this device.', { variant: 'info' });
        router.navigate('/home', { replace: true });
      }),
    ];

    paint();

    // Already signed in? Do not sit on a login form.
    if (store.getState().session.status === 'authenticated' && !resetToken) {
      router.navigate('/profile', { replace: true });
    }

    return () => disposers.forEach((dispose) => dispose?.());
  },
};
