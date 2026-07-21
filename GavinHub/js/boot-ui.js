/** 启动阶段 UI 苏醒 — 对齐青柠：壁纸先淡入，UI 稍后错落「醒来」 */

export const BOOT_WALLPAPER_FADE_MS = 1000;
export const BOOT_UI_REVEAL_DELAY_MS = 80;
export const BOOT_UI_FADE_MS = 550;
export const BOOT_VIGNETTE_FADE_MS = 900;
export const BOOT_VIGNETTE_DELAY_MS = 0;
export const BOOT_SEARCH_FOCUS_DELAY_MS = 80;
export const BOOT_REVEAL_EASE = 'cubic-bezier(0.25, 0.8, 0.25, 1)';

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
  signalBootGlassStable();
}

export function settleBootUiClasses() {
  if (document.body.classList.contains('boot-ui-settled')) return;
  document.body.classList.add('boot-vignette-visible', 'boot-ui-settled', 'boot-done');
  signalBootUiSettled();
}

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
  onBootGlassStable(() => {
    afterPaint(prefersReducedMotion() ? 0 : BOOT_SEARCH_FOCUS_DELAY_MS);
  });
}
