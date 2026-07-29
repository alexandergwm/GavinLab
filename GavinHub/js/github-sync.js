/**
 * 通过 GitHub Gist 同步配置（无需 Edge 账号登录）
 * Token 需 gist 权限：https://github.com/settings/tokens
 */
import { KEYS } from './keys.js';
import { loadGithubToken, saveGithubToken } from './credential-store.js';
import {
  exportSyncBundle,
  hasNewerSyncData,
  importSyncBundle,
  mergeSyncBundles,
  runSyncTransaction,
} from './sync.js';

const GIST_FILENAME = 'gavinhub-sync.json';
const GIST_DESCRIPTION = 'GavinHub StartPage sync';
const GITHUB_API = 'https://api.github.com';
const PENDING_BASELINE = 'pending:';

export async function loadGithubSyncConfig() {
  return {
    token: await loadGithubToken(),
    gistId: localStorage.getItem(KEYS.githubGistId) || '',
  };
}

export async function saveGithubSyncConfig({ token, gistId } = {}) {
  if (token != null) {
    await saveGithubToken(token);
  }
  if (gistId != null) {
    const trimmed = gistId.trim();
    if (trimmed) localStorage.setItem(KEYS.githubGistId, trimmed);
    else localStorage.removeItem(KEYS.githubGistId);
  }
}

function readConfigFromForm(config) {
  const token = config.token?.trim();
  if (!token) throw new Error('no-token');
  if (!/^(ghp_|github_pat_|gho_|ghu_|ghs_)/.test(token)) {
    throw new Error('bad-token-format');
  }
  return { token, gistId: config.gistId?.trim() || '' };
}

function getGithubBaseline() {
  try {
    return localStorage.getItem(KEYS.githubGistBaseline) || '';
  } catch {
    return '';
  }
}

function setGithubBaseline(gistId) {
  try {
    if (gistId) localStorage.setItem(KEYS.githubGistBaseline, gistId);
    else localStorage.removeItem(KEYS.githubGistBaseline);
  } catch { /* ignore restricted storage */ }
}

export async function saveGithubConnection(config) {
  const previous = await loadGithubSyncConfig();
  const normalized = readConfigFromForm(config || previous);
  const previousBaseline = getGithubBaseline();
  const sameConnection = previous.gistId === normalized.gistId;
  let nextBaseline = previousBaseline;

  if (!previousBaseline && previous.token && previous.gistId && sameConnection) {
    // Preserve upgrade compatibility for devices linked before baseline tracking existed.
    nextBaseline = previous.gistId;
  } else if (!sameConnection || !previous.token) {
    // A new connection must complete pull-first bootstrap before it may write.
    nextBaseline = `${PENDING_BASELINE}${normalized.gistId || 'auto'}`;
  }

  await saveGithubSyncConfig(normalized);
  setGithubBaseline(nextBaseline);
  return normalized;
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

async function pullFromGithub(config) {
  const { token, gistId } = readConfigFromForm(config);
  if (!gistId) throw new Error('no-gist');
  const gist = await githubRequest(`/gists/${gistId}`, { token });
  return extractPayloadFromGist(gist);
}

async function findGithubSyncGists(token) {
  const gists = await githubRequest('/gists?per_page=100', { token });
  if (!Array.isArray(gists)) return [];
  return gists
    .filter((gist) => gist?.id && gist.files?.[GIST_FILENAME])
    .map((gist) => ({
      id: gist.id,
      description: gist.description || '',
      updatedAt: gist.updated_at || '',
    }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function resolveGithubGist(token, requestedGistId) {
  if (requestedGistId) return { gistId: requestedGistId, discovered: false };
  const matches = await findGithubSyncGists(token);
  if (!matches.length) return { gistId: '', discovered: false };
  if (matches.length > 1) {
    const error = new Error('multiple-gists');
    error.candidates = matches;
    throw error;
  }
  return { gistId: matches[0].id, discovered: true };
}

async function pushPayloadToGithub(config, payload) {
  const { token, gistId: existingId } = readConfigFromForm(config);
  const content = JSON.stringify(payload, null, 2);

  if (existingId) {
    await githubRequest(`/gists/${existingId}`, {
      token,
      method: 'PATCH',
      body: { files: { [GIST_FILENAME]: { content } } },
    });
    return { gistId: existingId, updatedAt: payload.updatedAt };
  }

  const gist = await githubRequest('/gists', {
    token,
    method: 'POST',
    body: {
      description: GIST_DESCRIPTION,
      public: false,
      files: { [GIST_FILENAME]: { content } },
    },
  });

  return { gistId: gist.id, updatedAt: payload.updatedAt };
}

/** 按数据集版本合并，避免一端改待办时覆盖另一端刚改的快捷方式。 */
async function syncWithGithubTask(config) {
  const savedConfig = await loadGithubSyncConfig();
  const requested = readConfigFromForm(config || savedConfig);
  const resolved = await resolveGithubGist(requested.token, requested.gistId);
  const { token } = requested;
  const { gistId, discovered } = resolved;

  if (!gistId) {
    const result = await pushPayloadToGithub(
      { token, gistId: '' },
      exportSyncBundle(),
    );
    await saveGithubSyncConfig({ token, gistId: result.gistId });
    setGithubBaseline(result.gistId);
    return { action: 'uploaded-new', gistId: result.gistId, reloaded: false };
  }

  const remote = await pullFromGithub({ token, gistId });
  const baseline = getGithubBaseline();
  const isLegacyEstablishedDevice = !baseline
    && Boolean(savedConfig.token)
    && savedConfig.gistId === gistId;

  /*
   * A new install can generate fresh revisions while normalizing defaults.
   * On the first link to an existing Gist, remote must be authoritative or
   * those defaults can overwrite the user's established data.
   */
  if (baseline !== gistId && !isLegacyEstablishedDevice) {
    importSyncBundle(remote);
    await saveGithubSyncConfig({ token, gistId });
    setGithubBaseline(gistId);
    return {
      action: 'downloaded',
      gistId,
      discovered,
      reloaded: true,
    };
  }

  const local = exportSyncBundle();
  const remoteNewer = hasNewerSyncData(remote, local);
  const localNewer = hasNewerSyncData(local, remote);
  const merged = mergeSyncBundles(local, remote);

  if (remoteNewer) importSyncBundle(merged);
  if (localNewer) {
    await pushPayloadToGithub({ token, gistId }, merged);
  }
  await saveGithubSyncConfig({ token, gistId });
  setGithubBaseline(gistId);
  if (remoteNewer && localNewer) return { action: 'merged', reloaded: true };
  if (remoteNewer) return { action: 'downloaded', reloaded: true };
  if (localNewer) return { action: 'uploaded', reloaded: false };
  return { action: 'up-to-date', reloaded: false };
}

export function syncWithGithub(config) {
  return runSyncTransaction(() => syncWithGithubTask(config));
}

export function formatGithubSyncResult(result) {
  switch (result?.action) {
    case 'downloaded':
      return result.discovered
        ? '已找到云端备份并下载到本机；未上传本机数据'
        : '云端数据较新，已下载到本机';
    case 'uploaded':
      return '本机数据较新，已上传到云端';
    case 'uploaded-new':
      return '云端没有备份，已新建并上传本机数据';
    case 'merged':
      return '两端都有更新，已合并并写入本机与云端';
    case 'up-to-date':
      return '本机与云端一致，本次没有上传或下载';
    default:
      return '同步完成';
  }
}

export function formatGithubSyncError(err) {
  if (err?.message === 'no-token') return '请先填写 GitHub Token';
  if (err?.message === 'bad-token-format') {
    return 'Token 格式不对，请用 classic 的 ghp_…，或 fine-grained 的 github_pat_…';
  }
  if (err?.message === 'no-gist') return '请先填写 Gist ID，或直接同步以自动查找或创建';
  if (err?.message === 'gist-empty') return 'Gist 中找不到同步文件';
  if (err?.message === 'multiple-gists') {
    const ids = (err.candidates || []).slice(0, 3).map((item) => item.id).join('、');
    return `发现多个 GavinHub 备份，为防止覆盖已停止同步。请在 Gist ID 中填入要使用的一个：${ids}`;
  }
  if (err?.code === 'network' || /Failed to fetch|NetworkError/i.test(err?.message || '')) {
    return '无法连接 GitHub，请检查网络或代理后重试';
  }
  if (err?.status === 401) return 'Token 无效或已过期，请重新创建并勾选 gist 权限';
  if (err?.status === 403) {
    return 'Token 权限不足：classic 需勾选 gist；fine-grained 需允许 Gists 读写';
  }
  if (err?.status === 404) return 'Gist 不存在或 Token 无权访问，请核对 Gist ID；清空后可新建';
  if (err?.status === 422) return 'Gist 内容可能过大或格式无效，请精简待办后重试';
  return err?.message || 'GitHub 同步失败';
}
