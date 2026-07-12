import { KEYS } from './keys.js';
import { loadSettings } from './storage.js';

const RATES_CACHE_KEY = KEYS.fxRates;
const RATES_CACHE_TTL = 60 * 60 * 1000;

const CURRENCY_ALIASES = {
  rmb: 'CNY',
  cny: 'CNY',
  元: 'CNY',
  人民币: 'CNY',
  usd: 'USD',
  美元: 'USD',
  dollar: 'USD',
  dollars: 'USD',
  eur: 'EUR',
  欧元: 'EUR',
  euro: 'EUR',
  gbp: 'GBP',
  英镑: 'GBP',
  pound: 'GBP',
  pounds: 'GBP',
  jpy: 'JPY',
  日元: 'JPY',
  yen: 'JPY',
  hkd: 'HKD',
  港币: 'HKD',
  港元: 'HKD',
  krw: 'KRW',
  韩元: 'KRW',
  韩币: 'KRW',
  twd: 'TWD',
  台币: 'TWD',
  新台币: 'TWD',
  aud: 'AUD',
  澳元: 'AUD',
  cad: 'CAD',
  加元: 'CAD',
  chf: 'CHF',
  瑞郎: 'CHF',
  sgd: 'SGD',
  新币: 'SGD',
  新加坡元: 'SGD',
};

const CURRENCY_LABELS = {
  CNY: 'CNY',
  USD: 'USD',
  EUR: 'EUR',
  GBP: 'GBP',
  JPY: 'JPY',
  HKD: 'HKD',
  KRW: 'KRW',
  TWD: 'TWD',
  AUD: 'AUD',
  CAD: 'CAD',
  CHF: 'CHF',
  SGD: 'SGD',
};

/** 相对 1 USD 的汇率（静态兜底，约 2025 年中） */
const STATIC_RATES = {
  USD: 1,
  CNY: 7.25,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 157,
  HKD: 7.78,
  KRW: 1380,
  TWD: 32.5,
  AUD: 1.52,
  CAD: 1.37,
  CHF: 0.89,
  SGD: 1.35,
};

const SECONDARY_TARGETS = {
  CNY: ['USD', 'EUR', 'JPY'],
  USD: ['CNY', 'EUR', 'GBP'],
  EUR: ['USD', 'CNY', 'GBP'],
  GBP: ['USD', 'EUR', 'CNY'],
  JPY: ['USD', 'CNY', 'EUR'],
  HKD: ['CNY', 'USD', 'EUR'],
};

let ratesPromise = null;

export function getBaseCurrency() {
  const settings = loadSettings();
  if (settings.baseCurrency && STATIC_RATES[settings.baseCurrency]) {
    return settings.baseCurrency;
  }

  const lang = (navigator.language || 'zh-CN').toLowerCase();
  if (lang.startsWith('zh-hk') || lang.startsWith('zh-tw')) return 'HKD';
  if (lang.startsWith('zh')) return 'CNY';
  if (lang.startsWith('ja')) return 'JPY';
  if (lang.startsWith('en-gb')) return 'GBP';
  if (lang.startsWith('ko')) return 'KRW';
  if (lang.startsWith('de') || lang.startsWith('fr') || lang.startsWith('es') || lang.startsWith('it')) {
    return 'EUR';
  }
  if (lang.startsWith('en')) return 'USD';
  return 'CNY';
}

function normalizeCurrency(token) {
  if (!token) return null;
  const key = token.trim().toLowerCase();
  const code = CURRENCY_ALIASES[key] || token.trim().toUpperCase();
  return STATIC_RATES[code] ? code : null;
}

export function parseCurrencyInput(query) {
  const trimmed = query.trim();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z\u4e00-\u9fff]+)$/);
  if (!match) return null;

  const amount = parseFloat(match[1]);
  const currency = normalizeCurrency(match[2]);
  if (!amount || !currency) return null;

  return { amount, currency };
}

function readRatesCache() {
  try {
    const raw = sessionStorage.getItem(RATES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.rates || Date.now() - parsed.fetchedAt > RATES_CACHE_TTL) return null;
    return parsed.rates;
  } catch {
    return null;
  }
}

function writeRatesCache(rates) {
  try {
    sessionStorage.setItem(RATES_CACHE_KEY, JSON.stringify({
      fetchedAt: Date.now(),
      rates,
    }));
  } catch {
    /* ignore quota */
  }
}

async function fetchRates() {
  const cached = readRatesCache();
  if (cached) return cached;

  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    if (!res.ok) throw new Error('rate fetch failed');
    const data = await res.json();
    if (data?.rates) {
      writeRatesCache(data.rates);
      return data.rates;
    }
  } catch {
    /* use static fallback */
  }
  return STATIC_RATES;
}

export function getExchangeRates() {
  if (!ratesPromise) {
    ratesPromise = fetchRates().finally(() => {
      ratesPromise = null;
    });
  }
  return ratesPromise;
}

export function convert(amount, from, to, rates = STATIC_RATES) {
  const fromRate = rates[from];
  const toRate = rates[to];
  if (!fromRate || !toRate) return null;
  return amount * toRate / fromRate;
}

function formatAmount(value, currency) {
  if (currency === 'JPY' || currency === 'KRW') {
    return `${Math.round(value).toLocaleString()} ${CURRENCY_LABELS[currency]}`;
  }
  const rounded = value >= 100 ? value.toFixed(1) : value.toFixed(2);
  return `${Number(rounded).toLocaleString()} ${CURRENCY_LABELS[currency]}`;
}

function getSecondaryTargets(inputCurrency, baseCurrency) {
  if (inputCurrency !== baseCurrency) return [baseCurrency];
  const list = SECONDARY_TARGETS[baseCurrency] || ['USD', 'EUR'];
  return list.filter((c) => c !== inputCurrency).slice(0, 2);
}

export function buildCurrencySearchUrl(amount, from, to) {
  const q = `${amount} ${from} to ${to}`;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

export async function buildCurrencySuggestion(query) {
  const parsed = parseCurrencyInput(query);
  if (!parsed) return null;

  const rates = await getExchangeRates();
  const base = getBaseCurrency();
  const targets = getSecondaryTargets(parsed.currency, base);
  const parts = [formatAmount(parsed.amount, parsed.currency)];

  for (const target of targets) {
    const converted = convert(parsed.amount, parsed.currency, target, rates);
    if (converted == null) continue;
    parts.push(`≈ ${formatAmount(converted, target)}`);
  }

  if (parts.length < 2) return null;

  const primaryTarget = targets[0];
  return {
    id: 'currency',
    type: '💱 汇率',
    text: parts.join(' '),
    url: buildCurrencySearchUrl(parsed.amount, parsed.currency, primaryTarget),
    copyText: parts.join(' '),
  };
}
