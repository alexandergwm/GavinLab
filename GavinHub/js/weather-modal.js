import {
  loadWeather,
  getCachedWeather,
  formatWeatherSourceLabel,
  getWeatherInfo,
  weatherIconSvg,
  formatDayLabel,
  formatLocationName,
  getHourlyForecast,
  getWeatherTips,
} from './weather.js';
import { escapeHtml } from './util.js';
import { openDialog } from './dialog-ui.js';

let refreshBound = false;

function renderWeatherSourceAttribution(location) {
  const label = document.getElementById('weather-source-label');
  if (label) label.textContent = formatWeatherSourceLabel(location);
}

function renderHourlySection(data) {
  const hours = getHourlyForecast(data, 24);
  if (!hours.length) return '';

  const items = hours.map((hour) => {
    const info = getWeatherInfo(hour.weatherCode);
    const rainProb = hour.precipProb ?? 0;
    const rainMm = hour.precip ?? 0;
    const rainClass = rainProb >= 50 ? 'is-high' : rainProb >= 20 ? 'is-mid' : '';
    const rainHint = rainProb >= 20
      ? `${rainProb}%${rainMm > 0 ? ` · ${rainMm.toFixed(1)}mm` : ''}`
      : '';
    return `
      <div class="weather-hour ${hour.isNow ? 'is-now' : ''}">
        <span class="weather-hour-time">${hour.timeLabel}</span>
        <span class="weather-hour-icon">${weatherIconSvg(info.icon, 20)}</span>
        <span class="weather-hour-temp">${Math.round(hour.temperature)}°</span>
        ${rainHint ? `<span class="weather-hour-rain ${rainClass}">${rainHint}</span>` : ''}
      </div>
    `;
  }).join('');

  return `
    <section class="weather-hourly">
      <div class="weather-hourly-head"><h3>逐小时预报</h3></div>
      <div class="weather-hourly-scroll" tabindex="0">
        <div class="weather-hourly-track">${items}</div>
      </div>
    </section>
  `;
}

export function renderWeatherModal(data) {
  const body = document.getElementById('weather-body');
  if (!body || !data) return;

  const { current, daily } = data;
  const currentInfo = getWeatherInfo(current.weather_code);
  const sourceHint = data.location?.source === 'gps'
    ? '基于 GPS 定位'
    : data.location?.source === 'ip'
      ? '基于网络 IP 定位'
      : '基于上次定位';
  const forecastItems = daily.time.slice(0, 7).map((dateStr, index) => {
    const info = getWeatherInfo(daily.weather_code[index]);
    const max = Math.round(daily.temperature_2m_max[index]);
    const min = Math.round(daily.temperature_2m_min[index]);
    const rain = daily.precipitation_probability_max?.[index];
    const rainSum = daily.precipitation_sum?.[index];
    const label = index === 0 ? '今天' : formatDayLabel(dateStr, index);
    return `
      <div class="weather-day ${index === 0 ? 'is-today' : ''}">
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
          <p class="weather-location">${formatLocationName(data.location)}</p>
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

function bindWeatherRefresh(renderWeatherBar) {
  if (refreshBound) return;
  refreshBound = true;
  document.getElementById('weather-refresh')?.addEventListener('click', async () => {
    const button = document.getElementById('weather-refresh');
    if (button) {
      button.disabled = true;
      button.textContent = '定位中…';
    }
    try {
      const data = await loadWeather({ forceLocation: true });
      renderWeatherBar(data);
      renderWeatherSourceAttribution(data.location);
      renderWeatherModal(data);
    } catch {
      if (button) button.textContent = '定位失败，重试';
    } finally {
      if (button) {
        button.disabled = false;
        if (button.textContent === '定位中…') button.textContent = '重新定位';
      }
    }
  });
}

export function openWeatherDialog(renderWeatherBar) {
  const dialog = document.getElementById('weather-dialog');
  if (!dialog) return;
  bindWeatherRefresh(renderWeatherBar);

  const cached = getCachedWeather();
  if (cached) {
    renderWeatherSourceAttribution(cached.location);
    renderWeatherModal(cached);
  } else {
    const body = document.getElementById('weather-body');
    if (body) body.innerHTML = '<p class="weather-empty">正在获取天气…</p>';
  }
  openDialog(dialog);

  void loadWeather().then((fresh) => {
    if (!dialog.open || !fresh) return;
    renderWeatherBar(fresh);
    renderWeatherSourceAttribution(fresh.location);
    renderWeatherModal(fresh);
  }).catch(() => {});
}
