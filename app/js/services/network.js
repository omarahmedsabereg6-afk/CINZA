/**
 * Connectivity.
 *
 * Reports a single boolean into the store so the offline banner, the error copy and
 * every screen agree on whether the network is available.
 *
 * WHY THIS VERIFIES RATHER THAN TRUSTS
 * ------------------------------------
 * `navigator.onLine` and even the Network plugin's first reading are unreliable in
 * webviews and in constrained browser environments: a device with Wi-Fi up but no
 * route, or a misreporting emulator, is common. Announcing "no internet connection"
 * while the app is in fact talking to the API is worse than saying nothing, so a
 * negative report is confirmed with a real request before it is shown. A positive
 * report is trusted immediately, because that is a genuine transition.
 */
import { Network } from '@capacitor/network';
import { store, actions } from '../core/store.js';
import { toast } from '../core/feedback.js';

let listenerHandle = null;
let started = false;

function paint(online) {
  const bar = document.getElementById('offline-bar');
  if (!bar) return;
  bar.dataset.visible = String(!online);
  // Take the bar out of the accessibility tree while it is off-screen so a screen
  // reader never announces a connection problem that is not happening.
  bar.setAttribute('aria-hidden', String(online));
}

async function apply(online, { announce = false } = {}) {
  const was = store.getState().online;
  actions.setOnline(online);
  paint(online);

  if (!announce || was === online) return;

  if (online) toast('Back online.', { variant: 'success' });
  else toast('No internet connection.', { variant: 'warn', duration: 6000 });
}

/** Confirms a negative reading by actually calling the API. */
async function verifyReachable() {
  try {
    const { ping } = await import('./api.js');
    return await ping(5000);
  } catch {
    return false;
  }
}

async function settle(connected, { announce }) {
  if (connected) {
    await apply(true, { announce });
    return;
  }
  const reachable = await verifyReachable();
  await apply(reachable, { announce: announce && !reachable });
}

export async function startNetworkWatch() {
  if (started) return;
  started = true;

  try {
    const status = await Network.getStatus();
    await settle(status.connected, { announce: true });

    listenerHandle = await Network.addListener('networkStatusChange', (status) => {
      settle(status.connected, { announce: true });
    });
  } catch {
    // Web fallback: browser events are reliable in a normal tab.
    await settle(typeof navigator === 'undefined' ? true : navigator.onLine !== false, { announce: true });
    window.addEventListener('online', () => apply(true, { announce: true }));
    window.addEventListener('offline', () => settle(false, { announce: true }));
  }
}

export function stopNetworkWatch() {
  listenerHandle?.remove?.();
  listenerHandle = null;
  started = false;
}

export const isOnline = () => store.getState().online;

export default { startNetworkWatch, stopNetworkWatch, isOnline };
