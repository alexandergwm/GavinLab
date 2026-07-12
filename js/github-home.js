import { escapeHtml, fetchWithTimeout, formatRelativeTime } from './util.js';

const MAX_ITEMS = 12;

let loading = false;

function getGithubUsername() {
  return '';
}

function parseEvent(event) {
  const repoName = event.repo?.name;
  if (!repoName) return null;

  const repoUrl = `https://github.com/${repoName}`;
  const base = { name: repoName, url: repoUrl, time: event.created_at, stars: '' };
  const payload = event.payload || {};

  switch (event.type) {
    case 'PushEvent': {
      const count = payload.commits?.length || 0;
      return { ...base, desc: count ? `推送 ${count} 个提交` : '推送代码' };
    }
    case 'WatchEvent':
      return { ...base, desc: 'Star 了此仓库' };
    case 'ForkEvent':
      return { ...base, desc: 'Fork 了此仓库' };
    case 'CreateEvent': {
      const refType = payload.ref_type;
      if (refType === 'repository') return { ...base, desc: '创建了新仓库' };
      const ref = payload.ref ? ` ${payload.ref}` : '';
      return { ...base, desc: `创建了 ${refType || '资源'}${ref}`.trim() };
    }
    case 'IssuesEvent':
      return {
        ...base,
        desc: `${payload.action || '更新'} issue`,
        url: payload.issue?.html_url || repoUrl,
      };
    case 'PullRequestEvent':
      return {
        ...base,
        desc: `PR ${payload.action || '更新'}`,
        url: payload.pull_request?.html_url || repoUrl,
      };
    case 'ReleaseEvent':
      return {
        ...base,
        desc: `发布 ${payload.release?.tag_name || '新版本'}`,
        url: payload.release?.html_url || repoUrl,
      };
    case 'PublicEvent':
      return { ...base, desc: '公开了仓库' };
    default:
      return null;
  }
}

async function fetchGithubJson(path) {
  const res = await fetchWithTimeout(`https://api.github.com${path}`, 15000, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error('用户不存在');
    if (res.status === 403) throw new Error('API 限流，请稍后再试');
    throw new Error('GitHub API 请求失败');
  }
  return res.json();
}

async function fetchUserHome(username) {
  const [events, starred] = await Promise.all([
    fetchGithubJson(`/users/${encodeURIComponent(username)}/events?per_page=30`),
    fetchGithubJson(`/users/${encodeURIComponent(username)}/starred?per_page=10&sort=updated`).catch(() => []),
  ]);

  const items = [];
  const seen = new Set();

  for (const event of events) {
    const item = parseEvent(event);
    if (!item) continue;
    const key = `${item.url}::${item.desc}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= MAX_ITEMS) break;
  }

  if (items.length < MAX_ITEMS && Array.isArray(starred)) {
    for (const repo of starred) {
      if (items.length >= MAX_ITEMS) break;
      const url = repo.html_url;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      items.push({
        name: repo.full_name,
        url,
        desc: (repo.description || '已 Star 的仓库').trim(),
        stars: repo.stargazers_count ? `★ ${repo.stargazers_count.toLocaleString()}` : '',
        time: null,
      });
    }
  }

  return items;
}

function renderProfileItem(username) {
  const profileUrl = `https://github.com/${encodeURIComponent(username)}`;
  return `
    <a class="github-item github-item--profile" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer">
      <h4 class="github-item-name">@${escapeHtml(username)}</h4>
      <p class="github-item-desc">打开 GitHub 主页</p>
    </a>
  `;
}

function renderGithubItem(item) {
  const starsHtml = item.stars
    ? `<span class="github-item-stars">${escapeHtml(item.stars)}</span>`
    : '';
  const timeHtml = item.time
    ? `<span class="github-item-stars">${formatRelativeTime(item.time)}</span>`
    : '';

  return `
    <a class="github-item" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
      <h4 class="github-item-name">${escapeHtml(item.name)}</h4>
      ${item.desc ? `<p class="github-item-desc">${escapeHtml(item.desc)}</p>` : ''}
      ${starsHtml || timeHtml}
    </a>
  `;
}

function renderLoading() {
  return Array.from({ length: 6 }, () => `
    <div class="github-item github-item--skeleton" aria-hidden="true">
      <div class="skeleton-line skeleton-line--title"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line skeleton-line--short"></div>
    </div>
  `).join('');
}

function renderEmptyPrompt() {
  return '<p class="feed-empty">GitHub 动态功能暂不可用</p>';
}

function updateHeaderLink(username) {
  const link = document.getElementById('github-home-link');
  if (!link) return;
  link.href = username
    ? `https://github.com/${encodeURIComponent(username)}`
    : 'https://github.com';
}

export async function loadGithubHome(force = false) {
  const list = document.getElementById('github-home-list');
  const statusEl = document.getElementById('github-status');
  if (!list) return;

  const username = getGithubUsername();
  updateHeaderLink(username);

  if (!username) {
    list.innerHTML = renderEmptyPrompt();
    if (statusEl) statusEl.textContent = '未配置';
    return;
  }

  if (loading && !force) return;

  loading = true;
  list.innerHTML = renderLoading();
  if (statusEl) statusEl.textContent = `@${username} · 加载中…`;

  try {
    const items = await fetchUserHome(username);
    const body = renderProfileItem(username) + (items.length
      ? items.map(renderGithubItem).join('')
      : '<p class="feed-empty">暂无公开动态</p>');
    list.innerHTML = body;
    if (statusEl) {
      statusEl.textContent = `@${username} · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '加载失败，请稍后重试';
    list.innerHTML = `${renderProfileItem(username)}<p class="feed-empty">${escapeHtml(msg)}</p>`;
    if (statusEl) statusEl.textContent = `@${username} · 加载失败`;
  } finally {
    loading = false;
  }
}
