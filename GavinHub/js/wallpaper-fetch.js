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
} from './wallpaper-library.js';
import {
  UNSPLASH_CURATED,
  PEXELS_CURATED,
  buildUnsplashUrl,
  buildPexelsUrl,
  lookupCuratedEntryByUrl,
} from './wallpaper-curated.js';
import { corsProxyUrls } from './util.js';
import {
  isLocalWallpaperUrl,
  isWallpaperUrlReachable,
  MIN_CACHE_WIDTH,
} from './wallpaper-image.js';

export const DEFAULT_WALLPAPER = {
  id: 'local-default',
  url: 'assets/default-wallpaper.jpg',
  title: '赫兹桑德海岸',
  description: '丹麦西海岸赫兹桑德（Hvide Sande）的沙滩与沙丘，从山丘俯瞰北海与绵延海岸。',
  credit: '© Jo Filmmaker / Unsplash',
  dateKey: 'local',
  source: 'local',
  type: 'image',
};

const FETCH_TIMEOUT_MS = 12000;
const BING_FETCH_TIMEOUT_MS = 12000;

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

export const ONLINE_WALLPAPER_SOURCES = [
  'unsplash-curated', 'pexels-scenic', 'bing', 'builtin',
];

export function isOnlineWallpaperSource(source) {
  return ONLINE_WALLPAPER_SOURCES.includes(normalizeWallpaperSource(source));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function buildBingPreviewUrl(fullUrl) {
  if (!fullUrl) return '';
  const uhd = upgradeBingWallpaperUrl(fullUrl);
  if (uhd.includes('_UHD.jpg')) return uhd.replace('_UHD.jpg', '_1920x1080.jpg');
  if (uhd.includes('_UHD')) return uhd.replace('_UHD', '_1920x1080');
  try {
    const parsed = new URL(uhd);
    parsed.searchParams.set('w', '1280');
    parsed.searchParams.set('h', '720');
    return parsed.toString();
  } catch {
    return uhd;
  }
}

function bingPreviewUrl(fullUrl) {
  return buildBingPreviewUrl(fullUrl);
}

function absoluteBingUrl(url) {
  if (!url) return url;
  return url.startsWith('http') ? url : `https://www.bing.com${url}`;
}

/** 从 Bing 官方 API 的 urlbase 构造 UHD 直链（无 &rf= 等缩略参数） */
export function buildBingUhdUrlFromUrlBase(urlbase) {
  if (!urlbase) return '';
  const path = absoluteBingUrl(urlbase);
  const idMatch = path.match(/[?&]id=([^&]+)/i);
  if (!idMatch) return upgradeBingWallpaperUrl(path);
  const idCore = idMatch[1]
    .replace(/_1920x1080\.jpg$/i, '')
    .replace(/_UHD\.jpg$/i, '')
    .replace(/\.jpg$/i, '');
  return `https://www.bing.com/th?id=${idCore}_UHD.jpg`;
}

export function upgradeBingWallpaperUrl(url) {
  if (!url) return url;
  if (url.startsWith('blob:') || url.startsWith('data:') || isLocalWallpaperUrl(url)) return url;
  if (!url.includes('bing.com') && !url.startsWith('/th')) return url;

  let normalized = absoluteBingUrl(url.split('&')[0]);
  try {
    const parsed = new URL(normalized);
    parsed.searchParams.delete('w');
    parsed.searchParams.delete('h');
    parsed.searchParams.delete('rf');
    parsed.searchParams.delete('pid');
    normalized = `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    /* keep normalized */
  }

  if (normalized.includes('_UHD')) return normalized;

  if (normalized.includes('_1920x1080')) {
    return normalized.replace('_1920x1080', '_UHD');
  }

  const idMatch = normalized.match(/[?&]id=(OHR\.[^&]+)/i);
  if (idMatch) {
    const idCore = idMatch[1]
      .replace(/_1920x1080\.jpg$/i, '')
      .replace(/_UHD\.jpg$/i, '')
      .replace(/\.jpg$/i, '');
    if (!idCore.endsWith('_UHD')) {
      return `https://www.bing.com/th?id=${idCore}_UHD.jpg`;
    }
  }

  return normalized;
}

function buildWikipediaPageUrl(title) {
  if (!title?.trim()) return '';
  const page = title.trim().replace(/ /g, '_');
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(page).replace(/%3A/g, ':')}`;
}

export function upgradeWallpaperUrl(data) {
  if (!data?.url) return data?.url || '';
  const url = data.url;
  if (url.startsWith('blob:') || url.startsWith('data:') || isLocalWallpaperUrl(url)) return url;
  const source = normalizeWallpaperSource(data.source);
  if (source === 'bing') return upgradeBingWallpaperUrl(url);
  if (source === 'unsplash-curated' || source === 'builtin') {
    const match = data.url.match(/photo-([\d]+-[a-f0-9]+)/i);
    if (match) return buildUnsplashUrl(match[1]);
  }
  if (source === 'pexels-scenic') {
    const match = data.url.match(/photos\/(\d+)\//);
    if (match) return buildPexelsUrl(Number(match[1]));
  }
  if (source === 'wikimedia' && data.url.includes('/thumb/')) {
    return data.url.replace(/\/thumb\/(.+)\/\d+px-[^/]+$/, '/$1');
  }
  return data.url;
}

function curatedEntryToWallpaper(entry, source) {
  const url = source === 'pexels-scenic'
    ? buildPexelsUrl(entry.pexelsId)
    : buildUnsplashUrl(entry.photoId);
  return {
    id: entry.id,
    url,
    title: entry.title,
    description: entry.description,
    credit: entry.credit,
    dateKey: entry.id,
    source,
    type: 'image',
  };
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

export function reconcileCuratedWallpaper(data) {
  const source = normalizeWallpaperSource(data.source);
  if (!['unsplash-curated', 'builtin', 'pexels-scenic'].includes(source)) return data;

  const url = upgradeWallpaperUrl(data) || data.url;
  const entry = lookupCuratedEntryByUrl(url, source);
  if (!entry) return data;

  const resolvedSource = source === 'builtin' ? 'builtin' : source;
  const matched = curatedEntryToWallpaper(entry, resolvedSource);
  return {
    ...matched,
    id: data.id || matched.id,
    dateKey: data.dateKey || matched.dateKey,
    source: data.source || matched.source,
  };
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
    previewUrl: bingPreviewUrl(fullUrl),
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
      previewUrl: bingPreviewUrl(fullUrl),
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
    previewUrl: bingPreviewUrl(fullUrl),
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
  let lastError = new Error('Mirror fetch failed');
  for (const apiUrl of mirrors) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BING_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(apiUrl, { cache: 'default', signal: controller.signal });
      if (!res.ok) continue;
      const json = await res.json();
      const payload = normalizeMirrorBingPayload(json, idx);
      if (payload?.url) return payload;
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

export async function fetchBingWallpaper(idx = 0) {
  const attempts = [
    () => fetchBingFromBiturl(idx),
    () => fetchBingOfficialArchive(idx, 'https://cn.bing.com'),
    () => fetchBingOfficialArchive(idx, 'https://www.bing.com'),
    () => fetchBingFromMirror(idx),
  ];
  let lastError = new Error('No wallpaper data');
  for (const attempt of attempts) {
    try {
      const data = await attempt();
      if (data?.url) return data;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
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
