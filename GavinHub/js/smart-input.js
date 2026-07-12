/** 智能输入识别：URL / 计算 / 天气 / DOI / 进制 / 数据量 */
import { BLOCKING_SMART_IDS } from './keys.js';

export { BLOCKING_SMART_IDS };

const URL_RE = /^https?:\/\/.+/i;
const DOI_PREFIX_RE = /^doi:\s*(10\.\S+)$/i;
const DOI_BARE_RE = /^(10\.\d{4,9}\/\S+)$/i;
const WEATHER_RE = /^(.+?)天气$/;
const CALC_CHARS_RE = /^[\d\s+\-*/().,%^]+$/;

function normalizeUrl(raw) {
  const trimmed = raw.trim();
  if (!URL_RE.test(trimmed)) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

export function parseDoi(raw) {
  const trimmed = raw.trim();
  const prefixed = trimmed.match(DOI_PREFIX_RE);
  if (prefixed) return prefixed[1];
  const bare = trimmed.match(DOI_BARE_RE);
  if (bare) return bare[1];
  return null;
}

export function getDoiUrl(doi) {
  return `https://doi.org/${encodeURIComponent(doi)}`;
}

export function parseWeatherQuery(raw) {
  const trimmed = raw.trim();
  const match = trimmed.match(WEATHER_RE);
  if (!match) return null;
  const city = match[1].trim();
  if (!city || city.length > 20) return null;
  return city;
}

/** 安全计算简单数学表达式 */
export function evaluateCalc(raw) {
  const expr = raw.trim().replace(/,/g, '');
  if (!expr || !CALC_CHARS_RE.test(expr)) return null;
  if (!/[\d)]/.test(expr)) return null;

  try {
    const normalized = expr.replace(/(\d+(?:\.\d+)?)\s*%/g, '($1/100)');
    // eslint-disable-next-line no-new-func
    const fn = new Function(`"use strict"; return (${normalized});`);
    const result = fn();
    if (typeof result !== 'number' || !Number.isFinite(result)) return null;
    return result;
  } catch {
    return null;
  }
}

function formatCalcResult(value) {
  if (Number.isInteger(value)) return String(value);
  const rounded = Math.round(value * 1e10) / 1e10;
  return String(rounded);
}

const BASE_NAMES = {
  2: 'bin',
  8: 'oct',
  10: 'dec',
  16: 'hex',
};

const BASE_KEYWORDS = {
  bin: 2, binary: 2, '二进制': 2,
  oct: 8, octal: 8, '八进制': 8,
  hex: 16, hexadecimal: 16, '十六进制': 16,
  dec: 10, decimal: 10, '十进制': 10,
};

function parseBaseKeyword(token) {
  if (!token) return null;
  return BASE_KEYWORDS[token.trim().toLowerCase()] || null;
}

function isValidInBase(value, base) {
  if (base === 2) return /^[01]+$/i.test(value);
  if (base === 8) return /^[0-7]+$/i.test(value);
  if (base === 10) return /^\d+$/i.test(value);
  if (base === 16) return /^[0-9a-f]+$/i.test(value);
  return false;
}

function parseIntInBase(value, base) {
  if (!isValidInBase(value, base)) return null;
  const n = parseInt(value, base);
  return Number.isFinite(n) ? n : null;
}

function formatBaseValue(n, base) {
  if (base === 10) return String(n);
  if (base === 16) return n.toString(16).toUpperCase();
  return n.toString(base);
}

/** 识别进制转换输入，返回 { decimal, fromBase, display } 或 null */
export function parseBaseInput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const toMatch = trimmed.match(/^(.+?)\s+(\S+)\s+to\s+(\S+)$/i);
  if (toMatch) {
    const [, valuePart, fromTok, toTok] = toMatch;
    const fromBase = parseBaseKeyword(fromTok);
    const toBase = parseBaseKeyword(toTok);
    const value = valuePart.trim();
    if (!fromBase || !toBase || fromBase === toBase) return null;
    const decimal = parseIntInBase(value, fromBase);
    if (decimal == null) return null;
    return {
      decimal,
      fromBase,
      toBase,
      inputLabel: `${value} (${BASE_NAMES[fromBase]})`,
      outputLabel: `${formatBaseValue(decimal, toBase)} (${BASE_NAMES[toBase]})`,
    };
  }

  const prefixMatch = trimmed.match(/^0([xX])([0-9a-fA-F]+)$|^0([bB])([01]+)$|^0([oO])([0-7]+)$/);
  if (prefixMatch) {
    const base = prefixMatch[1] ? 16 : prefixMatch[3] ? 2 : 8;
    const value = prefixMatch[2] || prefixMatch[4] || prefixMatch[6];
    const decimal = parseIntInBase(value, base);
    if (decimal == null) return null;
    const inputLabel = trimmed.toLowerCase();
    return {
      decimal,
      fromBase: base,
      inputLabel,
      outputLabel: `${decimal} (${BASE_NAMES[10]})`,
    };
  }

  const suffixMatch = trimmed.match(/^([0-9a-fA-F]+)\s+(\S+)$/i);
  if (suffixMatch) {
    const [, value, baseTok] = suffixMatch;
    const base = parseBaseKeyword(baseTok);
    if (!base) return null;
    let decimal = parseIntInBase(value, base);
    if (decimal == null && base !== 10 && /^\d+$/.test(value)) {
      decimal = parseInt(value, 10);
      return {
        decimal,
        fromBase: 10,
        toBase: base,
        inputLabel: `${value} (${BASE_NAMES[10]})`,
        outputLabel: `${formatBaseValue(decimal, base)} (${BASE_NAMES[base]})`,
      };
    }
    if (decimal == null) return null;
    return {
      decimal,
      fromBase: base,
      inputLabel: `${value} (${BASE_NAMES[base]})`,
      outputLabel: `${decimal} (${BASE_NAMES[10]})`,
    };
  }

  const prefixKwMatch = trimmed.match(/^(\S+)\s+([0-9a-fA-F]+)$/i);
  if (prefixKwMatch) {
    const [, baseTok, value] = prefixKwMatch;
    const base = parseBaseKeyword(baseTok);
    if (!base) return null;
    const decimal = parseIntInBase(value, base);
    if (decimal == null) return null;
    return {
      decimal,
      fromBase: base,
      inputLabel: `${value} (${BASE_NAMES[base]})`,
      outputLabel: `${decimal} (${BASE_NAMES[10]})`,
    };
  }

  return null;
}

function buildBaseDisplay(parsed) {
  return `${parsed.inputLabel} = ${parsed.outputLabel}`;
}

const SIZE_UNITS = {
  b: { factor: 1, label: 'B' },
  byte: { factor: 1, label: 'B' },
  bytes: { factor: 1, label: 'B' },
  '字节': { factor: 1, label: 'B' },
  k: { factor: 1024, label: 'KB' },
  kb: { factor: 1024, label: 'KB' },
  kib: { factor: 1024, label: 'KiB' },
  m: { factor: 1024 ** 2, label: 'MB' },
  mb: { factor: 1024 ** 2, label: 'MB' },
  mib: { factor: 1024 ** 2, label: 'MiB' },
  g: { factor: 1024 ** 3, label: 'GB' },
  gb: { factor: 1024 ** 3, label: 'GB' },
  gib: { factor: 1024 ** 3, label: 'GiB' },
  t: { factor: 1024 ** 4, label: 'TB' },
  tb: { factor: 1024 ** 4, label: 'TB' },
  tib: { factor: 1024 ** 4, label: 'TiB' },
  '兆': { factor: 1024 ** 2, label: 'MB' },
  '千': { factor: 1024, label: 'KB' },
  '吉': { factor: 1024 ** 3, label: 'GB' },
};

function parseSizeUnit(token) {
  if (!token) return null;
  const key = token.trim().toLowerCase();
  return SIZE_UNITS[key] || null;
}

function formatSizeValue(value, label) {
  if (value >= 100) return `${Math.round(value)} ${label}`;
  if (value >= 10) return `${value.toFixed(1)} ${label}`;
  if (value >= 1) return `${value.toFixed(2)} ${label}`;
  if (value > 0) return `${value.toFixed(4)} ${label}`;
  return `0 ${label}`;
}

/** 识别数据量输入，返回 { bytes, display, copyText } 或 null */
export function parseDataSizeInput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const toMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(\S+)\s+to\s+(\S+)$/i);
  if (toMatch) {
    const [, amountStr, fromTok, toTok] = toMatch;
    const fromUnit = parseSizeUnit(fromTok);
    const toUnit = parseSizeUnit(toTok);
    if (!fromUnit || !toUnit) return null;
    const amount = parseFloat(amountStr);
    if (!amount || amount <= 0) return null;
    const bytes = amount * fromUnit.factor;
    const targetValue = bytes / toUnit.factor;
    const inputFormatted = `${amountStr} ${fromUnit.label}`;
    const targetFormatted = formatSizeValue(targetValue, toUnit.label);
    const display = `${inputFormatted} = ${targetFormatted}`;
    return { bytes, display, copyText: display };
  }

  const simpleMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z\u4e00-\u9fff]+)$/i);
  if (!simpleMatch) return null;

  const amount = parseFloat(simpleMatch[1]);
  const unit = parseSizeUnit(simpleMatch[2]);
  if (!amount || !unit || amount <= 0) return null;

  const bytes = amount * unit.factor;
  const inputFormatted = `${simpleMatch[1]} ${unit.label}`;
  const parts = [inputFormatted];

  const targets = ['KB', 'MB', 'GB'].filter((l) => l !== unit.label);
  for (const label of targets) {
    const u = Object.values(SIZE_UNITS).find((x) => x.label === label);
    const val = bytes / u.factor;
    if (val >= 0.01 && val < 10000) {
      parts.push(`= ${formatSizeValue(val, label)}`);
    }
  }

  if (parts.length < 2) return null;
  const display = parts.join(' ');
  return { bytes, display, copyText: display };
}

export function buildSmartSuggestions(query, { getMapUrl, mapProvider }) {
  const items = [];
  const trimmed = query.trim();
  if (!trimmed) return items;

  const url = normalizeUrl(trimmed);
  if (url) {
    items.push({
      id: 'url',
      type: '🔗 链接',
      text: url,
      url,
      priority: 1,
      action: 'open',
    });
    return items;
  }

  const doi = parseDoi(trimmed);
  if (doi) {
    items.push({
      id: 'doi',
      type: '📄 论文',
      text: `打开 DOI：${doi}`,
      url: getDoiUrl(doi),
      priority: 2,
      action: 'open',
    });
    return items;
  }

  const calcResult = evaluateCalc(trimmed);
  if (calcResult != null) {
    const display = `${trimmed} = ${formatCalcResult(calcResult)}`;
    items.push({
      id: 'calc',
      type: '🧮 计算',
      text: display,
      copyText: formatCalcResult(calcResult),
      priority: 3,
      action: 'copy',
    });
  }

  const baseParsed = parseBaseInput(trimmed);
  if (baseParsed) {
    const display = buildBaseDisplay(baseParsed);
    items.push({
      id: 'base',
      type: '🔄 进制',
      text: display,
      copyText: display,
      priority: 4,
      action: 'copy',
    });
  }

  const dataSizeParsed = parseDataSizeInput(trimmed);
  if (dataSizeParsed) {
    items.push({
      id: 'datasize',
      type: '📦 数据量 (1024)',
      text: dataSizeParsed.display,
      copyText: dataSizeParsed.copyText,
      priority: 5,
      action: 'copy',
    });
  }

  const city = parseWeatherQuery(trimmed);
  if (city) {
    const mapQuery = `${city}天气`;
    items.push({
      id: 'weather',
      type: '🌤 天气',
      text: `查看${city}天气`,
      url: getMapUrl(mapProvider, mapQuery),
      priority: 6,
      action: 'open',
    });
  }

  return items;
}

export function resolveSmartAction(query, smartItems) {
  if (!smartItems.length) return null;
  const sorted = [...smartItems].sort((a, b) => a.priority - b.priority);
  return sorted[0];
}

export function isCalcQuery(query) {
  return evaluateCalc(query) != null;
}

export function isUrlQuery(query) {
  return normalizeUrl(query) != null;
}

export function isDoiQuery(query) {
  return parseDoi(query) != null;
}

export function isWeatherQuery(query) {
  return parseWeatherQuery(query) != null;
}

export function isBaseQuery(query) {
  return parseBaseInput(query) != null;
}

export function isDataSizeQuery(query) {
  return parseDataSizeInput(query) != null;
}
