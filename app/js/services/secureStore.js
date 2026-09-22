/**
 * Token storage.
 *
 * SECURITY (section 22): authentication tokens must not sit in plain
 * localStorage when the platform offers a real key store. This module tries, in
 * order:
 *
 *   1. Native secure storage — iOS Keychain / Android EncryptedSharedPreferences,
 *      reached through the well-known `capacitor-secure-storage-plugin`. It is
 *      loaded dynamically so the app does not fail to build if it is absent.
 *   2. @capacitor/preferences — the platform's own preference store (Android
 *      SharedPreferences / iOS UserDefaults). Not encrypted, but it is app-private
 *      on both platforms rather than world-readable browser storage.
 *   3. localStorage — browser development only.
 *
 * Whichever driver is active is reported by `secureStore.driver`, and Profile >
 * About shows it, so "we store tokens securely" is a verifiable claim rather than
 * an assumption. Run `npm run add:secure-storage` to enable tier 1.
 */
import { Preferences } from '@capacitor/preferences';
import config from '../config.js';

const SECURE_KEYS = {
  accessToken: `${config.storagePrefix}access`,
  refreshToken: `${config.storagePrefix}refresh`,
  user: `${config.storagePrefix}user`,
};

let driver = 'unknown';
let securePlugin = null;
let driverProbe = null;

async function resolveDriver() {
  if (driverProbe) return driverProbe;

  driverProbe = (async () => {
    if (!config.isNative) {
      driver = 'localStorage';
      return driver;
    }
    try {
      // Dynamic import: the package is optional, so a missing module must not
      // break the bundle. Rejected at runtime -> we fall through to Preferences.
      const mod = await import(/* @vite-ignore */ 'capacitor-secure-storage-plugin');
      if (mod?.SecureStoragePlugin) {
        // Verify it actually works before trusting it.
        await mod.SecureStoragePlugin.set({ key: `${config.storagePrefix}probe`, value: '1' });
        await mod.SecureStoragePlugin.remove({ key: `${config.storagePrefix}probe` });
        securePlugin = mod.SecureStoragePlugin;
        driver = 'nativeSecureStorage';
        return driver;
      }
    } catch {
      /* not installed, or the native side is unavailable */
    }
    try {
      await Preferences.set({ key: `${config.storagePrefix}probe`, value: '1' });
      await Preferences.remove({ key: `${config.storagePrefix}probe` });
      driver = 'nativePreferences';
      return driver;
    } catch {
      driver = 'localStorage';
      return driver;
    }
  })();

  return driverProbe;
}

async function write(key, value) {
  await resolveDriver();
  if (driver === 'nativeSecureStorage') {
    await securePlugin.set({ key, value });
    return;
  }
  if (driver === 'nativePreferences') {
    await Preferences.set({ key, value });
    return;
  }
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota or private mode */
  }
}

async function read(key) {
  await resolveDriver();
  if (driver === 'nativeSecureStorage') {
    try {
      const { value } = await securePlugin.get({ key });
      return value ?? null;
    } catch {
      // The plugin throws when the key does not exist.
      return null;
    }
  }
  if (driver === 'nativePreferences') {
    const { value } = await Preferences.get({ key });
    return value ?? null;
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

async function remove(key) {
  await resolveDriver();
  if (driver === 'nativeSecureStorage') {
    try {
      await securePlugin.remove({ key });
    } catch {
      /* already gone */
    }
    return;
  }
  if (driver === 'nativePreferences') {
    await Preferences.remove({ key });
    return;
  }
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export const secureStore = {
  get driver() {
    return driver;
  },

  async setTokens({ accessToken, refreshToken }) {
    if (accessToken) await write(SECURE_KEYS.accessToken, accessToken);
    if (refreshToken) await write(SECURE_KEYS.refreshToken, refreshToken);
  },

  async getAccessToken() {
    return read(SECURE_KEYS.accessToken);
  },

  async getRefreshToken() {
    return read(SECURE_KEYS.refreshToken);
  },

  async setUser(user) {
    if (!user) return;
    await write(SECURE_KEYS.user, JSON.stringify(user));
  },

  async getUser() {
    const raw = await read(SECURE_KEYS.user);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  async clear() {
    await Promise.all([
      remove(SECURE_KEYS.accessToken),
      remove(SECURE_KEYS.refreshToken),
      remove(SECURE_KEYS.user),
    ]);
  },

  /** Describes the storage actually in use, for the About screen. */
  async describe() {
    await resolveDriver();
    return {
      driver,
      label: {
        nativeSecureStorage: 'Device keychain (encrypted)',
        nativePreferences: 'Device preferences (app-private, not encrypted)',
        localStorage: 'Browser local storage (development only)',
        unknown: 'Unknown',
      }[driver],
      secure: driver === 'nativeSecureStorage',
    };
  },
};

export default secureStore;
