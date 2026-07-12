import { escapeHtml, fetchCorsText } from './util.js';

import { KEYS } from './keys.js';

const KEYWORDS_KEY = KEYS.arxivKeywords;
const DEFAULT_KEYWORDS = 'SELD sound event localization detection';
const MAX_RESULTS = 10;
const ARXIV_API = 'https://export.arxiv.org/api/query';

let loading = false;

export function getArxivKeywords() {
  return localStorage.getItem(KEYWORDS_KEY) || DEFAULT_KEYWORDS;
}

export function saveArxivKeywords(keywords) {
  localStorage.setItem(KEYWORDS_KEY, keywords.trim());
}

function buildSearchQuery(keywords) {
  const tokens = keywords.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 'all:SELD';
  return tokens.map((t) => `all:${t}`).join('+OR+');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', year: 'numeric' });
}

function shortenAuthors(authors) {
  if (!authors.length) return '';
  if (authors.length <= 2) return authors.join(', ');
  return `${authors[0]} 等 ${authors.length} 人`;
}

const ATOM_NS = 'http://www.w3.org/2005/Atom';

function atomText(entry, tag) {
  return (entry.getElementsByTagNameNS(ATOM_NS, tag)[0]?.textContent || '').replace(/\s+/g, ' ').trim();
}

function parseArxivXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) return [];

  const entries = [...doc.getElementsByTagNameNS(ATOM_NS, 'entry')];
  if (!entries.length) return [];

  return entries.map((entry) => {
    const title = atomText(entry, 'title');
    const id = atomText(entry, 'id');
    let link = id;
    const links = entry.getElementsByTagNameNS(ATOM_NS, 'link');
    for (const el of links) {
      const rel = el.getAttribute('rel');
      const href = el.getAttribute('href');
      if (href && (rel === 'alternate' || !rel)) {
        link = href;
        if (rel === 'alternate') break;
      }
    }
    const abstract = atomText(entry, 'summary');
    const published = atomText(entry, 'published');
    const authors = [...entry.getElementsByTagNameNS(ATOM_NS, 'author')]
      .map((author) => (author.getElementsByTagNameNS(ATOM_NS, 'name')[0]?.textContent || '').trim())
      .filter(Boolean);

    return { title, link, abstract, published, authors };
  }).filter((p) => p.title && p.link);
}

async function fetchArxivPapers(keywords) {
  const query = buildSearchQuery(keywords);
  const url = `${ARXIV_API}?search_query=${query}&sortBy=submittedDate&sortOrder=descending&max_results=${MAX_RESULTS}`;
  const xml = await fetchCorsText(url, {
    preset: 'arxiv',
    validate: (text) => text.startsWith('<'),
    errorMessage: 'arXiv 请求失败：网络或代理不可用',
  });
  const papers = parseArxivXml(xml);
  if (!papers.length) throw new Error('arXiv 解析失败');
  return papers;
}

function renderArxivItem(paper) {
  return `
    <article class="arxiv-item">
      <h4 class="arxiv-item-title">
        <a href="${escapeHtml(paper.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(paper.title)}</a>
      </h4>
      ${paper.authors.length ? `<p class="arxiv-item-authors">${escapeHtml(shortenAuthors(paper.authors))}</p>` : ''}
      <p class="arxiv-item-abstract">${escapeHtml(paper.abstract || '暂无摘要')}</p>
      ${paper.published ? `<time class="arxiv-item-date" datetime="${escapeHtml(paper.published)}">${formatDate(paper.published)}</time>` : ''}
    </article>
  `;
}

function renderLoading() {
  return Array.from({ length: 5 }, () => `
    <div class="arxiv-item arxiv-item--skeleton" aria-hidden="true">
      <div class="skeleton-line skeleton-line--title"></div>
      <div class="skeleton-line skeleton-line--short"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line"></div>
    </div>
  `).join('');
}

export async function loadArxiv(force = false) {
  const list = document.getElementById('arxiv-list');
  const statusEl = document.getElementById('arxiv-status');
  if (!list) return;

  if (loading && !force) return;

  loading = true;
  list.innerHTML = renderLoading();
  if (statusEl) statusEl.textContent = '加载中…';

  const keywords = getArxivKeywords();

  try {
    const papers = await fetchArxivPapers(keywords);
    if (!papers.length) {
      list.innerHTML = '<p class="feed-empty">未找到相关论文</p>';
      if (statusEl) statusEl.textContent = '无结果';
      return;
    }

    list.innerHTML = papers.map(renderArxivItem).join('');
    if (statusEl) {
      statusEl.textContent = `${papers.length} 篇 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '加载失败，请稍后重试';
    list.innerHTML = `<p class="feed-empty">${escapeHtml(msg)}</p>`;
    if (statusEl) statusEl.textContent = '加载失败';
  } finally {
    loading = false;
  }
}

export function initArxiv() {
  const input = document.getElementById('arxiv-keywords-input');
  const form = document.getElementById('arxiv-keywords-form');
  const refreshBtn = document.getElementById('arxiv-refresh');

  if (input) input.value = getArxivKeywords();

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveArxivKeywords(input?.value || DEFAULT_KEYWORDS);
    loadArxiv(true);
  });

  refreshBtn?.addEventListener('click', () => loadArxiv(true));
}
