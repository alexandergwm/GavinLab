import { normalizeWallpaperSource } from './storage.js';
import {
  UNSPLASH_CURATED,
  PEXELS_CURATED,
  buildUnsplashUrl,
  buildPexelsUrl,
  lookupCuratedEntryByUrl,
} from './wallpaper-curated.js';
import { isLocalWallpaperUrl } from './wallpaper-image.js';

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

export const ONLINE_WALLPAPER_SOURCES = [
  'unsplash-curated', 'pexels-scenic', 'bing', 'builtin',
];

export function isOnlineWallpaperSource(source) {
  return ONLINE_WALLPAPER_SOURCES.includes(normalizeWallpaperSource(source));
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

export function absoluteBingUrl(url) {
  if (!url) return url;
  if (/^https?:/i.test(url)) return url;
  if (url.startsWith('//')) return `https:${url}`;
  return `https://www.bing.com/${url.replace(/^\/+/, '')}`;
}

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
  } catch { /* keep normalized */ }

  if (normalized.includes('_UHD')) return normalized;
  if (normalized.includes('_1920x1080')) return normalized.replace('_1920x1080', '_UHD');

  const idMatch = normalized.match(/[?&]id=(OHR\.[^&]+)/i);
  if (idMatch) {
    const idCore = idMatch[1]
      .replace(/_1920x1080\.jpg$/i, '')
      .replace(/_UHD\.jpg$/i, '')
      .replace(/\.jpg$/i, '');
    if (!idCore.endsWith('_UHD')) return `https://www.bing.com/th?id=${idCore}_UHD.jpg`;
  }
  return normalized;
}

export function buildWikipediaPageUrl(title) {
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

export function curatedEntryToWallpaper(entry, source) {
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

export function reconcileCuratedWallpaper(data) {
  const source = normalizeWallpaperSource(data.source);
  if (!['unsplash-curated', 'builtin', 'pexels-scenic'].includes(source)) return data;
  const url = upgradeWallpaperUrl(data) || data.url;
  const entry = lookupCuratedEntryByUrl(url, source);
  if (!entry) return data;
  const matched = curatedEntryToWallpaper(entry, source === 'builtin' ? 'builtin' : source);
  return {
    ...matched,
    id: data.id || matched.id,
    dateKey: data.dateKey || matched.dateKey,
    source: data.source || matched.source,
  };
}

export { UNSPLASH_CURATED, PEXELS_CURATED };
