import { formatSolarDateShort } from './lunar.js';

export function renderMetaBar() {
  const dateText = document.getElementById('date-text');
  if (dateText) dateText.textContent = formatSolarDateShort(new Date());
}

function scheduleMidnightRefresh(onTick) {
  const now = new Date();
  const ms = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;
  setTimeout(() => {
    onTick();
    scheduleMidnightRefresh(onTick);
  }, ms);
}

/** @param {() => void | Promise<void>} onOpenCalendar */
export function initMetaBar(onOpenCalendar) {
  renderMetaBar();
  scheduleMidnightRefresh(() => renderMetaBar());

  const open = () => onOpenCalendar();
  document.getElementById('clock-trigger')?.addEventListener('click', open);
  document.getElementById('date-trigger')?.addEventListener('click', open);
}
