import { loadArxiv, initArxiv } from './arxiv.js';
import { loadGithubHome } from './github-home.js';
import { KEYS, SESSION_KEYS } from './keys.js';
import { readJson, writeJson } from './storage.js';
import { corsProxyUrls, escapeHtml, extractProxiedBody, fetchWithTimeout, formatRelativeTime } from './util.js';

const PROXY_TIMEOUT = 12000;
const ITEMS_PER_FEED = 3;
const PARSE_LIMIT_ROTATE = 20;
const MAX_NEWS_ITEMS = 10;
const ROTATE_SOURCES_MAX = 2;
const RSS_STORAGE_KEY = KEYS.rssSources;
const NEWS_CACHE_KEY = KEYS.newsCache;
const NEWS_CACHE_TTL = 30 * 60 * 1000;
const ROTATION_STATE_KEY = SESSION_KEYS.newsRotation;
const RSS_STATS_KEY = KEYS.rssStats;

export const BUILTIN_RSS_SOURCES = [
  {
    id: '36kr',
    name: '36氪',
    url: 'https://www.36kr.com/feed',
    accent: '#286bf5',
    letter: '36',
  },
  {
    id: 'ithome',
    name: 'IT之家',
    url: 'https://www.ithome.com/rss/',
    accent: '#d22222',
    letter: 'IT',
  },
  {
    id: 'sspai',
    name: '少数派',
    url: 'https://sspai.com/feed',
    accent: '#d71a1b',
    letter: '少',
  },
  {
    id: 'thepaper',
    name: '澎湃新闻',
    url: 'https://rsshub.rssforever.com/thepaper/featured',
    accent: '#0080ff',
    letter: '澎',
  },
  {
    id: 'zaker',
    name: 'ZAKER',
    url: 'https://rsshub.rssforever.com/zaker/focusread',
    accent: '#e74c3c',
    letter: 'Z',
  },
  {
    id: 'dgtle',
    name: '数字尾巴',
    url: 'https://rsshub.rssforever.com/dgtle/news/0',
    accent: '#00a0e9',
    letter: '数',
  },
];

const DEFAULT_ENABLED = ['36kr', 'ithome', 'sspai', 'thepaper'];
const CUSTOM_ACCENTS = ['#636366', '#007aff', '#34c759', '#ff9500', '#af52de', '#ff2d55'];

let loaded = false;
let loading = false;
let rssSettingsDirty = false;
/** @type {Record<string, { ok: boolean, at: number }>} */
let lastFeedStatuses = {};

function recordFeedResult(feedId, ok) {
  lastFeedStatuses[feedId] = { ok, at: Date.now() };
  try {
    const stats = readJson(RSS_STATS_KEY, {});
    const entry = stats[feedId] || { ok: 0, fail: 0, lastOk: 0 };
    if (ok) {
      entry.ok += 1;
      entry.lastOk = Date.now();
    } else {
      entry.fail += 1;
    }
    stats[feedId] = entry;
    writeJson(RSS_STATS_KEY, stats);
  } catch {
    /* ignore storage errors */
  }
}

function feedReliabilityScore(feedId) {
  try {
    const stats = readJson(RSS_STATS_KEY, {})[feedId];
    if (!stats) return 0.5;
    const total = stats.ok + stats.fail;
    if (!total) return 0.5;
    const rate = stats.ok / total;
    const recentBonus = stats.lastOk && Date.now() - stats.lastOk < 3600000 ? 0.15 : 0;
    return rate + recentBonus;
  } catch {
    return 0.5;
  }
}

function sortFeedsByReliability(feeds) {
  return [...feeds].sort((a, b) => feedReliabilityScore(b.id) - feedReliabilityScore(a.id));
}

function accentForId(id) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return CUSTOM_ACCENTS[hash % CUSTOM_ACCENTS.length];
}

export function loadRssSettings() {
  const data = readJson(RSS_STORAGE_KEY, null);
  if (!data) return { enabled: [...DEFAULT_ENABLED], custom: [] };
  return {
    enabled: Array.isArray(data.enabled) ? data.enabled : [...DEFAULT_ENABLED],
    custom: Array.isArray(data.custom) ? data.custom : [],
  };
}

export function saveRssSettings(settings) {
  writeJson(RSS_STORAGE_KEY, settings);
}

function feedFromCustom(custom) {
  return {
    id: custom.id,
    name: custom.name,
    url: custom.url,
    accent: accentForId(custom.id),
    letter: custom.name?.charAt(0) || 'R',
  };
}

export function getActiveFeeds() {
  const settings = loadRssSettings();
  const enabled = new Set(settings.enabled);
  const builtin = BUILTIN_RSS_SOURCES.filter((feed) => enabled.has(feed.id));
  const custom = settings.custom
    .filter((item) => enabled.has(item.id))
    .map(feedFromCustom);
  return [...builtin, ...custom];
}

function extractRssXmlFromResponse(text, isJson) {
  const body = extractProxiedBody(text, isJson);
  return body.startsWith('<') ? body : '';
}

async function fetchRssViaProxy(proxyUrl) {
  const res = await fetchWithTimeout(proxyUrl, PROXY_TIMEOUT);
  if (!res.ok) return '';

  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const isJson = ct.includes('json') || proxyUrl.includes('/get?');
  const text = await res.text();
  return extractRssXmlFromResponse(text, isJson);
}

async function fetchRssXml(feedUrl) {
  const proxies = corsProxyUrls(feedUrl);
  const [primary, secondary, ...fallbacks] = proxies;

  const waveOne = await Promise.allSettled([
    fetchRssViaProxy(primary),
    fetchRssViaProxy(secondary),
  ]);
  for (const result of waveOne) {
    if (result.status === 'fulfilled' && result.value) return result.value;
  }

  for (const url of fallbacks) {
    try {
      const xml = await fetchRssViaProxy(url);
      if (xml) return xml;
    } catch {
      /* try next proxy */
    }
  }

  throw new Error(`无法获取 ${feedUrl}`);
}

const ATOM_NS = 'http://www.w3.org/2005/Atom';

function textContent(el) {
  return (el?.textContent || '').trim();
}

function cleanLinkText(raw) {
  if (!raw) return '';
  const text = raw.trim();
  const cdata = text.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return (cdata ? cdata[1] : text).trim();
}

function isHttpUrl(str) {
  return /^https?:\/\//i.test(str || '');
}

function isHomepageUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return path === '/';
  } catch {
    return true;
  }
}

function extractLinkFromHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const anchors = doc.querySelectorAll('a[href]');
  for (const a of anchors) {
    const href = cleanLinkText(a.getAttribute('href') || '');
    if (isHttpUrl(href) && !isHomepageUrl(href)) return href;
  }
  return '';
}

function atomEntryLink(entry) {
  const links = [...entry.getElementsByTagNameNS(ATOM_NS, 'link')];
  const hrefOf = (pred) => links.find(pred)?.getAttribute('href') || '';
  return (
    hrefOf((el) => el.getAttribute('rel') === 'alternate' && (el.getAttribute('type') || '').includes('html'))
    || hrefOf((el) => el.getAttribute('rel') === 'alternate')
    || hrefOf((el) => {
      const rel = el.getAttribute('rel') || '';
      return rel !== 'self' && rel !== 'enclosure';
    })
    || hrefOf((el) => el.getAttribute('href'))
  );
}

function rssItemLink(entry) {
  const linkEl = entry.querySelector('link');
  if (!linkEl) return '';
  return cleanLinkText(linkEl.getAttribute('href') || linkEl.textContent || '');
}

function guidCandidates(entry) {
  const guidEl = entry.querySelector('guid, id');
  if (!guidEl) return [];
  const guid = cleanLinkText(textContent(guidEl));
  if (!guid) return [];

  const permaLink = guidEl.getAttribute('isPermaLink');
  if (permaLink === 'false') return [];
  if (permaLink === 'true' || isHttpUrl(guid)) return [guid];
  return [];
}

function feedSpecificLinkCandidates(feedId, guid) {
  if (!guid || isHttpUrl(guid)) return [];
  if (feedId === 'dgtle') {
    const match = guid.match(/^dgtle-(\d+)$/);
    if (match) return [`https://www.dgtle.com/news-${match[1]}-1.html`];
  }
  return [];
}

function normalizeFeedLink(url, feedId) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (feedId === 'thepaper') {
      const detail = parsed.href.match(/(?:m\.)?thepaper\.cn\/detail\/(\d+)/i);
      if (detail) return `https://www.thepaper.cn/newsDetail_forward_${detail[1]}`;
    }
    if (feedId === '36kr' && /(?:^|\.)36kr\.com$/i.test(parsed.hostname)) {
      parsed.hostname = '36kr.com';
      parsed.searchParams.delete('f');
    }
    return parsed.href;
  } catch {
    return url;
  }
}

function feedDomainHints(feedId) {
  const map = {
    '36kr': ['36kr.com'],
    ithome: ['ithome.com'],
    sspai: ['sspai.com'],
    thepaper: ['thepaper.cn'],
    zaker: ['myzaker.com', 'zaker.cn'],
    dgtle: ['dgtle.com'],
  };
  return map[feedId] || [];
}

function linkMatchesFeedDomain(url, feedId) {
  const domains = feedDomainHints(feedId);
  if (!domains.length) return true;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return domains.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

function pickBestLink(candidates, feedId) {
  const seen = new Set();
  const cleaned = [];
  for (const raw of candidates) {
    const link = normalizeFeedLink(cleanLinkText(raw), feedId);
    if (!isHttpUrl(link) || seen.has(link)) continue;
    seen.add(link);
    cleaned.push(link);
  }

  const preferred = cleaned.filter((link) => linkMatchesFeedDomain(link, feedId) && !isHomepageUrl(link));
  if (preferred.length) return preferred[0];

  const nonHome = cleaned.filter((link) => !isHomepageUrl(link));
  if (nonHome.length) return nonHome[0];

  return cleaned[0] || '';
}

function extractItemLink(entry, feedId) {
  const isAtom = entry.tagName.toLowerCase() === 'entry';
  const guidEl = entry.querySelector('guid, id');
  const guid = cleanLinkText(textContent(guidEl));
  const htmlFields = [
    entry.querySelector('content\\:encoded')?.textContent,
    entry.querySelector('content')?.textContent,
    entry.querySelector('description')?.textContent,
    entry.querySelector('summary')?.textContent,
  ].filter(Boolean);

  const candidates = [
    isAtom ? atomEntryLink(entry) : rssItemLink(entry),
    ...guidCandidates(entry),
    ...feedSpecificLinkCandidates(feedId, guid),
    extractLinkFromHtml(htmlFields[0] || ''),
  ];

  return pickBestLink(candidates, feedId);
}

function stampItemsWithSource(items, feed) {
  return items.map((item) => ({
    ...item,
    sourceId: feed.id,
    sourceName: feed.name,
    sourceAccent: feed.accent,
  }));
}

function stripHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

function parseRssItems(xml, limit = ITEMS_PER_FEED, feedId = '') {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) return [];

  const entries = doc.querySelector('feed')
    ? [...doc.querySelectorAll('feed > entry')]
    : [...doc.querySelectorAll('channel > item')];

  return entries.slice(0, limit).map((entry) => {
    const title = textContent(entry.querySelector('title'));
    const link = extractItemLink(entry, feedId);
    const htmlFields = [
      entry.querySelector('content\\:encoded')?.textContent,
      entry.querySelector('content')?.textContent,
      entry.querySelector('description')?.textContent,
      entry.querySelector('summary')?.textContent,
    ].filter(Boolean);

    const excerptRaw = htmlFields[0] || entry.querySelector('description, summary')?.textContent || '';
    const excerpt = stripHtml(excerptRaw).slice(0, 120);
    const dateRaw = textContent(entry.querySelector('pubDate, published, updated, dc\\:date'));
    const date = dateRaw ? new Date(dateRaw).toISOString() : new Date().toISOString();

    return { title, link, excerpt, date };
  }).filter((item) => item.title && item.link);
}

async function loadFeedItems(feed, { parseLimit = ITEMS_PER_FEED } = {}) {
  try {
    const xml = await fetchRssXml(feed.url);
    const items = parseRssItems(xml, parseLimit, feed.id);
    if (items.length) {
      recordFeedResult(feed.id, true);
      return { items: stampItemsWithSource(items, feed) };
    }
  } catch {
    /* skip failed source */
  }

  recordFeedResult(feed.id, false);
  return { items: [] };
}

function renderNewsItem(item) {
  return `
    <a class="feed-item feed-item--compact" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">
      <div class="feed-item-body">
        <h3 class="feed-item-title">${escapeHtml(item.title)}</h3>
        <p class="feed-item-excerpt">${escapeHtml(item.excerpt || '暂无摘要')}</p>
        <div class="feed-item-meta">
          <span class="feed-item-source" style="--feed-accent:${item.sourceAccent}">${escapeHtml(item.sourceName)}</span>
          <time datetime="${escapeHtml(item.date)}">${formatRelativeTime(item.date)}</time>
        </div>
      </div>
    </a>
  `;
}

function mergeNewsItems(existing, incoming) {
  const seen = new Set(existing.map((item) => item.link));
  const merged = [...existing];
  for (const item of incoming) {
    if (!item.link || seen.has(item.link)) continue;
    seen.add(item.link);
    merged.push(item);
  }
  return merged
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, MAX_NEWS_ITEMS);
}

function localDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfLocalDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function shuffleArray(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 优先当天条目，不足则回退近 1～3 天，仍无则显示最近条目 */
function filterTodayItems(items, maxDaysFallback = 3) {
  const todayStart = startOfLocalDay();
  const todayItems = items.filter((item) => new Date(item.date) >= todayStart);
  if (todayItems.length) return todayItems;

  for (let days = 1; days <= maxDaysFallback; days += 1) {
    const cutoff = new Date(todayStart);
    cutoff.setDate(cutoff.getDate() - days);
    const matched = items.filter((item) => new Date(item.date) >= cutoff);
    if (matched.length) return matched;
  }
  return items.slice(0, MAX_NEWS_ITEMS);
}

function prepareRotatedItems(items) {
  return shuffleArray(filterTodayItems(items)).slice(0, MAX_NEWS_ITEMS);
}

function pickRotatingFeeds(feeds, count) {
  const pickCount = Math.min(count, feeds.length);
  if (feeds.length <= pickCount) return sortFeedsByReliability(feeds);

  let recent = [];
  try {
    const raw = sessionStorage.getItem(ROTATION_STATE_KEY);
    if (raw) recent = JSON.parse(raw);
  } catch {
    /* ignore */
  }

  const recentSet = new Set(Array.isArray(recent) ? recent : []);
  let pool = feeds.filter((feed) => !recentSet.has(feed.id));
  if (pool.length < pickCount) pool = [...feeds];

  const ranked = sortFeedsByReliability(pool);
  const topSlice = ranked.slice(0, Math.min(ranked.length, pickCount + 2));
  const picked = shuffleArray(topSlice).slice(0, pickCount);
  const newRecent = [
    ...picked.map((feed) => feed.id),
    ...recent.filter((id) => !picked.some((feed) => feed.id === id)),
  ];
  sessionStorage.setItem(ROTATION_STATE_KEY, JSON.stringify(newRecent.slice(0, feeds.length * 2)));
  return picked;
}

function pickRotateSourceCount(feedCount) {
  if (feedCount <= 1) return 1;
  return Math.random() < 0.5 ? 1 : Math.min(ROTATE_SOURCES_MAX, feedCount);
}

function cacheFeedSignature() {
  return getActiveFeeds()
    .map((feed) => feed.id)
    .sort()
    .join(',');
}

function loadNewsCache() {
  const data = readJson(NEWS_CACHE_KEY, null);
  if (!data || !Array.isArray(data.items) || !data.items.length) return null;
  if (data.feeds !== cacheFeedSignature()) return null;
  if (data.dayKey !== localDayKey()) return null;
  if (Date.now() - (data.at || 0) > NEWS_CACHE_TTL) return null;
  return {
    items: data.items,
    sourceNames: Array.isArray(data.sourceNames) ? data.sourceNames : [],
  };
}

function saveNewsCache(items, sourceNames = []) {
  if (!items.length) return;
  writeJson(NEWS_CACHE_KEY, {
    items,
    sourceNames,
    at: Date.now(),
    dayKey: localDayKey(),
    feeds: cacheFeedSignature(),
  });
}

function formatStatusTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatNewsStatus(sourceNames, { cached = false } = {}) {
  const time = formatStatusTime();
  const prefix = cached ? '缓存 · ' : '';
  if (!sourceNames?.length) return `${prefix}今日摘要 · ${time}`;
  if (sourceNames.length === 1) return `${prefix}${sourceNames[0]} · ${time}`;
  return `${prefix}${sourceNames.join('、')} · ${time}`;
}

function renderNewsList(items) {
  if (!items.length) {
    return '<p class="feed-empty">暂无资讯</p>';
  }
  return items.map((item) => renderNewsItem(item)).join('');
}

function renderNewsLoading() {
  return Array.from({ length: 6 }, () => `
    <div class="feed-item feed-item--compact feed-item--skeleton" aria-hidden="true">
      <div class="feed-item-body">
        <div class="skeleton-line skeleton-line--title"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line skeleton-line--short"></div>
      </div>
    </div>
  `).join('');
}

function listHasRealContent(list) {
  return Boolean(list.querySelector('.feed-item:not(.feed-item--skeleton)'));
}

function replaceListHTML(list, html) {
  const temp = document.createElement('div');
  temp.innerHTML = html;
  list.replaceChildren(...temp.childNodes);
}

function setListLoadingState(list, loading) {
  list.classList.toggle('feed-list--updating', loading);
}

async function loadNewsRotated(force, list, statusEl, feeds) {
  const cached = !force ? loadNewsCache() : null;

  if (cached?.items?.length) {
    replaceListHTML(list, renderNewsList(cached.items));
    if (statusEl) statusEl.textContent = formatNewsStatus(cached.sourceNames, { cached: true });
    return;
  }

  const hadContent = listHasRealContent(list);
  const prevStatus = statusEl?.textContent || '';

  if (!hadContent) {
    replaceListHTML(list, renderNewsLoading());
    if (statusEl) statusEl.textContent = '加载中…';
  } else {
    setListLoadingState(list, true);
  }

  const sourceCount = pickRotateSourceCount(feeds.length);
  const primaryFeeds = pickRotatingFeeds(feeds, sourceCount);
  const triedIds = new Set();
  let allItems = [];
  const sourceNames = [];

  const tryFeed = async (feed) => {
    if (triedIds.has(feed.id)) return false;
    triedIds.add(feed.id);
    const { items: feedItems } = await loadFeedItems(feed, { parseLimit: PARSE_LIMIT_ROTATE });
    if (feedItems.length) {
      allItems.push(...feedItems);
      sourceNames.push(feed.name);
      return true;
    }
    return false;
  };

  for (const feed of primaryFeeds) {
    await tryFeed(feed);
  }

  if (!allItems.length) {
    const fallbacks = sortFeedsByReliability(feeds.filter((f) => !triedIds.has(f.id)));
    for (const feed of fallbacks) {
      await tryFeed(feed);
      if (allItems.length) break;
    }
  }

  setListLoadingState(list, false);

  const finalItems = prepareRotatedItems(allItems);
  if (finalItems.length) {
    replaceListHTML(list, renderNewsList(finalItems));
    saveNewsCache(finalItems, sourceNames);
    if (statusEl) statusEl.textContent = formatNewsStatus(sourceNames);
    return;
  }

  if (!hadContent) {
    replaceListHTML(list, renderNewsList([]));
  }
  const failedNames = [...triedIds]
    .map((id) => feeds.find((f) => f.id === id)?.name)
    .filter(Boolean);
  if (statusEl) {
    statusEl.textContent = failedNames.length
      ? `${failedNames.join('、')} · 暂不可用`
      : (prevStatus || '暂不可用');
  }
}

async function loadNewsAll(force, list, statusEl, feeds) {
  const cached = !force ? loadNewsCache() : null;
  const hadContent = listHasRealContent(list);
  let items = cached?.items ? [...cached.items] : [];
  const sourceNames = new Set(cached?.sourceNames || []);

  if (items.length) {
    replaceListHTML(list, renderNewsList(items));
    if (statusEl) statusEl.textContent = formatNewsStatus(cached.sourceNames, { cached: true });
  } else if (!hadContent) {
    replaceListHTML(list, renderNewsLoading());
    if (statusEl) statusEl.textContent = '加载中…';
  } else {
    setListLoadingState(list, true);
  }

  const results = await Promise.all(feeds.map((feed) => loadFeedItems(feed)));
  for (let i = 0; i < feeds.length; i += 1) {
    const feedItems = results[i].items;
    if (feedItems.length) {
      sourceNames.add(feeds[i].name);
      items = mergeNewsItems(items, feedItems);
    }
  }

  setListLoadingState(list, false);
  const names = [...sourceNames];
  if (items.length) {
    replaceListHTML(list, renderNewsList(items));
    saveNewsCache(items, names);
    if (statusEl) statusEl.textContent = formatNewsStatus(names);
  } else if (!hadContent) {
    replaceListHTML(list, renderNewsList([]));
    if (statusEl) statusEl.textContent = '暂不可用';
  }
}

/** @param {boolean} force 跳过缓存强制拉取 */
/** @param {{ mode?: 'rotate' | 'all' }} options rotate=轮换源+今日摘要，all=全源合并 */
export async function loadNews(force = false, options = {}) {
  const { mode = 'rotate' } = options;
  const list = document.getElementById('feed-list');
  const statusEl = document.getElementById('news-status');
  if (!list) return;

  const feeds = getActiveFeeds();

  if (!feeds.length) {
    list.innerHTML = '<p class="feed-empty">暂无资讯，请在设置中启用 RSS 源</p>';
    if (statusEl) statusEl.textContent = '未启用源';
    return;
  }

  if (mode === 'rotate') {
    await loadNewsRotated(force, list, statusEl, feeds);
  } else {
    await loadNewsAll(force, list, statusEl, feeds);
  }
}

export async function loadFeed(force = false) {
  const statusEl = document.getElementById('feed-status');
  if (!document.getElementById('feed-list')) return;

  if (loading) return;
  if (loaded && !force) return;

  loading = true;
  if (statusEl) statusEl.textContent = '正在加载…';

  try {
    await Promise.all([
      loadNews(force),
      loadArxiv(force),
      loadGithubHome(force),
    ]);

    if (statusEl) {
      statusEl.textContent = `已更新 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    }

    loaded = true;
  } finally {
    loading = false;
  }
}

function renderRssSettingsPanel() {
  const settings = loadRssSettings();
  const enabled = new Set(settings.enabled);
  const builtinList = document.getElementById('rss-builtin-list');
  const customList = document.getElementById('rss-custom-list');

  if (builtinList) {
    builtinList.innerHTML = BUILTIN_RSS_SOURCES.map((source) => {
      const status = lastFeedStatuses[source.id];
      const statusClass = status ? (status.ok ? 'rss-source-status--ok' : 'rss-source-status--off') : 'rss-source-status--unknown';
      const statusText = status ? (status.ok ? '在线' : '离线') : '未加载';
      return `
      <label class="rss-builtin-item">
        <input type="checkbox" data-rss-id="${escapeHtml(source.id)}" ${enabled.has(source.id) ? 'checked' : ''}>
        <span class="rss-builtin-item-name">${escapeHtml(source.name)}</span>
        <span class="rss-source-status ${statusClass}" title="上次刷新状态">${statusText}</span>
      </label>`;
    }).join('');
  }

  if (customList) {
    customList.innerHTML = settings.custom.map((item) => `
      <li class="rss-custom-item">
        <label>
          <input type="checkbox" data-rss-id="${escapeHtml(item.id)}" ${enabled.has(item.id) ? 'checked' : ''}>
          <span class="rss-custom-item-name">${escapeHtml(item.name)}</span>
          <span class="rss-custom-item-url" title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</span>
        </label>
        <button type="button" class="rss-custom-delete" data-delete-id="${escapeHtml(item.id)}">删除</button>
      </li>
    `).join('');
  }
}

function toggleRssSource(id, checked) {
  const settings = loadRssSettings();
  const enabled = new Set(settings.enabled);
  if (checked) enabled.add(id);
  else enabled.delete(id);
  settings.enabled = [...enabled];
  saveRssSettings(settings);
  rssSettingsDirty = true;
}

function deleteCustomRss(id) {
  const settings = loadRssSettings();
  settings.custom = settings.custom.filter((item) => item.id !== id);
  settings.enabled = settings.enabled.filter((itemId) => itemId !== id);
  saveRssSettings(settings);
  rssSettingsDirty = true;
  renderRssSettingsPanel();
}

function addCustomRss(name, url) {
  const settings = loadRssSettings();
  const id = `custom-${Date.now()}`;
  settings.custom.push({ id, name, url });
  if (!settings.enabled.includes(id)) settings.enabled.push(id);
  saveRssSettings(settings);
  rssSettingsDirty = true;
  renderRssSettingsPanel();
}

function initRssSettings() {
  const dialog = document.getElementById('rss-settings-dialog');
  const openBtn = document.getElementById('rss-settings-btn');
  const form = document.getElementById('rss-custom-form');
  const nameInput = document.getElementById('rss-custom-name');
  const urlInput = document.getElementById('rss-custom-url');

  openBtn?.addEventListener('click', () => {
    renderRssSettingsPanel();
    rssSettingsDirty = false;
    dialog?.showModal();
  });

  dialog?.querySelector('.modal-close')?.addEventListener('click', () => dialog.close());

  dialog?.addEventListener('close', () => {
    if (rssSettingsDirty) {
      loaded = false;
      loadFeed(true);
    }
  });

  dialog?.addEventListener('change', (e) => {
    const checkbox = e.target.closest('input[type="checkbox"][data-rss-id]');
    if (!checkbox) return;
    toggleRssSource(checkbox.dataset.rssId, checkbox.checked);
  });

  dialog?.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('[data-delete-id]');
    if (!deleteBtn) return;
    deleteCustomRss(deleteBtn.dataset.deleteId);
  });

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput?.value.trim();
    const url = urlInput?.value.trim();
    if (!name || !url) return;
    try {
      new URL(url);
    } catch {
      urlInput?.focus();
      return;
    }
    addCustomRss(name, url);
    form.reset();
  });
}

export function initFeed() {
  initArxiv();
  initRssSettings();

  const refreshBtn = document.getElementById('feed-refresh');
  refreshBtn?.addEventListener('click', () => {
    loaded = false;
    loadFeed(true);
  });

  document.getElementById('news-refresh')?.addEventListener('click', () => loadNews(true, { mode: 'rotate' }));
}
