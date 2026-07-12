import { corsProxyUrls, fetchWithTimeout } from './util.js';

const MIN_ICON_PX = 16;
const MIN_STORE_PX = 64;
const PREFERRED_ICON_PX = 128;

export const NETEASE_ICON_URL =
  'https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://music.163.com&size=128';

/** Stable direct icon URLs keyed by hostname (bypass flaky HTML/proxy fetches). */
const KNOWN_SITE_ICONS = {
  'music.163.com': [
    NETEASE_ICON_URL,
    'https://music.163.com/apple-touch-icon.png',
    'https://music.163.com/apple-touch-icon-precomposed.png',
  ],
  'www.notion.so': ['https://www.notion.so/images/logo-ios.png'],
  'notion.so': ['https://www.notion.so/images/logo-ios.png'],
  'www.overleaf.com': ['https://www.overleaf.com/apple-touch-icon.png'],
  'overleaf.com': ['https://www.overleaf.com/apple-touch-icon.png'],
};

const KNOWN_ICON_URLS = new Set(Object.values(KNOWN_SITE_ICONS).flat());

function isWhitelistedKnownIconUrl(url) {
  return !!url && KNOWN_ICON_URLS.has(url);
}

const STALE_SITE_ICON_URLS = {
  'music.163.com': new Set([
    'https://music.163.com/favicon.ico',
    'https://music.163.com/favicon-32x32.png',
    'https://music.163.com/favicon-16x16.png',
  ]),
};

export function normalizePageUrl(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function isFullBleedKnownIcon(url) {
  return isWhitelistedKnownIconUrl(url);
}

export function isGenericFaviconUrl(url) {
  if (!url) return false;
  if (isWhitelistedKnownIconUrl(url)) return false;
  try {
    const u = new URL(url);
    if (/\.google\.com$/i.test(u.hostname) && u.pathname.includes('/s2/favicons')) return true;
    if (/gstatic\.com$/i.test(u.hostname) && u.pathname.includes('/faviconV2')) return true;
    if (/duckduckgo\.com$/i.test(u.hostname) && u.pathname.includes('/ip3/')) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function isStaleSiteIcon(url, pageUrl) {
  if (!url || !pageUrl) return false;
  const domain = pageDomain(pageUrl).replace(/^www\./i, '');
  const stale = STALE_SITE_ICON_URLS[domain];
  return stale ? stale.has(url) : false;
}

/** CDN globe placeholder: mostly white canvas with small centered glyph. */
export function isGenericGlobeImage(img) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return false;

  try {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;

    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    let light = 0;
    let edgeLight = 0;
    let centerLight = 0;
    const total = size * size;
    const margin = 4;

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const i = (y * size + x) * 4;
        const isLight = data[i] > 228 && data[i + 1] > 228 && data[i + 2] > 228;
        if (!isLight) continue;
        light += 1;
        const onEdge = x < margin || x >= size - margin || y < margin || y >= size - margin;
        if (onEdge) edgeLight += 1;
        else centerLight += 1;
      }
    }

    const lightRatio = light / total;
    const edgeRatio = edgeLight / total;
    const centerRatio = centerLight / total;
    return lightRatio > 0.58 && edgeRatio > 0.28 && centerRatio < 0.22;
  } catch {
    return false;
  }
}

export function isAcceptableIcon(img, src, minPx = MIN_ICON_PX) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return false;
  return Math.min(w, h) >= minPx;
}

function pageOrigin(url) {
  try {
    return new URL(normalizePageUrl(url)).origin;
  } catch {
    return '';
  }
}

function pageDomain(url) {
  try {
    return new URL(normalizePageUrl(url)).hostname;
  } catch {
    return '';
  }
}

function resolveHref(href, base) {
  if (!href) return '';
  try {
    return new URL(href, base).href;
  } catch {
    return '';
  }
}

function scoreIconLink(rel, type, sizes) {
  const r = (rel || '').toLowerCase();
  const t = (type || '').toLowerCase();
  const s = sizes || '';

  if (r.includes('apple-touch-icon')) return 1000;
  if (t.includes('png') && r.includes('icon')) {
    if (/\b192\b/.test(s)) return 920;
    if (/\b180\b/.test(s)) return 910;
    if (/\b128\b/.test(s)) return 900;
    if (/\b64\b/.test(s)) return 880;
    if (/\b32\b/.test(s)) return 820;
    return 850;
  }
  if (r.includes('shortcut') && r.includes('icon')) return 700;
  if (r.includes('icon')) return 600;
  return 0;
}

function parseIconLinks(html, baseUrl) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const scored = [];

    doc.querySelectorAll('link[href]').forEach((link) => {
      const rel = link.getAttribute('rel') || '';
      if (!/icon|apple-touch-icon/i.test(rel)) return;

      const url = resolveHref(link.getAttribute('href'), baseUrl);
      if (!url || isGenericFaviconUrl(url)) return;

      const priority = scoreIconLink(rel, link.getAttribute('type'), link.getAttribute('sizes'));
      if (priority > 0) scored.push({ url, priority });
    });

    scored.sort((a, b) => b.priority - a.priority);
    return scored;
  } catch {
    return [];
  }
}

async function fetchViaProxy(proxyUrl, asJson) {
  try {
    const res = await fetchWithTimeout(proxyUrl, 6000);
    if (!res.ok) return '';
    if (asJson) {
      const data = await res.json();
      return data?.contents || '';
    }
    return await res.text();
  } catch {
    return '';
  }
}

async function fetchHtml(url) {
  const target = normalizePageUrl(url);
  if (!target) return '';

  for (const proxyUrl of corsProxyUrls(target, 'favicon')) {
    const asJson = proxyUrl.includes('/get?');
    const html = await fetchViaProxy(proxyUrl, asJson);
    if (html) return html;
  }
  return '';
}

function testImageQuality(src, minPx = MIN_ICON_PX) {
  return new Promise((resolve) => {
    if (!src || isGenericFaviconUrl(src)) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (!isAcceptableIcon(img, src, minPx) || isGenericGlobeImage(img)) {
        resolve(null);
        return;
      }
      resolve(src);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function firstAcceptable(urls, minPx = MIN_ICON_PX) {
  for (const src of urls) {
    const ok = await testImageQuality(src, minPx);
    if (ok) return ok;
  }
  return null;
}

function scoreDirectPath(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.includes('apple-touch-icon')) return 1000;
    if (path.endsWith('.svg')) return 800;
    const dim = path.match(/(\d+)x\1/);
    if (dim) return 700 + Math.min(parseInt(dim[1], 10), 200);
    if (path.endsWith('.png')) return 650;
    if (path.endsWith('.ico')) return 100;
  } catch {
    /* ignore */
  }
  return 500;
}

function mergeScoredCandidates(...groups) {
  const merged = [];
  const seen = new Set();
  for (const group of groups) {
    for (const entry of group) {
      const url = typeof entry === 'string' ? entry : entry.url;
      const priority = typeof entry === 'string' ? scoreDirectPath(entry) : entry.priority;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      merged.push({ url, priority });
    }
  }
  merged.sort((a, b) => b.priority - a.priority);
  return merged.map((item) => item.url);
}

function buildDirectCandidates(origin) {
  if (!origin) return [];
  return [
    `${origin}/apple-touch-icon.png`,
    `${origin}/apple-touch-icon-precomposed.png`,
    `${origin}/apple-touch-icon-180x180.png`,
    `${origin}/favicon.svg`,
    `${origin}/favicon-192x192.png`,
    `${origin}/favicon-128x128.png`,
    `${origin}/favicon-64x64.png`,
    `${origin}/favicon.png`,
    `${origin}/favicon-32x32.png`,
    `${origin}/favicon.ico`,
  ];
}

function buildCdnCandidates(domain, pageUrl) {
  if (!domain) return [];
  const normalized = normalizePageUrl(pageUrl);
  return [
    `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(normalized)}&size=128`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`,
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`,
  ];
}

/** Sync direct-path candidates only (no CDN globes). */
export function getFaviconCandidates(url) {
  const normalized = normalizePageUrl(url);
  const origin = pageOrigin(normalized);
  return buildDirectCandidates(origin);
}

export function isLowResIconUrl(url) {
  if (!url) return false;
  if (isGenericFaviconUrl(url)) return true;
  try {
    const u = new URL(url);
    if (/\.google\.com$/i.test(u.hostname) && u.pathname.includes('/s2/favicons')) {
      const sz = parseInt(u.searchParams.get('sz') || '0', 10);
      return !sz || sz < MIN_STORE_PX;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function isUnacceptableStoredIcon(url, pageUrl = '') {
  if (isGenericFaviconUrl(url) || isLowResIconUrl(url)) return true;
  if (pageUrl && isStaleSiteIcon(url, pageUrl)) return true;
  return false;
}

/**
 * HTML link tags + direct paths (≥64px), then smaller site icons; letter if none qualify.
 */
function knownSiteCandidates(domain) {
  if (!domain) return [];
  const bare = domain.replace(/^www\./i, '');
  return KNOWN_SITE_ICONS[domain] || KNOWN_SITE_ICONS[bare] || [];
}

/** First known direct icon URL for a page, if any. */
export function getKnownSiteIcon(url) {
  const domain = pageDomain(normalizePageUrl(url));
  return knownSiteCandidates(domain)[0] || '';
}

export async function fetchSiteIcon(url) {
  const normalized = normalizePageUrl(url);
  const origin = pageOrigin(normalized);
  const domain = pageDomain(normalized);
  if (!domain) return { type: 'letter' };

  const known = knownSiteCandidates(domain);
  let found = await firstAcceptable(known, MIN_STORE_PX);
  if (found) return { type: 'image', url: found };

  const html = await fetchHtml(normalized);
  const fromHtml = html ? parseIconLinks(html, normalized) : [];
  const siteCandidates = mergeScoredCandidates(known, fromHtml, buildDirectCandidates(origin));

  found = await firstAcceptable(siteCandidates, MIN_STORE_PX);
  if (found) return { type: 'image', url: found };

  found = await firstAcceptable(siteCandidates, MIN_ICON_PX);
  if (found) return { type: 'image', url: found };

  return { type: 'letter' };
}

/** Bind img load/error; on reject call onFallback (letter avatar). */
export function bindIconWithFallback(img, src, onFallback, onAccept) {
  if (!src || isGenericFaviconUrl(src)) {
    onFallback();
    return;
  }

  let done = false;
  const reject = () => {
    if (done) return;
    done = true;
    onFallback();
  };
  const accept = () => {
    if (done) return;
    done = true;
    onAccept?.();
  };

  const validate = () => {
    if (!isAcceptableIcon(img, src, MIN_ICON_PX) || isGenericGlobeImage(img)) reject();
    else accept();
  };

  img.onerror = reject;
  img.addEventListener('load', () => {
    if (done) return;
    validate();
  }, { once: true });
  img.src = src;

  if (img.complete) validate();
}

export { MIN_ICON_PX, MIN_STORE_PX, PREFERRED_ICON_PX };
