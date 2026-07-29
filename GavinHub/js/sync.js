/**
 * Edge / Chrome account sync with per-dataset revisions. Payloads remain
 * chunked for chrome.storage.sync quotas and v1 bundles are migrated on read.
 */
import { KEYS } from './keys.js';
import { ensureGoalsFromLegacyCountdowns } from './goals.js';
import { createAsyncQueue } from './lifecycle.js';

const SYNC_VERSION = 2;
const LEGACY_SYNC_VERSION = 1;
const SYNC_ROOT_KEY = 'gavinhubSync';
const SYNC_CHUNK_PREFIX = 'gavinhubSync_c';
const SYNC_LOCAL_AT_KEY = KEYS.syncLocalAt;
const SYNC_REVISIONS_KEY = KEYS.syncRevisions;
const SYNC_CHUNK_SAFE_CHARS = 1200;
const SYNC_TOTAL_SAFE_BYTES = 42000;
const SYNC_MAX_CHUNKS = 96;
const SYNC_WRITER_ID = typeof globalThis.crypto?.randomUUID === 'function'
  ? globalThis.crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const SYNC_DATA_KEYS = [
  KEYS.shortcuts,
  KEYS.dock,
  KEYS.todos,
  KEYS.goals,
  KEYS.importantDates,
];
const SYNC_KEYS = [KEYS.settings, ...SYNC_DATA_KEYS];
const LEGACY_SYNC_KEYS = [KEYS.countdowns];
const SYNC_SETTINGS_FIELDS = ['baseCurrency', 'showGreeting'];

let lastSyncError = '';
let applyingRemote = false;
let pushTimer = null;
let stopPeriodicSync = null;
const runSyncExclusive = createAsyncQueue();
let syncWriteSequence = 0;

function normalizeRevision(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : 0;
}

function hasChromeSync() {
  return typeof chrome !== 'undefined' && chrome.storage?.sync;
}

function readLocalJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeLocalJson(key, value) {
  if (value == null) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify(value));
}

function extractSyncSettings(allSettings = {}) {
  const out = {};
  for (const field of SYNC_SETTINGS_FIELDS) {
    if (field in allSettings) out[field] = allSettings[field];
  }
  return out;
}

function getLocalSyncAt() {
  return normalizeRevision(localStorage.getItem(SYNC_LOCAL_AT_KEY));
}

function setLocalSyncAt(timestamp) {
  localStorage.setItem(SYNC_LOCAL_AT_KEY, String(timestamp));
}

function getLocalRevisions() {
  const raw = readLocalJson(SYNC_REVISIONS_KEY);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw)
    .map(([key, value]) => [key, normalizeRevision(value)]));
}

function setLocalRevisions(revisions) {
  writeLocalJson(SYNC_REVISIONS_KEY, revisions);
}

function payloadField(key) {
  return key === KEYS.settings ? 'settings' : key;
}

function hasValue(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function buildSyncPayload() {
  const localAt = getLocalSyncAt() || Date.now();
  const storedRevisions = getLocalRevisions();
  const payload = {
    v: SYNC_VERSION,
    updatedAt: localAt,
    revisions: {},
    settings: extractSyncSettings(readLocalJson(KEYS.settings) || {}),
  };
  for (const key of SYNC_DATA_KEYS) payload[key] = readLocalJson(key);
  for (const key of SYNC_KEYS) {
    const field = payloadField(key);
    const fallback = hasValue(payload[field]) ? localAt : 0;
    payload.revisions[key] = normalizeRevision(storedRevisions[key]) || fallback;
  }
  payload.updatedAt = Math.max(localAt, ...Object.values(payload.revisions));
  return payload;
}

function normalizeSyncPayload(payload) {
  if (!payload || (payload.v !== SYNC_VERSION && payload.v !== LEGACY_SYNC_VERSION)) return null;
  const updatedAt = normalizeRevision(payload.updatedAt);
  const revisions = {};
  for (const key of SYNC_KEYS) {
    const field = payloadField(key);
    const hasExplicitRevision = payload.v === SYNC_VERSION
      && Object.prototype.hasOwnProperty.call(payload.revisions || {}, key);
    revisions[key] = hasExplicitRevision
      ? normalizeRevision(payload.revisions[key])
      : (field in payload ? updatedAt : 0);
  }
  return {
    ...payload,
    v: SYNC_VERSION,
    updatedAt: Math.max(updatedAt, ...Object.values(revisions)),
    revisions,
  };
}

export function mergeSyncBundles(localPayload, remotePayload) {
  const local = normalizeSyncPayload(localPayload) || buildSyncPayload();
  const remote = normalizeSyncPayload(remotePayload);
  if (!remote) return local;
  const merged = { v: SYNC_VERSION, updatedAt: 0, revisions: {} };
  for (const key of SYNC_KEYS) {
    const field = payloadField(key);
    const localRevision = normalizeRevision(local.revisions[key]);
    const remoteRevision = normalizeRevision(remote.revisions[key]);
    const useRemote = remoteRevision > localRevision
      || (!(field in local) && field in remote);
    merged[field] = useRemote ? remote[field] : local[field];
    merged.revisions[key] = Math.max(localRevision, remoteRevision);
  }
  merged.updatedAt = Math.max(
    normalizeRevision(local.updatedAt),
    normalizeRevision(remote.updatedAt),
    ...Object.values(merged.revisions),
  );
  return merged;
}

function hasNewerRevisions(candidate, baseline) {
  const next = normalizeSyncPayload(candidate);
  const current = normalizeSyncPayload(baseline);
  if (!next) return false;
  if (!current) return true;
  return SYNC_KEYS.some((key) => (next.revisions[key] || 0) > (current.revisions[key] || 0));
}

export function hasNewerSyncData(candidate, baseline) {
  return hasNewerRevisions(candidate, baseline);
}

function isEmptyPayload(payload) {
  const normalized = normalizeSyncPayload(payload);
  if (!normalized) return true;
  return !hasValue(normalized.settings)
    && !SYNC_DATA_KEYS.some((key) => hasValue(normalized[key]));
}

function applyRemotePayload(payload, { force = false } = {}) {
  const normalized = normalizeSyncPayload(payload);
  if (!normalized) return false;
  const localRevisions = getLocalRevisions();
  const nextRevisions = { ...localRevisions };
  let changed = false;

  applyingRemote = true;
  try {
    for (const key of SYNC_KEYS) {
      const field = payloadField(key);
      const remoteRevision = normalizeRevision(normalized.revisions[key]);
      const localRevision = normalizeRevision(localRevisions[key]);
      if (!force && remoteRevision <= localRevision) continue;

      if (key === KEYS.settings) {
        const current = readLocalJson(KEYS.settings) || {};
        writeLocalJson(KEYS.settings, { ...current, ...(normalized.settings || {}) });
      } else {
        writeLocalJson(key, normalized[field]);
      }
      nextRevisions[key] = remoteRevision;
      changed = true;
    }

    for (const key of LEGACY_SYNC_KEYS) {
      if (key in normalized) writeLocalJson(key, normalized[key]);
    }
    ensureGoalsFromLegacyCountdowns(normalized[KEYS.countdowns] ?? readLocalJson(KEYS.countdowns));
    setLocalRevisions(nextRevisions);
    setLocalSyncAt(Math.max(normalized.updatedAt || 0, ...Object.values(nextRevisions), Date.now()));
    return changed;
  } finally {
    applyingRemote = false;
  }
}

function localHasUserData() {
  const settings = extractSyncSettings(readLocalJson(KEYS.settings) || {});
  if (settings.baseCurrency || settings.showGreeting === false) return true;
  return SYNC_DATA_KEYS.some((key) => hasValue(readLocalJson(key)));
}

function storageSet(obj) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(obj, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(keys, (result) => {
      const error = chrome.runtime?.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result || {});
    });
  });
}

function storageRemove(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.remove(keys, () => {
      const error = chrome.runtime?.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function splitIntoSyncChunks(value) {
  const chunks = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(start + SYNC_CHUNK_SAFE_CHARS, value.length);
    while (
      end > start
      && JSON.stringify(value.slice(start, end)).length + SYNC_CHUNK_PREFIX.length + 8 > 7800
    ) {
      end = start + Math.max(1, Math.floor((end - start) * 0.75));
    }
    if (end <= start) end = start + 1;
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks;
}

function normalizeChunkCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count > 0 && count <= SYNC_MAX_CHUNKS ? count : 0;
}

function validChunkGeneration(value) {
  return typeof value === 'string' && /^[a-z0-9-]{1,96}$/i.test(value) ? value : '';
}

function chunkKey(generation, index) {
  return generation
    ? `${SYNC_CHUNK_PREFIX}${generation}_${index}`
    : `${SYNC_CHUNK_PREFIX}${index}`;
}

function chunkKeysForMeta(meta, { includeLegacyRemainder = false } = {}) {
  if (meta?.format !== 'chunked') return [];
  const generation = validChunkGeneration(meta.generation);
  const count = normalizeChunkCount(meta.chunks);
  if (generation && count) {
    return Array.from({ length: count }, (_, index) => chunkKey(generation, index));
  }
  if (!generation && count) {
    const legacyCount = includeLegacyRemainder ? SYNC_MAX_CHUNKS : count;
    return Array.from({ length: legacyCount }, (_, index) => chunkKey('', index));
  }
  return [];
}

async function storageSetSyncChunked(payload) {
  const json = JSON.stringify(payload);
  const payloadBytes = typeof TextEncoder === 'function'
    ? new TextEncoder().encode(json).byteLength
    : json.length * 2;
  if (payloadBytes > SYNC_TOTAL_SAFE_BYTES) {
    const error = new Error('payload-too-large');
    error.code = 'too-large';
    throw error;
  }
  const chunks = splitIntoSyncChunks(json);
  if (!chunks.length || chunks.length > SYNC_MAX_CHUNKS) {
    const error = new Error('payload-too-large');
    error.code = 'too-large';
    throw error;
  }
  const previousRoot = await storageGet([SYNC_ROOT_KEY]);
  const previousMeta = previousRoot?.[SYNC_ROOT_KEY];
  syncWriteSequence += 1;
  const generation = `${Date.now().toString(36)}-${syncWriteSequence.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const toSet = {};
  chunks.forEach((chunk, index) => {
    toSet[chunkKey(generation, index)] = chunk;
  });
  const newChunkKeys = Object.keys(toSet);
  try {
    await storageSet(toSet);
    await storageSet({
      [SYNC_ROOT_KEY]: {
        v: SYNC_VERSION,
        updatedAt: payload.updatedAt,
        format: 'chunked',
        chunks: chunks.length,
        generation,
        writerId: SYNC_WRITER_ID,
      },
    });
  } catch (error) {
    await storageRemove(newChunkKeys).catch(() => {});
    throw error;
  }

  const staleKeys = chunkKeysForMeta(previousMeta, { includeLegacyRemainder: true })
    .filter((key) => !newChunkKeys.includes(key));
  if (staleKeys.length) {
    await storageRemove(staleKeys).catch((error) => {
      console.warn('[GavinHub] stale sync chunk cleanup failed', error);
    });
  }
}

async function storageGetSync() {
  const root = await storageGet([SYNC_ROOT_KEY]);
  const meta = root?.[SYNC_ROOT_KEY];
  if (!meta) return null;
  if (meta.format === 'chunked') {
    const count = normalizeChunkCount(meta.chunks);
    const generation = validChunkGeneration(meta.generation);
    if (!count || (meta.generation && !generation)) return null;
    const keys = Array.from({ length: count }, (_, index) => chunkKey(generation, index));
    const parts = await storageGet(keys);
    let json = '';
    for (let index = 0; index < count; index += 1) {
      const piece = parts[chunkKey(generation, index)];
      if (typeof piece !== 'string') return null;
      json += piece;
    }
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  }
  return meta.v === SYNC_VERSION || meta.v === LEGACY_SYNC_VERSION ? meta : null;
}

async function commitPayloadToCloud(payload) {
  const version = payload.updatedAt;
  await storageSetSyncChunked(payload);
  setLocalSyncAt(Math.max(getLocalSyncAt(), version));
}

async function pullSyncOnStartupTask() {
  if (!hasChromeSync()) return { applied: false, reason: 'unavailable' };
  try {
    const remote = normalizeSyncPayload(await storageGetSync());
    const local = buildSyncPayload();

    if (!remote || isEmptyPayload(remote)) {
      if (localHasUserData()) {
        await commitPayloadToCloud(local);
        return { applied: false, reason: 'uploaded-local' };
      }
      return { applied: false, reason: 'empty' };
    }

    const remoteChanged = hasNewerRevisions(remote, local);
    const localChanged = hasNewerRevisions(local, remote);
    const merged = mergeSyncBundles(local, remote);
    const applied = remoteChanged ? applyRemotePayload(merged, { force: true }) : false;
    if (localChanged) await commitPayloadToCloud(merged);

    return {
      applied,
      reason: remoteChanged && localChanged
        ? 'merged'
        : remoteChanged ? 'downloaded' : localChanged ? 'uploaded-local' : 'up-to-date',
    };
  } catch (error) {
    lastSyncError = error?.message || String(error);
    console.warn('[GavinHub] sync pull failed', error);
    return { applied: false, reason: 'error' };
  }
}

export function pullSyncOnStartup() {
  return runSyncExclusive(pullSyncOnStartupTask);
}

/** Serializes Edge and third-party sync providers against the same local datasets. */
export function runSyncTransaction(task) {
  return runSyncExclusive(task);
}

async function pushToSyncTask({ force = false } = {}) {
  if (!hasChromeSync() || applyingRemote) return false;
  try {
    const local = buildSyncPayload();
    if (!force && !localHasUserData() && isEmptyPayload(local)) return false;
    const remote = normalizeSyncPayload(await storageGetSync());
    const merged = mergeSyncBundles(local, remote);
    if (remote && hasNewerRevisions(remote, local)) {
      applyRemotePayload(merged, { force: true });
    }
    await commitPayloadToCloud(merged);
    lastSyncError = '';
    return true;
  } catch (error) {
    lastSyncError = error?.code === 'too-large'
      ? '数据过大，Edge 账号同步失败，请改用「文件」或「GitHub」同步'
      : (error?.message || 'Edge 同步失败');
    console.warn('[GavinHub] sync push failed', error);
    return false;
  }
}

function pushToSync(options) {
  return runSyncExclusive(() => pushToSyncTask(options));
}

export function scheduleSyncPush() {
  if (applyingRemote || !hasChromeSync()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void pushToSync(), 900);
}

/** 可见标签页定时拉取；串行执行，隐藏时暂停并在重新可见且到期后补一次。 */
export function startPeriodicSync({
  intervalMs = 5 * 60 * 1000,
  runImmediately = false,
  onApplied,
  extraSync,
  syncTask = pullSyncOnStartup,
} = {}) {
  stopPeriodicSync?.();
  let stopped = false;
  let running = false;
  let timer = 0;
  let lastRunAt = Date.now();

  const schedule = (delay = intervalMs) => {
    window.clearTimeout(timer);
    if (!stopped && !document.hidden) timer = window.setTimeout(run, Math.max(20, delay));
  };

  const run = async () => {
    if (stopped) return;
    if (document.hidden || running) {
      schedule();
      return;
    }
    running = true;
    lastRunAt = Date.now();
    try {
      const result = await syncTask();
      if (result?.applied) onApplied?.(result);
      await extraSync?.();
    } catch (error) {
      console.warn('[GavinHub] periodic sync failed', error);
    } finally {
      running = false;
      schedule();
    }
  };

  const onVisibilityChange = () => {
    if (document.hidden) {
      window.clearTimeout(timer);
      return;
    }
    if (running) return;
    const elapsed = Date.now() - lastRunAt;
    if (elapsed >= intervalMs) void run();
    else schedule(intervalMs - elapsed);
  };

  document.addEventListener('visibilitychange', onVisibilityChange, { passive: true });
  if (runImmediately) void run();
  else schedule();

  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (stopPeriodicSync === stop) stopPeriodicSync = null;
  };
  stopPeriodicSync = stop;
  window.addEventListener('pagehide', stop, { once: true });
  return stop;
}

let onRemoteApplied = null;
let syncListenerBound = false;

function handleSyncStorageChange(changes, area) {
  if (area !== 'sync' || !changes[SYNC_ROOT_KEY]) return;
  if (changes[SYNC_ROOT_KEY].newValue?.writerId === SYNC_WRITER_ID) return;
  void runSyncExclusive(async () => {
    try {
      const remote = normalizeSyncPayload(await storageGetSync());
      const local = buildSyncPayload();
      if (!remote || !hasNewerRevisions(remote, local)) return;
      const localChanged = hasNewerRevisions(local, remote);
      const merged = mergeSyncBundles(local, remote);
      if (applyRemotePayload(merged, { force: true })) onRemoteApplied?.();
      if (localChanged) await commitPayloadToCloud(merged);
    } catch (error) {
      console.warn('[GavinHub] sync apply failed', error);
    }
  });
}

export function initSyncListener(onApplied) {
  onRemoteApplied = onApplied;
  if (!hasChromeSync() || syncListenerBound) return;
  syncListenerBound = true;
  chrome.storage.onChanged.addListener(handleSyncStorageChange);
}

export function isSyncKey(key) {
  return key === KEYS.settings || SYNC_DATA_KEYS.includes(key);
}

export async function getSyncStatusText() {
  const manualHint = '无法登录 Edge 时，请切换到「文件」或「GitHub」同步';
  if (!hasChromeSync()) return manualHint;
  if (lastSyncError) return `${lastSyncError}。${manualHint}`;
  try {
    const remote = normalizeSyncPayload(await storageGetSync());
    if (!remote?.updatedAt) {
      return `Edge 账号同步已就绪（需登录浏览器账号才会跨设备；大数据自动分片）。${manualHint}`;
    }
    const date = new Date(remote.updatedAt);
    const time = date.toLocaleString('zh-CN', {
      hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric',
    });
    return `Edge 账号同步 · 上次 ${time}。${manualHint}`;
  } catch {
    return `Edge 账号同步暂不可用。${manualHint}`;
  }
}

export function exportSyncBundle() {
  return buildSyncPayload();
}

export function exportSyncBundleJson() {
  return JSON.stringify(exportSyncBundle(), null, 2);
}

function parseImportPayload(raw) {
  const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const normalized = normalizeSyncPayload(payload);
  if (!normalized) throw new Error('invalid-version');
  return normalized;
}

export function importSyncBundle(raw) {
  const payload = parseImportPayload(raw);
  const applied = applyRemotePayload(payload, { force: true });
  if (!applied) throw new Error('apply-failed');
  void pushToSync({ force: true });
  return true;
}

export function downloadSyncBundleFile() {
  const json = exportSyncBundleJson();
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `gavinhub-sync-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function getSyncLocalTimestamp() {
  return getLocalSyncAt();
}
