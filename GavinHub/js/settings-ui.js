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
let syncTabsBound = false;
const SYNC_TAB_KEY = 'startpage-sync-ui-tab';
const FILE_TAB_KEY = 'startpage-sync-file-tab';

function setSyncTab(tab) {
  const tabs = document.querySelectorAll('.settings-sync-tab[data-sync-tab]');
  const panels = {
    edge: document.getElementById('sync-panel-edge'),
    file: document.getElementById('sync-panel-file'),
    github: document.getElementById('sync-panel-github'),
  };
  if (!panels[tab]) return;

  tabs.forEach((btn) => {
    const active = btn.dataset.syncTab === tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  Object.entries(panels).forEach(([id, panel]) => {
    if (!panel) return;
    panel.hidden = id !== tab;
  });

  try {
    localStorage.setItem(SYNC_TAB_KEY, tab);
  } catch { /* ignore */ }
}

function setFileTab(tab) {
  const hints = {
    export: '下载 json 配置文件，拷到其他电脑',
    import: '选择之前导出的 json 文件，覆盖本机配置',
  };
  const labels = {
    export: '导出配置',
    import: '选择文件导入',
  };

  document.querySelectorAll('.settings-sync-subtab[data-file-tab]').forEach((btn) => {
    const active = btn.dataset.fileTab === tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  const hint = document.getElementById('sync-file-hint');
  const actionBtn = document.getElementById('sync-file-action-btn');
  if (hint) hint.textContent = hints[tab] || hints.export;
  if (actionBtn) {
    actionBtn.textContent = labels[tab] || labels.export;
    actionBtn.dataset.fileAction = tab;
  }

  try {
    localStorage.setItem(FILE_TAB_KEY, tab);
  } catch { /* ignore */ }
}

function restoreSyncTabs() {
  let saved = 'file';
  try {
    saved = localStorage.getItem(SYNC_TAB_KEY) || 'file';
  } catch { /* ignore */ }
  setSyncTab(['edge', 'file', 'github'].includes(saved) ? saved : 'file');

  let fileTab = 'export';
  try {
    fileTab = localStorage.getItem(FILE_TAB_KEY) || 'export';
  } catch { /* ignore */ }
  setFileTab(['export', 'import'].includes(fileTab) ? fileTab : 'export');
}

function bindSyncTabs() {
  if (syncTabsBound) return;
  syncTabsBound = true;

  document.querySelector('.settings-sync-tabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sync-tab]');
    if (btn) setSyncTab(btn.dataset.syncTab);
  });

  document.querySelector('.settings-sync-subtabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-file-tab]');
    if (btn) setFileTab(btn.dataset.fileTab);
  });

  restoreSyncTabs();
}

async function refreshSyncStatus() {
  const el = document.getElementById('sync-status');
  if (!el) return;
  try {
    const sync = await import('./sync.js');
    const full = await sync.getSyncStatusText();
    el.textContent = full.split('。')[0] || full;
  } catch {
    el.textContent = 'Edge 账号同步需登录浏览器账号';
  }
}

function readGithubFormConfig(saved = {}) {
  const token = document.getElementById('github-sync-token')?.value?.trim() || saved.token || '';
  return {
    token,
    gistId: document.getElementById('github-sync-gist-id')?.value || saved.gistId || '',
  };
}

function syncGithubFormFromStorage() {
  const github = document.getElementById('github-sync-token');
  const gistId = document.getElementById('github-sync-gist-id');
  const gistField = document.getElementById('github-gist-field');
  if (!github || !gistId) return;
  import('./github-sync.js').then((mod) => {
    const cfg = mod.loadGithubSyncConfig();
    github.value = '';
    github.placeholder = cfg.token
      ? '已保存 GitHub Token，留空沿用；粘贴新 Token 可替换'
      : '粘贴 ghp_…';
    gistId.value = cfg.gistId;
    if (gistField) gistField.hidden = false;
  }).catch(() => {});
}

function revealGistId(gistId) {
  const gistInput = document.getElementById('github-sync-gist-id');
  const gistField = document.getElementById('github-gist-field');
  if (!gistInput || !gistId) return;
  gistInput.value = gistId;
  if (gistField) gistField.hidden = false;
}

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

async function runGithubSync(api) {
  const githubSync = await import('./github-sync.js');
  const config = readGithubFormConfig(githubSync.loadGithubSyncConfig());
  const button = document.getElementById('github-sync-merge-btn');
  if (button?.disabled) return;
  if (button) {
    button.disabled = true;
    button.textContent = '同步中…';
  }
  setGithubSyncStatus('正在连接 GitHub…', false);

  try {
    const result = await githubSync.syncWithGithub(config);
    if (result.gistId) revealGistId(result.gistId);

    const gistId = document.getElementById('github-sync-gist-id')?.value?.trim();
    let statusText = githubSync.formatGithubSyncResult(result);
    if (gistId && (result.action === 'uploaded' || result.action === 'uploaded-new')) {
      statusText += `。公司电脑填同一 Token 和 Gist ID 即可`;
    }
    setGithubSyncStatus(statusText, false);
    if (result.reloaded) {
      closeModal('settings-dialog');
      api.onDataImported?.();
    }
  } catch (err) {
    setGithubSyncStatus(githubSync.formatGithubSyncError(err), true);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = '保存并同步';
    }
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
 * }} api
 */
export function initSettingsUI(api) {
  if (inited) return;
  inited = true;

  const dialog = document.getElementById('settings-dialog');
  const form = document.getElementById('settings-form');
  const btn = document.getElementById('settings-btn');
  const engineSelect = document.getElementById('search-engine');
  const wallpaperSelect = document.getElementById('wallpaper-source');
  const rotationSelect = document.getElementById('wallpaper-rotation');
  const greetingCheckbox = document.getElementById('show-greeting');

  /* 禁止 Enter 提交表单误关设置（GitHub token 等输入框） */
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

  btn?.addEventListener('click', () => {
    syncForm();
    syncGithubFormFromStorage();
    setGithubSyncStatus('');
    restoreSyncTabs();
    void refreshSyncStatus();
    openModal(dialog);
  });

  engineSelect?.addEventListener('change', () => {
    api.setSettings({ searchEngine: engineSelect.value });
    updateSearchEngineBadge();
    refreshSearchSuggestions();
  });

  wallpaperSelect?.addEventListener('change', async () => {
    const settings = api.getSettings();
    const prevSource = settings.wallpaperSource;
    api.setSettings({ wallpaperSource: wallpaperSelect.value });
    saveWallpaperRotation({ lastChange: Date.now() });
    if (wallpaperSelect.value !== prevSource) {
      if (wallpaperSelect.value === 'library') {
        await api.openWallpaperLibrary();
      } else {
        await loadWallpaper(wallpaperSelect.value, { force: true });
      }
      api.updateFavoriteUI();
    }
  });

  rotationSelect?.addEventListener('change', () => {
    api.setSettings({ wallpaperRotation: rotationSelect.value });
    saveWallpaperRotation({ interval: rotationSelect.value, lastChange: Date.now() });
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
  const fileActionBtn = document.getElementById('sync-file-action-btn');

  fileActionBtn?.addEventListener('click', async () => {
    const action = fileActionBtn.dataset.fileAction || 'export';
    if (action === 'import') {
      importFile?.click();
      return;
    }
    try {
      const sync = await import('./sync.js');
      sync.downloadSyncBundleFile();
    } catch {
      window.alert('导出失败，请稍后重试');
    }
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

  document.getElementById('github-open-token-btn')?.addEventListener('click', () => {
    const url = 'https://github.com/settings/tokens/new?description=GavinHub&scopes=gist';
    window.open(url, '_blank', 'noopener,noreferrer');
  });

  document.getElementById('github-sync-merge-btn')?.addEventListener('click', () => {
    void runGithubSync(api);
  });

  bindSyncTabs();
}
