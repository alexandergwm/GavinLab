import { KEYS } from './keys.js';
import {
  loadSettings,
  getWallpaperFavorites,
  normalizeWallpaperSource,
  loadRecentWallpaperIds,
  loadWallpaperRotation,
  isRecentlyShown,
} from './storage.js';
import {
  getLibraryWallpaper,
  libraryEntryToWallpaper,
} from './media-store.js';
import {
  UNSPLASH_CURATED,
  PEXELS_CURATED,
  buildUnsplashUrl,
} from './wallpaper-curated.js';
import { corsProxyUrls } from './util.js';
import {
  isWallpaperUrlReachable,
} from './wallpaper-image.js';
import {
  DEFAULT_WALLPAPER,
  ONLINE_WALLPAPER_SOURCES,
  isOnlineWallpaperSource,
  buildBingPreviewUrl,
  buildBingUhdUrlFromUrlBase,
  upgradeBingWallpaperUrl,
  buildWikipediaPageUrl,
  upgradeWallpaperUrl,
  curatedEntryToWallpaper,
  reconcileCuratedWallpaper,
} from './wallpaper-data.js';

export {
  DEFAULT_WALLPAPER,
  ONLINE_WALLPAPER_SOURCES,
  isOnlineWallpaperSource,
  buildBingPreviewUrl,
  buildBingUhdUrlFromUrlBase,
  upgradeBingWallpaperUrl,
  upgradeWallpaperUrl,
  reconcileCuratedWallpaper,
};

const FETCH_TIMEOUT_MS = 9000;
const BING_FETCH_TIMEOUT_MS = 6500;
const BING_HEDGE_DELAY_MS = 280;

const BUILTIN_WALLPAPERS = UNSPLASH_CURATED.slice(0, 8).map((item) => ({
  id: item.id.replace(/^u-/, 'builtin-'),
  url: buildUnsplashUrl(item.photoId),
  title: item.title,
  description: item.description,
  credit: item.credit,
  dateKey: item.id,
  source: 'builtin',
}));

const NATGEO_RSS_URLS = [
  'https://rsshub.app/nationalgeographic/dailyphoto',
  'https://feeds.nationalgeographic.com/ng/Photography/Photo-Of-The-Day',
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function firstSuccessfulStaggered(attempts, delayMs = 0) {
  return new Promise((resolve, reject) => {
    let started = 0;
    let failed = 0;
    let settled = false;
    let timer = 0;
    let lastError = new Error('All requests failed');

    const startNext = () => {
      if (settled || started >= attempts.length) return;
      window.clearTimeout(timer);
      const attempt = attempts[started];
      started += 1;
      Promise.resolve()
        .then(attempt)
        .then((value) => {
          if (!value) throw new Error('Empty response');
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          failed += 1;
          lastError = error;
          if (settled) return;
          if (started < attempts.length) startNext();
          else if (failed >= attempts.length) reject(lastError);
        });
      if (started < attempts.length) timer = window.setTimeout(startNext, delayMs);
    };

    if (!attempts.length) {
      reject(lastError);
      return;
    }
    startNext();
  });
}

export async function ensureReachableWallpaper(data, { sourceHint } = {}) {
  if (!data?.url && data?.type !== 'gradient') throw new Error('No wallpaper url');
  if (data.type === 'gradient') return data;
  if (await isWallpaperUrlReachable(data.url)) return data;

  const source = normalizeWallpaperSource(sourceHint || data.source);
  if (source === 'bing' || source === 'local' || source === 'library') return data;
  if (source === 'unsplash-curated' || source === 'builtin') {
    try {
      return await pickReachableCuratedWallpaper(UNSPLASH_CURATED, source === 'builtin' ? 'builtin' : 'unsplash-curated');
    } catch {
      return data;
    }
  }
  if (source === 'pexels-scenic') {
    try {
      return await pickReachableCuratedWallpaper(PEXELS_CURATED, 'pexels-scenic');
    } catch {
      return data;
    }
  }
  return data;
}

async function pickReachableCuratedWallpaper(pool, source, { random = false, excludeRecent = [] } = {}) {
  const recentIds = new Set(excludeRecent.map((item) => item.id).filter(Boolean));
  let candidates = pool.filter((item) => !recentIds.has(item.id));
  if (!candidates.length) candidates = [...pool];

  if (random) {
    for (let i = candidates.length - 1; i > 0; i -= 1) {
      const j = randomInt(0, i);
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
  }

  for (const item of candidates) {
    const data = curatedEntryToWallpaper(item, source);
    if (await isWallpaperUrlReachable(data.url)) return data;
  }
  return curatedEntryToWallpaper(candidates[0], source);
}

export function pickCuratedWallpaper(pool, source, { random = false, excludeRecent = [] } = {}) {
  const recentIds = new Set(excludeRecent.map((item) => item.id).filter(Boolean));
  let candidates = pool.filter((item) => !recentIds.has(item.id));
  if (!candidates.length) candidates = [...pool];

  let item;
  if (random) {
    item = candidates[randomInt(0, candidates.length - 1)];
  } else {
    const day = new Date().toISOString().slice(0, 10);
    let hash = 0;
    for (let i = 0; i < day.length; i += 1) {
      hash = (hash * 31 + day.charCodeAt(i)) >>> 0;
    }
    item = candidates[hash % candidates.length];
  }
  return curatedEntryToWallpaper(item, source);
}

function fetchUnsplashCuratedWallpaper() {
  return pickCuratedWallpaper(UNSPLASH_CURATED, 'unsplash-curated');
}

async function fetchUnsplashCuratedWallpaperValidated() {
  try {
    const data = fetchUnsplashCuratedWallpaper();
    return await ensureReachableWallpaper(data, { sourceHint: 'unsplash-curated' });
  } catch {
    return pickReachableCuratedWallpaper(UNSPLASH_CURATED, 'unsplash-curated');
  }
}

function fetchRandomUnsplashCurated(excludeRecent = loadRecentWallpaperIds()) {
  return pickCuratedWallpaper(UNSPLASH_CURATED, 'unsplash-curated', { random: true, excludeRecent });
}

async function fetchRandomUnsplashCuratedValidated(excludeRecent = loadRecentWallpaperIds()) {
  try {
    const data = fetchRandomUnsplashCurated(excludeRecent);
    return await ensureReachableWallpaper(data, { sourceHint: 'unsplash-curated' });
  } catch {
    return pickReachableCuratedWallpaper(UNSPLASH_CURATED, 'unsplash-curated', { random: true, excludeRecent });
  }
}

function fetchPexelsScenicWallpaper() {
  return pickCuratedWallpaper(PEXELS_CURATED, 'pexels-scenic');
}

async function fetchPexelsScenicWallpaperValidated() {
  try {
    const data = fetchPexelsScenicWallpaper();
    return await ensureReachableWallpaper(data, { sourceHint: 'pexels-scenic' });
  } catch {
    return pickReachableCuratedWallpaper(PEXELS_CURATED, 'pexels-scenic');
  }
}

function fetchRandomPexelsScenic(excludeRecent = loadRecentWallpaperIds()) {
  return pickCuratedWallpaper(PEXELS_CURATED, 'pexels-scenic', { random: true, excludeRecent });
}

async function fetchRandomPexelsScenicValidated(excludeRecent = loadRecentWallpaperIds()) {
  try {
    const data = fetchRandomPexelsScenic(excludeRecent);
    return await ensureReachableWallpaper(data, { sourceHint: 'pexels-scenic' });
  } catch {
    return pickReachableCuratedWallpaper(PEXELS_CURATED, 'pexels-scenic', { random: true, excludeRecent });
  }
}

function offsetDateString(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

export function pickRandomOnlineSource(excludeSource) {
  const exclude = normalizeWallpaperSource(excludeSource);
  const pool = exclude && ONLINE_WALLPAPER_SOURCES.length > 1
    ? ONLINE_WALLPAPER_SOURCES.filter((s) => s !== exclude)
    : ONLINE_WALLPAPER_SOURCES;
  return pool[randomInt(0, pool.length - 1)];
}

function stripHtml(text) {
  const tmp = document.createElement('div');
  tmp.innerHTML = text || '';
  return tmp.textContent?.trim() || '';
}

async function fetchTextWithTimeout(url, ms = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'default' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseRssWallpaper(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid RSS');
  const item = doc.querySelector('item');
  if (!item) throw new Error('No RSS item');

  const title = item.querySelector('title')?.textContent?.trim() || '国家地理每日';
  const rawDesc = item.querySelector('description')?.textContent
    || item.querySelector('content\\:encoded, encoded')?.textContent
    || '';

  let url = item.querySelector('enclosure')?.getAttribute('url') || '';
  if (!url) {
    url = item.querySelector('media\\:content, content')?.getAttribute('url') || '';
  }
  if (!url) {
    const imgMatch = rawDesc.match(/<img[^>]+src=["']([^"']+)["']/i);
    url = imgMatch?.[1] || '';
  }
  if (!url) throw new Error('No image url');

  const day = new Date().toISOString().slice(0, 10);
  const pageUrl = item.querySelector('link')?.textContent?.trim() || '';
  return {
    id: `natgeo-${day}`,
    url,
    title,
    description: stripHtml(rawDesc).slice(0, 200) || title,
    credit: '国家地理 · Photo of the Day',
    dateKey: day,
    source: 'natgeo',
    type: 'image',
    pageUrl,
  };
}

async function fetchNatGeoFromRss() {
  let lastError = new Error('Nat Geo RSS failed');
  for (const rssUrl of NATGEO_RSS_URLS) {
    try {
      const xml = await fetchTextWithTimeout(rssUrl);
      return parseRssWallpaper(xml);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function fetchNatGeoWallpaper() {
  try {
    return await fetchNatGeoFromRss();
  } catch {
    return fetchWikimediaPotd();
  }
}

function getRotationMode() {
  return loadWallpaperRotation().interval || 'daily';
}

function resolveWallpaperDate(mode) {
  const now = new Date();
  if (mode === 'hourly') {
    const d = new Date(now);
    d.setDate(d.getDate() - (now.getHours() % 30));
    return d.toISOString().slice(0, 10);
  }
  return now.toISOString().slice(0, 10);
}

async function fetchWikimediaPotd(dateStr) {
  const d = dateStr ? new Date(`${dateStr}T12:00:00`) : new Date();
  const path = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/feed/featured/${path}`, { cache: 'default' });
  if (!res.ok) throw new Error('Wikipedia featured failed');
  const json = await res.json();
  const potd = json.image;
  if (!potd?.image?.source) throw new Error('No Wikipedia image');
  const day = path.replace(/\//g, '-');
  const title = stripHtml(potd.title) || '维基百科 · 每日一图';
  return {
    id: `wikimedia-${day}`,
    url: potd.image.source,
    title,
    description: stripHtml(typeof potd.description === 'object' ? potd.description.text : potd.description) || '',
    credit: potd.image.attribution?.text ? `维基百科 · ${stripHtml(potd.image.attribution.text)}` : '维基百科 · 每日一图',
    dateKey: day,
    source: 'wikimedia',
    type: 'image',
    pageUrl: title !== '维基百科 · 每日一图' ? buildWikipediaPageUrl(title) : '',
  };
}

async function fetchJsonWithCorsFallback(url, ms = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { cache: 'default', signal: controller.signal });
    if (res.ok) return res.json();
  } catch {
    /* direct fetch blocked (e.g. Bing CORS) — try proxies */
  } finally {
    clearTimeout(timer);
  }

  let lastError = new Error('JSON fetch failed');
  for (const proxyUrl of corsProxyUrls(url, 'wallpaper')) {
    const proxyController = new AbortController();
    const proxyTimer = setTimeout(() => proxyController.abort(), ms);
    try {
      const res = await fetch(proxyUrl, { cache: 'default', signal: proxyController.signal });
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') || '';
      if (proxyUrl.includes('/get?') || ct.includes('json')) {
        const wrapped = await res.json();
        const text = wrapped.contents ?? wrapped.data ?? '';
        if (text) return typeof text === 'string' ? JSON.parse(text) : text;
      }
      return res.json();
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(proxyTimer);
    }
  }
  throw lastError;
}

function buildBingPayloadFromArchiveItem(item, host = 'https://www.bing.com') {
  const dateKey = item.enddate || item.startdate || 'bing';
  const fullUrl = item.urlbase
    ? buildBingUhdUrlFromUrlBase(item.urlbase)
    : upgradeBingWallpaperUrl(`${host}${item.url || ''}`);
  return {
    id: `bing-${dateKey}`,
    url: fullUrl,
    previewUrl: buildBingPreviewUrl(fullUrl),
    title: item.title || '每日风景',
    description: item.copyright?.split('(')[0]?.trim() || item.title || '',
    credit: item.copyright || '',
    dateKey,
    source: 'bing',
    type: 'image',
    pageUrl: item.copyrightlink || '',
  };
}

async function fetchBingOfficialArchive(idx, host = 'https://www.bing.com') {
  const apiUrl = `${host}/HPImageArchive.aspx?format=js&idx=${idx}&n=1&mkt=zh-CN`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BING_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl, { cache: 'default', signal: controller.signal });
    if (res.ok) {
      const json = await res.json();
      const item = json.images?.[0];
      if (item) return buildBingPayloadFromArchiveItem(item, host);
    }
  } catch {
    /* extension 直连失败时走代理 */
  } finally {
    clearTimeout(timer);
  }
  const json = await fetchJsonWithCorsFallback(apiUrl, BING_FETCH_TIMEOUT_MS);
  const item = json.images?.[0];
  if (!item) throw new Error('No wallpaper data');
  return buildBingPayloadFromArchiveItem(item, host);
}

async function fetchBingFromBiturl(idx) {
  const biturlApi = `https://bing.biturl.top/?resolution=UHD&format=json&index=${idx}&mkt=zh-CN`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BING_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(biturlApi, { cache: 'default', signal: controller.signal });
    if (!res.ok) throw new Error('biturl failed');
    const json = await res.json();
    if (!json?.url) throw new Error('biturl empty');
    const dateKey = json.end_date || json.start_date || 'bing';
    const fullUrl = upgradeBingWallpaperUrl(json.url);
    return {
      id: `bing-${dateKey}`,
      url: fullUrl,
      previewUrl: buildBingPreviewUrl(fullUrl),
      title: json.title || json.copyright?.split('(')[0]?.trim() || '每日风景',
      description: json.copyright?.split('(')[0]?.trim() || json.title || '',
      credit: json.copyright || '',
      dateKey,
      source: 'bing',
      type: 'image',
      pageUrl: json.copyright_link || json.copyrightlink || '',
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeMirrorBingPayload(json, idx) {
  const url = json?.url || json?.data?.url || json?.data?.imgurl || json?.imgurl;
  if (!url) return null;
  const fullUrl = upgradeBingWallpaperUrl(url);
  const dateKey = json?.date || json?.data?.date || json?.enddate || `bing-${idx}`;
  const title = json?.title || json?.data?.title || json?.copyright?.split?.('(')?.[0]?.trim() || '每日风景';
  const credit = json?.copyright || json?.data?.copyright || json?.data?.description || '';
  return {
    id: `bing-${String(dateKey).replace(/\D/g, '').slice(0, 8) || idx}`,
    url: fullUrl,
    previewUrl: buildBingPreviewUrl(fullUrl),
    title,
    description: credit.split('(')[0]?.trim() || title,
    credit,
    dateKey: String(dateKey).replace(/\D/g, '').slice(0, 8) || 'bing',
    source: 'bing',
    type: 'image',
    pageUrl: json?.copyrightlink || json?.data?.copyrightlink || '',
  };
}

async function fetchBingFromMirror(idx) {
  const mirrors = [
    `https://api.vvhan.com/api/wallpaper/bing?type=json&idx=${idx}`,
    `https://api.oioweb.cn/api/bing/daily/${idx}`,
  ];
  const attempts = mirrors.map((apiUrl) => async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BING_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(apiUrl, { cache: 'default', signal: controller.signal });
      if (!res.ok) throw new Error(`Mirror HTTP ${res.status}`);
      const json = await res.json();
      const payload = normalizeMirrorBingPayload(json, idx);
      if (payload?.url) return payload;
      throw new Error('Mirror payload empty');
    } finally {
      clearTimeout(timer);
    }
  });
  return firstSuccessfulStaggered(attempts, 120);
}

export async function fetchBingWallpaper(idx = 0) {
  const attempts = [
    () => fetchBingFromBiturl(idx),
    () => fetchBingOfficialArchive(idx, 'https://cn.bing.com'),
    () => fetchBingOfficialArchive(idx, 'https://www.bing.com'),
    () => fetchBingFromMirror(idx),
  ];
  return firstSuccessfulStaggered(attempts, BING_HEDGE_DELAY_MS);
}

export const BING_WALLPAPER_DAYS = 7;

function loadBingBrowseIndex() {
  try {
    const raw = localStorage.getItem(KEYS.bingWallpaperIdx);
    const idx = parseInt(raw, 10);
    return Number.isFinite(idx) ? idx : 0;
  } catch {
    return 0;
  }
}

function saveBingBrowseIndex(idx) {
  try {
    localStorage.setItem(KEYS.bingWallpaperIdx, String(idx));
  } catch {
    /* ignore */
  }
}

/** 按 idx 顺序浏览 Bing 历史图，避免随机重复 */
export async function fetchNextBingWallpaper(recent = loadRecentWallpaperIds()) {
  const start = loadBingBrowseIndex();
  for (let step = 1; step <= BING_WALLPAPER_DAYS; step += 1) {
    const idx = (start + step) % BING_WALLPAPER_DAYS;
    try {
      const data = await fetchBingWallpaper(idx);
      if (data?.url && !isRecentlyShown(data, recent)) {
        saveBingBrowseIndex(idx);
        return data;
      }
    } catch {
      /* try next day */
    }
  }

  for (let idx = 0; idx < BING_WALLPAPER_DAYS; idx += 1) {
    try {
      const data = await fetchBingWallpaper(idx);
      if (data?.url) {
        saveBingBrowseIndex(idx);
        return data;
      }
    } catch {
      /* continue */
    }
  }

  return fetchBingWallpaper(0);
}

async function fetchRandomBing() {
  return fetchNextBingWallpaper();
}

async function fetchRandomWikimedia() {
  let lastError = new Error('Wikimedia failed');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await fetchWikimediaPotd(offsetDateString(randomInt(1, 30)));
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function fetchRandomNatGeo() {
  try {
    return await fetchNatGeoFromRss();
  } catch {
    return fetchRandomWikimedia();
  }
}

function fetchRandomBuiltin() {
  const item = BUILTIN_WALLPAPERS[randomInt(0, BUILTIN_WALLPAPERS.length - 1)];
  return { ...item, dateKey: String(Date.now()), type: 'image' };
}

async function fetchRandomBuiltinValidated() {
  try {
    const data = fetchRandomBuiltin();
    return await ensureReachableWallpaper(data, { sourceHint: 'builtin' });
  } catch {
    return pickReachableCuratedWallpaper(UNSPLASH_CURATED, 'builtin', { random: true });
  }
}

export async function fetchRandomFromSource(source) {
  const recent = loadRecentWallpaperIds();
  switch (source) {
    case 'unsplash-curated':
      return fetchRandomUnsplashCuratedValidated(recent);
    case 'pexels-scenic':
      return fetchRandomPexelsScenicValidated(recent);
    case 'bing':
      return fetchRandomBing();
    case 'wikimedia':
      return fetchRandomWikimedia();
    case 'natgeo':
      return fetchRandomNatGeo();
    case 'builtin':
      return fetchRandomBuiltinValidated();
    default:
      return fetchRandomUnsplashCuratedValidated(recent);
  }
}
export async function fetchWallpaperData(source) {
  source = normalizeWallpaperSource(source);

  if (source === 'local') return { ...DEFAULT_WALLPAPER };
  if (source === 'library') {
    const { wallpaperId } = loadSettings();
    return resolveLibraryWallpaper(wallpaperId);
  }
  if (source === 'unsplash-curated') return fetchUnsplashCuratedWallpaperValidated();
  if (source === 'pexels-scenic') return fetchPexelsScenicWallpaperValidated();
  if (source === 'builtin') {
    const data = { ...pickDailyItem(BUILTIN_WALLPAPERS, 'builtin'), type: 'image' };
    return ensureReachableWallpaper(data, { sourceHint: 'builtin' });
  }
  if (source === 'wikimedia') {
    return fetchWikimediaPotd(resolveWallpaperDate(getRotationMode() === 'hourly' ? 'hourly' : 'daily'));
  }
  if (source === 'natgeo') return fetchNatGeoWallpaper();
  return fetchBingWallpaper();
}
function pickDailyItem(list, prefix) {
  const day = new Date().toISOString().slice(0, 10);
  let hash = 0;
  for (let i = 0; i < day.length; i += 1) {
    hash = (hash * 31 + day.charCodeAt(i)) >>> 0;
  }
  const item = list[hash % list.length];
  return { ...item, id: item.id || `${prefix}-${day}`, dateKey: day };
}

async function resolveLibraryWallpaper(wallpaperId) {
  if (wallpaperId) {
    const favorite = getWallpaperFavorites().find((item) => item.id === wallpaperId);
    if (favorite) return { ...favorite, type: favorite.type || 'image' };

    const entry = await getLibraryWallpaper(wallpaperId);
    if (entry) return libraryEntryToWallpaper(entry);
  }

  const favorites = getWallpaperFavorites();
  if (favorites.length) return { ...favorites[0], type: favorites[0].type || 'image' };

  return { ...DEFAULT_WALLPAPER };
}
