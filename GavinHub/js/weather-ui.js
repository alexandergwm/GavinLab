import {
  loadWeather,
  getCachedWeather,
  formatWeatherSummary,
  weatherIconSvg,
} from './weather.js';
import { prepareDialogStyles } from './dialog-ui.js';

let weatherUiInitialized = false;
let weatherModalPromise = null;

export function renderWeatherBar(data) {
  const icon = document.getElementById('weather-icon');
  const summary = document.getElementById('weather-summary');
  if (!icon || !summary || !data) return;

  const current = formatWeatherSummary(data);
  icon.innerHTML = weatherIconSvg(current.icon, 16);
  summary.textContent = current.text;
}

function loadWeatherModal() {
  weatherModalPromise ||= import('./weather-modal.js').catch((error) => {
    weatherModalPromise = null;
    throw error;
  });
  return weatherModalPromise;
}

function openWeather() {
  void Promise.all([
    loadWeatherModal(),
    prepareDialogStyles('weather-dialog'),
  ])
    .then(([module]) => module.openWeatherDialog(renderWeatherBar))
    .catch((error) => console.error('[GavinHub] weather dialog failed to load', error));
}

export function initWeather() {
  if (weatherUiInitialized) return;
  weatherUiInitialized = true;

  const trigger = document.getElementById('weather-trigger');
  const summary = document.getElementById('weather-summary');
  const cached = getCachedWeather();

  trigger?.addEventListener('click', openWeather);
  if (cached) renderWeatherBar(cached);
  else if (summary) summary.textContent = '天气';

  void loadWeather().then(renderWeatherBar).catch(() => {
    if (!cached && summary) summary.textContent = '天气不可用';
  });
}
