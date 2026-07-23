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
} from './wallpaper-library.js';
import {
  DEFAULT_WALLPAPER,
  isOnlineWallpaperSource,
  fetchWallpaperData,
  fetchBingWallpaper,
  fetchNextBingWallpaper,
  BING_WALLPAPER_DAYS,
  ensureReachableWallpaper,
  reconcileCuratedWallpaper,
  upgradeWallpaperUrl,
  buildBingPreviewUrl,
} from './wallpaper-fetch.js';
import {
  scheduleInitialSearchFocus,
  focusSearchInput,
  refreshSearchGlass,
} from './search-focus.js';
import {
  settleBootUiClasses,
  onBootUiSettled,
  BOOT_UI_REVEAL_DELAY_MS,
} from './boot-ui.js';
import {
  isLocalWallpaperUrl,
  isWallpaperUrlReachable,
  loadImageElement,
  measureBlobWidth,
  createWallpaperEffectPreviews,
  MIN_CACHE_WIDTH,
} from './wallpaper-image.js';
import { createWallpaperEffects } from './wallpaper-effects.js';
import { analyzeWallpaperTheme, LIGHT_TEXT_LUMINANCE } from './wallpaper-theme.js';

export { isOnlineWallpaperSource };


export const WALLPAPER_SOURCE_LABELS = {
  bing: 'Bing 每日风景',
};

/** 设置 UI 可选壁纸来源（仅 Bing） */
export const WALLPAPER_SOURCE_ORDER = [
  'bing',
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

const blobUrlCache = new Map();

let preloadedWallpaper = null;
let preloadIdleHandle = null;
let preloadGeneration = 0;
let currentWallpaper = { ...DEFAULT_WALLPAPER };
let initialWallpaperRevealed = document.body.classList.contains('boot-done');
const wallpaperEffects = createWallpaperEffects({
  createPreviews: createWallpaperEffectPreviews,
});

window.addEventListener('pagehide', wallpaperEffects.dispose, { once: true });

const BOOT_ADAPT_AFTER_UI_MS = 180;

function canRunBackgroundImageWork() {
  return !document.hidden && !navigator.connection?.saveData;
}

function deferAdaptAfterBoot() {
  const run = () => {
    scheduleAdaptTextToWallpaper(getCurrentWallpaper(), { immediate: true });
  };
  if (!document.body.classList.contains('boot-ui-settled')) {
    onBootUiSettled(() => window.setTimeout(run, BOOT_ADAPT_AFTER_UI_MS));
  } else {
    window.setTimeout(run, BOOT_ADAPT_AFTER_UI_MS);
  }
}

async function enhanceBootWallpaperAsync(payload) {
  if (window.__BOOT_WALLPAPER_READY && shouldSkipWallpaperRepaint(payload)) return;
  const wallpaperId = getWallpaperId(payload);
  try {
    const enhanced = await resolveBootWallpaperPayload(payload);
    if (getWallpaperId(getCurrentWallpaper()) !== wallpaperId) return;
    if (isSameWallpaperImage(getCurrentWallpaper(), enhanced)) return;
    if (enhanced.url && !isSameWallpaperImage(getCurrentWallpaper(), { ...enhanced, url: enhanced.url })) {
      applyWallpaper(enhanced, { skipAdapt: true, immediateBlur: false });
      deferAdaptAfterBoot();
    } else if (enhanced._hiResUrl && !isSameWallpaperImage(getCurrentWallpaper(), { ...enhanced, url: enhanced._hiResUrl })) {
      await upgradeToHiResInBackground(enhanced);
    }
  } catch { /* 保留已显示的缓存/默认图 */ }
}

async function upgradeToHiResInBackground(payload) {
  const hiResUrl = payload._hiResUrl;
  if (!hiResUrl || hiResUrl === payload.url) return;
  if (!canRunBackgroundImageWork()) return;
  if (isSameWallpaperImage(getCurrentWallpaper(), { ...payload, url: hiResUrl })) return;
  if (isBootWallpaperDisplayed({ ...payload, url: hiResUrl })) return;
  const wallpaperId = getWallpaperId(payload);
  try {
    const img = await loadImageElement(hiResUrl, /^https?:/i.test(hiResUrl));
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
        if (width === 0 || width >= MIN_CACHE_WIDTH) {
          const objectUrl = getBlobUrlForCacheKey(payload.cacheKey, blob);
          const img = await loadImageElement(objectUrl, false);
          if (img?.decode) await img.decode().catch(() => {});
          return { ...payload, url: objectUrl };
        }
      }
    } catch { /* fall through to HTTP */ }
  }

  const isBing = normalizeWallpaperSource(payload.source) === 'bing';
  const hiResUrl = payload.url;
  const previewUrl = isBing ? buildBingPreviewUrl(hiResUrl) : '';
  const bootUrl = previewUrl && previewUrl !== hiResUrl ? previewUrl : hiResUrl;

  const needsCrossOrigin = /^https?:/i.test(bootUrl);
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
  document.getElementById('boot-cover')?.remove();
  document.body.classList.remove('wallpaper-boot', 'boot-priming-ui');
}

async function fetchBingAndApplyInBackground(fallbackMeta) {
  if (fallbackMeta && !canRunBackgroundImageWork()) return;
  try {
    const data = await fetchBingWallpaper(0);
    const next = { ...data, url: upgradeWallpaperUrl(data) };
    if (isSameWallpaperImage(getCurrentWallpaper(), next)) return;
    if (fallbackMeta && isSameWallpaperImage(fallbackMeta, next)) return;
    await applyWallpaperProgressive(next);
  } catch {
    if (fallbackMeta && isValidCachedWallpaperMeta(fallbackMeta)) return;
    if (!initialWallpaperRevealed) {
      await revealBootWallpaper({ ...DEFAULT_WALLPAPER }, { skipPersist: true });
    }
  }
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

async function bootFetchAndRevealBing(fallbackMeta) {
  void fetchBingAndApplyInBackground(fallbackMeta);
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

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function setNextButtonLoading(loading) {
  const btn = document.getElementById('wallpaper-next-btn');
  if (!btn) return;
  btn.disabled = loading;
  btn.classList.toggle('is-loading', loading);
  btn.textContent = loading ? '加载中…' : '下一张';
}

function shouldShowWallpaperNextButton() {
  return normalizeSelectableWallpaperSource(loadSettings().wallpaperSource) === 'bing';
}

function updateWallpaperNextButton() {
  const btn = document.getElementById('wallpaper-next-btn');
  if (!btn) return;
  btn.hidden = !shouldShowWallpaperNextButton();
}

const GENERIC_WALLPAPER_TITLES = new Set([
  'NASA 每日一图',
  'NASA 地球俯瞰',
  'Bing 每日风景',
  '国家地理每日',
  '维基百科 · 每日一图',
  'Google Earth View',
  '每日风景',
]);

const NON_LINKABLE_SOURCES = new Set(['gradient', 'random', 'picsum']);

const BUILTIN_POETIC_TITLES = new Set([
  '山湖晨雾',
  '河谷石桥',
  '海岸公路',
  '森林晨路',
]);

const KNOWN_PLACE_TITLES = new Set([
  '赫兹桑德海岸',
]);

const TITLE_BLOCKLIST = /NASA|EPIC|DSCOVR|地球全彩|地球|卫星|随机|摄影|APOD|太空|orbit|每日一图|每日壁纸|Earth View|Earth Observatory|Astronomy/i;

const PLACE_HINTS = /(?:[湾海岸山湖岛城堡塔公园]|National Park|Bay|Coast|Island|Tower|Cathedral|Temple|Palace|Volcano|Canyon|Desert|Falls|Lake|River)/i;

const GENERIC_CN_SCENIC = /^(?:山湖|河谷|海岸|森林|随机|自然|风景|每日|壁纸|晨雾|石桥|公路|晨路)/;

const CREDIT_NOISE = /©|Getty|Shutterstock|Alamy|iStock|Images|Adobe|摄/i;

function getBaikeUrl(name) {
  return `https://baike.baidu.com/item/${encodeURIComponent(name)}`;
}

function buildWikipediaPageUrl(title) {
  if (!title?.trim()) return '';
  const page = title.trim().replace(/ /g, '_');
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(page).replace(/%3A/g, ':')}`;
}

function getWallpaperExternalUrl(data) {
  if (!data) return null;
  if (data.pageUrl) return data.pageUrl;
  if (data.linkUrl) return data.linkUrl;

  const source = normalizeWallpaperSource(data.source);

  switch (source) {
    case 'wikimedia': {
      const title = (data.title || '').trim();
      if (!title || title === '维基百科 · 每日一图') return null;
      return buildWikipediaPageUrl(title);
    }
    case 'local':
    case 'library': {
      const linkName = getWallpaperLinkName(data);
      return linkName ? getBaikeUrl(linkName) : null;
    }
    default:
      return null;
  }
}

function extractPlaceFromBingCopyright(copyright) {
  if (!copyright) return '';
  const parenMatch = copyright.match(/[（(]([^）)]+)[）)]/);
  if (parenMatch) {
    const inner = parenMatch[1].trim();
    if (inner.length >= 2 && !CREDIT_NOISE.test(inner)) {
      const part = inner.split(/[,，/／]/)[0].trim();
      if (part.length >= 2) return part;
    }
  }
  for (const segment of copyright.split('/')) {
    const cleaned = segment.replace(/^©\s*/i, '').trim();
    if (cleaned.length < 3 || CREDIT_NOISE.test(cleaned) || !/[A-Za-z]/.test(cleaned)) continue;
    const place = cleaned.split(',')[0].trim();
    if (place.length >= 3) return place;
  }
  return '';
}

function looksLikePlaceName(title) {
  const t = title.trim();
  if (!t || GENERIC_WALLPAPER_TITLES.has(t) || BUILTIN_POETIC_TITLES.has(t)) return false;
  if (TITLE_BLOCKLIST.test(t)) return false;
  if (KNOWN_PLACE_TITLES.has(t)) return true;
  if (GENERIC_CN_SCENIC.test(t)) return false;
  if (PLACE_HINTS.test(t)) {
    const prefix = t.replace(/(?:湾|海岸|海|山|岛|城|塔|湖|公园|瀑布|峡谷|沙漠|广场|寺|庙|宫|陵|古道).*$/u, '').trim();
    if (prefix.length >= 2 && !GENERIC_CN_SCENIC.test(prefix)) return true;
  }
  if (/^[\u4e00-\u9fff]{2,}(?:国家森林公园|国家级|风景区|世界遗产|古城|古镇|斜塔)?$/.test(t)) return true;
  if (/^[A-Za-z][A-Za-z\s,''-]{2,}$/.test(t) && t.split(/\s+/).length <= 8) {
    if (/^(?:The\s+)?(?:Daily|Random|Photo|Picture|Image|View|Landscape|Nature|Scenic)/i.test(t)) return false;
    return true;
  }
  return false;
}

function isFamousPlaceTitle(title, source, meta = {}) {
  const name = title?.trim();
  if (!name) return false;

  source = normalizeWallpaperSource(source);
  if (NON_LINKABLE_SOURCES.has(source)) return false;
  if (source === 'gradient' || meta?.type === 'gradient') return false;
  if (meta?.url && /picsum\.photos/i.test(meta.url)) return false;
  if (GENERIC_WALLPAPER_TITLES.has(name) || BUILTIN_POETIC_TITLES.has(name)) return false;
  if (TITLE_BLOCKLIST.test(name)) return false;

  if (source === 'builtin') return false;

  if (source === 'local' || source === 'library') {
    return KNOWN_PLACE_TITLES.has(name) || looksLikePlaceName(name);
  }

  if (source === 'bing') {
    return name.length >= 2 && !TITLE_BLOCKLIST.test(name) && name !== '每日风景';
  }

  if (source === 'natgeo' || source === 'wikimedia' || source === 'unsplash-curated' || source === 'pexels-scenic') {
    return looksLikePlaceName(name);
  }

  return false;
}

function getWallpaperLinkName(data) {
  const title = (data.title || '').trim();
  const source = normalizeWallpaperSource(data.source);
  if (isFamousPlaceTitle(title, source, data)) return title;
  if (source === 'bing') {
    const fromCredit = extractPlaceFromBingCopyright(data.credit);
    if (fromCredit && isFamousPlaceTitle(fromCredit, source, data)) return fromCredit;
  }
  return null;
}

function renderWallpaperTitle(el, data) {
  if (!el) return;
  const displayName = (data.title || '').trim();
  const externalUrl = getWallpaperExternalUrl(data);
  el.replaceChildren();
  if (externalUrl) {
    const link = document.createElement('a');
    link.href = externalUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = displayName;
    el.appendChild(link);
    return;
  }
  el.textContent = displayName;
}

function syncWallpaperInfoLink(info, data) {
  if (!info) return;
  const externalUrl = getWallpaperExternalUrl(data);
  const linkable = !!externalUrl;
  info.classList.toggle('is-linkable', linkable);
  if (linkable) {
    info.dataset.linkUrl = externalUrl;
  } else {
    delete info.dataset.linkUrl;
  }
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
  const painted = img.currentSrc || img.src || '';
  if (!painted) return false;
  if (!cached) return !!painted;
  return isSameWallpaperImage(cached, { ...cached, url: painted });
}

function getPaintedWallpaperUrl() {
  const img = getWallpaperImgEl();
  if (img && !img.hidden && (img.currentSrc || img.src)) {
    return img.currentSrc || img.src;
  }
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
  if (!img?.classList.contains('wallpaper-show')) return false;
  const painted = img.currentSrc || img.src || '';
  return !!(painted && isSameWallpaperImage(cached, { ...cached, url: painted }));
}

function setBackgroundImage(el, data, { instantReveal = false, force = false } = {}) {
  const container = getWallpaperContainerEl();
  const img = getWallpaperImgEl();
  if (!container) return;

  if (data.type === 'gradient' && data.css) {
    container.classList.add('is-gradient');
    container.style.backgroundImage = data.css;
    container.style.backgroundColor = '';
    if (img) {
      img.hidden = true;
      img.classList.remove('wallpaper-show');
      img.removeAttribute('src');
    }
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
    img.classList.remove('wallpaper-show');
    img.removeAttribute('src');
    return;
  }

  const painted = img.currentSrc || img.src || '';
  if (!force && painted && isSameWallpaperImage(data, { ...data, url: painted })) {
    if (!img.classList.contains('wallpaper-show')) revealWallpaperImg(img);
    if (el && el !== container && el !== img && data.url) {
      el.style.backgroundImage = `url("${data.url}")`;
    }
    return;
  }

  const finishSwap = () => {
    revealWallpaperImg(img);
    if (instantReveal) {
      requestAnimationFrame(() => img.classList.remove('wallpaper-instant'));
    }
  };

  img.addEventListener('load', finishSwap, { once: true });
  img.addEventListener('error', () => {
    if (instantReveal) img.classList.remove('wallpaper-instant');
    else img.classList.remove('wallpaper-show');
  }, { once: true });

  if (instantReveal) {
    img.classList.add('wallpaper-instant');
    if (!img.classList.contains('wallpaper-show')) img.classList.add('wallpaper-show');
  } else {
    img.classList.remove('wallpaper-show');
  }

  if (img.src !== url) img.src = url;
  else if (img.complete && img.naturalWidth > 0) finishSwap();

  if (el && el !== container && el !== img && data.url) {
    el.style.backgroundImage = `url("${data.url}")`;
    el.style.backgroundColor = '';
  }
}

function getBlurWallpaperUrl(data) {
  const img = getWallpaperImgEl();
  const painted = img?.currentSrc || img?.src || '';
  if (painted && data?.url && isSameWallpaperImage(data, { ...data, url: painted })) {
    return painted;
  }
  return data?.url || '';
}

/** 同步模糊层壁纸 — 应用页依赖此层，不可 idle 延迟 */
function syncBlurWallpaperLayer(data = currentWallpaper) {
  if (!data) return;

  if (data.type === 'gradient' && data.css) {
    wallpaperEffects.sync({ type: 'gradient', css: data.css });
    return;
  }

  const url = getBlurWallpaperUrl(data);
  wallpaperEffects.sync({ type: 'image', url });
}

export function syncAppsBlurWallpaper() {
  const data = getCurrentWallpaper();
  const paintedUrl = getPaintedWallpaperUrl();
  syncBlurWallpaperLayer(
    paintedUrl && data?.type !== 'gradient' ? { ...data, url: paintedUrl } : data,
  );
}

function scheduleBlurWallpaper(data) {
  syncBlurWallpaperLayer(data);
}

function revokeBlobUrl(cacheKey) {
  const existing = blobUrlCache.get(cacheKey);
  if (existing) {
    URL.revokeObjectURL(existing);
    blobUrlCache.delete(cacheKey);
  }
}

function getBlobUrlForCacheKey(cacheKey, blob) {
  revokeBlobUrl(cacheKey);
  const objectUrl = URL.createObjectURL(blob);
  blobUrlCache.set(cacheKey, objectUrl);
  return objectUrl;
}

async function persistWallpaperCache(data) {
  const meta = saveLastWallpaperMeta(data);
  if (!meta || data.type === 'gradient' || !data.url || data.url.startsWith('blob:')) return meta;

  const cacheKey = meta.cacheKey;
  try {
    if (await getWallpaperBlobCache(cacheKey)) return meta;
    const isLocal = data.url.startsWith('data:') || !/^https?:/i.test(data.url);
    if (isLocal) return meta;

    let fetchUrl = upgradeWallpaperUrl(data);
    let res = await fetch(fetchUrl, { mode: 'cors', cache: 'force-cache' });
    if (!res.ok && fetchUrl !== data.url) {
      fetchUrl = data.url;
      res = await fetch(fetchUrl, { mode: 'cors', cache: 'force-cache' });
    }
    if (res.ok) {
      const blob = await res.blob();
      const width = await measureBlobWidth(blob);
      if (width > 0 && width < MIN_CACHE_WIDTH) return meta;
      if (blob.size) await saveWallpaperBlobCache(cacheKey, blob);
    }
  } catch {
    /* cache blob is best-effort */
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

export async function restoreWallpaperFromCache(source = getInitialWallpaperSource()) {
  const meta = loadLastWallpaperMeta();
  if (!isValidCachedWallpaperMeta(meta)) return false;
  if (!cacheMatchesSource(meta, source)) return false;

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

  if (meta.type !== 'gradient' && meta.url) {
    isWallpaperUrlReachable(meta.url).then((ok) => {
      if (!ok) {
        loadWallpaper(source, { force: true }).catch(() => applyBingFallbackWallpaper());
      }
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

async function upgradeWallpaperFromBlobCache(meta) {
  if (!meta?.cacheKey || meta.type === 'gradient') return;
  try {
    const blob = await getWallpaperBlobCache(meta.cacheKey);
    if (!blob) return;
    const width = await measureBlobWidth(blob);
    if (width > 0 && width < MIN_CACHE_WIDTH) return;
    const objectUrl = getBlobUrlForCacheKey(meta.cacheKey, blob);
    const current = getCurrentWallpaper();
    if (getWallpaperCacheKey(current) !== meta.cacheKey) return;
    applyWallpaper(
      { ...meta, url: objectUrl },
      { skipPersist: true, immediateBlur: false, adaptImmediate: true },
    );
  } catch {
    /* keep HTTP url */
  }
}

function onWallpaperChanged(data) {
  const prev = loadLastWallpaperMeta();
  const prevId = prev ? getWallpaperId(prev) : '';
  const nextId = getWallpaperId(data);
  if (prevId !== nextId) touchWallpaperRotation();
  recordRecentWallpaper(data);
  persistWallpaperCache(data);
  schedulePreloadNext(data);
}

function schedulePreloadNext(data) {
  const gen = ++preloadGeneration;
  if (preloadIdleHandle != null && 'cancelIdleCallback' in window) {
    cancelIdleCallback(preloadIdleHandle);
  } else if (preloadIdleHandle != null) {
    clearTimeout(preloadIdleHandle);
  }
  preloadIdleHandle = null;
  if (!canRunBackgroundImageWork()) return;

  const run = () => {
    preloadIdleHandle = null;
    if (gen !== preloadGeneration || !canRunBackgroundImageWork()) return;
    void preloadNextBingWallpaper(data, gen);
  };
  if ('requestIdleCallback' in window) {
    preloadIdleHandle = requestIdleCallback(run, { timeout: 2500 });
  } else {
    preloadIdleHandle = setTimeout(run, 800);
  }
}

async function preloadNextBingWallpaper(current, gen = preloadGeneration) {
  try {
    if (gen !== preloadGeneration || !canRunBackgroundImageWork()) return;
    const recent = loadRecentWallpaperIds();
    const next = await fetchNextBingWallpaper(recent);
    if (gen !== preloadGeneration || !canRunBackgroundImageWork()) return;
    if (!next?.url || isSameWallpaperImage(next, current)) return;
    const targetUrl = upgradeWallpaperUrl(next) || next.url;
    const displayUrl = resolveSwitchDisplayUrl({ ...next, source: 'bing' }, targetUrl);
    const preloadUrl = displayUrl || targetUrl;
    await loadImageElement(preloadUrl, /^https?:/i.test(preloadUrl));
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

async function upgradeWallpaperToTargetUrl(payload) {
  try {
    await loadImageElement(payload.url, /^https?:/i.test(payload.url));
    if (getWallpaperId(getCurrentWallpaper()) !== getWallpaperId(payload)) return;
    const painted = getPaintedWallpaperUrl();
    if (!painted || painted === payload.url) return;
    applyWallpaper(payload, {
      preserveUrl: true,
      forceRepaint: true,
      skipPersist: true,
      immediateBlur: true,
      instantReveal: true,
    });
  } catch { /* 保留当前已显示的预览/壁纸 */ }
}

async function applyWallpaperSwitch(data) {
  const targetUrl = upgradeWallpaperUrl(data) || data.url;
  if (!targetUrl && data.type !== 'gradient') return currentWallpaper;

  const displayUrl = resolveSwitchDisplayUrl(data, targetUrl);
  applyWallpaper(
    { ...data, url: displayUrl, previewUrl: data.previewUrl },
    {
      preserveUrl: true,
      forceRepaint: true,
      adaptImmediate: true,
      immediateBlur: true,
      instantReveal: true,
    },
  );

  if (displayUrl !== targetUrl) {
    void upgradeWallpaperToTargetUrl({ ...data, url: targetUrl, previewUrl: data.previewUrl });
  }
  return currentWallpaper;
}


let adaptGeneration = 0;
let adaptDebounceTimer = null;
let lastAnalyzedWallpaperKey = '';

function scheduleAdaptTextToWallpaper(data, { immediate = false } = {}) {
  clearTimeout(adaptDebounceTimer);
  adaptDebounceTimer = null;
  if (immediate) {
    adaptTextToWallpaper(data);
    return;
  }
  adaptDebounceTimer = setTimeout(() => {
    adaptDebounceTimer = null;
    adaptTextToWallpaper(data);
  }, 120);
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

/**
 * 首屏：resolve 最终 URL → 黑纱下 apply → 仅淡出遮罩，UI 遮罩消失后显现
 */
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
  // 兜底：如果首屏还没有通过 reveal 路径解除 boot 状态，这里也确保解除，避免 UI 一直被压暗
  // 但如果正在进行图片首屏 reveal（cover 仍存在且未标记 revealed），不要抢先移除黑纱
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
  }
  const wallpaper = document.getElementById('wallpaper');
  if (!skipRepaint) {
    setBackgroundImage(wallpaper, currentWallpaper, { instantReveal, force: forceRepaint });
  }
  if (immediateBlur) {
    setBackgroundImage(document.getElementById('wallpaper-blur'), currentWallpaper);
  } else {
    scheduleBlurWallpaper(currentWallpaper);
  }
  if (!skipAdapt) {
    scheduleAdaptTextToWallpaper(currentWallpaper, { immediate: adaptImmediate });
  }

  const title = document.getElementById('wallpaper-title');
  const desc = document.getElementById('wallpaper-desc');
  const credit = document.getElementById('wallpaper-credit');
  const info = document.getElementById('wallpaper-info');
  renderWallpaperTitle(title, payload);
  syncWallpaperInfoLink(info, payload);
  if (desc) desc.textContent = payload.description || '';
  if (credit) credit.textContent = payload.credit || '';
  updateWallpaperNextButton();

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

function shouldSkipWallpaperRepaint(payload, previous = currentWallpaper) {
  if (!initialWallpaperRevealed) return false;
  const paintedUrl = getPaintedWallpaperUrl();
  if (!paintedUrl || paintedUrl === 'none') return false;
  if (isSameWallpaperImage(previous, payload)) return true;
  if (isSameWallpaperImage({ ...payload, url: paintedUrl }, payload)) return true;
  if (payload.type === 'gradient') return false;
  const url = payload.url || '';
  if (url && paintedUrl.includes(url.split('?')[0].slice(-48))) return true;
  const identity = getWallpaperImageIdentity(payload);
  if (identity && identity.startsWith('OHR.') && paintedUrl.includes(identity.slice(0, 24))) return true;
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

async function commitNextWallpaper(data) {
  lastAnalyzedWallpaperKey = '';
  await applyWallpaperSwitch(data);
  saveSettings({
    wallpaperId: data.id || data.dateKey || '',
    wallpaperSource: normalizeSelectableWallpaperSource(data.source || 'bing'),
  });
  return currentWallpaper;
}

export async function loadNextWallpaper() {
  const previous = { ...currentWallpaper };
  const recent = loadRecentWallpaperIds();

  if (preloadedWallpaper?.url
    && !isSameWallpaperImage(preloadedWallpaper, previous)
    && !isRecentlyShown(preloadedWallpaper, recent)) {
    const next = preloadedWallpaper;
    preloadedWallpaper = null;
    return await commitNextWallpaper({ ...next, source: 'bing' });
  }

  for (let attempt = 0; attempt < BING_WALLPAPER_DAYS; attempt += 1) {
    try {
      const data = await fetchNextBingWallpaper(recent);
      if (!data?.url || isSameWallpaperImage(data, previous)) continue;
      return await commitNextWallpaper({ ...data, source: 'bing' });
    } catch {
      /* try next day in archive */
    }
  }

  await applyBingFallbackWallpaper(previous);
  return currentWallpaper;
}

async function applyBingFallbackWallpaper(previous = null) {
  for (let idx = 0; idx < BING_WALLPAPER_DAYS; idx += 1) {
    try {
      const data = await fetchBingWallpaper(idx);
      if (previous && isSameWallpaperImage(data, previous)) continue;
      if (data?.url) {
        await applyWallpaperSwitch({ ...data, source: 'bing' });
        return currentWallpaper;
      }
    } catch {
      /* try next idx */
    }
  }
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
  if (!runImmediately && (!rotation.interval || rotation.interval === 'manual')) return null;
  const tick = async () => {
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
  };

  if (runImmediately) tick();
  return setInterval(tick, 60 * 1000);
}

async function applyWallpaperProgressive(data) {
  if (!initialWallpaperRevealed && isBootWallpaperDisplayed(data)) return currentWallpaper;
  const source = normalizeWallpaperSource(data.source);
  let payload = data;
  try {
    payload = await ensureReachableWallpaper(data, { sourceHint: data.source });
  } catch {
    /* keep original payload */
  }

  const hiResUrl = upgradeWallpaperUrl(payload);
  const previewUrl = payload.previewUrl
    || (source === 'bing' ? buildBingPreviewUrl(hiResUrl) : '');

  if (previewUrl && previewUrl !== hiResUrl) {
    const previewPayload = { ...payload, url: previewUrl };
    if (!isSameWallpaperImage(getCurrentWallpaper(), previewPayload)) {
      applyWallpaper(previewPayload, { skipPersist: true, immediateBlur: false, skipAdapt: true });
    }
    try {
      await loadImageElement(hiResUrl, /^https?:/i.test(hiResUrl));
    } catch {
      if (!isSameWallpaperImage(getCurrentWallpaper(), { ...payload, url: hiResUrl })) {
        applyWallpaper({ ...payload, url: hiResUrl }, { adaptImmediate: true });
      }
      return currentWallpaper;
    }
  }

  const finalPayload = { ...payload, url: hiResUrl, previewUrl };
  if (!isSameWallpaperImage(getCurrentWallpaper(), finalPayload)) {
    applyWallpaper(finalPayload, { adaptImmediate: true });
  }
  return currentWallpaper;
}

async function fetchWallpaperParallel() {
  let lastError = new Error('Bing wallpaper failed');
  for (let idx = 0; idx < BING_WALLPAPER_DAYS; idx += 1) {
    try {
      const data = await fetchBingWallpaper(idx);
      if (!data?.url) throw new Error('No wallpaper url');
      await applyWallpaperProgressive({ ...data, source: 'bing' });
      return currentWallpaper;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function loadWallpaperForSource(source) {
  const data = await fetchWallpaperData(source);
  if (source === 'local' || source === 'library' || source === 'builtin') {
    applyWallpaper(data, { adaptImmediate: true });
    return currentWallpaper;
  }
  await applyWallpaperProgressive(data);
  return currentWallpaper;
}

export async function loadWallpaper(source = 'bing', { force = false } = {}) {
  source = normalizeSelectableWallpaperSource(source);
  let cached = loadLastWallpaperMeta();
  if (cached && !isValidCachedWallpaperMeta(cached)) {
    cached = null;
  }
  const hasCache = cacheMatchesSource(cached, source);
  const needsRefresh = force || !hasCache || shouldRefreshWallpaper(source, cached);

  if (!force && isBootWallpaperStable(cached)) {
    currentWallpaper = { ...reconcileCuratedWallpaper(cached), type: cached.type || 'image' };
    schedulePreloadNext(currentWallpaper);
    return currentWallpaper;
  }

  ensureWallpaperDomPainted();

  if (initialWallpaperRevealed && cached && isValidCachedWallpaperMeta(cached)) {
    currentWallpaper = { ...reconcileCuratedWallpaper(cached), type: cached.type || 'image' };
  }

  if (!initialWallpaperRevealed) {
    if (hasCache) {
      await restoreWallpaperFromCache(source);
    } else {
      await revealBootWallpaper({ ...DEFAULT_WALLPAPER }, { skipPersist: true });
    }
  }

  if (source === 'bing' && needsRefresh && !force) {
    void fetchBingAndApplyInBackground(hasCache ? cached : null);
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

  try {
    await fetchWallpaperForSource(source);
  } catch {
    if (!initialWallpaperRevealed) {
      await applyWallpaperWithInitialReveal({ ...DEFAULT_WALLPAPER }, { skipPersist: true });
    } else {
      await applyBingFallbackWallpaper();
    }
  }

  return currentWallpaper;
}

export async function applySelectedWallpaper(data) {
  applyWallpaper(data, { adaptImmediate: true });
  saveSettings({ wallpaperId: data.id || data.dateKey || '', wallpaperSource: 'library' });
  return currentWallpaper;
}

export function initWallpaperInfo() {
  const trigger = document.getElementById('wallpaper-info-btn');
  const info = document.getElementById('wallpaper-info');
  const zone = trigger?.closest('.wallpaper-info-zone');
  if (!trigger || !info || !zone) return;

  let hideTimer = null;
  let pinned = false;

  const show = () => {
    clearTimeout(hideTimer);
    info.hidden = false;
    requestAnimationFrame(() => info.classList.add('visible'));
    if (!preloadedWallpaper) schedulePreloadNext(getCurrentWallpaper());
  };

  const hide = () => {
    if (pinned) return;
    info.classList.remove('visible');
    hideTimer = setTimeout(() => {
      if (!pinned) info.hidden = true;
    }, 250);
  };

  const scheduleHide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 120);
  };

  zone.addEventListener('mouseenter', show);
  zone.addEventListener('mouseleave', scheduleHide);
  info.addEventListener('mouseenter', show);
  info.addEventListener('mouseleave', scheduleHide);

  info.addEventListener('click', (e) => {
    if (e.target.closest('#wallpaper-next-btn')) return;
    const url = info.dataset.linkUrl;
    if (!url || !info.classList.contains('is-linkable')) return;
    if (e.target.closest('a')) return;
    e.preventDefault();
    window.open(url, '_blank', 'noopener,noreferrer');
  });

  const nextBtn = document.getElementById('wallpaper-next-btn');
  nextBtn?.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!shouldShowWallpaperNextButton()) return;
    setNextButtonLoading(true);
    try {
      await loadNextWallpaper();
    } catch {
      /* keep current wallpaper on failure */
    } finally {
      setNextButtonLoading(false);
    }
  });

  info.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    pinned = true;
    show();
  }, { passive: true });

  document.addEventListener('mousedown', (e) => {
    if (!pinned) return;
    if (zone.contains(e.target) || info.contains(e.target)) return;
    pinned = false;
    hide();
  }, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pinned) {
      pinned = false;
      hide();
    }
  }, { passive: true });

  updateWallpaperNextButton();
}
