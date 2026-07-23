import { createFeatureRegistry } from './feature-registry.js';
import { ensureStyle } from './style-registry.js';
import { getPageDefinition } from './page-registry.js';

/** 页面运行时：页面定义与功能加载保持分离。 */

/** @type {Array<(page: string, ctx: object) => void | Promise<void>>} */
const pageEnterHooks = [];

/** 页面进入时的扩展钩子（插件、统计等） */
export function registerPageEnterHook(fn) {
  pageEnterHooks.push(fn);
}

async function runPageEnterHooks(page, ctx) {
  for (const fn of pageEnterHooks) {
    try {
      await fn(page, ctx);
    } catch (error) {
      console.warn('[GavinHub] page enter hook failed', error);
    }
  }
}

const features = createFeatureRegistry({
  calendar: {
    load: () => import('./calendar.js'),
    setup(module) {
      module.initCalendarApp();
      return module;
    },
  },
  apps: {
    load: () => import('./shortcut-ui.js'),
    setup(module, context) {
      module.initShortcutsUI(context);
      return module;
    },
  },
  settings: {
    load: () => import('./settings-ui.js'),
    setup: (module, context) => module.initSettingsUI(context),
  },
  'wallpaper-library': {
    load: () => import('./wallpaper-library.js'),
    setup: (module, context) => module.initWallpaperLibrary(context),
  },
});

export const pageModules = {
  calendar() {
    return features.load('calendar');
  },
  apps(ctx) {
    return features.load('apps', ctx);
  },
  settings(api) {
    return features.load('settings', api);
  },
  wallpaperLibrary(api) {
    return features.load('wallpaper-library', api);
  },
};

export function getFeatureStatus(id) {
  return features.getStatus(id);
}

/** 在视觉切换前准备页面模块，避免解析和首轮渲染挤占动画帧。 */
export async function preparePage(page, ctx = {}) {
  const definition = getPageDefinition(page);
  if (!definition) return;
  await Promise.all([
    definition.style ? ensureStyle(definition.style) : null,
    definition.feature ? features.load(definition.feature, ctx) : null,
  ]);
}

/** 进入页面时的标准懒加载流程 */
export async function onPageEnter(page, ctx = {}) {
  await preparePage(page, ctx);
  await runPageEnterHooks(page, ctx);
}

/** 按 localStorage 记录恢复上次页面时预加载 */
export function preloadPageModule(page, ctx = {}) {
  const definition = getPageDefinition(page);
  if (definition?.feature && definition.prewarm) {
    return features.preload(definition.feature, ctx);
  }
  return Promise.resolve(null);
}
