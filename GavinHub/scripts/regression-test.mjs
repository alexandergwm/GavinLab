#!/usr/bin/env node
import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import { extname, join, normalize } from 'path';
import { chromium } from 'playwright';

const root = new URL('..', import.meta.url).pathname;
const mime = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function startServer() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = normalize(join(root, rel));
      if (!file.startsWith(root)) {
        res.writeHead(403).end();
        return;
      }
      try {
        const info = await stat(file);
        const target = info.isDirectory() ? join(file, 'index.html') : file;
        const body = await readFile(target);
        res.writeHead(200, {
          'content-type': `${mime[extname(target)] || 'application/octet-stream'}; charset=utf-8`,
          'cache-control': 'no-store',
        });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = await startServer();
const { port } = server.address();
const url = `http://127.0.0.1:${port}/index.html`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
let completionRequests = 0;

const [baseCss, dialogsCss, defaultWallpaperBytes] = await Promise.all([
  readFile(join(root, 'css/base.css'), 'utf8'),
  readFile(join(root, 'css/dialogs.css'), 'utf8'),
  readFile(join(root, 'assets/default-wallpaper.jpg')),
]);
assert(baseCss.includes('--boot-ui-delay-search: 0s;'),
  'search reveal must remain synchronized with the rest of the startup UI');
assert(baseCss.includes('--boot-ui-delay-dock: 0s;'),
  'dock reveal must remain synchronized with the rest of the startup UI');
assert(!dialogsCss.includes('allow-discrete'),
  'native dialogs must not use discrete close transitions that flash in Edge');
assert(!baseCss.includes('transition:\n    filter var(--transition-search-focus)'),
  'full-screen wallpaper filters must not animate during search focus');
assert(!baseCss.includes('body.search-focused:not(.page-blur-active) .wallpaper-img'),
  'search focus should use a composited overlay instead of filtering the wallpaper');
assert(!baseCss.includes('boot-awakening:not(.boot-glass-stable) .dock'),
  'startup must not expose a temporary low-quality glass state');
const homeCss = await readFile(join(root, 'css/home.css'), 'utf8');
assert(!/\.search-engine-badge\s*\{[^}]*transition:[^}]*width/s.test(homeCss),
  'search focus must not animate the engine badge width');
assert(
  (homeCss.match(/var\(--transition-search-focus\)/g) || []).length >= 5,
  'search box focus properties should share one transition timeline',
);
assert(!/\.wallpaper-blur\s*\{[^}]*filter:/s.test(baseCss),
  'apps wallpaper effects should be baked into the preview bitmap');
assert(!/\.search-focus-overlay\s*\{[^}]*filter:/s.test(baseCss),
  'focus wallpaper effects should be baked into the preview bitmap');

page.on('pageerror', (err) => errors.push(err.message));
page.on('request', (request) => {
  const hostname = new URL(request.url()).hostname;
  if (hostname === 'suggestqueries.google.com' || hostname === 'api.bing.com') {
    completionRequests += 1;
  }
});
await page.addInitScript(() => {
  localStorage.setItem('startpage-github-sync-setup', JSON.stringify({
    version: 1,
    mode: 'local',
    completedAt: 1,
  }));
  window.__longTasks = [];
  window.__bootVisualFrames = [];
  new PerformanceObserver((list) => {
    window.__longTasks.push(...list.getEntries().map((entry) => entry.duration));
  }).observe({ type: 'longtask', buffered: true });
  Object.defineProperty(navigator, 'connection', {
    configurable: true,
    value: { saveData: true },
  });
  const startedAt = performance.now();
  const sampleBootVisuals = () => {
    const searchBox = document.getElementById('search-box');
    const dock = document.getElementById('dock');
    const appsLayer = document.getElementById('wallpaper-blur');
    const focusLayer = document.getElementById('search-focus-overlay');
    const clock = document.getElementById('clock');
    const dateText = document.getElementById('date-text');
    const weatherText = document.getElementById('weather-summary');
    const quote = document.getElementById('search-quote');
    const dockLetter = document.querySelector('.dock-link[data-dock-id="sci-hub"] .shortcut-icon--dock');
    if (searchBox && dock) {
      const searchFormStyle = getComputedStyle(document.getElementById('search-form'));
      const searchBoxStyle = getComputedStyle(searchBox);
      const clockStyle = clock ? getComputedStyle(clock) : null;
      const dockLetterStyle = dockLetter ? getComputedStyle(dockLetter) : null;
      window.__bootVisualFrames.push({
        searchVisible: searchFormStyle.visibility !== 'hidden',
        searchOpacity: Number(searchFormStyle.opacity),
        searchBackground: searchBoxStyle.backgroundColor,
        searchGlass: searchBoxStyle.backdropFilter,
        dockGlass: getComputedStyle(dock).backdropFilter,
        appsBackground: appsLayer?.style.backgroundImage || '',
        focusBackground: focusLayer?.style.backgroundImage || '',
        clockColor: clockStyle?.color || '',
        clockFont: clockStyle ? `${clockStyle.fontFamily}|${clockStyle.fontSize}|${clockStyle.fontWeight}` : '',
        dateText: dateText?.textContent || '',
        weatherText: weatherText?.textContent || '',
        quoteText: quote?.textContent || '',
        quoteOpacity: quote ? Number(getComputedStyle(quote).opacity) : 0,
        dockIcons: [...document.querySelectorAll('.dock-link .shortcut-icon')]
          .map((icon) => `${icon.className}|${icon.querySelector('img')?.getAttribute('src') || icon.textContent || ''}`)
          .join('||'),
        dockLetterStyle: dockLetterStyle
          ? `${dockLetterStyle.width}|${dockLetterStyle.height}|${dockLetterStyle.display}|${dockLetterStyle.backdropFilter}|${dockLetterStyle.borderRadius}`
          : '',
      });
    }
    if (
      !document.body.classList.contains('boot-glass-stable')
      && performance.now() - startedAt < 1600
    ) {
      requestAnimationFrame(sampleBootVisuals);
    }
  };
  requestAnimationFrame(sampleBootVisuals);
});

try {
  await page.route('https://**/*', (route) => route.abort());
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('boot-ui-settled'), null, {
    timeout: 8000,
  });
  await page.waitForSelector('#search-engine-badge[aria-label]', { timeout: 8000 });
  await page.waitForFunction(() => document.body.classList.contains('app-ready'), null, {
    timeout: 8000,
  });
  await page.waitForFunction(() => document.body.classList.contains('boot-glass-stable'), null, {
    timeout: 3000,
  });
  await page.waitForFunction(() => document.body.classList.contains('search-focused'), null, {
    timeout: 3000,
  });
  const bootEffectState = await page.evaluate(() => {
    const appsLayer = document.getElementById('wallpaper-blur')?.style.backgroundImage || '';
    const focusOverlay = document.getElementById('search-focus-overlay');
    const focusLayer = focusOverlay?.style.backgroundImage || '';
    return {
      effectsReady: document.body.classList.contains('wallpaper-effects-ready'),
      appsLayer,
      focusLayer,
      focusLiveFilter: focusOverlay?.classList.contains('wallpaper-effect-live-filter'),
    };
  });
  assert(
    bootEffectState.effectsReady
      && bootEffectState.focusLayer
      && (bootEffectState.focusLayer.includes('blob:') || bootEffectState.focusLiveFilter),
    `search focus must start with a complete wallpaper effect: ${JSON.stringify(bootEffectState)}`,
  );
  const focusedBackdropState = await page.evaluate(() => {
    const overlay = document.getElementById('search-focus-overlay');
    const bodyStyle = getComputedStyle(document.body);
    return {
      preview: overlay?.style.backgroundImage || '',
      previewScale: overlay ? getComputedStyle(overlay).transform : '',
      searchBackgroundToken: bodyStyle.getPropertyValue('--glass-search-bg-focus').trim(),
      stageColorToken: bodyStyle.getPropertyValue('--stage-color').trim(),
    };
  });
  assert(
    focusedBackdropState.preview
      && focusedBackdropState.previewScale !== 'none'
      && focusedBackdropState.searchBackgroundToken === 'rgba(38, 34, 44, 0.46)'
      && focusedBackdropState.stageColorToken === '#fff',
    `focused search must use a legible composited glass state: ${JSON.stringify(focusedBackdropState)}`,
  );
  const startupLoadedWallpaperLibraryUi = await page.evaluate(() =>
    performance.getEntriesByType('resource')
      .some((entry) => entry.name.endsWith('/js/wallpaper-library.js')));
  assert(!startupLoadedWallpaperLibraryUi,
    'wallpaper library UI must remain lazy during startup');
  await page.keyboard.press('Shift+Tab');
  assert(await page.evaluate(() => document.activeElement?.id === 'search-engine-badge'),
    'search engine button should be keyboard reachable');
  await page.keyboard.press('Enter');
  assert(await page.evaluate(() => !document.getElementById('search-engine-menu')?.hidden),
    'Enter should open the search engine menu');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  assert(await page.evaluate(() =>
    document.getElementById('search-engine-menu')?.hidden
      && document.activeElement?.id === 'search-input'),
  'keyboard provider selection should close the menu and restore search focus');
  const bootVisualState = await page.evaluate(() => {
    const visibleFrames = window.__bootVisualFrames.filter(
      (frame) => frame.searchVisible && frame.searchOpacity > 0.05,
    );
    const unique = (key) => [...new Set(visibleFrames.map((frame) => frame[key]).filter(Boolean))];
    return {
      searchGlass: unique('searchGlass'),
      searchOpacity: visibleFrames.map((frame) => frame.searchOpacity),
      searchBackground: unique('searchBackground'),
      dockGlass: unique('dockGlass'),
      appsBackground: unique('appsBackground'),
      focusBackground: unique('focusBackground'),
      clockColor: unique('clockColor'),
      clockFont: unique('clockFont'),
      dateText: unique('dateText'),
      weatherText: unique('weatherText'),
      quoteText: unique('quoteText'),
      quoteOpacity: visibleFrames.map((frame) => frame.quoteOpacity),
      dockIcons: unique('dockIcons'),
      dockLetterStyle: unique('dockLetterStyle'),
    };
  });
  assert(
    bootVisualState.searchGlass.length === 1 && bootVisualState.dockGlass.length === 1,
    `visible glass quality must remain constant during startup: ${JSON.stringify(bootVisualState)}`,
  );
  assert(
    Math.min(...bootVisualState.searchOpacity) >= 0.86
      && bootVisualState.searchBackground.every((color) => {
        const alpha = Number(color.match(/[\d.]+(?=\)$)/)?.[0] || 0);
        return alpha >= 0.4;
      }),
    `search glass must be substantial from its first visible frame: ${JSON.stringify(bootVisualState)}`,
  );
  assert(
    bootVisualState.appsBackground.length <= 1
      && bootVisualState.focusBackground.length <= 2
      && !bootVisualState.focusBackground.includes('none'),
    `effect layers must not expose a blank intermediate background: ${JSON.stringify(bootVisualState)}`,
  );
  assert(
    bootVisualState.clockColor.length === 1
      && bootVisualState.clockFont.length === 1
      && bootVisualState.dateText.every(Boolean)
      && bootVisualState.weatherText.length === 1
      && !bootVisualState.weatherText.includes('加载中…')
      && bootVisualState.quoteText.length === 1
      && bootVisualState.quoteText.every(Boolean)
      && bootVisualState.quoteOpacity.every((opacity) => opacity === 1),
    `visible startup typography must stay stable: ${JSON.stringify(bootVisualState)}`,
  );
  assert(
    bootVisualState.dockLetterStyle.length === 1 && bootVisualState.dockIcons.length === 1,
    `dock icons must stay visually stable after reveal: ${JSON.stringify(bootVisualState)}`,
  );
  const settingsLoadedAtStartup = await page.evaluate(() => performance.getEntriesByType('resource')
    .some((entry) => entry.name.endsWith('/js/settings-ui.js')));
  assert(!settingsLoadedAtStartup, 'settings module should not load on the home startup path');
  const intelligenceLoadedAtStartup = await page.evaluate(() => performance.getEntriesByType('resource')
    .some((entry) => /\/js\/(smart-input|currency)\.js$/.test(entry.name)));
  assert(!intelligenceLoadedAtStartup, 'search intelligence should not load before the first query');
  const weatherModalLoadedAtStartup = await page.evaluate(() => performance.getEntriesByType('resource')
    .some((entry) => entry.name.endsWith('/js/weather-modal.js')));
  assert(!weatherModalLoadedAtStartup, 'weather modal should not load on the home startup path');
  const delayedBingRoute = async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        url: 'assets/default-wallpaper.jpg',
        end_date: '20260726',
        title: 'Delayed Bing test wallpaper',
      }),
    });
  };
  await page.route('https://bing.biturl.top/**', delayedBingRoute);
  const wallpaperRace = await page.evaluate(async () => {
    const wallpaper = await import('./js/wallpaper.js');
    const before = { ...wallpaper.getCurrentWallpaper() };
    const storedSettings = localStorage.getItem('startpage-settings');
    const storedWallpaper = localStorage.getItem('startpage-wallpaper-last');
    const pendingRefresh = wallpaper.loadWallpaper('bing', { force: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await wallpaper.applySelectedWallpaper({
      id: 'race-selected-wallpaper',
      source: 'library',
      type: 'gradient',
      css: 'linear-gradient(135deg, #30475e, #9b6a6c)',
      title: 'Race winner',
    });
    await pendingRefresh;
    const winner = wallpaper.getCurrentWallpaper().id;
    wallpaper.applyWallpaper(before, { adaptImmediate: true });
    if (storedSettings == null) localStorage.removeItem('startpage-settings');
    else localStorage.setItem('startpage-settings', storedSettings);
    if (storedWallpaper == null) localStorage.removeItem('startpage-wallpaper-last');
    else localStorage.setItem('startpage-wallpaper-last', storedWallpaper);
    return winner;
  });
  await page.unroute('https://bing.biturl.top/**', delayedBingRoute);
  assert(
    wallpaperRace === 'race-selected-wallpaper',
    `a delayed wallpaper refresh must not overwrite the latest user selection: ${wallpaperRace}`,
  );

  const selectedWallpaperRoute = async (route) => {
    if (route.request().url().includes('/slow.jpg')) {
      await new Promise((resolve) => setTimeout(resolve, 140));
    }
    await route.fulfill({
      contentType: 'image/jpeg',
      headers: { 'access-control-allow-origin': '*' },
      body: defaultWallpaperBytes,
    });
  };
  await page.route('https://selection-race.example.test/**', selectedWallpaperRoute);
  const selectedWallpaperRace = await page.evaluate(async () => {
    const wallpaper = await import('./js/wallpaper.js');
    const before = { ...wallpaper.getCurrentWallpaper() };
    const storedSettings = localStorage.getItem('startpage-settings');
    const storedWallpaper = localStorage.getItem('startpage-wallpaper-last');
    const slow = wallpaper.applySelectedWallpaper({
      id: 'slow-library-selection',
      source: 'library',
      type: 'image',
      url: 'https://selection-race.example.test/slow.jpg',
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const fast = wallpaper.applySelectedWallpaper({
      id: 'latest-library-selection',
      source: 'library',
      type: 'image',
      url: 'https://selection-race.example.test/fast.jpg',
    });
    await Promise.allSettled([slow, fast]);
    const winner = wallpaper.getCurrentWallpaper().id;
    wallpaper.applyWallpaper(before, { skipPersist: true, adaptImmediate: true });
    if (storedSettings == null) localStorage.removeItem('startpage-settings');
    else localStorage.setItem('startpage-settings', storedSettings);
    if (storedWallpaper == null) localStorage.removeItem('startpage-wallpaper-last');
    else localStorage.setItem('startpage-wallpaper-last', storedWallpaper);
    return winner;
  });
  await page.unroute('https://selection-race.example.test/**', selectedWallpaperRoute);
  assert(
    selectedWallpaperRace === 'latest-library-selection',
    `only the latest explicit wallpaper selection may commit: ${selectedWallpaperRace}`,
  );

  const wallpaperThemePersistence = await page.evaluate(async () => {
    const wallpaper = await import('./js/wallpaper.js');
    const before = { ...wallpaper.getCurrentWallpaper() };
    const storedSettings = localStorage.getItem('startpage-settings');
    const storedWallpaper = localStorage.getItem('startpage-wallpaper-last');
    await wallpaper.applySelectedWallpaper({
      id: 'theme-persistence-gradient',
      source: 'library',
      type: 'gradient',
      css: 'linear-gradient(135deg, #eef2f5, #d9e0e8)',
      luminance: 232,
    });
    await wallpaper.adaptTextToWallpaper(wallpaper.getCurrentWallpaper());
    const persisted = JSON.parse(localStorage.getItem('startpage-wallpaper-last') || 'null');
    const bodyTheme = document.body.dataset.textTheme;
    wallpaper.applyWallpaper(before, { skipPersist: true, adaptImmediate: true });
    if (storedSettings == null) localStorage.removeItem('startpage-settings');
    else localStorage.setItem('startpage-settings', storedSettings);
    if (storedWallpaper == null) localStorage.removeItem('startpage-wallpaper-last');
    else localStorage.setItem('startpage-wallpaper-last', storedWallpaper);
    return {
      theme: persisted?.textTheme,
      luminance: persisted?.luminance,
      bodyTheme,
    };
  });
  assert(
    wallpaperThemePersistence.theme === 'on-light'
      && wallpaperThemePersistence.luminance === 232
      && wallpaperThemePersistence.bodyTheme === 'on-light',
    `wallpaper theme analysis must persist before the next startup: ${JSON.stringify(wallpaperThemePersistence)}`,
  );

  let nextWallpaperCase = 'success';
  const nextWallpaperApiRoute = (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      url: `https://images.example.test/${nextWallpaperCase}-hi.jpg`,
      end_date: nextWallpaperCase === 'success' ? '20260730' : '20260729',
      title: `${nextWallpaperCase} wallpaper`,
    }),
  });
  const nextWallpaperImageRoute = (route) => {
    const requestUrl = new URL(route.request().url());
    const isPreview = requestUrl.searchParams.has('w');
    if (nextWallpaperCase === 'success' || isPreview) {
      return route.fulfill({
        contentType: 'image/jpeg',
        headers: { 'access-control-allow-origin': '*' },
        body: defaultWallpaperBytes,
      });
    }
    return route.abort();
  };
  await page.route('https://images.example.test/**', nextWallpaperImageRoute);
  await page.route('https://bing.biturl.top/**', nextWallpaperApiRoute);
  await page.evaluate(async () => {
    const wallpaper = await import('./js/wallpaper.js');
    window.__wallpaperSwitchTest = {
      current: { ...wallpaper.getCurrentWallpaper() },
      settings: localStorage.getItem('startpage-settings'),
      meta: localStorage.getItem('startpage-wallpaper-last'),
    };
    await wallpaper.loadNextWallpaper();
  });
  await page.waitForFunction(() => {
    const meta = JSON.parse(localStorage.getItem('startpage-wallpaper-last') || 'null');
    return meta?.url?.includes('/success-hi.jpg') && !meta.url.includes('w=');
  });
  const successfulSwitch = await page.evaluate(() => ({
    currentUrl: document.getElementById('wallpaper-img')?.getAttribute('src') || '',
    storedUrl: JSON.parse(localStorage.getItem('startpage-wallpaper-last') || 'null')?.url || '',
  }));
  assert(
    successfulSwitch.currentUrl.includes('/success-hi.jpg')
      && !successfulSwitch.currentUrl.includes('w=')
      && successfulSwitch.storedUrl === successfulSwitch.currentUrl,
    `a completed wallpaper switch must persist the final image: ${JSON.stringify(successfulSwitch)}`,
  );

  nextWallpaperCase = 'failure';
  await page.evaluate(async () => {
    const wallpaper = await import('./js/wallpaper.js');
    await wallpaper.loadNextWallpaper();
  });
  await page.waitForFunction(() => {
    const meta = JSON.parse(localStorage.getItem('startpage-wallpaper-last') || 'null');
    return meta?.url?.includes('/failure-hi.jpg') && meta.url.includes('w=');
  });
  const failedSwitch = await page.evaluate(() => ({
    currentUrl: document.getElementById('wallpaper-img')?.getAttribute('src') || '',
    storedUrl: JSON.parse(localStorage.getItem('startpage-wallpaper-last') || 'null')?.url || '',
  }));
  assert(
    failedSwitch.currentUrl.includes('/failure-hi.jpg')
      && failedSwitch.currentUrl.includes('w=')
      && failedSwitch.storedUrl === failedSwitch.currentUrl,
    `a failed high-resolution upgrade must retain its decoded preview: ${JSON.stringify(failedSwitch)}`,
  );
  await page.evaluate(() => {
    const state = window.__wallpaperSwitchTest;
    delete window.__wallpaperSwitchTest;
    return import('./js/wallpaper.js').then((wallpaper) => {
      wallpaper.applyWallpaper(state.current, { skipPersist: true, adaptImmediate: true });
      if (state.settings == null) localStorage.removeItem('startpage-settings');
      else localStorage.setItem('startpage-settings', state.settings);
      if (state.meta == null) localStorage.removeItem('startpage-wallpaper-last');
      else localStorage.setItem('startpage-wallpaper-last', state.meta);
    });
  });
  await page.unroute('https://images.example.test/**', nextWallpaperImageRoute);
  await page.unroute('https://bing.biturl.top/**', nextWallpaperApiRoute);

  const lifecycleSafety = await page.evaluate(async () => {
    const [{ createFeatureRegistry }, dialogs, { createWallpaperEffects }, lifecycle, wallpaperLibrary, wallpaperFetch] = await Promise.all([
      import('./js/feature-registry.js'),
      import('./js/dialog-ui.js'),
      import('./js/wallpaper-effects.js'),
      import('./js/lifecycle.js'),
      import('./js/wallpaper-library.js'),
      import('./js/wallpaper-fetch.js'),
    ]);
    let attempts = 0;
    const registry = createFeatureRegistry({
      retryable: {
        load: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error('expected test failure');
          return { value: 42 };
        },
      },
    });
    await registry.load('retryable').catch(() => null);
    const retryValue = await registry.load('retryable');

    const dialog = document.getElementById('shortcuts-dialog');
    dialogs.openDialog(dialog);
    dialogs.closeDialog(dialog);
    await new Promise((resolve) => setTimeout(resolve, 40));

    const effectLayers = [
      document.getElementById('wallpaper-blur'),
      document.getElementById('search-focus-overlay'),
    ].filter(Boolean);
    const previousBackgrounds = effectLayers.map((layer) => layer.style.backgroundImage);
    let stalePreviewCompletions = 0;
    const effects = createWallpaperEffects({
      createFocusPreview: async () => {
        await Promise.resolve();
        stalePreviewCompletions += 1;
        return new Blob(['stale-focus-preview'], { type: 'image/jpeg' });
      },
    });
    effects.sync({ url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==' });
    effects.dispose();
    await Promise.resolve();
    await Promise.resolve();
    const stalePreviewApplied = effectLayers.some((layer) =>
      layer.style.backgroundImage.includes('stale-'));
    effectLayers.forEach((layer, index) => {
      layer.style.backgroundImage = previousBackgrounds[index];
    });

    const mediaStore = await import('./js/media-store.js');
    const persistentEffectKey = 'regression-focus-effect-v2';
    const persistentBlob = await fetch('assets/default-wallpaper-preview.jpg')
      .then((response) => response.blob());
    await mediaStore.saveWallpaperEffectBlobCache(
      persistentEffectKey,
      persistentBlob,
    );
    const focusWasActive = document.body.classList.contains('search-focused');
    document.body.classList.remove('search-focused');
    let persistentPreviewCreates = 0;
    const persistentEffects = createWallpaperEffects({
      createFocusPreview: async () => {
        persistentPreviewCreates += 1;
        return persistentBlob;
      },
      getPersistentKey: () => persistentEffectKey,
      loadPersistentPreview: mediaStore.getWallpaperEffectBlobCache,
      savePersistentPreview: mediaStore.saveWallpaperEffectBlobCache,
    });
    await persistentEffects.sync({ url: 'data:image/jpeg;base64,AA==', effectKey: 'persistent' });
    const persistentPreviewApplied = document.getElementById('search-focus-overlay')
      ?.style.backgroundImage.includes('blob:');
    persistentEffects.dispose();
    effectLayers.forEach((layer, index) => {
      layer.style.backgroundImage = previousBackgrounds[index];
    });

    const damagedEffectKey = 'regression-damaged-effect-v2';
    await mediaStore.saveWallpaperEffectBlobCache(
      damagedEffectKey,
      new Blob(['not-an-image'], { type: 'image/jpeg' }),
    );
    let damagedPreviewCreates = 0;
    const damagedEffects = createWallpaperEffects({
      createFocusPreview: async () => {
        damagedPreviewCreates += 1;
        return persistentBlob;
      },
      getPersistentKey: () => damagedEffectKey,
      loadPersistentPreview: mediaStore.getWallpaperEffectBlobCache,
      savePersistentPreview: mediaStore.saveWallpaperEffectBlobCache,
    });
    await damagedEffects.sync({ url: 'assets/default-wallpaper-preview.jpg', effectKey: 'damaged' });
    damagedEffects.dispose();
    if (focusWasActive) document.body.classList.add('search-focused');

    const enqueue = lifecycle.createAsyncQueue();
    let activeTasks = 0;
    let maxActiveTasks = 0;
    const queueOrder = [];
    await Promise.all([1, 2, 3].map((id) => enqueue(async () => {
      activeTasks += 1;
      maxActiveTasks = Math.max(maxActiveTasks, activeTasks);
      await new Promise((resolve) => setTimeout(resolve, 8 - id));
      queueOrder.push(id);
      activeTasks -= 1;
    })));
    const libraryEntry = {
      id: 'library-url-lifecycle-test',
      blob: new Blob(['wallpaper'], { type: 'image/jpeg' }),
      type: 'image',
    };
    const firstLibraryUrl = wallpaperLibrary.libraryEntryToWallpaper(libraryEntry).url;
    const secondLibraryUrl = wallpaperLibrary.libraryEntryToWallpaper(libraryEntry).url;
    const iconKey = 'https://example.com/lifecycle-icon.png';
    await wallpaperLibrary.saveIconBlobCache(
      iconKey,
      new Blob(['icon'], { type: 'image/png' }),
    );
    const [firstIconUrl, secondIconUrl] = await Promise.all([
      wallpaperLibrary.getIconObjectUrl(iconKey),
      wallpaperLibrary.getIconObjectUrl(iconKey),
    ]);

    const favoriteKey = 'startpage-wallpaper-favorites';
    const settingsKey = 'startpage-settings';
    const previousFavorites = localStorage.getItem(favoriteKey);
    const previousSettings = localStorage.getItem(settingsKey);
    const recoveredId = 'library-favorite-recovery-test';
    await wallpaperLibrary.saveWallpaperToLibrary({
      id: recoveredId,
      blob: persistentBlob,
      type: 'image',
      title: 'Recovered local favorite',
      savedAt: Date.now(),
    });
    localStorage.setItem(favoriteKey, JSON.stringify([{
      id: recoveredId,
      source: 'library',
      type: 'image',
      url: 'blob:expired-session-url',
    }]));
    localStorage.setItem(settingsKey, JSON.stringify({
      ...(previousSettings ? JSON.parse(previousSettings) : {}),
      wallpaperSource: 'library',
      wallpaperId: recoveredId,
    }));
    const recoveredFavorite = await wallpaperFetch.fetchWallpaperData('library');
    await wallpaperLibrary.removeLibraryWallpaper(recoveredId);
    if (previousFavorites == null) localStorage.removeItem(favoriteKey);
    else localStorage.setItem(favoriteKey, previousFavorites);
    if (previousSettings == null) localStorage.removeItem(settingsKey);
    else localStorage.setItem(settingsKey, previousSettings);

    return {
      attempts,
      retryValue: retryValue.value,
      retryStatus: registry.getStatus('retryable').status,
      cancelledDialogOpen: dialog.open,
      stalePreviewCompletions,
      stalePreviewApplied,
      persistentPreviewCreates,
      persistentPreviewApplied,
      damagedPreviewCreates,
      maxActiveTasks,
      queueOrder,
      stableLibraryUrl: firstLibraryUrl === secondLibraryUrl && firstLibraryUrl.startsWith('blob:'),
      stableIconUrl: firstIconUrl === secondIconUrl && firstIconUrl.startsWith('blob:'),
      recoveredLibraryFavorite: recoveredFavorite?.id === recoveredId
        && recoveredFavorite.url.startsWith('blob:')
        && recoveredFavorite.url !== 'blob:expired-session-url',
    };
  });
  assert(
    lifecycleSafety.attempts === 2
      && lifecycleSafety.retryValue === 42
      && lifecycleSafety.retryStatus === 'ready',
    `failed feature loads should remain retryable: ${JSON.stringify(lifecycleSafety)}`,
  );
  assert(!lifecycleSafety.cancelledDialogOpen,
    'closing a dialog while its stylesheet loads must cancel the pending open');
  assert(
    lifecycleSafety.stalePreviewCompletions === 1 && !lifecycleSafety.stalePreviewApplied,
    `disposed wallpaper effects must reject late previews: ${JSON.stringify(lifecycleSafety)}`,
  );
  assert(
    lifecycleSafety.persistentPreviewCreates === 0 && lifecycleSafety.persistentPreviewApplied,
    `wallpaper effects should reuse their cross-tab cache: ${JSON.stringify(lifecycleSafety)}`,
  );
  assert(
    lifecycleSafety.damagedPreviewCreates === 1,
    `damaged wallpaper effects must regenerate instead of poisoning later tabs: ${JSON.stringify(lifecycleSafety)}`,
  );
  assert(
    lifecycleSafety.maxActiveTasks === 1 && lifecycleSafety.queueOrder.join(',') === '1,2,3',
    `serialized async work must preserve mutation order: ${JSON.stringify(lifecycleSafety)}`,
  );
  assert(lifecycleSafety.stableLibraryUrl,
    'the selected library wallpaper should not reuse a disposable thumbnail URL');
  assert(lifecycleSafety.stableIconUrl,
    'cached shortcut icons should reuse one session-scoped object URL');
  assert(lifecycleSafety.recoveredLibraryFavorite,
    'local-library favorites must recover their IndexedDB image instead of a stale blob URL');
  await page.evaluate(async () => {
    const library = await import('./js/wallpaper-library.js');
    await library.saveWallpaperToLibrary({
      id: 'library-ui-selection-test',
      blob: await fetch('assets/default-wallpaper-preview.jpg').then((response) => response.blob()),
      type: 'image',
      title: 'Regression local wallpaper',
      savedAt: Date.now(),
    });
    window.__libraryUiSelected = null;
    const controller = library.initWallpaperLibrary({
      getCurrentWallpaper: () => ({}),
      applySelectedWallpaper: async (payload) => {
        window.__libraryUiSelected = { id: payload.id, url: payload.url };
      },
    });
    controller.open();
  });
  await page.locator('[data-wallpaper-tab="library"]').click();
  const localLibraryThumb = page.locator(
    '#wallpaper-library-dialog[open] .wallpaper-thumb[title="Regression local wallpaper"]',
  );
  await localLibraryThumb.waitFor({ timeout: 3000 });
  await localLibraryThumb.click();
  await page.waitForFunction(() => window.__libraryUiSelected?.id === 'library-ui-selection-test');
  const libraryUiSelection = await page.evaluate(async () => {
    const selected = window.__libraryUiSelected;
    delete window.__libraryUiSelected;
    const library = await import('./js/wallpaper-library.js');
    await library.removeLibraryWallpaper('library-ui-selection-test');
    return selected;
  });
  assert(
    libraryUiSelection.url.startsWith('blob:'),
    `library UI must resolve the original IndexedDB image before applying it: ${JSON.stringify(libraryUiSelection)}`,
  );
  const wallpaperThemes = await page.evaluate(async () => {
    const { analyzeWallpaperTheme } = await import('./js/wallpaper-theme.js');
    const makeWallpaper = (paint) => {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const ctx = canvas.getContext('2d');
      paint(ctx, canvas);
      return canvas.toDataURL('image/png');
    };
    const light = makeWallpaper((ctx, canvas) => {
      ctx.fillStyle = '#f4f6f8';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    });
    const dark = makeWallpaper((ctx, canvas) => {
      ctx.fillStyle = '#181b22';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    });
    const mixed = makeWallpaper((ctx, canvas) => {
      ctx.fillStyle = '#11151c';
      ctx.fillRect(0, 0, canvas.width / 2, canvas.height);
      ctx.fillStyle = '#f0f3f6';
      ctx.fillRect(canvas.width / 2, 0, canvas.width / 2, canvas.height);
    });
    const analyses = await Promise.all([
      analyzeWallpaperTheme(light),
      analyzeWallpaperTheme(dark),
      analyzeWallpaperTheme(mixed),
    ]);
    return analyses.map((analysis) => analysis.theme);
  });
  assert(
    wallpaperThemes.join(',') === 'on-light,on-dark,on-mixed',
    `wallpaper text themes must cover light, dark, and mixed scenes: ${wallpaperThemes}`,
  );
  const wallpaperTextContrast = await page.evaluate(() => {
    const body = document.body;
    const previousTheme = body.dataset.textTheme;
    const previousTone = body.dataset.textTone;
    const wasFocused = body.classList.contains('search-focused');
    body.classList.remove('search-focused');
    body.dataset.textTheme = 'on-light';
    body.dataset.textTone = 'dark';
    const bodyStyle = getComputedStyle(body);
    const probe = document.createElement('input');
    probe.className = 'search-input';
    probe.placeholder = '搜索';
    body.appendChild(probe);
    const input = getComputedStyle(probe);
    const placeholder = getComputedStyle(probe, '::placeholder');
    const result = {
      stageColor: bodyStyle.getPropertyValue('--stage-color').trim(),
      stageShadow: bodyStyle.getPropertyValue('--stage-shadow').trim(),
      inputColor: input.color,
      placeholderColor: placeholder.color,
    };
    probe.remove();
    body.dataset.textTheme = previousTheme;
    body.dataset.textTone = previousTone;
    body.classList.toggle('search-focused', wasFocused);
    return result;
  });
  assert(
    wallpaperTextContrast.stageColor === '#fff'
      && wallpaperTextContrast.stageShadow.includes('rgba(0, 0, 0, 0.62)')
      && wallpaperTextContrast.inputColor === 'rgba(255, 255, 255, 0.96)'
      && wallpaperTextContrast.placeholderColor === 'rgba(255, 255, 255, 0.7)',
    `wallpaper typography must stay legible on mixed light scenes: ${JSON.stringify(wallpaperTextContrast)}`,
  );
  const shortcutIconPolicy = await page.evaluate(async () => {
    const [favicon, shortcuts] = await Promise.all([
      import('./js/favicon.js'),
      import('./js/shortcuts.js'),
    ]);
    const storedShortcuts = localStorage.getItem('startpage-shortcuts');
    const storedDock = localStorage.getItem('startpage-dock');
    localStorage.setItem('startpage-shortcuts', JSON.stringify([
      {
        id: 'zhihu-policy',
        name: '知乎',
        url: 'https://www.zhihu.com',
        icon: 'https://static.zhihu.com/heifetz/favicon.ico',
      },
      {
        id: 'flomo-policy',
        name: 'flomo',
        url: 'https://v.flomoapp.com/mine',
        icon: 'https://flomoapp.com/favicon.ico',
      },
      {
        id: 'netease-policy',
        name: '网易云音乐',
        url: 'https://music.163.com',
        icon: favicon.NETEASE_ICON_URL,
      },
    ]));
    const cleaned = shortcuts.loadShortcuts();
    if (storedShortcuts == null) localStorage.removeItem('startpage-shortcuts');
    else localStorage.setItem('startpage-shortcuts', storedShortcuts);
    if (storedDock == null) localStorage.removeItem('startpage-dock');
    else localStorage.setItem('startpage-dock', storedDock);
    return {
      zhihu: cleaned.find((item) => item.id === 'zhihu-policy'),
      flomo: cleaned.find((item) => item.id === 'flomo-policy'),
      netease: cleaned.find((item) => item.id === 'netease-policy'),
      plainSvgRejected: favicon.isUnacceptableStoredIcon(
        'https://alphaxiv.org/favicon.svg',
        'https://alphaxiv.org',
      ),
    };
  });
  assert(
    !shortcutIconPolicy.zhihu.icon
      && shortcutIconPolicy.zhihu.letter === '知'
      && !shortcutIconPolicy.flomo.icon
      && shortcutIconPolicy.flomo.letter === 'F'
      && shortcutIconPolicy.netease.icon
      && shortcutIconPolicy.plainSvgRejected,
    `incomplete favicons must fall back to glass avatars: ${JSON.stringify(shortcutIconPolicy)}`,
  );
  const wallpaperUrlKinds = await page.evaluate(async () => {
    const [data, image] = await Promise.all([
      import('./js/wallpaper-data.js'),
      import('./js/wallpaper-image.js'),
    ]);
    return {
      absolute: data.absoluteBingUrl('//www.bing.com/th?id=OHR.Test_UHD.jpg'),
      remote: image.isRemoteWallpaperUrl('//www.bing.com/th?id=OHR.Test_UHD.jpg'),
      local: image.isLocalWallpaperUrl('assets/default-wallpaper.jpg'),
    };
  });
  assert(
    wallpaperUrlKinds.absolute === 'https://www.bing.com/th?id=OHR.Test_UHD.jpg'
      && wallpaperUrlKinds.remote
      && wallpaperUrlKinds.local,
    `wallpaper URLs must distinguish protocol-relative remotes from packaged assets: ${JSON.stringify(wallpaperUrlKinds)}`,
  );
  const baseline = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    const mark = (name) => Math.round(performance.getEntriesByName(name)[0]?.startTime || 0);
    return {
      domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
      bootSettledMs: Math.round(performance.now()),
      appReadyMs: mark('gavinhub:app-ready'),
      uiSettledMs: mark('gavinhub:ui-settled'),
      glassStableMs: mark('gavinhub:glass-stable'),
      searchFocusedMs: mark('gavinhub:search-focused'),
      localResources: resources.filter((entry) => entry.name.startsWith(location.origin)).length,
      longTasks: window.__longTasks.length,
      maxLongTaskMs: Math.round(Math.max(0, ...window.__longTasks)),
    };
  });

  assert(await page.locator('#clock').isVisible(), 'clock should be visible');
  assert(await page.locator('#search-input').isVisible(), 'search should be visible');
  assert(await page.locator('#dock').isVisible(), 'dock should be visible');
  const activeFeatureStylesAtStartup = await page.evaluate(() =>
    [...document.querySelectorAll('link[data-active-style]')]
      .map((link) => link.dataset.activeStyle)
      .filter((id) => ['settings', 'calendar', 'weather'].includes(id)));
  assert(
    activeFeatureStylesAtStartup.length === 0,
    `feature dialog styles should remain idle at startup: ${activeFeatureStylesAtStartup}`,
  );

  await page.locator('#weather-trigger').click();
  await page.waitForSelector('#weather-dialog[open]', { timeout: 1000 });
  assert(
    await page.evaluate(() => performance.getEntriesByType('resource')
      .some((entry) => entry.name.endsWith('/js/weather-modal.js'))),
    'opening weather should activate its modal module',
  );
  const activeStylesAfterWeather = await page.evaluate(() =>
    [...document.querySelectorAll('link[data-active-style]')]
      .map((link) => link.dataset.activeStyle));
  assert(
    activeStylesAfterWeather.includes('dialogs')
      && activeStylesAfterWeather.includes('weather')
      && !activeStylesAfterWeather.includes('calendar')
      && !activeStylesAfterWeather.includes('settings'),
    `weather should activate only its dialog styles: ${activeStylesAfterWeather}`,
  );
  await page.locator('#weather-dialog .modal-close').click();
  await page.waitForFunction(() => !document.getElementById('weather-dialog')?.open);

  for (const dialogId of ['calendar-dialog']) {
    await page.evaluate(async (id) => {
      const { openDialog } = await import('./js/dialog-ui.js');
      openDialog(id);
    }, dialogId);
    await page.waitForSelector(`#${dialogId}[open]`);
    assert(
      await page.evaluate(() => Boolean(document.querySelector('link[data-active-style="calendar"]'))),
      'calendar should activate its feature stylesheet',
    );
    await page.locator(`#${dialogId} .modal-close`).first().click();
    await page.waitForFunction((id) => !document.getElementById(id)?.open, dialogId);
    const closedState = await page.locator(`#${dialogId}`).evaluate((dialog) => ({
      display: getComputedStyle(dialog).display,
      open: dialog.open,
    }));
    assert(closedState.open === false && closedState.display === 'none',
      `${dialogId} should disappear cleanly after close: ${JSON.stringify(closedState)}`);
  }

  const dataBoundarySafety = await page.evaluate(async () => {
    const shortcutsKey = 'startpage-shortcuts';
    const weatherDataKey = 'startpage-weather-data';
    const weatherLocKey = 'startpage-weather-loc';
    const previousShortcuts = localStorage.getItem(shortcutsKey);
    const previousWeather = localStorage.getItem(weatherDataKey);
    const previousLocation = localStorage.getItem(weatherLocKey);
    const previousTodos = localStorage.getItem('startpage-todos');
    const previousGoals = localStorage.getItem('startpage-goals');
    const originalFetch = window.fetch;

    try {
      localStorage.setItem(shortcutsKey, JSON.stringify([
        { id: 'unsafe', name: 'Unsafe', url: 'javascript:alert(1)' },
        { id: 'valid', name: 'Valid', url: 'example.com/path' },
      ]));
      const shortcuts = await import('./js/shortcuts.js');
      const sanitized = shortcuts.loadShortcuts();
      const persisted = JSON.parse(localStorage.getItem(shortcutsKey) || '[]');

      localStorage.setItem('startpage-todos', JSON.stringify([
        null,
        { id: 'missing-date', text: 'invalid' },
        { id: 'safe-todo', text: 'kept', startDate: '2026-07-26', endDate: 'invalid' },
      ]));
      localStorage.setItem('startpage-goals', JSON.stringify([
        null,
        { id: 'external-id', title: 'kept goal', targetDate: 'invalid', progress: 'oops' },
      ]));
      const [{ loadTodos }, { loadGoals }] = await Promise.all([
        import('./js/todos.js'),
        import('./js/goals.js'),
      ]);
      const sanitizedTodos = loadTodos();
      const sanitizedGoals = loadGoals();
      await Promise.resolve();
      const persistedTodos = JSON.parse(localStorage.getItem('startpage-todos') || '[]');
      const persistedGoals = JSON.parse(localStorage.getItem('startpage-goals') || '[]');

      localStorage.setItem(weatherDataKey, JSON.stringify({
        updatedAt: Date.now(),
        data: { current: null, daily: null },
      }));
      const weather = await import('./js/weather.js');
      const invalidWeatherCacheRejected = weather.getCachedWeather() == null;
      localStorage.removeItem(weatherDataKey);
      localStorage.removeItem(weatherLocKey);
      const requests = [];
      window.fetch = async (input) => {
        const requestUrl = String(input?.url || input);
        requests.push(requestUrl);
        if (requestUrl.includes('bigdatacloud.net')) {
          return new Response(JSON.stringify({
            latitude: 22.54,
            longitude: 113.94,
            locality: '测试区',
            city: '测试市',
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (requestUrl.includes('open-meteo.com')) {
          return new Response(JSON.stringify({
            current: { weather_code: 0, temperature_2m: 25 },
            hourly: { time: [] },
            daily: {
              time: [],
              weather_code: [],
              temperature_2m_max: [],
              temperature_2m_min: [],
            },
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        throw new Error(`unexpected request: ${requestUrl}`);
      };
      const [firstWeather, secondWeather] = await Promise.all([
        weather.loadWeather(),
        weather.loadWeather(),
      ]);

      return {
        shortcutIds: sanitized.map((item) => item.id),
        validUrl: sanitized[0]?.url,
        persistedIds: persisted.map((item) => item.id),
        todoIds: sanitizedTodos.map((item) => item.id),
        todoEndDate: sanitizedTodos[0]?.endDate,
        persistedTodoIds: persistedTodos.map((item) => item.id),
        goalIds: sanitizedGoals.map((item) => item.id),
        goalTargetDate: sanitizedGoals[0]?.targetDate,
        persistedGoalIds: persistedGoals.map((item) => item.id),
        weatherRequests: requests.length,
        weatherSharedResult: firstWeather === secondWeather,
        invalidWeatherCacheRejected,
      };
    } finally {
      window.fetch = originalFetch;
      if (previousShortcuts == null) localStorage.removeItem(shortcutsKey);
      else localStorage.setItem(shortcutsKey, previousShortcuts);
      if (previousWeather == null) localStorage.removeItem(weatherDataKey);
      else localStorage.setItem(weatherDataKey, previousWeather);
      if (previousLocation == null) localStorage.removeItem(weatherLocKey);
      else localStorage.setItem(weatherLocKey, previousLocation);
      if (previousTodos == null) localStorage.removeItem('startpage-todos');
      else localStorage.setItem('startpage-todos', previousTodos);
      if (previousGoals == null) localStorage.removeItem('startpage-goals');
      else localStorage.setItem('startpage-goals', previousGoals);
    }
  });
  assert(
    dataBoundarySafety.shortcutIds.join(',') === 'valid'
      && dataBoundarySafety.validUrl === 'https://example.com/path'
      && dataBoundarySafety.persistedIds.join(',') === 'valid'
      && dataBoundarySafety.todoIds.join(',') === 'safe-todo'
      && dataBoundarySafety.todoEndDate === '2026-07-26'
      && dataBoundarySafety.persistedTodoIds.join(',') === 'safe-todo'
      && dataBoundarySafety.goalIds.join(',') === 'external-id'
      && dataBoundarySafety.goalTargetDate === ''
      && dataBoundarySafety.persistedGoalIds.join(',') === 'external-id'
      && dataBoundarySafety.weatherRequests === 2
      && dataBoundarySafety.weatherSharedResult
      && dataBoundarySafety.invalidWeatherCacheRejected,
    `import boundaries and weather requests must be deterministic: ${JSON.stringify(dataBoundarySafety)}`,
  );

  const todoPersistenceRetry = await page.evaluate(async () => {
    const { createTodoStore } = await import('./js/todo-store.js');
    const key = 'gavinhub-todo-retry-test';
    const originalSetItem = Storage.prototype.setItem;
    const store = createTodoStore({
      key,
      migrate: (raw) => (Array.isArray(raw) ? raw : []),
    });
    try {
      Storage.prototype.setItem = function setItem(storageKey, value) {
        if (storageKey === key) throw new DOMException('quota test', 'QuotaExceededError');
        return originalSetItem.call(this, storageKey, value);
      };
      store.set([{ id: 1, text: 'retry me' }]);
      await Promise.resolve();
    } finally {
      Storage.prototype.setItem = originalSetItem;
    }
    const retried = store.flush();
    const persisted = JSON.parse(localStorage.getItem(key) || '[]');
    localStorage.removeItem(key);
    return { retried, persistedText: persisted[0]?.text };
  });
  assert(
    todoPersistenceRetry.retried && todoPersistenceRetry.persistedText === 'retry me',
    `failed todo persistence must remain retryable: ${JSON.stringify(todoPersistenceRetry)}`,
  );

  const syncSafety = await page.evaluate(async () => {
    localStorage.setItem('startpage-sync-local-at', '100');
    const storage = await import('./js/storage.js');
    storage.writeJson('startpage-todos', []);
    const mutationAt = Number(localStorage.getItem('startpage-sync-local-at'));
    const futureRevision = Date.now() + 7 * 24 * 60 * 60 * 1000;
    localStorage.setItem('startpage-sync-local-at', String(futureRevision));
    localStorage.setItem('startpage-sync-revisions', JSON.stringify({
      'startpage-todos': futureRevision,
    }));
    storage.writeJson('startpage-todos', []);
    const skewSafeRevision = Number(JSON.parse(
      localStorage.getItem('startpage-sync-revisions') || '{}',
    )['startpage-todos']);

    localStorage.setItem('startpage-github-token', 'ghp_saved_token');
    localStorage.setItem('startpage-github-gist-id', 'working-gist');
    localStorage.setItem('startpage-github-gist-baseline', 'working-gist');
    const credentials = await import('./js/credential-store.js');
    credentials.clearCredentialCache();
    const coordinator = await import('./js/sync-coordinator.js');
    try {
      await coordinator.configureGithubSync({
        token: 'ghp_replacement_token',
        gistId: 'network-test',
      });
    } catch { /* the test aborts external requests */ }
    const github = await import('./js/github-sync.js');
    const savedConnection = await github.loadGithubSyncConfig();
    const savedBaseline = localStorage.getItem('startpage-github-gist-baseline');
    localStorage.removeItem('startpage-github-token');
    localStorage.removeItem('startpage-github-gist-id');
    localStorage.removeItem('startpage-github-gist-baseline');
    credentials.clearCredentialCache();
    const sync = await import('./js/sync.js');
    let periodicRuns = 0;
    let periodicApplied = 0;
    const stopPeriodic = sync.startPeriodicSync({
      intervalMs: 30,
      runImmediately: true,
      syncTask: async () => ({ applied: ++periodicRuns === 1 }),
      onApplied: () => { periodicApplied += 1; },
    });
    await new Promise((resolve) => setTimeout(resolve, 85));
    stopPeriodic();
    const smart = await import('./js/smart-input.js');
    const arxiv = smart.buildSmartSuggestions('arxiv graph neural network', {});
    const scholar = smart.buildSmartSuggestions('gs graph neural network', {});
    const local = {
      v: 2,
      updatedAt: 200,
      revisions: {
        'startpage-todos': 200,
        'startpage-shortcuts': 100,
      },
      'startpage-todos': [{ id: 1, text: 'local todo' }],
      'startpage-shortcuts': [{ id: 'old-local' }],
    };
    const remote = {
      v: 2,
      updatedAt: 220,
      revisions: {
        'startpage-todos': 150,
        'startpage-shortcuts': 220,
      },
      'startpage-todos': [{ id: 2, text: 'old remote todo' }],
      'startpage-shortcuts': [{ id: 'remote shortcut' }],
    };
    const merged = sync.mergeSyncBundles(local, remote);
    const emptyIsNewer = sync.hasNewerSyncData({
      v: 2,
      updatedAt: 999,
      revisions: { 'startpage-todos': 0 },
      'startpage-todos': null,
    }, remote);
    const previousSettings = localStorage.getItem('startpage-settings');
    storage.saveSettings({ wallpaperSource: 'library', wallpaperId: 'library-persist-test' });
    const librarySource = storage.loadSettings().wallpaperSource;
    storage.saveSettings({ wallpaperRotation: 'manual' });
    const wallpaper = await import('./js/wallpaper.js');
    const manualRotationTimer = wallpaper.initWallpaperRotation(() => {}, { runImmediately: true });
    if (manualRotationTimer) clearInterval(manualRotationTimer);
    if (previousSettings == null) localStorage.removeItem('startpage-settings');
    else localStorage.setItem('startpage-settings', previousSettings);
    return {
      mutationAt,
      futureRevision,
      skewSafeRevision,
      savedToken: savedConnection.token,
      savedGist: savedConnection.gistId,
      savedBaseline,
      mergedTodo: merged['startpage-todos']?.[0]?.text,
      mergedShortcut: merged['startpage-shortcuts']?.[0]?.id,
      syncVersion: sync.exportSyncBundle().v,
      emptyIsNewer,
      periodicRuns,
      periodicApplied,
      arxivUrl: arxiv[0]?.url,
      scholarUrl: scholar[0]?.url,
      librarySource,
      manualRotationStayedStopped: manualRotationTimer == null,
    };
  });
  assert(syncSafety.mutationAt > 100, 'local sync timestamp should advance after a synced data change');
  assert(syncSafety.skewSafeRevision > syncSafety.futureRevision,
    'local revisions must stay monotonic when another device clock is ahead');
  assert(
    syncSafety.savedToken === 'ghp_saved_token'
      && syncSafety.savedGist === 'working-gist'
      && syncSafety.savedBaseline === 'working-gist',
    'failed GitHub reconnect must restore the complete working connection',
  );
  assert(
    syncSafety.mergedTodo === 'local todo'
      && syncSafety.mergedShortcut === 'remote shortcut'
      && syncSafety.syncVersion === 2
      && syncSafety.emptyIsNewer === false
      && syncSafety.periodicRuns >= 2
      && syncSafety.periodicApplied === 1
      && syncSafety.arxivUrl?.startsWith('https://arxiv.org/search/')
      && syncSafety.scholarUrl?.startsWith('https://scholar.google.com/scholar')
      && syncSafety.librarySource === 'library'
      && syncSafety.manualRotationStayedStopped,
    `sync should merge each dataset independently: ${JSON.stringify(syncSafety)}`,
  );

  const atomicSyncSafety = await page.evaluate(async () => {
    const keys = [
      'startpage-todos',
      'startpage-sync-local-at',
      'startpage-sync-revisions',
    ];
    const previous = Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]));
    const chromeDescriptor = Object.getOwnPropertyDescriptor(window, 'chrome');
    const sync = await import('./js/sync.js');
    const oldPayload = {
      v: 2,
      updatedAt: 100,
      revisions: {
        'startpage-settings': 0,
        'startpage-shortcuts': 0,
        'startpage-dock': 0,
        'startpage-todos': 100,
        'startpage-goals': 0,
        'startpage-important-dates': 0,
      },
      settings: {},
      'startpage-shortcuts': null,
      'startpage-dock': null,
      'startpage-todos': [{ id: 1, text: 'old cloud' }],
      'startpage-goals': null,
      'startpage-important-dates': null,
    };
    const oldChunk = JSON.stringify(oldPayload);
    const oldRoot = { v: 2, updatedAt: 100, format: 'chunked', chunks: 1 };
    const cloud = {
      gavinhubSync: oldRoot,
      gavinhubSync_c0: oldChunk,
    };
    let runtimeError = null;
    let failRootWrite = true;

    const mockChrome = {
      runtime: {
        get lastError() { return runtimeError; },
      },
      storage: {
        sync: {
          get(requested, callback) {
            const requestedKeys = requested == null ? Object.keys(cloud) : requested;
            const result = {};
            for (const key of requestedKeys) {
              if (key in cloud) result[key] = cloud[key];
            }
            callback(result);
          },
          set(values, callback) {
            if (failRootWrite && Object.prototype.hasOwnProperty.call(values, 'gavinhubSync')) {
              failRootWrite = false;
              runtimeError = { message: 'simulated metadata failure' };
              callback();
              runtimeError = null;
              return;
            }
            Object.assign(cloud, values);
            callback();
          },
          remove(requested, callback) {
            for (const key of Array.isArray(requested) ? requested : [requested]) delete cloud[key];
            callback();
          },
        },
      },
    };

    try {
      Object.defineProperty(window, 'chrome', { configurable: true, value: mockChrome });
      localStorage.setItem('startpage-todos', JSON.stringify([{ id: 2, text: 'new local' }]));
      localStorage.setItem('startpage-sync-local-at', '200');
      localStorage.setItem('startpage-sync-revisions', JSON.stringify({ 'startpage-todos': 200 }));
      const result = await sync.pullSyncOnStartup();
      return {
        reason: result.reason,
        rootUnchanged: cloud.gavinhubSync === oldRoot,
        oldChunkUnchanged: cloud.gavinhubSync_c0 === oldChunk,
        orphanChunks: Object.keys(cloud).filter((key) =>
          key.startsWith('gavinhubSync_c') && key !== 'gavinhubSync_c0'),
      };
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
      if (chromeDescriptor) Object.defineProperty(window, 'chrome', chromeDescriptor);
      else delete window.chrome;
    }
  });
  assert(
    atomicSyncSafety.reason === 'error'
      && atomicSyncSafety.rootUnchanged
      && atomicSyncSafety.oldChunkUnchanged
      && atomicSyncSafety.orphanChunks.length === 0,
    `failed sync publication must preserve the previous cloud snapshot: ${JSON.stringify(atomicSyncSafety)}`,
  );

  const githubBootstrapSafety = await page.evaluate(async () => {
    const storageKeys = [
      'startpage-settings',
      'startpage-shortcuts',
      'startpage-dock',
      'startpage-todos',
      'startpage-goals',
      'startpage-important-dates',
      'startpage-countdowns',
      'startpage-sync-local-at',
      'startpage-sync-revisions',
      'startpage-github-token',
      'startpage-github-gist-id',
      'startpage-github-gist-baseline',
    ];
    const previous = Object.fromEntries(storageKeys.map((key) => [key, localStorage.getItem(key)]));
    const originalFetch = window.fetch;
    const credentials = await import('./js/credential-store.js');
    const github = await import('./js/github-sync.js');
    const storage = await import('./js/storage.js');
    let mode = 'single';
    let writes = 0;
    let patchedPayload = null;

    const remote = {
      v: 2,
      updatedAt: 200,
      revisions: {
        'startpage-settings': 0,
        'startpage-shortcuts': 0,
        'startpage-dock': 0,
        'startpage-todos': 200,
        'startpage-goals': 0,
        'startpage-important-dates': 0,
      },
      settings: {},
      'startpage-shortcuts': null,
      'startpage-dock': null,
      'startpage-todos': [{ id: 1, text: 'remote truth', startDate: '2026-07-28', endDate: '2026-07-28' }],
      'startpage-goals': null,
      'startpage-important-dates': null,
    };

    try {
      for (const key of storageKeys) localStorage.removeItem(key);
      credentials.clearCredentialCache();
      localStorage.setItem('startpage-todos', JSON.stringify([
        { id: 9, text: 'fresh defaults', startDate: '2026-07-28', endDate: '2026-07-28' },
      ]));
      localStorage.setItem('startpage-sync-local-at', '900');
      localStorage.setItem('startpage-sync-revisions', JSON.stringify({ 'startpage-todos': 900 }));

      window.fetch = async (input, init = {}) => {
        const url = String(input?.url || input);
        const method = init.method || 'GET';
        if (url.includes('/gists?per_page=100')) {
          const list = mode === 'multiple'
            ? [
              { id: 'canonical-gist', files: { 'gavinhub-sync.json': {} }, updated_at: '2026-07-28T10:00:00Z' },
              { id: 'duplicate-gist', files: { 'gavinhub-sync.json': {} }, updated_at: '2026-07-28T11:00:00Z' },
            ]
            : [{ id: 'canonical-gist', files: { 'gavinhub-sync.json': {} }, updated_at: '2026-07-28T10:00:00Z' }];
          return new Response(JSON.stringify(list), { status: 200 });
        }
        if (url.endsWith('/gists/canonical-gist') && method === 'GET') {
          return new Response(JSON.stringify({
            id: 'canonical-gist',
            files: { 'gavinhub-sync.json': { content: JSON.stringify(remote) } },
          }), { status: 200 });
        }
        if (url.endsWith('/gists/canonical-gist') && method === 'PATCH') {
          writes += 1;
          patchedPayload = JSON.parse(JSON.parse(init.body).files['gavinhub-sync.json'].content);
          return new Response(JSON.stringify({ id: 'canonical-gist' }), { status: 200 });
        }
        if (url.endsWith('/gists') && method === 'POST') {
          writes += 1;
          return new Response(JSON.stringify({ id: 'new-gist' }), { status: 200 });
        }
        throw new Error(`unexpected GitHub request: ${method} ${url}`);
      };

      await github.saveGithubConnection({ token: 'ghp_bootstrap_token', gistId: '' });
      const baselineAfterSave = localStorage.getItem('startpage-github-gist-baseline');
      const writesAfterSave = writes;
      const first = await github.syncWithGithub();
      const firstTodo = JSON.parse(localStorage.getItem('startpage-todos') || '[]')[0]?.text;
      const writesAfterBootstrap = writes;
      const discoveredGist = localStorage.getItem('startpage-github-gist-id');
      const baseline = localStorage.getItem('startpage-github-gist-baseline');

      storage.writeJson('startpage-todos', [
        { id: 2, text: 'office change', startDate: '2026-07-28', endDate: '2026-07-28' },
      ]);
      await Promise.resolve();
      const second = await github.syncWithGithub();
      const secondPatchedTodo = patchedPayload?.['startpage-todos']?.[0]?.text;

      localStorage.removeItem('startpage-github-gist-baseline');
      storage.writeJson('startpage-todos', [
        { id: 3, text: 'legacy upgrade change', startDate: '2026-07-28', endDate: '2026-07-28' },
      ]);
      await Promise.resolve();
      const legacyUpgrade = await github.syncWithGithub();
      const legacyPatchedTodo = patchedPayload?.['startpage-todos']?.[0]?.text;

      localStorage.removeItem('startpage-github-gist-id');
      localStorage.removeItem('startpage-github-gist-baseline');
      mode = 'multiple';
      let multipleError = '';
      const writesBeforeMultiple = writes;
      try {
        await github.syncWithGithub({ token: 'ghp_bootstrap_token', gistId: '' });
      } catch (error) {
        multipleError = error.message;
      }

      return {
        firstAction: first.action,
        firstDiscovered: first.discovered,
        baselineAfterSave,
        writesAfterSave,
        firstTodo,
        writesAfterBootstrap,
        discoveredGist,
        baseline,
        secondAction: second.action,
        patchedTodo: secondPatchedTodo,
        legacyUpgradeAction: legacyUpgrade.action,
        legacyPatchedTodo,
        multipleError,
        multipleDidNotWrite: writes === writesBeforeMultiple,
      };
    } finally {
      window.fetch = originalFetch;
      for (const [key, value] of Object.entries(previous)) {
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
      credentials.clearCredentialCache();
    }
  });
  assert(
    githubBootstrapSafety.firstAction === 'downloaded'
      && githubBootstrapSafety.firstDiscovered
      && githubBootstrapSafety.baselineAfterSave === 'pending:auto'
      && githubBootstrapSafety.writesAfterSave === 0
      && githubBootstrapSafety.firstTodo === 'remote truth'
      && githubBootstrapSafety.writesAfterBootstrap === 0
      && githubBootstrapSafety.discoveredGist === 'canonical-gist'
      && githubBootstrapSafety.baseline === 'canonical-gist'
      && githubBootstrapSafety.secondAction === 'uploaded'
      && githubBootstrapSafety.patchedTodo === 'office change'
      && githubBootstrapSafety.legacyUpgradeAction === 'uploaded'
      && githubBootstrapSafety.legacyPatchedTodo === 'legacy upgrade change'
      && githubBootstrapSafety.multipleError === 'multiple-gists'
      && githubBootstrapSafety.multipleDidNotWrite,
    `GitHub bootstrap must pull before any write: ${JSON.stringify(githubBootstrapSafety)}`,
  );

  const beforeDockDrag = await page.evaluate(async () => {
    const { loadDock } = await import('./js/shortcuts.js');
    return loadDock().map((item) => item.id);
  });
  const dockA = await page.locator('.dock-link[data-dock-id]').nth(0).boundingBox();
  const dockB = await page.locator('.dock-link[data-dock-id]').nth(1).boundingBox();
  await page.mouse.move(dockA.x + dockA.width / 2, dockA.y + dockA.height / 2);
  await page.mouse.down();
  await page.mouse.move(dockB.x + dockB.width * 0.82, dockB.y + dockB.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(320);
  const afterDockDrag = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('startpage-dock') || '[]').map((item) => item.id));
  assert(
    afterDockDrag[1] === beforeDockDrag[0],
    `dock drag should persist the new order: ${JSON.stringify({ beforeDockDrag, afterDockDrag })}`,
  );
  const canceledDockDrag = await page.evaluate(async () => {
    const before = localStorage.getItem('startpage-dock');
    const items = [...document.querySelectorAll('.dock-link[data-dock-id]')];
    const beforeDomOrder = items.map((item) => item.dataset.dockId);
    const from = items[0].getBoundingClientRect();
    const to = items[1].getBoundingClientRect();
    items[0].dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      pointerId: 71,
      pointerType: 'mouse',
      clientX: from.left + from.width / 2,
      clientY: from.top + from.height / 2,
    }));
    document.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      pointerId: 71,
      pointerType: 'mouse',
      clientX: to.right - 2,
      clientY: to.top + to.height / 2,
    }));
    document.dispatchEvent(new PointerEvent('pointercancel', {
      bubbles: true,
      pointerId: 71,
      pointerType: 'mouse',
    }));
    await new Promise((resolve) => setTimeout(resolve, 240));
    return {
      unchanged: localStorage.getItem('startpage-dock') === before,
      domOrder: [...document.querySelectorAll('.dock-link[data-dock-id]')]
        .map((item) => item.dataset.dockId),
      beforeDomOrder,
      active: document.getElementById('dock').classList.contains('is-reordering'),
      placeholders: document.querySelectorAll('#dock .dock-placeholder').length,
    };
  });
  assert(
    canceledDockDrag.unchanged
      && canceledDockDrag.domOrder.join(',') === canceledDockDrag.beforeDomOrder.join(',')
      && !canceledDockDrag.active
      && canceledDockDrag.placeholders === 0,
    `cancelled dock drag must roll back without committing: ${JSON.stringify(canceledDockDrag)}`,
  );

  await page.evaluate(() => {
    localStorage.setItem('startpage-shortcuts', JSON.stringify({ corrupted: true }));
  });

  await page.locator('.dock-tab[data-page="apps"]').click();
  await page.waitForFunction(() => document.body.classList.contains('page-apps-active'));
  await page.waitForFunction(() =>
    document.querySelector('.page-panel.page-apps')?.getBoundingClientRect().height > 0);
  const appsBackdropState = await page.evaluate(async () => ({
    backdrop: document.getElementById('wallpaper-blur')?.style.backgroundImage || '',
    liveFilter: document.getElementById('wallpaper-blur')
      ?.classList.contains('wallpaper-effect-live-filter'),
    current: (await import('./js/wallpaper.js')).getCurrentWallpaper(),
    imageSrc: document.getElementById('wallpaper-img')?.getAttribute('src') || '',
  }));
  assert(
    appsBackdropState.backdrop
      && (appsBackdropState.backdrop.includes('blob:') || appsBackdropState.liveFilter),
    `apps navigation must have an immediate composited wallpaper fallback: ${JSON.stringify(appsBackdropState)}`,
  );
  await page.waitForTimeout(1000);
  const appsBackdrop = await page.locator('#wallpaper-blur').evaluate((layer) => ({
    background: layer.style.backgroundImage,
    liveFilter: layer.classList.contains('wallpaper-effect-live-filter'),
  }));
  assert(
    appsBackdrop.background === appsBackdropState.backdrop
      && appsBackdrop.liveFilter === appsBackdropState.liveFilter,
    `apps navigation must not swap its wallpaper while visible: ${JSON.stringify({ ...appsBackdropState, after: appsBackdrop })}`,
  );
  assert(await page.locator('.page-panel[data-page="apps"]').evaluate((el) => el.classList.contains('active')),
    'apps page should activate');
  assert(await page.locator('.shortcut-item:not(.shortcut-add)').count() >= 10,
    'corrupted shortcut storage should fall back to defaults');
  const appsTextTheme = await page.locator('.shortcut-label').first().evaluate((label) => ({
    color: getComputedStyle(label).color,
    weight: getComputedStyle(label).fontWeight,
  }));
  assert(
    appsTextTheme.color === 'rgba(255, 255, 255, 0.92)',
    `apps labels should keep one light theme: ${JSON.stringify(appsTextTheme)}`,
  );

  const canceledShortcutDrag = await page.evaluate(async () => {
    const before = localStorage.getItem('startpage-shortcuts');
    const items = [...document.querySelectorAll('.shortcut-item:not(.shortcut-add)')];
    const beforeDomOrder = items.map((item) => item.dataset.id);
    const from = items[0].getBoundingClientRect();
    const to = items[1].getBoundingClientRect();
    items[0].dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      pointerId: 72,
      pointerType: 'mouse',
      clientX: from.left + from.width / 2,
      clientY: from.top + from.height / 2,
    }));
    document.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      pointerId: 72,
      pointerType: 'mouse',
      clientX: to.right - 2,
      clientY: to.top + to.height / 2,
    }));
    document.dispatchEvent(new PointerEvent('pointercancel', {
      bubbles: true,
      pointerId: 72,
      pointerType: 'mouse',
    }));
    await new Promise((resolve) => setTimeout(resolve, 240));
    return {
      unchanged: localStorage.getItem('startpage-shortcuts') === before,
      domOrder: [...document.querySelectorAll('.shortcut-item:not(.shortcut-add)')]
        .map((item) => item.dataset.id),
      beforeDomOrder,
      active: document.body.classList.contains('shortcut-drag-active'),
      placeholders: document.querySelectorAll('.shortcut-placeholder').length,
    };
  });
  assert(
    canceledShortcutDrag.unchanged
      && canceledShortcutDrag.domOrder.join(',') === canceledShortcutDrag.beforeDomOrder.join(',')
      && !canceledShortcutDrag.active
      && canceledShortcutDrag.placeholders === 0,
    `cancelled shortcut drag must roll back without committing: ${JSON.stringify(canceledShortcutDrag)}`,
  );

  const beforeShortcutDrag = await page.evaluate(() =>
    [...document.querySelectorAll('.shortcut-item:not(.shortcut-add)')].map((item) => item.dataset.id));
  const shortcutA = await page.locator('.shortcut-item:not(.shortcut-add)').nth(0).boundingBox();
  const shortcutB = await page.locator('.shortcut-item:not(.shortcut-add)').nth(1).boundingBox();
  const shortcutDragX = shortcutB.x + shortcutB.width * 0.82;
  const shortcutDragY = shortcutB.y + shortcutB.height / 2;
  await page.mouse.move(shortcutA.x + shortcutA.width / 2, shortcutA.y + shortcutA.height / 2);
  await page.mouse.down();
  await page.mouse.move(shortcutDragX, shortcutDragY, { steps: 8 });
  const liveShortcutDrag = await page.evaluate(({ x, y }) => {
    const item = document.querySelector('.shortcut-item.is-dragging');
    const rect = item?.getBoundingClientRect();
    return {
      parentIsBody: item?.parentElement === document.body,
      deltaX: rect ? Math.abs(rect.left + rect.width / 2 - x) : 999,
      deltaY: rect ? Math.abs(rect.top + rect.height / 2 - y) : 999,
    };
  }, { x: shortcutDragX, y: shortcutDragY });
  assert(
    liveShortcutDrag.parentIsBody
      && liveShortcutDrag.deltaX < 3
      && liveShortcutDrag.deltaY < 3,
    `dragged shortcut must stay in the viewport coordinate system: ${JSON.stringify(liveShortcutDrag)}`,
  );
  await page.mouse.up();
  await page.waitForTimeout(420);
  const afterShortcutDrag = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('startpage-shortcuts') || '[]').map((item) => item.id));
  assert(
    afterShortcutDrag[1] === beforeShortcutDrag[0],
    `shortcut drag should persist the new order: ${JSON.stringify({ beforeShortcutDrag, afterShortcutDrag })}`,
  );

  await page.waitForFunction(() => {
    const img = document.querySelector('.shortcut-item[data-id="connected-papers"] img');
    return Boolean(img?.complete && img.naturalWidth > 0);
  });
  const imageDragGuards = await page.locator('.shortcut-item[data-id="connected-papers"] img').evaluate((img) => ({
    draggable: img.draggable,
    pointerEvents: getComputedStyle(img).pointerEvents,
    nativeDragPrevented: !img.dispatchEvent(new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
    })),
  }));
  assert(
    imageDragGuards.draggable === false
      && imageDragGuards.pointerEvents === 'none'
      && imageDragGuards.nativeDragPrevented,
    `image-backed shortcuts must not start native image dragging: ${JSON.stringify(imageDragGuards)}`,
  );

  const imageShortcut = await page.locator('.shortcut-item[data-id="connected-papers"]').boundingBox();
  const imageTarget = await page.locator('.shortcut-item:not(.shortcut-add)').first().boundingBox();
  await page.mouse.move(
    imageShortcut.x + imageShortcut.width / 2,
    imageShortcut.y + imageShortcut.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    imageTarget.x + imageTarget.width * 0.2,
    imageTarget.y + imageTarget.height / 2,
    { steps: 10 },
  );
  await page.mouse.up();
  await page.waitForTimeout(420);
  const imageShortcutOrder = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('startpage-shortcuts') || '[]').map((item) => item.id));
  assert(
    imageShortcutOrder[0] === 'connected-papers',
    `image-backed shortcut drag should persist the new order: ${JSON.stringify(imageShortcutOrder)}`,
  );

  const dockDropItem = page.locator('.shortcut-item[data-id="gavin"]');
  const dockDropSource = await dockDropItem.boundingBox();
  const dockDropTarget = await page.locator('#dock').boundingBox();
  await page.mouse.move(
    dockDropSource.x + dockDropSource.width / 2,
    dockDropSource.y + dockDropSource.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    dockDropTarget.x + dockDropTarget.width - 16,
    dockDropTarget.y + dockDropTarget.height / 2,
    { steps: 14 },
  );
  const activeDockDrop = await page.evaluate(() => ({
    draggingId: document.querySelector('.shortcut-item.is-dragging')?.dataset.id,
    targetActive: document.getElementById('dock')?.classList.contains('is-external-drop-target'),
    hasSlot: Boolean(document.querySelector('#dock .dock-external-placeholder')),
  }));
  assert(
    activeDockDrop.draggingId === 'gavin'
      && activeDockDrop.targetActive
      && activeDockDrop.hasSlot,
    `dragging over dock should keep a floating item and open a slot: ${JSON.stringify(activeDockDrop)}`,
  );
  await page.mouse.up();
  await page.waitForTimeout(360);
  const dockDropResult = await page.evaluate(() => ({
    dockIds: JSON.parse(localStorage.getItem('startpage-dock') || '[]').map((item) => item.id),
    appStillPresent: Boolean(document.querySelector('.shortcut-item[data-id="gavin"]')),
  }));
  assert(
    dockDropResult.dockIds.includes('gavin') && dockDropResult.appStillPresent,
    `dropping an app onto dock should add without removing it from apps: ${JSON.stringify(dockDropResult)}`,
  );
  const settingsLoadedOnApps = await page.evaluate(() => performance.getEntriesByType('resource')
    .some((entry) => entry.name.endsWith('/js/settings-ui.js')));
  assert(!settingsLoadedOnApps, 'settings module should remain lazy after entering apps');

  await page.evaluate(async () => {
    localStorage.setItem('startpage-github-token', 'ghp_clear_test_token');
    localStorage.setItem('startpage-github-gist-id', 'gist-to-clear');
    localStorage.setItem('startpage-github-gist-baseline', 'gist-to-clear');
    const credentials = await import('./js/credential-store.js');
    credentials.clearCredentialCache();
  });
  await page.locator('#settings-btn').click();
  await page.waitForSelector('#settings-dialog[open]');
  assert(
    await page.evaluate(() => performance.getEntriesByType('resource')
      .some((entry) => entry.name.endsWith('/js/settings-ui.js'))),
    'settings action should load its feature module on demand',
  );
  const syncSettings = await page.evaluate(() => ({
    legacyTabs: document.querySelectorAll('.settings-sync-tab').length,
    title: document.getElementById('github-auto-sync-title')?.textContent,
    syncLabel: document.getElementById('github-sync-now-btn')?.textContent,
    reconnectLabel: document.getElementById('github-reconnect-btn')?.textContent,
    hasRecovery: Boolean(document.querySelector('.settings-recovery')),
    wallpaperSources: [...document.getElementById('wallpaper-source')?.options || []]
      .map((option) => option.value),
  }));
  assert(
    syncSettings.legacyTabs === 0
      && syncSettings.title === '仅保存在本机'
      && syncSettings.syncLabel === '立即同步'
      && syncSettings.reconnectLabel === '连接 GitHub'
      && syncSettings.hasRecovery
      && syncSettings.wallpaperSources.includes('library'),
    `settings should expose one automatic-sync status surface: ${JSON.stringify(syncSettings)}`);
  await page.locator('#github-reconnect-btn').click();
  await page.waitForSelector('#sync-setup-dialog[open]');
  const setupField = await page.evaluate(() => ({
    gistReadOnly: document.getElementById('sync-setup-gist-id')?.readOnly,
    gistValue: document.getElementById('sync-setup-gist-id')?.value,
    connectLabel: document.getElementById('sync-setup-connect')?.textContent,
    localLabel: document.getElementById('sync-setup-local')?.textContent,
  }));
  assert(
    setupField.gistReadOnly === false
      && setupField.gistValue === 'gist-to-clear'
      && setupField.connectLabel === '连接并恢复'
      && setupField.localLabel === '取消',
    `reconnect should reopen the editable first-run form: ${JSON.stringify(setupField)}`);
  await page.evaluate(async () => {
    const github = await import('./js/github-sync.js');
    await github.saveGithubConnection({ token: 'ghp_clear_test_token', gistId: '' });
  });
  const clearedGist = await page.evaluate(() => ({
    gistId: localStorage.getItem('startpage-github-gist-id'),
    baseline: localStorage.getItem('startpage-github-gist-baseline'),
  }));
  assert(clearedGist.gistId == null && clearedGist.baseline === 'pending:auto',
    `clearing Gist ID must switch back to safe auto-discovery: ${JSON.stringify(clearedGist)}`);
  await page.evaluate(async () => {
    localStorage.removeItem('startpage-github-token');
    localStorage.removeItem('startpage-github-gist-id');
    localStorage.removeItem('startpage-github-gist-baseline');
    const credentials = await import('./js/credential-store.js');
    credentials.clearCredentialCache();
  });
  await page.locator('#sync-setup-local').click();
  await page.waitForFunction(() => !document.getElementById('sync-setup-dialog')?.open);

  await page.evaluate(() => localStorage.removeItem('startpage-shortcuts'));
  await page.locator('.dock-tab[data-page="home"]').click();
  await page.waitForFunction(() => !document.body.classList.contains('page-apps-active'));

  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('2');
  await page.waitForFunction(() => document.body.classList.contains('page-apps-active'));
  await page.keyboard.press('1');
  await page.waitForFunction(() => !document.body.classList.contains('page-apps-active'));
  assert(await page.locator('.page-panel[data-page="home"]').evaluate((el) => el.classList.contains('active')),
    'home page should reactivate');
  await page.waitForFunction(() => !document.body.classList.contains('boot-awakening'), null, {
    timeout: 8000,
  });
  await page.waitForFunction(() => !document.body.classList.contains('search-reveal-pending'));

  await page.evaluate(() => {
    document.querySelector('.dock-tab[data-page="apps"]')?.click();
    document.querySelector('.dock-tab[data-page="home"]')?.click();
    document.querySelector('.dock-tab[data-page="apps"]')?.click();
  });
  await page.waitForFunction(() => document.body.classList.contains('page-apps-active'));
  const rapidRouteState = await page.evaluate(() => ({
    activePanels: document.querySelectorAll('.page-panel.active').length,
    activePage: document.querySelector('.page-panel.active')?.dataset.page,
    revealPending: document.body.classList.contains('search-reveal-pending'),
  }));
  assert(
    rapidRouteState.activePanels === 1
      && rapidRouteState.activePage === 'apps'
      && rapidRouteState.revealPending === false,
    `rapid navigation must settle on only the newest page: ${JSON.stringify(rapidRouteState)}`,
  );
  await page.waitForFunction(() => !document.body.classList.contains('page-transitioning'));
  assert(
    !(await page.locator('main.app').getAttribute('aria-busy')),
    'page transition cancellation must clear busy state',
  );
  await page.locator('.dock-tab[data-page="home"]').click();
  await page.waitForFunction(() => !document.body.classList.contains('page-apps-active'));

  const search = page.locator('#search-input');
  await search.focus();
  await search.fill('1+2*3');
  const inputPaint = await search.evaluate((input) => {
    const style = getComputedStyle(input);
    return {
      value: input.value,
      color: style.color,
      textFillColor: style.webkitTextFillColor,
      caretColor: style.caretColor,
      opacity: style.opacity,
    };
  });
  assert(
    inputPaint.value === '1+2*3'
      && inputPaint.color === 'rgb(255, 255, 255)'
      && inputPaint.textFillColor === 'rgb(255, 255, 255)'
      && inputPaint.caretColor === 'rgb(255, 255, 255)'
      && inputPaint.opacity === '1',
    `typed search text must remain visible in Edge compositing: ${JSON.stringify(inputPaint)}`,
  );
  await page.waitForTimeout(500);
  const suggestionState = await page.evaluate(() => {
    const list = document.querySelector('#search-suggestions');
    return {
      active: document.activeElement?.id,
      hidden: list?.hidden,
      text: list?.textContent,
      value: document.querySelector('#search-input')?.value,
    };
  });
  assert(
    suggestionState.hidden === false && suggestionState.text.includes('7'),
    `calculator suggestion should render: ${JSON.stringify(suggestionState)} errors=${errors.join(' | ')}`,
  );
  assert(
    await page.evaluate(() => performance.getEntriesByType('resource')
      .some((entry) => entry.name.endsWith('/js/smart-input.js'))),
    'the first query should activate search intelligence',
  );
  await search.fill('arxiv');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => {
    const icon = document.querySelector('.search-badge-icon');
    return icon?.getAttribute('src')?.endsWith('assets/search-arxiv.png') && icon.naturalWidth > 0;
  });
  const arxivMode = await page.evaluate(async () => {
    const storage = await import('./js/storage.js');
    return {
      mode: document.getElementById('search-box')?.dataset.searchMode,
      badgeIcon: document.querySelector('.search-badge-icon')?.getAttribute('src'),
      url: storage.getAcademicSearchUrl('arxiv', 'graph neural network'),
    };
  });
  assert(
    arxivMode.mode === 'arxiv'
      && arxivMode.badgeIcon?.endsWith('assets/search-arxiv.png')
      && arxivMode.url.startsWith('https://arxiv.org/search/'),
    `arxiv + Tab should enter arXiv search mode: ${JSON.stringify(arxivMode)}`,
  );
  await page.keyboard.press('Escape');
  await search.fill('sc');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => {
    const icon = document.querySelector('.search-badge-icon');
    return icon?.getAttribute('src')?.endsWith('assets/search-google-scholar.png')
      && icon.naturalWidth > 0;
  });
  const scholarMode = await page.evaluate(async () => {
    const storage = await import('./js/storage.js');
    return {
      mode: document.getElementById('search-box')?.dataset.searchMode,
      badgeIcon: document.querySelector('.search-badge-icon')?.getAttribute('src'),
      url: storage.getAcademicSearchUrl('scholar', 'graph neural network'),
    };
  });
  assert(
    scholarMode.mode === 'scholar'
      && scholarMode.badgeIcon?.endsWith('assets/search-google-scholar.png')
      && scholarMode.url.startsWith('https://scholar.google.com/scholar'),
    `sc + Tab should enter Google Scholar mode: ${JSON.stringify(scholarMode)}`,
  );
  await page.keyboard.press('Escape');
  await search.fill('a');
  await search.fill('ab');
  await search.fill('abc');
  await page.waitForTimeout(500);
  assert(completionRequests === 1, `completion debounce expected 1 request, got ${completionRequests}`);

  await search.focus();
  await page.keyboard.down('Alt');
  await page.keyboard.press('Digit2');
  await page.keyboard.up('Alt');
  const altSwitch = await page.evaluate(() => {
    const label = document.querySelector('#search-engine-badge')?.getAttribute('aria-label') || '';
    const stored = JSON.parse(localStorage.getItem('startpage-settings') || '{}');
    return { storedSearchEngine: stored.searchEngine, label };
  });
  assert(
    altSwitch.label.includes('Bing') && altSwitch.storedSearchEngine == null,
    `Alt+2 should switch to Bing for this tab only: ${JSON.stringify(altSwitch)}`,
  );

  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('startpage-settings') || '{}');
    localStorage.setItem('startpage-settings', JSON.stringify({ ...raw, searchEngine: 'bing' }));
  });
  await page.addInitScript(() => {
    window.__dockFrames = [];
    const startedAt = performance.now();
    const sampleDock = () => {
      const dock = document.getElementById('dock');
      if (dock) {
        const rect = dock.getBoundingClientRect();
        const matrix = new DOMMatrixReadOnly(getComputedStyle(dock).transform);
        if (rect.width > 0 && getComputedStyle(dock).visibility !== 'hidden') {
          window.__dockFrames.push({
            left: rect.left,
            right: rect.right,
            center: rect.left + rect.width / 2,
            viewport: innerWidth,
            sidebar: document.documentElement.classList.contains('layout-sidebar'),
            skew: Math.abs(matrix.b) + Math.abs(matrix.c),
          });
        }
      }
      if (performance.now() - startedAt < 1600) requestAnimationFrame(sampleDock);
    };
    requestAnimationFrame(sampleDock);
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('boot-ui-settled'), null, {
    timeout: 8000,
  });
  await page.waitForSelector('#search-engine-badge[aria-label]', { timeout: 8000 });
  const freshTabSearch = await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('startpage-settings') || '{}');
    const label = document.querySelector('#search-engine-badge')?.getAttribute('aria-label');
    return { searchEngine: settings.searchEngine, label };
  });
  assert(
    freshTabSearch.searchEngine == null
      && freshTabSearch.label?.includes('Google'),
    `new tab should reset to Google and not persist search engine: ${JSON.stringify(freshTabSearch)}`,
  );
  const desktopDockFrames = await page.evaluate(() => window.__dockFrames || []);
  assert(
    desktopDockFrames.length > 0
      && desktopDockFrames.every((frame) =>
        frame.left >= 0
        && frame.right <= frame.viewport
        && frame.skew < 0.001
        && Math.abs(frame.center - frame.viewport / 2) < 1),
    `desktop dock should stay centered throughout startup: ${JSON.stringify(desktopDockFrames.slice(0, 4))}`,
  );

  const slowPreviewRoute = async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.abort();
  };
  await page.route('https://invalid.example.test/slow-preview.jpg', slowPreviewRoute);
  await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 27;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#53657a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    localStorage.setItem('startpage-wallpaper-last', JSON.stringify({
      id: 'slow-preview-wallpaper',
      cacheKey: 'slow-preview-cache',
      type: 'image',
      source: 'bing',
      dateKey: '20991231',
      url: 'https://invalid.example.test/slow-preview.jpg',
      textTheme: 'on-dark',
    }));
    localStorage.setItem('startpage-wallpaper-boot-preview', JSON.stringify({
      version: 2,
      key: 'slow-preview-cache',
      sourceUrl: 'https://invalid.example.test/slow-preview.jpg',
      dataUrl: canvas.toDataURL('image/jpeg', 0.7),
      savedAt: Date.now(),
    }));
  });
  const previewBootStartedAt = Date.now();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('boot-ui-settled'), null, {
    timeout: 1000,
  });
  const previewBoot = await page.evaluate(() => ({
    ready: window.__BOOT_WALLPAPER_READY,
    previewReady: Boolean(window.__BOOT_WALLPAPER_PREVIEW),
    previewHidden: document.getElementById('wallpaper-preview')?.classList.contains('is-hidden'),
    previewBackground: document.getElementById('wallpaper-preview')?.style.backgroundImage || '',
    src: document.getElementById('wallpaper-img')?.getAttribute('src') || '',
  }));
  assert(
    Date.now() - previewBootStartedAt < 700
      && previewBoot.ready
      && previewBoot.previewReady
      && !previewBoot.previewHidden
      && previewBoot.previewBackground.includes('data:image/jpeg')
      && previewBoot.src === '',
    `a cached preview should reveal immediately before the full image starts loading: ${JSON.stringify(previewBoot)}`,
  );
  await page.unroute('https://invalid.example.test/slow-preview.jpg', slowPreviewRoute);
  await page.evaluate(() => {
    localStorage.removeItem('startpage-wallpaper-boot-preview');
    localStorage.removeItem('startpage-wallpaper-last');
  });

  await page.evaluate(() => {
    localStorage.setItem('startpage-wallpaper-last', JSON.stringify({
      id: 'broken-boot-wallpaper',
      type: 'image',
      url: 'https://invalid.example.test/broken-wallpaper.jpg',
      textTheme: 'on-dark',
    }));
  });
  const brokenBootStartedAt = Date.now();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('boot-ui-settled'), null, {
    timeout: 2000,
  });
  const brokenBoot = await page.evaluate(() => ({
    ready: window.__BOOT_WALLPAPER_READY,
    src: document.getElementById('wallpaper-img')?.getAttribute('src') || '',
    naturalWidth: document.getElementById('wallpaper-img')?.naturalWidth || 0,
  }));
  assert(
    Date.now() - brokenBootStartedAt < 1800 && brokenBoot.ready === false,
    `broken cached wallpaper must fall back without trapping startup: ${JSON.stringify(brokenBoot)}`,
  );
  await page.evaluate(() => localStorage.removeItem('startpage-wallpaper-last'));

  await page.setViewportSize({ width: 430, height: 900 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('boot-glass-stable'), null, {
    timeout: 8000,
  });
  const sidebarLayout = await page.evaluate(() => {
    const rect = document.getElementById('search-form')?.getBoundingClientRect();
    return {
      sidebar: document.body.classList.contains('layout-sidebar'),
      left: rect?.left,
      right: rect?.right,
      viewport: innerWidth,
      dockFrames: window.__dockFrames || [],
    };
  });
  assert(
    sidebarLayout.sidebar
      && sidebarLayout.left >= 70
      && sidebarLayout.right <= sidebarLayout.viewport,
    `sidebar search should stay inside the content rail: ${JSON.stringify(sidebarLayout)}`,
  );
  assert(
    sidebarLayout.dockFrames.length > 0
      && sidebarLayout.dockFrames.every((frame) =>
        frame.left >= 0
        && frame.right <= frame.viewport
        && frame.skew < 0.001
        && Math.abs(frame.left - 10) < 1),
    `sidebar dock should stay straight throughout startup: ${JSON.stringify(sidebarLayout.dockFrames.slice(0, 4))}`,
  );

  await page.evaluate(() => {
    const now = new Date();
    now.setDate(now.getDate() - now.getDay());
    const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const categories = ['work', 'fitness', 'life', 'study'];
    const todos = Array.from({ length: 20 }, (_, i) => ({
      id: 1000 + i,
      text: `回归待办 ${i + 1}`,
      done: false,
      startDate: dateKey,
      endDate: dateKey,
      category: categories[i % categories.length],
      notes: '',
      instanceDone: {},
      skippedDates: [],
    }));
    localStorage.setItem('startpage-todos', JSON.stringify(todos));
  });
  await page.locator('#date-trigger').click();
  await page.waitForSelector('#calendar-dialog[open]');
  assert(!(await page.locator('.cal-side-form').isVisible()), 'goal form should start collapsed');
  await page.locator('.cal-side-add').click();
  assert(await page.locator('.cal-side-form').isVisible(), 'goal form should open on demand');
  await page.locator('#cal-view-toggle').click();
  await page.waitForSelector('.month-calendar');
  assert(
    await page.locator('.cal-side-form').isVisible(),
    'calendar navigation should preserve the independent goal form state',
  );
  await page.locator('.cal-side-cancel').click();
  assert(await page.locator('.month-day-cell').count() >= 28,
    'month view should render a complete delegated date grid');
  assert(
    await page.locator('#week-calendar').getAttribute('data-month-cells-bound') === 'true',
    'month view should use a single delegated event boundary',
  );
  await page.locator('.month-day-cell:not(.is-other-month)').first().click({ button: 'right' });
  await page.waitForFunction(() => !document.getElementById('cal-day-menu')?.hidden);
  await page.locator('#cal-title').click();
  await page.locator('#cal-view-toggle').click();
  await page.waitForSelector('.week-calendar');
  assert(await page.locator('.cal-event').count() === 8, 'busy week should start in compact mode');
  await page.locator('.week-events-overflow-btn').click();
  await page.waitForFunction(() => document.querySelectorAll('.cal-event').length === 20);
  await page.locator('.cal-event-title').first().dispatchEvent('mousedown', {
    button: 0,
    clientX: 120,
    clientY: 120,
  });
  assert(
    await page.locator('.cal-event').first().evaluate((el) => el.classList.contains('is-dragging')),
    'calendar drag should enter an explicit active state',
  );
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert(
    !(await page.locator('.cal-event').first().evaluate((el) => el.classList.contains('is-dragging'))),
    'calendar drag should cancel when the browser loses focus',
  );
  assert(
    !(await page.locator('link[data-active-style="todo"]').count()),
    'todo editor styling should remain idle while browsing the calendar',
  );
  await page.locator('.cal-event-title').first().click();
  await page.waitForSelector('#todo-detail-dialog[open]');
  assert(
    await page.locator('link[data-active-style="todo"]').count() === 1,
    'opening a todo should activate only its editor stylesheet',
  );
  await page.locator('#todo-detail-dialog .modal-close').click();
  await page.waitForFunction(() => !document.getElementById('todo-detail-dialog')?.open);
  const mobileCalendar = await page.evaluate(() => {
    const main = document.querySelector('.calendar-main');
    return { scrollWidth: main?.scrollWidth, clientWidth: main?.clientWidth };
  });
  assert(
    mobileCalendar.scrollWidth > mobileCalendar.clientWidth,
    `narrow calendar should scroll horizontally instead of crushing columns: ${JSON.stringify(mobileCalendar)}`,
  );

  const firstRunPage = await browser.newPage({ viewport: { width: 1120, height: 760 } });
  await firstRunPage.route('https://**/*', (route) => route.abort());
  await firstRunPage.goto(url, { waitUntil: 'domcontentloaded' });
  await firstRunPage.waitForFunction(() => document.body.classList.contains('search-focused'), null, {
    timeout: 8000,
  });
  assert(
    !(await firstRunPage.locator('#sync-setup-dialog').evaluate((dialog) => dialog.open)),
    'first-run setup must not interrupt the initial search focus animation',
  );
  await firstRunPage.waitForSelector('#sync-setup-dialog[open]', { timeout: 4000 });
  assert(
    await firstRunPage.locator('#sync-setup-local').textContent() === '仅保存在本机',
    'a pristine install should offer the one-time local-only choice',
  );
  await firstRunPage.locator('#sync-setup-local').click();
  const firstRunChoice = await firstRunPage.evaluate(() =>
    JSON.parse(localStorage.getItem('startpage-github-sync-setup') || 'null')?.mode);
  assert(firstRunChoice === 'local', 'the first-run choice should be remembered on this device');
  await firstRunPage.close();

  const severeErrors = errors.filter((message) =>
    !message.includes('ERR_FAILED')
    && !message.includes('Failed to load resource')
    && !message.includes('天气加载失败'));
  assert(severeErrors.length === 0, `unexpected browser errors:\n${severeErrors.join('\n')}`);
  console.log('REGRESSION OK: boot, routing, search, storage, sync, mobile, calendar');
  console.log(`PERF BASELINE: ${JSON.stringify(baseline)}`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
