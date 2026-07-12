/** 首页搜索框聚焦 — 仅在「普通扩展页」场景下有效（见 background.js） */
import { waitForBootGlassReady } from './boot-ui.js';

function isHomeActive() {
  return !!document.querySelector('.page-panel.page-home.active');
}

function searchFormHidden() {
  const form = document.getElementById('search-form');
  if (!form) return true;
  const style = getComputedStyle(form);
  return style.visibility === 'hidden' || style.opacity === '0';
}

export function focusSearchInput({ allowDuringBoot = false } = {}) {
  const input = document.getElementById('search-input');
  if (!input) return false;
  if (document.visibilityState !== 'visible') return false;
  if (document.querySelector('dialog[open]')) return false;
  if (!isHomeActive()) return false;
  if (!allowDuringBoot && searchFormHidden()) return false;

  try {
    input.focus({ preventScroll: true });
  } catch {
    input.focus();
  }
  return document.activeElement === input;
}

const FOCUS_RETRY_DELAYS = [16, 80, 200, 420];

let focusSchedulePending = false;

function runInitialFocusAttempts() {
  if (!isHomeActive()) return;

  const tryFocus = () => focusSearchInput({ allowDuringBoot: true });
  tryFocus();
  requestAnimationFrame(() => requestAnimationFrame(tryFocus));
  for (const ms of FOCUS_RETRY_DELAYS) {
    setTimeout(tryFocus, ms);
  }
}

export function scheduleInitialSearchFocus() {
  if (document.body.classList.contains('wallpaper-boot')) return;

  const start = () => {
    focusSchedulePending = false;
    runInitialFocusAttempts();
  };

  if (focusSchedulePending) return;
  focusSchedulePending = true;
  waitForBootGlassReady(start);
}

function toggleSearchGlassRefresh() {
  const box = document.getElementById('search-box');
  if (!box) return Promise.resolve();
  box.dataset.glassRefresh = '1';
  void box.offsetHeight;
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        delete box.dataset.glassRefresh;
        void box.offsetHeight;
        requestAnimationFrame(resolve);
      });
    });
  });
}

/** 离开主页前立即收起搜索栏，避免 opacity 动画 + backdrop-filter 叠加重算掉帧 */
export function dismissSearchForPageLeave() {
  document.body.classList.remove('search-focused');
  const box = document.getElementById('search-box');
  const input = document.getElementById('search-input');
  box?.classList.remove('focused');
  if (box) box.style.transform = '';
  input?.blur();
  document.getElementById('search-suggestions')?.setAttribute('hidden', '');
  document.getElementById('search-engine-menu')?.setAttribute('hidden', '');
  document.getElementById('search-quote')?.setAttribute('hidden', '');
}

/** 轻量触发合成层刷新（启动/常态可用） */
export function refreshSearchGlass() {
  const box = document.getElementById('search-box');
  if (!box) return;
  if (
    document.body.classList.contains('wallpaper-boot')
    && !document.body.classList.contains('boot-priming-ui')
    && !document.body.classList.contains('boot-done')
  ) return;
  box.style.willChange = 'transform, backdrop-filter';
  void box.offsetHeight;
  requestAnimationFrame(() => {
    box.style.willChange = '';
  });
}

/** 二级页返回 / 壁纸换图后硬刷新毛玻璃 */
export function hardRefreshSearchGlass() {
  void toggleSearchGlassRefresh();
}

export function initSearchFocusHooks(getCurrentPage) {
  const shouldFocusHome = () => getCurrentPage?.() === 'home';

  window.addEventListener('pageshow', () => {
    if (!shouldFocusHome()) return;
    focusSchedulePending = false;
    scheduleInitialSearchFocus();
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && shouldFocusHome()) {
      focusSchedulePending = false;
      scheduleInitialSearchFocus();
    }
  }, { passive: true });
}
