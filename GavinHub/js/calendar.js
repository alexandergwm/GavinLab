import { formatLunarDateShort, getLunarDetail, toDateKey as lunarToDateKey } from './lunar.js';
import { getHolidayInfo, isMakeupWorkday } from './holidays.js';
import { escapeHtml } from './util.js';
import { KEYS } from './keys.js';
import { readJson, writeJson } from './storage.js';
import {
  loadCountdowns,
  addCountdown,
  removeCountdown,
  getCountdownLabel,
  getAnniversaryLabel,
  formatEventDate,
  defaultDateInputValue,
} from './countdowns.js';
import {
  loadTodos,
  addTodo,
  moveTodo,
  resizeTodoEnd,
  toggleTodo,
  removeTodo,
  updateTodo,
  getTodoById,
  getTodosInWeek,
  getExpandedTodosOnDate,
  eventWeekLayout,
  assignEventRows,
  toDateKey,
  addDays,
  weekSaturdayKey,
  parseDateKey,
  TODO_CATEGORIES,
  getCategoryById,
  isRecurringTodo,
} from './todos.js';

let viewWeekStart = new Date();
let viewMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let viewMode = 'week';
let dayMenuDateKey = null;

const WEEK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const DOW_SHORT = ['日', '一', '二', '三', '四', '五', '六'];
const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IMPORTANT_KEY = KEYS.importantDates;

function getWeekStart(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekDays(weekStart) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function loadImportantDates() {
  const raw = readJson(IMPORTANT_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item?.dateKey);
}

function saveImportantDates(items) {
  writeJson(IMPORTANT_KEY, items);
}

function getImportantDatesMap() {
  const map = new Map();
  for (const item of loadImportantDates()) {
    map.set(item.dateKey, item);
  }
  return map;
}

function isImportantDate(dateKey) {
  return getImportantDatesMap().has(dateKey);
}

function toggleImportantDate(dateKey) {
  const items = loadImportantDates();
  const idx = items.findIndex((i) => i.dateKey === dateKey);
  if (idx >= 0) items.splice(idx, 1);
  else items.push({ dateKey, label: '' });
  saveImportantDates(items);
}

function getTodosOnDate(dateKey) {
  return getExpandedTodosOnDate(dateKey);
}

const MAX_MONTH_TODO_ITEMS = 3;

function abbreviateTodoText(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return '…';
  const firstWord = trimmed.split(/[\s\u3000]+/)[0];
  if (firstWord.length <= 6) return firstWord;
  return `${trimmed.slice(0, 5)}…`;
}

function sortTodosForMonth(todos) {
  return [...todos].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return parseDateKey(a.startDate) - parseDateKey(b.startDate);
  });
}

function getMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(start.getDate() - start.getDay());
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    cells.push(d);
  }
  if (cells[35].getMonth() !== month && cells[28].getMonth() !== month) {
    return cells.slice(0, 28);
  }
  if (cells[35].getMonth() !== month) {
    return cells.slice(0, 35);
  }
  return cells;
}

function updateToolbarForView() {
  const toggle = document.getElementById('cal-view-toggle');
  const prevBtn = document.getElementById('cal-prev-week');
  const nextBtn = document.getElementById('cal-next-week');
  if (toggle) {
    toggle.textContent = viewMode === 'month' ? '周' : '月';
    toggle.title = viewMode === 'month' ? '切换到周视图' : '切换到月视图';
    toggle.setAttribute('aria-label', toggle.title);
    toggle.classList.toggle('is-active', viewMode === 'month');
  }
  if (prevBtn) prevBtn.setAttribute('aria-label', viewMode === 'month' ? '上一月' : '上一周');
  if (nextBtn) nextBtn.setAttribute('aria-label', viewMode === 'month' ? '下一月' : '下一周');
}

function updateCalendarTitle(date, lunarInfoEl) {
  const title = document.getElementById('cal-title');
  const lunarInfo = lunarInfoEl || document.getElementById('cal-lunar-info');
  const lunar = getLunarDetail(new Date());

  if (title) {
    title.textContent = `${MONTH_EN[date.getMonth()]} ${date.getFullYear()}`;
  }
  if (lunarInfo) {
    lunarInfo.textContent = `今天 ${lunar.text} · ${lunar.ganZhiYear}`;
  }
}

function hideDayMenu() {
  const menu = document.getElementById('cal-day-menu');
  if (menu) menu.hidden = true;
  dayMenuDateKey = null;
}

function showDayMenu(dateKey, x, y) {
  const menu = document.getElementById('cal-day-menu');
  if (!menu) return;
  dayMenuDateKey = dateKey;
  const toggleBtn = menu.querySelector('[data-action="important-toggle"]');
  if (toggleBtn) {
    toggleBtn.textContent = isImportantDate(dateKey) ? '取消重要' : '标记为重要';
  }
  menu.hidden = false;
  menu.style.left = `${Math.min(x, window.innerWidth - 160)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 100)}px`;
}

function gotoWeekForDate(dateKey) {
  viewWeekStart = parseDateKey(dateKey);
  viewMode = 'week';
  renderCalendar();
}

function bindMonthCells(container) {
  container.querySelectorAll('.month-day-cell').forEach((cell) => {
    let pressTimer = null;
    let longPressTriggered = false;

    cell.addEventListener('click', (e) => {
      e.preventDefault();
      const todoEl = e.target.closest('.month-todo-item');
      if (todoEl) {
        if (longPressTriggered) {
          longPressTriggered = false;
          return;
        }
        openTodoDetail(Number(todoEl.dataset.todoId), todoEl.dataset.todoInstance || null);
        return;
      }
      if (longPressTriggered) {
        longPressTriggered = false;
        return;
      }
      gotoWeekForDate(cell.dataset.date);
    });

    cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showDayMenu(cell.dataset.date, e.clientX, e.clientY);
    });

    cell.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      longPressTriggered = false;
      pressTimer = setTimeout(() => {
        longPressTriggered = true;
        showDayMenu(cell.dataset.date, e.clientX, e.clientY);
      }, 500);
    });

    const clearPress = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    };
    cell.addEventListener('pointerup', clearPress);
    cell.addEventListener('pointercancel', clearPress);
    cell.addEventListener('pointerleave', clearPress);
  });
}

function renderMonthCell(date, viewMonth, todayKey, importantMap) {
  const key = toDateKey(date);
  const isOtherMonth = date.getMonth() !== viewMonth;
  const isToday = key === todayKey;
  const holiday = getHolidayInfo(key);
  const isMakeup = isMakeupWorkday(key);
  const important = importantMap.get(key);
  const todos = getTodosOnDate(key);
  const lunar = formatLunarDateShort(date);

  const classes = [
    'month-day-cell',
    isOtherMonth && 'is-other-month',
    isToday && 'is-today',
    holiday && 'is-holiday',
    isMakeup && 'is-makeup-workday',
    important && 'is-important',
  ].filter(Boolean).join(' ');

  const sortedTodos = sortTodosForMonth(todos);
  const visibleTodos = sortedTodos.slice(0, MAX_MONTH_TODO_ITEMS);
  const overflowCount = sortedTodos.length - visibleTodos.length;
  const todoItems = visibleTodos.map((todo) => {
    const cat = getCategoryById(todo.category);
    const abbr = abbreviateTodoText(todo.text);
    const doneClass = todo.done ? ' is-done' : '';
    const instanceAttr = todo._instanceDate ? ` data-todo-instance="${todo._instanceDate}"` : '';
    const masterId = todo._masterId ?? todo.id;
    return `<span class="month-todo-item month-todo-item--${cat.id}${doneClass}" data-todo-id="${masterId}"${instanceAttr} title="${escapeHtml(todo.text)}">${escapeHtml(abbr)}</span>`;
  }).join('');
  const overflowHtml = overflowCount > 0
    ? `<span class="month-todo-overflow">+${overflowCount}</span>`
    : '';

  return `
    <button type="button" class="${classes}" data-date="${key}" aria-label="${date.getMonth() + 1}月${date.getDate()}日">
      <span class="month-day-top">
        <span class="month-day-num">${date.getDate()}</span>
        ${important ? '<span class="month-day-star" aria-hidden="true">★</span>' : ''}
      </span>
      <span class="month-day-lunar">${lunar}</span>
      ${holiday ? `<span class="month-day-holiday">${holiday.short}</span>` : ''}
      ${isMakeup ? '<span class="month-day-makeup">班</span>' : ''}
      ${todos.length ? `<div class="month-day-todos">${todoItems}${overflowHtml}</div>` : ''}
    </button>
  `;
}

function renderMonthCalendar() {
  const container = document.getElementById('week-calendar');
  if (!container) return;

  container.className = 'month-calendar';

  const year = viewMonthStart.getFullYear();
  const month = viewMonthStart.getMonth();
  const cells = getMonthGrid(year, month);
  const todayKey = lunarToDateKey(new Date());
  const importantMap = getImportantDatesMap();

  updateCalendarTitle(viewMonthStart);

  container.innerHTML = `
    <div class="month-cal-head">
      ${DOW_SHORT.map((d) => `<span class="month-cal-dow">${d}</span>`).join('')}
    </div>
    <div class="month-cal-grid">
      ${cells.map((d) => renderMonthCell(d, month, todayKey, importantMap)).join('')}
    </div>
  `;

  bindMonthCells(container);
}

function renderCalendar() {
  updateToolbarForView();
  if (viewMode === 'month') renderMonthCalendar();
  else renderWeekCalendar();
  renderSidePanel();
}

function renderSidePanelList(items, kind, labelFn) {
  if (!items.length) {
    return `<p class="cal-side-empty">暂无${kind === 'countdown' ? '倒计时' : '纪念日'}</p>`;
  }
  return `<ul class="cal-side-list">
    ${items.map((item) => `
      <li class="cal-side-item cal-side-item--${kind}">
        <div class="cal-side-item-main">
          <span class="cal-side-item-name">${escapeHtml(item.name)}</span>
          <span class="cal-side-item-date">${formatEventDate(item.date, kind)}</span>
        </div>
        <span class="cal-side-item-badge">${labelFn(item.date)}</span>
        <button type="button" class="cal-side-item-delete" data-id="${item.id}" aria-label="删除">×</button>
      </li>
    `).join('')}
  </ul>`;
}

function renderSidePanel() {
  const panel = document.getElementById('cal-side-panel');
  if (!panel) return;

  const items = loadCountdowns();
  const countdowns = items.filter((item) => item.kind === 'countdown');
  const anniversaries = items.filter((item) => item.kind === 'anniversary');

  panel.innerHTML = `
    <section class="cal-side-section">
      <div class="cal-side-section-head">
        <h3 class="cal-side-heading">倒计时</h3>
        <button type="button" class="cal-side-add" data-kind="countdown" aria-label="添加倒计时">+</button>
      </div>
      ${renderSidePanelList(countdowns, 'countdown', getCountdownLabel)}
      <form class="cal-side-form" data-kind="countdown" hidden>
        <input type="text" class="cal-side-input" placeholder="事件名称" maxlength="40" required>
        <input type="date" class="cal-side-date" value="${defaultDateInputValue('countdown')}" required>
        <div class="cal-side-form-actions">
          <button type="button" class="cal-side-cancel">取消</button>
          <button type="submit" class="cal-side-submit">添加</button>
        </div>
      </form>
    </section>
    <section class="cal-side-section">
      <div class="cal-side-section-head">
        <h3 class="cal-side-heading">纪念日</h3>
        <button type="button" class="cal-side-add" data-kind="anniversary" aria-label="添加纪念日">+</button>
      </div>
      ${renderSidePanelList(anniversaries, 'anniversary', getAnniversaryLabel)}
      <form class="cal-side-form" data-kind="anniversary" hidden>
        <input type="text" class="cal-side-input" placeholder="名称" maxlength="40" required>
        <input type="date" class="cal-side-date" value="${defaultDateInputValue('anniversary')}" required>
        <div class="cal-side-form-actions">
          <button type="button" class="cal-side-cancel">取消</button>
          <button type="submit" class="cal-side-submit">添加</button>
        </div>
      </form>
    </section>
  `;

  bindSidePanel(panel);
}

function bindSidePanel(panel) {
  panel.querySelectorAll('.cal-side-add').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.kind;
      panel.querySelectorAll('.cal-side-form').forEach((form) => {
        form.hidden = form.dataset.kind !== kind ? true : !form.hidden;
      });
      const form = panel.querySelector(`.cal-side-form[data-kind="${kind}"]`);
      if (form && !form.hidden) {
        form.querySelector('.cal-side-input')?.focus();
      }
    });
  });

  panel.querySelectorAll('.cal-side-form').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = form.querySelector('.cal-side-input')?.value.trim();
      const date = form.querySelector('.cal-side-date')?.value;
      if (!name || !date) return;
      addCountdown({ name, date, kind: form.dataset.kind });
      renderSidePanel();
    });

    form.querySelector('.cal-side-cancel')?.addEventListener('click', () => {
      form.hidden = true;
    });
  });

  panel.querySelectorAll('.cal-side-item-delete').forEach((btn) => {
    btn.addEventListener('click', () => {
      removeCountdown(Number(btn.dataset.id));
      renderSidePanel();
    });
  });
}

function initSidePanel() {
  renderSidePanel();
}

function toggleViewMode() {
  if (viewMode === 'week') {
    viewMode = 'month';
    const ws = getWeekStart(viewWeekStart);
    viewMonthStart = new Date(ws.getFullYear(), ws.getMonth(), 1);
  } else {
    viewMode = 'week';
  }
  renderCalendar();
}

const COMPOSE_ROW_HEIGHT = 72;

function getColumnIndex(dateKey, weekStartKey) {
  const ws = parseDateKey(weekStartKey).getTime();
  const col = Math.floor((parseDateKey(dateKey).getTime() - ws) / 86400000);
  return col >= 0 && col <= 6 ? col : -1;
}

function countColumnEventRows(events, weekStartKey, dateKey) {
  const colIndex = getColumnIndex(dateKey, weekStartKey);
  if (colIndex < 0) return 0;
  const inCol = events.filter((ev) => {
    const layout = eventWeekLayout(ev, weekStartKey);
    if (!layout) return false;
    return colIndex >= layout.startCol && colIndex < layout.startCol + layout.span;
  });
  if (!inCol.length) return 0;
  return Math.max(...inCol.map((ev) => ev._row)) + 1;
}

function positionComposePanel(compose, container, dateKey, weekStartKey, events) {
  const layer = container.querySelector('.week-compose-layer');
  const colIndex = getColumnIndex(dateKey, weekStartKey);
  if (!layer || colIndex < 0) return;

  layer.appendChild(compose);
  const eventRows = countColumnEventRows(events, weekStartKey, dateKey);
  const topPx = eventRows * COMPOSE_ROW_HEIGHT + 8;
  const colPct = (colIndex / 7) * 100;
  const widthPct = 100 / 7;

  compose.style.top = `${topPx}px`;
  compose.style.left = `calc(${colPct}% + 6px)`;
  compose.style.width = `calc(${widthPct}% - 12px)`;
  compose.style.right = 'auto';
  compose.style.bottom = 'auto';
}

function closeAllComposers(container) {
  container.querySelectorAll('.week-day-compose').forEach((el) => {
    el.hidden = true;
    el.style.top = '';
    el.style.left = '';
    el.style.width = '';
    el.style.right = '';
    el.style.bottom = '';
    const body = container.querySelector(`.week-day-body[data-date="${el.dataset.dateKey}"]`);
    if (body && !body.contains(el)) body.appendChild(el);
  });
  container.querySelectorAll('.week-day-body.is-composing').forEach((el) => {
    el.classList.remove('is-composing');
  });
}

function openComposer(body, container, weekStartKey, events) {
  closeAllComposers(container);
  const dateKey = body.dataset.date;
  const compose = body.querySelector('.week-day-compose');
  const input = body.querySelector('.week-day-input');
  if (!compose || !input) return;
  compose.dataset.dateKey = dateKey;
  body.classList.add('is-composing');
  positionComposePanel(compose, container, dateKey, weekStartKey, events);
  compose.hidden = false;
  input.value = '';
  const repeatWeekly = compose.querySelector('.week-compose-repeat');
  const repeatDaily = compose.querySelector('.week-compose-daily');
  if (repeatWeekly) repeatWeekly.checked = false;
  if (repeatDaily) repeatDaily.checked = false;
  const firstColor = compose.querySelector('input[type="radio"]');
  if (firstColor) firstColor.checked = true;
  requestAnimationFrame(() => input.focus());
}

function submitComposer(dateKey, compose) {
  const input = compose.querySelector('.week-day-input');
  const category = compose.querySelector('input[type="radio"]:checked')?.value;
  const weeklyRepeat = compose.querySelector('.week-compose-repeat')?.checked;
  const dailyRepeat = compose.querySelector('.week-compose-daily')?.checked;
  const text = input?.value.trim();
  if (!text) {
    input?.focus();
    return;
  }

  let recurrence;
  let weekdays;
  if (dailyRepeat) {
    recurrence = 'daily';
  } else if (weeklyRepeat) {
    recurrence = 'weekly';
    weekdays = [parseDateKey(dateKey).getDay()];
  }

  addTodo({ text, startDate: dateKey, category, recurrence, weekdays });
  compose.hidden = true;
  const container = document.getElementById('week-calendar');
  container?.querySelector(`.week-day-body[data-date="${dateKey}"]`)?.classList.remove('is-composing');
  renderCalendar();
}

function bindComposer(body, container, weekStartKey, events) {
  const dateKey = body.dataset.date;
  const compose = body.querySelector('.week-day-compose');
  const head = container.querySelector(`.week-day-header[data-date="${dateKey}"]`);
  const addBtn = head?.querySelector('.week-day-add');
  const input = body.querySelector('.week-day-input');
  if (compose) compose.dataset.dateKey = dateKey;

  addBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (compose?.hidden) openComposer(body, container, weekStartKey, events);
    else {
      compose.hidden = true;
      body.classList.remove('is-composing');
    }
  });

  compose?.querySelector('.week-compose-submit')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    submitComposer(dateKey, compose);
  });

  compose?.querySelector('.week-compose-cancel')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    compose.hidden = true;
    body.classList.remove('is-composing');
  });

  input?.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      submitComposer(dateKey, compose);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      compose.hidden = true;
      body.classList.remove('is-composing');
    }
  });

  compose?.addEventListener('click', (e) => e.stopPropagation());
}

function confirmRecurrenceScope(message) {
  return window.confirm(`${message}\n\n确定 = 全部重复\n取消 = 仅此次`);
}

function openTodoDetail(todoId, instanceDate = null) {
  const todo = getTodoById(todoId, instanceDate);
  const dialog = document.getElementById('todo-detail-dialog');
  if (!todo || !dialog) return;

  document.getElementById('todo-detail-id').value = String(todo._masterId ?? todo.id);
  document.getElementById('todo-detail-instance').value = todo._instanceDate || '';
  document.getElementById('todo-detail-title').value = todo.text;
  document.getElementById('todo-detail-start').value = todo.startDate;
  document.getElementById('todo-detail-end').value = todo.endDate;
  document.getElementById('todo-detail-done').checked = !!todo.done;
  document.getElementById('todo-detail-notes').value = todo.notes || '';

  const recurrenceEl = document.getElementById('todo-detail-recurrence');
  if (recurrenceEl) {
    const master = getTodoById(todo._masterId ?? todo.id);
    if (isRecurringTodo(master) && !instanceDate) {
      const label = master.recurrence === 'daily'
        ? '每天重复'
        : `每周重复（${(master.weekdays || []).map((d) => DOW_SHORT[d]).join('、')}）`;
      recurrenceEl.textContent = label;
      recurrenceEl.hidden = false;
    } else if (isRecurringTodo(master) && instanceDate) {
      recurrenceEl.textContent = '重复事项 · 此次实例';
      recurrenceEl.hidden = false;
    } else {
      recurrenceEl.hidden = true;
    }
  }

  const categoryInput = dialog.querySelector(`input[name="todo-detail-category"][value="${todo.category}"]`);
  if (categoryInput) categoryInput.checked = true;

  dialog.showModal();
  requestAnimationFrame(() => document.getElementById('todo-detail-title')?.focus());
}

function initTodoDetailDialog() {
  const dialog = document.getElementById('todo-detail-dialog');
  const form = document.getElementById('todo-detail-form');
  if (!dialog || !form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = Number(document.getElementById('todo-detail-id').value);
    const instanceDate = document.getElementById('todo-detail-instance').value || null;
    const master = getTodoById(id);
    const text = document.getElementById('todo-detail-title').value.trim();
    if (!text) {
      document.getElementById('todo-detail-title').focus();
      return;
    }
    const startDate = document.getElementById('todo-detail-start').value;
    const endDate = document.getElementById('todo-detail-end').value;
    const done = document.getElementById('todo-detail-done').checked;
    const category = dialog.querySelector('input[name="todo-detail-category"]:checked')?.value;
    const notes = document.getElementById('todo-detail-notes').value;

    const patch = { text, startDate, endDate, done, category, notes };
    if (isRecurringTodo(master) && instanceDate) {
      const allScope = confirmRecurrenceScope('保存修改范围？');
      if (allScope) {
        updateTodo(id, patch, 'all');
      } else {
        updateTodo(id, patch, 'once', instanceDate);
      }
    } else {
      updateTodo(id, patch);
    }
    dialog.close();
    renderCalendar();
  });

  document.getElementById('todo-detail-delete')?.addEventListener('click', () => {
    const id = Number(document.getElementById('todo-detail-id').value);
    const instanceDate = document.getElementById('todo-detail-instance').value || null;
    if (!id) return;
    const master = getTodoById(id);
    if (isRecurringTodo(master) && instanceDate) {
      const allScope = confirmRecurrenceScope('删除范围？');
      removeTodo(id, allScope ? 'all' : 'once', instanceDate);
    } else {
      removeTodo(id);
    }
    dialog.close();
    renderCalendar();
  });

  dialog.querySelector('.todo-detail-close')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}

function getGridMetrics(gridEl) {
  const styles = getComputedStyle(gridEl);
  const padL = parseFloat(styles.paddingLeft) || 0;
  const padR = parseFloat(styles.paddingRight) || 0;
  const gap = parseFloat(styles.columnGap) || 0;
  const colWidth = (gridEl.clientWidth - padL - padR - gap * 6) / 7;
  return { colWidth, colStep: colWidth + gap };
}

function clampSpanAtCol(startCol, span) {
  const maxSpan = 7 - startCol;
  return Math.max(1, Math.min(maxSpan, span));
}

function setDropHighlight(gridEl, colIndex) {
  const dropCols = gridEl.parentElement?.querySelector('.week-drop-cols');
  if (!dropCols) return;
  dropCols.querySelectorAll('.week-drop-col').forEach((el, i) => {
    el.classList.toggle('is-active', i === colIndex);
  });
  gridEl.classList.add('is-drop-active');
}

function clearDropHighlight(gridEl) {
  gridEl?.classList.remove('is-drop-active');
  gridEl?.parentElement?.querySelectorAll('.week-drop-col.is-active').forEach((el) => {
    el.classList.remove('is-active');
  });
}

function applyGridPlacement(card, startCol, span, row) {
  card.style.gridColumn = `${startCol + 1} / span ${span}`;
  if (row != null) card.style.gridRow = row + 1;
}

function bindResize(handle, todo, gridEl, weekStartKey) {
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const card = handle.closest('.cal-event');
    const layout = eventWeekLayout(todo, weekStartKey);
    if (!layout || !card) return;

    const { colStep } = getGridMetrics(gridEl);
    const startX = e.clientX;
    const baseSpan = layout.span;
    const startCol = layout.startCol;
    card.classList.add('is-resizing');

    const onMove = (ev) => {
      const delta = Math.round((ev.clientX - startX) / colStep);
      const newSpan = clampSpanAtCol(startCol, baseSpan + delta);
      applyGridPlacement(card, startCol, newSpan, todo._row);
    };

    const onUp = (ev) => {
      card.classList.remove('is-resizing');
      const delta = Math.round((ev.clientX - startX) / colStep);
      const newSpan = clampSpanAtCol(startCol, baseSpan + delta);
      const weekSat = weekSaturdayKey(weekStartKey);
      let newEnd = addDays(weekStartKey, startCol + newSpan - 1);
      if (parseDateKey(newEnd) > parseDateKey(weekSat)) {
        newEnd = weekSat;
      }
      resizeTodoEnd(todo.id, newEnd);
      renderCalendar();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function bindMove(card, todo, gridEl, weekStartKey, masterId, instanceDate) {
  card.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.cal-event-resize, .cal-event-close, .cal-event-done, input, button')) return;
    if (todo._isRecurring) return;

    e.preventDefault();

    const layout = eventWeekLayout(todo, weekStartKey);
    if (!layout) return;

    const { colStep } = getGridMetrics(gridEl);
    const startX = e.clientX;
    const startCol = layout.startCol;
    const span = layout.span;
    let moved = false;

    card.classList.add('is-dragging');

    const onMove = (ev) => {
      if (Math.abs(ev.clientX - startX) > 4) moved = true;
      const delta = Math.round((ev.clientX - startX) / colStep);
      const maxStart = 7 - span;
      const newStartCol = Math.max(0, Math.min(maxStart, startCol + delta));
      applyGridPlacement(card, newStartCol, span, todo._row);
      setDropHighlight(gridEl, newStartCol);
    };

    const onUp = (ev) => {
      card.classList.remove('is-dragging');
      clearDropHighlight(gridEl);

      if (moved) {
        const delta = Math.round((ev.clientX - startX) / colStep);
        const maxStart = 7 - span;
        const newStartCol = Math.max(0, Math.min(maxStart, startCol + delta));
        const newStartDate = addDays(weekStartKey, newStartCol);
        moveTodo(todo.id, newStartDate, weekStartKey);
        renderCalendar();
      } else if (!ev.target.closest('.cal-event-resize, .cal-event-close, .cal-event-done, input, button')) {
        openTodoDetail(masterId, instanceDate);
      }

      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function createEventCard(todo, weekStartKey, gridEl) {
  const layout = eventWeekLayout(todo, weekStartKey);
  if (!layout) return null;

  const cat = getCategoryById(todo.category);
  const masterId = todo._masterId ?? todo.id;
  const instanceDate = todo._instanceDate ?? null;
  const card = document.createElement('div');
  card.className = `cal-event cal-event--${cat.id}${todo.done ? ' done' : ''}${todo._isRecurring ? ' cal-event--recurring' : ''}`;
  card.dataset.id = String(masterId);
  if (instanceDate) card.dataset.instance = instanceDate;
  applyGridPlacement(card, layout.startCol, layout.span, todo._row);

  const main = document.createElement('div');
  main.className = 'cal-event-main';

  const title = document.createElement('span');
  title.className = 'cal-event-title';
  title.title = todo.text;
  title.textContent = todo.text || '未命名待办';
  if (todo._isRecurring) title.textContent = `${title.textContent} ↻`;

  main.append(title);

  const actions = document.createElement('div');
  actions.className = 'cal-event-actions';

  const label = document.createElement('label');
  label.className = 'cal-event-done';
  label.title = '标记完成';
  label.innerHTML = `
    <input type="checkbox" ${todo.done ? 'checked' : ''} aria-label="标记完成">
    <span class="cal-event-done-label">完成</span>
  `;

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'cal-event-close';
  delBtn.setAttribute('aria-label', '删除');
  delBtn.textContent = '×';

  actions.append(label, delBtn);

  const resize = document.createElement('div');
  resize.className = 'cal-event-resize';
  resize.title = '拖动调整时长';

  card.append(main, actions, resize);

  card.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
    e.stopPropagation();
    toggleTodo(masterId, instanceDate);
    renderCalendar();
  });

  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const master = getTodoById(masterId);
    if (isRecurringTodo(master) && instanceDate) {
      const allScope = confirmRecurrenceScope('删除范围？');
      removeTodo(masterId, allScope ? 'all' : 'once', instanceDate);
    } else {
      removeTodo(masterId);
    }
    renderCalendar();
  });

  if (todo._isRecurring) {
    resize.hidden = true;
    card.classList.add('cal-event--no-resize');
  } else {
    bindResize(resize, todo, gridEl, weekStartKey);
  }
  bindMove(card, todo, gridEl, weekStartKey, masterId, instanceDate);
  return card;
}

function renderWeekCalendar() {
  const container = document.getElementById('week-calendar');
  const title = document.getElementById('cal-title');
  const lunarInfo = document.getElementById('cal-lunar-info');
  if (!container) return;

  container.className = 'week-calendar';

  const weekStart = getWeekStart(viewWeekStart);
  const weekStartKey = toDateKey(weekStart);
  const days = getWeekDays(weekStart);
  const todayKey = lunarToDateKey(new Date());
  const mid = days[3];
  const lunar = getLunarDetail(new Date());

  if (title) {
    title.textContent = `${MONTH_EN[mid.getMonth()]} ${mid.getFullYear()}`;
  }
  if (lunarInfo) {
    lunarInfo.textContent = `今天 ${lunar.text} · ${lunar.ganZhiYear}`;
  }

  const events = assignEventRows(getTodosInWeek(weekStartKey));
  const maxRow = events.reduce((m, e) => Math.max(m, e._row), -1);
  const eventRows = Math.max(maxRow + 1, 1);

  container.style.setProperty('--event-rows', String(eventRows));
  container.classList.toggle('is-dense', eventRows > 4);
  container.classList.toggle('is-very-dense', eventRows > 8);

  const headerCells = days.map((d) => {
    const key = toDateKey(d);
    const isToday = key === todayKey;
    const isOtherMonth = d.getMonth() !== mid.getMonth();
    return `
      <div class="week-day-header ${isToday ? 'is-today' : ''}" data-date="${key}">
        <span class="week-day-label">${WEEK_LABELS[d.getDay()]}</span>
        <span class="week-day-num ${isOtherMonth ? 'other-month' : ''}">${d.getDate()}</span>
        <button type="button" class="week-day-add" aria-label="添加待办">+</button>
      </div>
    `;
  }).join('');

  const bodyCells = days.map((d) => {
    const key = toDateKey(d);
    const defaultCategory = TODO_CATEGORIES[d.getDay() % TODO_CATEGORIES.length].id;
    return `
      <div class="week-day-body" data-date="${key}">
        <div class="week-day-compose" hidden>
          <input type="text" class="week-day-input" placeholder="输入待办内容" maxlength="120">
          <div class="week-day-compose-categories" role="radiogroup" aria-label="分类">
            ${TODO_CATEGORIES.map((c) => `
              <label class="week-category-option week-category-option--${c.id}">
                <input type="radio" name="todo-category-${key}" value="${c.id}" ${c.id === defaultCategory ? 'checked' : ''}>
                <span class="week-category-dot"></span>
                <span class="week-category-label">${c.label}</span>
              </label>
            `).join('')}
          </div>
          <div class="week-day-compose-options">
            <label class="week-compose-option">
              <input type="checkbox" class="week-compose-repeat">
              <span>每周重复</span>
            </label>
            <label class="week-compose-option">
              <input type="checkbox" class="week-compose-daily">
              <span>每天重复</span>
            </label>
          </div>
          <div class="week-day-compose-actions">
            <button type="button" class="week-compose-cancel">取消</button>
            <button type="button" class="week-compose-submit">添加</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="week-cal-grid">
      ${headerCells}
      ${bodyCells}
      <div class="week-drop-cols" aria-hidden="true">
        ${days.map(() => '<div class="week-drop-col"></div>').join('')}
      </div>
      <div class="week-compose-layer" aria-hidden="true"></div>
      <div class="week-cal-events" id="week-events-grid"></div>
    </div>
  `;

  const bodies = container.querySelectorAll('.week-day-body');
  bodies.forEach((body) => {
    bindComposer(body, container, weekStartKey, events);

    body.addEventListener('dblclick', (e) => {
      if (e.target.closest('.week-day-add, .week-day-compose')) return;
      e.preventDefault();
      openComposer(body, container, weekStartKey, events);
    });
  });

  const gridEl = container.querySelector('#week-events-grid');
  for (const todo of events) {
    const card = createEventCard(todo, weekStartKey, gridEl);
    if (card) gridEl.appendChild(card);
  }
}

function openCalendarDialog() {
  const dialog = document.getElementById('calendar-dialog');
  const now = new Date();
  viewWeekStart = now;
  viewMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  viewMode = 'week';
  renderCalendar();
  dialog?.showModal();
}

export { openCalendarDialog };

function shiftPeriod(delta) {
  if (viewMode === 'month') {
    const d = new Date(viewMonthStart);
    d.setMonth(d.getMonth() + delta);
    viewMonthStart = d;
    renderCalendar();
    return;
  }
  shiftWeek(delta);
}

function shiftWeek(delta) {
  const d = getWeekStart(viewWeekStart);
  d.setDate(d.getDate() + delta * 7);
  viewWeekStart = d;
  renderCalendar();
}

function goToToday() {
  const now = new Date();
  viewWeekStart = now;
  viewMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  renderCalendar();
}

function initDayMenu() {
  const menu = document.getElementById('cal-day-menu');
  if (!menu) return;

  menu.querySelector('[data-action="important-toggle"]')?.addEventListener('click', () => {
    if (!dayMenuDateKey) return;
    toggleImportantDate(dayMenuDateKey);
    hideDayMenu();
    renderCalendar();
  });

  menu.querySelector('[data-action="goto-week"]')?.addEventListener('click', () => {
    if (!dayMenuDateKey) return;
    const key = dayMenuDateKey;
    hideDayMenu();
    gotoWeekForDate(key);
  });

  document.addEventListener('click', (e) => {
    if (menu.hidden) return;
    if (e.target.closest('#cal-day-menu')) return;
    hideDayMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideDayMenu();
  });
}

let calendarAppInitialized = false;

export function initCalendarApp() {
  if (calendarAppInitialized) return;
  calendarAppInitialized = true;
  initTodoDetailDialog();
  initDayMenu();
  initSidePanel();

  document.getElementById('cal-view-toggle')?.addEventListener('click', toggleViewMode);
  document.getElementById('cal-prev-week')?.addEventListener('click', () => shiftPeriod(-1));
  document.getElementById('cal-next-week')?.addEventListener('click', () => shiftPeriod(1));
  document.getElementById('cal-today')?.addEventListener('click', goToToday);

  document.getElementById('calendar-dialog')?.addEventListener('click', (e) => {
    const dialog = document.getElementById('calendar-dialog');
    if (e.target === dialog) dialog.close();
  });
}

export { renderCalendar, renderWeekCalendar };
