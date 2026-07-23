import {
  getSearchUrl,
  getSearchEngineLabel,
  getTranslateUrl,
  getAiUrl,
  getMapUrl,
  getAiProvider,
  getMapProvider,
  aiProviderNeedsClipboard,
  SEARCH_ENGINE_ORDER,
  AI_PROVIDERS,
  MAP_PROVIDERS,
  loadSettings,
  readString,
  writeString,
} from './storage.js';
import { KEYS } from './keys.js';
import { initLazySearchQuote } from './lazy-search-quote.js';
import { buildCurrencySuggestion, parseCurrencyInput } from './currency.js';
import { buildSmartSuggestions, resolveSmartAction } from './smart-input.js';
import { fetchQueryCompletions } from './search-suggest.js';
import { createSuggestionNode, activateSuggestionItem } from './search-suggestions-ui.js';

const BLOCKING_SMART_IDS = ['url', 'doi', 'weather', 'calc', 'base', 'datasize'];
const BLOCKS_COMPLETIONS = new Set(BLOCKING_SMART_IDS);

const GITHUB_ICON = 'https://github.githubassets.com/favicons/favicon.svg';
const ZHIHU_ICON = 'https://static.zhihu.com/heifetz/favicon.ico';
const XHS_ICON = 'https://www.xiaohongshu.com/favicon.ico';

/** 普通搜索引擎 favicon（优先清晰 32px 源，失败时走 gstatic fallback） */
const SEARCH_ENGINE_SITES = {
  google: 'https://www.google.com',
  bing: 'https://www.bing.com',
};

function getSearchEngineIcon(engine) {
  const site = SEARCH_ENGINE_SITES[engine] || SEARCH_ENGINE_SITES.google;
  return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(site)}&size=32`;
}

function getGithubUrl(query) {
  return `https://github.com/search?q=${encodeURIComponent(query)}`;
}

function getZhihuUrl(query) {
  return `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(query)}`;
}

function getXhsUrl(query) {
  return `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}`;
}

function parseGhPrefix(query) {
  const match = query.match(/^gh\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

let getSettings = () => ({ searchEngine: 'google', searchMode: 'normal', aiProvider: 0, mapProvider: 0 });
let onSettingsChange = () => {};
let inputEl = null;
let listEl = null;
let boxEl = null;
let badgeEl = null;
let badgeIconEl = null;
let badgeLabelEl = null;
let modeLabelEl = null;
let menuEl = null;
let engineMenuOpen = false;
let badgeIconGen = 0;
let composingInput = false;
/** compositionend 常早于确认键的 keydown；短窗内仍视为组字，避免 zh+Tab 误进知乎 */
let compositionGuardUntil = 0;
let searchQuote = { show: () => {}, hide: () => {}, hideImmediate: () => {} };

/** 中文等 IME 组字中：Tab/Enter 不能当模式快捷键，否则拼音 zh/ai/gh 会被误切到知乎等。 */
function isImeComposing(e) {
  return composingInput
    || e?.isComposing === true
    || e?.keyCode === 229
    || Date.now() < compositionGuardUntil;
}

const MODE_LABELS = {
  ai: 'AI搜索',
  map: '地图搜索',
  gh: 'GitHub',
  zh: '知乎',
  xhs: '小红书',
};

function normalizeModeInput(raw) {
  return raw.trim().normalize('NFKC').toLowerCase();
}

/** Tab 进入对应搜索模式；整行输入须与别名完全匹配。匹配时不显示建议。 */
const MODE_ALIASES = {
  map: ['map', 'dt', 'ditu', '地图'],
  ai: ['ai', 'doubao', '豆包', 'db'],
  gh: ['gh', 'github'],
  xhs: ['xhs', '小红书'],
  zh: ['zh', 'zhihu', '知乎'],
};

const TAB_TRIGGER_ALIAS_TO_MODE = new Map(
  Object.entries(MODE_ALIASES).flatMap(([mode, aliases]) =>
    aliases.map((alias) => [normalizeModeInput(alias), mode]),
  ),
);

function isTabTriggerInput(value = inputEl?.value ?? '') {
  return TAB_TRIGGER_ALIAS_TO_MODE.has(normalizeModeInput(value));
}

function getSubmitUrl(query) {
  const { searchMode, searchEngine, aiProvider, mapProvider } = getSettings();

  if (searchMode === 'ai') {
    return getAiUrl(aiProvider, query);
  }
  if (searchMode === 'map') {
    return getMapUrl(mapProvider, query);
  }
  if (searchMode === 'gh') {
    return getGithubUrl(query);
  }
  if (searchMode === 'zh') {
    return getZhihuUrl(query);
  }
  if (searchMode === 'xhs') {
    return getXhsUrl(query);
  }
  return getSearchUrl(searchEngine, query);
}

let toastTimer = null;

function showSearchToast(message, duration = 3200) {
  let toast = document.querySelector('.search-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'search-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('visible');
  }, duration);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      document.body.removeChild(ta);
      return false;
    }
  }
}

function showAiLoginHint() {
  if (readString(KEYS.aiLoginHint)) return;
  writeString(KEYS.aiLoginHint, '1');

  let hint = document.querySelector('.search-ai-hint');
  if (!hint && boxEl) {
    hint = document.createElement('div');
    hint.className = 'search-ai-hint';
    hint.innerHTML = `
      <p>部分 AI 助手首次使用需登录一次；问题会自动复制，打开后粘贴发送即可。</p>
      <button type="button" class="search-ai-hint-dismiss">知道了</button>
    `;
    hint.querySelector('.search-ai-hint-dismiss').addEventListener('click', () => {
      hint.classList.remove('visible');
    });
    boxEl.parentElement.insertBefore(hint, listEl);
  }
  if (hint) {
    requestAnimationFrame(() => hint.classList.add('visible'));
  }
}

function openInNewTab(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function handleSmartAction(action) {
  if (!action) return false;
  if (action.action === 'copy' && action.copyText) {
    const copied = await copyToClipboard(action.copyText);
    showSearchToast(copied ? `已复制：${action.copyText}` : `结果：${action.copyText}`);
    return true;
  }
  if (action.url) {
    window.location.href = action.url;
    return true;
  }
  return false;
}

async function trySmartSubmit(query) {
  const { searchMode, mapProvider } = getSettings();
  if (searchMode !== 'normal') return false;

  const smartItems = buildSmartSuggestions(query, { getMapUrl, mapProvider });
  const action = resolveSmartAction(query, smartItems);
  if (!action) return false;
  return handleSmartAction(action);
}

async function executeSearch(query) {
  const { searchMode, searchEngine, aiProvider, mapProvider } = getSettings();

  if (searchMode === 'normal') {
    if (await trySmartSubmit(query)) return;

    const ghQuery = parseGhPrefix(query);
    if (ghQuery) {
      window.location.href = getGithubUrl(ghQuery);
      return;
    }
    window.location.href = getSearchUrl(searchEngine, query);
    return;
  }

  if (searchMode === 'map') {
    window.location.href = getMapUrl(mapProvider, query);
    return;
  }

  if (searchMode === 'gh') {
    window.location.href = getGithubUrl(query);
    return;
  }

  if (searchMode === 'zh') {
    window.location.href = getZhihuUrl(query);
    return;
  }

  if (searchMode === 'xhs') {
    window.location.href = getXhsUrl(query);
    return;
  }

  const provider = getAiProvider(aiProvider);
  const url = provider.buildUrl(query);

  if (aiProviderNeedsClipboard(aiProvider) && query) {
    showAiLoginHint();
    const copyPromise = copyToClipboard(query);
    openInNewTab(url);
    const copied = await copyPromise;
    if (copied) {
      showSearchToast(`问题已复制，请在 ${provider.name} 中粘贴发送（Ctrl+V / ⌘V，首次可能需登录）`);
    } else {
      showSearchToast(`已打开 ${provider.name}，请手动粘贴或输入问题（首次可能需登录）`);
    }
    return;
  }

  openInNewTab(url);
}

function buildSyncSuggestions(query) {
  if (isTabTriggerInput(query)) {
    return [];
  }

  const items = [];
  const { searchMode, mapProvider } = getSettings();

  if (searchMode === 'normal') {
    const smartItems = buildSmartSuggestions(query, { getMapUrl, mapProvider });
    items.push(...smartItems);

    const hasTranslate = smartItems.some((i) => i.id === 'translate');
    const hasBlocking = smartItems.some((i) => BLOCKS_COMPLETIONS.has(i.id));
    if (!hasTranslate && !hasBlocking && !parseCurrencyInput(query)) {
      items.unshift({
        id: 'translate',
        type: '',
        text: query,
        url: getTranslateUrl(query),
      });
    }
  }

  return items;
}

function hideSuggestions() {
  if (!listEl) return;
  listEl.hidden = true;
  listEl.innerHTML = '';
  suggestionItems = [];
  activeSuggestionIndex = -1;
  if (boxEl?.classList.contains('focused') && !inputEl?.value.trim() && !engineMenuOpen) {
    searchQuote.show(getSettings().searchMode);
  }
}

function hideSuggestionsPanel() {
  if (!listEl) return;
  listEl.hidden = true;
}

function restoreSuggestionsIfNeeded() {
  if (!inputEl?.value.trim()) return;
  if (document.activeElement !== inputEl) return;
  refreshSearchSuggestions();
}

function renderSuggestions(items) {
  if (!listEl) return;

  if (engineMenuOpen) {
    listEl.hidden = true;
    return;
  }

  if (!items.length) {
    hideSuggestions();
    return;
  }

  searchQuote.hideImmediate();
  suggestionItems = items;
  activeSuggestionIndex = -1;
  const handlers = getSuggestionHandlers();
  listEl.replaceChildren(...items.map((item) => createSuggestionNode(item, handlers)));
  listEl.querySelectorAll('.search-suggestion').forEach((el, i) => {
    el.addEventListener('mouseenter', () => setActiveSuggestionIndex(i));
  });
  listEl.hidden = false;
}

function getMenuItems() {
  const { searchMode } = getSettings();

  if (searchMode === 'ai') {
    return AI_PROVIDERS.map((p, i) => ({
      key: String(i),
      label: p.name,
      active: i === getSettings().aiProvider,
    }));
  }
  if (searchMode === 'map') {
    return MAP_PROVIDERS.map((p, i) => ({
      key: String(i),
      label: p.label,
      icon: p.icon,
      active: i === getSettings().mapProvider,
    }));
  }
  if (searchMode === 'gh' || searchMode === 'zh' || searchMode === 'xhs') {
    return [];
  }
  return SEARCH_ENGINE_ORDER.map((engine) => ({
    key: engine,
    label: getSearchEngineLabel(engine),
    active: engine === getSettings().searchEngine,
  }));
}

function renderMapDetailMenu() {
  const header = document.createElement('div');
  header.className = 'search-engine-menu-header';
  header.textContent = '地图搜索';
  menuEl.appendChild(header);
}

function renderProviderMenu() {
  if (!menuEl) return;

  const { searchMode } = getSettings();
  const ariaLabel = searchMode === 'ai'
    ? 'AI 助手'
    : searchMode === 'map'
      ? '地图搜索'
      : searchMode === 'gh'
        ? 'GitHub 搜索'
        : searchMode === 'zh'
          ? '知乎搜索'
          : searchMode === 'xhs'
            ? '小红书搜索'
            : '搜索引擎';
  menuEl.setAttribute('aria-label', ariaLabel);
  menuEl.innerHTML = '';
  menuEl.classList.toggle('search-engine-menu--map-detail', searchMode === 'map');

  if (searchMode === 'map') {
    renderMapDetailMenu();
  }

  const items = getMenuItems();
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'search-engine-menu-item';
    btn.dataset.key = item.key;
    btn.classList.toggle('active', item.active);
    if (item.icon) {
      btn.innerHTML = `<img class="search-engine-menu-item-icon" src="${item.icon}" alt="" width="16" height="16"><span>${item.label}</span> <span class="search-engine-kbd">Alt+${i + 1}</span>`;
    } else {
      btn.innerHTML = `${item.label} <span class="search-engine-kbd">Alt+${i + 1}</span>`;
    }
    menuEl.appendChild(btn);
  }
}

function hideEngineMenu() {
  if (!menuEl || !badgeEl) return;
  const wasOpen = engineMenuOpen;
  engineMenuOpen = false;
  menuEl.hidden = true;
  badgeEl.setAttribute('aria-expanded', 'false');
  if (wasOpen) restoreSuggestionsIfNeeded();
}

function showEngineMenu() {
  if (!menuEl || !badgeEl) return;
  engineMenuOpen = true;
  suggestionGen += 1;
  hideSuggestionsPanel();
  searchQuote.hideImmediate();
  renderProviderMenu();
  menuEl.hidden = false;
  badgeEl.setAttribute('aria-expanded', 'true');
}

function getModePlaceholder() {
  const { searchMode } = getSettings();
  const focused = boxEl?.classList.contains('focused');
  const hasValue = Boolean(inputEl?.value.trim());

  if (searchMode === 'ai') {
    if (focused && !hasValue) return '输入问题';
    return 'AI搜索 — 输入问题';
  }
  if (searchMode === 'map') {
    if (focused && !hasValue) return '输入地点';
    return '地图搜索 — 输入地点';
  }
  if (searchMode === 'gh') {
    if (focused && !hasValue) return '输入关键词';
    return 'GitHub 搜索';
  }
  if (searchMode === 'zh') {
    if (focused && !hasValue) return '输入关键词';
    return '知乎 搜索';
  }
  if (searchMode === 'xhs') {
    if (focused && !hasValue) return '输入关键词';
    return '小红书 搜索';
  }
  if (hasValue) {
    const pendingMode = resolveModeAlias(inputEl.value);
    if (pendingMode) return `按 Tab 进入${MODE_LABELS[pendingMode]}`;
  }
  return '搜索';
}

function updateModeLabel() {
  if (!inputEl) return;

  if (modeLabelEl) {
    modeLabelEl.hidden = true;
    modeLabelEl.setAttribute('aria-hidden', 'true');
  }
  if (boxEl) {
    boxEl.classList.remove('has-mode-label');
  }

  inputEl.placeholder = getModePlaceholder();
}

function refreshSearchQuote() {
  if (!boxEl?.classList.contains('focused') || inputEl?.value.trim()) return;
  searchQuote.show(getSettings().searchMode);
}

function applyModeUi() {
  const { searchMode } = getSettings();
  if (boxEl) {
    boxEl.dataset.searchMode = searchMode;
  }
  updateModeLabel();
  refreshSearchQuote();
}

function setBadgeAccessibility(label) {
  if (!badgeEl) return;
  badgeEl.setAttribute('aria-label', label);
  badgeEl.setAttribute('title', label);
}

function buildBadgeIconFallback(iconUrl) {
  try {
    const hostname = new URL(iconUrl).hostname.replace(/^www\./i, '');
    const pageUrl = `https://${hostname}/`;
    return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(pageUrl)}&size=32`;
  } catch {
    return '';
  }
}

function setBadgeContent({ icon, label, useIcon, showLabelWithIcon = false }) {
  if (!badgeEl) return;

  badgeIconGen += 1;
  const gen = badgeIconGen;

  if (useIcon && icon) {
    badgeEl.classList.add('has-icon');
    badgeEl.classList.toggle('has-icon-label', showLabelWithIcon);
    if (badgeLabelEl) badgeLabelEl.textContent = showLabelWithIcon ? label : '';
    if (badgeIconEl) {
      badgeIconEl.onerror = null;
      badgeIconEl.onload = null;
      badgeIconEl.alt = label;
      badgeIconEl.hidden = false;
      badgeIconEl.dataset.fallbackTried = '';
      badgeIconEl.onerror = () => {
        if (gen !== badgeIconGen) return;
        if (!badgeIconEl.dataset.fallbackTried) {
          const fallback = buildBadgeIconFallback(icon);
          if (fallback && badgeIconEl.src !== fallback) {
            badgeIconEl.dataset.fallbackTried = '1';
            badgeIconEl.src = fallback;
            return;
          }
        }
        // 图标不可用时回退为文字标签，避免左侧空白
        badgeEl.classList.remove('has-icon', 'has-icon-label');
        badgeIconEl.hidden = true;
        badgeIconEl.removeAttribute('src');
        if (badgeLabelEl) badgeLabelEl.textContent = label;
      };
      badgeIconEl.src = icon;
    }
    return;
  }

  badgeEl.classList.remove('has-icon', 'has-icon-label');
  if (badgeIconEl) {
    badgeIconEl.onerror = null;
    badgeIconEl.onload = null;
    badgeIconEl.hidden = true;
    badgeIconEl.removeAttribute('src');
    badgeIconEl.dataset.fallbackTried = '';
  }
  if (badgeLabelEl) badgeLabelEl.textContent = label;
}

function renderBadge() {
  const { searchMode, searchEngine, aiProvider, mapProvider } = getSettings();

  if (searchMode === 'ai') {
    const provider = getAiProvider(aiProvider);
    setBadgeContent({
      icon: provider.icon,
      label: provider.name,
      useIcon: true,
    });
    setBadgeAccessibility(provider.name);
    return;
  }
  if (searchMode === 'map') {
    const provider = getMapProvider(mapProvider);
    setBadgeContent({
      icon: provider.icon,
      label: provider.name,
      useIcon: true,
    });
    setBadgeAccessibility(provider.name);
    return;
  }
  if (searchMode === 'gh') {
    setBadgeContent({
      icon: GITHUB_ICON,
      label: 'GitHub',
      useIcon: true,
    });
    setBadgeAccessibility('GitHub');
    return;
  }
  if (searchMode === 'zh') {
    setBadgeContent({
      icon: ZHIHU_ICON,
      label: '知乎',
      useIcon: true,
    });
    setBadgeAccessibility('知乎');
    return;
  }
  if (searchMode === 'xhs') {
    setBadgeContent({
      icon: XHS_ICON,
      label: '小红书',
      useIcon: true,
    });
    setBadgeAccessibility('小红书');
    return;
  }

  const engineLabel = getSearchEngineLabel(searchEngine);
  setBadgeContent({
    icon: getSearchEngineIcon(searchEngine),
    label: engineLabel,
    useIcon: true,
  });
  setBadgeAccessibility(`选择搜索引擎：${engineLabel}`);
}

export function updateSearchEngineBadge() {
  applyModeUi();
  renderProviderMenu();
  renderBadge();
}

let suggestionGen = 0;
let suggestionItems = [];
let activeSuggestionIndex = -1;

function getSuggestionHandlers() {
  return {
    onSmartAction: handleSmartAction,
    onNavigate: (url) => { window.location.href = url; },
    onSearch: executeSearch,
  };
}

function areSuggestionsVisible() {
  return Boolean(listEl && !listEl.hidden && suggestionItems.length > 0);
}

function setActiveSuggestionIndex(index) {
  activeSuggestionIndex = index;
  if (!listEl) return;
  const children = listEl.querySelectorAll('.search-suggestion');
  children.forEach((el, i) => {
    el.classList.toggle('is-active', i === index);
  });
  if (index >= 0 && children[index]) {
    children[index].scrollIntoView({ block: 'nearest' });
  }
}

function resetActiveSuggestion() {
  setActiveSuggestionIndex(-1);
}

async function submitSearchFromInput({ altKey = false } = {}) {
  const query = inputEl?.value.trim();
  if (!query) return;

  if (altKey) {
    const translateItem = suggestionItems.find((i) => i.id === 'translate');
    if (translateItem) {
      hideSuggestions();
      await activateSuggestionItem(translateItem, getSuggestionHandlers());
      return;
    }
  }

  if (areSuggestionsVisible() && activeSuggestionIndex >= 0) {
    const item = suggestionItems[activeSuggestionIndex];
    if (item) {
      hideSuggestions();
      await activateSuggestionItem(item, getSuggestionHandlers());
      return;
    }
  }

  hideSuggestions();
  executeSearch(query);
}

let completionTimer = null;
let completionController = null;
const COMPLETION_DEBOUNCE_MS = 250;

function cancelPendingCompletions() {
  clearTimeout(completionTimer);
  completionTimer = null;
  completionController?.abort();
  completionController = null;
}

export async function refreshSearchSuggestions() {
  cancelPendingCompletions();
  if (!inputEl || document.activeElement !== inputEl) return;
  if (engineMenuOpen) return;
  const query = inputEl.value.trim();
  if (!query) {
    suggestionGen += 1;
    hideSuggestions();
    return;
  }
  suggestionGen += 1;
  const gen = suggestionGen;

  const { searchMode, searchEngine } = getSettings();
  let items = buildSyncSuggestions(query);

  const needsCurrency = searchMode === 'normal' && parseCurrencyInput(query);
  if (needsCurrency) {
    const currencyItem = await buildCurrencySuggestion(query);
    if (gen !== suggestionGen) return;
    if (currencyItem) items.push(currencyItem);
  }

  const blocksCompletions = items.some((i) => BLOCKS_COMPLETIONS.has(i.id));
  if (gen !== suggestionGen) return;
  renderSuggestions(items);

  if (searchMode !== 'normal' || blocksCompletions
    || (searchEngine !== 'google' && searchEngine !== 'bing')) return;

  completionTimer = setTimeout(async () => {
    completionTimer = null;
    if (gen !== suggestionGen || document.activeElement !== inputEl) return;
    const controller = new AbortController();
    completionController = controller;
    const completions = await fetchQueryCompletions(query, searchEngine, {
      signal: controller.signal,
    });
    if (completionController === controller) completionController = null;
    if (controller.signal.aborted || gen !== suggestionGen || document.activeElement !== inputEl) return;
    const completionItems = completions
      .filter((text) => !items.some((i) => i.text === text))
      .map((text) => ({ id: 'completion', type: '', text }));
    items = [...items, ...completionItems];
    renderSuggestions(items);
  }, COMPLETION_DEBOUNCE_MS);
}

function getProviderShortcutCount(searchMode) {
  if (searchMode === 'ai') return AI_PROVIDERS.length;
  if (searchMode === 'map') return MAP_PROVIDERS.length;
  if (searchMode === 'gh' || searchMode === 'zh' || searchMode === 'xhs') return 0;
  return SEARCH_ENGINE_ORDER.length;
}

/** 用 e.code 识别 Alt/Option+数字，避免 macOS 上 e.key 变成特殊字符 */
function getAltDigitIndex(e) {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return -1;

  const { code, key } = e;
  if (code.startsWith('Digit')) {
    const digit = Number(code.slice(5));
    return digit >= 1 && digit <= 9 ? digit - 1 : -1;
  }
  if (code.startsWith('Numpad')) {
    const digit = Number(code.slice(6));
    return digit >= 1 && digit <= 9 ? digit - 1 : -1;
  }
  if (key.length === 1 && key >= '1' && key <= '9') {
    return Number(key) - 1;
  }
  return -1;
}

function tryAltDigitProviderShortcut(e) {
  if (!inputEl || !menuEl) return false;
  if (!document.querySelector('.page-panel.page-home.active')) return false;
  if (document.querySelector('dialog[open]:not(#shortcuts-dialog)')) return false;

  const idx = getAltDigitIndex(e);
  if (idx < 0) return false;

  const maxItems = getProviderShortcutCount(getSettings().searchMode);
  if (maxItems === 0 || idx >= maxItems) return false;

  e.preventDefault();
  e.stopPropagation();
  selectProviderByIndex(idx);
  if (document.activeElement !== inputEl) {
    try {
      inputEl.focus({ preventScroll: true });
    } catch {
      inputEl.focus();
    }
  }
  return true;
}

function selectProviderByIndex(index) {
  const { searchMode } = getSettings();

  if (searchMode === 'ai') {
    onSettingsChange({ aiProvider: index });
  } else if (searchMode === 'map') {
    onSettingsChange({ mapProvider: index });
  } else {
    const engine = SEARCH_ENGINE_ORDER[index];
    if (engine) onSettingsChange({ searchEngine: engine });
  }
  hideEngineMenu();
}

function selectProviderByKey(key) {
  const { searchMode } = getSettings();

  if (searchMode === 'ai' || searchMode === 'map') {
    const index = Number(key);
    if (Number.isNaN(index)) return;
    selectProviderByIndex(index);
    return;
  }

  if (!SEARCH_ENGINE_ORDER.includes(key)) return;
  if (key === getSettings().searchEngine) {
    hideEngineMenu();
    return;
  }
  onSettingsChange({ searchEngine: key });
  hideEngineMenu();
}

function setSearchMode(mode) {
  if (mode === getSettings().searchMode) return;
  onSettingsChange({ searchMode: mode });
}

function resolveModeAlias(raw) {
  return TAB_TRIGGER_ALIAS_TO_MODE.get(normalizeModeInput(raw)) || null;
}

function tryModeCommandFromInput() {
  const value = normalizeModeInput(inputEl.value);
  const mode = resolveModeAlias(inputEl.value);
  if (mode) {
    inputEl.value = '';
    hideSuggestions();
    setSearchMode(mode);
    refreshSearchQuote();
    return true;
  }
  if (value === 'normal' || value === 'exit') {
    inputEl.value = '';
    hideSuggestions();
    if (getSettings().searchMode !== 'normal') {
      setSearchMode('normal');
      return true;
    }
  }
  return false;
}

export function handleSearchEscape() {
  if (areSuggestionsVisible()) {
    if (activeSuggestionIndex >= 0) {
      resetActiveSuggestion();
      return true;
    }
    hideSuggestions();
    return true;
  }
  if (getSettings().searchMode !== 'normal') {
    setSearchMode('normal');
    return true;
  }
  return false;
}

export function initSearch({ getSettings: settingsGetter, onSettingsChange: settingsChangeHandler }) {
  getSettings = settingsGetter;
  onSettingsChange = (partial) => {
    settingsChangeHandler(partial);
    updateSearchEngineBadge();
    refreshSearchSuggestions();
  };

  const form = document.getElementById('search-form');
  boxEl = document.getElementById('search-box');
  inputEl = document.getElementById('search-input');
  listEl = document.getElementById('search-suggestions');
  badgeEl = document.getElementById('search-engine-badge');
  modeLabelEl = document.getElementById('search-mode-label');
  menuEl = document.getElementById('search-engine-menu');

  if (!form || !boxEl || !inputEl || !listEl || !badgeEl || !menuEl) {
    console.error('[GavinHub] search UI elements missing');
    return;
  }

  badgeIconEl = badgeEl.querySelector('.search-badge-icon');
  badgeLabelEl = badgeEl.querySelector('.search-badge-label');
  if (!badgeIconEl || !badgeLabelEl) {
    badgeEl.innerHTML = '<img class="search-badge-icon" alt="" hidden><span class="search-badge-label"></span>';
    badgeIconEl = badgeEl.querySelector('.search-badge-icon');
    badgeLabelEl = badgeEl.querySelector('.search-badge-label');
  }

  searchQuote = initLazySearchQuote(document.getElementById('search-quote'));

  listEl.addEventListener('mouseleave', () => {
    if (areSuggestionsVisible()) resetActiveSuggestion();
  });

  updateSearchEngineBadge();

  const shouldDeferFocusChrome = () =>
    document.body.classList.contains('boot-awakening')
    && !document.body.classList.contains('boot-glass-stable');

  const applySearchFocusLayout = () => {
    boxEl.classList.add('focused');
    renderBadge();
    updateModeLabel();
  };

  const applySearchFocusAmbience = () => {
    document.body.classList.add('search-focused');
    refreshSearchSuggestions();
    if (!inputEl.value.trim()) searchQuote.show(getSettings().searchMode);
  };

  const applySearchFocusChrome = () => {
    applySearchFocusLayout();
    applySearchFocusAmbience();
  };

  inputEl.addEventListener('focus', () => {
    applySearchFocusLayout();
    if (shouldDeferFocusChrome()) return;
    applySearchFocusAmbience();
  });

  new MutationObserver(() => {
    if (shouldDeferFocusChrome()) return;
    if (document.activeElement === inputEl && !boxEl.classList.contains('focused')) {
      applySearchFocusChrome();
    }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  document.addEventListener('boot-glass-stable', () => {
    if (document.activeElement !== inputEl) return;
    requestAnimationFrame(() => {
      applySearchFocusChrome();
    });
  }, { once: true });

  inputEl.addEventListener('blur', () => {
    document.body.classList.remove('search-focused');
    boxEl.classList.remove('focused');
    updateModeLabel();
    searchQuote.hide();
    setTimeout(() => {
      hideSuggestions();
      if (!engineMenuOpen) hideEngineMenu();
    }, 120);
  });

  inputEl.addEventListener('compositionstart', () => {
    composingInput = true;
    compositionGuardUntil = 0;
  });
  inputEl.addEventListener('compositionend', () => {
    composingInput = false;
    compositionGuardUntil = Date.now() + 80;
  });

  inputEl.addEventListener('input', () => {
    updateModeLabel();
    if (inputEl.value.trim()) {
      searchQuote.hide();
    } else if (boxEl.classList.contains('focused')) {
      searchQuote.show(getSettings().searchMode);
    }
    refreshSearchSuggestions();
  });

  inputEl.addEventListener('keydown', (e) => {
    if (isImeComposing(e)) return;

    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (tryModeCommandFromInput()) {
        e.preventDefault();
        updateModeLabel();
        return;
      }
      if (getSettings().searchMode !== 'normal' && !inputEl.value.trim()) {
        e.preventDefault();
        setSearchMode('normal');
        updateModeLabel();
        return;
      }
      return;
    }

    if (e.key === 'Backspace' && getSettings().searchMode !== 'normal' && !inputEl.value) {
      e.preventDefault();
      setSearchMode('normal');
      return;
    }

    if (areSuggestionsVisible()) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const count = suggestionItems.length;
        setActiveSuggestionIndex(activeSuggestionIndex < count - 1 ? activeSuggestionIndex + 1 : 0);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const count = suggestionItems.length;
        setActiveSuggestionIndex(activeSuggestionIndex <= 0 ? count - 1 : activeSuggestionIndex - 1);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void submitSearchFromInput({ altKey: e.altKey });
        return;
      }
    }

    if (e.key === 'Escape') {
      if (handleSearchEscape()) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    if (tryAltDigitProviderShortcut(e)) return;
  });

  document.addEventListener('keydown', (e) => {
    tryAltDigitProviderShortcut(e);
  }, true);

  badgeEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const { searchMode } = getSettings();
    if (searchMode === 'gh' || searchMode === 'zh' || searchMode === 'xhs') return;
    if (menuEl.hidden) {
      showEngineMenu();
    } else {
      hideEngineMenu();
    }
  });

  menuEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const item = e.target.closest('.search-engine-menu-item');
    if (!item) return;
    selectProviderByKey(item.dataset.key);
  });

  document.addEventListener('mousedown', (e) => {
    if (menuEl.hidden) return;
    if (e.target.closest('#search-engine-badge, #search-engine-menu')) return;
    hideEngineMenu();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (composingInput) return;
    const query = inputEl.value.trim();
    if (!query) return;
    if (tryModeCommandFromInput()) {
      updateModeLabel();
      return;
    }
    void submitSearchFromInput();
  });

}
