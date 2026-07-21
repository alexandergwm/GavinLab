/**
 * 通过 GitHub Gist 同步配置（无需 Edge 账号登录）
 * Token 需 gist 权限：https://github.com/settings/tokens
 */
import { KEYS } from './keys.js';
import {
  exportSyncBundle,
  exportSyncBundleJson,
  importSyncBundle,
  getSyncLocalTimestamp,
} from './sync.js';

const GIST_FILENAME = 'gavinhub-sync.json';
const GITHUB_API = 'https://api.github.com';

export function loadGithubSyncConfig() {
  return {
    token: localStorage.getItem(KEYS.githubToken) || '',
    gistId: localStorage.getItem(KEYS.githubGistId) || '',
  };
}

export function saveGithubSyncConfig({ token, gistId } = {}) {
  if (token != null) {
    const trimmed = token.trim();
    if (trimmed) localStorage.setItem(KEYS.githubToken, trimmed);
    else localStorage.removeItem(KEYS.githubToken);
  }
  if (gistId != null) {
    const trimmed = gistId.trim();
    if (trimmed) localStorage.setItem(KEYS.githubGistId, trimmed);
    else localStorage.removeItem(KEYS.githubGistId);
  }
}

function readConfigFromForm(config = loadGithubSyncConfig()) {
  const token = config.token?.trim();
  if (!token) throw new Error('no-token');
  if (!/^(ghp_|github_pat_|gho_|ghu_|ghs_)/.test(token)) {
    throw new Error('bad-token-format');
  }
  return { token, gistId: config.gistId?.trim() || '' };
}

async function githubRequest(path, { token, method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${GITHUB_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const networkErr = new Error(err?.message || 'network-error');
    networkErr.code = 'network';
    throw networkErr;
  }

  if (!res.ok) {
    let message = `GitHub API ${res.status}`;
    try {
      const json = await res.json();
      if (json?.message) message = json.message;
    } catch { /* ignore */ }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  if (res.status === 204) return null;
  return res.json();
}

function extractPayloadFromGist(gist) {
  const file = gist?.files?.[GIST_FILENAME];
  const content = file?.content;
  if (!content) throw new Error('gist-empty');
  return JSON.parse(content);
}

async function pullFromGithub(config = loadGithubSyncConfig()) {
  const { token, gistId } = readConfigFromForm(config);
  if (!gistId) throw new Error('no-gist');
  const gist = await githubRequest(`/gists/${gistId}`, { token });
  return extractPayloadFromGist(gist);
}

async function pushToGithub(config = loadGithubSyncConfig()) {
  const { token, gistId: existingId } = readConfigFromForm(config);
  const content = exportSyncBundleJson();

  if (existingId) {
    await githubRequest(`/gists/${existingId}`, {
      token,
      method: 'PATCH',
      body: { files: { [GIST_FILENAME]: { content } } },
    });
    return { gistId: existingId, updatedAt: exportSyncBundle().updatedAt };
  }

  const gist = await githubRequest('/gists', {
    token,
    method: 'POST',
    body: {
      description: 'GavinHub StartPage sync',
      public: false,
      files: { [GIST_FILENAME]: { content } },
    },
  });

  saveGithubSyncConfig({ gistId: gist.id });
  return { gistId: gist.id, updatedAt: exportSyncBundle().updatedAt };
}

/** 比较时间戳：较新者胜出 */
export async function syncWithGithub(config = loadGithubSyncConfig()) {
  saveGithubSyncConfig(config);
  const { token, gistId } = readConfigFromForm(loadGithubSyncConfig());

  if (!gistId) {
    const result = await pushToGithub({ token, gistId: '' });
    return { action: 'uploaded', gistId: result.gistId, reloaded: false };
  }

  let remote;
  try {
    remote = await pullFromGithub({ token, gistId });
  } catch (err) {
    if (err.status === 404) {
      saveGithubSyncConfig({ gistId: '' });
      const result = await pushToGithub({ token, gistId: '' });
      return { action: 'uploaded-new', gistId: result.gistId, reloaded: false };
    }
    throw err;
  }

  const localAt = getSyncLocalTimestamp();
  const remoteAt = remote.updatedAt || 0;

  if (remoteAt > localAt) {
    importSyncBundle(remote);
    return { action: 'downloaded', reloaded: true };
  }
  if (localAt > remoteAt) {
    await pushToGithub({ token, gistId });
    return { action: 'uploaded', reloaded: false };
  }
  return { action: 'up-to-date', reloaded: false };
}

export function formatGithubSyncResult(result) {
  switch (result?.action) {
    case 'downloaded':
      return '已从 GitHub 拉取最新配置';
    case 'uploaded':
      return '已上传到 GitHub';
    case 'uploaded-new':
      return `已创建新 Gist：${result.gistId || ''}`;
    case 'up-to-date':
      return '本地与 GitHub 已是最新';
    default:
      return '同步完成';
  }
}

export function formatGithubSyncError(err) {
  if (err?.message === 'no-token') return '请先填写 GitHub Token';
  if (err?.message === 'bad-token-format') {
    return 'Token 格式不对，请用 classic 的 ghp_…，或 fine-grained 的 github_pat_…';
  }
  if (err?.message === 'no-gist') return '请先填写 Gist ID，或点「保存并同步」自动创建';
  if (err?.message === 'gist-empty') return 'Gist 中找不到同步文件';
  if (err?.code === 'network' || /Failed to fetch|NetworkError/i.test(err?.message || '')) {
    return '无法连接 GitHub，请检查网络或代理后重试';
  }
  if (err?.status === 401) return 'Token 无效或已过期，请重新创建并勾选 gist 权限';
  if (err?.status === 403) {
    return 'Token 权限不足：classic 需勾选 gist；fine-grained 需允许 Gists 读写';
  }
  if (err?.status === 404) return 'Gist 不存在或 Token 无权访问，将尝试新建';
  if (err?.status === 422) return 'Gist 内容可能过大或格式无效，请精简待办后重试';
  return err?.message || 'GitHub 同步失败';
}
