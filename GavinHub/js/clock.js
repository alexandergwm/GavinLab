let timer = null;

function formatTime(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function updateClockElements() {
  const now = new Date();
  const text = formatTime(now);
  const iso = now.toISOString();

  for (const el of document.querySelectorAll('#clock, .clock')) {
    el.textContent = text;
    el.setAttribute('datetime', iso);
  }
}

export function startClock() {
  updateClockElements();
  const now = new Date();
  const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

  clearTimeout(timer);
  timer = setTimeout(() => {
    updateClockElements();
    timer = setInterval(updateClockElements, 60000);
  }, msToNextMinute);
}

export function stopClock() {
  clearTimeout(timer);
  clearInterval(timer);
}
