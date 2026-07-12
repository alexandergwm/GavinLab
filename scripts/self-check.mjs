#!/usr/bin/env node
/** 静态自检：模块导出、CSS 分片、懒加载、架构层、关键符号 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const root = new URL('..', import.meta.url).pathname;
const errors = [];

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

function assert(cond, msg) {
  if (!cond) errors.push(msg);
}

for (const f of ['css/base.css', 'css/home.css', 'css/apps.css', 'css/feed.css', 'css/dialogs.css']) {
  assert(existsSync(join(root, f)), `missing ${f}`);
}

const html = read('index.html');
assert(html.includes('js/boot.js'), 'index.html should load boot.js');
for (const part of ['css/base.css', 'css/home.css', 'css/apps.css', 'css/dialogs.css']) {
  assert(html.includes(part), `index.html should link ${part}`);
}
assert(!html.includes('css/feed.css'), 'index.html should not link feed.css');

assert(existsSync(join(root, 'js/boot.js')), 'missing boot.js');
const boot = read('js/boot.js');
assert(boot.includes("import { startClock } from './clock.js'"), 'boot.js should start clock immediately');
assert(boot.includes("import('./app.js')"), 'boot.js should dynamic-import app.js');

const app = read('js/app.js');
assert(!app.includes("from './feed.js'"), 'app.js should not static-import feed.js');
assert(!app.includes("from './wallpaper.js'"), 'app.js should not static-import wallpaper.js');
assert(!app.includes("from './search.js'"), 'app.js should not static-import search.js');
assert(app.includes("import('./wallpaper.js')"), 'app.js should dynamic-import wallpaper.js');
assert(!app.includes("from './calendar.js'"), 'app.js should not static-import calendar.js');
assert(!app.includes("from './shortcut-ui.js'"), 'app.js should not static-import shortcut-ui.js');
assert(!app.includes("from './wallpaper-library.js'"), 'app.js should not static-import wallpaper-library.js');
assert(!app.includes("from './settings-ui.js'"), 'app.js should not static-import settings-ui.js');
assert(app.includes("from './runtime.js'"), 'app.js should import runtime.js');
assert(app.includes('pageModules'), 'app.js should use pageModules');
assert(app.includes('openWallpaperLibrary'), 'app.js should lazy-open wallpaper library');

assert(existsSync(join(root, 'js/keys.js')), 'missing keys.js');
assert(existsSync(join(root, 'js/runtime.js')), 'missing runtime.js');
assert(existsSync(join(root, 'js/settings-ui.js')), 'missing settings-ui.js');
assert(existsSync(join(root, 'js/meta-bar.js')), 'missing meta-bar.js');

const runtime = read('js/runtime.js');
assert(runtime.includes('export const pageModules'), 'runtime.js should export pageModules');
assert(runtime.includes('export function registerPageEnterHook'), 'runtime.js should export registerPageEnterHook');

const settingsUi = read('js/settings-ui.js');
assert(settingsUi.includes('export function initSettingsUI'), 'settings-ui.js should export initSettingsUI');

const wpLib = read('js/wallpaper-library.js');
assert(wpLib.includes('return { open }'), 'wallpaper-library.js should return { open }');

assert(read('js/calendar.js').includes('export function initCalendarApp'), 'calendar.js should export initCalendarApp');
assert(!read('js/calendar.js').includes('export function initDateInfo'), 'calendar.js should not export initDateInfo');

for (const f of ['js/wallpaper.js', 'js/wallpaper-fetch.js', 'js/wallpaper-image.js', 'js/util.js']) {
  assert(existsSync(join(root, f)), `missing ${f}`);
}

const util = read('js/util.js');
assert(util.includes('fetchCorsText'), 'util.js should export fetchCorsText');
assert(util.includes('extractProxiedBody'), 'util.js should export extractProxiedBody');

const searchSuggest = read('js/search-suggest.js');
assert(searchSuggest.includes('export async function fetchQueryCompletions'), 'search-suggest.js should export fetchQueryCompletions');
assert(searchSuggest.includes("from './util.js'"), 'search-suggest.js should use util.js');

const search = read('js/search.js');
assert(search.includes("from './search-suggest.js'"), 'search.js should import search-suggest.js');
assert(search.includes("from './search-suggestions-ui.js'"), 'search.js should import search-suggestions-ui.js');
assert(search.includes('BLOCKING_SMART_IDS'), 'search.js should use BLOCKING_SMART_IDS');
assert(!search.includes('function createSuggestionNode'), 'search.js should not define createSuggestionNode locally');
assert(search.includes("from './keys.js'"), 'search.js should use keys.js');
assert(!search.includes('isNonChinese'), 'search.js should not contain dead isNonChinese');
assert(!search.includes('ai-login-hint-seen'), 'search.js should use KEYS.aiLoginHint');

const searchSuggestionsUi = read('js/search-suggestions-ui.js');
assert(searchSuggestionsUi.includes('export function createSuggestionNode'), 'search-suggestions-ui.js should export createSuggestionNode');
assert(searchSuggestionsUi.includes('BLOCKING_SMART_IDS'), 'search-suggestions-ui.js should use BLOCKING_SMART_IDS');

const storage = read('js/storage.js');
assert(storage.includes('export function readJson'), 'storage.js should export readJson');
assert(storage.includes('export function writeJson'), 'storage.js should export writeJson');
assert(storage.includes('export function readString'), 'storage.js should export readString');
assert(storage.includes("from './keys.js'"), 'storage.js should use keys.js');

const keys = read('js/keys.js');
assert(keys.includes('export const KEYS'), 'keys.js should export KEYS');
assert(keys.includes('export const BLOCKING_SMART_IDS'), 'keys.js should export BLOCKING_SMART_IDS');

const wp = read('js/wallpaper.js');
const wpTheme = read('js/wallpaper-theme.js');
assert(wp.includes('export async function loadWallpaper'), 'wallpaper.js missing loadWallpaper');
assert(wp.includes('analyzeWallpaperTheme'), 'wallpaper.js should delegate text theme analysis');
assert(wpTheme.includes('viewportRegionToImageRegion'), 'wallpaper-theme.js should map viewport regions');
assert(wp.includes('fetchNextBingWallpaper'), 'wallpaper.js should use fetchNextBingWallpaper');

const feed = read('js/feed.js');
assert(!feed.includes('MOCK_ITEMS'), 'feed.js should not contain MOCK_ITEMS');
assert(feed.includes("from './keys.js'"), 'feed.js should use keys.js');

assert(!existsSync(join(root, 'js/greeting.js')), 'greeting.js should be removed');
assert(read('js/quote.js').includes('function getGreetingText'), 'quote.js should inline getGreetingText');

const jsFiles = readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js'));
assert(existsSync(join(root, 'newtab.html')), 'missing newtab.html (NTP shell)');
assert(existsSync(join(root, 'js/background.js')), 'missing background.js (search focus)');
const manifest = JSON.parse(read('manifest.json'));
const newtabOverride = manifest.chrome_url_overrides?.newtab;
assert(
  newtabOverride === 'index.html' || newtabOverride === 'newtab.html',
  'manifest newtab should be index.html or newtab.html',
);
assert(manifest.background?.service_worker === 'js/background.js', 'manifest should register background.js');
assert(Array.isArray(manifest.permissions) && manifest.permissions.includes('storage'), 'manifest needs storage permission for sync');
assert(existsSync(join(root, 'js/sync.js')), 'missing sync.js');

assert(jsFiles.length >= 28, `expected >=28 js modules, got ${jsFiles.length}`);

if (errors.length) {
  console.error('SELF-CHECK FAILED:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}
console.log('SELF-CHECK OK:', jsFiles.length, 'JS modules, 5 CSS parts, runtime layer ready');
