import { KEYS } from './keys.js';

let syncModulePromise = null;
const SYNCED_STORAGE_KEYS = new Set([
  KEYS.settings,
  KEYS.shortcuts,
  KEYS.dock,
  KEYS.todos,
  KEYS.goals,
  KEYS.importantDates,
]);
const SYNCED_SETTING_FIELDS = new Set(['baseCurrency', 'showGreeting']);

function scheduleSyncForKey(key = KEYS.settings) {
  if (!SYNCED_STORAGE_KEYS.has(key)) return;
  try {
    localStorage.setItem(KEYS.syncLocalAt, String(Date.now()));
  } catch { /* storage may be unavailable in restricted contexts */ }
  queueMicrotask(() => {
    syncModulePromise ||= import('./sync.js');
    syncModulePromise.then((sync) => {
      if (sync.isSyncKey(key)) sync.scheduleSyncPush();
    }).catch(() => {});
  });
}

const STORAGE_KEY = KEYS.settings;
const FAVORITES_KEY = KEYS.wallpaperFavorites;
const ROTATION_KEY = KEYS.wallpaperRotation;
const LAST_WALLPAPER_KEY = KEYS.wallpaperLast;
const RECENT_WALLPAPER_KEY = KEYS.wallpaperRecent;
const RECENT_WALLPAPER_MAX = 30;

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const DEFAULT_SETTINGS = {
  searchEngine: 'google',
  searchMode: 'normal',
  aiProvider: 0,
  mapProvider: 0,
  baseCurrency: '',
  wallpaperSource: 'bing',
  wallpaperId: '',
  wallpaperRotation: 'daily',
  wallpaperRotationIndex: 0,
  showGreeting: true,
};

/** 每个新标签页独立，不写入 localStorage */
export const TAB_SESSION_SETTINGS = {
  searchEngine: 'google',
  searchMode: 'normal',
  aiProvider: 0,
  mapProvider: 0,
};

const TAB_SESSION_KEYS = Object.keys(TAB_SESSION_SETTINGS);

const SEARCH_ENGINES = {
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
};

export const SEARCH_ENGINE_ORDER = ['google', 'bing'];

export const SEARCH_ENGINE_LABELS = {
  google: 'Google',
  bing: 'Bing',
};

export function getSearchEngineLabel(engine) {
  return SEARCH_ENGINE_LABELS[engine] || SEARCH_ENGINE_LABELS.google;
}

/** 稳定 favicon（gstatic），避免远程 .ico 慢或失败 */
function gstaticFavicon(siteUrl) {
  return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(siteUrl)}&size=32`;
}

/**
 * AI 提供商
 * supportsUrlQuery: true  → 关键词写入 URL，打开即可搜索/发送
 * supportsUrlQuery: false → 无官方 URL 预填，复制问题并打开聊天页（copyQuery）
 */
export const AI_PROVIDERS = [
  {
    id: 'doubao',
    label: '豆包',
    name: '豆包',
    icon: gstaticFavicon('https://www.doubao.com/chat/'),
    supportsUrlQuery: true,
    buildUrl(query) {
      const base = 'https://www.doubao.com/chat/';
      if (!query) return base;
      const action = JSON.stringify({
        pluginId: 'Send_Message',
        payload: { text: query },
      });
      return `${base}url-action?action=${encodeURIComponent(action)}`;
    },
  },
];

/** 地图：均支持 URL 关键词搜索，无需登录 */
export const MAP_PROVIDERS = [
  {
    id: 'amap',
    label: '高德',
    name: '高德地图',
    icon: gstaticFavicon('https://www.amap.com/'),
    supportsUrlQuery: true,
    buildUrl(query) {
      return `https://www.amap.com/search?query=${encodeURIComponent(query)}`;
    },
  },
  {
    id: 'google-maps',
    label: 'Google',
    name: 'Google 地图',
    icon: 'https://www.gstatic.com/images/branding/product/1x/maps_32dp.png',
    supportsUrlQuery: true,
    buildUrl(query) {
      if (!query) return 'https://www.google.com/maps';
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    },
  },
];

export function getTranslateUrl(query) {
  return `https://translate.google.com/?sl=auto&tl=zh-CN&text=${encodeURIComponent(query)}`;
}

/** 已废弃的来源 ID → 现行来源（运行时元数据仍可识别） */
const LEGACY_WALLPAPER_SOURCES = {
  gradient: 'bing',
  picsum: 'unsplash-curated',
  travel: 'unsplash-curated',
  earthview: 'bing',
  'nasa-apod': 'bing',
  'nasa-earth': 'bing',
  natgeo: 'bing',
  wikimedia: 'bing',
};

/** 运行时仍可识别的来源（收藏、回退、壁纸库等）；设置 UI 仅可选 bing */
const KNOWN_WALLPAPER_SOURCES = new Set([
  'local', 'unsplash-curated', 'pexels-scenic', 'bing', 'builtin', 'library',
]);

const SELECTABLE_WALLPAPER_SOURCES = new Set([
  'bing',
]);

export const WALLPAPER_ROTATION_LABELS = {
  manual: '手动',
  hourly: '每小时',
  daily: '每天',
  weekly: '每周',
};

export const WALLPAPER_ROTATION_ORDER = ['manual', 'hourly', 'daily', 'weekly'];

export function normalizeWallpaperSource(source) {
  const mapped = LEGACY_WALLPAPER_SOURCES[source] || source || DEFAULT_SETTINGS.wallpaperSource;
  return KNOWN_WALLPAPER_SOURCES.has(mapped) ? mapped : DEFAULT_SETTINGS.wallpaperSource;
}

/** 设置中的壁纸来源：非可选来源一律落到 bing */
export function normalizeSelectableWallpaperSource(source) {
  const normalized = normalizeWallpaperSource(source);
  return SELECTABLE_WALLPAPER_SOURCES.has(normalized) ? normalized : DEFAULT_SETTINGS.wallpaperSource;
}

function stripTabSessionFields(settings) {
  for (const key of TAB_SESSION_KEYS) {
    delete settings[key];
  }
  return settings;
}

function readPersistedSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    const wallpaperSource = normalizeSelectableWallpaperSource(parsed.wallpaperSource);
    const settings = { ...DEFAULT_SETTINGS, ...parsed, wallpaperSource };
    if (settings.currentPage === 'feed' || settings.currentPage === 'notes') {
      settings.currentPage = 'home';
    }
    const hadLegacyGithub = 'githubUsername' in parsed;
    const hadLegacyPage = 'currentPage' in parsed;
    const hadLegacySearch = TAB_SESSION_KEYS.some((key) => key in parsed);
    if (hadLegacyPage) {
      delete settings.currentPage;
    }
    if (hadLegacyGithub) {
      delete settings.githubUsername;
    }
    let dirty = wallpaperSource !== parsed.wallpaperSource || hadLegacyGithub || hadLegacyPage || hadLegacySearch;
    if ('photoSource' in settings) {
      delete settings.photoSource;
      dirty = true;
    }
    if ('photoSeeds' in settings) {
      delete settings.photoSeeds;
      dirty = true;
    }
    if ('photoZnasShareUrl' in settings) {
      delete settings.photoZnasShareUrl;
      dirty = true;
    }
    stripTabSessionFields(settings);
    if (dirty) {
      safeSetItem(STORAGE_KEY, JSON.stringify(settings));
    }
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function loadSettings() {
  return {
    ...readPersistedSettings(),
    ...TAB_SESSION_SETTINGS,
  };
}

export function saveSettings(partial) {
  const current = readPersistedSettings();
  const next = { ...current, ...partial };
  delete next.githubUsername;
  stripTabSessionFields(next);
  safeSetItem(STORAGE_KEY, JSON.stringify(next));
  if (Object.keys(partial).some((key) => SYNCED_SETTING_FIELDS.has(key))) {
    scheduleSyncForKey(STORAGE_KEY);
  }
  return next;
}

export function getSearchUrl(engine, query) {
  const base = SEARCH_ENGINES[engine] || SEARCH_ENGINES.google;
  return base + encodeURIComponent(query);
}

export function getAiProvider(index) {
  const i = Number(index) || 0;
  return AI_PROVIDERS[((i % AI_PROVIDERS.length) + AI_PROVIDERS.length) % AI_PROVIDERS.length];
}

export function getMapProvider(index) {
  const i = Number(index) || 0;
  return MAP_PROVIDERS[((i % MAP_PROVIDERS.length) + MAP_PROVIDERS.length) % MAP_PROVIDERS.length];
}

export function getAiUrl(index, query) {
  return getAiProvider(index).buildUrl(query);
}

export function getMapUrl(index, query) {
  return getMapProvider(index).buildUrl(query);
}

export function aiProviderSupportsUrlQuery(index) {
  return getAiProvider(index).supportsUrlQuery !== false;
}

export function aiProviderNeedsClipboard(index) {
  const provider = getAiProvider(index);
  return provider.copyQuery === true || provider.supportsUrlQuery === false;
}

export function getWallpaperId(wallpaper) {
  if (!wallpaper) return '';
  if (wallpaper.id) return wallpaper.id;
  if (wallpaper.dateKey && wallpaper.source) return `${wallpaper.source}-${wallpaper.dateKey}`;
  if (wallpaper.dateKey) return wallpaper.dateKey;
  return wallpaper.url || '';
}

export function getWallpaperFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveWallpaperFavorites(list) {
  safeSetItem(FAVORITES_KEY, JSON.stringify(list));
  return list;
}

export function isWallpaperFavorited(wallpaper) {
  const id = getWallpaperId(wallpaper);
  return getWallpaperFavorites().some((item) => item.id === id);
}

export function toggleWallpaperFavorite(wallpaper) {
  const id = getWallpaperId(wallpaper);
  const list = getWallpaperFavorites();
  const index = list.findIndex((item) => item.id === id);

  if (index >= 0) {
    list.splice(index, 1);
    saveWallpaperFavorites(list);
    return { liked: false };
  }

  list.unshift({
    id,
    url: wallpaper.url || '',
    css: wallpaper.css || '',
    type: wallpaper.type || 'image',
    title: wallpaper.title || '',
    description: wallpaper.description || '',
    credit: wallpaper.credit || '',
    dateKey: wallpaper.dateKey || id,
    source: wallpaper.source || '',
    addedAt: Date.now(),
  });
  saveWallpaperFavorites(list);
  return { liked: true };
}

export function removeWallpaperFavorite(id) {
  const list = getWallpaperFavorites().filter((item) => item.id !== id);
  saveWallpaperFavorites(list);
  return list;
}

export function loadWallpaperRotation() {
  const settings = loadSettings();
  try {
    const raw = localStorage.getItem(ROTATION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        interval: settings.wallpaperRotation || parsed.interval || 'daily',
        lastChange: parsed.lastChange || Date.now(),
        weekSourceIndex: settings.wallpaperRotationIndex ?? parsed.weekSourceIndex ?? 0,
      };
    }
  } catch {
    /* fall through */
  }
  /* 首次无记录时写入，否则每次读到的 lastChange=now，日更/小时轮换永远不会到期 */
  const initial = {
    interval: settings.wallpaperRotation || 'daily',
    lastChange: Date.now(),
    weekSourceIndex: settings.wallpaperRotationIndex || 0,
  };
  try {
    localStorage.setItem(ROTATION_KEY, JSON.stringify(initial));
  } catch { /* ignore quota */ }
  return initial;
}

export function saveWallpaperRotation(partial) {
  const current = loadWallpaperRotation();
  const next = { ...current, ...partial };
  safeSetItem(ROTATION_KEY, JSON.stringify(next));
  const settingsPatch = {};
  if ('interval' in partial) settingsPatch.wallpaperRotation = next.interval;
  if ('weekSourceIndex' in partial) settingsPatch.wallpaperRotationIndex = next.weekSourceIndex;
  if (Object.keys(settingsPatch).length) saveSettings(settingsPatch);
  return next;
}

export function getWallpaperCacheKey(wallpaper) {
  if (!wallpaper) return '';
  return getWallpaperId(wallpaper) || `${wallpaper.source || 'unknown'}-${wallpaper.dateKey || wallpaper.url || ''}`;
}

export function loadLastWallpaperMeta() {
  try {
    const raw = localStorage.getItem(LAST_WALLPAPER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.type === 'gradient' && parsed?.css) return parsed;
    if (parsed?.url) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function loadRecentWallpaperIds() {
  try {
    const raw = localStorage.getItem(RECENT_WALLPAPER_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function recordRecentWallpaper(wallpaper, maxRecent = RECENT_WALLPAPER_MAX) {
  const id = getWallpaperId(wallpaper);
  if (!id) return loadRecentWallpaperIds();
  const url = wallpaper.url || '';
  const next = [{ id, url, at: Date.now() }, ...loadRecentWallpaperIds().filter((item) => item.id !== id && item.url !== url)];
  const trimmed = next.slice(0, maxRecent);
  safeSetItem(RECENT_WALLPAPER_KEY, JSON.stringify(trimmed));
  return trimmed;
}

export function isRecentlyShown(wallpaper, recent = loadRecentWallpaperIds()) {
  const id = getWallpaperId(wallpaper);
  const url = wallpaper?.url || '';
  return recent.some((item) => (id && item.id === id) || (url && item.url === url));
}

export function saveLastWallpaperMeta(wallpaper) {
  if (!wallpaper?.url && wallpaper?.type !== 'gradient') return null;
  // blob: URLs are session-only; never persist them or they break the next visit.
  if (wallpaper.url?.startsWith('blob:')) return loadLastWallpaperMeta();
  const cacheKey = getWallpaperCacheKey(wallpaper);
  const meta = {
    id: wallpaper.id || '',
    url: wallpaper.url || '',
    css: wallpaper.css || '',
    type: wallpaper.type || 'image',
    title: wallpaper.title || '',
    description: wallpaper.description || '',
    credit: wallpaper.credit || '',
    dateKey: wallpaper.dateKey || '',
    source: wallpaper.source || '',
    pageUrl: wallpaper.pageUrl || '',
    linkUrl: wallpaper.linkUrl || '',
    link: wallpaper.link || '',
    cacheKey,
    cachedAt: Date.now(),
    textTheme: wallpaper.textTheme || undefined,
    luminance: wallpaper.luminance ?? wallpaper.min ?? undefined,
  };
  safeSetItem(LAST_WALLPAPER_KEY, JSON.stringify(meta));
  return meta;
}

export function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  const written = safeSetItem(key, JSON.stringify(value));
  if (!written) return false;
  scheduleSyncForKey(key);
  return true;
}

export function readString(key, fallback = '') {
  const raw = safeGetItem(key);
  return raw == null ? fallback : raw;
}

export function writeString(key, value) {
  return safeSetItem(key, value);
}
