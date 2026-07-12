#!/usr/bin/env node
/** Bing 图源 + 文字自适应逻辑自检（纯网络，无浏览器） */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const errors = [];
const warnings = [];

function assert(cond, msg) {
  if (!cond) errors.push(msg);
}

const wp = readFileSync(join(root, 'js/wallpaper.js'), 'utf8');
const wpFetch = readFileSync(join(root, 'js/wallpaper-fetch.js'), 'utf8');
const wpImage = readFileSync(join(root, 'js/wallpaper-image.js'), 'utf8');
const wpTheme = readFileSync(join(root, 'js/wallpaper-theme.js'), 'utf8');

assert(wpTheme.includes('viewportRegionToImageRegion'), 'wallpaper-theme should map viewport to image for cover');
assert(wpTheme.includes('loadAnalysisSource'), 'wallpaper-theme should use lightweight analysis decode');
assert(wp.includes('fetchNextBingWallpaper'), 'wallpaper.js should import fetchNextBingWallpaper');
assert(wp.includes('export async function loadNextWallpaper'), 'wallpaper should expose next-wallpaper path');
assert(wpFetch.includes('export async function fetchNextBingWallpaper'), 'wallpaper-fetch should export fetchNextBingWallpaper');
assert(wpImage.includes('ANALYSIS_MAX_WIDTH'), 'wallpaper-image should resize for analysis');

const seen = new Set();
for (let idx = 0; idx < 5; idx += 1) {
  const api = `https://bing.biturl.top/?resolution=UHD&format=json&index=${idx}&mkt=zh-CN`;
  try {
    const res = await fetch(api, { signal: AbortSignal.timeout(12000) });
    assert(res.ok, `bing idx ${idx} API HTTP ${res.status}`);
    const json = await res.json();
    assert(json?.url, `bing idx ${idx} missing url`);
    assert(json.url.includes('_UHD'), `bing idx ${idx} not UHD: ${json.url}`);
    assert(!seen.has(json.url), `bing idx ${idx} duplicate url`);
    seen.add(json.url);
  } catch (err) {
    warnings.push(`bing idx ${idx} fetch failed: ${err.message}`);
  }
}

if (errors.length) {
  console.error('ADAPT-CHECK FAILED:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}

if (warnings.length) {
  console.warn('ADAPT-CHECK NETWORK WARNINGS:\n' + warnings.map((e) => `  - ${e}`).join('\n'));
}
console.log('ADAPT-CHECK OK:', seen.size, 'unique Bing UHD wallpapers, adapt pipeline symbols present');
