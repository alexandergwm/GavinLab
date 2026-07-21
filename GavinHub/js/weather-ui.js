import {
  loadWeather,
  getCachedWeather,
  formatWeatherSummary,
  formatWeatherSourceLabel,
  getWeatherInfo,
  weatherIconSvg,
  formatDayLabel,
  formatLocationName,
  getHourlyForecast,
  getWeatherTips,
} from './weather.js';
import { escapeHtml } from './util.js';

function renderWeatherSourceAttribution(location) {
  const labelEl = document.getElementById('weather-source-label');
  if (labelEl) labelEl.textContent = formatWeatherSourceLabel(location);
}

function renderWeatherBar(data) {
  const iconEl = document.getElementById('weather-icon');
  const summaryEl = document.getElementById('weather-summary');
  if (!iconEl || !summaryEl || !data) return;

  const summary = formatWeatherSummary(data);
  iconEl.innerHTML = weatherIconSvg(summary.icon, 16);
  summaryEl.textContent = summary.text;
}

function renderHourlySection(data) {
  const hours = getHourlyForecast(data, 24);
  if (!hours.length) return '';

  const items = hours.map((h) => {
    const info = getWeatherInfo(h.weatherCode);
    const temp = Math.round(h.temperature);
    const rainProb = h.precipProb ?? 0;
    const rainMm = h.precip ?? 0;
    const rainClass = rainProb >= 50 ? 'is-high' : rainProb >= 20 ? 'is-mid' : '';
    const rainHint = rainProb >= 20
      ? `${rainProb}%${rainMm > 0 ? ` · ${rainMm.toFixed(1)}mm` : ''}`
      : '';
    return `
      <div class="weather-hour ${h.isNow ? 'is-now' : ''}">
        <span class="weather-hour-time">${h.timeLabel}</span>
        <span class="weather-hour-icon">${weatherIconSvg(info.icon, 20)}</span>
        <span class="weather-hour-temp">${temp}°</span>
        ${rainHint ? `<span class="weather-hour-rain ${rainClass}">${rainHint}</span>` : ''}
      </div>
    `;
  }).join('');

  return `
    <section class="weather-hourly">
      <div class="weather-hourly-head">
        <h3>逐小时预报</h3>
      </div>
      <div class="weather-hourly-scroll" tabindex="0">
        <div class="weather-hourly-track">${items}</div>
      </div>
    </section>
  `;
}

function renderWeatherModal(data) {
  const body = document.getElementById('weather-body');
  if (!body || !data) return;

  const current = data.current;
  const currentInfo = getWeatherInfo(current.weather_code);
  const daily = data.daily;
  const locLabel = formatLocationName(data.location);
  const sourceHint = data.location?.source === 'gps'
    ? '基于 GPS 定位'
    : data.location?.source === 'ip'
      ? '基于网络 IP 定位'
      : '基于上次定位';

  const forecastItems = daily.time.slice(0, 7).map((dateStr, i) => {
    const code = daily.weather_code[i];
    const info = getWeatherInfo(code);
    const max = Math.round(daily.temperature_2m_max[i]);
    const min = Math.round(daily.temperature_2m_min[i]);
    const rain = daily.precipitation_probability_max?.[i];
    const rainSum = daily.precipitation_sum?.[i];
    const label = i === 0 ? '今天' : formatDayLabel(dateStr, i);
    return `
      <div class="weather-day ${i === 0 ? 'is-today' : ''}">
        <span class="weather-day-label">${label}</span>
        <span class="weather-day-icon">${weatherIconSvg(info.icon, 28)}</span>
        <span class="weather-day-desc">${info.label}</span>
        <span class="weather-day-temp">${max}° / ${min}°</span>
        <span class="weather-day-rain">
          ${rain != null ? `降雨 ${rain}%` : ''}
          ${rainSum > 0 ? ` · ${rainSum.toFixed(1)}mm` : ''}
        </span>
      </div>
    `;
  }).join('');

  const nowRainProb = current.precipitation_probability ?? getHourlyForecast(data, 1)[0]?.precipProb;
  const tips = getWeatherTips(data);

  body.innerHTML = `
    <section class="weather-current">
      <div class="weather-current-main">
        <div class="weather-current-icon">${weatherIconSvg(currentInfo.icon, 56)}</div>
        <div class="weather-current-brief">
          <p class="weather-location">${locLabel}</p>
          <p class="weather-location-sub">${sourceHint}</p>
          <p class="weather-temp-large">${Math.round(current.temperature_2m)}°</p>
        </div>
        <div class="weather-tips" aria-label="出行建议">
          <p class="weather-tips-title">出行建议</p>
          <ul class="weather-tips-list">
            ${tips.map((tip) => `<li>${escapeHtml(tip)}</li>`).join('')}
          </ul>
        </div>
      </div>
      <div class="weather-current-meta">
        <span>体感 ${Math.round(current.apparent_temperature)}°</span>
        <span>湿度 ${current.relative_humidity_2m}%</span>
        <span>风速 ${Math.round(current.wind_speed_10m)} km/h</span>
        ${nowRainProb != null ? `<span>降雨概率 ${nowRainProb}%</span>` : ''}
        ${current.precipitation > 0 ? `<span>降水量 ${current.precipitation.toFixed(1)} mm</span>` : ''}
      </div>
    </section>
    ${renderHourlySection(data)}
    <section class="weather-forecast">
      <h3>未来七天</h3>
      <div class="weather-days">${forecastItems}</div>
    </section>
  `;
}

function bindWeatherRefresh() {
  document.getElementById('weather-refresh')?.addEventListener('click', async () => {
    const btn = document.getElementById('weather-refresh');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '定位中…';
    }
    try {
      const data = await loadWeather({ forceLocation: true });
      renderWeatherBar(data);
      renderWeatherSourceAttribution(data.location);
      renderWeatherModal(data);
    } catch {
      if (btn) btn.textContent = '定位失败，重试';
    } finally {
      if (btn) {
        btn.disabled = false;
        if (btn.textContent === '定位中…') btn.textContent = '重新定位';
      }
    }
  });
}

function openWeatherDialog() {
  const dialog = document.getElementById('weather-dialog');
  const data = getCachedWeather();
  if (data) {
    renderWeatherSourceAttribution(data.location);
    renderWeatherModal(data);
  }
  dialog.showModal();
  /* 打开时按 TTL 刷新，过期则拉新数据 */
  void loadWeather().then((fresh) => {
    if (!dialog?.open || !fresh) return;
    renderWeatherBar(fresh);
    renderWeatherSourceAttribution(fresh.location);
    renderWeatherModal(fresh);
  }).catch(() => {});
}

export async function initWeather() {
  const trigger = document.getElementById('weather-trigger');
  const dialog = document.getElementById('weather-dialog');
  const summary = document.getElementById('weather-summary');

  if (summary) summary.textContent = '加载中…';

  try {
    const data = await loadWeather();
    renderWeatherBar(data);
  } catch {
    if (summary) summary.textContent = '天气加载失败';
  }

  trigger?.addEventListener('click', openWeatherDialog);
  bindWeatherRefresh();
  dialog?.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}
