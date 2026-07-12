/** 搜索联想 / 智能建议列表 DOM 渲染 */
import { escapeHtml } from './util.js';

const BLOCKING_SMART_IDS = ['url', 'doi', 'weather', 'calc', 'base', 'datasize'];
export const SMART_ACTION_IDS = new Set(['translate', 'currency', ...BLOCKING_SMART_IDS]);

const TRANSLATE_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2v3"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`;

const NAVIGATE_IDS = new Set(['translate', 'currency', 'url', 'doi', 'weather']);

export function formatActionLabel(item) {
  if (item.id === 'translate') return `翻译: ${item.text}`;
  if (item.id === 'currency') return item.text;
  if (item.id === 'calc' || item.id === 'base' || item.id === 'datasize') return item.text;
  return `${item.type} ${item.text}`.trim();
}

/** @param {{ onSmartAction: (item: object) => Promise<void>, onNavigate: (url: string) => void, onSearch: (text: string) => void }} handlers */
export async function activateSuggestionItem(item, { onSmartAction, onNavigate, onSearch }) {
  if (item.action === 'copy') {
    await onSmartAction(item);
    return;
  }
  if (item.url && NAVIGATE_IDS.has(item.id)) {
    onNavigate(item.url);
    return;
  }
  onSearch(item.text);
}

/**
 * @param {object} item
 * @param {{ onSmartAction: (item: object) => Promise<void>, onNavigate: (url: string) => void, onSearch: (text: string) => void }} handlers
 */
export function createSuggestionNode(item, { onSmartAction, onNavigate, onSearch }) {
  const li = document.createElement('li');
  li.className = 'search-suggestion';
  if (item.id === 'currency') li.classList.add('search-suggestion--currency');
  if (item.id === 'calc') li.classList.add('search-suggestion--calc');
  if (item.id === 'base' || item.id === 'datasize') li.classList.add('search-suggestion--calc');

  if (item.id === 'completion') {
    li.classList.add('search-suggestion--completion');
    li.innerHTML = `<span class="search-suggestion-text">${escapeHtml(item.text)}</span>`;
  } else if (SMART_ACTION_IDS.has(item.id)) {
    li.classList.add('search-suggestion--action');
    const icon = item.id === 'translate' ? TRANSLATE_ICON : '';
    const kbdHint = item.id === 'translate'
      ? '<span class="search-suggestion-kbd"><kbd>Alt</kbd><kbd>↵</kbd></span>'
      : '<span class="search-suggestion-kbd"><kbd>↵</kbd> Enter</span>';
    li.innerHTML = `
      <span class="search-suggestion-leading">
        ${icon}
        <span class="search-suggestion-text">${escapeHtml(formatActionLabel(item))}</span>
      </span>
      ${kbdHint}
    `;
  } else {
    li.innerHTML = `
      <span class="search-suggestion-type">${escapeHtml(item.type)}</span>
      <span class="search-suggestion-text">${escapeHtml(item.text)}</span>
    `;
  }

  li.addEventListener('mousedown', async (e) => {
    e.preventDefault();
    await activateSuggestionItem(item, { onSmartAction, onNavigate, onSearch });
  });
  return li;
}
