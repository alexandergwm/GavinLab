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

const [baseCss, dialogsCss] = await Promise.all([
  readFile(join(root, 'css/base.css'), 'utf8'),
  readFile(join(root, 'css/dialogs.css'), 'utf8'),
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
    if (searchBox && dock) {
      window.__bootVisualFrames.push({
        searchVisible: getComputedStyle(document.getElementById('search-form')).visibility !== 'hidden',
        searchGlass: getComputedStyle(searchBox).backdropFilter,
        dockGlass: getComputedStyle(dock).backdropFilter,
        appsBackground: appsLayer?.style.backgroundImage || '',
        focusBackground: focusLayer?.style.backgroundImage || '',
      });
    }
    if (performance.now() - startedAt < 1600) requestAnimationFrame(sampleBootVisuals);
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
    const focusLayer = document.getElementById('search-focus-overlay')?.style.backgroundImage || '';
    return {
      effectsReady: document.body.classList.contains('wallpaper-effects-ready'),
      appsLayer,
      focusLayer,
    };
  });
  assert(
    bootEffectState.effectsReady
      && bootEffectState.focusLayer.includes('blob:'),
    `search focus must wait for its final wallpaper effect: ${JSON.stringify(bootEffectState)}`,
  );
  const bootVisualState = await page.evaluate(() => {
    const visibleFrames = window.__bootVisualFrames.filter((frame) => frame.searchVisible);
    const unique = (key) => [...new Set(visibleFrames.map((frame) => frame[key]).filter(Boolean))];
    return {
      searchGlass: unique('searchGlass'),
      dockGlass: unique('dockGlass'),
      appsBackground: unique('appsBackground'),
      focusBackground: unique('focusBackground'),
    };
  });
  assert(
    bootVisualState.searchGlass.length === 1 && bootVisualState.dockGlass.length === 1,
    `visible glass quality must remain constant during startup: ${JSON.stringify(bootVisualState)}`,
  );
  assert(
    bootVisualState.appsBackground.length <= 1 && bootVisualState.focusBackground.length <= 1,
    `effect layers must not expose provisional backgrounds: ${JSON.stringify(bootVisualState)}`,
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
  const lifecycleSafety = await page.evaluate(async () => {
    const [{ createFeatureRegistry }, dialogs, { createWallpaperEffects }] = await Promise.all([
      import('./js/feature-registry.js'),
      import('./js/dialog-ui.js'),
      import('./js/wallpaper-effects.js'),
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
    let stalePreviewDisposals = 0;
    const effects = createWallpaperEffects({
      createPreviews: () => Promise.resolve({
        apps: 'blob:stale-app-preview',
        focus: 'blob:stale-focus-preview',
        dispose: () => { stalePreviewDisposals += 1; },
      }),
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

    return {
      attempts,
      retryValue: retryValue.value,
      retryStatus: registry.getStatus('retryable').status,
      cancelledDialogOpen: dialog.open,
      stalePreviewDisposals,
      stalePreviewApplied,
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
    lifecycleSafety.stalePreviewDisposals === 1 && !lifecycleSafety.stalePreviewApplied,
    `disposed wallpaper effects must reject late previews: ${JSON.stringify(lifecycleSafety)}`,
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

  const syncSafety = await page.evaluate(async () => {
    localStorage.setItem('startpage-sync-local-at', '100');
    const storage = await import('./js/storage.js');
    storage.writeJson('startpage-todos', []);
    const mutationAt = Number(localStorage.getItem('startpage-sync-local-at'));

    localStorage.setItem('startpage-github-token', 'ghp_saved_token');
    const github = await import('./js/github-sync.js');
    try {
      await github.syncWithGithub({ token: 'ghp_replacement_token', gistId: 'network-test' });
    } catch { /* the test aborts external requests */ }
    const savedToken = localStorage.getItem('startpage-github-token');
    localStorage.removeItem('startpage-github-token');
    const sync = await import('./js/sync.js');
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
    return {
      mutationAt,
      savedToken,
      mergedTodo: merged['startpage-todos']?.[0]?.text,
      mergedShortcut: merged['startpage-shortcuts']?.[0]?.id,
      syncVersion: sync.exportSyncBundle().v,
      emptyIsNewer,
    };
  });
  assert(syncSafety.mutationAt > 100, 'local sync timestamp should advance after a synced data change');
  assert(syncSafety.savedToken === 'ghp_saved_token', 'failed GitHub sync must not overwrite a working token');
  assert(
    syncSafety.mergedTodo === 'local todo'
      && syncSafety.mergedShortcut === 'remote shortcut'
      && syncSafety.syncVersion === 2
      && syncSafety.emptyIsNewer === false,
    `sync should merge each dataset independently: ${JSON.stringify(syncSafety)}`,
  );

  await page.evaluate(() => {
    localStorage.setItem('startpage-shortcuts', JSON.stringify({ corrupted: true }));
  });

  await page.locator('.dock-tab[data-page="apps"]').click();
  await page.waitForFunction(() => document.body.classList.contains('page-apps-active'));
  await page.waitForFunction(() =>
    document.querySelector('.page-panel.page-apps')?.getBoundingClientRect().height > 0);
  assert(
    await page.locator('#wallpaper-blur').evaluate((layer) => layer.style.backgroundImage.includes('blob:')),
    'apps navigation should reveal a final preview instead of a provisional wallpaper',
  );
  assert(await page.locator('.page-panel[data-page="apps"]').evaluate((el) => el.classList.contains('active')),
    'apps page should activate');
  assert(await page.locator('.shortcut-item:not(.shortcut-add)').count() >= 10,
    'corrupted shortcut storage should fall back to defaults');
  const settingsLoadedOnApps = await page.evaluate(() => performance.getEntriesByType('resource')
    .some((entry) => entry.name.endsWith('/js/settings-ui.js')));
  assert(!settingsLoadedOnApps, 'settings module should remain lazy after entering apps');

  await page.locator('#settings-btn').click();
  await page.waitForSelector('#settings-dialog[open]');
  assert(
    await page.evaluate(() => performance.getEntriesByType('resource')
      .some((entry) => entry.name.endsWith('/js/settings-ui.js'))),
    'settings action should load its feature module on demand',
  );
  const githubField = await page.evaluate(() => ({
    hidden: document.getElementById('github-gist-field')?.hidden,
    readOnly: document.getElementById('github-sync-gist-id')?.readOnly,
  }));
  assert(githubField.hidden === false && githubField.readOnly === false,
    `Gist ID must be editable on a second computer: ${JSON.stringify(githubField)}`);
  await page.locator('#settings-dialog .settings-actions .modal-close').click();
  await page.waitForFunction(() => !document.getElementById('settings-dialog')?.open);

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
  await page.locator('.cal-side-cancel').click();
  await page.locator('#cal-view-toggle').click();
  await page.waitForSelector('.month-calendar');
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
