/** 最小启动：时钟/日期不依赖 app.js 重型模块链 */
import { startClock } from './clock.js';
import { renderMetaBar } from './meta-bar.js';
import {
  settleBootUiClasses,
  onBootUiSettled,
  markBootGlassStable,
  prefersReducedMotion,
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
document.getElementById('boot-cover')?.remove();

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
  const finishBootSequence = () => {
    markBootGlassStable();
    finishBootAwakening();
  };

  if (prefersReducedMotion()) {
    onBootUiSettled(finishBootSequence);
    return;
  }

  onBootUiSettled(() => {
    const dock = document.getElementById('dock');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      dock?.removeEventListener('animationend', onAnim);
      finishBootSequence();
    };
    const onAnim = (e) => {
      if (e.target !== dock) return;
      if (e.animationName === 'boot-awaken-dock' || e.animationName === 'boot-awaken-dock-sidebar') {
        finish();
      }
    };
    dock?.addEventListener('animationend', onAnim);
    window.setTimeout(finish, 800);
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
