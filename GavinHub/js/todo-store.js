import { readString, writeJson } from './storage.js';

/**
 * Cached local-first collection store. It preserves the existing JSON payload
 * for browser/GitHub sync while avoiding repeated parse/stringify work during
 * one calendar render.
 */
export function createTodoStore({ key, migrate }) {
  let state = null;
  let rawSnapshot = null;
  let byId = new Map();
  let persistPending = false;
  let persistGeneration = 0;
  const queryCache = new Map();
  const listeners = new Set();

  const rebuildIndexes = () => {
    byId = new Map(state.map((item) => [String(item.id), item]));
    queryCache.clear();
  };

  const hydrate = (raw) => {
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    state = migrate(parsed);
    rawSnapshot = raw;
    rebuildIndexes();
    return state;
  };

  const load = () => {
    if (state && persistPending) return state;
    const raw = readString(key, '');
    if (!state || raw !== rawSnapshot) return hydrate(raw);
    return state;
  };

  const flush = () => {
    if (!persistPending || !state) return false;
    persistPending = false;
    const raw = JSON.stringify(state);
    writeJson(key, state);
    rawSnapshot = raw;
    return true;
  };

  const schedulePersist = () => {
    persistPending = true;
    const generation = ++persistGeneration;
    queueMicrotask(() => {
      if (generation === persistGeneration) flush();
    });
  };

  const notify = () => {
    for (const listener of listeners) {
      try {
        listener(state);
      } catch (error) {
        console.warn('[GavinHub] todo listener failed', error);
      }
    }
  };

  const set = (nextItems) => {
    state = Array.isArray(nextItems) ? nextItems : [];
    rawSnapshot = null;
    rebuildIndexes();
    schedulePersist();
    notify();
    return state;
  };

  const update = (producer) => {
    const current = load();
    const next = producer(current);
    return next === current ? current : set(next);
  };

  const query = (cacheKey, projector) => {
    const items = load();
    if (queryCache.has(cacheKey)) return queryCache.get(cacheKey);
    const value = projector(items);
    queryCache.set(cacheKey, value);
    return value;
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush, { passive: true });
  }

  return {
    load,
    set,
    update,
    query,
    flush,
    getById(id) {
      load();
      return byId.get(String(id)) || null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    invalidate() {
      if (persistPending) flush();
      state = null;
      rawSnapshot = null;
      byId.clear();
      queryCache.clear();
    },
  };
}
