import { toggleWallpaperFavorite, isWallpaperFavorited } from './storage.js';
import { createSettingsStore } from './settings-store.js';
import { initKeyboard } from './keyboard.js';
import { PAGE_CYCLE, onPageEnter, pageModules, preloadPageModule, preparePage } from './runtime.js';
import { focusSearchInput, scheduleInitialSearchFocus, initSearchFocusHooks, dismissSearchForPageLeave } from './search-focus.js';
import { initDialogController } from './dialog-ui.js';
import { loadOptionalModules, nextPaint, runWhenIdle, settleWithin } from './lifecycle.js';
import { createPageRouter } from './page-router.js';

const settingsStore = createSettingsStore();
const INITIAL_PAGE = 'home';
const STARTUP_SYNC_BUDGET_MS = 120;

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
  if (!wallpaper) return false;
  const lib = await pageModules.wallpaperLibrary(wallpaperLibraryApi);
  lib?.open?.();
  return Boolean(lib);
}

const wallpaperLibraryApi = {
  getCurrentWallpaper: () => wallpaper?.getCurrentWallpaper?.() || null,
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

const pageRouter = createPageRouter({
  pages: PAGE_CYCLE,
  initialPage: INITIAL_PAGE,
  applyChange({ fromPage, nextPage }) {
    if (fromPage === 'home' && nextPage !== 'home') dismissSearchForPageLeave();
    document.body.classList.toggle(
      'search-reveal-pending',
      fromPage === 'apps' && nextPage === 'home',
    );
    applyPageClasses(nextPage);
    refreshDock();
  },
  prepare({ nextPage }) {
    return preparePage(nextPage, getPageContext());
  },
  async afterPaint({ fromPage, nextPage }) {
    if (nextPage === 'apps') wallpaper?.syncAppsBlurWallpaper?.();
    if (fromPage === 'apps' && nextPage === 'home') {
      document.body.classList.remove('search-reveal-pending');
      await nextPaint();
    }
  },
  enter({ nextPage }) {
    return onPageEnter(nextPage, getPageContext());
  },
  async afterChange({ fromPage, nextPage }) {
    const currentWallpaper = wallpaper?.getCurrentWallpaper?.();
    if (currentWallpaper && fromPage === 'apps') {
      wallpaper?.adaptTextToWallpaper?.(currentWallpaper);
    }
    if (nextPage === 'home') {
      scheduleInitialSearchFocus();
    }
  },
  onError(error) {
    document.body.classList.remove('search-reveal-pending');
    console.error('[GavinHub] page navigation failed', error);
  },
});

function switchPage(page, options) {
  return pageRouter.navigate(page, options);
}

function refreshDock() {
  const dock = document.getElementById('dock');
  if (!dock || !shortcuts) return;
  shortcuts.renderDock(
    dock,
    shortcuts.loadDock(),
    pageRouter.getCurrentPage(),
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
    getCurrentPage: () => pageRouter.getCurrentPage(),
    onSwitchPage: switchPage,
    focusSearch: focusSearchInput,
    handleEscape: (...args) => handleSearchEscape(...args),
  });
}

function initLazyFeatureActions() {
  const settingsButton = document.getElementById('settings-btn');
  settingsButton?.addEventListener('click', async () => {
    if (settingsButton.dataset.loading === '1') return;
    settingsButton.dataset.loading = '1';
    settingsButton.setAttribute('aria-busy', 'true');
    try {
      const controller = await pageModules.settings(settingsApi);
      controller?.open?.();
    } catch (error) {
      console.error('[GavinHub] settings failed to open', error);
    } finally {
      delete settingsButton.dataset.loading;
      settingsButton.removeAttribute('aria-busy');
    }
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
    if (pageRouter.getCurrentPage() === 'home') {
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
    const idx = PAGE_CYCLE.indexOf(pageRouter.getCurrentPage());
    const next = PAGE_CYCLE[(idx + 1) % PAGE_CYCLE.length];
    switchPage(next);
  });
}

function prewarmSecondaryFeatures() {
  let cancelIdle = null;
  const timer = window.setTimeout(() => {
    if (document.hidden) return;
    cancelIdle = runWhenIdle(
      () => preloadPageModule('apps', getPageContext()),
      { timeout: 500, fallbackDelay: 80 },
    );
  }, 180);
  window.addEventListener('pagehide', () => {
    window.clearTimeout(timer);
    cancelIdle?.();
  }, { once: true });
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
  const syncModulePromise = import('./sync.js').catch((error) => {
    console.error('[GavinHub] sync module failed to load', error);
    return null;
  });
  const syncPullPromise = syncModulePromise.then(async (syncMod) => ({
    syncMod,
    result: await syncMod?.pullSyncOnStartup?.() || { applied: false, reason: 'unavailable' },
  }));

  const [modules, syncGate] = await Promise.all([
    loadOptionalModules({
      wallpaper: () => import('./wallpaper.js'),
      shortcuts: () => import('./shortcuts.js'),
      dockUi: () => import('./dock-ui.js'),
      metaBar: () => import('./meta-bar.js'),
      layoutMode: () => import('./layout-mode.js'),
      weatherUi: () => import('./weather-ui.js'),
    }),
    settleWithin(syncPullPromise, STARTUP_SYNC_BUDGET_MS),
  ]);

  wallpaper = modules.wallpaper;
  shortcuts = modules.shortcuts;
  wallpaper?.syncAppsBlurWallpaper?.();
  if (syncGate.settled && syncGate.value?.result?.applied) settingsStore.reload();

  const registerSyncListener = (syncMod) => {
    syncMod?.initSyncListener?.(() => {
      settingsStore.reload();
      const refresh = () => runWhenIdle(refreshSyncedUi, { timeout: 500, fallbackDelay: 40 });
      if (document.body.classList.contains('boot-glass-stable')) refresh();
      else document.addEventListener('boot-glass-stable', refresh, { once: true });
    });
  };

  if (syncGate.settled) {
    registerSyncListener(syncGate.value?.syncMod);
  } else {
    void syncPullPromise.then(({ syncMod, result }) => {
      registerSyncListener(syncMod);
      if (!result.applied) return;
      settingsStore.reload();
      const refresh = () => runWhenIdle(refreshSyncedUi, { timeout: 500, fallbackDelay: 40 });
      if (document.body.classList.contains('boot-glass-stable')) refresh();
      else document.addEventListener('boot-glass-stable', refresh, { once: true });
    });
  }

  modules.metaBar?.initMetaBar(async () => {
    const cal = await pageModules.calendar();
    cal.openCalendarDialog();
  });

  modules.dockUi?.initDockUI({ onDockChange: refreshDock });
  modules.layoutMode?.initLayoutMode?.();

  initFavorite();
  initDialogController();
  modules.weatherUi?.initWeather?.();
  initGlobalKeyboard();
  initLazyFeatureActions();
  initSearchFocusHooks(() => pageRouter.getCurrentPage());
  initContextMenu();
  preloadPageModule(pageRouter.getCurrentPage(), getPageContext());
  prewarmSecondaryFeatures();

  applyPageClasses(pageRouter.getCurrentPage());
  refreshDock();
  await switchPage(pageRouter.getCurrentPage(), { force: true });

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

}

async function init() {
  /* 搜索不依赖同步、壁纸或应用页，先变为可交互。 */
  const searchReady = initSearchModule();
  try {
    await Promise.all([initCore(), searchReady]);
    document.body.classList.add('app-ready');
    performance.mark?.('gavinhub:app-ready');
  } catch (err) {
    console.error('[GavinHub] core init failed', err);
  }
}

init();
