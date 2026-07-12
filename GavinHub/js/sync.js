/**
 * Edge / Chrome 账号同步（chrome.storage.sync）
 * 仅同步：设置（不含壁纸）、快捷方式、Dock、待办、倒计时、重要日期
 */
import { KEYS } from './keys.js';

const SYNC_VERSION = 1;
const SYNC_ROOT_KEY = 'gavinhubSync';
const SYNC_LOCAL_AT_KEY = 'startpage-sync-local-at';

const SYNC_DATA_KEYS = [
  KEYS.shortcuts,
  KEYS.dock,
  KEYS.todos,
  KEYS.countdowns,
  KEYS.importantDates,
];

/** 与壁纸/本机相关的设置不同步；搜索模式/引擎为标签页内状态，也不同步 */
const SYNC_SETTINGS_FIELDS = [
  'baseCurrency',
  'showGreeting',
];

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
    updatedAt: Date.now(),
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

function storageSetSync(value) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set({ [SYNC_ROOT_KEY]: value }, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function storageGetSync() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(SYNC_ROOT_KEY, (result) => {
      void chrome.runtime.lastError;
      resolve(result?.[SYNC_ROOT_KEY] || null);
    });
  });
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
      searchEngine: 'google',
      searchMode: 'normal',
      aiProvider: 0,
      mapProvider: 0,
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
    const localAt = getLocalSyncAt();

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
    console.warn('[GavinHub] sync pull failed', err);
    return { applied: false, reason: 'error' };
  }
}

async function pushToSync({ force = false } = {}) {
  if (!hasChromeSync() || applyingRemote) return false;

  try {
    const payload = buildSyncPayload();
    const json = JSON.stringify(payload);
    if (json.length > 95000) {
      console.warn('[GavinHub] sync payload too large', json.length);
      return false;
    }

    if (!force && !localHasUserData() && isEmptyPayload(payload)) return false;

    await storageSetSync(payload);
    setLocalSyncAt(payload.updatedAt);
    return true;
  } catch (err) {
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
    const remote = changes[SYNC_ROOT_KEY].newValue;
    if (!remote || remote.updatedAt <= getLocalSyncAt()) return;
    if (applyRemotePayload(remote)) onRemoteApplied?.();
  });
}

export function isSyncKey(key) {
  return key === KEYS.settings || SYNC_DATA_KEYS.includes(key);
}

export async function getSyncStatusText() {
  const manualHint = '无法登录 Edge 时，请切换到「文件」或「GitHub」同步';
  if (!hasChromeSync()) return manualHint;
  try {
    const remote = await storageGetSync();
    if (!remote?.updatedAt) {
      return `Edge 账号同步已就绪（需登录浏览器账号才会跨设备）。${manualHint}`;
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
