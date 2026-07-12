import { parseDateKey, toDateKey } from './todos.js';
import { KEYS } from './keys.js';
import { readJson, writeJson } from './storage.js';

const STORAGE_KEY = KEYS.countdowns;

let nextId = 1;

function normalizeItem(item) {
  return {
    id: item.id ?? nextId++,
    name: String(item.name || '').trim(),
    date: item.date || '',
    kind: item.kind === 'anniversary' ? 'anniversary' : 'countdown',
  };
}

export function loadCountdowns() {
  const raw = readJson(STORAGE_KEY, []);
  if (!Array.isArray(raw)) return [];
  const items = raw.map(normalizeItem).filter((item) => item.name && item.date);
  nextId = items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
  return items;
}

function saveAll(items) {
  writeJson(STORAGE_KEY, items);
}

export function addCountdown({ name, date, kind }) {
  const items = loadCountdowns();
  const item = normalizeItem({ id: nextId++, name, date, kind });
  if (!item.name || !item.date) return null;
  items.push(item);
  saveAll(items);
  return item;
}

export function removeCountdown(id) {
  const items = loadCountdowns().filter((item) => item.id !== id);
  saveAll(items);
}

function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / 86400000);
}

export function getCountdownLabel(dateKey) {
  const diff = daysBetween(new Date(), parseDateKey(dateKey));
  if (diff === 0) return '今天';
  if (diff > 0) return `还有 ${diff} 天`;
  return `已过 ${-diff} 天`;
}

export function getAnniversaryLabel(dateKey) {
  const parsed = parseDateKey(dateKey);
  const today = startOfDay();
  const month = parsed.getMonth();
  const day = parsed.getDate();

  let next = new Date(today.getFullYear(), month, day);
  if (next < today) {
    next = new Date(today.getFullYear() + 1, month, day);
  }

  const diff = daysBetween(today, next);
  if (diff === 0) return '今天';
  return `距今 ${diff} 天`;
}

export function formatEventDate(dateKey, kind) {
  const d = parseDateKey(dateKey);
  if (kind === 'anniversary') {
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function defaultDateInputValue(kind) {
  return toDateKey(new Date());
}
