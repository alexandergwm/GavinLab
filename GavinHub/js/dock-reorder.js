const DRAG_START_PX = 5;
const TOUCH_CANCEL_PX = 10;
const TOUCH_HOLD_MS = 320;
const SETTLE_MS = 180;

function isVerticalDock(dock) {
  return getComputedStyle(dock).flexDirection === 'column';
}

function resetItem(item) {
  if (!item) return;
  item.classList.remove('is-dragging');
  for (const prop of [
    'position', 'left', 'top', 'width', 'height', 'margin', 'zIndex',
    'pointerEvents', 'transition', 'transform', 'willChange',
  ]) item.style[prop] = '';
}

export function bindDockReorder(dock, { onCommit } = {}) {
  if (!dock || dock.dataset.reorderBound === '1') return;
  dock.dataset.reorderBound = '1';

  let session = null;
  let suppressClick = false;

  const links = () => [...dock.querySelectorAll('.dock-link[data-dock-id]:not(.is-dragging)')];

  function removeDocumentListeners(active) {
    document.removeEventListener('pointermove', active.onMove);
    document.removeEventListener('pointerup', active.onUp);
    document.removeEventListener('pointercancel', active.onUp);
  }

  function clear(active = session) {
    if (!active) return;
    clearTimeout(active.timer);
    removeDocumentListeners(active);
    active.placeholder?.replaceWith(active.item);
    resetItem(active.item);
    dock.classList.remove('is-reordering');
    if (session === active) session = null;
  }

  function activate(active, clientX, clientY) {
    if (!active || active.active) return;
    clearTimeout(active.timer);
    active.timer = 0;
    active.active = true;

    const rect = active.item.getBoundingClientRect();
    active.originLeft = rect.left;
    active.originTop = rect.top;
    active.grabX = active.startX - rect.left;
    active.grabY = active.startY - rect.top;

    const placeholder = document.createElement('div');
    placeholder.className = 'dock-item dock-link dock-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    active.placeholder = placeholder;

    Object.assign(active.item.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: '0',
      zIndex: '120',
      pointerEvents: 'none',
      transition: 'none',
      willChange: 'transform',
    });
    dock.insertBefore(placeholder, active.item);
    dock.appendChild(active.item);
    active.item.classList.add('is-dragging');
    dock.classList.add('is-reordering');
    moveFloated(active, clientX, clientY);
  }

  function moveFloated(active, clientX, clientY) {
    const x = clientX - active.grabX - active.originLeft;
    const y = clientY - active.grabY - active.originTop;
    active.item.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  function movePlaceholder(active, clientX, clientY) {
    const vertical = isVerticalDock(dock);
    const candidates = links().filter((item) => item !== active.placeholder);
    for (const item of candidates) {
      const rect = item.getBoundingClientRect();
      const withinCrossAxis = vertical
        ? clientX >= rect.left - 18 && clientX <= rect.right + 18
        : clientY >= rect.top - 18 && clientY <= rect.bottom + 18;
      if (!withinCrossAxis) continue;
      const before = vertical
        ? clientY < rect.top + rect.height / 2
        : clientX < rect.left + rect.width / 2;
      const reference = before ? item : item.nextSibling;
      if (reference !== active.placeholder && active.placeholder.nextSibling !== reference) {
        dock.insertBefore(active.placeholder, reference);
      }
      return;
    }
    const last = candidates.at(-1);
    if (!last) return;
    const rect = last.getBoundingClientRect();
    const afterLast = vertical
      ? clientY >= rect.top + rect.height / 2
      : clientX >= rect.left + rect.width / 2;
    if (afterLast) dock.insertBefore(active.placeholder, active.item);
  }

  function onMove(event) {
    const active = session;
    if (!active || event.pointerId !== active.pointerId) return;
    const distance = Math.hypot(event.clientX - active.startX, event.clientY - active.startY);
    if (!active.active) {
      if (active.pointerType === 'mouse' || active.pointerType === 'pen') {
        if (distance >= DRAG_START_PX) activate(active, event.clientX, event.clientY);
      } else if (distance > TOUCH_CANCEL_PX) {
        clear(active);
      }
      if (!active.active) return;
    }
    event.preventDefault();
    moveFloated(active, event.clientX, event.clientY);
    movePlaceholder(active, event.clientX, event.clientY);
  }

  function onUp(event) {
    const active = session;
    if (!active || event.pointerId !== active.pointerId) return;
    if (!active.active) {
      clear(active);
      return;
    }
    event.preventDefault();
    suppressClick = true;
    removeDocumentListeners(active);
    session = null;

    const target = active.placeholder.getBoundingClientRect();
    active.item.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0, 0, 1)`;
    active.item.style.transform = `translate3d(${target.left - active.originLeft}px, ${target.top - active.originTop}px, 0)`;
    window.setTimeout(() => {
      active.placeholder.replaceWith(active.item);
      resetItem(active.item);
      dock.classList.remove('is-reordering');
      const ids = [...dock.querySelectorAll('.dock-link[data-dock-id]')]
        .map((item) => item.dataset.dockId);
      onCommit?.(ids);
      window.setTimeout(() => { suppressClick = false; }, 80);
    }, SETTLE_MS);
  }

  dock.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const item = event.target.closest('.dock-link[data-dock-id]');
    if (!item || !dock.contains(item)) return;
    clear();
    const active = {
      item,
      pointerId: event.pointerId,
      pointerType: event.pointerType || 'mouse',
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      onMove,
      onUp,
      timer: 0,
    };
    session = active;
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    if (active.pointerType !== 'mouse' && active.pointerType !== 'pen') {
      active.timer = window.setTimeout(() => activate(active, active.startX, active.startY), TOUCH_HOLD_MS);
    }
  });

  dock.addEventListener('click', (event) => {
    if (!suppressClick) return;
    if (event.target.closest('.dock-link[data-dock-id]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    suppressClick = false;
  }, true);
}
