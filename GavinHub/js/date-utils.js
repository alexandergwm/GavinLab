/** Calendar-day helpers that stay stable across daylight-saving transitions. */

const DAY_MS = 86400000;

export function parseDateKey(key) {
  const [year, month, day] = String(key || '').split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(dateKey, amount) {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + amount);
  return toDateKey(date);
}

export function dateKeyOrdinal(dateKey) {
  const date = parseDateKey(dateKey);
  if (Number.isNaN(date.getTime())) return Number.NaN;
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

export function dayDistance(startKey, endKey) {
  return dateKeyOrdinal(endKey) - dateKeyOrdinal(startKey);
}

export function daySpan(startKey, endKey) {
  return dayDistance(startKey, endKey) + 1;
}
