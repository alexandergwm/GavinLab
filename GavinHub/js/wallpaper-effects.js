const DEFAULT_CACHE_SIZE = 4;
const PREVIEW_WAIT_MS = 800;

export function createWallpaperEffects({
  createPreviews,
  createPreview = createPreviews,
  maxCacheSize = DEFAULT_CACHE_SIZE,
} = {}) {
  const previewCache = new Map();
  const previewRequests = new Map();
  let activeKey = '';
  let generation = 0;

  function rememberPreview(key, preview) {
    previewCache.set(key, preview);
    while (previewCache.size > maxCacheSize) {
      const oldestKey = previewCache.keys().next().value;
      previewCache.get(oldestKey)?.dispose?.();
      previewCache.delete(oldestKey);
    }
  }

  function requestPreview(url) {
    const key = url;
    const cached = previewCache.get(key);
    if (cached) return Promise.resolve(cached);
    if (!createPreview) return Promise.resolve(null);
    const pending = previewRequests.get(key);
    if (pending) return pending.bounded;

    const requestGeneration = generation;
    const previewPromise = createPreview(url).then((preview) => {
      if (requestGeneration !== generation) {
        preview?.dispose?.();
        return null;
      }
      rememberPreview(key, preview);
      return preview;
    }).catch(() => null);
    let timeoutId = 0;
    const bounded = Promise.race([
      previewPromise,
      new Promise((resolve) => {
        timeoutId = window.setTimeout(() => resolve(null), PREVIEW_WAIT_MS);
      }),
    ]).finally(() => window.clearTimeout(timeoutId));
    previewRequests.set(key, { bounded });
    void previewPromise.finally(() => previewRequests.delete(key));
    return bounded;
  }

  function setActive({ type = 'image', css = '', url = '' } = {}) {
    const nextKey = type === 'gradient' ? `gradient:${css}` : `image:${url}`;
    activeKey = nextKey;
    return nextKey;
  }

  function applyFallback(layer, value) {
    if (!layer) return;
    layer.style.backgroundImage = value || '';
    layer.style.backgroundColor = '';
  }

  async function syncLayer(layerId, data = {}) {
    const layer = document.getElementById(layerId);
    if (!layer) return false;
    const expectedKey = setActive(data);
    const { type = 'image', css = '', url = '' } = data;

    if (type === 'gradient' && css) {
      applyFallback(layer, css);
      return true;
    }
    if (!url) {
      applyFallback(layer, '');
      return false;
    }

    const preview = await requestPreview(url);
    if (activeKey !== expectedKey) return false;
    const previewUrl = preview?.apps;
    applyFallback(layer, previewUrl ? `url("${previewUrl}")` : `url("${url}")`);
    return Boolean(previewUrl);
  }

  function sync(data) {
    return syncLayer('search-focus-overlay', data);
  }

  function prepareApps(data) {
    return syncLayer('wallpaper-blur', data);
  }

  function dispose() {
    generation += 1;
    for (const preview of previewCache.values()) preview.dispose?.();
    previewCache.clear();
    previewRequests.clear();
    activeKey = '';
  }

  return { sync, prepareApps, dispose };
}
