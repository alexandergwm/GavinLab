const DEFAULT_CACHE_SIZE = 4;

export function createWallpaperEffects({
  createPreviews,
  maxCacheSize = DEFAULT_CACHE_SIZE,
} = {}) {
  const previewCache = new Map();
  let previewRequestUrl = '';
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

  function requestPreviews(url, layers) {
    const cached = previewCache.get(url);
    if (cached) {
      applyPreviews(cached, layers);
      return;
    }
    if (!createPreviews || previewRequestUrl === url) return;

    previewRequestUrl = url;
    const requestGeneration = generation;
    void createPreviews(url).then((previews) => {
      if (requestGeneration !== generation) {
        previews?.dispose?.();
        return;
      }
      rememberPreviews(url, previews);
      if (activeImageUrl === url) applyPreviews(previews, getLayers());
    }).catch(() => {
      /* Full-resolution backgrounds remain visible when preview generation fails. */
    }).finally(() => {
      if (previewRequestUrl === url) previewRequestUrl = '';
    });
  }

  function sync({ type = 'image', css = '', url = '' } = {}) {
    const layers = getLayers();
    const elements = Object.values(layers).filter(Boolean);
    if (!elements.length) return;

    if (type === 'gradient' && css) {
      activeImageUrl = '';
      previewRequestUrl = '';
      for (const layer of elements) {
        layer.style.backgroundImage = css;
        layer.style.backgroundColor = '';
      }
      return;
    }

    activeImageUrl = url;
    for (const layer of elements) {
      layer.style.backgroundImage = url ? `url("${url}")` : '';
      layer.style.backgroundColor = url ? 'transparent' : '';
    }
    if (url) requestPreviews(url, layers);
  }

  function dispose() {
    generation += 1;
    for (const previews of previewCache.values()) previews.dispose?.();
    previewCache.clear();
    previewRequestUrl = '';
    activeImageUrl = '';
  }

  return { sync, dispose };
}
