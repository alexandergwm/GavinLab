import { formatLunarDateShort, getLunarDetail, toDateKey as lunarToDateKey } from './lunar.js';
import { getHolidayInfo, isMakeupWorkday } from './holidays.js';
import { escapeHtml } from './util.js';
import { KEYS } from './keys.js';
import { readJson, writeJson } from './storage.js';
import {
  loadGoals,
  addGoal,
  removeGoal,
  updateGoal,
  toggleGoalDone,
  getGoalDeadlineLabel,
  formatGoalDate,
} from './goals.js';
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
        openTodoDetail(todoEl.dataset.todoId, todoEl.dataset.todoInstance || null);
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

function renderSidePanel() {
  const panel = document.getElementById('cal-side-panel');
  if (!panel) return;

  const goals = loadGoals();
  const active = goals.filter((g) => g.status !== 'done');
  const done = goals.filter((g) => g.status === 'done');

  const renderGoalItem = (goal) => `
    <li class="cal-side-item cal-side-item--goal${goal.status === 'done' ? ' is-done' : ''}" data-id="${goal.id}">
      <button type="button" class="cal-side-goal-check" data-id="${goal.id}" aria-label="${goal.status === 'done' ? '标为进行中' : '标为完成'}">
        ${goal.status === 'done' ? '✓' : ''}
      </button>
      <div class="cal-side-item-main">
        <span class="cal-side-item-name">${escapeHtml(goal.title)}</span>
        <span class="cal-side-item-date">${goal.targetDate ? formatGoalDate(goal.targetDate) : '长期'}</span>
        <div class="cal-side-goal-progress" aria-hidden="true">
          <span class="cal-side-goal-progress-bar" style="width:${goal.progress}%"></span>
        </div>
      </div>
      <span class="cal-side-item-badge">${goal.status === 'done' ? '已完成' : getGoalDeadlineLabel(goal.targetDate)}</span>
      <button type="button" class="cal-side-item-delete" data-id="${goal.id}" aria-label="删除">×</button>
    </li>
  `;

  panel.innerHTML = `
    <section class="cal-side-section">
      <div class="cal-side-section-head">
        <h3 class="cal-side-heading">长期目标</h3>
        <button type="button" class="cal-side-add" data-kind="goal" aria-label="添加目标">+</button>
      </div>
      ${active.length
        ? `<ul class="cal-side-list">${active.map(renderGoalItem).join('')}</ul>`
        : '<p class="cal-side-empty">还没有目标，加一个想长期推进的事</p>'}
      <form class="cal-side-form" data-kind="goal" hidden>
        <input type="text" class="cal-side-input" placeholder="例如：跑完一场马拉松" maxlength="60" required>
        <label class="cal-side-field">
          <span>目标日期（可选）</span>
          <input type="date" class="cal-side-date" value="">
        </label>
        <label class="cal-side-field">
          <span>当前进度 ${0}%</span>
          <input type="range" class="cal-side-progress" min="0" max="100" step="5" value="0">
        </label>
        <div class="cal-side-form-actions">
          <button type="button" class="cal-side-cancel">取消</button>
          <button type="submit" class="cal-side-submit">添加</button>
        </div>
      </form>
      ${done.length ? `
        <div class="cal-side-done-head">已完成 · ${done.length}</div>
        <ul class="cal-side-list cal-side-list--done">${done.map(renderGoalItem).join('')}</ul>
      ` : ''}
    </section>
  `;

  bindSidePanel(panel);
}

function bindSidePanel(panel) {
  panel.querySelectorAll('.cal-side-add').forEach((btn) => {
    btn.addEventListener('click', () => {
      const form = panel.querySelector('.cal-side-form[data-kind="goal"]');
      if (!form) return;
      form.hidden = !form.hidden;
      if (!form.hidden) form.querySelector('.cal-side-input')?.focus();
    });
  });

  panel.querySelectorAll('.cal-side-form').forEach((form) => {
    const progress = form.querySelector('.cal-side-progress');
    const progressLabel = progress?.closest('.cal-side-field')?.querySelector('span');
    progress?.addEventListener('input', () => {
      if (progressLabel) progressLabel.textContent = `当前进度 ${progress.value}%`;
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = form.querySelector('.cal-side-input')?.value.trim();
      const targetDate = form.querySelector('.cal-side-date')?.value || '';
      const progressValue = Number(form.querySelector('.cal-side-progress')?.value || 0);
      if (!title) return;
      addGoal({ title, targetDate, progress: progressValue });
      renderSidePanel();
    });

    form.querySelector('.cal-side-cancel')?.addEventListener('click', () => {
      form.hidden = true;
    });
  });

  panel.querySelectorAll('.cal-side-goal-check').forEach((btn) => {
    btn.addEventListener('click', () => {
      toggleGoalDone(btn.dataset.id);
      renderSidePanel();
    });
  });

  panel.querySelectorAll('.cal-side-item-delete').forEach((btn) => {
    btn.addEventListener('click', () => {
      removeGoal(btn.dataset.id);
      renderSidePanel();
    });
  });

  panel.querySelectorAll('.cal-side-item--goal .cal-side-item-main').forEach((main) => {
    main.addEventListener('click', () => {
      const item = main.closest('.cal-side-item--goal');
      const id = item?.dataset.id;
      if (id == null || id === '') return;
      const goal = loadGoals().find((g) => String(g.id) === String(id));
      if (!goal) return;
      const next = window.prompt('更新进度 0–100', String(goal.progress));
      if (next == null) return;
      const progress = Math.max(0, Math.min(100, Number(next) || 0));
      updateGoal(id, { progress, status: progress >= 100 ? 'done' : 'active' });
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

const COMPOSE_ROW_HEIGHT = 84;
const MAX_WEEK_EVENT_ROWS = 8;

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

function getComposeRowHeight(container) {
  const raw = getComputedStyle(container).getPropertyValue('--event-row-height').trim();
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : COMPOSE_ROW_HEIGHT;
}

function expandCalendarForCompose(container, eventRows, composeHeight) {
  const rowHeight = getComposeRowHeight(container);
  const header = container.querySelector('.week-day-header');
  const headerH = Math.ceil(header?.getBoundingClientRect().height || 72);
  const needed = headerH + eventRows * rowHeight + composeHeight + 32;
  container.classList.add('has-compose-open');
  container.style.setProperty('--compose-space', `${Math.ceil(composeHeight + 16)}px`);
  container.style.minHeight = `${needed}px`;
}

function clearCalendarComposeExpansion(container) {
  if (!container) return;
  container.classList.remove('has-compose-open');
  container.style.removeProperty('--compose-space');
  container.style.minHeight = '';
}

function positionComposePanel(compose, container, dateKey, weekStartKey, events) {
  const layer = container.querySelector('.week-compose-layer');
  const colIndex = getColumnIndex(dateKey, weekStartKey);
  if (!layer || colIndex < 0) return;

  /* 层里只保留当前这一个新建框，避免残留叠影 */
  layer.querySelectorAll('.week-day-compose').forEach((el) => {
    if (el !== compose) {
      el.hidden = true;
      el.classList.remove('is-popover');
      const home = container.querySelector(`.week-day-body[data-date="${el.dataset.dateKey}"]`);
      if (home && !home.contains(el)) home.appendChild(el);
    }
  });

  layer.appendChild(compose);
  compose.classList.add('is-popover');
  compose.hidden = false;
  layer.setAttribute('aria-hidden', 'false');

  const eventRows = Math.min(countColumnEventRows(events, weekStartKey, dateKey), MAX_WEEK_EVENT_ROWS);
  const rowHeight = getComposeRowHeight(container);
  const { colWidth } = getGridMetrics(layer);
  const padL = parseFloat(getComputedStyle(layer).paddingLeft) || 0;
  const gutter = 4;
  /* 宽度锁在当日列内，禁止强制最小宽度撑出邻列 */
  const widthPx = Math.max(88, colWidth - gutter * 2);
  const leftPx = padL + colIndex * colWidth + gutter;
  const topPx = eventRows * rowHeight + 8;

  compose.style.left = `${leftPx}px`;
  compose.style.width = `${widthPx}px`;
  compose.style.minWidth = '0';
  compose.style.maxWidth = `${widthPx}px`;
  compose.style.right = 'auto';
  compose.style.bottom = 'auto';
  compose.style.top = `${topPx}px`;

  const composeHeight = Math.max(compose.getBoundingClientRect().height || 168, 168);
  /* 只向下撑开日历，绝不把面板上推盖住原有待办 */
  expandCalendarForCompose(container, eventRows, composeHeight);
  compose.style.top = `${topPx}px`;
}

function closeAllComposers(container) {
  const layer = container.querySelector('.week-compose-layer');
  container.querySelectorAll('.week-day-compose').forEach((el) => {
    el.hidden = true;
    el.classList.remove('is-popover');
    el.style.top = '';
    el.style.left = '';
    el.style.width = '';
    el.style.minWidth = '';
    el.style.maxWidth = '';
    el.style.right = '';
    el.style.bottom = '';
    const body = container.querySelector(`.week-day-body[data-date="${el.dataset.dateKey}"]`);
    if (body && !body.contains(el)) body.appendChild(el);
  });
  /* 清空层内残留节点 */
  if (layer) {
    layer.querySelectorAll('.week-day-compose').forEach((el) => {
      const body = container.querySelector(`.week-day-body[data-date="${el.dataset.dateKey}"]`);
      if (body) body.appendChild(el);
      else el.remove();
    });
    layer.setAttribute('aria-hidden', 'true');
  }
  container.querySelectorAll('.week-day-body.is-composing').forEach((el) => {
    el.classList.remove('is-composing');
  });
  clearCalendarComposeExpansion(container);
}

function openComposer(body, container, weekStartKey, events) {
  closeAllComposers(container);
  const dateKey = body.dataset.date;
  const compose = body.querySelector('.week-day-compose');
  const input = compose?.querySelector('.week-day-input');
  if (!compose || !input) return;
  compose.dataset.dateKey = dateKey;
  body.classList.add('is-composing');
  input.value = '';
  const repeatWeekly = compose.querySelector('.week-compose-repeat');
  const repeatDaily = compose.querySelector('.week-compose-daily');
  if (repeatWeekly) repeatWeekly.checked = false;
  if (repeatDaily) repeatDaily.checked = false;
  const dayDefault = TODO_CATEGORIES[parseDateKey(dateKey).getDay() % TODO_CATEGORIES.length].id;
  const preferred = compose.querySelector(`input[type="radio"][value="${dayDefault}"]`)
    || compose.querySelector('input[type="radio"]');
  if (preferred) preferred.checked = true;

  requestAnimationFrame(() => {
    positionComposePanel(compose, container, dateKey, weekStartKey, events);
    input.focus();
  });
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
  const container = document.getElementById('week-calendar');
  if (container) closeAllComposers(container);
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
    else closeAllComposers(container);
  });

  compose?.querySelector('.week-compose-submit')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    submitComposer(dateKey, compose);
  });

  compose?.querySelector('.week-compose-cancel')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeAllComposers(container);
  });

  const repeatWeekly = compose?.querySelector('.week-compose-repeat');
  const repeatDaily = compose?.querySelector('.week-compose-daily');
  repeatWeekly?.addEventListener('change', () => {
    if (repeatWeekly.checked && repeatDaily) repeatDaily.checked = false;
  });
  repeatDaily?.addEventListener('change', () => {
    if (repeatDaily.checked && repeatWeekly) repeatWeekly.checked = false;
  });

  input?.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      submitComposer(dateKey, compose);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeAllComposers(container);
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
    const id = document.getElementById('todo-detail-id').value;
    if (!id) return;
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
    const id = document.getElementById('todo-detail-id').value;
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

    /* 重复事项禁止拖拽，但仍可点击打开详情 */
    if (todo._isRecurring) {
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const onUp = (ev) => {
        document.removeEventListener('mouseup', onUp);
        if (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4) return;
        if (ev.target.closest('.cal-event-resize, .cal-event-close, .cal-event-done, input, button')) return;
        openTodoDetail(masterId, instanceDate);
      };
      document.addEventListener('mouseup', onUp);
      return;
    }

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
  const hiddenCount = events.filter((e) => e._row >= MAX_WEEK_EVENT_ROWS).length;
  const visibleEvents = events.filter((e) => e._row < MAX_WEEK_EVENT_ROWS);
  const eventRows = Math.max(Math.min(maxRow + 1, MAX_WEEK_EVENT_ROWS), 1);

  container.style.setProperty('--event-rows', String(eventRows));
  container.classList.toggle('is-dense', eventRows > 4);
  container.classList.toggle('is-very-dense', eventRows > 6);

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
              <label class="week-category-option week-category-option--${c.id}" title="${c.label}">
                <input type="radio" name="todo-category-${key}" value="${c.id}" ${c.id === defaultCategory ? 'checked' : ''}>
                <span class="week-category-dot"></span>
                <span class="week-category-label">${c.label}</span>
              </label>
            `).join('')}
          </div>
          <div class="week-compose-footer">
            <div class="week-day-compose-options">
              <label class="week-compose-option">
                <input type="checkbox" class="week-compose-repeat">
                <span>每周</span>
              </label>
              <label class="week-compose-option">
                <input type="checkbox" class="week-compose-daily">
                <span>每天</span>
              </label>
            </div>
            <div class="week-day-compose-actions">
              <button type="button" class="week-compose-cancel">取消</button>
              <button type="button" class="week-compose-submit">添加</button>
            </div>
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
    ${hiddenCount ? `<p class="week-events-overflow">还有 ${hiddenCount} 项待办未显示</p>` : ''}
  `;

  const bodies = container.querySelectorAll('.week-day-body');
  bodies.forEach((body) => {
    bindComposer(body, container, weekStartKey, visibleEvents);

    body.addEventListener('dblclick', (e) => {
      if (e.target.closest('.week-day-add, .week-day-compose')) return;
      e.preventDefault();
      openComposer(body, container, weekStartKey, visibleEvents);
    });
  });

  const gridEl = container.querySelector('#week-events-grid');
  for (const todo of visibleEvents) {
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
    if (e.target === dialog) {
      dialog.close();
      return;
    }
    const week = document.getElementById('week-calendar');
    if (
      week
      && !e.target.closest('.week-day-compose, .week-day-add, .cal-event')
      && week.querySelector('.week-day-body.is-composing')
    ) {
      closeAllComposers(week);
    }
  });

  document.getElementById('calendar-dialog')?.addEventListener('close', () => {
    const week = document.getElementById('week-calendar');
    if (week) closeAllComposers(week);
  });
}

export { renderCalendar, renderWeekCalendar };
