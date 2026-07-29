import { KEYS } from './keys.js';
import {
  loadGithubSyncConfig,
  saveGithubConnection,
  saveGithubSyncConfig,
  syncWithGithub,
} from './github-sync.js';

const SETUP_VERSION = 1;
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const RETRY_INTERVAL_MS = 90 * 1000;
export const SYNC_STATE_EVENT = 'gavinhub:sync-state-change';

let autoSyncController = null;
let activeSync = null;

function readJson(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* restricted storage keeps the current session usable */ }
}

function emitSyncState(detail = {}) {
  document.dispatchEvent(new CustomEvent(SYNC_STATE_EVENT, { detail }));
}

function saveSetup(mode) {
  const setup = { version: SETUP_VERSION, mode, completedAt: Date.now() };
  writeJson(KEYS.githubSyncSetup, setup);
  emitSyncState({ source: 'setup', mode });
  return setup;
}

function saveStatus(patch) {
  const status = {
    ...(readJson(KEYS.githubSyncStatus) || {}),
    ...patch,
  };
  writeJson(KEYS.githubSyncStatus, status);
  emitSyncState({ source: 'status', status });
  return status;
}

export async function getSyncSetup() {
  const stored = readJson(KEYS.githubSyncSetup);
  if (stored?.version === SETUP_VERSION && ['github', 'local'].includes(stored.mode)) {
    return stored;
  }

  // Existing installations with a saved token are already connected and must
  // not be interrupted by the new first-run screen after an extension update.
  const config = await loadGithubSyncConfig();
  if (config.token) return saveSetup('github');
  return { version: SETUP_VERSION, mode: 'unset', completedAt: 0 };
}

export async function getSyncOverview() {
  const [setup, config] = await Promise.all([
    getSyncSetup(),
    loadGithubSyncConfig(),
  ]);
  return {
    mode: setup.mode,
    connected: setup.mode === 'github' && Boolean(config.token),
    gistId: config.gistId || '',
    status: readJson(KEYS.githubSyncStatus) || null,
  };
}

export function chooseLocalOnly() {
  saveSetup('local');
  saveStatus({ action: 'local', at: Date.now(), error: '' });
}

export async function configureGithubSync(config) {
  const previousConfig = await loadGithubSyncConfig();
  const previousBaseline = localStorage.getItem(KEYS.githubGistBaseline);
  const saved = await saveGithubConnection(config);
  try {
    const result = await syncWithGithub(saved);
    saveSetup('github');
    saveStatus({ action: result.action, at: Date.now(), error: '' });
    return result;
  } catch (error) {
    await saveGithubSyncConfig(previousConfig);
    if (previousBaseline == null) localStorage.removeItem(KEYS.githubGistBaseline);
    else localStorage.setItem(KEYS.githubGistBaseline, previousBaseline);
    saveStatus({ action: 'error', at: Date.now(), error: error?.message || 'sync-failed' });
    throw error;
  }
}

export async function runConfiguredGithubSync() {
  if (activeSync) return activeSync;
  activeSync = (async () => {
    const setup = await getSyncSetup();
    if (setup.mode !== 'github') return { action: 'disabled', reloaded: false };

    const config = await loadGithubSyncConfig();
    if (!config.token) {
      saveStatus({ action: 'error', at: Date.now(), error: 'no-token' });
      return { action: 'disconnected', reloaded: false };
    }

    try {
      const result = await syncWithGithub(config);
      saveStatus({ action: result.action, at: Date.now(), error: '' });
      return result;
    } catch (error) {
      saveStatus({ action: 'error', at: Date.now(), error: error?.message || 'sync-failed' });
      throw error;
    }
  })().finally(() => {
    activeSync = null;
  });
  return activeSync;
}

export function requestGithubAutoSync(delayMs = 1200) {
  autoSyncController?.request(delayMs);
}

export function startGithubAutoSync({
  intervalMs = DEFAULT_INTERVAL_MS,
  initialDelayMs = 1000,
  onApplied,
} = {}) {
  autoSyncController?.stop();
  let stopped = false;
  let timer = 0;

  const schedule = (delay = intervalMs) => {
    if (stopped) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(run, Math.max(0, delay));
  };

  const run = async () => {
    if (stopped) return;
    if (document.hidden || navigator.onLine === false) {
      schedule(RETRY_INTERVAL_MS);
      return;
    }
    try {
      const result = await runConfiguredGithubSync();
      if (result.reloaded) onApplied?.(result);
      schedule(intervalMs);
    } catch (error) {
      console.warn('[GavinHub] automatic GitHub sync failed', error);
      schedule(RETRY_INTERVAL_MS);
    }
  };

  const onOnline = () => schedule(250);
  const onVisibility = () => {
    if (!document.hidden) schedule(500);
  };
  const onStateChange = (event) => {
    if (event.detail?.source === 'setup') schedule(100);
  };
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener(SYNC_STATE_EVENT, onStateChange);

  const controller = {
    request: schedule,
    stop() {
      if (stopped) return;
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener(SYNC_STATE_EVENT, onStateChange);
      if (autoSyncController === controller) autoSyncController = null;
    },
  };
  autoSyncController = controller;
  schedule(initialDelayMs);
  return controller.stop;
}
