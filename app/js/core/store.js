/**
 * Small reactive store.
 *
 * Views subscribe to a slice of state and are re-rendered when it changes. This is
 * deliberately tiny — enough to keep the header, tab bar and screens in sync with
 * auth/session changes without pulling in a framework.
 */

function createStore(initialState) {
  let state = { ...initialState };
  const listeners = new Map();
  let nextId = 1;

  function notify(keys) {
    for (const [id, entry] of listeners) {
      const intersects = entry.keys.length === 0 || entry.keys.some((key) => keys.includes(key));
      if (!intersects) continue;
      try {
        entry.callback(getState(), keys);
      } catch (error) {
        console.error(`[store] listener ${id} failed`, error);
      }
    }
  }

  function getState() {
    return state;
  }

  function set(partial, meta = {}) {
    const keys = Object.keys(partial).filter((key) => !Object.is(state[key], partial[key]));
    if (keys.length === 0) return state;
    state = { ...state, ...partial };
    notify(keys, meta);
    return state;
  }

  function subscribe(keys, callback) {
    const id = nextId++;
    listeners.set(id, { keys: Array.isArray(keys) ? keys : [keys], callback });
    return () => listeners.delete(id);
  }

  return { getState, set, subscribe };
}

/**
 * The app's single source of truth.
 *
 * `session`     — auth state: { status, user, token }
 * `capabilities`— the sanitised /api/meta/config payload
 * `online`      — navigator/Network plugin status
 * `route`       — current route descriptor
 * `pending`     — the in-flight capture (image, frames, mode) being recognised
 */
export const store = createStore({
  session: { status: 'unknown', user: null }, // unknown | anonymous | authenticated
  capabilities: null,
  capabilitiesError: null,
  online: true,
  route: { name: 'home', params: {} },
  pending: null,
  lastResult: null,
  historyRevision: 0,
  watchlistRevision: 0,
  toast: null,
});

export const actions = {
  setSession(session) {
    store.set({ session: { ...store.getState().session, ...session } });
  },
  setCapabilities(capabilities) {
    store.set({ capabilities, capabilitiesError: null });
  },
  setCapabilitiesError(error) {
    store.set({ capabilitiesError: error });
  },
  setOnline(online) {
    if (store.getState().online === online) return;
    store.set({ online });
  },
  setRoute(route) {
    store.set({ route });
  },
  setPending(pending) {
    store.set({ pending });
  },
  setLastResult(result) {
    store.set({ lastResult: result });
  },
  /** Bump after a write so History/Watchlist refetch when next shown. */
  touchHistory() {
    store.set({ historyRevision: store.getState().historyRevision + 1 });
  },
  touchWatchlist() {
    store.set({ watchlistRevision: store.getState().watchlistRevision + 1 });
  },
};

export default store;
