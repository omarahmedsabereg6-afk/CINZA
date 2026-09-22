/**
 * Application bootstrap.
 *
 * Boot order matters, and each step is deliberately non-fatal:
 *
 *   1. apply the saved theme            — no flash of the wrong palette
 *   2. start the router                 — a usable shell renders immediately
 *   3. restore the session              — in the background
 *   4. load server capabilities         — in the background (drives feature gating
 *                                         and the mock-mode banners)
 *   5. start connectivity watching      — in the background
 *
 * A failure in 3, 4 or 5 leaves a working app: the notice is surfaced, and the app
 * falls back to conservative defaults. Nothing is allowed to produce a white screen.
 */
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';

import config from './config.js';
import { router } from './core/router.js';
import { store } from './core/store.js';
import { toast } from './core/feedback.js';
import { announce } from './core/dom.js';
import * as settings from './services/settings.js';
import { restoreSession } from './services/auth.js';
import { loadCapabilities, isSimulated } from './services/capabilities.js';
import { startNetworkWatch } from './services/network.js';

/* ------------------------------------------------------------------ *
 * Global safety nets
 * ------------------------------------------------------------------ */
window.addEventListener('error', (event) => {
  console.error('[app] uncaught error', event.error ?? event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[app] unhandled rejection', event.reason);
  // Surface a rejection only when it is likely to have broken a user-visible action.
  const reason = event.reason;
  if (reason?.kind && reason?.title) {
    toast(`${reason.title} — ${reason.text}`, { variant: 'error' });
    event.preventDefault();
  }
});

/* ------------------------------------------------------------------ *
 * Android hardware back button
 * ------------------------------------------------------------------ */
function wireHardwareBack() {
  if (!config.isNative) return;
  CapacitorApp.addListener('backButton', ({ canGoBack }) => {
    const current = store.getState().route;
    // Never trap the user on a root screen: only exit when there is nowhere to go.
    if (current?.name && current.name !== 'home') router.back('/home');
    else if (canGoBack) window.history.back();
    else CapacitorApp.exitApp();
  }).catch(() => null);
}

/* ------------------------------------------------------------------ *
 * Native chrome
 * ------------------------------------------------------------------ */
async function wireNativeChrome() {
  if (!config.isNative) return;

  try {
    await StatusBar.setStyle({ style: Style.Dark });
    if (Capacitor.getPlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: '#08090B' });
      await StatusBar.setOverlaysWebView({ overlay: true });
    }
  } catch {
    /* status bar APIs vary by platform version */
  }

  try {
    await SplashScreen.hide({ fadeOutDuration: 220 });
  } catch {
    /* already hidden */
  }
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */
async function boot() {
  // 1. Theme and preferences first: avoids flashes and sets haptics/motion.
  settings.initPreferences();

  // React to the OS theme when the user picked "match system".
  window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', () => {
    if (settings.getTheme() === 'system') settings.applyTheme('system');
  });

  // 2. Chrome + back button before anything async, so the app feels responsive.
  await wireNativeChrome();
  wireHardwareBack();

  // 3. Router: renders the shell immediately.
  router.start();

  // 4-6. Everything else runs in parallel and reports failures without blocking.
  const [sessionResult, capabilitiesResult] = await Promise.allSettled([
    restoreSession(),
    loadCapabilities(),
  ]);

  if (sessionResult.status === 'rejected') {
    console.warn('[boot] session restore failed', sessionResult.reason);
  } else {
    await settings.syncFromSession().catch(() => null);
  }

  if (capabilitiesResult.status === 'rejected') {
    console.warn('[boot] capability load failed', capabilitiesResult.reason);
  }

  startNetworkWatch().catch((error) => console.warn('[boot] network watch failed', error));

  // 7. Tell the user once, at boot, if this build is running on simulated providers.
  const capabilities = capabilitiesResult.status === 'fulfilled' ? capabilitiesResult.value : null;
  if (capabilities?.__fallback) {
    toast('The CINZA server is not reachable. Some features are unavailable.', {
      variant: 'warn',
      duration: 7000,
    });
  } else if (isSimulated()) {
    toast('Simulated mode: results are labelled and are not real identifications.', {
      variant: 'warn',
      duration: 6000,
    });
  }

  announce(`${config.appName} ready`);
  document.body.dataset.ready = 'true';
  console.info(
    `[cinza] ready — build=${config.build} platform=${config.platform} api=${config.apiBase} native=${config.isNative}`
  );
}

boot().catch((error) => {
  console.error('[boot] fatal', error);
  const view = document.getElementById('view');
  if (view) {
    view.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'view__pad';
    box.style.paddingTop = '48px';
    const title = document.createElement('h1');
    title.className = 't-title';
    title.textContent = 'CINZA could not start';
    const text = document.createElement('p');
    text.className = 't-body';
    text.style.marginTop = '12px';
    text.textContent =
      'Something went wrong while starting the app. Restarting usually fixes it. If the problem continues, the API endpoint in Settings may be unreachable.';
    box.append(title, text);
    view.append(box);
  }
});
