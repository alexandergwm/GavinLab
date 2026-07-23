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

  // activeElement can already be the input while Chromium still owns the real
  // keyboard focus in the omnibox. Ask the document to claim it before testing.
  if (!document.hasFocus()) {
    try {
      window.focus();
    } catch {
      // A later window focus event will retry the handoff.
    }
  }
  try {
    input.focus({ preventScroll: true });
  } catch {
    input.focus();
  }
  const focused = document.hasFocus() && document.activeElement === input;
  if (focused && !performance.getEntriesByName('gavinhub:search-focused').length) {
    performance.mark?.('gavinhub:search-focused');
  }
  return focused;
}

const FOCUS_RETRY_DELAYS = [0, 40, 100, 180, 320, 520, 800];

let focusSchedulePending = false;
let focusAttemptGeneration = 0;
let focusRetryTimer = 0;
let initialFocusArmed = true;

function runInitialFocusAttempts() {
  if (!isHomeActive()) return;
  initialFocusArmed = true;
  const generation = ++focusAttemptGeneration;

  const attempt = (index) => {
    if (generation !== focusAttemptGeneration || !isHomeActive()) return;
    if (focusSearchInput({ allowDuringBoot: true })) {
      initialFocusArmed = false;
      return;
    }
    const nextDelay = FOCUS_RETRY_DELAYS[index + 1];
    if (nextDelay == null) return;
    focusRetryTimer = window.setTimeout(() => attempt(index + 1), nextDelay);
  };

  window.clearTimeout(focusRetryTimer);
  attempt(0);
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
  focusAttemptGeneration += 1;
  initialFocusArmed = false;
  window.clearTimeout(focusRetryTimer);
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
  let pointerFocusIntent = false;

  window.addEventListener('pointerdown', () => {
    pointerFocusIntent = true;
    window.setTimeout(() => {
      pointerFocusIntent = false;
    }, 0);
  }, { capture: true, passive: true });

  // If Edge releases its address bar focus after the extension page commits,
  // finish the pending handoff immediately. Do not override an intentional click.
  window.addEventListener('focus', () => {
    if (!initialFocusArmed || pointerFocusIntent || !shouldFocusHome()) return;
    runInitialFocusAttempts();
  }, { passive: true });

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
