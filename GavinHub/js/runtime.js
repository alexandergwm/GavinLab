/**
 * 运行时：页面路由 + 懒加载模块注册表。
 * 扩展新页面时：在 PAGE_SPECS 追加条目，并在 app 的 switchPage 中调用 onPageEnter。
 */

export const PAGE_CYCLE = ['home', 'apps'];

/** @type {Map<string, { mod: any, promise: Promise<any> | null }>} */
const modules = new Map();

/** @type {Array<(page: string, ctx: object) => void | Promise<void>>} */
const pageEnterHooks = [];

/** 页面进入时的扩展钩子（插件、统计等） */
export function registerPageEnterHook(fn) {
  pageEnterHooks.push(fn);
}

async function runPageEnterHooks(page, ctx) {
  for (const fn of pageEnterHooks) {
    await fn(page, ctx);
  }
}

/**
 * @param {string} id 模块唯一 id
 * @param {() => Promise<any>} loader dynamic import
 * @param {(mod: any, ctx?: object) => any} [bootstrap] 首次加载初始化
 */
export async function loadModule(id, loader, bootstrap, ctx = {}) {
  let entry = modules.get(id);
  if (!entry) {
    entry = { mod: null, promise: null };
    modules.set(id, entry);
  }
  if (entry.mod) return entry.mod;
  if (!entry.promise) {
    entry.promise = loader().then((mod) => {
      entry.mod = bootstrap ? bootstrap(mod, ctx) ?? mod : mod;
      entry.promise = null;
      return entry.mod;
    });
  }
  return entry.promise;
}

export const pageModules = {
  calendar() {
    return loadModule('calendar', () => import('./calendar.js'), (m) => {
      m.initCalendarApp();
      return m;
    });
  },
  apps(ctx) {
    return loadModule('apps', () => import('./shortcut-ui.js'), (m, c) => {
      m.initShortcutsUI(c);
      return m;
    }, ctx);
  },
  settings(api) {
    return loadModule('settings', () => import('./settings-ui.js'), (m, c) => {
      m.initSettingsUI(c);
      return m;
    }, api);
  },
  wallpaperLibrary(api) {
    return loadModule('wallpaper-library', () => import('./wallpaper-library.js'), (m, c) => {
      return m.initWallpaperLibrary(c);
    }, api);
  },
};

/** 进入页面时的标准懒加载流程 */
export async function onPageEnter(page, ctx = {}) {
  if (page === 'apps') {
    await pageModules.apps(ctx);
    await pageModules.settings(ctx.settingsApi);
  }
  await runPageEnterHooks(page, ctx);
}

/** 按 localStorage 记录恢复上次页面时预加载 */
export function preloadPageModule(page, ctx = {}) {
  if (page === 'apps') pageModules.apps(ctx).catch(() => {});
}
