import { KEYS } from './keys.js';
import {
  loadSettings,
  saveSettings,
  getWallpaperId,
  normalizeWallpaperSource,
  normalizeSelectableWallpaperSource,
  loadWallpaperRotation,
  saveWallpaperRotation,
  loadLastWallpaperMeta,
  saveLastWallpaperMeta,
  getWallpaperCacheKey,
  loadRecentWallpaperIds,
  recordRecentWallpaper,
  isRecentlyShown,
} from './storage.js';
import {
  saveWallpaperBlobCache,
  getWallpaperBlobCache,
  deleteWallpaperBlobCache,
  saveWallpaperEffectBlobCache,
  getWallpaperEffectBlobCache,
} from './media-store.js';
import {
  DEFAULT_WALLPAPER,
  isOnlineWallpaperSource,
  reconcileCuratedWallpaper,
  upgradeWallpaperUrl,
  buildBingPreviewUrl,
} from './wallpaper-data.js';
import {
  scheduleInitialSearchFocus,
  focusSearchInput,
} from './search-focus.js';
import {
  settleBootUiClasses,
  BOOT_UI_REVEAL_DELAY_MS,
} from './boot-ui.js';
import {
  isRemoteWallpaperUrl,
  isWallpaperUrlReachable,
  loadImageElement,
  measureBlobWidth,
  createWallpaperAppsPreview,
  createWallpaperFocusPreview,
  createWallpaperBootPreview,
  getWallpaperEffectVariant,
  MIN_CACHE_WIDTH,
} from './wallpaper-image.js';
import { createWallpaperEffects } from './wallpaper-effects.js';
import { analyzeWallpaperTheme, LIGHT_TEXT_LUMINANCE } from './wallpaper-theme.js';

export { isOnlineWallpaperSource };


export const WALLPAPER_SOURCE_LABELS = {
  bing: 'Bing 每日风景',
  library: '我的图库',
};

/** 设置 UI 可选壁纸来源（仅 Bing） */
export const WALLPAPER_SOURCE_ORDER = [
  'bing', 'library',
];

/** 每周自动轮换的线上壁纸源顺序（目前仅 Bing） */
export const WEEKLY_ROTATION_SOURCES = [
  'bing',
];

const ROTATION_MS = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};
const BING_WALLPAPER_DAYS = 7;

let wallpaperFetchModulePromise = null;
let wallpaperInfoModulePromise = null;
let wallpaperInfoController = null;

function loadWallpaperFetchModule() {
  wallpaperFetchModulePromise ||= import('./wallpaper-fetch.js');
  return wallpaperFetchModulePromise;
}

const blobUrlCache = new Map();

let preloadedWallpaper = null;
let preloadIdleHandle = null;
let preloadDelayTimer = 0;
let preloadStartListener = null;
let preloadGeneration = 0;
let maintenanceTimer = 0;
let maintenanceIdleHandle = null;
let maintenanceStartListener = null;
let maintenanceGeneration = 0;
let wallpaperIntentRevision = 0;
let wallpaperPaintRevision = 0;
let bootPreviewGeneration = 0;
const wallpaperCacheWrites = new Map();
const storedBootWallpaper = loadLastWallpaperMeta();
let currentWallpaper = isValidCachedWallpaperMeta(storedBootWallpaper)
  ? { ...storedBootWallpaper, type: storedBootWallpaper.type || 'image' }
  : { ...DEFAULT_WALLPAPER };
let initialWallpaperRevealed = document.body.classList.contains('boot-done');
let wallpaperFocusReadyPromise = Promise.resolve(false);
let wallpaperAppsReadyPromise = Promise.resolve(false);
const wallpaperEffects = createWallpaperEffects({
  createFocusPreview: createWallpaperFocusPreview,
  createAppsPreview: createWallpaperAppsPreview,
  getPersistentKey(kind, data) {
    const identity = data.effectKey || data.url;
    return identity ? `${getWallpaperEffectVariant(kind)}:${identity}` : '';
  },
  loadPersistentPreview: getWallpaperEffectBlobCache,
  savePersistentPreview: saveWallpaperEffectBlobCache,
});

window.addEventListener('pagehide', () => {
  window.clearTimeout(preloadDelayTimer);
  window.clearTimeout(maintenanceTimer);
  window.clearTimeout(adaptDebounceTimer);
  if (preloadIdleHandle != null && 'cancelIdleCallback' in window) cancelIdleCallback(preloadIdleHandle);
  else if (preloadIdleHandle != null) window.clearTimeout(preloadIdleHandle);
  if (maintenanceIdleHandle != null && 'cancelIdleCallback' in window) cancelIdleCallback(maintenanceIdleHandle);
  else if (maintenanceIdleHandle != null) window.clearTimeout(maintenanceIdleHandle);
  if (adaptIdleHandle != null && 'cancelIdleCallback' in window) cancelIdleCallback(adaptIdleHandle);
  else if (adaptIdleHandle != null) window.clearTimeout(adaptIdleHandle);
  if (preloadStartListener) document.removeEventListener('boot-glass-stable', preloadStartListener);
  if (maintenanceStartListener) document.removeEventListener('boot-glass-stable', maintenanceStartListener);
  wallpaperEffects.dispose();
  blobUrlCache.forEach((url) => URL.revokeObjectURL(url));
  blobUrlCache.clear();
}, { once: true });

let bootThemeAdaptPending = false;

function beginWallpaperIntent() {
  wallpaperIntentRevision += 1;
  return wallpaperIntentRevision;
}

function isWallpaperIntentCurrent(intent) {
  return intent === wallpaperIntentRevision;
}

function canRunBackgroundImageWork() {
  return !document.hidden && !navigator.connection?.saveData;
}

function loadStoredBootPreview() {
  try {
    const value = JSON.parse(localStorage.getItem(KEYS.wallpaperBootPreview) || 'null');
    return value && value.version === 2 && value.dataUrl ? value : null;
  } catch {
    return null;
  }
}

async function persistBootWallpaperPreview(data) {
  if (document.hidden || data?.type === 'gradient' || !data?.url) return;
  const key = getWallpaperCacheKey(data) || getWallpaperId(data);
  if (!key) return;
  const stored = loadStoredBootPreview();
  if (stored?.key === key && stored.sourceUrl === data.url) return;
  const generation = ++bootPreviewGeneration;
  try {
    const dataUrl = await createWallpaperBootPreview(data.url);
    if (!dataUrl || dataUrl.length > 300000 || generation !== bootPreviewGeneration) return;
    if (getWallpaperId(getCurrentWallpaper()) !== getWallpaperId(data)) return;
    localStorage.setItem(KEYS.wallpaperBootPreview, JSON.stringify({
      version: 2,
      key,
      sourceUrl: data.url,
      dataUrl,
      savedAt: Date.now(),
    }));
  } catch {
    /* startup preview is an optional perceived-performance cache */
  }
}

function deferAdaptAfterBoot() {
  bootThemeAdaptPending = true;
}

/** 在固定亮色的应用页内完成启动壁纸分析，返回首页时不再发生可见跳色。 */
export function settleDeferredWallpaperTheme() {
  if (!bootThemeAdaptPending) return Promise.resolve(false);
  bootThemeAdaptPending = false;
  return adaptTextToWallpaper(getCurrentWallpaper()).then(() => true);
}

async function enhanceBootWallpaperAsync(payload) {
  if (window.__BOOT_WALLPAPER_READY && shouldSkipWallpaperRepaint(payload)) return;
  const wallpaperId = getWallpaperId(payload);
  try {
    const enhanced = await resolveBootWallpaperPayload(payload);
    if (getWallpaperId(getCurrentWallpaper()) !== wallpaperId) return;
    if (enhanced.url && !isSameWallpaperAsset(getCurrentWallpaper(), enhanced)) {
      applyWallpaper(enhanced, {
        skipAdapt: true,
        immediateBlur: false,
        preserveUrl: true,
      });
      deferAdaptAfterBoot();
    }
    if (enhanced._hiResUrl
      && !isSameWallpaperAsset(getCurrentWallpaper(), { url: enhanced._hiResUrl })) {
      await upgradeToHiResInBackground(enhanced);
    }
  } catch { /* 保留已显示的缓存/默认图 */ }
}

async function upgradeToHiResInBackground(payload) {
  const hiResUrl = payload._hiResUrl;
  if (!hiResUrl || hiResUrl === payload.url) return;
  if (!canRunBackgroundImageWork()) return;
  if (isSameWallpaperAsset(getCurrentWallpaper(), { url: hiResUrl })) return;
  if (isBootWallpaperDisplayed({ ...payload, url: hiResUrl })) return;
  const wallpaperId = getWallpaperId(payload);
  try {
    const img = await loadImageElement(hiResUrl, isRemoteWallpaperUrl(hiResUrl));
    if (img?.decode) await img.decode().catch(() => {});
    if (getWallpaperId(getCurrentWallpaper()) !== wallpaperId) return;
    applyWallpaper({ ...payload, url: hiResUrl }, { skipAdapt: true, immediateBlur: false });
  } catch { /* 保留预览 */ }
}

async function revealBootWallpaper(payload, { skipPersist = true } = {}) {
  applyWallpaper(payload, { skipPersist, immediateBlur: false, skipAdapt: true });
  finishBootReveal();
  deferAdaptAfterBoot();
  void enhanceBootWallpaperAsync(payload);
}

/** 揭开前 decode 最终 URL（blob / UHD），只 apply 一次 */
async function resolveBootWallpaperPayload(data) {
  let reconciled = reconcileCuratedWallpaper(data);
  if (normalizeWallpaperSource(reconciled.source) === 'bing' && reconciled.url) {
    reconciled = { ...reconciled, url: upgradeWallpaperUrl(reconciled) };
  }
  if (reconciled.type === 'gradient' && reconciled.css) return reconciled;
  if (!reconciled.url) return reconciled;

  const upgradedUrl = upgradeWallpaperUrl(reconciled);
  let payload = upgradedUrl && upgradedUrl !== reconciled.url
    ? { ...reconciled, url: upgradedUrl }
    : reconciled;

  if (payload.cacheKey) {
    try {
      const blob = await getWallpaperBlobCache(payload.cacheKey);
      if (blob) {
        const width = await measureBlobWidth(blob);
        if ((!blob.type || blob.type.startsWith('image/'))
          && (width === 0 || width >= MIN_CACHE_WIDTH)) {
          const objectUrl = getBlobUrlForCacheKey(payload.cacheKey, blob);
          try {
            const img = await loadImageElement(objectUrl, false, { minWidth: MIN_CACHE_WIDTH });
            if (img?.decode) await img.decode().catch(() => {});
            return { ...payload, url: objectUrl };
          } catch {
            dropBlobUrlForCacheKey(payload.cacheKey);
          }
        }
        await deleteWallpaperBlobCache(payload.cacheKey);
        dropBlobUrlForCacheKey(payload.cacheKey);
      }
    } catch { /* fall through to HTTP */ }
  }

  const isBing = normalizeWallpaperSource(payload.source) === 'bing';
  const hiResUrl = payload.url;
  const previewUrl = isBing ? buildBingPreviewUrl(hiResUrl) : '';
  const bootUrl = previewUrl && previewUrl !== hiResUrl ? previewUrl : hiResUrl;

  const needsCrossOrigin = isRemoteWallpaperUrl(bootUrl);
  const img = await loadImageElement(bootUrl, needsCrossOrigin);
  if (img?.decode) await img.decode().catch(() => {});

  if (bootUrl !== hiResUrl) {
    return { ...payload, url: bootUrl, _hiResUrl: hiResUrl };
  }
  return payload;
}

function finishBootReveal() {
  if (initialWallpaperRevealed) return;
  initialWallpaperRevealed = true;
  document.getElementById('boot-critical-hide')?.remove();
  document.body.classList.remove('wallpaper-boot', 'boot-priming-ui');
}

async function fetchBingAndApplyInBackground(fallbackMeta, intent) {
  if (fallbackMeta && !canRunBackgroundImageWork()) return;
  try {
    const { fetchBingWallpaper } = await loadWallpaperFetchModule();
    const data = await fetchBingWallpaper(0);
    if (!isWallpaperIntentCurrent(intent)) return;
    const next = { ...data, url: upgradeWallpaperUrl(data) };
    if (isSameWallpaperImage(getCurrentWallpaper(), next)) return;
    if (fallbackMeta && isSameWallpaperImage(fallbackMeta, next)) return;
    await applyWallpaperProgressive(next, intent);
  } catch {
    if (!isWallpaperIntentCurrent(intent)) return;
    if (fallbackMeta && isValidCachedWallpaperMeta(fallbackMeta)) return;
    if (!initialWallpaperRevealed) {
      await revealBootWallpaper({ ...DEFAULT_WALLPAPER }, { skipPersist: true });
    }
  }
}

function scheduleBingRefreshAfterBoot(fallbackMeta, intent) {
  const start = () => {
    if (!isWallpaperIntentCurrent(intent)) return;
    if (document.hidden) {
      document.addEventListener('visibilitychange', start, { once: true });
      return;
    }
    const run = () => {
      if (!isWallpaperIntentCurrent(intent)) return;
      if (document.hidden) {
        document.addEventListener('visibilitychange', start, { once: true });
        return;
      }
      void fetchBingAndApplyInBackground(fallbackMeta, intent);
    };
    window.setTimeout(() => {
      if (!isWallpaperIntentCurrent(intent) || document.hidden) return;
      if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 2400 });
      else window.setTimeout(run, 160);
    }, 1200);
  };
  if (document.body.classList.contains('boot-glass-stable')) start();
  else document.addEventListener('boot-glass-stable', start, { once: true });
}

function getLocalDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function isBingDailyStale(cached) {
  if (!cached || normalizeWallpaperSource(cached.source) !== 'bing') return true;
  const today = getLocalDateKey();
  const end = String(cached.dateKey || cached.id?.replace(/^bing-/, '') || '').slice(0, 8);
  if (end && end.length >= 8 && end >= today) return false;
  if (cached.cachedAt) {
    const cachedDay = getLocalDateKey(new Date(cached.cachedAt));
    if (cachedDay >= today) return false;
  }
  return true;
}

function isValidCachedWallpaperMeta(meta) {
  if (!meta) return false;
  if (meta.type === 'gradient') return !!meta.css;
  if (!meta.url) return false;
  if (meta.url.startsWith('blob:')) return false;
  if (/^https?:\/\/www\.bing\.comblob:/i.test(meta.url)) return false;
  return true;
}

function renderWallpaperMetadata(data) {
  const title = document.getElementById('wallpaper-title');
  const desc = document.getElementById('wallpaper-desc');
  const credit = document.getElementById('wallpaper-credit');
  if (title) title.textContent = (data.title || '').trim();
  if (desc) desc.textContent = data.description || '';
  if (credit) credit.textContent = data.credit || '';
  wallpaperInfoController?.render(data);
}

export function getCurrentWallpaper() {
  return currentWallpaper;
}

function getWallpaperImgEl() {
  return document.getElementById('wallpaper-img');
}

function getWallpaperContainerEl() {
  return document.getElementById('wallpaper');
}

function getDecodedWallpaperImageUrl(data = currentWallpaper) {
  const img = getWallpaperImgEl();
  if (!img || img.hidden || !img.complete || img.naturalWidth <= 0) return '';
  const requestedUrl = img.getAttribute('src') || '';
  const decodedUrl = img.currentSrc || img.src || '';
  if (!requestedUrl || !decodedUrl) return '';
  if (data && (
    !isSameWallpaperAsset(data, { url: requestedUrl })
    || !isSameWallpaperAsset(data, { url: decodedUrl })
  )) return '';
  return decodedUrl;
}

function revealWallpaperImg(img = getWallpaperImgEl()) {
  if (!img) {
    settleBootUiClasses();
    return;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!img.classList.contains('wallpaper-show')) {
        img.classList.add('wallpaper-show');
      }
      if (!document.body.classList.contains('boot-ui-settled')) {
        window.setTimeout(settleBootUiClasses, BOOT_UI_REVEAL_DELAY_MS);
      }
    });
  });
}

function isBootWallpaperStable(cached) {
  const img = getWallpaperImgEl();
  if (!img || img.hidden) return isBootWallpaperDisplayed(cached);
  const painted = img.classList.contains('wallpaper-show')
    ? getDecodedWallpaperImageUrl(cached)
    : '';
  if (painted) return !cached || isSameWallpaperAsset(cached, { url: painted });
  const previewKey = window.__BOOT_WALLPAPER_PREVIEW_KEY || '';
  return Boolean(cached && previewKey && previewKey === getWallpaperCacheKey(cached));
}

function getPaintedWallpaperUrl() {
  const img = getWallpaperImgEl();
  const painted = img?.classList.contains('wallpaper-show')
    ? getDecodedWallpaperImageUrl()
    : '';
  if (painted) return painted;
  if (window.__BOOT_WALLPAPER_PREVIEW) return window.__BOOT_WALLPAPER_PREVIEW;
  const container = getWallpaperContainerEl();
  if (container?.classList.contains('is-gradient')) {
    return container.style.backgroundImage || 'gradient';
  }
  return '';
}

function isBootWallpaperDisplayed(cached) {
  if (!cached || !isValidCachedWallpaperMeta(cached)) return false;
  const container = getWallpaperContainerEl();
  const img = getWallpaperImgEl();
  if (cached.type === 'gradient') {
    return !!container?.classList.contains('is-gradient') && !!container.style.backgroundImage;
  }
  if (!img?.classList.contains('wallpaper-show') || !img.complete || img.naturalWidth <= 0) {
    return Boolean(
      window.__BOOT_WALLPAPER_PREVIEW
      && window.__BOOT_WALLPAPER_PREVIEW_KEY === getWallpaperCacheKey(cached),
    );
  }
  const painted = getDecodedWallpaperImageUrl(cached);
  return !!(painted && isSameWallpaperAsset(cached, { url: painted }));
}

function setBackgroundImage(el, data, { instantReveal = false, force = false } = {}) {
  const container = getWallpaperContainerEl();
  const img = getWallpaperImgEl();
  if (!container) return;

  if (data.type === 'gradient' && data.css) {
    wallpaperPaintRevision += 1;
    container.classList.add('is-gradient');
    container.style.backgroundImage = data.css;
    container.style.backgroundColor = '';
    if (img) {
      img.hidden = true;
      img.classList.remove('wallpaper-show');
      img.removeAttribute('src');
    }
    document.getElementById('wallpaper-preview')?.classList.add('is-hidden');
    settleBootUiClasses();
    if (el && el !== container) setBackgroundImage(el, data);
    return;
  }

  container.classList.remove('is-gradient');
  container.style.backgroundImage = '';
  container.style.backgroundColor = '';
  if (!img) {
    if (el && el !== container && data.url) {
      el.style.backgroundImage = `url("${data.url}")`;
    }
    return;
  }

  img.hidden = false;
  const url = data.url || '';
  if (!url) {
    wallpaperPaintRevision += 1;
    img.classList.remove('wallpaper-show');
    img.removeAttribute('src');
    return;
  }

  const requestedUrl = img.getAttribute('src') || '';
  if (!force && requestedUrl && isSameWallpaperAsset(data, { url: requestedUrl })) {
    if (img.complete && img.naturalWidth > 0 && !img.classList.contains('wallpaper-show')) {
      revealWallpaperImg(img);
    }
    if (el && el !== container && el !== img && data.url) {
      el.style.backgroundImage = `url("${data.url}")`;
    }
    return;
  }

  const finishSwap = () => {
    if (paintRevision !== wallpaperPaintRevision) return;
    revealWallpaperImg(img);
    document.getElementById('wallpaper-preview')?.classList.add('is-hidden');
    document.body.classList.add('boot-wallpaper-full-ready');
    if (instantReveal) {
      requestAnimationFrame(() => img.classList.remove('wallpaper-instant'));
    }
  };

  const paintRevision = ++wallpaperPaintRevision;
  img.addEventListener('load', finishSwap, { once: true });
  img.addEventListener('error', () => {
    if (paintRevision !== wallpaperPaintRevision) return;
    if (instantReveal) img.classList.remove('wallpaper-instant');
    else img.classList.remove('wallpaper-show');
  }, { once: true });

  if (instantReveal) {
    img.classList.add('wallpaper-instant');
    if (!img.classList.contains('wallpaper-show')) img.classList.add('wallpaper-show');
  } else {
    img.classList.remove('wallpaper-show');
  }

  if (img.getAttribute('src') !== url) img.src = url;
  else if (img.complete && img.naturalWidth > 0) finishSwap();

  if (el && el !== container && el !== img && data.url) {
    el.style.backgroundImage = `url("${data.url}")`;
    el.style.backgroundColor = '';
  }
}

function getBlurWallpaperUrl(data) {
  if (
    window.__BOOT_WALLPAPER_PREVIEW
    && window.__BOOT_WALLPAPER_PREVIEW_KEY === getWallpaperCacheKey(data)
  ) {
    const img = getWallpaperImgEl();
    if (!img?.complete || img.naturalWidth <= 0) return window.__BOOT_WALLPAPER_PREVIEW;
  }
  const painted = getDecodedWallpaperImageUrl(data);
  if (painted) return painted;
  return data?.url || '';
}

function getMatchingBootPreview(data) {
  return window.__BOOT_WALLPAPER_PREVIEW
    && window.__BOOT_WALLPAPER_PREVIEW_KEY === getWallpaperCacheKey(data)
    ? window.__BOOT_WALLPAPER_PREVIEW
    : '';
}

function getWallpaperEffectPayload(
  data = currentWallpaper,
  { preferBootPreview = false, preferSourceUrl = false } = {},
) {
  if (!data) return null;
  if (data.type === 'gradient' && data.css) {
    return { type: 'gradient', css: data.css };
  }
  return {
    type: 'image',
    url: (preferSourceUrl && data.url)
      || (preferBootPreview && getMatchingBootPreview(data))
      || getBlurWallpaperUrl(data),
    effectKey: getWallpaperCacheKey(data) || getWallpaperId(data),
  };
}

/** 搜索聚焦使用轻量预模糊图，避免开场期间处理整张高清壁纸。 */
function syncFocusWallpaperLayer(data = currentWallpaper, { defer = false } = {}) {
  if (!data) return Promise.resolve(false);
  return wallpaperEffects.sync({
    ...getWallpaperEffectPayload(data, { preferBootPreview: true }),
    defer,
  });
}

/** 第二页高清毛玻璃可在空闲期预热，也可作为进入页面的前置条件。 */
function syncBlurWallpaperLayer(data = currentWallpaper) {
  if (!data) return Promise.resolve(false);
  return wallpaperEffects.prepareApps(getWallpaperEffectPayload(data, { preferSourceUrl: true }));
}

function markInitialWallpaperEffectsReady() {
  if (document.body.classList.contains('wallpaper-effects-ready')) return;
  document.body.classList.add('wallpaper-effects-ready');
  performance.mark?.('gavinhub:effects-ready');
  document.dispatchEvent(new CustomEvent('wallpaper-effects-ready'));
}

function trackWallpaperEffects(promise) {
  wallpaperFocusReadyPromise = Promise.resolve(promise).finally(markInitialWallpaperEffectsReady);
  return wallpaperFocusReadyPromise;
}

export function syncAppsBlurWallpaper() {
  const data = getCurrentWallpaper();
  const decodedUrl = getDecodedWallpaperImageUrl(data);
  wallpaperAppsReadyPromise = syncBlurWallpaperLayer(
    decodedUrl && data?.type !== 'gradient' ? { ...data, url: decodedUrl } : data,
  );
  return wallpaperAppsReadyPromise;
}

export function syncSearchFocusWallpaper() {
  const data = getCurrentWallpaper();
  const paintedUrl = getPaintedWallpaperUrl();
  return trackWallpaperEffects(
    syncFocusWallpaperLayer(
      paintedUrl && data?.type !== 'gradient' ? { ...data, url: paintedUrl } : data,
    ),
  );
}

function scheduleBlurWallpaper(data, { defer = false } = {}) {
  const focusReady = trackWallpaperEffects(syncFocusWallpaperLayer(data, { defer }));
  if (document.body.classList.contains('page-apps-active')) {
    wallpaperAppsReadyPromise = syncBlurWallpaperLayer(data);
  }
  return focusReady;
}

export function prepareWallpaperEffects() {
  return syncAppsBlurWallpaper();
}

export function prewarmWallpaperEffects() {
  if (document.hidden) return Promise.resolve(false);
  const data = getCurrentWallpaper();
  return data
    ? wallpaperEffects.prewarmApps(getWallpaperEffectPayload(data))
    : Promise.resolve(false);
}

function getBlobUrlForCacheKey(cacheKey, blob) {
  const existing = blobUrlCache.get(cacheKey);
  if (existing) return existing;
  const objectUrl = URL.createObjectURL(blob);
  blobUrlCache.set(cacheKey, objectUrl);
  return objectUrl;
}

function dropBlobUrlForCacheKey(cacheKey) {
  const objectUrl = blobUrlCache.get(cacheKey);
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  blobUrlCache.delete(cacheKey);
}

async function persistWallpaperCache(data, { saveMeta = true } = {}) {
  const meta = saveMeta
    ? saveLastWallpaperMeta(data)
    : { ...data, cacheKey: data.cacheKey || getWallpaperCacheKey(data) };
  if (!meta || data.type === 'gradient' || !data.url || data.url.startsWith('blob:')) return meta;

  const cacheKey = meta.cacheKey;
  const pending = wallpaperCacheWrites.get(cacheKey);
  if (pending) {
    await pending;
    return meta;
  }

  const write = (async () => {
    try {
      const existing = await getWallpaperBlobCache(cacheKey);
      if (existing) {
        const existingWidth = await measureBlobWidth(existing);
        if ((!existing.type || existing.type.startsWith('image/'))
          && existingWidth >= MIN_CACHE_WIDTH) return;
        if ((!existing.type || existing.type.startsWith('image/')) && existingWidth === 0) {
          const objectUrl = URL.createObjectURL(existing);
          try {
            await loadImageElement(objectUrl, false, { minWidth: MIN_CACHE_WIDTH });
            return;
          } catch {
            /* replace an undecodable cache entry */
          } finally {
            URL.revokeObjectURL(objectUrl);
          }
        }
        await deleteWallpaperBlobCache(cacheKey);
        dropBlobUrlForCacheKey(cacheKey);
      }
      const isLocal = data.url.startsWith('data:') || !isRemoteWallpaperUrl(data.url);
      if (isLocal) return;

      let fetchUrl = upgradeWallpaperUrl(data);
      let res = await fetch(fetchUrl, { mode: 'cors', cache: 'force-cache' });
      if (!res.ok && fetchUrl !== data.url) {
        fetchUrl = data.url;
        res = await fetch(fetchUrl, { mode: 'cors', cache: 'force-cache' });
      }
      if (res.ok) {
        const blob = await res.blob();
        if (!blob.size || (blob.type && !blob.type.startsWith('image/'))) return;
        const width = await measureBlobWidth(blob);
        if (width > 0 && width < MIN_CACHE_WIDTH) return;
        await saveWallpaperBlobCache(cacheKey, blob);
      }
    } catch {
      /* cache blob is best-effort */
    }
  })();
  wallpaperCacheWrites.set(cacheKey, write);
  try {
    await write;
  } finally {
    if (wallpaperCacheWrites.get(cacheKey) === write) wallpaperCacheWrites.delete(cacheKey);
  }
  return meta;
}

function cacheMatchesSource(meta, source) {
  if (!meta) return false;
  source = normalizeWallpaperSource(source);
  if (source === 'library') {
    const { wallpaperId } = loadSettings();
    if (wallpaperId) return meta.source === 'library' && meta.id === wallpaperId;
    return meta.source === 'library';
  }
  if (source === 'local') return meta.source === 'local';
  return normalizeWallpaperSource(meta.source) === source;
}

export function shouldRefreshWallpaper(source, cached = loadLastWallpaperMeta()) {
  source = normalizeWallpaperSource(source);
  if (source === 'local') return false;
  if (source === 'library') {
    const { wallpaperId } = loadSettings();
    return !cached || !cacheMatchesSource(cached, source) || (wallpaperId && cached.id !== wallpaperId);
  }
  if (!cached || !cacheMatchesSource(cached, source)) return true;

  if (source === 'bing') {
    return isBingDailyStale(cached);
  }

  const rotation = loadWallpaperRotation();
  if (!rotation.interval || rotation.interval === 'manual') return false;
  return isWallpaperRotationDue(rotation);
}

export function isWallpaperRevealComplete() {
  return initialWallpaperRevealed;
}

function verifyCachedWallpaperInBackground(meta, source, intent) {
  if (!meta?.url || meta.type === 'gradient') return;
  const wallpaperId = getWallpaperId(meta);
  void isWallpaperUrlReachable(meta.url).then((ok) => {
    if (ok || !isWallpaperIntentCurrent(intent)) return;
    if (getWallpaperId(getCurrentWallpaper()) !== wallpaperId) return;
    return loadWallpaper(source, { force: true });
  }).catch(() => {});
}

export async function restoreWallpaperFromCache(
  source = getInitialWallpaperSource(),
  intent = wallpaperIntentRevision,
) {
  const meta = loadLastWallpaperMeta();
  if (!isValidCachedWallpaperMeta(meta)) return false;
  if (!cacheMatchesSource(meta, source)) return false;
  if (!isWallpaperIntentCurrent(intent)) return false;

  if (meta.textTheme) {
    applyTextTheme({ theme: meta.textTheme, min: meta.luminance ?? 120 });
  }

  if (initialWallpaperRevealed) {
    if (isBootWallpaperDisplayed(meta)) {
      currentWallpaper = { ...reconcileCuratedWallpaper(meta), type: meta.type || 'image' };
      return true;
    }
    applyWallpaper(meta, { skipPersist: true, skipAdapt: true, immediateBlur: false });
    void enhanceBootWallpaperAsync(meta);
  } else {
    await revealBootWallpaper(meta);
  }

  if (!isWallpaperIntentCurrent(intent)) return false;

  if (meta.type !== 'gradient' && meta.url) {
    const restoredWallpaperId = getWallpaperId(meta);
    isWallpaperUrlReachable(meta.url).then((ok) => {
      if (ok || !isWallpaperIntentCurrent(intent)) return;
      if (getWallpaperId(getCurrentWallpaper()) !== restoredWallpaperId) return;
      loadWallpaper(source, { force: true }).catch(() => {});
    });
  }
  return true;
}

export async function initWallpaperDisplay(source = getInitialWallpaperSource()) {
  if (initialWallpaperRevealed) return;
  await loadWallpaper(source);
}

async function waitForBootFadeComplete() {
  if (!initialWallpaperRevealed) finishBootReveal();
}

function onWallpaperChanged(data) {
  const prev = loadLastWallpaperMeta();
  const prevId = prev ? getWallpaperId(prev) : '';
  const nextId = getWallpaperId(data);
  if (prevId !== nextId) touchWallpaperRotation();
  recordRecentWallpaper(data);
  const meta = saveLastWallpaperMeta(data);
  if (meta && !data.url?.startsWith('blob:')) scheduleWallpaperMaintenance(meta);
}

function scheduleWallpaperMaintenance(data) {
  const generation = ++maintenanceGeneration;
  window.clearTimeout(maintenanceTimer);
  if (maintenanceIdleHandle != null && 'cancelIdleCallback' in window) {
    cancelIdleCallback(maintenanceIdleHandle);
  } else if (maintenanceIdleHandle != null) {
    window.clearTimeout(maintenanceIdleHandle);
  }
  maintenanceIdleHandle = null;
  if (maintenanceStartListener) {
    document.removeEventListener('boot-glass-stable', maintenanceStartListener);
    maintenanceStartListener = null;
  }
  if (!canRunBackgroundImageWork()) return;

  const run = async () => {
    maintenanceIdleHandle = null;
    if (generation !== maintenanceGeneration || !canRunBackgroundImageWork()) return;
    await persistBootWallpaperPreview(data);
    if (generation !== maintenanceGeneration || !canRunBackgroundImageWork()) return;
    await persistWallpaperCache(data, { saveMeta: false });
    if (generation !== maintenanceGeneration || !canRunBackgroundImageWork()) return;
    schedulePreloadNext(data);
  };
  const queue = () => {
    maintenanceStartListener = null;
    maintenanceTimer = window.setTimeout(() => {
      maintenanceTimer = 0;
      if (generation !== maintenanceGeneration || !canRunBackgroundImageWork()) return;
      if ('requestIdleCallback' in window) {
        maintenanceIdleHandle = requestIdleCallback(run, { timeout: 5000 });
      } else {
        maintenanceIdleHandle = window.setTimeout(run, 240);
      }
    }, 2200);
  };
  if (document.body.classList.contains('boot-glass-stable')) queue();
  else {
    maintenanceStartListener = queue;
    document.addEventListener('boot-glass-stable', queue, { once: true });
  }
}

function schedulePreloadNext(data) {
  const gen = ++preloadGeneration;
  window.clearTimeout(preloadDelayTimer);
  if (preloadIdleHandle != null && 'cancelIdleCallback' in window) {
    cancelIdleCallback(preloadIdleHandle);
  } else if (preloadIdleHandle != null) {
    clearTimeout(preloadIdleHandle);
  }
  preloadIdleHandle = null;
  if (preloadStartListener) {
    document.removeEventListener('boot-glass-stable', preloadStartListener);
    preloadStartListener = null;
  }
  if (!canRunBackgroundImageWork()) return;

  const run = () => {
    preloadIdleHandle = null;
    if (gen !== preloadGeneration || !canRunBackgroundImageWork()) return;
    void preloadNextBingWallpaper(data, gen);
  };
  const queue = () => {
    preloadStartListener = null;
    preloadDelayTimer = window.setTimeout(() => {
      preloadDelayTimer = 0;
      if (gen !== preloadGeneration || !canRunBackgroundImageWork()) return;
      if ('requestIdleCallback' in window) {
        preloadIdleHandle = requestIdleCallback(run, { timeout: 1800 });
      } else {
        preloadIdleHandle = setTimeout(run, 240);
      }
    }, 5000);
  };
  if (document.body.classList.contains('boot-glass-stable')) queue();
  else {
    preloadStartListener = queue;
    document.addEventListener('boot-glass-stable', queue, { once: true });
  }
}

async function preloadNextBingWallpaper(current, gen = preloadGeneration) {
  try {
    if (gen !== preloadGeneration || !canRunBackgroundImageWork()) return;
    const recent = loadRecentWallpaperIds();
    const { fetchNextBingWallpaper } = await loadWallpaperFetchModule();
    const next = await fetchNextBingWallpaper(recent);
    if (gen !== preloadGeneration || !canRunBackgroundImageWork()) return;
    if (!next?.url || isSameWallpaperImage(next, current)) return;
    const targetUrl = upgradeWallpaperUrl(next) || next.url;
    const displayUrl = resolveSwitchDisplayUrl({ ...next, source: 'bing' }, targetUrl);
    const preloadUrl = displayUrl || targetUrl;
    await loadImageElement(preloadUrl, isRemoteWallpaperUrl(preloadUrl));
    if (gen !== preloadGeneration || !canRunBackgroundImageWork()) return;
    if (targetUrl !== preloadUrl && canRunBackgroundImageWork()) {
      loadImageElement(targetUrl, true).catch(() => {});
    }
    preloadedWallpaper = { ...next, source: 'bing' };
  } catch { /* 预加载失败不影响当前壁纸 */ }
}

function resolveSwitchDisplayUrl(data, targetUrl) {
  const source = normalizeWallpaperSource(data.source);
  if (source === 'bing') {
    const preview = data.previewUrl || buildBingPreviewUrl(targetUrl);
    if (preview && preview !== targetUrl) return preview;
  }
  return targetUrl;
}

async function upgradeWallpaperToTargetUrl(payload, fallbackPayload) {
  try {
    await loadImageElement(payload.url, isRemoteWallpaperUrl(payload.url));
    if (getWallpaperId(getCurrentWallpaper()) !== getWallpaperId(payload)) return;
    const painted = getPaintedWallpaperUrl();
    if (!painted || painted === payload.url) return;
    applyWallpaper(payload, {
      preserveUrl: true,
      forceRepaint: true,
      immediateBlur: true,
      instantReveal: true,
    });
  } catch {
    if (!fallbackPayload) return;
    if (getWallpaperId(getCurrentWallpaper()) !== getWallpaperId(fallbackPayload)) return;
    applyWallpaper(fallbackPayload, {
      preserveUrl: true,
      adaptImmediate: true,
      immediateBlur: true,
    });
  }
}

async function applyWallpaperSwitch(data) {
  const targetUrl = upgradeWallpaperUrl(data) || data.url;
  if (!targetUrl && data.type !== 'gradient') return currentWallpaper;

  const displayUrl = resolveSwitchDisplayUrl(data, targetUrl);
  if (displayUrl && data.type !== 'gradient') {
    await loadImageElement(displayUrl, isRemoteWallpaperUrl(displayUrl));
  }
  const displayPayload = { ...data, url: displayUrl, previewUrl: data.previewUrl };
  applyWallpaper(
    displayPayload,
    {
      preserveUrl: true,
      forceRepaint: true,
      adaptImmediate: true,
      immediateBlur: true,
      instantReveal: true,
    },
  );

  if (displayUrl !== targetUrl) {
    void upgradeWallpaperToTargetUrl(
      { ...data, url: targetUrl, previewUrl: data.previewUrl },
      displayPayload,
    );
  }
  return currentWallpaper;
}


let adaptGeneration = 0;
let adaptDebounceTimer = null;
let adaptIdleHandle = null;
let lastAnalyzedWallpaperKey = '';

function scheduleAdaptTextToWallpaper(data, { immediate = false } = {}) {
  window.clearTimeout(adaptDebounceTimer);
  adaptDebounceTimer = null;
  if (adaptIdleHandle != null && 'cancelIdleCallback' in window) {
    cancelIdleCallback(adaptIdleHandle);
  } else if (adaptIdleHandle != null) {
    window.clearTimeout(adaptIdleHandle);
  }
  adaptIdleHandle = null;
  adaptDebounceTimer = window.setTimeout(() => {
    adaptDebounceTimer = null;
    const run = () => {
      adaptIdleHandle = null;
      void adaptTextToWallpaper(data);
    };
    if ('requestIdleCallback' in window) {
      adaptIdleHandle = requestIdleCallback(run, { timeout: immediate ? 900 : 1600 });
    } else {
      adaptIdleHandle = window.setTimeout(run, immediate ? 80 : 160);
    }
  }, immediate ? 180 : 680);
}

function applyTextTheme(analysis) {
  const { theme } = typeof analysis === 'number'
    ? { theme: analysis >= LIGHT_TEXT_LUMINANCE ? 'on-light' : 'on-dark' }
    : analysis;
  if (document.body.dataset.textTheme === theme) return;
  document.body.dataset.textTheme = theme;
  document.body.dataset.textTone = theme === 'on-light' || theme === 'on-mixed' ? 'dark' : 'light';
}

function fallbackTextTheme(data) {
  if (data?.type === 'gradient') {
    applyTextTheme({ theme: (data.luminance ?? 120) >= LIGHT_TEXT_LUMINANCE ? 'on-light' : 'on-dark', min: data.luminance ?? 120 });
    return;
  }
  applyTextTheme({ theme: 'on-dark', min: 80 });
  const k = data?.id || data?.url || '';
  if (k) lastAnalyzedWallpaperKey = k;
}


export async function adaptTextToWallpaper(data) {
  const gen = ++adaptGeneration;
  const key = data?.id || data?.url || '';
  const cur = getCurrentWallpaper();
  const curKey = getWallpaperId(cur);
  const dataKey = getWallpaperId(data);

  if (dataKey && curKey && dataKey !== curKey) return;
  if (key && key === lastAnalyzedWallpaperKey) {
    return;
  }

  if (data.type === 'gradient') {
    const lum = data.luminance ?? 120;
    applyTextTheme({ theme: lum >= LIGHT_TEXT_LUMINANCE ? 'on-light' : 'on-dark', min: lum });
    lastAnalyzedWallpaperKey = key;
    return;
  }

  const url = data.url;
  if (!url) {
    fallbackTextTheme(data);
    lastAnalyzedWallpaperKey = key;
    return;
  }

  try {
    const analysis = await analyzeWallpaperTheme(url);
    if (gen !== adaptGeneration) return;
    applyTextTheme(analysis);
    const current = getCurrentWallpaper();
    if (current && dataKey && getWallpaperId(current) !== dataKey) return;
    if (current && (current.url === url || current.id === data.id)) {
      current.textTheme = analysis.theme;
      current.luminance = analysis.min;
    }
    lastAnalyzedWallpaperKey = key;
  } catch {
    if (gen !== adaptGeneration) return;
    fallbackTextTheme(data);
    lastAnalyzedWallpaperKey = key;
  }
}

/** 首屏解析最终 URL 后，与 UI 共用一次显现时间轴。 */
async function applyWallpaperWithInitialReveal(data, opts = {}) {
  if (initialWallpaperRevealed) {
    applyWallpaper(data, opts);
    return;
  }
  await revealBootWallpaper(data, opts);
}

export function applyWallpaper(data, {
  skipPersist = false,
  immediateBlur = false,
  skipAdapt = false,
  adaptImmediate = false,
  instantReveal = false,
  forceRepaint = false,
  preserveUrl = false,
} = {}) {
  // 兜底解除历史启动标记，避免异常数据让 UI 一直保持启动状态。
  if (!initialWallpaperRevealed) {
    finishBootReveal();
  }

  const reconciled = reconcileCuratedWallpaper(data);
  let payload = reconciled;
  if (!preserveUrl) {
    const hiResUrl = upgradeWallpaperUrl(reconciled);
    if (hiResUrl && hiResUrl !== reconciled.url) {
      payload = { ...reconciled, url: hiResUrl };
    }
  }
  const previousWallpaper = currentWallpaper;
  const prevWallpaperId = getWallpaperId(previousWallpaper);
  const skipRepaint = !forceRepaint && shouldSkipWallpaperRepaint(payload, previousWallpaper);
  currentWallpaper = { ...payload, type: payload.type || 'image' };
  if (payload.textTheme) {
    currentWallpaper.textTheme = payload.textTheme;
    currentWallpaper.luminance = payload.luminance ?? payload.min;
  }
  const nextWallpaperId = getWallpaperId(currentWallpaper);
  if (nextWallpaperId && nextWallpaperId !== prevWallpaperId) {
    lastAnalyzedWallpaperKey = '';
    if (!payload.textTheme && payload.type !== 'gradient') {
      applyTextTheme({ theme: 'on-dark', min: 80 });
    }
  }
  const wallpaper = document.getElementById('wallpaper');
  if (!skipRepaint) {
    setBackgroundImage(wallpaper, currentWallpaper, { instantReveal, force: forceRepaint });
  }
  scheduleBlurWallpaper(currentWallpaper, {
    defer: initialWallpaperRevealed && Boolean(nextWallpaperId && nextWallpaperId !== prevWallpaperId),
  });
  if (!skipAdapt) {
    scheduleAdaptTextToWallpaper(currentWallpaper, { immediate: adaptImmediate });
  }

  renderWallpaperMetadata(payload);

  if (!skipPersist) onWallpaperChanged(currentWallpaper);
}


function isSameWallpaper(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  if (a.url && b.url && a.url === b.url) return true;
  return false;
}

function getWallpaperImageIdentity(data) {
  if (!data) return '';
  if (data.type === 'gradient') return data.css || data.id || 'gradient';
  const url = data.url || '';
  if (!url) return data.id || '';
  const bing = url.match(/[?&]id=(OHR\.[^&]+)/i);
  if (bing) {
    return bing[1]
      .replace(/_UHD\.jpg$/i, '')
      .replace(/_1920x1080\.jpg$/i, '')
      .replace(/_1366x768\.jpg$/i, '')
      .replace(/\.jpg$/i, '');
  }
  return url.split('?')[0];
}

function isSameWallpaperImage(a, b) {
  if (isSameWallpaper(a, b)) return true;
  if (!a || !b) return false;
  const aKey = getWallpaperImageIdentity(a);
  const bKey = getWallpaperImageIdentity(b);
  return !!(aKey && bKey && aKey === bKey);
}

function normalizeWallpaperAssetUrl(url) {
  if (!url) return '';
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return url;
  }
}

function isSameWallpaperAsset(a, b) {
  if (!a || !b) return false;
  if (a.type === 'gradient' || b.type === 'gradient') {
    return a.type === b.type && Boolean(a.css) && a.css === b.css;
  }
  const aUrl = normalizeWallpaperAssetUrl(a.url);
  const bUrl = normalizeWallpaperAssetUrl(b.url);
  return Boolean(aUrl && bUrl && aUrl === bUrl);
}

function shouldSkipWallpaperRepaint(payload, previous = currentWallpaper) {
  if (!initialWallpaperRevealed) return false;
  const paintedUrl = getPaintedWallpaperUrl();
  if (!paintedUrl || paintedUrl === 'none') return false;
  if (isSameWallpaperAsset(previous, payload)) return true;
  if (isSameWallpaperAsset({ url: paintedUrl }, payload)) return true;
  return false;
}

function ensureWallpaperDomPainted() {
  if (isBootWallpaperDisplayed(loadLastWallpaperMeta())) return;
  const wp = getWallpaperContainerEl();
  if (!wp) return;
  const paintedUrl = getPaintedWallpaperUrl();
  if (paintedUrl && paintedUrl !== 'none') return;
  const meta = loadLastWallpaperMeta();
  if (meta && isValidCachedWallpaperMeta(meta)) {
    applyWallpaper(meta, { skipPersist: true, skipAdapt: true, immediateBlur: false });
    return;
  }
  applyWallpaper({ ...DEFAULT_WALLPAPER }, { skipPersist: true, skipAdapt: true, immediateBlur: false });
}

async function commitNextWallpaper(data, intent) {
  if (!isWallpaperIntentCurrent(intent)) return currentWallpaper;
  lastAnalyzedWallpaperKey = '';
  await applyWallpaperSwitch(data);
  if (!isWallpaperIntentCurrent(intent)) return currentWallpaper;
  saveSettings({
    wallpaperId: data.id || data.dateKey || '',
    wallpaperSource: normalizeSelectableWallpaperSource(data.source || 'bing'),
  });
  return currentWallpaper;
}

export async function loadNextWallpaper() {
  const intent = beginWallpaperIntent();
  const previous = { ...currentWallpaper };
  const recent = loadRecentWallpaperIds();
  const { fetchNextBingWallpaper } = await loadWallpaperFetchModule();

  if (preloadedWallpaper?.url
    && !isSameWallpaperImage(preloadedWallpaper, previous)
    && !isRecentlyShown(preloadedWallpaper, recent)) {
    const next = preloadedWallpaper;
    preloadedWallpaper = null;
    return await commitNextWallpaper({ ...next, source: 'bing' }, intent);
  }

  for (let attempt = 0; attempt < BING_WALLPAPER_DAYS; attempt += 1) {
    try {
      const data = await fetchNextBingWallpaper(recent);
      if (!isWallpaperIntentCurrent(intent)) return currentWallpaper;
      if (!data?.url || isSameWallpaperImage(data, previous)) continue;
      return await commitNextWallpaper({ ...data, source: 'bing' }, intent);
    } catch {
      if (!isWallpaperIntentCurrent(intent)) return currentWallpaper;
      /* try next day in archive */
    }
  }

  await applyBingFallbackWallpaper(previous, intent);
  return currentWallpaper;
}

async function applyBingFallbackWallpaper(previous = null, intent = wallpaperIntentRevision) {
  const { fetchBingWallpaper } = await loadWallpaperFetchModule();
  for (let idx = 0; idx < BING_WALLPAPER_DAYS; idx += 1) {
    try {
      const data = await fetchBingWallpaper(idx);
      if (!isWallpaperIntentCurrent(intent)) return currentWallpaper;
      if (previous && isSameWallpaperImage(data, previous)) continue;
      if (data?.url) {
        await applyWallpaperSwitch({ ...data, source: 'bing' });
        return currentWallpaper;
      }
    } catch {
      if (!isWallpaperIntentCurrent(intent)) return currentWallpaper;
      /* try next idx */
    }
  }
  if (!isWallpaperIntentCurrent(intent)) return currentWallpaper;
  applyWallpaper({ ...DEFAULT_WALLPAPER }, { adaptImmediate: true });
  return currentWallpaper;
}

export function getInitialWallpaperSource() {
  const settings = loadSettings();
  const rotation = loadWallpaperRotation();
  if (rotation.interval === 'weekly') {
    const idx = ((rotation.weekSourceIndex % WEEKLY_ROTATION_SOURCES.length) + WEEKLY_ROTATION_SOURCES.length) % WEEKLY_ROTATION_SOURCES.length;
    return WEEKLY_ROTATION_SOURCES[idx];
  }
  return normalizeSelectableWallpaperSource(settings.wallpaperSource);
}

export function isWallpaperRotationDue(rotation = loadWallpaperRotation()) {
  if (!rotation.interval || rotation.interval === 'manual') return false;
  const ms = ROTATION_MS[rotation.interval];
  if (!ms) return false;
  return Date.now() - (rotation.lastChange || 0) >= ms;
}

export function touchWallpaperRotation() {
  saveWallpaperRotation({ lastChange: Date.now() });
}

export async function applyWallpaperRotation(onSourceChange) {
  const rotation = loadWallpaperRotation();
  if (rotation.interval === 'manual' || !isWallpaperRotationDue(rotation)) {
    return null;
  }

  if (rotation.interval === 'weekly') {
    const nextIndex = (rotation.weekSourceIndex + 1) % WEEKLY_ROTATION_SOURCES.length;
    const source = WEEKLY_ROTATION_SOURCES[nextIndex];
    saveSettings({ wallpaperSource: source, wallpaperRotationIndex: nextIndex });
    saveWallpaperRotation({ lastChange: Date.now(), weekSourceIndex: nextIndex });
    if (typeof onSourceChange === 'function') onSourceChange(source);
    return { type: 'source', source };
  }

  /* hourly / daily：同来源内换下一张（Bing 走历史索引），不要反复加载同一张今日图 */
  saveWallpaperRotation({ lastChange: Date.now() });
  const source = normalizeSelectableWallpaperSource(loadSettings().wallpaperSource);
  return { type: 'next', source };
}

export function initWallpaperRotation(onRotate, { runImmediately = false } = {}) {
  const rotation = loadWallpaperRotation();
  if (!rotation.interval || rotation.interval === 'manual') return null;
  let running = false;
  const tick = async () => {
    if (running || document.hidden) return;
    running = true;
    try {
      const result = await applyWallpaperRotation((nextSource) => {
        const select = document.getElementById('wallpaper-source');
        if (select) select.value = nextSource;
      });
      if (!result) return;
      if (result.type === 'next' && result.source === 'bing') {
        await loadNextWallpaper();
        await onRotate(result.source, { advanced: true });
        return;
      }
      await onRotate(result.source, { advanced: false });
    } catch (error) {
      console.warn('[GavinHub] wallpaper rotation failed', error);
    } finally {
      running = false;
    }
  };

  if (runImmediately) void tick();
  return setInterval(tick, 60 * 1000);
}

async function applyWallpaperProgressive(data, intent) {
  if (!isWallpaperIntentCurrent(intent)) return currentWallpaper;
  if (!initialWallpaperRevealed && isBootWallpaperDisplayed(data)) return currentWallpaper;
  const source = normalizeWallpaperSource(data.source);
  let payload = data;
  if (source !== 'bing') {
    try {
      const { ensureReachableWallpaper } = await loadWallpaperFetchModule();
      payload = await ensureReachableWallpaper(data, { sourceHint: data.source });
    } catch {
      /* keep original payload */
    }
  }
  if (!isWallpaperIntentCurrent(intent)) return currentWallpaper;

  const hiResUrl = upgradeWallpaperUrl(payload);
  const previewUrl = payload.previewUrl
    || (source === 'bing' ? buildBingPreviewUrl(hiResUrl) : '');

  let previewPayload = null;
  if (previewUrl && previewUrl !== hiResUrl) {
    previewPayload = { ...payload, url: previewUrl };
    try {
      await loadImageElement(previewUrl, isRemoteWallpaperUrl(previewUrl));
    } catch {
      previewPayload = null;
    }
    if (!isWallpaperIntentCurrent(intent)) return currentWallpaper;
    if (previewPayload && !isSameWallpaperAsset(getCurrentWallpaper(), previewPayload)) {
      applyWallpaper(previewPayload, { skipPersist: true, immediateBlur: false, skipAdapt: true });
    }
    try {
      await loadImageElement(hiResUrl, isRemoteWallpaperUrl(hiResUrl));
    } catch {
      if (!isWallpaperIntentCurrent(intent)) return currentWallpaper;
      if (previewPayload) {
        applyWallpaper(previewPayload, {
          preserveUrl: true,
          adaptImmediate: true,
          immediateBlur: true,
        });
      }
      return currentWallpaper;
    }
  }

  if (!isWallpaperIntentCurrent(intent)) return currentWallpaper;
  const finalPayload = { ...payload, url: hiResUrl, previewUrl };
  if (!isSameWallpaperAsset(getCurrentWallpaper(), finalPayload)) {
    applyWallpaper(finalPayload, { adaptImmediate: true });
  }
  return currentWallpaper;
}

async function fetchWallpaperParallel(intent) {
  const { fetchBingWallpaper } = await loadWallpaperFetchModule();
  let lastError = new Error('Bing wallpaper failed');
  for (let idx = 0; idx < BING_WALLPAPER_DAYS; idx += 1) {
    try {
      const data = await fetchBingWallpaper(idx);
      if (!isWallpaperIntentCurrent(intent)) return currentWallpaper;
      if (!data?.url) throw new Error('No wallpaper url');
      await applyWallpaperProgressive({ ...data, source: 'bing' }, intent);
      return currentWallpaper;
    } catch (err) {
      if (!isWallpaperIntentCurrent(intent)) return currentWallpaper;
      lastError = err;
    }
  }
  throw lastError;
}

async function loadWallpaperForSource(source, intent) {
  const { fetchWallpaperData } = await loadWallpaperFetchModule();
  const data = await fetchWallpaperData(source);
  if (!isWallpaperIntentCurrent(intent)) return currentWallpaper;
  if (source === 'local' || source === 'library' || source === 'builtin') {
    applyWallpaper(data, { adaptImmediate: true });
    return currentWallpaper;
  }
  await applyWallpaperProgressive(data, intent);
  return currentWallpaper;
}

async function fetchWallpaperForSource(source, intent) {
  if (source === 'bing') return fetchWallpaperParallel(intent);
  return loadWallpaperForSource(source, intent);
}

export async function loadWallpaper(source = 'bing', { force = false } = {}) {
  const intent = beginWallpaperIntent();
  source = normalizeSelectableWallpaperSource(source);
  let cached = loadLastWallpaperMeta();
  if (cached && !isValidCachedWallpaperMeta(cached)) {
    cached = null;
  }
  const hasCache = cacheMatchesSource(cached, source);
  const needsRefresh = force || !hasCache || shouldRefreshWallpaper(source, cached);

  if (!force && isBootWallpaperStable(cached)) {
    currentWallpaper = { ...reconcileCuratedWallpaper(cached), type: cached.type || 'image' };
    const img = getWallpaperImgEl();
    if (window.__BOOT_WALLPAPER_PREVIEW && (!img?.complete || img.naturalWidth <= 0)) {
      verifyCachedWallpaperInBackground(cached, source, intent);
    }
    schedulePreloadNext(currentWallpaper);
    return currentWallpaper;
  }

  ensureWallpaperDomPainted();

  if (initialWallpaperRevealed && cached && isValidCachedWallpaperMeta(cached)) {
    currentWallpaper = { ...reconcileCuratedWallpaper(cached), type: cached.type || 'image' };
  }

  if (!initialWallpaperRevealed) {
    if (hasCache) {
      await restoreWallpaperFromCache(source, intent);
    } else {
      await revealBootWallpaper({ ...DEFAULT_WALLPAPER }, { skipPersist: true });
    }
    if (!isWallpaperIntentCurrent(intent)) return currentWallpaper;
  }

  if (source === 'bing' && needsRefresh && !force) {
    scheduleBingRefreshAfterBoot(hasCache ? cached : null, intent);
    schedulePreloadNext(getCurrentWallpaper());
    return currentWallpaper;
  }

  if (!force && !needsRefresh) {
    if (cached && isValidCachedWallpaperMeta(cached)) {
      currentWallpaper = { ...reconcileCuratedWallpaper(cached), type: cached.type || 'image' };
    }
    schedulePreloadNext(getCurrentWallpaper());
    return currentWallpaper;
  }

  await waitForBootFadeComplete();
  if (!isWallpaperIntentCurrent(intent)) return currentWallpaper;

  try {
    await fetchWallpaperForSource(source, intent);
  } catch {
    if (!isWallpaperIntentCurrent(intent)) return currentWallpaper;
    if (!initialWallpaperRevealed) {
      await applyWallpaperWithInitialReveal({ ...DEFAULT_WALLPAPER }, { skipPersist: true });
    } else {
      await applyBingFallbackWallpaper(null, intent);
    }
  }

  return currentWallpaper;
}

export async function applySelectedWallpaper(data) {
  beginWallpaperIntent();
  if (data?.type !== 'gradient' && data?.url) {
    try {
      await loadImageElement(data.url, isRemoteWallpaperUrl(data.url));
    } catch {
      /* apply below so the existing image error fallback remains authoritative */
    }
  }
  applyWallpaper(data, { adaptImmediate: true });
  saveSettings({ wallpaperId: data.id || data.dateKey || '', wallpaperSource: 'library' });
  return currentWallpaper;
}

export async function initWallpaperInfo() {
  if (wallpaperInfoController) return wallpaperInfoController;
  wallpaperInfoModulePromise ||= import('./wallpaper-info.js');
  const { createWallpaperInfoController } = await wallpaperInfoModulePromise;
  wallpaperInfoController = createWallpaperInfoController({
    getCurrentWallpaper,
    loadNextWallpaper,
    schedulePreloadNext,
  });
  wallpaperInfoController?.render(getCurrentWallpaper());
  return wallpaperInfoController;
}
