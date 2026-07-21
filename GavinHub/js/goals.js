/** 长期目标 — 替代日历侧栏的倒计时/纪念日 */
import { KEYS } from './keys.js';
import { readJson, writeJson } from './storage.js';
import { parseDateKey, toDateKey } from './todos.js';

const STORAGE_KEY = KEYS.goals;
const MIGRATED_FLAG = 'startpage-goals-migrated-from-countdowns';

let nextId = 1;

function matchGoalId(a, b) {
  return String(a) === String(b);
}

function normalizeGoal(item) {
  const progress = Math.max(0, Math.min(100, Number(item.progress) || 0));
  return {
    id: item.id ?? nextId++,
    title: String(item.title || item.name || '').trim(),
    targetDate: item.targetDate || item.date || '',
    progress,
    status: item.status === 'done' || progress >= 100 ? 'done' : 'active',
    notes: String(item.notes || '').trim(),
    createdAt: item.createdAt || Date.now(),
  };
}

function migrateFromCountdownsList(legacy) {
  if (!Array.isArray(legacy) || !legacy.length) return [];
  return legacy
    .filter((item) => item?.name && item?.date)
    .map((item) => normalizeGoal({
      title: item.name,
      targetDate: item.date,
      progress: 0,
      status: 'active',
      notes: item.kind === 'anniversary' ? '由纪念日迁移' : '由倒计时迁移',
    }));
}

function migrateFromCountdowns() {
  return migrateFromCountdownsList(readJson(KEYS.countdowns, null));
}

function markMigrated() {
  try {
    localStorage.setItem(MIGRATED_FLAG, '1');
  } catch { /* ignore */ }
}

function hasMigrated() {
  try {
    return localStorage.getItem(MIGRATED_FLAG) === '1';
  } catch {
    return false;
  }
}

function saveAll(items) {
  writeJson(STORAGE_KEY, items);
}

/** 同步拉取后：空 goals + 仍有倒计时且尚未迁移过时补迁一次 */
export function ensureGoalsFromLegacyCountdowns(countdowns = null) {
  const existing = readJson(STORAGE_KEY, null);
  if (Array.isArray(existing) && existing.length > 0) {
    markMigrated();
    return existing;
  }
  /* 已迁移过且本地是空数组 = 用户清空过，不要被旧 countdowns 复活 */
  if (hasMigrated() && Array.isArray(existing)) {
    return existing;
  }
  const legacy = countdowns ?? readJson(KEYS.countdowns, null);
  const migrated = migrateFromCountdownsList(legacy);
  markMigrated();
  if (!migrated.length) return Array.isArray(existing) ? existing : [];
  saveAll(migrated);
  nextId = migrated.reduce((max, item) => Math.max(max, item.id), 0) + 1;
  return migrated;
}

export function loadGoals() {
  const raw = readJson(STORAGE_KEY, null);
  let items;

  if (Array.isArray(raw) && raw.length > 0) {
    items = raw.map(normalizeGoal).filter((g) => g.title);
    markMigrated();
  } else if (!hasMigrated()) {
    items = migrateFromCountdowns();
    markMigrated();
    saveAll(items);
  } else {
    items = Array.isArray(raw) ? raw.map(normalizeGoal).filter((g) => g.title) : [];
  }

  nextId = items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
  return items;
}

export function addGoal({ title, targetDate = '', progress = 0, notes = '' }) {
  const items = loadGoals();
  const goal = normalizeGoal({
    id: nextId++,
    title,
    targetDate,
    progress,
    notes,
  });
  if (!goal.title) return null;
  items.unshift(goal);
  saveAll(items);
  return goal;
}

export function updateGoal(id, patch) {
  const items = loadGoals().map((item) => {
    if (!matchGoalId(item.id, id)) return item;
    return normalizeGoal({ ...item, ...patch, id: item.id });
  });
  saveAll(items);
  return items;
}

export function removeGoal(id) {
  const items = loadGoals().filter((item) => !matchGoalId(item.id, id));
  saveAll(items);
  return items;
}

export function toggleGoalDone(id) {
  const items = loadGoals();
  const item = items.find((g) => matchGoalId(g.id, id));
  if (!item) return items;
  if (item.status === 'done') {
    return updateGoal(id, { status: 'active', progress: Math.min(item.progress, 99) });
  }
  return updateGoal(id, { status: 'done', progress: 100 });
}

function daysUntil(dateKey) {
  if (!dateKey) return null;
  const target = parseDateKey(dateKey);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

export function getGoalDeadlineLabel(targetDate) {
  const diff = daysUntil(targetDate);
  if (diff == null) return '无截止日期';
  if (diff === 0) return '今天截止';
  if (diff > 0) return `还有 ${diff} 天`;
  return `已过期 ${-diff} 天`;
}

export function formatGoalDate(dateKey) {
  if (!dateKey) return '';
  const d = parseDateKey(dateKey);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function defaultGoalDateValue() {
  const d = new Date();
  d.setMonth(d.getMonth() + 3);
  return toDateKey(d);
}
