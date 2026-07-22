import { toggleWallpaperFavorite, isWallpaperFavorited } from './storage.js';
import { createSettingsStore } from './settings-store.js';
import { initKeyboard } from './keyboard.js';
import { PAGE_CYCLE, onPageEnter, pageModules, preloadPageModule } from './runtime.js';
import { focusSearchInput, scheduleInitialSearchFocus, initSearchFocusHooks, dismissSearchForPageLeave } from './search-focus.js';

const settingsStore = createSettingsStore();
/** 每个新标签页独立，仅内存保存，不写入 localStorage */
let tabPage = 'home';
let pageTransitionToken = 0;

/** @type {typeof import('./wallpaper.js')} */
let wallpaper;
/** @type {typeof import('./shortcuts.js')} */
let shortcuts;

const settingsApi = {
  getSettings: settingsStore.get,
  setSettings: settingsStore.set,
  updateFavoriteUI,
  openWallpaperLibrary,
  onDataImported: () => {
    location.reload();
  },
};

async function openWallpaperLibrary() {
  const lib = await pageModules.wallpaperLibrary(wallpaperLibraryApi);
  lib?.open?.();
}

const wallpaperLibraryApi = {
  getCurrentWallpaper: () => wallpaper.getCurrentWallpaper(),
  applySelectedWallpaper: async (data) => {
    settingsStore.set({ wallpaperSource: 'library', wallpaperId: data.id || '' });
    document.getElementById('wallpaper-source').value = 'library';
    await wallpaper.applySelectedWallpaper(data);
    updateFavoriteUI();
  },
  onFavoriteChange: updateFavoriteUI,
};

function getPageContext() {
  return {
    onDockChange: refreshDock,
    settingsApi,
  };
}

function applyPageClasses(page) {
  const isApps = page === 'apps';
  document.body.classList.toggle('page-apps-active', isApps);
  document.body.classList.toggle('page-blur-active', isApps);

  if (isApps) {
    wallpaper?.syncAppsBlurWallpaper?.();
  }

  const headerActions = document.getElementById('header-actions');
  if (headerActions) headerActions.hidden = !isApps;

  for (const el of document.querySelectorAll('.page-panel')) {
    el.classList.toggle('active', el.dataset.page === page);
  }
}

async function switchPage(page, { force = false } = {}) {
  if (!PAGE_CYCLE.includes(page)) return;
  if (!force && page === tabPage) return;

  const transitionToken = ++pageTransitionToken;
  const fromApps = tabPage === 'apps';
  if (tabPage === 'home' && page !== 'home') {
    dismissSearchForPageLeave();
  }
  const returningHome = fromApps && page === 'home';
  if (returningHome) {
    document.body.classList.add('search-reveal-pending');
  } else {
    document.body.classList.remove('search-reveal-pending');
  }
  tabPage = page;

  applyPageClasses(page);
  refreshDock();

  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (transitionToken !== pageTransitionToken) return;

  if (page === 'apps') {
    wallpaper?.syncAppsBlurWallpaper?.();
  }

  if (returningHome) {
    document.body.classList.remove('search-reveal-pending');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (transitionToken !== pageTransitionToken) return;
  }

  await onPageEnter(page, getPageContext());
  if (transitionToken !== pageTransitionToken) return;

  const wp = wallpaper.getCurrentWallpaper();
  if (wp && fromApps) {
    wallpaper.adaptTextToWallpaper(wp);
  }

  if (page === 'home') {
    if (fromApps) {
      requestAnimationFrame(() => scheduleInitialSearchFocus());
    } else {
      scheduleInitialSearchFocus();
    }
  }
}

function refreshDock() {
  const dock = document.getElementById('dock');
  if (!dock || !shortcuts) return;
  shortcuts.renderDock(
    dock,
    shortcuts.loadDock(),
    tabPage,
    (targetPage) => {
      switchPage(targetPage);
    },
  );
}

function updateFavoriteUI() {
  const wp = wallpaper?.getCurrentWallpaper?.();
  const btn = document.getElementById('wallpaper-like');
  btn?.classList.toggle('liked', wp ? isWallpaperFavorited(wp) : false);
}

function initFavorite() {
  document.getElementById('wallpaper-like')?.addEventListener('click', () => {
    if (!wallpaper) return;
    const wp = wallpaper.getCurrentWallpaper();
    const result = toggleWallpaperFavorite(wp);
    document.getElementById('wallpaper-like')?.classList.toggle('liked', result.liked);
  });
}

let handleSearchEscape = () => false;

export { focusSearchInput, scheduleInitialSearchFocus };

function initGlobalKeyboard() {
  initKeyboard({
    getCurrentPage: () => tabPage,
    onSwitchPage: switchPage,
    focusSearch: focusSearchInput,
    handleEscape: (...args) => handleSearchEscape(...args),
  });
}

async function initSearchModule() {
  try {
    const search = await import('./search.js');
    handleSearchEscape = search.handleSearchEscape;
    search.initSearch({
      getSettings: settingsStore.get,
      onSettingsChange: (partial) => {
        settingsStore.set(partial);
        if ('searchEngine' in partial) {
          document.getElementById('search-engine').value = partial.searchEngine;
        }
      },
    });
    // 首屏聚焦由壁纸 reveal 完成后统一调度（见 wallpaper.js scheduleInitialSearchFocus），
    // 这里只在非启动阶段补充一次（例如从缓存快速恢复或非图片壁纸）。
    if (tabPage === 'home') {
      scheduleInitialSearchFocus();
    }
  } catch (err) {
    console.error('[GavinHub] search module failed to load', err);
  }
}

function initContextMenu() {
  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('#dock a.dock-item[data-dock-id]')) return;
    if (e.target.closest('a, button, input, dialog, .dock-item, .meta-part, .clock-trigger, .search-suggestion, .search-engine-menu, .shortcut-menu, .dock-menu')) return;
    if (e.target.closest('.shortcut-item:not(.shortcut-add)')) return;

    e.preventDefault();
    const idx = PAGE_CYCLE.indexOf(tabPage);
    const next = PAGE_CYCLE[(idx + 1) % PAGE_CYCLE.length];
    switchPage(next);
  });
}

function initDialogCloseButtons() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.modal-close');
    if (!btn) return;
    btn.closest('dialog')?.close();
  }, { passive: true });
}

function refreshSyncedUi() {
  refreshDock();
  void import('./shortcut-ui.js').then((m) => m.refreshShortcutsUI?.()).catch(() => {});
  void import('./calendar.js').then((m) => {
    const dialog = document.getElementById('calendar-dialog');
    if (dialog?.open) m.renderCalendar?.();
  }).catch(() => {});
}

async function initCore() {
  const load = async (label, loader) => {
    try {
      return await loader();
    } catch (err) {
      console.error(`[GavinHub] ${label} failed to load`, err);
      return null;
    }
  };

  const syncModPromise = load('sync module', () => import('./sync.js'));
  const [wallpaperMod, shortcutsMod, dockUi, metaBar, layoutMode] = await Promise.all([
    load('wallpaper module', () => import('./wallpaper.js')),
    load('shortcuts module', () => import('./shortcuts.js')),
    load('dock-ui module', () => import('./dock-ui.js')),
    load('meta-bar module', () => import('./meta-bar.js')),
    load('layout-mode module', () => import('./layout-mode.js')),
  ]);

  wallpaper = wallpaperMod;
  shortcuts = shortcutsMod;

  metaBar?.initMetaBar(async () => {
    const cal = await pageModules.calendar();
    cal.openCalendarDialog();
  });

  dockUi?.initDockUI({ onDockChange: refreshDock });
  layoutMode?.initLayoutMode?.();

  initFavorite();
  initDialogCloseButtons();
  initGlobalKeyboard();
  initSearchFocusHooks(() => tabPage);
  initContextMenu();
  preloadPageModule(tabPage, getPageContext());

  /* 本地首屏先立即可用；账号同步静默追上，避免网络延迟阻塞 Dock 与搜索。 */
  applyPageClasses(tabPage);
  refreshDock();
  void switchPage(tabPage, { force: true });

  void syncModPromise.then(async (syncMod) => {
    if (!syncMod) return;
    syncMod.initSyncListener?.(() => {
      settingsStore.reload();
      refreshSyncedUi();
    });
    const { applied } = await syncMod.pullSyncOnStartup?.() || { applied: false };
    if (applied) {
      settingsStore.reload();
      refreshSyncedUi();
    }
  }).catch((err) => {
    console.warn('[GavinHub] background sync failed', err);
  });

  if (wallpaper) {
    wallpaper.initWallpaperInfo();
    document.getElementById('wallpaper-info-btn')?.addEventListener('click', () => {
      openWallpaperLibrary();
    });
    (async () => {
      const rotated = await wallpaper.applyWallpaperRotation((nextSource) => {
        document.getElementById('wallpaper-source').value = nextSource;
      });
      const initialSource = rotated?.source || wallpaper.getInitialWallpaperSource();
      try {
        if (rotated?.type === 'next' && initialSource === 'bing') {
          await wallpaper.loadNextWallpaper();
        } else if (rotated?.type === 'next') {
          await wallpaper.loadWallpaper(initialSource, { force: true });
        } else {
          await wallpaper.loadWallpaper(initialSource);
        }
      } catch {
        /* loadWallpaper handles fallback */
      }
      updateFavoriteUI();
    })();
    let rotationInterval = wallpaper.initWallpaperRotation(async (source, meta = {}) => {
      if (!meta.advanced) {
        await wallpaper.loadWallpaper(source, { force: true });
      }
      updateFavoriteUI();
    });

    // 低资源：标签页隐藏时暂停壁纸轮换 tick
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (rotationInterval) {
          clearInterval(rotationInterval);
          rotationInterval = null;
        }
      } else if (!rotationInterval) {
        // 恢复时立即检查一次（函数内部已判断是否 due）
        rotationInterval = wallpaper.initWallpaperRotation(async (source, meta = {}) => {
          if (!meta.advanced) {
            await wallpaper.loadWallpaper(source, { force: true });
          }
          updateFavoriteUI();
        }, { runImmediately: true });
      }
    }, { passive: true });
  }

  const initWeatherWhenIdle = async () => {
    const weatherUi = await load('weather-ui module', () => import('./weather-ui.js'));
    weatherUi?.initWeather?.();
  };
  if ('requestIdleCallback' in window) {
    requestIdleCallback(initWeatherWhenIdle, { timeout: 1200 });
  } else {
    setTimeout(initWeatherWhenIdle, 400);
  }
}

async function init() {
  /* 搜索不依赖同步或壁纸网络请求，优先变为可交互。 */
  void initSearchModule();
  try {
    await initCore();
  } catch (err) {
    console.error('[GavinHub] core init failed', err);
  }
}

init();
