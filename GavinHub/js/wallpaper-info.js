import {
  loadSettings,
  normalizeWallpaperSource,
  normalizeSelectableWallpaperSource,
} from './storage.js';

const GENERIC_WALLPAPER_TITLES = new Set([
  'NASA 每日一图', 'NASA 地球俯瞰', 'Bing 每日风景', '国家地理每日',
  '维基百科 · 每日一图', 'Google Earth View', '每日风景',
]);
const NON_LINKABLE_SOURCES = new Set(['gradient', 'random', 'picsum']);
const BUILTIN_POETIC_TITLES = new Set(['山湖晨雾', '河谷石桥', '海岸公路', '森林晨路']);
const KNOWN_PLACE_TITLES = new Set(['赫兹桑德海岸']);
const TITLE_BLOCKLIST = /NASA|EPIC|DSCOVR|地球全彩|地球|卫星|随机|摄影|APOD|太空|orbit|每日一图|每日壁纸|Earth View|Earth Observatory|Astronomy/i;
const PLACE_HINTS = /(?:[湾海岸山湖岛城堡塔公园]|National Park|Bay|Coast|Island|Tower|Cathedral|Temple|Palace|Volcano|Canyon|Desert|Falls|Lake|River)/i;
const GENERIC_CN_SCENIC = /^(?:山湖|河谷|海岸|森林|随机|自然|风景|每日|壁纸|晨雾|石桥|公路|晨路)/;
const CREDIT_NOISE = /©|Getty|Shutterstock|Alamy|iStock|Images|Adobe|摄/i;

function getBaikeUrl(name) {
  return `https://baike.baidu.com/item/${encodeURIComponent(name)}`;
}

function buildWikipediaPageUrl(title) {
  const page = title.trim().replace(/ /g, '_');
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(page).replace(/%3A/g, ':')}`;
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
  const value = title.trim();
  if (!value || GENERIC_WALLPAPER_TITLES.has(value) || BUILTIN_POETIC_TITLES.has(value)) return false;
  if (TITLE_BLOCKLIST.test(value)) return false;
  if (KNOWN_PLACE_TITLES.has(value)) return true;
  if (GENERIC_CN_SCENIC.test(value)) return false;
  if (PLACE_HINTS.test(value)) {
    const prefix = value.replace(/(?:湾|海岸|海|山|岛|城|塔|湖|公园|瀑布|峡谷|沙漠|广场|寺|庙|宫|陵|古道).*$/u, '').trim();
    if (prefix.length >= 2 && !GENERIC_CN_SCENIC.test(prefix)) return true;
  }
  if (/^[\u4e00-\u9fff]{2,}(?:国家森林公园|国家级|风景区|世界遗产|古城|古镇|斜塔)?$/.test(value)) return true;
  if (/^[A-Za-z][A-Za-z\s,''-]{2,}$/.test(value) && value.split(/\s+/).length <= 8) {
    return !/^(?:The\s+)?(?:Daily|Random|Photo|Picture|Image|View|Landscape|Nature|Scenic)/i.test(value);
  }
  return false;
}

function isFamousPlaceTitle(title, source, meta = {}) {
  const name = title?.trim();
  if (!name) return false;
  source = normalizeWallpaperSource(source);
  if (NON_LINKABLE_SOURCES.has(source) || source === 'gradient' || meta?.type === 'gradient') return false;
  if (meta?.url && /picsum\.photos/i.test(meta.url)) return false;
  if (GENERIC_WALLPAPER_TITLES.has(name) || BUILTIN_POETIC_TITLES.has(name)) return false;
  if (TITLE_BLOCKLIST.test(name) || source === 'builtin') return false;
  if (source === 'local' || source === 'library') {
    return KNOWN_PLACE_TITLES.has(name) || looksLikePlaceName(name);
  }
  if (source === 'bing') return name.length >= 2 && name !== '每日风景';
  if (['natgeo', 'wikimedia', 'unsplash-curated', 'pexels-scenic'].includes(source)) {
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

function getWallpaperExternalUrl(data) {
  if (data.pageUrl) return data.pageUrl;
  if (data.linkUrl) return data.linkUrl;
  const source = normalizeWallpaperSource(data.source);
  if (source === 'wikimedia' && data.title?.trim() && data.title !== '维基百科 · 每日一图') {
    return buildWikipediaPageUrl(data.title);
  }
  if (source === 'local' || source === 'library') {
    const name = getWallpaperLinkName(data);
    return name ? getBaikeUrl(name) : null;
  }
  return null;
}

function renderTitle(el, data) {
  if (!el) return;
  const name = (data.title || '').trim();
  const url = getWallpaperExternalUrl(data);
  el.replaceChildren();
  if (!url) {
    el.textContent = name;
    return;
  }
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = name;
  el.appendChild(link);
}

export function createWallpaperInfoController({
  getCurrentWallpaper,
  loadNextWallpaper,
  schedulePreloadNext,
} = {}) {
  const trigger = document.getElementById('wallpaper-info-btn');
  const info = document.getElementById('wallpaper-info');
  const zone = trigger?.closest('.wallpaper-info-zone');
  if (!trigger || !info || !zone) return null;

  const nextButton = document.getElementById('wallpaper-next-btn');
  let hideTimer = 0;
  let pinned = false;

  const render = (data = getCurrentWallpaper?.() || {}) => {
    renderTitle(document.getElementById('wallpaper-title'), data);
    document.getElementById('wallpaper-desc').textContent = data.description || '';
    document.getElementById('wallpaper-credit').textContent = data.credit || '';
    const externalUrl = getWallpaperExternalUrl(data);
    info.classList.toggle('is-linkable', Boolean(externalUrl));
    if (externalUrl) info.dataset.linkUrl = externalUrl;
    else delete info.dataset.linkUrl;
    if (nextButton) {
      nextButton.hidden = normalizeSelectableWallpaperSource(loadSettings().wallpaperSource) !== 'bing';
    }
  };

  const show = () => {
    window.clearTimeout(hideTimer);
    info.hidden = false;
    requestAnimationFrame(() => info.classList.add('visible'));
    schedulePreloadNext?.(getCurrentWallpaper?.());
  };
  const hide = () => {
    if (pinned) return;
    info.classList.remove('visible');
    hideTimer = window.setTimeout(() => {
      if (!pinned) info.hidden = true;
    }, 250);
  };

  zone.addEventListener('mouseenter', show);
  zone.addEventListener('mouseleave', () => {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hide, 120);
  });
  info.addEventListener('mouseenter', show);
  info.addEventListener('mouseleave', hide);
  info.addEventListener('click', (event) => {
    if (event.target.closest('#wallpaper-next-btn, a')) return;
    const url = info.dataset.linkUrl;
    if (!url || !info.classList.contains('is-linkable')) return;
    event.preventDefault();
    window.open(url, '_blank', 'noopener,noreferrer');
  });
  nextButton?.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (nextButton.disabled || nextButton.hidden) return;
    nextButton.disabled = true;
    nextButton.classList.add('is-loading');
    nextButton.textContent = '加载中…';
    try {
      await loadNextWallpaper?.();
      render();
    } catch {
      /* Keep the current wallpaper when the next image is unavailable. */
    } finally {
      nextButton.disabled = false;
      nextButton.classList.remove('is-loading');
      nextButton.textContent = '下一张';
    }
  });
  info.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    pinned = true;
    show();
  }, { passive: true });
  document.addEventListener('mousedown', (event) => {
    if (!pinned || zone.contains(event.target) || info.contains(event.target)) return;
    pinned = false;
    hide();
  }, { passive: true });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !pinned) return;
    pinned = false;
    hide();
  });

  render();
  return { render };
}
