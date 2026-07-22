import { fetchSiteIcon, bindIconWithFallback, isUnacceptableStoredIcon, getKnownSiteIcon, NETEASE_ICON_URL, isFullBleedKnownIcon } from './favicon.js';
import { getIconObjectUrl, getIconBlobCache, saveIconBlobCache } from './wallpaper-library.js';
import { writeJson } from './storage.js';

import { KEYS } from './keys.js';

const SHORTCUTS_KEY = KEYS.shortcuts;
const DOCK_KEY = KEYS.dock;

function svgDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const CONNECTED_PAPERS_ICON_URL = svgDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <g fill="none" stroke="#4fb0b9" stroke-width="8" stroke-linecap="round">
    <path d="M42 82 64 32M66 34l28 46"/>
  </g>
  <circle cx="64" cy="28" r="18" fill="#5bb6bd"/>
  <circle cx="38" cy="88" r="24" fill="#27a7b2"/>
  <circle cx="96" cy="84" r="13" fill="#4ba9b4"/>
</svg>`);

const TRANSPARENT_SITE_ICONS = {
  'github.com': 'https://github.githubassets.com/favicons/favicon.svg',
  'www.github.com': 'https://github.githubassets.com/favicons/favicon.svg',
  'connectedpapers.com': CONNECTED_PAPERS_ICON_URL,
  'www.connectedpapers.com': CONNECTED_PAPERS_ICON_URL,
};

export const DEFAULT_SHORTCUTS = [
  { id: 'github', name: 'GitHub', url: 'https://github.com', icon: 'https://github.githubassets.com/favicons/favicon.svg', color: '#24292f' },
  { id: 'gavin', name: 'Gavin', url: 'https://gavin.nl', icon: '', letter: 'G', color: '#5B8FC7' },
  { id: 'connected-papers', name: 'Connected Papers', url: 'https://www.connectedpapers.com', icon: CONNECTED_PAPERS_ICON_URL },
  { id: 'sci-hub', name: 'Sci-hub', url: 'https://sci-hub.se', icon: '', letter: 'S', color: '#C96A6A' },
  { id: 'papers-code', name: 'Papers with Code', url: 'https://paperswithcode.com', icon: '', letter: 'P', color: '#4BB896' },
  { id: 'notes', name: '便笺', url: 'https://note.youdao.com', icon: '', letter: '便', color: '#D4AD4A' },
  { id: 'overleaf', name: 'Overleaf', url: 'https://www.overleaf.com', icon: '', letter: 'O', color: '#5FA858' },
  { id: 'airportal', name: 'AirPortal', url: 'https://airportal.cn', icon: '', letter: 'A', color: '#5A9FD4' },
  { id: 'zlibrary', name: 'Z-Library', url: 'https://z-lib.io', icon: '', letter: 'ZL', color: '#9B7BB8' },
  { id: 'adi', name: 'ADI tutorial', url: 'https://analog.com', icon: '', letter: 'ADI', color: '#D47878' },
  { id: 'zhihu', name: '知乎', url: 'https://www.zhihu.com', icon: '', letter: '知', color: '#4A7FD4' },
  { id: 'netease', name: '网易云音乐', url: 'https://music.163.com', icon: NETEASE_ICON_URL, color: '#C85A5A' },
  { id: 'notion', name: 'Notion', url: 'https://www.notion.so', icon: 'https://www.notion.so/images/logo-ios.png', color: '#4A4A4A' },
  { id: 'gmail', name: 'Google Mail', url: 'https://mail.google.com', icon: '', letter: 'M', color: '#D96B62' },
];

export const DEFAULT_DOCK = [
  { id: 'github', type: 'link', url: 'https://github.com', icon: 'https://github.githubassets.com/favicons/favicon.svg' },
  { id: 'sci-hub', type: 'link', url: 'https://sci-hub.se', letter: 'S', color: '#C96A6A' },
  { id: 'netease', type: 'link', url: 'https://music.163.com', icon: NETEASE_ICON_URL },
  { id: 'notion', type: 'link', url: 'https://www.notion.so', icon: 'https://www.notion.so/images/logo-ios.png' },
];

export const DOCK_PAGES = [
  { page: 'home', label: '搜索', icon: 'search' },
  { page: 'apps', label: '应用', icon: 'apps' },
];

function dockTabIcon(name) {
  const icons = {
    search: '<svg class="dock-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.35" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    apps: '<svg class="dock-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  };
  return icons[name] || icons.search;
}

function loadList(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [...fallback];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [...fallback];
  } catch {
    return [...fallback];
  }
}

function normalizeItemId(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.id == null || item.id === '') return null;
  return { ...item, id: String(item.id) };
}

function transparentKnownIconForUrl(url = '') {
  try {
    const host = new URL(normalizeUrl(url)).hostname.toLowerCase();
    return TRANSPARENT_SITE_ICONS[host] || '';
  } catch {
    return '';
  }
}

function normalizeTransparentKnownIcon(item) {
  const icon = transparentKnownIconForUrl(item?.url);
  if (!icon) return item;
  if (item.icon === icon && !item.letter && !item.color) return item;
  return {
    ...item,
    icon,
    letter: undefined,
    color: undefined,
  };
}

function sanitizeShortcut(item) {
  item = normalizeTransparentKnownIcon(item);
  if (item?.icon && !isUnacceptableStoredIcon(item.icon, item.url)) {
    return item;
  }
  return restoreKnownDefaultIcon({
    ...item,
    icon: '',
    letter: item.letter || deriveLetterLabel(item.name, item.url),
    color: item.color || deriveLetterColor(letterColorSeed(item.name, item.url)),
  });
}

function restoreKnownDefaultIcon(item) {
  if (item?.icon && !isUnacceptableStoredIcon(item.icon, item?.url)) return item;
  const known = getKnownSiteIcon(item?.url);
  if (!known || isUnacceptableStoredIcon(known, item?.url)) return item;
  return {
    ...item,
    icon: known,
    letter: undefined,
    color: undefined,
  };
}

function mergeDockLinkFromShortcut(item, shortcutById) {
  const shortcut = shortcutById[item.id];
  const pageUrl = shortcut?.url || item.url;
  const transparentKnownIcon = transparentKnownIconForUrl(pageUrl);
  let icon = transparentKnownIcon || (shortcut?.icon && !isUnacceptableStoredIcon(shortcut.icon, pageUrl)
    ? shortcut.icon
    : (item.icon && !isUnacceptableStoredIcon(item.icon, pageUrl) ? item.icon : ''));
  if (transparentKnownIcon) icon = transparentKnownIcon;
  if (!icon) {
    const known = getKnownSiteIcon(pageUrl);
    if (known && !isUnacceptableStoredIcon(known, pageUrl)) icon = known;
  }

  return {
    ...item,
    url: shortcut?.url || item.url,
    icon,
    letter: icon ? undefined : (shortcut?.letter || item.letter),
    color: icon ? undefined : (shortcut?.color || item.color),
  };
}

function readSanitizedShortcuts() {
  return loadList(SHORTCUTS_KEY, DEFAULT_SHORTCUTS)
    .map(normalizeItemId)
    .filter(Boolean)
    .map(sanitizeShortcut);
}

export function loadShortcuts() {
  const list = loadList(SHORTCUTS_KEY, DEFAULT_SHORTCUTS).map(normalizeItemId).filter(Boolean);
  const sanitized = list.map(sanitizeShortcut);
  let changed = false;
  sanitized.forEach((s, i) => {
    if (s.icon !== list[i].icon || s.letter !== list[i].letter || s.color !== list[i].color) {
      syncDockFromShortcut(s);
      changed = true;
    }
  });
  if (changed) saveShortcuts(sanitized);
  return sanitized;
}

export function loadDock() {
  let dock = loadList(DOCK_KEY, DEFAULT_DOCK).map(normalizeItemId).filter(Boolean);

  // 页面切换已内置为 Dock 分段标签，持久化 dock 只保留快捷链接
  const links = dock.filter((d) => d.type === 'link');
  if (links.length !== dock.length) {
    dock = links.length ? links : [...DEFAULT_DOCK];
    saveDock(dock);
  }

  const shortcutById = Object.fromEntries(readSanitizedShortcuts().map((s) => [s.id, s]));

  const migrated = dock.map((item) => mergeDockLinkFromShortcut(item, shortcutById));

  let changed = false;
  migrated.forEach((item, i) => {
    if (item.type !== 'link') return;
    const prev = dock[i];
    if (item.icon !== prev.icon || item.letter !== prev.letter || item.color !== prev.color) {
      changed = true;
    }
  });
  if (changed) saveDock(migrated);

  return migrated;
}

export function saveShortcuts(shortcuts) {
  writeJson(SHORTCUTS_KEY, shortcuts);
}

export function saveDock(dock) {
  writeJson(DOCK_KEY, dock);
}

export function normalizeUrl(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function extractDomain(url) {
  try {
    return new URL(normalizeUrl(url)).hostname;
  } catch {
    return '';
  }
}

export { getFaviconCandidates } from './favicon.js';

const LETTER_PALETTE = [
  '#5B8FC7', '#4A8F6E', '#C96A6A', '#4BB896', '#D4AD4A',
  '#5FA858', '#5A9FD4', '#9B7BB8', '#D47878', '#4A7FD4',
  '#C85A5A', '#4A4A4A', '#D96B62', '#7B6BB8', '#5AADA8',
];

const STOP_WORDS = new Set(['with', 'the', 'a', 'an', 'of', 'and', 'for', 'to', 'in', 'on', 'at']);

function firstLatinChar(word = '') {
  const m = word.match(/[A-Za-z0-9]/);
  return m ? m[0].toUpperCase() : '';
}

/** Stable color seed: domain first, then display name. */
export function letterColorSeed(name = '', url = '') {
  return extractDomain(url) || (name || '').trim();
}

export function deriveLetterColor(seed = '') {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return LETTER_PALETTE[h % LETTER_PALETTE.length];
}

/** Derive 1–3 char label: CJK first char, Latin initials, or acronym. */
export function deriveLetterLabel(name = '', url = '') {
  const trimmed = (name || '').trim();
  if (!trimmed) {
    const domain = extractDomain(url);
    if (domain) {
      const host = domain.replace(/^www\./i, '');
      return firstLatinChar(host) || host.charAt(0).toUpperCase() || '?';
    }
    return '?';
  }

  const cjk = trimmed.match(/[\u4e00-\u9fff\u3400-\u4dbf]/);
  if (cjk) return cjk[0];

  const hyphenParts = trimmed.split('-').map((p) => p.trim()).filter(Boolean);
  if (hyphenParts.length >= 2 && hyphenParts[0].length <= 2) {
    const initials = hyphenParts.map(firstLatinChar).filter(Boolean).join('');
    if (initials.length >= 2) return initials.slice(0, 3);
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 3 && words.some((w) => STOP_WORDS.has(w.toLowerCase()))) {
    const lead = firstLatinChar(words[0]);
    if (lead) return lead;
  }

  const significant = words.filter(
    (w, i) => i === 0 || i === words.length - 1 || !STOP_WORDS.has(w.toLowerCase()),
  );
  const first = significant[0] || words[0];
  const alphaOnly = first.replace(/[^A-Za-z]/g, '');
  if (alphaOnly.length >= 2 && alphaOnly.length <= 4 && alphaOnly === alphaOnly.toUpperCase()) {
    return alphaOnly.slice(0, 3);
  }

  if (significant.length >= 2) {
    const initials = significant.slice(0, 3).map(firstLatinChar).filter(Boolean).join('');
    if (initials) return initials;
  }

  return firstLatinChar(first) || '?';
}

export async function fetchIconFromWeb(url) {
  return fetchSiteIcon(url);
}

/** Background: fetch the image bytes for a known good icon url and store blob in local cache for future instant loads. */
async function ensureIconCached(iconSrc) {
  if (!iconSrc) return;
  try {
    const cached = await getIconBlobCache(iconSrc);
    if (cached) return;
    // fetch as blob; use cors first, fallback to no-cors (may still work for blob if opaque? but prefer cors)
    let res;
    try {
      res = await fetch(iconSrc, { mode: 'cors', cache: 'force-cache' });
    } catch {
      res = await fetch(iconSrc, { cache: 'force-cache' });
    }
    if (!res || !res.ok) return;
    const blob = await res.blob();
    if (blob && blob.size > 50) {
      await saveIconBlobCache(iconSrc, blob);
    }
  } catch {
    /* non-fatal; next visit will try remote again */
  }
}


const PREFETCH_CONCURRENCY = 3;

export async function prefetchMissingShortcutIcons({ onItemUpdated } = {}) {
  const shortcuts = loadShortcuts();
  const pending = shortcuts.filter((s) => s.url && (!s.icon || isUnacceptableStoredIcon(s.icon, s.url)));
  if (!pending.length) return { fetched: 0, total: 0 };

  let fetched = 0;
  let index = 0;

  async function worker() {
    while (index < pending.length) {
      const item = pending[index];
      index += 1;

      const result = await fetchIconFromWeb(item.url);
      if (result.type === 'image') {
        const updated = {
          ...item,
          icon: result.url,
          letter: undefined,
          color: undefined,
        };
        upsertShortcut(updated);
        fetched += 1;
        onItemUpdated?.(updated);
        // also cache the actual image blob locally (lazy first time)
        ensureIconCached(result.url);
        continue;
      }

      if (item.icon && !isUnacceptableStoredIcon(item.icon, item.url)) continue;

      const updated = {
        ...item,
        icon: '',
        letter: item.letter || deriveLetterLabel(item.name, item.url),
        color: item.color || deriveLetterColor(letterColorSeed(item.name, item.url)),
      };
      if (updated.letter !== item.letter || updated.color !== item.color) {
        upsertShortcut(updated);
        onItemUpdated?.(updated);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(PREFETCH_CONCURRENCY, pending.length) },
    () => worker(),
  );
  await Promise.all(workers);

  return { fetched, total: pending.length };
}

export function upsertShortcut(data) {
  const shortcuts = loadShortcuts();
  const item = {
    ...data,
    url: normalizeUrl(data.url),
    name: (data.name || '').trim(),
  };

  if (!item.name) return shortcuts;

  if (item.icon) {
    delete item.letter;
  } else {
    if (!item.letter) item.letter = item.name.charAt(0) || '?';
    if (!item.color) item.color = deriveLetterColor(item.name || item.url);
  }

  const idx = shortcuts.findIndex((s) => s.id === item.id);
  if (idx >= 0) shortcuts[idx] = item;
  else shortcuts.push(item);

  saveShortcuts(shortcuts);
  syncDockFromShortcut(item);
  return shortcuts;
}

export function syncDockFromShortcut(shortcut) {
  const dock = loadList(DOCK_KEY, DEFAULT_DOCK);
  const idx = dock.findIndex((d) => d.type === 'link' && d.id === shortcut.id);
  if (idx < 0) return dock;

  dock[idx] = {
    ...dock[idx],
    url: shortcut.url,
    icon: shortcut.icon || '',
    letter: shortcut.letter,
    color: shortcut.color,
  };
  saveDock(dock);
  return dock;
}

export function moveShortcut(fromId, toIndex) {
  const shortcuts = loadShortcuts();
  const fromIndex = shortcuts.findIndex((s) => s.id === fromId);
  if (fromIndex < 0) return shortcuts;

  const clampedTo = Math.max(0, Math.min(toIndex, shortcuts.length - 1));
  if (fromIndex === clampedTo) return shortcuts;

  const [item] = shortcuts.splice(fromIndex, 1);
  shortcuts.splice(clampedTo, 0, item);
  saveShortcuts(shortcuts);
  return shortcuts;
}

export function deleteShortcut(id) {
  const shortcuts = loadShortcuts().filter((s) => s.id !== id);
  saveShortcuts(shortcuts);

  const dock = loadDock().filter((d) => !(d.type === 'link' && d.id === id));
  saveDock(dock);

  return { shortcuts, dock };
}

export function addShortcutToDock(shortcut) {
  const dock = loadDock();
  if (dock.some((d) => d.type === 'link' && d.id === shortcut.id)) {
    return { dock, added: false };
  }

  dock.push({
    id: shortcut.id,
    type: 'link',
    url: shortcut.url,
    icon: shortcut.icon || '',
    letter: shortcut.letter,
    color: shortcut.color,
  });
  saveDock(dock);
  return { dock, added: true };
}

export function removeFromDock(id) {
  const dock = loadDock();
  const next = dock.filter((d) => !(d.type === 'link' && d.id === id));
  if (next.length === dock.length) {
    return { dock, removed: false };
  }
  saveDock(next);
  return { dock: next, removed: true };
}

function hexToRgb(hex) {
  const h = (hex || '').replace('#', '');
  if (!h) return null;
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

export function softenColor(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#7B8EA8';
  const [r, g, b] = rgb;
  const sr = 136;
  const sg = 153;
  const sb = 170;
  const t = 0.22;
  return rgbToHex(r + (sr - r) * t, g + (sg - g) * t, b + (sb - b) * t);
}

export function pickLetterColor(bgHex) {
  const rgb = hexToRgb(bgHex);
  if (!rgb) return '#fff';
  const [r, g, b] = rgb;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? 'rgba(0, 0, 0, 0.78)' : '#fff';
}

function hexToRgba(hex, alpha) {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(255, 255, 255, ${alpha})`;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function classifyIconImage(container, img, iconSrc = '') {
  const { naturalWidth: w, naturalHeight: h } = img;
  if (!w || !h) return;

  container.classList.remove('shortcut-icon--square', 'shortcut-icon--round', 'shortcut-icon--lowres', 'shortcut-icon--transparent');

  if (Object.values(TRANSPARENT_SITE_ICONS).includes(iconSrc)) {
    container.classList.add('shortcut-icon--transparent');
  }

  if (Math.min(w, h) < 64) {
    container.classList.add('shortcut-icon--lowres');
  }

  if (isFullBleedKnownIcon(iconSrc) || w === h) {
    container.classList.add('shortcut-icon--square');
  } else {
    container.classList.add('shortcut-icon--round');
  }
}

function prepareImageIconContainer(container) {
  container.innerHTML = '';
  container.classList.remove(
    'shortcut-icon--letter',
    'shortcut-icon--square',
    'shortcut-icon--round',
    'shortcut-icon--lowres',
    'shortcut-icon--transparent',
  );
  container.classList.add('shortcut-icon--image');
  container.style.backgroundColor = '';
  container.style.color = '';
  delete container.dataset.len;
}

function renderLetterAvatar(container, item) {
  container.innerHTML = '';
  container.classList.remove(
    'shortcut-icon--letter',
    'shortcut-icon--image',
    'shortcut-icon--square',
    'shortcut-icon--round',
    'shortcut-icon--lowres',
    'shortcut-icon--transparent',
  );
  container.style.backgroundColor = '';
  container.style.color = '';
  delete container.dataset.len;

  const text = item.letter || deriveLetterLabel(item.name, item.url);
  container.classList.add('shortcut-icon--letter');
  container.dataset.len = String(Math.min(text.length, 3));
  const accent = softenColor(item.color || deriveLetterColor(letterColorSeed(item.name, item.url)));
  container.style.backgroundColor = '';
  container.style.color = hexToRgba(accent, 0.92);
  container.style.setProperty('--shortcut-letter-tint', hexToRgba(accent, 0.16));
  container.style.setProperty('--shortcut-letter-stroke', hexToRgba(accent, 0.18));

  const span = document.createElement('span');
  span.className = 'shortcut-icon-letter';
  span.textContent = text;
  container.appendChild(span);
}

export function renderIconInto(container, item, pageUrl = item.url, options = {}) {
  const { eager = false } = options;
  container.innerHTML = '';
  container.classList.remove(
    'shortcut-icon--letter',
    'shortcut-icon--image',
    'shortcut-icon--square',
    'shortcut-icon--round',
    'shortcut-icon--lowres',
    'shortcut-icon--transparent',
  );
  container.style.backgroundColor = '';
  container.style.color = '';
  delete container.dataset.len;

  const iconSrc = item.icon && !isUnacceptableStoredIcon(item.icon, pageUrl || item.url) ? item.icon : '';
  if (iconSrc) {
    if (eager) {
      prepareImageIconContainer(container);
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      const toLetter = () => renderLetterAvatar(container, {
        ...item,
        letter: item.letter || deriveLetterLabel(item.name, item.url || pageUrl),
        color: item.color || deriveLetterColor(letterColorSeed(item.name, item.url || pageUrl)),
      });
      bindIconWithFallback(img, iconSrc, toLetter, () => {
        classifyIconImage(container, img, iconSrc);
        ensureIconCached(iconSrc);
      });
      container.appendChild(img);

      void (async () => {
        try {
          const cachedUrl = await getIconObjectUrl(iconSrc);
          if (cachedUrl && img.isConnected) img.src = cachedUrl;
        } catch { /* ignore */ }
      })();
      return;
    }

    // Lazy approach: paint letter immediately for responsiveness. Upgrade to image once we have (cached or remote).
    renderLetterAvatar(container, item);

    (async () => {
      let usedCached = false;
      try {
        const cachedUrl = await getIconObjectUrl(iconSrc);
        if (cachedUrl) {
          usedCached = true;
          prepareImageIconContainer(container);
          const img = document.createElement('img');
          img.alt = '';
          img.loading = 'lazy';
          img.decoding = 'async';
          img.src = cachedUrl;
          const finish = () => classifyIconImage(container, img, iconSrc);
          img.addEventListener('load', finish, { once: true });
          if (img.complete) finish();
          container.appendChild(img);
          return;
        }
      } catch { /* ignore, fall to remote */ }

      if (usedCached) return;

      // First time for this icon (or no cache): load remote, on success cache the blob for future.
      // Use same bind logic which will replace the letter content.
      const toLetter = () => renderLetterAvatar(container, {
        ...item,
        letter: item.letter || deriveLetterLabel(item.name, item.url || pageUrl),
        color: item.color || deriveLetterColor(letterColorSeed(item.name, item.url || pageUrl)),
      });
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      bindIconWithFallback(img, iconSrc, toLetter, () => {
        classifyIconImage(container, img, iconSrc);
        ensureIconCached(iconSrc);
      });
      prepareImageIconContainer(container);
      container.appendChild(img);
    })();

    return;
  }

  renderLetterAvatar(container, item);
}

function appendIconContent(container, item) {
  renderIconInto(container, item);
}

export function renderShortcuts(container, shortcuts, handlers) {
  container.innerHTML = '';

  for (const item of shortcuts) {
    const el = document.createElement('a');
    el.className = 'shortcut-item';
    el.href = item.url;
    el.target = '_blank';
    el.rel = 'noopener noreferrer';
    el.dataset.id = item.id;
    el.draggable = false;
    el.setAttribute('role', 'listitem');

    const icon = document.createElement('div');
    icon.className = 'shortcut-icon';
    appendIconContent(icon, item);

    const label = document.createElement('span');
    label.className = 'shortcut-label';
    label.textContent = item.name;

    el.append(icon, label);

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handlers.onContextMenu?.(item, e);
    });

    container.appendChild(el);
  }

  const addBtn = document.createElement('button');
  addBtn.className = 'shortcut-item shortcut-add';
  addBtn.type = 'button';
  addBtn.setAttribute('role', 'listitem');

  const addIcon = document.createElement('div');
  addIcon.className = 'shortcut-icon';
  addIcon.textContent = '+';

  const addLabel = document.createElement('span');
  addLabel.className = 'shortcut-label';
  addLabel.textContent = '添加';

  addBtn.append(addIcon, addLabel);
  addBtn.addEventListener('click', () => handlers.onAdd?.());
  container.appendChild(addBtn);
}

function dockLinkFingerprint(item) {
  return `${item.url}|${item.icon || ''}|${item.letter || ''}|${item.color || ''}`;
}

function dockStructureMatches(container, dock) {
  const pageSwitch = container.querySelector('.dock-page-switch');
  if (!pageSwitch) return false;

  const tabBtns = pageSwitch.querySelectorAll('.dock-tab');
  if (tabBtns.length !== DOCK_PAGES.length) return false;
  for (let i = 0; i < DOCK_PAGES.length; i += 1) {
    if (tabBtns[i].dataset.page !== DOCK_PAGES[i].page) return false;
  }

  const links = dock.filter((item) => item.type === 'link');
  const linkEls = container.querySelectorAll('.dock-item.dock-link');
  if (linkEls.length !== links.length) return false;

  return links.every((item, i) => linkEls[i].dataset.dockId === item.id);
}

function updateDockActiveTab(container, currentPage) {
  for (const btn of container.querySelectorAll('.dock-tab')) {
    const isActive = currentPage === btn.dataset.page;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  }
}

function updateDockLinksInPlace(container, dock) {
  const links = dock.filter((item) => item.type === 'link');
  const linkEls = container.querySelectorAll('.dock-item.dock-link');
  links.forEach((item, i) => {
    const el = linkEls[i];
    if (!el) return;
    const fp = dockLinkFingerprint(item);
    if (el.dataset.dockFp === fp) return;
    el.href = item.url;
    el.title = item.id;
    el.dataset.dockFp = fp;
    const iconWrap = el.querySelector('.shortcut-icon--dock');
    if (iconWrap) renderIconInto(iconWrap, item, item.url, { eager: true });
  });
}

export function renderDock(container, dock, currentPage, onPageChange) {
  if (dockStructureMatches(container, dock)) {
    updateDockActiveTab(container, currentPage);
    updateDockLinksInPlace(container, dock);
    return;
  }

  container.innerHTML = '';

  const pageSwitch = document.createElement('div');
  pageSwitch.className = 'dock-page-switch';
  pageSwitch.setAttribute('role', 'tablist');
  pageSwitch.setAttribute('aria-label', '页面切换');

  for (const tab of DOCK_PAGES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dock-tab';
    btn.dataset.page = tab.page;
    btn.setAttribute('role', 'tab');
    btn.title = tab.label;
    const isActive = currentPage === tab.page;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    btn.innerHTML = `${dockTabIcon(tab.icon)}<span class="dock-tab-label" aria-hidden="true">${tab.label}</span>`;
    btn.addEventListener('click', () => onPageChange(tab.page));
    pageSwitch.appendChild(btn);
  }
  container.appendChild(pageSwitch);

  const links = dock.filter((item) => item.type === 'link');
  if (links.length) {
    const divider = document.createElement('div');
    divider.className = 'dock-divider';
    divider.setAttribute('aria-hidden', 'true');
    container.appendChild(divider);
  }

  for (const item of links) {
    const el = document.createElement('a');
    el.className = 'dock-item dock-link';
    el.href = item.url;
    el.target = '_blank';
    el.rel = 'noopener noreferrer';
    el.title = item.id;
    el.dataset.dockId = item.id;
    el.dataset.dockFp = dockLinkFingerprint(item);

    const iconWrap = document.createElement('div');
    iconWrap.className = 'shortcut-icon shortcut-icon--dock';
    renderIconInto(iconWrap, item, item.url, { eager: true });
    el.appendChild(iconWrap);

    container.appendChild(el);
  }
}
