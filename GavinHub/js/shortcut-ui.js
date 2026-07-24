import {
  loadShortcuts,
  upsertShortcut,
  deleteShortcut,
  addShortcutToDock,
  fetchIconFromWeb,
  normalizeUrl,
  renderShortcuts,
  moveShortcut,
  renderIconInto,
  deriveLetterColor,
  deriveLetterLabel,
  letterColorSeed,
  prefetchMissingShortcutIcons,
} from './shortcuts.js';
import { closeDialog as closeModal, openDialog as openModal } from './dialog-ui.js';

let activeShortcutId = null;
let iconManuallySet = false;
let fetchTimer = null;
/** @type {(() => void) | null} */
let shortcutsUiRefresh = null;

export function refreshShortcutsUI() {
  shortcutsUiRefresh?.();
}

function getEls() {
  return {
    dialog: document.getElementById('shortcut-dialog'),
    title: document.getElementById('shortcut-dialog-title'),
    form: document.getElementById('shortcut-form'),
    id: document.getElementById('shortcut-id'),
    url: document.getElementById('shortcut-url'),
    name: document.getElementById('shortcut-name'),
    iconUrl: document.getElementById('shortcut-icon-url'),
    preview: document.getElementById('shortcut-icon-preview'),
    source: document.getElementById('shortcut-icon-source'),
    fetchBtn: document.getElementById('shortcut-fetch-icon'),
    menu: document.getElementById('shortcut-menu'),
  };
}

const ICON_URL_PLACEHOLDER = '自定义图标 URL（可选）';
const LETTER_URL_PLACEHOLDER = '使用字母图标';

function letterPreviewProps(name = '', color, url = '') {
  const trimmed = name.trim();
  const pageUrl = url || getEls().url?.value.trim() || '';
  const seed = letterColorSeed(trimmed, pageUrl);
  return {
    letter: deriveLetterLabel(trimmed, pageUrl),
    name: trimmed,
    url: pageUrl,
    color: color || deriveLetterColor(seed),
  };
}

function renderPreview({ icon, letter, name, color }) {
  const { preview, source, iconUrl } = getEls();
  if (!preview) return;

  preview.className = 'shortcut-icon-preview';

  if (icon) {
    if (iconUrl) iconUrl.placeholder = ICON_URL_PLACEHOLDER;
    renderIconInto(preview, { icon, url: getEls().url?.value.trim(), name, color }, getEls().url?.value.trim());
    if (source) source.textContent = '来自网络';
    return;
  }

  if (iconUrl) iconUrl.placeholder = LETTER_URL_PLACEHOLDER;
  renderIconInto(preview, letterPreviewProps(name, color, getEls().url?.value.trim()));
  if (source) source.textContent = '使用字母图标';
}

async function autoFetchIcon(force = false) {
  const { url, iconUrl, name } = getEls();
  const rawUrl = url?.value.trim();
  if (!rawUrl) return { type: 'letter' };

  if (!force && iconManuallySet && iconUrl?.value.trim()) {
    return { type: 'image', url: iconUrl.value.trim() };
  }

  const { source } = getEls();
  if (source) source.textContent = '获取中…';

  const result = await fetchIconFromWeb(rawUrl);
  const displayName = name?.value.trim() || '';
  const existing = getShortcutById(getEls().id?.value);
  const letterColor = existing?.color || deriveLetterColor(letterColorSeed(displayName, rawUrl));

  if (result.type === 'image') {
    if (iconUrl) {
      iconUrl.value = result.url;
      iconUrl.placeholder = ICON_URL_PLACEHOLDER;
    }
    iconManuallySet = false;
    renderPreview({ icon: result.url, name: displayName, color: letterColor });
    return result;
  }

  if (iconUrl) {
    iconUrl.value = '';
    iconUrl.placeholder = LETTER_URL_PLACEHOLDER;
  }
  iconManuallySet = false;
  renderPreview(letterPreviewProps(displayName, letterColor, rawUrl));
  return result;
}

function scheduleAutoFetch() {
  clearTimeout(fetchTimer);
  fetchTimer = setTimeout(() => autoFetchIcon(), 400);
}

function openDialog(mode, shortcut = null) {
  const { dialog, title, id, url, name, iconUrl } = getEls();
  if (!dialog) return;

  iconManuallySet = false;
  activeShortcutId = shortcut?.id || null;

  if (title) title.textContent = mode === 'create' ? '添加网站途径' : '编辑网站途径';
  if (id) id.value = shortcut?.id || `custom-${Date.now()}`;
  if (url) url.value = shortcut?.url || '';
  if (name) name.value = shortcut?.name || '';
  if (iconUrl) {
    iconUrl.value = shortcut?.icon || '';
    iconUrl.placeholder = shortcut?.icon ? ICON_URL_PLACEHOLDER : LETTER_URL_PLACEHOLDER;
  }

  renderPreview(shortcut?.icon
    ? { icon: shortcut.icon, name: shortcut?.name, color: shortcut?.color }
    : letterPreviewProps(shortcut?.name || '', shortcut?.color, shortcut?.url));

  openModal(dialog);
  if (!shortcut?.icon && url?.value) autoFetchIcon(true);
  else if (shortcut) {
    renderPreview(shortcut.icon
      ? { icon: shortcut.icon, name: shortcut.name, color: shortcut.color }
      : letterPreviewProps(shortcut.name, shortcut.color, shortcut.url));
  }

  requestAnimationFrame(() => (mode === 'create' ? url : name)?.focus());
}

function closeShortcutDialog() {
  closeModal(getEls().dialog);
}

function hideMenu() {
  const { menu } = getEls();
  if (!menu) return;
  menu.hidden = true;
  activeShortcutId = null;
}

function showMenu(shortcut, event) {
  const { menu } = getEls();
  if (!menu) return;

  document.getElementById('dock-menu')?.setAttribute('hidden', '');
  event.stopPropagation();

  activeShortcutId = shortcut.id;
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

function getShortcutById(id) {
  return loadShortcuts().find((s) => s.id === id);
}

function bindDialog(refresh, onDockChange) {
  const els = getEls();
  if (!els.form) return;

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = els.name?.value.trim();
    const url = normalizeUrl(els.url?.value);
    if (!name || !url) return;

    let icon = els.iconUrl?.value.trim();
    const existing = getShortcutById(els.id?.value);
    if (!icon && !iconManuallySet) {
      const result = await autoFetchIcon(true);
      if (result?.type === 'image') icon = result.url;
    }

    const item = {
      id: els.id?.value || `custom-${Date.now()}`,
      name,
      url,
      icon: icon || '',
      letter: icon ? undefined : deriveLetterLabel(name, url),
      color: icon ? undefined : (existing?.color || deriveLetterColor(letterColorSeed(name, url))),
    };

    upsertShortcut(item);
    closeShortcutDialog();
    refresh();
    onDockChange?.();
  });

  els.url?.addEventListener('input', scheduleAutoFetch);
  els.url?.addEventListener('blur', () => autoFetchIcon());

  els.name?.addEventListener('input', () => {
    const icon = els.iconUrl?.value.trim();
    if (!icon) {
      const existing = getShortcutById(els.id?.value);
      renderPreview(letterPreviewProps(els.name.value, existing?.color, els.url?.value.trim()));
    }
  });

  els.iconUrl?.addEventListener('input', () => {
    const val = els.iconUrl.value.trim();
    iconManuallySet = !!val;
    if (val) {
      els.iconUrl.placeholder = ICON_URL_PLACEHOLDER;
      renderPreview({ icon: val, name: els.name?.value });
    } else {
      els.iconUrl.placeholder = LETTER_URL_PLACEHOLDER;
      const existing = getShortcutById(els.id?.value);
      renderPreview(letterPreviewProps(els.name?.value, existing?.color, els.url?.value.trim()));
    }
  });

  els.fetchBtn?.addEventListener('click', async () => {
    iconManuallySet = false;
    if (els.iconUrl) els.iconUrl.value = '';
    await autoFetchIcon(true);
  });

}

function bindMenu(refresh, onDockChange) {
  const { menu } = getEls();
  if (!menu) return;

  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    const btn = e.target.closest('[data-action]');
    if (!btn || !activeShortcutId) return;

    const shortcut = getShortcutById(activeShortcutId);
    if (!shortcut) return hideMenu();

    const action = btn.dataset.action;
    hideMenu();

    if (action === 'edit') openDialog('edit', shortcut);
    if (action === 'delete') {
      deleteShortcut(shortcut.id);
      refresh();
      onDockChange?.();
    }
    if (action === 'dock') {
      const { added } = addShortcutToDock(shortcut);
      if (added) onDockChange?.();
    }
  });

  document.addEventListener('click', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.shortcut-menu')) return;
    hideMenu();
  });
  document.addEventListener('scroll', hideMenu, true);
  window.addEventListener('resize', hideMenu);
}

function bindDragReorder(grid, refresh, onDockChange) {
  const LONG_PRESS_MS = 320;
  const MOVE_CANCEL_PX = 10;
  const MOUSE_START_PX = 5;
  const FLIP_MS = 180;
  const FLIP_EASE = 'cubic-bezier(0.2, 0, 0, 1)';

  let session = null;
  let suppressClick = false;
  let dragFrame = 0;

  function getShortcutItems() {
    return [...grid.querySelectorAll('.shortcut-item:not(.shortcut-add):not(.shortcut-placeholder)')];
  }

  function getLayoutSiblings() {
    return [...grid.querySelectorAll('.shortcut-item:not(.shortcut-add):not(.is-dragging)')];
  }

  function flipAnimate(elements, mutate) {
    const first = new Map(elements.map((el) => [el, el.getBoundingClientRect()]));
    elements.forEach((el) => el._reorderAnimation?.cancel());
    mutate();
    elements.forEach((el) => {
      const prev = first.get(el);
      if (!prev) return;
      const next = el.getBoundingClientRect();
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      el._reorderAnimation = el.animate([
        { transform: `translate3d(${dx}px, ${dy}px, 0)` },
        { transform: 'translate3d(0, 0, 0)' },
      ], {
        duration: FLIP_MS,
        easing: FLIP_EASE,
      });
      el._reorderAnimation.addEventListener('finish', () => {
        delete el._reorderAnimation;
      }, { once: true });
    });
  }

  function getDock() {
    return document.getElementById('dock');
  }

  function dockContainsPoint(clientX, clientY) {
    const dock = getDock();
    if (!dock) return false;
    const rect = dock.getBoundingClientRect();
    const pad = 18;
    return clientX >= rect.left - pad && clientX <= rect.right + pad
      && clientY >= rect.top - pad && clientY <= rect.bottom + pad;
  }

  function getDockInsertIndex(clientX, clientY) {
    const dock = getDock();
    if (!dock) return 0;
    const vertical = getComputedStyle(dock).flexDirection === 'column';
    const links = [...dock.querySelectorAll('.dock-link[data-dock-id]')];
    for (let i = 0; i < links.length; i += 1) {
      const rect = links[i].getBoundingClientRect();
      const before = vertical
        ? clientY < rect.top + rect.height / 2
        : clientX < rect.left + rect.width / 2;
      if (before) return i;
    }
    return links.length;
  }

  function updateDockDropTarget(clientX, clientY) {
    if (!session) return false;
    const dock = getDock();
    const overDock = dockContainsPoint(clientX, clientY);
    session.overDock = overDock;
    if (!dock || !overDock) {
      session.dockPlaceholder?.remove();
      session.dockPlaceholder = null;
      dock?.classList.remove('is-external-drop-target');
      return false;
    }

    const index = getDockInsertIndex(clientX, clientY);
    let placeholder = session.dockPlaceholder;
    if (!placeholder) {
      placeholder = document.createElement('div');
      placeholder.className = 'dock-item dock-link dock-placeholder dock-external-placeholder';
      placeholder.setAttribute('aria-hidden', 'true');
      session.dockPlaceholder = placeholder;
    }
    const links = [...dock.querySelectorAll('.dock-link[data-dock-id]')];
    const reference = links[index] || null;
    if (!placeholder.isConnected || placeholder.nextSibling !== reference) {
      dock.insertBefore(placeholder, reference);
    }
    session.dockInsertIndex = index;
    dock.classList.add('is-external-drop-target');
    requestAnimationFrame(() => placeholder.classList.add('is-visible'));
    return true;
  }

  function clearDockDropTarget(active) {
    active?.dockPlaceholder?.remove();
    if (active) active.dockPlaceholder = null;
    getDock()?.classList.remove('is-external-drop-target');
  }

  function createPlaceholder() {
    const el = document.createElement('div');
    el.className = 'shortcut-item shortcut-placeholder';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="shortcut-icon"></div><span class="shortcut-label"></span>';
    return el;
  }

  function floatItem(item, clientX, clientY) {
    const rect = item.getBoundingClientRect();
    item._grabX = clientX - rect.left;
    item._grabY = clientY - rect.top;
    item._floatLeft = rect.left;
    item._floatTop = rect.top;
    item.style.width = `${rect.width}px`;
    item.style.position = 'fixed';
    item.style.left = `${rect.left}px`;
    item.style.top = `${rect.top}px`;
    item.style.transform = 'translate3d(0, 0, 0)';
    item.style.transition = 'none';
    item.style.willChange = 'transform';
    item.style.zIndex = '100';
    item.style.pointerEvents = 'none';
    item.style.margin = '0';
  }

  function moveFloatedItem(item, clientX, clientY) {
    const x = clientX - item._grabX - item._floatLeft;
    const y = clientY - item._grabY - item._floatTop;
    item.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  function animateFloatedItemTo(item, targetRect) {
    const x = targetRect.left - item._floatLeft;
    const y = targetRect.top - item._floatTop;
    item.style.transition = `transform ${FLIP_MS}ms ${FLIP_EASE}`;
    item.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  function getInsertIndex(clientX, clientY) {
    const siblings = getLayoutSiblings()
      .filter((item) => !item.classList.contains('shortcut-placeholder'));
    if (!siblings.length) return 0;

    for (let i = 0; i < siblings.length; i += 1) {
      const rect = siblings[i].getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        continue;
      }
      const midX = rect.left + rect.width / 2;
      const midY = rect.top + rect.height / 2;
      if (clientY < midY || (Math.abs(clientY - midY) <= 4 && clientX < midX)) {
        return i;
      }
      return i + 1;
    }

    const gridRect = grid.getBoundingClientRect();
    const sample = siblings[0].getBoundingClientRect();
    const style = getComputedStyle(grid);
    const colGap = parseFloat(style.columnGap) || 0;
    const rowGap = parseFloat(style.rowGap) || 0;
    const cellW = sample.width + colGap;
    const cellH = sample.height + rowGap;

    const relX = clientX - gridRect.left;
    const relY = clientY - gridRect.top + grid.scrollTop;
    const gridCols = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').length);
    const col = Math.max(0, Math.min(gridCols - 1, Math.floor(relX / cellW)));
    const row = Math.max(0, Math.floor(relY / cellH));
    const index = row * gridCols + col;

    return Math.max(0, Math.min(index, siblings.length));
  }

  function movePlaceholder(toIndex) {
    const placeholder = session?.placeholder;
    if (!placeholder) return;

    const siblings = getLayoutSiblings();
    const currentIndex = siblings.indexOf(placeholder);
    if (currentIndex === toIndex) return;

    const animItems = siblings.filter((el) => el !== placeholder);
    flipAnimate(animItems, () => {
      placeholder.remove();
      const remaining = [...grid.querySelectorAll(
        '.shortcut-item:not(.shortcut-add):not(.is-dragging):not(.shortcut-placeholder)',
      )];
      const addBtn = grid.querySelector('.shortcut-add');
      const ref = toIndex >= remaining.length ? addBtn : remaining[toIndex];
      grid.insertBefore(placeholder, ref);
    });
    session.insertIndex = toIndex;
  }

  function cleanupDragStyles() {
    grid.classList.remove('is-reordering');
    grid.querySelectorAll('.shortcut-item:not(.shortcut-add)').forEach((el) => {
      el._reorderAnimation?.cancel();
      delete el._reorderAnimation;
      el.style.transition = '';
      el.style.transform = '';
    });
  }

  function resetItemStyles(item) {
    if (!item) return;
    item.classList.remove('is-dragging');
    item.style.position = '';
    item.style.left = '';
    item.style.top = '';
    item.style.width = '';
    item.style.zIndex = '';
    item.style.pointerEvents = '';
    item.style.margin = '';
    item.style.transition = '';
    item.style.transform = '';
    item.style.willChange = '';
    delete item._grabX;
    delete item._grabY;
    delete item._floatLeft;
    delete item._floatTop;
  }

  function clearSession(animateBack = false) {
    if (!session) return;

    cancelAnimationFrame(dragFrame);
    dragFrame = 0;

    if (session.timer) {
      clearTimeout(session.timer);
    }

    document.removeEventListener('pointermove', session.onMove);
    document.removeEventListener('pointerup', session.onUp);
    document.removeEventListener('pointercancel', session.onUp);

    const current = session;
    const { item, placeholder, active } = current;
    session = null;
    clearDockDropTarget(current);

    if (!active && !placeholder) return;

    if (animateBack && placeholder?.isConnected) {
      const targetRect = placeholder.getBoundingClientRect();
      animateFloatedItemTo(item, targetRect);
      item.classList.remove('is-dragging');

      setTimeout(() => {
        placeholder.remove();
        resetItemStyles(item);
        cleanupDragStyles();
      }, FLIP_MS);
      return;
    }

    placeholder?.remove();
    resetItemStyles(item);
    cleanupDragStyles();
  }

  function activateSession(clientX, clientY) {
    if (!session || session.active) return;
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }
    session.active = true;
    session.fromIndex = getShortcutItems().indexOf(session.item);
    session.insertIndex = session.fromIndex;

    const placeholder = createPlaceholder();
    session.placeholder = placeholder;
    floatItem(session.item, session.startX, session.startY);
    grid.insertBefore(placeholder, session.item);
    session.item.classList.add('is-dragging');
    grid.classList.add('is-reordering');
    moveFloatedItem(session.item, clientX, clientY);
  }

  function updateDragPosition(clientX, clientY) {
    if (!session?.active) return;
    moveFloatedItem(session.item, clientX, clientY);
    if (updateDockDropTarget(clientX, clientY)) return;
    movePlaceholder(getInsertIndex(clientX, clientY));
  }

  function scheduleDragPosition(clientX, clientY) {
    if (!session) return;
    session.latestX = clientX;
    session.latestY = clientY;
    if (dragFrame) return;
    dragFrame = requestAnimationFrame(() => {
      dragFrame = 0;
      if (!session) return;
      updateDragPosition(session.latestX, session.latestY);
    });
  }

  function onMove(e) {
    if (!session || e.pointerId !== session.pointerId) return;

    if (!session.active) {
      const dx = e.clientX - session.startX;
      const dy = e.clientY - session.startY;
      const distance = Math.hypot(dx, dy);
      if (session.pointerType === 'mouse' || session.pointerType === 'pen') {
        if (distance >= MOUSE_START_PX) activateSession(e.clientX, e.clientY);
      } else if (distance > MOVE_CANCEL_PX) {
        clearSession();
      }
      if (!session?.active) return;
    }

    e.preventDefault();
    scheduleDragPosition(e.clientX, e.clientY);
  }

  function onUp(e) {
    if (!session || e.pointerId !== session.pointerId) return;

    if (!session.active) {
      clearSession();
      return;
    }

    e.preventDefault();

    cancelAnimationFrame(dragFrame);
    dragFrame = 0;
    updateDragPosition(e.clientX, e.clientY);

    if (session.overDock && session.dockPlaceholder) {
      const active = session;
      const targetRect = active.dockPlaceholder.getBoundingClientRect();
      suppressClick = true;
      document.removeEventListener('pointermove', active.onMove);
      document.removeEventListener('pointerup', active.onUp);
      document.removeEventListener('pointercancel', active.onUp);
      session = null;

      animateFloatedItemTo(active.item, targetRect);
      active.item.classList.remove('is-dragging');
      window.setTimeout(() => {
        const shortcut = loadShortcuts().find((item) => item.id === active.id);
        if (shortcut) addShortcutToDock(shortcut, { index: active.dockInsertIndex });
        clearDockDropTarget(active);
        active.placeholder?.remove();
        resetItemStyles(active.item);
        cleanupDragStyles();
        refresh();
        onDockChange?.();
        window.setTimeout(() => { suppressClick = false; }, 80);
      }, FLIP_MS);
      return;
    }

    const fromId = session.id;
    const fromIndex = session.fromIndex;
    const toIndex = session.insertIndex ?? fromIndex;
    const shouldMove = toIndex !== fromIndex;

    suppressClick = true;

    if (shouldMove) {
      const { item, placeholder } = session;
      const targetRect = placeholder.getBoundingClientRect();

      animateFloatedItemTo(item, targetRect);
      item.classList.remove('is-dragging');

      document.removeEventListener('pointermove', session.onMove);
      document.removeEventListener('pointerup', session.onUp);
      document.removeEventListener('pointercancel', session.onUp);
      session = null;

      setTimeout(() => {
        placeholder?.remove();
        resetItemStyles(item);
        cleanupDragStyles();
        moveShortcut(fromId, toIndex);
        refresh();
        window.setTimeout(() => { suppressClick = false; }, 80);
      }, FLIP_MS);
      return;
    }

    clearSession(true);
    setTimeout(() => {
      suppressClick = false;
    }, 0);
  }

  grid.addEventListener('contextmenu', (e) => {
    if (!grid.classList.contains('is-reordering') && !suppressClick) return;
    if (e.target.closest('.shortcut-item:not(.shortcut-add)')) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  grid.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;

    const item = e.target.closest('.shortcut-item:not(.shortcut-add)');
    if (!item || !grid.contains(item)) return;

    clearSession();

    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;

    session = {
      item,
      id: item.dataset.id,
      pointerId,
      pointerType: e.pointerType || 'mouse',
      startX,
      startY,
      active: false,
      onMove,
      onUp,
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);

    if (session.pointerType !== 'mouse' && session.pointerType !== 'pen') {
      session.timer = setTimeout(() => {
        if (!session || session.pointerId !== pointerId) return;
        activateSession(session.startX, session.startY);
      }, LONG_PRESS_MS);
    }
  });

  grid.addEventListener('click', (e) => {
    if (!suppressClick) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    suppressClick = false;
  }, true);
}

export function initShortcutsUI({ onDockChange } = {}) {
  const grid = document.getElementById('shortcuts-grid');
  if (!grid) return;

  const refresh = () => {
    renderShortcuts(grid, loadShortcuts(), {
      onAdd: () => openDialog('create'),
      onContextMenu: (item, e) => showMenu(item, e),
    });
  };
  shortcutsUiRefresh = refresh;

  const updateShortcutIcon = (item) => {
    const iconEl = grid.querySelector(`.shortcut-item[data-id="${item.id}"] .shortcut-icon`);
    if (iconEl) renderIconInto(iconEl, item);
  };

  bindDragReorder(grid, refresh, onDockChange);
  bindDialog(refresh, onDockChange);
  bindMenu(refresh, onDockChange);
  refresh();

  const prefetchIcons = () => {
    if (document.hidden || navigator.connection?.saveData) return;
    prefetchMissingShortcutIcons({
      onItemUpdated: (item) => updateShortcutIcon(item),
    }).then(({ fetched }) => {
      if (fetched > 0) onDockChange?.();
    });
  };
  if ('requestIdleCallback' in window) {
    requestIdleCallback(prefetchIcons, { timeout: 2000 });
  } else {
    setTimeout(prefetchIcons, 600);
  }
}
