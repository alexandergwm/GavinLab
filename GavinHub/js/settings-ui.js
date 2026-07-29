import {
  saveWallpaperRotation,
  WALLPAPER_ROTATION_LABELS,
  WALLPAPER_ROTATION_ORDER,
} from './storage.js';
import {
  loadWallpaper,
  getInitialWallpaperSource,
  WALLPAPER_SOURCE_LABELS,
  WALLPAPER_SOURCE_ORDER,
} from './wallpaper.js';
import { updateSearchEngineBadge, refreshSearchSuggestions } from './search.js';
import { closeDialog as closeModal, openDialog as openModal } from './dialog-ui.js';

let inited = false;
let settingsController = null;

const SYNC_ACTION_LABELS = {
  downloaded: '已从云端恢复',
  uploaded: '本机更新已上传',
  'uploaded-new': '已创建云端备份',
  merged: '两端更新已合并',
  'up-to-date': '本机与云端一致',
};

function setGithubSyncStatus(text, isError = false) {
  const el = document.getElementById('github-sync-status');
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.classList.toggle('is-error', isError);
}

function formatSyncTime(timestamp) {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

async function refreshGithubSyncOverview() {
  const title = document.getElementById('github-auto-sync-title');
  const detail = document.getElementById('github-auto-sync-detail');
  const dot = document.getElementById('github-auto-sync-dot');
  const syncButton = document.getElementById('github-sync-now-btn');
  const reconnectButton = document.getElementById('github-reconnect-btn');
  if (!title || !detail || !dot) return;

  try {
    const coordinator = await import('./sync-coordinator.js');
    const overview = await coordinator.getSyncOverview();
    dot.className = 'settings-sync-dot';
    if (overview.connected) {
      const hasError = Boolean(overview.status?.error);
      title.textContent = hasError ? 'GitHub 自动同步暂时中断' : 'GitHub 自动同步已开启';
      dot.classList.add(hasError ? 'is-error' : 'is-connected');
      const statusLabel = hasError
        ? '请检查网络或重新连接'
        : (SYNC_ACTION_LABELS[overview.status?.action] || '等待首次同步');
      const at = formatSyncTime(overview.status?.at);
      detail.textContent = at ? `${statusLabel} · ${at}` : statusLabel;
    } else if (overview.mode === 'local') {
      title.textContent = '仅保存在本机';
      detail.textContent = '连接 GitHub 后可在其他设备自动恢复';
      dot.classList.add('is-local');
    } else {
      title.textContent = 'GitHub 连接已失效';
      detail.textContent = '请重新连接以继续自动同步';
      dot.classList.add('is-error');
    }
    if (syncButton) syncButton.disabled = !overview.connected;
    if (reconnectButton) reconnectButton.textContent = overview.connected ? '重新连接' : '连接 GitHub';
  } catch {
    title.textContent = '无法读取同步状态';
    detail.textContent = '本机数据不会受到影响';
    dot.classList.add('is-error');
    if (syncButton) syncButton.disabled = true;
  }
}

async function runGithubSync(api) {
  const button = document.getElementById('github-sync-now-btn');
  if (button?.disabled) return;
  button.disabled = true;
  button.textContent = '同步中…';
  setGithubSyncStatus('正在比较本机与云端数据…', false);

  try {
    const [coordinator, githubSync] = await Promise.all([
      import('./sync-coordinator.js'),
      import('./github-sync.js'),
    ]);
    const result = await coordinator.runConfiguredGithubSync();
    setGithubSyncStatus(githubSync.formatGithubSyncResult(result), false);
    if (result.reloaded) api.onDataSynced?.();
    await refreshGithubSyncOverview();
  } catch (err) {
    const githubSync = await import('./github-sync.js');
    setGithubSyncStatus(githubSync.formatGithubSyncError(err), true);
  } finally {
    button.textContent = '立即同步';
    await refreshGithubSyncOverview();
  }
}

function populateSelectOptions(select, order, labels, currentValue) {
  if (!select) return;
  select.replaceChildren();
  for (const id of order) {
    const label = labels[id];
    if (!label) continue;
    const option = document.createElement('option');
    option.value = id;
    option.textContent = label;
    select.appendChild(option);
  }
  if (currentValue && order.includes(currentValue)) {
    select.value = currentValue;
  }
}

function syncWallpaperRotationHint() {
  const hint = document.getElementById('wallpaper-rotation-hint');
  const rotationSelect = document.getElementById('wallpaper-rotation');
  if (hint && rotationSelect) {
    hint.hidden = rotationSelect.value !== 'weekly';
  }
}

/**
 * @param {{
 *   getSettings: () => object,
 *   setSettings: (partial: object) => object,
 *   updateFavoriteUI: () => void,
 *   openWallpaperLibrary: () => Promise<void>,
 *   onWallpaperRotationChange?: () => void,
 * }} api
 */
export function initSettingsUI(api) {
  if (inited) return settingsController;
  inited = true;

  const dialog = document.getElementById('settings-dialog');
  const form = document.getElementById('settings-form');
  const engineSelect = document.getElementById('search-engine');
  const wallpaperSelect = document.getElementById('wallpaper-source');
  const rotationSelect = document.getElementById('wallpaper-rotation');
  const greetingCheckbox = document.getElementById('show-greeting');

  /* 禁止 Enter 提交表单误关设置。 */
  form?.addEventListener('submit', (e) => e.preventDefault());

  const syncForm = () => {
    const settings = api.getSettings();
    engineSelect.value = settings.searchEngine;
    populateSelectOptions(
      wallpaperSelect,
      WALLPAPER_SOURCE_ORDER,
      WALLPAPER_SOURCE_LABELS,
      getInitialWallpaperSource(),
    );
    populateSelectOptions(
      rotationSelect,
      WALLPAPER_ROTATION_ORDER,
      WALLPAPER_ROTATION_LABELS,
      settings.wallpaperRotation || 'daily',
    );
    syncWallpaperRotationHint();
    if (greetingCheckbox) greetingCheckbox.checked = settings.showGreeting !== false;
  };

  const open = () => {
    syncForm();
    setGithubSyncStatus('');
    void refreshGithubSyncOverview();
    openModal(dialog);
  };

  engineSelect?.addEventListener('change', () => {
    api.setSettings({ searchEngine: engineSelect.value });
    updateSearchEngineBadge();
    refreshSearchSuggestions();
  });

  wallpaperSelect?.addEventListener('change', async () => {
    const settings = api.getSettings();
    const prevSource = settings.wallpaperSource;
    const nextSource = wallpaperSelect.value;
    if (nextSource === prevSource) return;
    if (nextSource === 'library') {
      wallpaperSelect.value = prevSource;
      await api.openWallpaperLibrary();
      return;
    }
    api.setSettings({ wallpaperSource: nextSource });
    saveWallpaperRotation({ lastChange: Date.now() });
    await loadWallpaper(nextSource, { force: true });
    api.updateFavoriteUI();
  });

  rotationSelect?.addEventListener('change', () => {
    api.setSettings({ wallpaperRotation: rotationSelect.value });
    saveWallpaperRotation({ interval: rotationSelect.value, lastChange: Date.now() });
    api.onWallpaperRotationChange?.();
    syncWallpaperRotationHint();
    if (rotationSelect.value === 'weekly') {
      const source = getInitialWallpaperSource();
      wallpaperSelect.value = source;
      api.setSettings({ wallpaperSource: source });
      loadWallpaper(source, { force: true }).then(() => api.updateFavoriteUI());
    }
  });

  greetingCheckbox?.addEventListener('change', () => {
    api.setSettings({ showGreeting: greetingCheckbox.checked });
  });

  const importFile = document.getElementById('sync-import-file');
  document.getElementById('sync-export-btn')?.addEventListener('click', async () => {
    try {
      const sync = await import('./sync.js');
      sync.downloadSyncBundleFile();
    } catch {
      window.alert('导出失败，请稍后重试');
    }
  });
  document.getElementById('sync-import-btn')?.addEventListener('click', () => {
    importFile?.click();
  });

  importFile?.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    importFile.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const sync = await import('./sync.js');
      sync.importSyncBundle(text);
      closeModal(dialog);
      api.onDataImported?.();
    } catch {
      window.alert('导入失败：文件格式不正确或版本不兼容');
    }
  });

  document.getElementById('github-sync-now-btn')?.addEventListener('click', () => {
    void runGithubSync(api);
  });

  document.getElementById('github-reconnect-btn')?.addEventListener('click', async () => {
    const setup = await import('./sync-setup-ui.js');
    closeModal(dialog);
    await setup.openSyncSetup({ onDataSynced: api.onDataSynced });
  });

  document.addEventListener('gavinhub:sync-state-change', () => {
    if (dialog?.open) void refreshGithubSyncOverview();
  });

  settingsController = { open, sync: syncForm };
  return settingsController;
}
