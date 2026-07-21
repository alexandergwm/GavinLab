import { loadSettings, saveSettings, TAB_SESSION_SETTINGS } from './storage.js';

const TAB_SESSION_KEYS = Object.keys(TAB_SESSION_SETTINGS);

export function createSettingsStore() {
  let state = loadSettings();
  const listeners = new Set();

  const notify = () => {
    for (const listener of listeners) listener(state);
  };

  return {
    get: () => state,
    set(partial) {
      state = { ...state, ...partial };
      const persistPartial = { ...partial };
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
