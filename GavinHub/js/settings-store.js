import { loadSettings, saveSettings, TAB_SESSION_SETTINGS } from './storage.js';

const TAB_SESSION_KEYS = Object.keys(TAB_SESSION_SETTINGS);

export function createSettingsStore() {
  let state = loadSettings();
  const listeners = new Set();

  const changedEntries = (partial) => Object.entries(partial)
    .filter(([key, value]) => !Object.is(state[key], value));

  const notify = () => {
    for (const listener of listeners) {
      try {
        listener(state);
      } catch (error) {
        console.warn('[GavinHub] settings listener failed', error);
      }
    }
  };

  return {
    get: () => state,
    set(partial) {
      const changes = Object.fromEntries(changedEntries(partial));
      if (!Object.keys(changes).length) return state;

      state = { ...state, ...changes };
      const persistPartial = { ...changes };
      for (const key of TAB_SESSION_KEYS) delete persistPartial[key];
      if (Object.keys(persistPartial).length) {
        const persisted = saveSettings(persistPartial);
        state = { ...state, ...persisted };
      }
      notify();
      return state;
    },
    reload() {
      const session = {};
      for (const key of TAB_SESSION_KEYS) {
        if (key in state) session[key] = state[key];
      }
      state = { ...loadSettings(), ...session };
      notify();
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
