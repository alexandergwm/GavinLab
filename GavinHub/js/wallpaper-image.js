/** 壁纸图片探测与加载（无 DOM 副作用） */

export const MIN_CACHE_WIDTH = 1280;
const IMAGE_PROBE_TIMEOUT_MS = 8000;
const ANALYSIS_MAX_WIDTH = 512;
const APPS_EFFECT_MIN_WIDTH = 1280;
const APPS_EFFECT_MAX_WIDTH = 1920;
const APPS_EFFECT_BLUR_PX = 18;

export function isLocalWallpaperUrl(url) {
  return !!url && !/^https?:/i.test(url) && !url.startsWith('blob:') && !url.startsWith('data:');
}

export async function measureBlobWidth(blob) {
  if (!blob) return 0;
  try {
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(blob);
      const w = bmp.width;
      bmp.close?.();
      return w;
    }
  } catch {
    /* fall through */
  }
  return 0;
}

export function loadImageElement(url, crossOrigin, { minWidth = 400 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => {
      const width = img.naturalWidth || img.width || 0;
      if (width > 0 && width < minWidth) {
        reject(new Error('image too small'));
        return;
      }
      const finish = () => resolve(img);
      if (typeof img.decode === 'function') {
        img.decode().then(finish).catch(finish);
        return;
      }
      finish();
    };
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}

/** 文字自适应专用：低分辨率解码，减少 UHD 全图解码开销 */
export async function loadAnalysisSource(url, { maxWidth = ANALYSIS_MAX_WIDTH } = {}) {
  const isLocal = url.startsWith('blob:') || url.startsWith('data:') || !/^https?:/i.test(url);
  if (isLocal) {
    const img = await loadImageElement(url, false);
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
    };
  }

  try {
    const res = await fetch(url, { mode: 'cors', cache: 'force-cache' });
    if (!res.ok) throw new Error('fetch failed');
    const blob = await res.blob();
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(blob, {
        resizeWidth: maxWidth,
        resizeQuality: 'low',
      });
      return {
        source: bmp,
        width: bmp.width,
        height: bmp.height,
        dispose: () => bmp.close?.(),
      };
    }
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = await loadImageElement(objectUrl, false);
      return {
        source: img,
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    const img = await loadImageElement(url, true);
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
    };
  }
}

export async function loadImageForAnalysis(url) {
  const loaded = await loadAnalysisSource(url);
  if (loaded.source instanceof Image) return loaded.source;
  const canvas = document.createElement('canvas');
  canvas.width = loaded.width;
  canvas.height = loaded.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(loaded.source, 0, 0);
  loaded.dispose?.();
  const img = new Image();
  img.src = canvas.toDataURL('image/jpeg', 0.82);
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });
  return img;
}

function canvasToObjectUrl(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('preview encode failed'));
        return;
      }
      resolve(URL.createObjectURL(blob));
    }, 'image/jpeg', quality);
  });
}

async function renderWallpaperEffect(url, {
  targetWidth,
  quality,
  filter,
  overscan = 0,
}) {
  const loaded = await loadAnalysisSource(url, { maxWidth: targetWidth });
  try {
    const width = Math.min(targetWidth, loaded.width);
    const height = Math.max(1, Math.round(width * loaded.height / loaded.width));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return '';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.filter = filter;
    ctx.drawImage(
      loaded.source,
      -overscan,
      -overscan,
      width + overscan * 2,
      height + overscan * 2,
    );
    return canvasToObjectUrl(canvas, quality);
  } finally {
    loaded.dispose?.();
  }
}

export async function createWallpaperFocusPreview(url) {
  const focus = await renderWallpaperEffect(url, {
    targetWidth: 1200,
    quality: 0.82,
    filter: 'brightness(94%) saturate(104%)',
  });
  return {
    focus,
    dispose() { URL.revokeObjectURL(focus); },
  };
}

export async function createWallpaperAppsPreview(url) {
  const viewportWidth = Math.max(APPS_EFFECT_MIN_WIDTH, Math.ceil(window.innerWidth * 1.05));
  const targetWidth = Math.min(APPS_EFFECT_MAX_WIDTH, viewportWidth);
  const apps = await renderWallpaperEffect(url, {
    targetWidth,
    quality: 0.86,
    filter: `blur(${APPS_EFFECT_BLUR_PX}px) brightness(84%) saturate(112%)`,
    overscan: APPS_EFFECT_BLUR_PX * 2,
  });
  return {
    apps,
    dispose() { URL.revokeObjectURL(apps); },
  };
}

/** Compatibility helper for callers that explicitly need both layers. */
export async function createWallpaperEffectPreviews(url) {
  const [appsPreview, focusPreview] = await Promise.all([
    createWallpaperAppsPreview(url),
    createWallpaperFocusPreview(url),
  ]);
  return {
    apps: appsPreview.apps,
    focus: focusPreview.focus,
    dispose() {
      appsPreview.dispose();
      focusPreview.dispose();
    },
  };
}

export async function isWallpaperUrlReachable(url, timeoutMs = IMAGE_PROBE_TIMEOUT_MS) {
  if (!url) return false;
  if (url.startsWith('data:') || isLocalWallpaperUrl(url)) return true;
  if (url.startsWith('blob:')) {
    try {
      await loadImageElement(url, false);
      return true;
    } catch {
      return false;
    }
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: 'HEAD', mode: 'cors', cache: 'force-cache', signal: controller.signal });
      if (res.ok) return true;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    /* fall through to image probe */
  }

  const minWidth = /images\.pexels\.com/i.test(url) ? MIN_CACHE_WIDTH : 400;
  try {
    await loadImageElement(url, false, { minWidth });
    return true;
  } catch {
    return false;
  }
}
