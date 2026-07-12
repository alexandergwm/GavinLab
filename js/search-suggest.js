/** 搜索引擎联想补全（fetch / CORS 代理；扩展页禁止 JSONP script 注入） */
import { fetchWithTimeout, fetchCorsText } from './util.js';

const COMPLETION_TIMEOUT = 4000;
const COMPLETION_LIMIT = 8;

function normalizeCompletionList(list, query) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= COMPLETION_LIMIT) break;
  }
  if (!seen.has(query) && out.length < COMPLETION_LIMIT) {
    out.unshift(query);
  }
  return out.slice(0, COMPLETION_LIMIT);
}

function parseBingCompletionPayload(data) {
  return Array.isArray(data?.[1]) ? data[1] : [];
}

function parseGoogleSuggestText(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      return parseBingCompletionPayload(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  const match = trimmed.match(/^[^(]+\(([\s\S]*)\);?\s*$/);
  if (!match) return [];
  try {
    return parseBingCompletionPayload(JSON.parse(match[1]));
  } catch {
    return [];
  }
}

async function fetchBingCompletions(query, signal) {
  const url = `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(query)}`;
  try {
    const res = await fetchWithTimeout(url, COMPLETION_TIMEOUT, { signal });
    if (res.ok) {
      const data = await res.json();
      return normalizeCompletionList(parseBingCompletionPayload(data), query);
    }
  } catch {
    /* CORS — fall through to proxy */
  }
  try {
    const text = await fetchCorsText(url, {
      preset: 'arxiv',
      ms: COMPLETION_TIMEOUT,
      signal,
      skipDirect: true,
      validate: (body) => body.trim().startsWith('['),
    });
    return normalizeCompletionList(parseBingCompletionPayload(JSON.parse(text)), query);
  } catch {
    return [];
  }
}

async function fetchGoogleCompletions(query, signal) {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`;
  try {
    const res = await fetchWithTimeout(url, COMPLETION_TIMEOUT, { signal });
    if (res.ok) {
      const list = parseGoogleSuggestText(await res.text());
      if (list.length) return normalizeCompletionList(list, query);
    }
  } catch {
    /* CORS — fall through to proxy */
  }
  try {
    const text = await fetchCorsText(url, {
      preset: 'arxiv',
      ms: COMPLETION_TIMEOUT,
      signal,
      skipDirect: true,
      validate: (body) => body.includes('['),
    });
    const list = parseGoogleSuggestText(text);
    if (list.length) return normalizeCompletionList(list, query);
  } catch {
    /* ignore */
  }
  return [];
}

/** @param {'google'|'bing'} engine */
export async function fetchQueryCompletions(query, engine, { signal } = {}) {
  if (engine === 'google') {
    return fetchGoogleCompletions(query, signal);
  }
  if (engine === 'bing') {
    return fetchBingCompletions(query, signal);
  }
  return [];
}
