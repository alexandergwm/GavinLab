/** 2026 年国务院办公厅法定节假日安排（国办发明电〔2025〕7号） */
const HOLIDAYS_2026 = {
  '2026-01-01': { name: '元旦', short: '元旦' },
  '2026-01-02': { name: '元旦', short: '休' },
  '2026-01-03': { name: '元旦', short: '休' },
  '2026-02-15': { name: '春节', short: '春节' },
  '2026-02-16': { name: '春节', short: '休' },
  '2026-02-17': { name: '春节', short: '除夕' },
  '2026-02-18': { name: '春节', short: '初一' },
  '2026-02-19': { name: '春节', short: '休' },
  '2026-02-20': { name: '春节', short: '休' },
  '2026-02-21': { name: '春节', short: '休' },
  '2026-02-22': { name: '春节', short: '休' },
  '2026-02-23': { name: '春节', short: '休' },
  '2026-04-04': { name: '清明节', short: '清明' },
  '2026-04-05': { name: '清明节', short: '休' },
  '2026-04-06': { name: '清明节', short: '休' },
  '2026-05-01': { name: '劳动节', short: '劳动' },
  '2026-05-02': { name: '劳动节', short: '休' },
  '2026-05-03': { name: '劳动节', short: '休' },
  '2026-05-04': { name: '劳动节', short: '休' },
  '2026-05-05': { name: '劳动节', short: '休' },
  '2026-06-19': { name: '端午节', short: '端午' },
  '2026-06-20': { name: '端午节', short: '休' },
  '2026-06-21': { name: '端午节', short: '休' },
  '2026-09-25': { name: '中秋节', short: '中秋' },
  '2026-09-26': { name: '中秋节', short: '休' },
  '2026-09-27': { name: '中秋节', short: '休' },
  '2026-10-01': { name: '国庆节', short: '国庆' },
  '2026-10-02': { name: '国庆节', short: '休' },
  '2026-10-03': { name: '国庆节', short: '休' },
  '2026-10-04': { name: '国庆节', short: '休' },
  '2026-10-05': { name: '国庆节', short: '休' },
  '2026-10-06': { name: '国庆节', short: '休' },
  '2026-10-07': { name: '国庆节', short: '休' },
};

/** 调休上班日 */
const MAKEUP_WORKDAYS_2026 = new Set([
  '2026-01-04',
  '2026-02-14',
  '2026-02-28',
  '2026-05-09',
  '2026-09-20',
  '2026-10-10',
]);

/** 固定公历节日（仅节日当天，无完整放假安排的年份作兜底） */
const FIXED_HOLIDAYS = {
  '01-01': { name: '元旦', short: '元旦' },
  '05-01': { name: '劳动节', short: '劳动' },
  '10-01': { name: '国庆节', short: '国庆' },
};

const YEAR_SCHEDULES = {
  2026: HOLIDAYS_2026,
};

function parseYear(dateKey) {
  return Number(dateKey.slice(0, 4));
}

/** @returns {{ name: string, short: string, isOff: boolean } | null} */
export function getHolidayInfo(dateKey) {
  const year = parseYear(dateKey);
  const schedule = YEAR_SCHEDULES[year];
  if (schedule?.[dateKey]) {
    return { ...schedule[dateKey], isOff: true };
  }

  const mmdd = dateKey.slice(5);
  const fixed = FIXED_HOLIDAYS[mmdd];
  if (fixed && !schedule) {
    return { ...fixed, isOff: true };
  }
  return null;
}

export function isStatutoryHoliday(dateKey) {
  return getHolidayInfo(dateKey)?.isOff === true;
}

export function isMakeupWorkday(dateKey) {
  const year = parseYear(dateKey);
  if (year === 2026) return MAKEUP_WORKDAYS_2026.has(dateKey);
  return false;
}

export function getHolidayLabel(dateKey) {
  return getHolidayInfo(dateKey)?.short || '';
}

export function getHolidayName(dateKey) {
  return getHolidayInfo(dateKey)?.name || '';
}
