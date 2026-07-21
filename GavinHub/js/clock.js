let timer = null;

function formatTime(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function formatLocalDateTimeAttr(date) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, '0');
  const om = String(abs % 60).padStart(2, '0');
  return `${y}-${mo}-${d}T${h}:${m}:${s}${sign}${oh}:${om}`;
}

function updateClockElements() {
  const now = new Date();
  const text = formatTime(now);
  const datetime = formatLocalDateTimeAttr(now);

  for (const el of document.querySelectorAll('#clock, .clock')) {
    el.textContent = text;
    el.setAttribute('datetime', datetime);
  }
}

export function startClock() {
  stopClock();
  updateClockElements();
  const now = new Date();
  const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

  timer = setTimeout(() => {
    updateClockElements();
    timer = setInterval(updateClockElements, 60000);
  }, msToNextMinute);
}

export function stopClock() {
  clearTimeout(timer);
  clearInterval(timer);
}
