/** 启动阶段 UI 苏醒：整页同帧出现，完成后再进入搜索聚焦。 */

export const BOOT_WALLPAPER_FADE_MS = 720;
export const BOOT_UI_REVEAL_DELAY_MS = 0;
export const BOOT_UI_FADE_MS = 720;
export const BOOT_VIGNETTE_FADE_MS = 720;
export const BOOT_VIGNETTE_DELAY_MS = 0;
export const BOOT_SEARCH_FOCUS_DELAY_MS = 0;
export const BOOT_REVEAL_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
export const BOOT_PREPARE_FALLBACK_MS = 720;

let bootSettleRequested = false;
let bootSettleFallbackTimer = 0;

export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function signalBootUiSettled() {
  document.dispatchEvent(new CustomEvent('boot-ui-settled'));
}

export function signalBootGlassStable() {
  document.dispatchEvent(new CustomEvent('boot-glass-stable'));
}

export function markBootGlassStable() {
  if (document.body.classList.contains('boot-glass-stable')) return;
  document.body.classList.add('boot-glass-stable');
  performance.mark?.('gavinhub:glass-stable');
  signalBootGlassStable();
}

function bootUiDependenciesReady() {
  return document.body.classList.contains('app-ready')
    && document.body.classList.contains('wallpaper-effects-ready');
}

function commitBootUiClasses() {
  if (document.body.classList.contains('boot-ui-settled')) return;
  window.clearTimeout(bootSettleFallbackTimer);
  bootSettleFallbackTimer = 0;
  document.body.classList.add('boot-vignette-visible', 'boot-ui-settled', 'boot-done');
  performance.mark?.('gavinhub:ui-settled');
  signalBootUiSettled();
}

function trySettleBootUi() {
  if (!bootSettleRequested || !bootUiDependenciesReady()) return;
  commitBootUiClasses();
}

export function settleBootUiClasses({ force = false } = {}) {
  if (document.body.classList.contains('boot-ui-settled')) return;
  bootSettleRequested = true;
  document.body.classList.add('boot-ui-reveal-requested');
  if (force) {
    commitBootUiClasses();
    return;
  }
  trySettleBootUi();
  if (!bootSettleFallbackTimer) {
    bootSettleFallbackTimer = window.setTimeout(commitBootUiClasses, BOOT_PREPARE_FALLBACK_MS);
  }
}

document.addEventListener('boot-ui-reveal-requested', () => settleBootUiClasses());
document.addEventListener('gavinhub:app-ready', trySettleBootUi);
document.addEventListener('wallpaper-effects-ready', trySettleBootUi);
if (document.body?.classList.contains('boot-ui-reveal-requested')) settleBootUiClasses();

/** 等壁纸 opacity 过渡结束（或无动画）再回调 */
export function waitForWallpaperFade(img, callback) {
  if (!img || img.hidden || prefersReducedMotion()) {
    callback();
    return;
  }
  if (img.classList.contains('wallpaper-show')) {
    const opacity = parseFloat(getComputedStyle(img).opacity);
    if (opacity >= 0.99) {
      callback();
      return;
    }
  }
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    img.removeEventListener('transitionend', onEnd);
    callback();
  };
  const onEnd = (e) => {
    if (e.target === img && e.propertyName === 'opacity') finish();
  };
  img.addEventListener('transitionend', onEnd);
  window.setTimeout(finish, BOOT_WALLPAPER_FADE_MS + 80);
}

export function onBootUiSettled(callback) {
  if (document.body.classList.contains('boot-ui-settled')) {
    callback();
    return;
  }
  document.addEventListener('boot-ui-settled', callback, { once: true });
}

export function onBootGlassStable(callback) {
  if (document.body.classList.contains('boot-glass-stable')) {
    callback();
    return;
  }
  document.addEventListener('boot-glass-stable', callback, { once: true });
}

/** 毛玻璃元素已完成启动动画，再等两帧让合成层采样完成 */
export function waitForBootGlassReady(callback) {
  const afterPaint = (delay = 0) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (delay > 0) {
          window.setTimeout(callback, delay);
        } else {
          callback();
        }
      });
    });
  };
  const isBooting = document.body.classList.contains('boot-awakening')
    && !document.body.classList.contains('boot-glass-stable');
  if (!isBooting) {
    afterPaint();
    return;
  }
  if (document.body.classList.contains('boot-focus-primed')) {
    onBootUiSettled(() => afterPaint(prefersReducedMotion() ? 0 : BOOT_SEARCH_FOCUS_DELAY_MS));
    return;
  }
  onBootGlassStable(() => {
    afterPaint(prefersReducedMotion() ? 0 : BOOT_SEARCH_FOCUS_DELAY_MS);
  });
}
