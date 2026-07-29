import { closeDialog, openDialog, prepareDialogStyles } from './dialog-ui.js';
import { formatGithubSyncError, loadGithubSyncConfig } from './github-sync.js';
import { chooseLocalOnly, configureGithubSync, getSyncSetup } from './sync-coordinator.js';

let initialized = false;
let api = {};

function setStatus(text, isError = false) {
  const status = document.getElementById('sync-setup-status');
  if (!status) return;
  status.hidden = !text;
  status.textContent = text || '';
  status.classList.toggle('is-error', isError);
}

function setBusy(busy) {
  const connect = document.getElementById('sync-setup-connect');
  const local = document.getElementById('sync-setup-local');
  if (connect) {
    connect.disabled = busy;
    connect.textContent = busy ? '正在连接…' : '连接并恢复';
  }
  if (local) local.disabled = busy;
}

async function fillForm() {
  const tokenInput = document.getElementById('sync-setup-token');
  const gistInput = document.getElementById('sync-setup-gist-id');
  const secondaryButton = document.getElementById('sync-setup-local');
  if (!tokenInput || !gistInput) return;
  const [config, setup] = await Promise.all([loadGithubSyncConfig(), getSyncSetup()]);
  tokenInput.value = '';
  tokenInput.placeholder = config.token ? '已保存 Token，留空沿用' : '粘贴 ghp_…';
  gistInput.value = config.gistId || '';
  if (secondaryButton) {
    const firstRun = setup.mode === 'unset';
    secondaryButton.dataset.setupAction = firstRun ? 'local' : 'cancel';
    secondaryButton.textContent = firstRun ? '仅保存在本机' : '取消';
  }
}

async function connectGithub() {
  const saved = await loadGithubSyncConfig();
  const token = document.getElementById('sync-setup-token')?.value?.trim() || saved.token;
  const gistId = document.getElementById('sync-setup-gist-id')?.value?.trim() || '';
  setBusy(true);
  setStatus('正在读取云端备份…');
  try {
    const result = await configureGithubSync({ token, gistId });
    closeDialog('sync-setup-dialog');
    if (result.reloaded) api.onDataSynced?.();
  } catch (error) {
    setStatus(formatGithubSyncError(error), true);
  } finally {
    setBusy(false);
  }
}

function init(apiOverrides = {}) {
  api = { ...api, ...apiOverrides };
  if (initialized) return;
  initialized = true;

  document.getElementById('sync-setup-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    void connectGithub();
  });
  document.getElementById('sync-setup-local')?.addEventListener('click', () => {
    const button = document.getElementById('sync-setup-local');
    if (button?.dataset.setupAction === 'local') chooseLocalOnly();
    closeDialog('sync-setup-dialog');
  });
  document.getElementById('sync-setup-open-token')?.addEventListener('click', () => {
    window.open(
      'https://github.com/settings/tokens/new?description=GavinHub&scopes=gist',
      '_blank',
      'noopener,noreferrer',
    );
  });
}

export async function openSyncSetup(apiOverrides = {}) {
  init(apiOverrides);
  await Promise.all([prepareDialogStyles('sync-setup-dialog'), fillForm()]);
  setStatus('');
  openDialog('sync-setup-dialog');
}

export async function maybeOpenSyncSetup(apiOverrides = {}) {
  const setup = await getSyncSetup();
  if (setup.mode !== 'unset') return false;
  await openSyncSetup(apiOverrides);
  return true;
}
