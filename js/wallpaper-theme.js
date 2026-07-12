import { loadAnalysisSource } from './wallpaper-image.js';

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
  const brightness = stats.p10 * 0.45 + stats.p25 * 0.35 + stats.median * 0.2;
  return {
    min: stats.p10,
    max: stats.max,
    theme: brightness >= LIGHT_TEXT_LUMINANCE ? 'on-light' : 'on-dark',
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
