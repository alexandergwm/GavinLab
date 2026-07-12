import { KEYS } from './keys.js';
import { readJson, writeJson } from './storage.js';
import { fetchWithTimeout } from './util.js';

const LOC_CACHE_KEY = KEYS.weatherLoc;
const WEATHER_CACHE_KEY = KEYS.weatherData;
const WEATHER_CACHE_TTL = 10 * 60 * 1000;

const WEATHER_MAP = {
  0: { label: '晴', icon: 'sun' },
  1: { label: '晴间多云', icon: 'sun-cloud' },
  2: { label: '多云', icon: 'cloud' },
  3: { label: '阴', icon: 'overcast' },
  45: { label: '雾', icon: 'fog' },
  48: { label: '雾凇', icon: 'fog' },
  51: { label: '小毛毛雨', icon: 'drizzle' },
  53: { label: '毛毛雨', icon: 'drizzle' },
  55: { label: '大毛毛雨', icon: 'drizzle' },
  56: { label: '冻毛毛雨', icon: 'drizzle' },
  57: { label: '冻毛毛雨', icon: 'drizzle' },
  61: { label: '小雨', icon: 'rain' },
  63: { label: '中雨', icon: 'rain' },
  65: { label: '大雨', icon: 'rain' },
  66: { label: '冻雨', icon: 'rain' },
  67: { label: '冻雨', icon: 'rain' },
  71: { label: '小雪', icon: 'snow' },
  73: { label: '中雪', icon: 'snow' },
  75: { label: '大雪', icon: 'snow' },
  77: { label: '雪粒', icon: 'snow' },
  80: { label: '小阵雨', icon: 'rain' },
  81: { label: '阵雨', icon: 'rain' },
  82: { label: '大阵雨', icon: 'rain' },
  85: { label: '小阵雪', icon: 'snow' },
  86: { label: '大阵雪', icon: 'snow' },
  95: { label: '雷阵雨', icon: 'thunder' },
  96: { label: '雷阵雨', icon: 'thunder' },
  99: { label: '强雷阵雨', icon: 'thunder' },
};

let cachedWeather = null;

function readWeatherCache() {
  const raw = readJson(WEATHER_CACHE_KEY, null);
  if (!raw?.data || Date.now() - Number(raw.updatedAt || 0) > WEATHER_CACHE_TTL) return null;
  return raw.data;
}

function writeWeatherCache(data) {
  try {
    writeJson(WEATHER_CACHE_KEY, { updatedAt: Date.now(), data });
  } catch { /* ignore quota */ }
}

export function getWeatherInfo(code) {
  return WEATHER_MAP[code] || { label: '未知', icon: 'cloud' };
}

export function weatherIconSvg(type, size = 20) {
  const icons = {
    sun: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`,
    'sun-cloud': `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v2"/><circle cx="12" cy="12" r="4"/><path d="M18 10h1a4 4 0 1 1-3.5 6"/><path d="M8 16H7a4 4 0 1 1 3.5-6"/></svg>`,
    cloud: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>`,
    overcast: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 13H8a5 5 0 0 1-.7-9.95A6 6 0 0 1 18 8.5"/><path d="M8 16h10a4 4 0 0 0 0-8 4.5 4.5 0 0 0-.3-1.5"/></svg>`,
    fog: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14h16M4 18h16M6 10h12"/></svg>`,
    drizzle: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 13H8a5 5 0 1 1-.7-9.95A6 6 0 0 1 18 8.5"/><path d="M8 19v2M12 17v2M16 19v2"/></svg>`,
    rain: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 13H8a5 5 0 1 1-.7-9.95A6 6 0 0 1 18 8.5"/><path d="M8 19v3M12 16v3M16 18v3"/></svg>`,
    snow: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 13H8a5 5 0 1 1-.7-9.95A6 6 0 0 1 18 8.5"/><path d="M8 20l1-1M12 18l1-1M16 20l1-1"/></svg>`,
    thunder: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 13H8a5 5 0 1 1-.7-9.95A6 6 0 0 1 18 8.5"/><path d="M13 16l-3 5h4l-2 3"/></svg>`,
  };
  return icons[type] || icons.cloud;
}

function readLocCache() {
  const raw = readJson(LOC_CACHE_KEY, null);
  if (raw?.lat != null && raw?.lon != null) return raw;
  return null;
}

function writeLocCache(loc) {
  try {
    writeJson(LOC_CACHE_KEY, {
      lat: loc.lat,
      lon: loc.lon,
      name: loc.name,
      city: loc.city,
      source: loc.source,
      updatedAt: Date.now(),
    });
  } catch { /* ignore */ }
}

export function formatLocationName(loc) {
  if (!loc) return '当前位置';
  const district = loc.name || loc.district;
  const city = loc.city;
  if (district && city && district !== city) return `${district} · ${city}`;
  return district || city || '当前位置';
}

export function formatDistrictName(loc) {
  if (!loc) return '';
  return loc.name || loc.district || loc.city || '';
}

export function formatWeatherSourceLabel(location, { compact = false } = {}) {
  const providers = ['Open-Meteo'];
  if (location?.source === 'gps' || location?.source === 'ip') {
    providers.push('BigDataCloud');
  }

  if (compact) {
    return providers.join(' · ');
  }

  const parts = [`数据来源 ${providers.join(' · ')}`];
  if (location?.source === 'gps') parts.push('GPS 定位');
  else if (location?.source === 'ip') parts.push('IP 定位');
  return parts.join(' · ');
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

function parseGeoResult(geo, source) {
  const admins = geo.localityInfo?.administrative || [];
  const district = geo.locality
    || admins.find((a) => /区|县|旗|市辖区/.test(a.name || ''))?.name
    || geo.city
    || '当前位置';

  return {
    lat: geo.latitude,
    lon: geo.longitude,
    name: district,
    city: geo.city || geo.principalSubdivision || '',
    source,
  };
}

async function reverseGeocode(lat, lon) {
  const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lon);
  url.searchParams.set('localityLanguage', 'zh');

  const res = await fetchWithTimeout(url, 8000);
  if (!res.ok) throw new Error('Geocode failed');
  return parseGeoResult(await res.json(), 'gps');
}

async function resolveByIP() {
  const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
  url.searchParams.set('localityLanguage', 'zh');

  const res = await fetchWithTimeout(url, 8000);
  if (!res.ok) throw new Error('IP geocode failed');
  return parseGeoResult(await res.json(), 'ip');
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 6000,
      maximumAge: 300000,
    });
  });
}

function isLegacyDefaultCache(raw) {
  if (!raw) return false;
  return Math.abs(raw.lat - 22.5329) < 0.02
    && Math.abs(raw.lon - 113.9344) < 0.02
    && (raw.name === '南山区' || raw.source === 'default');
}

async function resolveLocation({ fresh = false } = {}) {
  if (!fresh) {
    const cached = readLocCache();
    if (cached && !isLegacyDefaultCache(cached)) {
      return { ...cached, source: cached.source || 'cache' };
    }
    try {
      const ipLoc = await resolveByIP();
      writeLocCache(ipLoc);
      return ipLoc;
    } catch {
      if (cached) return { ...cached, source: 'cache' };
      throw new Error('Location unavailable');
    }
  }

  const tryGps = async () => {
    const pos = await withTimeout(getCurrentPosition(), 7000);
    return reverseGeocode(pos.coords.latitude, pos.coords.longitude);
  };

  const finalize = (loc) => {
    writeLocCache(loc);
    return loc;
  };

  try {
    return finalize(await tryGps());
  } catch {
    try {
      return finalize(await resolveByIP());
    } catch {
      const cached = readLocCache();
      if (cached) return { ...cached, source: 'cache' };
      throw new Error('Location unavailable');
    }
  }
}

async function fetchForecast(location) {
  const { lat, lon } = location;
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lon);
  url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,apparent_temperature,precipitation,precipitation_probability');
  url.searchParams.set('hourly', 'temperature_2m,weather_code,precipitation_probability,precipitation,relative_humidity_2m,wind_speed_10m');
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum');
  url.searchParams.set('forecast_days', '7');
  url.searchParams.set('forecast_hours', '48');
  url.searchParams.set('timezone', 'auto');

  const res = await fetchWithTimeout(url, 12000);
  if (!res.ok) throw new Error('Weather fetch failed');
  const data = await res.json();
  return {
    ...data,
    location,
    locationName: formatLocationName(location),
    districtName: formatDistrictName(location),
  };
}

export async function loadWeather({ forceLocation = false } = {}) {
  if (!forceLocation) {
    cachedWeather ||= readWeatherCache();
    if (cachedWeather) return cachedWeather;
  }
  const location = await resolveLocation({ fresh: forceLocation });
  const data = await fetchForecast(location);
  cachedWeather = data;
  writeWeatherCache(data);
  return data;
}

export function getCachedWeather() {
  cachedWeather ||= readWeatherCache();
  return cachedWeather;
}

export function formatWeatherSummary(data) {
  const code = data.current.weather_code;
  const info = getWeatherInfo(code);
  const temp = Math.round(data.current.temperature_2m);
  const district = data.districtName || formatDistrictName(data.location);
  const place = district ? `${district} ` : '';
  return { ...info, temp, district, text: `${place}${temp}°`.trim() };
}

const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const DRIZZLE_CODES = new Set([51, 53, 55, 56, 57]);

/** 根据当前天气生成 2–4 条出行/穿衣建议 */
export function getWeatherTips(data) {
  if (!data?.current) return [];

  const current = data.current;
  const code = current.weather_code;
  const info = getWeatherInfo(code);
  const temp = current.temperature_2m;
  const feels = current.apparent_temperature;
  const humidity = current.relative_humidity_2m;
  const wind = current.wind_speed_10m;
  const rainProb = current.precipitation_probability
    ?? data.hourly?.precipitation_probability?.[0]
    ?? data.daily?.precipitation_probability_max?.[0];
  const tips = [];

  if (RAIN_CODES.has(code) || (rainProb != null && rainProb >= 40)) {
    tips.push(DRIZZLE_CODES.has(code) ? '有小雨，建议带伞' : '可能有降雨，记得带伞');
  }

  if (SNOW_CODES.has(code)) {
    tips.push('有降雪，路面湿滑，注意保暖与防滑');
  } else if (temp >= 30) {
    tips.push('天气炎热，穿轻薄透气的衣物');
  } else if (temp >= 24) {
    tips.push('偏暖，短袖或薄长袖即可');
  } else if (temp <= 5) {
    tips.push('气温很低，建议厚外套或羽绒服');
  } else if (temp <= 12) {
    tips.push('偏冷，建议加件外套');
  } else if (temp <= 18) {
    tips.push('微凉，可备一件薄外套');
  }

  if (feels - temp >= 3 && humidity >= 75) {
    tips.push('体感闷热，注意补水');
  } else if (temp - feels >= 3) {
    tips.push('风大体感偏冷，可多穿一层');
  }

  if (wind >= 30) {
    tips.push('风力较大，外出注意防风');
  }

  if ([45, 48].includes(code)) {
    tips.push('有雾，出行注意能见度');
  }

  if (code === 0 || code === 1) {
    if (temp >= 18 && temp <= 28 && tips.length < 3) {
      tips.push('天气不错，适合户外活动');
    }
  }

  if (!tips.length) {
    tips.push(`${info.label}，根据气温适当增减衣物`);
  }

  return [...new Set(tips)].slice(0, 4);
}

export function formatDayLabel(dateStr, index = 1) {
  const date = new Date(`${dateStr}T12:00:00`);
  if (index === 1) return '明天';
  if (index === 2) return '后天';
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${m}/${d} ${weekdays[date.getDay()]}`;
}

export function getHourlyForecast(data, hours = 24) {
  const hourly = data?.hourly;
  if (!hourly?.time?.length) return [];

  const now = new Date();
  const currentHour = new Date(now);
  currentHour.setMinutes(0, 0, 0);

  const startIdx = hourly.time.findIndex((t) => new Date(t) >= currentHour);
  const from = startIdx >= 0 ? startIdx : 0;

  return hourly.time.slice(from, from + hours).map((timeStr, i) => {
    const idx = from + i;
    const hourDate = new Date(timeStr);
    const isNow = i === 0 && hourDate <= now;
    return {
      time: timeStr,
      timeLabel: isNow ? '现在' : `${hourDate.getHours()}:00`,
      temperature: hourly.temperature_2m[idx],
      weatherCode: hourly.weather_code[idx],
      precipProb: hourly.precipitation_probability[idx],
      precip: hourly.precipitation[idx],
      humidity: hourly.relative_humidity_2m[idx],
      wind: hourly.wind_speed_10m[idx],
      isNow,
    };
  });
}
