const DEFAULT_CACHE_SIZE = 6;
const FOCUS_WAIT_MS = 420;
const APPS_WAIT_MS = 1100;

export function createWallpaperEffects({
  createFocusPreview,
  createAppsPreview,
  getPersistentKey,
  loadPersistentPreview,
  savePersistentPreview,
  maxCacheSize = DEFAULT_CACHE_SIZE,
} = {}) {
  const previewCache = new Map();
  const previewRequests = new Map();
  const activeLayerKeys = new Map();
  let generation = 0;

  function rememberPreview(key, blob) {
    if (!blob?.size) return null;
    const url = URL.createObjectURL(blob);
    const preview = {
      url,
      dispose() { URL.revokeObjectURL(url); },
    };
    previewCache.set(key, preview);
    while (previewCache.size > maxCacheSize) {
      const oldestKey = previewCache.keys().next().value;
      previewCache.get(oldestKey)?.dispose?.();
      previewCache.delete(oldestKey);
    }
    return preview;
  }

  function createPreview(kind, url) {
    const creator = kind === 'focus' ? createFocusPreview : createAppsPreview;
    return creator ? creator(url) : Promise.resolve(null);
  }

  async function isDecodablePreview(blob) {
    if (!blob?.size || (blob.type && !blob.type.startsWith('image/'))) return false;
    if (typeof createImageBitmap !== 'function') return true;
    try {
      const bitmap = await createImageBitmap(blob);
      const valid = bitmap.width > 0 && bitmap.height > 0;
      bitmap.close?.();
      return valid;
    } catch {
      return false;
    }
  }

  function requestPreview(kind, data) {
    const identity = data.effectKey || data.url;
    const requestKey = `${kind}:${identity}`;
    const cached = previewCache.get(requestKey);
    if (cached) {
      return { bounded: Promise.resolve(cached), full: Promise.resolve(cached) };
    }
    const pending = previewRequests.get(requestKey);
    if (pending) return pending;

    const requestGeneration = generation;
    const persistentKey = getPersistentKey?.(kind, data) || '';
    const full = (async () => {
      let blob = null;
      if (persistentKey && loadPersistentPreview) {
        try {
          blob = await loadPersistentPreview(persistentKey);
        } catch { /* regenerate missing or damaged cache */ }
      }
      if (!(await isDecodablePreview(blob))) {
        blob = await createPreview(kind, data.url);
        if (blob?.size && persistentKey && savePersistentPreview) {
          void savePersistentPreview(persistentKey, blob).catch(() => {});
        }
      }
      if (requestGeneration !== generation) return null;
      return rememberPreview(requestKey, blob);
    })().catch(() => null);

    const waitMs = kind === 'focus' ? FOCUS_WAIT_MS : APPS_WAIT_MS;
    let timeoutId = 0;
    const bounded = Promise.race([
      full,
      new Promise((resolve) => {
        timeoutId = window.setTimeout(() => resolve(null), waitMs);
      }),
    ]).finally(() => window.clearTimeout(timeoutId));
    const request = { bounded, full };
    previewRequests.set(requestKey, request);
    void full.finally(() => previewRequests.delete(requestKey));
    return request;
  }

  function setActive(layerId, { type = 'image', css = '', url = '', effectKey = '' } = {}) {
    const nextKey = type === 'gradient'
      ? `gradient:${css}`
      : `image:${effectKey || url}`;
    activeLayerKeys.set(layerId, nextKey);
    return nextKey;
  }

  function applyLayer(layer, value) {
    if (!layer) return;
    layer.style.backgroundImage = value || '';
    layer.style.backgroundColor = '';
  }

  async function syncLayer(layerId, kind, data = {}) {
    const layer = document.getElementById(layerId);
    if (!layer) return false;
    const expectedKey = setActive(layerId, data);
    const { type = 'image', css = '', url = '' } = data;

    if (type === 'gradient' && css) {
      applyLayer(layer, css);
      return true;
    }
    if (!url) {
      applyLayer(layer, '');
      return false;
    }

    const identity = data.effectKey || data.url;
    const readyPreview = previewCache.get(`${kind}:${identity}`);
    if (readyPreview) {
      applyLayer(layer, `url("${readyPreview.url}")`);
      return true;
    }

    const request = requestPreview(kind, data);
    const fallbackPreview = kind === 'apps'
      ? previewCache.get(`focus:${identity}`)
      : null;
    if (fallbackPreview) {
      applyLayer(layer, `url("${fallbackPreview.url}")`);
      void request.full.then((fullPreview) => {
        if (!fullPreview || activeLayerKeys.get(layerId) !== expectedKey) return;
        applyLayer(layer, `url("${fullPreview.url}")`);
      });
      return true;
    }

    const preview = await request.bounded;
    if (activeLayerKeys.get(layerId) !== expectedKey) return false;
    applyLayer(layer, `url("${preview?.url || url}")`);

    if (!preview) {
      void request.full.then((latePreview) => {
        if (!latePreview || activeLayerKeys.get(layerId) !== expectedKey) return;
        applyLayer(layer, `url("${latePreview.url}")`);
      });
    }
    return Boolean(preview);
  }

  function sync(data) {
    return syncLayer('search-focus-overlay', 'focus', data);
  }

  function prepareApps(data) {
    return syncLayer('wallpaper-blur', 'apps', data);
  }

  function prewarmApps(data = {}) {
    if (data.type === 'gradient' || !data.url) return Promise.resolve(false);
    return requestPreview('apps', data).full.then(Boolean);
  }

  function dispose() {
    generation += 1;
    for (const preview of previewCache.values()) preview.dispose?.();
    previewCache.clear();
    previewRequests.clear();
    activeLayerKeys.clear();
  }

  return { sync, prepareApps, prewarmApps, dispose };
}
