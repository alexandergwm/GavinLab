/** 最小启动：时钟/日期不依赖 app.js 重型模块链 */
import { startClock } from './clock.js';
import { renderMetaBar } from './meta-bar.js';
import {
  settleBootUiClasses,
  onBootUiSettled,
  markBootGlassStable,
  prefersReducedMotion,
  BOOT_UI_FADE_MS,
} from './boot-ui.js';

try {
  document.body.setAttribute(
    'data-text-theme',
    document.documentElement.getAttribute('data-text-theme') || 'on-dark',
  );
  document.body.setAttribute(
    'data-text-tone',
    document.documentElement.getAttribute('data-text-tone') || 'light',
  );
} catch {}

document.body.classList.remove('wallpaper-boot', 'boot-priming-ui');
document.getElementById('boot-critical-hide')?.remove();

const markUiSettled = () => {
  if (!performance.getEntriesByName('gavinhub:ui-settled').length) {
    performance.mark?.('gavinhub:ui-settled');
  }
};
if (document.body.classList.contains('boot-ui-settled')) markUiSettled();
else document.addEventListener('boot-ui-settled', markUiSettled, { once: true });

function finishBootAwakening() {
  document.body.classList.remove('boot-awakening');
}

function watchBootGlassStable() {
  let openingReady = false;
  let effectsReady = document.body.classList.contains('wallpaper-effects-ready');
  let effectsFallbackTimer = 0;

  const finishBootSequence = () => {
    if (!openingReady || !effectsReady) return;
    window.clearTimeout(effectsFallbackTimer);
    markBootGlassStable();
    finishBootAwakening();
  };
  const markEffectsReady = () => {
    effectsReady = true;
    finishBootSequence();
  };
  const markOpeningReady = () => {
    openingReady = true;
    finishBootSequence();
  };

  if (!effectsReady) {
    document.addEventListener('wallpaper-effects-ready', markEffectsReady, { once: true });
    effectsFallbackTimer = window.setTimeout(markEffectsReady, 1400);
  }

  if (prefersReducedMotion()) {
    onBootUiSettled(markOpeningReady);
    return;
  }

  onBootUiSettled(() => {
    const dock = document.getElementById('dock');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      dock?.removeEventListener('animationend', onAnim);
      markOpeningReady();
    };
    const onAnim = (e) => {
      if (e.target !== dock) return;
      if (e.animationName === 'boot-awaken-dock' || e.animationName === 'boot-awaken-dock-sidebar') {
        finish();
      }
    };
    dock?.addEventListener('animationend', onAnim);
    window.setTimeout(finish, BOOT_UI_FADE_MS + 160);
  });
}

watchBootGlassStable();

// 渐变壁纸等路径：内联脚本不会触发 awaken，此处补上 UI 苏醒
const isGradientBoot = document.getElementById('wallpaper')?.classList.contains('is-gradient');
if (!document.body.classList.contains('boot-ui-settled') && isGradientBoot) {
  requestAnimationFrame(() => {
    requestAnimationFrame(settleBootUiClasses);
  });
}

startClock();
renderMetaBar();

import('./app.js').catch((err) => {
  console.error('[GavinHub] app.js failed to load', err);
});
