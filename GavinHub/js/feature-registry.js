/**
 * Lazy feature registry. Features own their loader and one-time bootstrap while
 * callers only depend on a stable id. Failed loads remain retryable.
 */
export function createFeatureRegistry(definitions = {}) {
  const entries = new Map();

  for (const [id, definition] of Object.entries(definitions)) {
    entries.set(id, {
      definition,
      value: null,
      promise: null,
      status: 'idle',
      error: null,
    });
  }

  async function load(id, context = {}) {
    const entry = entries.get(id);
    if (!entry) throw new Error(`Unknown feature: ${id}`);
    if (entry.status === 'ready') return entry.value;
    if (entry.promise) return entry.promise;

    entry.status = 'loading';
    entry.error = null;
    entry.promise = Promise.resolve()
      .then(() => entry.definition.load())
      .then(async (module) => {
        const initialized = entry.definition.setup
          ? await entry.definition.setup(module, context)
          : module;
        entry.value = initialized ?? module;
        entry.status = 'ready';
        return entry.value;
      })
      .catch((error) => {
        entry.status = 'failed';
        entry.error = error;
        throw error;
      })
      .finally(() => {
        entry.promise = null;
      });

    return entry.promise;
  }

  function preload(id, context = {}) {
    return load(id, context).catch(() => null);
  }

  function getStatus(id) {
    const entry = entries.get(id);
    if (!entry) return { status: 'unknown', error: null };
    return { status: entry.status, error: entry.error };
  }

  return { load, preload, getStatus, has: (id) => entries.has(id) };
}
