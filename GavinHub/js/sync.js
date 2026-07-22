/**
 * Edge / Chrome 账号同步（chrome.storage.sync）
 * 同步：部分设置、快捷方式、Dock、待办、长期目标、重要日期
 * 单条约 8KB 限制 → 自动分片；过大时提示改用文件/GitHub
 */
import { KEYS } from './keys.js';
import { ensureGoalsFromLegacyCountdowns } from './goals.js';

const SYNC_VERSION = 1;
const SYNC_ROOT_KEY = 'gavinhubSync';
const SYNC_CHUNK_PREFIX = 'gavinhubSync_c';
const SYNC_LOCAL_AT_KEY = KEYS.syncLocalAt;
/** 单条约 8192；按 JSON.stringify(value)+key 计，CJK 最坏按 \uXXXX 预留 */
const SYNC_CHUNK_SAFE_CHARS = 1200;
const SYNC_TOTAL_SAFE_CHARS = 90000;

const SYNC_DATA_KEYS = [
  KEYS.shortcuts,
  KEYS.dock,
  KEYS.todos,
  KEYS.goals,
  KEYS.importantDates,
];

/** 旧版仍可能带上来，仅用于迁移，不再写出 */
const LEGACY_SYNC_KEYS = [KEYS.countdowns];

/** 与壁纸/本机相关的设置不同步；搜索模式/引擎为标签页内状态，也不同步 */
const SYNC_SETTINGS_FIELDS = [
  'baseCurrency',
  'showGreeting',
];

let lastSyncError = '';

function hasChromeSync() {
  return typeof chrome !== 'undefined' && chrome.storage?.sync;
}

function readLocalJson(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeLocalJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function extractSyncSettings(allSettings = {}) {
  const out = {};
  for (const field of SYNC_SETTINGS_FIELDS) {
    if (field in allSettings) out[field] = allSettings[field];
  }
  return out;
}

function buildSyncPayload() {
  const settingsRaw = readLocalJson(KEYS.settings) || {};
  const payload = {
    v: SYNC_VERSION,
    updatedAt: getLocalSyncAt() || Date.now(),
    settings: extractSyncSettings(settingsRaw),
  };
  for (const key of SYNC_DATA_KEYS) {
    payload[key] = readLocalJson(key);
  }
  return payload;
}

function getLocalSyncAt() {
  const n = Number(localStorage.getItem(SYNC_LOCAL_AT_KEY));
  return Number.isFinite(n) ? n : 0;
}

function setLocalSyncAt(ts) {
  localStorage.setItem(SYNC_LOCAL_AT_KEY, String(ts));
}

let applyingRemote = false;
let pushTimer = null;

function storageSet(obj) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(obj, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, (result) => {
      void chrome.runtime.lastError;
      resolve(result || {});
    });
  });
}

function storageRemove(keys) {
  return new Promise((resolve) => {
    chrome.storage.sync.remove(keys, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function splitIntoSyncChunks(str) {
  const chunks = [];
  let start = 0;
  while (start < str.length) {
    let end = Math.min(start + SYNC_CHUNK_SAFE_CHARS, str.length);
    while (
      end > start
      && JSON.stringify(str.slice(start, end)).length + SYNC_CHUNK_PREFIX.length + 8 > 7800
    ) {
      end = start + Math.max(1, Math.floor((end - start) * 0.75));
    }
    if (end <= start) end = start + 1;
    chunks.push(str.slice(start, end));
    start = end;
  }
  return chunks;
}

async function clearOldChunks(keepCount = 0) {
  const probeKeys = [];
  for (let i = keepCount; i < keepCount + 96; i += 1) {
    probeKeys.push(`${SYNC_CHUNK_PREFIX}${i}`);
  }
  const existing = await storageGet(probeKeys);
  const toRemove = Object.keys(existing);
  if (toRemove.length) await storageRemove(toRemove);
}

async function storageSetSyncChunked(payload) {
  const json = JSON.stringify(payload);
  if (json.length > SYNC_TOTAL_SAFE_CHARS) {
    const err = new Error('payload-too-large');
    err.code = 'too-large';
    throw err;
  }

  const chunks = splitIntoSyncChunks(json);
  const toSet = {};
  chunks.forEach((chunk, i) => {
    toSet[`${SYNC_CHUNK_PREFIX}${i}`] = chunk;
  });
  await storageSet(toSet);
  await clearOldChunks(chunks.length);

  const meta = {
    v: SYNC_VERSION,
    updatedAt: payload.updatedAt,
    format: 'chunked',
    chunks: chunks.length,
  };
  await storageSet({ [SYNC_ROOT_KEY]: meta });
}

async function storageGetSync() {
  const root = await storageGet([SYNC_ROOT_KEY]);
  const meta = root?.[SYNC_ROOT_KEY];
  if (!meta) return null;

  if (meta.format === 'chunked' && meta.chunks > 0) {
    const keys = Array.from({ length: meta.chunks }, (_, i) => `${SYNC_CHUNK_PREFIX}${i}`);
    const parts = await storageGet(keys);
    let json = '';
    for (let i = 0; i < meta.chunks; i += 1) {
      const piece = parts[`${SYNC_CHUNK_PREFIX}${i}`];
      if (typeof piece !== 'string') return null;
      json += piece;
    }
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  /* 旧版：整包存在单个 key */
  if (meta.v === SYNC_VERSION && meta.format !== 'chunked') {
    return meta;
  }

  return null;
}

function isEmptyPayload(payload) {
  if (!payload || payload.v !== SYNC_VERSION) return true;
  const hasSettings = payload.settings && Object.keys(payload.settings).length > 0;
  const hasData = SYNC_DATA_KEYS.some((key) => {
    const val = payload[key];
    if (val == null) return false;
    if (Array.isArray(val)) return val.length > 0;
    if (typeof val === 'object') return Object.keys(val).length > 0;
    return true;
  });
  return !hasSettings && !hasData;
}

function applyRemotePayload(payload) {
  if (!payload || payload.v !== SYNC_VERSION) return false;

  applyingRemote = true;
  try {
    if (payload.settings && typeof payload.settings === 'object') {
      const current = readLocalJson(KEYS.settings) || {};
      writeLocalJson(KEYS.settings, { ...current, ...payload.settings });
    }
    for (const key of SYNC_DATA_KEYS) {
      if (payload[key] != null) writeLocalJson(key, payload[key]);
    }
    for (const key of LEGACY_SYNC_KEYS) {
      if (payload[key] != null) writeLocalJson(key, payload[key]);
    }
    ensureGoalsFromLegacyCountdowns(payload[KEYS.countdowns] ?? readLocalJson(KEYS.countdowns));
    setLocalSyncAt(payload.updatedAt || Date.now());
    return true;
  } finally {
    applyingRemote = false;
  }
}

function localHasUserData() {
  const settings = extractSyncSettings(readLocalJson(KEYS.settings) || {});
  if (Object.keys(settings).length > 0) {
    const defaults = {
      baseCurrency: '',
      showGreeting: true,
    };
    for (const [k, v] of Object.entries(settings)) {
      if (defaults[k] !== v) return true;
    }
  }
  return SYNC_DATA_KEYS.some((key) => {
    const val = readLocalJson(key);
    return Array.isArray(val) && val.length > 0;
  });
}

export async function pullSyncOnStartup() {
  if (!hasChromeSync()) return { applied: false, reason: 'unavailable' };

  try {
    const remote = await storageGetSync();
    let localAt = getLocalSyncAt();

    /* 旧版已有本地数据但没有修改时间：优先保住本地数据，避免首次升级被旧云端覆盖。 */
    if (!localAt && localHasUserData()) {
      localAt = Date.now();
      setLocalSyncAt(localAt);
    }

    if (!remote || isEmptyPayload(remote)) {
      if (localHasUserData()) {
        await pushToSync({ force: true });
        return { applied: false, reason: 'uploaded-local' };
      }
      return { applied: false, reason: 'empty' };
    }

    if (remote.updatedAt > localAt) {
      const applied = applyRemotePayload(remote);
      return { applied, reason: applied ? 'downloaded' : 'skipped' };
    }

    if (localAt > remote.updatedAt && localHasUserData()) {
      await pushToSync({ force: true });
      return { applied: false, reason: 'uploaded-local' };
    }

    return { applied: false, reason: 'up-to-date' };
  } catch (err) {
    lastSyncError = err?.message || String(err);
    console.warn('[GavinHub] sync pull failed', err);
    return { applied: false, reason: 'error' };
  }
}

async function pushToSync({ force = false } = {}) {
  if (!hasChromeSync() || applyingRemote) return false;

  try {
    const payload = buildSyncPayload();
    if (!force && !localHasUserData() && isEmptyPayload(payload)) return false;

    await storageSetSyncChunked(payload);
    setLocalSyncAt(payload.updatedAt);
    lastSyncError = '';
    return true;
  } catch (err) {
    lastSyncError = err?.code === 'too-large'
      ? '数据过大，Edge 账号同步失败，请改用「文件」或「GitHub」同步'
      : (err?.message || 'Edge 同步失败');
    console.warn('[GavinHub] sync push failed', err);
    return false;
  }
}

export function scheduleSyncPush() {
  if (applyingRemote || !hasChromeSync()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    void pushToSync();
  }, 900);
}

/** @type {(() => void) | null} */
let onRemoteApplied = null;

export function initSyncListener(onApplied) {
  onRemoteApplied = onApplied;
  if (!hasChromeSync()) return;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes[SYNC_ROOT_KEY]) return;
    void (async () => {
      try {
        const remote = await storageGetSync();
        if (!remote || remote.updatedAt <= getLocalSyncAt()) return;
        if (applyRemotePayload(remote)) onRemoteApplied?.();
      } catch (err) {
        console.warn('[GavinHub] sync apply failed', err);
      }
    })();
  });
}

export function isSyncKey(key) {
  return key === KEYS.settings || SYNC_DATA_KEYS.includes(key);
}

export async function getSyncStatusText() {
  const manualHint = '无法登录 Edge 时，请切换到「文件」或「GitHub」同步';
  if (!hasChromeSync()) return manualHint;
  if (lastSyncError) return `${lastSyncError}。${manualHint}`;
  try {
    const remote = await storageGetSync();
    if (!remote?.updatedAt) {
      return `Edge 账号同步已就绪（需登录浏览器账号才会跨设备；大数据自动分片）。${manualHint}`;
    }
    const d = new Date(remote.updatedAt);
    const time = d.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric' });
    return `Edge 账号同步 · 上次 ${time}。${manualHint}`;
  } catch {
    return `Edge 账号同步暂不可用。${manualHint}`;
  }
}

/** 导出可同步数据（JSON 对象） */
export function exportSyncBundle() {
  return buildSyncPayload();
}

export function exportSyncBundleJson() {
  return JSON.stringify(exportSyncBundle(), null, 2);
}

function parseImportPayload(raw) {
  const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!payload || payload.v !== SYNC_VERSION) {
    throw new Error('invalid-version');
  }
  return payload;
}

/** 从 JSON 文件/字符串导入；成功后刷新页面以应用全部模块 */
export function importSyncBundle(raw) {
  const payload = parseImportPayload(raw);
  const applied = applyRemotePayload(payload);
  if (!applied) throw new Error('apply-failed');
  void pushToSync({ force: true });
  return true;
}

export function downloadSyncBundleFile() {
  const json = exportSyncBundleJson();
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gavinhub-sync-${new Date().toISOString().slice(0, 10)}.json`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function getSyncLocalTimestamp() {
  return getLocalSyncAt();
}
