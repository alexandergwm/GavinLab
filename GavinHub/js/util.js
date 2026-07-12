/** 跨模块共享工具，零依赖 */

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatRelativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

export function fetchWithTimeout(url, ms = 15000, init = {}) {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abortFromExternal);
  });
}

const CORS_PRESETS = {
  feed(targetUrl) {
    const enc = encodeURIComponent(targetUrl);
    return [
      `https://proxy.cors.sh/${targetUrl}`,
      `https://api.cors.lol/?url=${enc}`,
      `https://api.allorigins.win/raw?url=${enc}`,
      `https://api.allorigins.win/get?url=${enc}`,
      `https://api.codetabs.com/v1/proxy?quest=${enc}`,
    ];
  },
  wallpaper(targetUrl) {
    const enc = encodeURIComponent(targetUrl);
    return [
      `https://api.cors.lol/?url=${enc}`,
      `https://api.allorigins.win/get?url=${enc}`,
      `https://api.allorigins.win/raw?url=${enc}`,
      `https://proxy.cors.sh/${targetUrl}`,
    ];
  },
  photo(targetUrl) {
    const enc = encodeURIComponent(targetUrl);
    // 照片列表 JSON 可能需要代理；图片直链本身通常 CORS * 可直接 <img>
    return [
      targetUrl,
      `https://api.allorigins.win/raw?url=${enc}`,
      `https://api.allorigins.win/get?url=${enc}`,
      `https://api.cors.lol/?url=${enc}`,
    ];
  },
  arxiv(targetUrl) {
    const enc = encodeURIComponent(targetUrl);
    return [
      targetUrl,
      `https://proxy.cors.sh/${targetUrl}`,
      `https://api.allorigins.win/raw?url=${enc}`,
      `https://api.allorigins.win/get?url=${enc}`,
      `https://api.cors.lol/?url=${enc}`,
    ];
  },
  favicon(targetUrl) {
    const enc = encodeURIComponent(targetUrl);
    return [
      `https://api.allorigins.win/raw?url=${enc}`,
      `https://api.allorigins.win/get?url=${enc}`,
    ];
  },
};

/** @param {'feed'|'wallpaper'|'arxiv'|'favicon'|'photo'} preset */
export function corsProxyUrls(targetUrl, preset = 'feed') {
  const builder = CORS_PRESETS[preset] || CORS_PRESETS.feed;
  return builder(targetUrl);
}

/** 从 allorigins 等 JSON 包装或纯文本响应中提取正文 */
export function extractProxiedBody(text, isJson) {
  const trimmed = (text || '').trim();
  if (!trimmed) return '';
  if (isJson) {
    try {
      const contents = JSON.parse(trimmed).contents?.trim();
      return contents || '';
    } catch {
      return '';
    }
  }
  return trimmed;
}

/**
 * 按 preset 顺序尝试 CORS 代理，返回首个可用文本。
 * @param {string} targetUrl
 * @param {{ preset?: string, ms?: number, validate?: (text: string) => boolean, errorMessage?: string }} [opts]
 */
export async function fetchCorsText(targetUrl, {
  preset = 'arxiv',
  ms = 15000,
  signal,
  skipDirect = false,
  validate,
  errorMessage = 'CORS 请求失败',
} = {}) {
  let lastError = new Error(errorMessage);
  const candidates = corsProxyUrls(targetUrl, preset)
    .filter((url) => !skipDirect || url !== targetUrl);
  for (const fetchUrl of candidates) {
    try {
      const res = await fetchWithTimeout(fetchUrl, ms, { signal });
      if (!res.ok) continue;

      const ct = (res.headers.get('content-type') || '').toLowerCase();
      const isJson = ct.includes('json') || fetchUrl.includes('/get?');
      const raw = await res.text();
      const text = extractProxiedBody(raw, isJson);
      if (!text) continue;
      if (validate && !validate(text)) continue;
      return text;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError;
}
