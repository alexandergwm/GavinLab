import { prepareDialogStyles } from './dialog-ui.js';

let weatherUiInitialized = false;
let weatherModalPromise = null;
let weatherModulePromise = null;
let weatherHydrationPromise = null;

function loadWeatherModule() {
  weatherModulePromise ||= import('./weather.js');
  return weatherModulePromise;
}

function renderWeatherBarWith(module, data) {
  const icon = document.getElementById('weather-icon');
  const summary = document.getElementById('weather-summary');
  if (!icon || !summary || !data) return;

  const current = module.formatWeatherSummary(data);
  icon.innerHTML = module.weatherIconSvg(current.icon, 16);
  summary.textContent = current.text;
}

export function renderWeatherBar(data) {
  void loadWeatherModule().then((module) => renderWeatherBarWith(module, data));
}

function loadWeatherModal() {
  weatherModalPromise ||= import('./weather-modal.js').catch((error) => {
    weatherModalPromise = null;
    throw error;
  });
  return weatherModalPromise;
}

export function openWeather() {
  void hydrateWeather();
  void Promise.all([
    loadWeatherModal(),
    prepareDialogStyles('weather-dialog'),
  ])
    .then(([module]) => module.openWeatherDialog(renderWeatherBar))
    .catch((error) => console.error('[GavinHub] weather dialog failed to load', error));
}

function hydrateWeather() {
  weatherHydrationPromise ||= loadWeatherModule().then(async (module) => {
    const summary = document.getElementById('weather-summary');
    const cached = module.getCachedWeather();
    if (cached) renderWeatherBarWith(module, cached);
    try {
      const data = await module.loadWeather();
      renderWeatherBarWith(module, data);
    } catch {
      if (!cached && summary && !summary.textContent.trim()) summary.textContent = '天气';
    }
  });
  return weatherHydrationPromise;
}

function hydrateCachedWeather() {
  return loadWeatherModule().then((module) => {
    const cached = module.getCachedWeather();
    if (cached) renderWeatherBarWith(module, cached);
  });
}

function scheduleWeatherHydration() {
  const queue = () => {
    window.setTimeout(() => {
      const run = () => void hydrateWeather();
      if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 1200 });
      else window.setTimeout(run, 120);
    }, 1400);
  };
  if (document.body.classList.contains('boot-glass-stable')) queue();
  else document.addEventListener('boot-glass-stable', queue, { once: true });
}

export function initWeather() {
  if (weatherUiInitialized) return Promise.resolve();
  weatherUiInitialized = true;

  const trigger = document.getElementById('weather-trigger');
  const summary = document.getElementById('weather-summary');

  trigger?.addEventListener('click', openWeather);
  trigger?.addEventListener('pointerenter', () => void loadWeatherModule(), { once: true, passive: true });
  if (summary && !summary.textContent.trim()) summary.textContent = '天气';
  scheduleWeatherHydration();
  return hydrateCachedWeather();
}
