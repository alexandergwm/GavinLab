import { KEYS } from './keys.js';
import { readJson, writeJson } from './storage.js';

const TODOS_KEY = KEYS.todos;

let todoIdSeq = 0;

/** 数值 ID，避免同毫秒连续创建撞车 */
export function createTodoId() {
  todoIdSeq = (todoIdSeq + 1) % 1000;
  return Date.now() * 1000 + todoIdSeq;
}

export const TODO_CATEGORIES = [
  { id: 'work', label: '工作', color: 'green', bg: '#dff6e6', text: '#1a5c32' },
  { id: 'fitness', label: '健身', color: 'pink', bg: '#fde8ef', text: '#9b3d5c' },
  { id: 'life', label: '生活', color: 'blue', bg: '#e4f0ff', text: '#1e4a7a' },
  { id: 'study', label: '学习', color: 'yellow', bg: '#fff5d6', text: '#7a5c1a' },
];

const COLOR_TO_CATEGORY = {
  green: 'work',
  pink: 'fitness',
  blue: 'life',
  yellow: 'study',
};

function matchTodoId(a, b) {
  return String(a) === String(b);
}

export function getCategoryById(id) {
  return TODO_CATEGORIES.find((c) => c.id === id) || TODO_CATEGORIES[0];
}

function resolveCategory(item, index) {
  if (item.category && TODO_CATEGORIES.some((c) => c.id === item.category)) {
    return item.category;
  }
  if (item.color && COLOR_TO_CATEGORY[item.color]) {
    return COLOR_TO_CATEGORY[item.color];
  }
  return TODO_CATEGORIES[index % TODO_CATEGORIES.length].id;
}

function normalizeItem(item, index) {
  const { color: _color, ...rest } = item;
  return {
    ...rest,
    category: resolveCategory(item, index),
    notes: item.notes || '',
    instanceDone: item.instanceDone || {},
    skippedDates: item.skippedDates || [],
  };
}

function migrate(raw) {
  if (Array.isArray(raw)) return raw.map(normalizeItem);
  if (!raw || typeof raw !== 'object') return [];

  const items = [];
  for (const [dateKey, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      items.push(normalizeItem({
        id: item.id || createTodoId(),
        text: item.text,
        done: !!item.done,
        startDate: dateKey,
        endDate: dateKey,
        category: item.category,
        color: item.color,
        notes: item.notes || '',
      }, items.length));
    }
  }
  return items;
}

export function loadTodos() {
  return migrate(readJson(TODOS_KEY, null));
}

function saveTodos(items) {
  writeJson(TODOS_KEY, items);
}

export function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(dateKey, n) {
  const d = parseDateKey(dateKey);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

export function daySpan(startKey, endKey) {
  const s = parseDateKey(startKey).getTime();
  const e = parseDateKey(endKey).getTime();
  return Math.round((e - s) / 86400000) + 1;
}

export function occursOnDate(item, dateKey) {
  if (item.skippedDates?.includes(dateKey)) return false;

  if (!item.recurrence) {
    const t = parseDateKey(dateKey).getTime();
    const es = parseDateKey(item.startDate).getTime();
    const ee = parseDateKey(item.endDate).getTime();
    return t >= es && t <= ee;
  }

  const date = parseDateKey(dateKey);
  const anchor = parseDateKey(item.startDate);
  if (date < anchor) return false;

  if (item.recurrence === 'daily') return true;

  if (item.recurrence === 'weekly') {
    const weekdays = item.weekdays?.length ? item.weekdays : [anchor.getDay()];
    return weekdays.includes(date.getDay());
  }

  return false;
}

export function expandTodoInstance(item, dateKey) {
  if (!item.recurrence) return item;
  const overrides = item.instanceOverrides?.[dateKey] || {};
  const { done: overrideDone, ...restOverrides } = overrides;
  const done = item.instanceDone?.[dateKey] ?? overrideDone ?? false;
  return {
    ...item,
    ...restOverrides,
    startDate: dateKey,
    endDate: dateKey,
    done,
    _instanceDate: dateKey,
    _isRecurring: true,
    _masterId: item.id,
  };
}

function expandTodosOnDate(items, dateKey) {
  const result = [];
  for (const item of items) {
    if (!occursOnDate(item, dateKey)) continue;
    result.push(item.recurrence ? expandTodoInstance(item, dateKey) : item);
  }
  return result;
}

export function getExpandedTodosOnDate(dateKey) {
  return expandTodosOnDate(loadTodos(), dateKey);
}

export function getExpandedTodosInWeek(weekStartKey) {
  const ws = parseDateKey(weekStartKey);
  const items = loadTodos();
  const seen = new Map();
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(ws);
    d.setDate(d.getDate() + i);
    const key = toDateKey(d);
    for (const todo of expandTodosOnDate(items, key)) {
      const uid = todo._instanceDate ? `${todo._masterId}@${todo._instanceDate}` : String(todo.id);
      if (!seen.has(uid)) seen.set(uid, { ...todo, _uid: uid });
    }
  }
  return [...seen.values()];
}

export function addTodo({ text, startDate, endDate, category, recurrence, weekdays }) {
  const trimmed = text.trim();
  if (!trimmed) return loadTodos();

  const items = loadTodos();
  const end = endDate || startDate;
  const todo = {
    id: createTodoId(),
    text: trimmed,
    done: false,
    startDate,
    endDate: end >= startDate ? end : startDate,
    category: category || TODO_CATEGORIES[items.length % TODO_CATEGORIES.length].id,
    notes: '',
    instanceDone: {},
    skippedDates: [],
  };

  if (recurrence === 'weekly' || recurrence === 'daily') {
    todo.recurrence = recurrence;
    todo.endDate = startDate;
    if (recurrence === 'weekly') {
      todo.weekdays = weekdays?.length
        ? weekdays
        : [parseDateKey(startDate).getDay()];
    }
  }

  items.push(todo);
  saveTodos(items);
  return items;
}

export function moveTodo(id, newStartDate, weekStartKey) {
  const items = loadTodos();
  const item = items.find((t) => matchTodoId(t.id, id));
  if (!item) return items;
  const span = daySpan(item.startDate, item.endDate);
  let endDate = addDays(newStartDate, span - 1);
  if (weekStartKey) {
    const weekSat = weekSaturdayKey(weekStartKey);
    if (parseDateKey(endDate) > parseDateKey(weekSat)) {
      endDate = weekSat;
    }
  }
  return updateTodo(id, { startDate: newStartDate, endDate });
}

export function resizeTodoEnd(id, newEndDate) {
  const items = loadTodos();
  const item = items.find((t) => matchTodoId(t.id, id));
  if (!item) return items;
  const end = parseDateKey(newEndDate) >= parseDateKey(item.startDate) ? newEndDate : item.startDate;
  return updateTodo(id, { endDate: end });
}

export function toggleTodo(id, instanceDate = null) {
  const items = loadTodos();
  const item = items.find((t) => matchTodoId(t.id, id));
  if (!item) return items;

  if (item.recurrence && instanceDate) {
    const instanceDone = { ...(item.instanceDone || {}) };
    instanceDone[instanceDate] = !(item.instanceDone?.[instanceDate] ?? false);
    return updateTodo(id, { instanceDone }, 'all');
  }

  return updateTodo(id, { done: !item.done });
}

export function removeTodo(id, scope = 'all', instanceDate = null) {
  const items = loadTodos();
  const item = items.find((t) => matchTodoId(t.id, id));
  if (!item) return items;

  if (item.recurrence && scope === 'once' && instanceDate) {
    const skippedDates = [...(item.skippedDates || [])];
    if (!skippedDates.includes(instanceDate)) skippedDates.push(instanceDate);
    return updateTodo(id, { skippedDates }, 'all');
  }

  const filtered = items.filter((t) => !matchTodoId(t.id, id));
  saveTodos(filtered);
  return filtered;
}

export function updateTodo(id, patch, scope = 'all', instanceDate = null) {
  const items = loadTodos().map((item) => {
    if (!matchTodoId(item.id, id)) return item;

    if (item.recurrence && scope === 'once' && instanceDate) {
      const { done, ...rest } = patch;
      const next = { ...item };
      if (done !== undefined) {
        next.instanceDone = { ...(item.instanceDone || {}), [instanceDate]: done };
      }
      if (Object.keys(rest).length) {
        next.instanceOverrides = {
          ...(item.instanceOverrides || {}),
          [instanceDate]: { ...(item.instanceOverrides?.[instanceDate] || {}), ...rest },
        };
      }
      return next;
    }

    const next = { ...item, ...patch };
    if (parseDateKey(next.endDate) < parseDateKey(next.startDate)) {
      next.endDate = next.startDate;
    }
    if (next.recurrence) next.endDate = next.startDate;
    return next;
  });
  saveTodos(items);
  return items;
}

export function getTodoById(id, instanceDate = null) {
  const item = loadTodos().find((t) => matchTodoId(t.id, id));
  if (!item) return null;
  if (item.recurrence && instanceDate) {
    const expanded = expandTodoInstance(item, instanceDate);
    const overrides = item.instanceOverrides?.[instanceDate];
    if (overrides) return { ...expanded, ...overrides };
    return expanded;
  }
  return item;
}

export function getInstanceOverride(item, instanceDate) {
  return item.instanceOverrides?.[instanceDate] || null;
}

export function isRecurringTodo(item) {
  return item?.recurrence === 'weekly' || item?.recurrence === 'daily';
}

export function getTodosInWeek(weekStartKey) {
  return getExpandedTodosInWeek(weekStartKey);
}

export function weekSaturdayKey(weekStartKey) {
  return addDays(weekStartKey, 6);
}

export function eventWeekLayout(item, weekStartKey) {
  const ws = parseDateKey(weekStartKey).getTime();
  const we = parseDateKey(weekSaturdayKey(weekStartKey)).getTime();
  const es = parseDateKey(item.startDate).getTime();
  const ee = parseDateKey(item.endDate).getTime();
  if (ee < ws || es > we) return null;

  const visStart = Math.max(es, ws);
  const visEnd = Math.min(ee, we);
  const dayMs = 86400000;
  const startCol = Math.max(0, Math.min(6, Math.floor((visStart - ws) / dayMs)));
  let span = Math.max(1, Math.floor((visEnd - visStart) / dayMs) + 1);
  span = Math.min(span, 7 - startCol);
  return { startCol, span };
}

export function overlaps(a, b) {
  return parseDateKey(a.startDate) <= parseDateKey(b.endDate)
    && parseDateKey(b.startDate) <= parseDateKey(a.endDate);
}

export function assignEventRows(events) {
  const sorted = [...events].sort((a, b) => {
    const d = parseDateKey(a.startDate) - parseDateKey(b.startDate);
    return d || daySpan(b.startDate, b.endDate) - daySpan(a.startDate, a.endDate);
  });
  const rows = [];
  for (const ev of sorted) {
    let row = 0;
    while (rows[row]?.some((other) => overlaps(ev, other))) row += 1;
    if (!rows[row]) rows[row] = [];
    rows[row].push(ev);
    ev._row = row;
  }
  return sorted;
}
