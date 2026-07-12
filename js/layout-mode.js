/** 检测 Edge 侧边栏等窄面板，切换 layout-sidebar */
export function initLayoutMode() {
  const update = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const sidebar = w <= 520 && h > w * 1.12;
    document.body.classList.toggle('layout-sidebar', sidebar);
  };

  update();
  window.addEventListener('resize', update, { passive: true });
  window.addEventListener('orientationchange', update, { passive: true });
}
