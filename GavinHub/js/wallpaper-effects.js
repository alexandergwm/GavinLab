// Full-viewport previews are intentionally high resolution; two wallpapers are
// enough for instant back/forward switching without retaining excess bitmaps.
const DEFAULT_CACHE_SIZE = 2;
const PREVIEW_WAIT_MS = 800;

export function createWallpaperEffects({
  createPreviews,
  maxCacheSize = DEFAULT_CACHE_SIZE,
} = {}) {
  const previewCache = new Map();
  const previewRequests = new Map();
  let activeImageUrl = '';
  let generation = 0;

  function getLayers() {
    return {
      apps: document.getElementById('wallpaper-blur'),
      focus: document.getElementById('search-focus-overlay'),
    };
  }

  function applyPreviews(previews, layers) {
    if (previews?.apps && layers.apps) {
      layers.apps.style.backgroundImage = `url("${previews.apps}")`;
    }
    if (previews?.focus && layers.focus) {
      layers.focus.style.backgroundImage = `url("${previews.focus}")`;
    }
  }

  function rememberPreviews(url, previews) {
    previewCache.set(url, previews);
    while (previewCache.size > maxCacheSize) {
      const oldestUrl = previewCache.keys().next().value;
      previewCache.get(oldestUrl)?.dispose?.();
      previewCache.delete(oldestUrl);
    }
  }

  function requestPreviews(url) {
    const cached = previewCache.get(url);
    if (cached) return Promise.resolve(cached);
    if (!createPreviews) return Promise.resolve(null);
    const pending = previewRequests.get(url);
    if (pending) return pending.bounded;

    const requestGeneration = generation;
    const previewPromise = createPreviews(url).then((previews) => {
      if (requestGeneration !== generation) {
        previews?.dispose?.();
        return null;
      }
      rememberPreviews(url, previews);
      return previews;
    }).catch(() => null);
    let timeoutId = 0;
    const bounded = Promise.race([
      previewPromise,
      new Promise((resolve) => {
        timeoutId = window.setTimeout(() => resolve(null), PREVIEW_WAIT_MS);
      }),
    ]).finally(() => window.clearTimeout(timeoutId));
    previewRequests.set(url, { bounded });
    void previewPromise.finally(() => {
      previewRequests.delete(url);
    });
    return bounded;
  }

  function applyImageFallback(url, layers) {
    for (const layer of Object.values(layers).filter(Boolean)) {
      layer.style.backgroundImage = url ? `url("${url}")` : '';
      layer.style.backgroundColor = url ? 'transparent' : '';
    }
  }

  async function syncImage(url, layers) {
    if (!url) {
      applyImageFallback('', layers);
      return false;
    }

    const previews = await requestPreviews(url);
    if (activeImageUrl !== url) return false;
    if (previews) {
      applyPreviews(previews, getLayers());
      return true;
    }
    applyImageFallback(url, getLayers());
    return false;
  }

  function sync({ type = 'image', css = '', url = '' } = {}) {
    const layers = getLayers();
    const elements = Object.values(layers).filter(Boolean);
    if (!elements.length) return Promise.resolve(false);

    if (type === 'gradient' && css) {
      activeImageUrl = '';
      for (const layer of elements) {
        layer.style.backgroundImage = css;
        layer.style.backgroundColor = '';
      }
      return Promise.resolve(true);
    }

    activeImageUrl = url;
    return syncImage(url, layers);
  }

  function dispose() {
    generation += 1;
    for (const previews of previewCache.values()) previews.dispose?.();
    previewCache.clear();
    previewRequests.clear();
    activeImageUrl = '';
  }

  return { sync, dispose };
}
