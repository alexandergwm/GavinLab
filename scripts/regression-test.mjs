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
page.on('pageerror', (err) => errors.push(err.message));
page.on('request', (request) => {
  const hostname = new URL(request.url()).hostname;
  if (hostname === 'suggestqueries.google.com' || hostname === 'api.bing.com') {
    completionRequests += 1;
  }
});
await page.addInitScript(() => {
  window.__longTasks = [];
  new PerformanceObserver((list) => {
    window.__longTasks.push(...list.getEntries().map((entry) => entry.duration));
  }).observe({ type: 'longtask', buffered: true });
  Object.defineProperty(navigator, 'connection', {
    configurable: true,
    value: { saveData: true },
  });
});

try {
  await page.route('https://**/*', (route) => route.abort());
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('boot-ui-settled'), null, {
    timeout: 8000,
  });
  await page.waitForSelector('#search-engine-badge[aria-label]', { timeout: 8000 });
  const baseline = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    return {
      domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
      bootSettledMs: Math.round(performance.now()),
      localResources: resources.filter((entry) => entry.name.startsWith(location.origin)).length,
      longTasks: window.__longTasks.length,
      maxLongTaskMs: Math.round(Math.max(0, ...window.__longTasks)),
    };
  });

  assert(await page.locator('#clock').isVisible(), 'clock should be visible');
  assert(await page.locator('#search-input').isVisible(), 'search should be visible');
  assert(await page.locator('#dock').isVisible(), 'dock should be visible');

  await page.locator('.dock-tab[data-page="apps"]').click();
  await page.waitForFunction(() => document.body.classList.contains('page-apps-active'));
  await page.waitForFunction(() =>
    document.querySelector('.page-panel.page-apps')?.getBoundingClientRect().height > 0);
  assert(await page.locator('.page-panel[data-page="apps"]').evaluate((el) => el.classList.contains('active')),
    'apps page should activate');
  await page.locator('.dock-tab[data-page="home"]').click();
  await page.waitForFunction(() => !document.body.classList.contains('page-apps-active'));
  assert(await page.locator('.page-panel[data-page="home"]').evaluate((el) => el.classList.contains('active')),
    'home page should reactivate');
  await page.waitForFunction(() => !document.body.classList.contains('boot-awakening'), null, {
    timeout: 8000,
  });
  await page.waitForFunction(() => !document.body.classList.contains('search-reveal-pending'));

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

  const severeErrors = errors.filter((message) =>
    !message.includes('ERR_FAILED')
    && !message.includes('Failed to load resource')
    && !message.includes('天气加载失败'));
  assert(severeErrors.length === 0, `unexpected browser errors:\n${severeErrors.join('\n')}`);
  console.log('REGRESSION OK: boot, routing, search, tab session');
  console.log(`PERF BASELINE: ${JSON.stringify(baseline)}`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
