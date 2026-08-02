import { loadAnalysisSource } from './wallpaper-image.js';
import {
  getWallpaperId,
  loadLastWallpaperMeta,
  saveLastWallpaperMeta,
} from './storage.js';

export const LIGHT_TEXT_LUMINANCE = 138;
const UI_CLOCK_VIEWPORT = { x: 0.22, y: 0.10, w: 0.56, h: 0.20 };

let analysisCanvas = null;
let analysisCtx = null;

function viewportRegionToImageRegion(iw, ih, region) {
  const vw = window.innerWidth || 1920;
  const vh = window.innerHeight || 1080;
  const scale = Math.max(vw / iw, vh / ih);
  const ox = (iw * scale - vw) / 2;
  const oy = (ih * scale - vh) / 2;
  const ix = (region.x * vw + ox) / scale;
  const iy = (region.y * vh + oy) / scale;

  return {
    x: Math.max(0, Math.min(1, ix / iw)),
    y: Math.max(0, Math.min(1, iy / ih)),
    w: Math.max(0.01, Math.min(1 - ix / iw, region.w * vw / scale / iw)),
    h: Math.max(0.01, Math.min(1 - iy / ih, region.h * vh / scale / ih)),
  };
}

function getAnalysisContext(width, height) {
  if (!analysisCanvas) {
    analysisCanvas = document.createElement('canvas');
    analysisCtx = analysisCanvas.getContext('2d', { willReadFrequently: true });
  }
  analysisCanvas.width = width;
  analysisCanvas.height = height;
  return analysisCtx;
}

function sampleRegionStats(ctx, drawable, iw, ih, region, width, height) {
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(
    drawable,
    iw * region.x,
    ih * region.y,
    iw * region.w,
    ih * region.h,
    0,
    0,
    width,
    height,
  );
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const samples = [];
  for (let i = 0; i < pixels.length; i += 16) {
    samples.push(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
  }
  samples.sort((a, b) => a - b);
  return {
    max: samples.at(-1) ?? 128,
    median: samples[Math.floor(samples.length * 0.5)] ?? 128,
    p10: samples[Math.floor(samples.length * 0.1)] ?? 128,
    p25: samples[Math.floor(samples.length * 0.25)] ?? 128,
    p75: samples[Math.floor(samples.length * 0.75)] ?? 128,
  };
}

function analyzeDrawable(drawable, width, height) {
  const region = viewportRegionToImageRegion(width, height, UI_CLOCK_VIEWPORT);
  const stats = sampleRegionStats(
    getAnalysisContext(64, 28),
    drawable,
    width,
    height,
    region,
    64,
    28,
  );
  const tonalSpread = stats.p75 - stats.p25;
  const mixed = tonalSpread >= 72 || (stats.p25 < 112 && stats.p75 > 156);
  const theme = mixed
    ? 'on-mixed'
    : stats.median >= LIGHT_TEXT_LUMINANCE ? 'on-light' : 'on-dark';
  return {
    min: stats.p10,
    max: stats.max,
    theme,
  };
}

export async function analyzeWallpaperTheme(url) {
  const analysisSource = await loadAnalysisSource(url);
  try {
    return analyzeDrawable(
      analysisSource.source,
      analysisSource.width,
      analysisSource.height,
    );
  } finally {
    analysisSource.dispose?.();
  }
}

export function createWallpaperThemeController({
  getCurrentWallpaper,
  getPaintedWallpaperUrl,
}) {
  let generation = 0;
  let debounceTimer = null;
  let idleHandle = null;
  let lastAnalyzedKey = '';

  function cancelScheduledAnalysis() {
    window.clearTimeout(debounceTimer);
    debounceTimer = null;
    if (idleHandle != null && 'cancelIdleCallback' in window) {
      cancelIdleCallback(idleHandle);
    } else if (idleHandle != null) {
      window.clearTimeout(idleHandle);
    }
    idleHandle = null;
  }

  function apply(analysis) {
    const { theme } = typeof analysis === 'number'
      ? { theme: analysis >= LIGHT_TEXT_LUMINANCE ? 'on-light' : 'on-dark' }
      : analysis;
    if (document.body.dataset.textTheme === theme) return;
    document.body.dataset.textTheme = theme;
    document.body.dataset.textTone = theme === 'on-light' || theme === 'on-mixed'
      ? 'dark'
      : 'light';
  }

  function matchesCurrent(data) {
    const dataKey = getWallpaperId(data);
    const currentKey = getWallpaperId(getCurrentWallpaper());
    return !dataKey || !currentKey || dataKey === currentKey;
  }

  function fallback(data) {
    if (!matchesCurrent(data)) return false;
    const current = getCurrentWallpaper();
    const min = data?.type === 'gradient' ? (data.luminance ?? 120) : 80;
    const analysis = {
      theme: data?.type === 'gradient' && min >= LIGHT_TEXT_LUMINANCE
        ? 'on-light'
        : 'on-dark',
      min,
    };
    apply(analysis);
    current.textTheme = analysis.theme;
    current.luminance = analysis.min;
    return true;
  }

  function persist(data) {
    if (!matchesCurrent(data)) return false;
    const current = getCurrentWallpaper();
    const stored = loadLastWallpaperMeta();
    if (stored && getWallpaperId(stored) === getWallpaperId(current)) {
      saveLastWallpaperMeta(current);
    }
    return true;
  }

  async function adapt(data) {
    const runGeneration = ++generation;
    const key = data?.id || data?.url || '';
    if (!matchesCurrent(data) || (key && key === lastAnalyzedKey)) return;

    if (data?.type === 'gradient') {
      if (!fallback(data)) return;
      persist(data);
      lastAnalyzedKey = key;
      return;
    }

    const url = data?.url;
    if (!url) {
      fallback(data);
      lastAnalyzedKey = key;
      return;
    }

    try {
      const analysis = await analyzeWallpaperTheme(url);
      if (runGeneration !== generation || !matchesCurrent(data)) return;
      const current = getCurrentWallpaper();
      apply(analysis);
      if (current && (current.url === url || current.id === data.id)) {
        current.textTheme = analysis.theme;
        current.luminance = analysis.min;
      }
      persist(data);
      lastAnalyzedKey = key;
    } catch {
      if (runGeneration !== generation || !fallback(data)) return;
      persist(data);
      lastAnalyzedKey = key;
    }
  }

  function schedule(data, { immediate = false } = {}) {
    generation += 1;
    cancelScheduledAnalysis();
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      const run = () => {
        idleHandle = null;
        void adapt(data);
      };
      if ('requestIdleCallback' in window) {
        idleHandle = requestIdleCallback(run, { timeout: immediate ? 900 : 1600 });
      } else {
        idleHandle = window.setTimeout(run, immediate ? 80 : 160);
      }
    }, immediate ? 180 : 680);
  }

  async function prepareInitial() {
    const data = getCurrentWallpaper();
    if (!data || data.textTheme) return Boolean(data?.textTheme);
    const paintedUrl = getPaintedWallpaperUrl();
    await adapt(
      paintedUrl && data.type !== 'gradient' ? { ...data, url: paintedUrl } : data,
    );
    return Boolean(getCurrentWallpaper()?.textTheme);
  }

  function reset() {
    generation += 1;
    lastAnalyzedKey = '';
  }

  function dispose() {
    generation += 1;
    cancelScheduledAnalysis();
  }

  return {
    adapt,
    apply,
    dispose,
    prepareInitial,
    reset,
    schedule,
  };
}
