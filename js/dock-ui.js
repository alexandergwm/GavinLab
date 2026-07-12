import { loadDock, removeFromDock } from './shortcuts.js';

let activeDockId = null;

function getMenu() {
  return document.getElementById('dock-menu');
}

function hideMenu() {
  const menu = getMenu();
  if (!menu) return;
  menu.hidden = true;
  activeDockId = null;
}

function showMenu(item, event) {
  const menu = getMenu();
  if (!menu) return;

  document.getElementById('shortcut-menu')?.setAttribute('hidden', '');
  event.stopPropagation();

  activeDockId = item.id;
  menu.hidden = false;
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;

  const rect = menu.getBoundingClientRect();
  const pad = 8;
  if (rect.right > window.innerWidth - pad) {
    menu.style.left = `${window.innerWidth - rect.width - pad}px`;
  }
  if (rect.bottom > window.innerHeight - pad) {
    menu.style.top = `${window.innerHeight - rect.height - pad}px`;
  }
}

function getDockLinkById(id) {
  return loadDock().find((d) => d.type === 'link' && d.id === id);
}

let menuBound = false;
let dockContextBound = false;

function bindDockContextMenu() {
  if (dockContextBound) return;
  const dock = document.getElementById('dock');
  if (!dock) return;
  dockContextBound = true;

  dock.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('a.dock-item[data-dock-id]');
    if (!el) return;

    e.preventDefault();
    e.stopPropagation();

    const item = getDockLinkById(el.dataset.dockId);
    if (item) showMenu(item, e);
  });
}

function bindMenu(onDockChange) {
  const menu = getMenu();
  if (!menu || menuBound) return;
  menuBound = true;

  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    const btn = e.target.closest('[data-action]');
    if (!btn || !activeDockId) return;

    const item = getDockLinkById(activeDockId);
    if (!item) return hideMenu();

    const action = btn.dataset.action;
    hideMenu();

    if (action === 'open') {
      window.open(item.url, '_blank', 'noopener,noreferrer');
    }
    if (action === 'remove') {
      const { removed } = removeFromDock(item.id);
      if (removed) onDockChange?.();
    }
  });

  document.addEventListener('click', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.dock-menu')) return;
    hideMenu();
  });
  document.addEventListener('scroll', hideMenu, true);
  window.addEventListener('resize', hideMenu);
}

export function initDockUI({ onDockChange } = {}) {
  bindDockContextMenu();
  bindMenu(onDockChange);
}
