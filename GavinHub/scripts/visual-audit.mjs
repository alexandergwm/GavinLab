#!/usr/bin/env node
import { createServer } from 'http';
import { mkdir, readFile, stat } from 'fs/promises';
import { extname, join, normalize } from 'path';
import { chromium } from 'playwright';

const root = new URL('..', import.meta.url).pathname;
const outputDir = join(root, '..', 'test-results', 'visual');
const mime = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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

async function measureBackgroundWidth(page, id) {
  return page.evaluate((layerId) => new Promise((resolve) => {
    const value = document.getElementById(layerId)?.style.backgroundImage || '';
    const url = value.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
    if (!url) {
      resolve(0);
      return;
    }
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth);
    image.onerror = () => resolve(0);
    image.src = url;
  }), id);
}

async function inspectLayout(page, state) {
  return page.evaluate((currentState) => {
    const rect = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (getComputedStyle(el).visibility === 'hidden' || r.width === 0 || r.height === 0) return null;
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const insideViewport = (r) => !r || (
      r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1
    );
    const search = rect('#search-form');
    const dock = rect('#dock');
    const activePanel = rect('.page-panel.active');
    const dialog = rect('dialog[open]');
    const tiles = [...document.querySelectorAll('.page-apps.active .shortcut-icon')]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0);
    const clippedControls = [...document.querySelectorAll('button')]
      .filter((el) => {
        const style = getComputedStyle(el);
        return style.visibility !== 'hidden'
          && style.display !== 'none'
          && el.clientWidth > 0
          && el.scrollWidth > el.clientWidth + 2;
      })
      .length;
    return {
      state: currentState,
      viewport: { width: innerWidth, height: innerHeight },
      bodyOverflow: {
        x: document.documentElement.scrollWidth - innerWidth,
        y: document.documentElement.scrollHeight - innerHeight,
      },
      search,
      dock,
      activePanel,
      dialog,
      insideViewport: [search, dock, activePanel, dialog].every(insideViewport),
      searchCenterOffset: search ? Math.abs((search.left + search.width / 2) - innerWidth / 2) : null,
      sidebarLayout: document.documentElement.classList.contains('layout-sidebar')
        || document.body.classList.contains('layout-sidebar'),
      tileSizeSpread: tiles.length
        ? Math.max(...tiles.map((r) => r.width)) - Math.min(...tiles.map((r) => r.width))
        : 0,
      clippedControls,
      openDialogs: document.querySelectorAll('dialog[open]').length,
    };
  }, state);
}

async function capture(page, profile, state) {
  await page.screenshot({
    path: join(outputDir, `${profile}-${state}.png`),
    animations: 'disabled',
  });
  const layout = await inspectLayout(page, state);
  assert(layout.insideViewport, `${profile}/${state} escaped viewport: ${JSON.stringify(layout)}`);
  assert(layout.bodyOverflow.x <= 1 && layout.bodyOverflow.y <= 1,
    `${profile}/${state} introduced page scrolling: ${JSON.stringify(layout.bodyOverflow)}`);
  assert(layout.clippedControls === 0, `${profile}/${state} has clipped controls`);
  if (state === 'home') {
    const centerTolerance = layout.sidebarLayout ? 36 : 2;
    assert(layout.searchCenterOffset < centerTolerance,
      `${profile} search is outside its content center: ${layout.searchCenterOffset}`);
  }
  if (state === 'apps') {
    assert(layout.tileSizeSpread < 1, `${profile} app tiles changed size: ${layout.tileSizeSpread}`);
  }
  if (state === 'calendar' || state === 'settings') {
    assert(layout.openDialogs === 1 && layout.dialog, `${profile}/${state} dialog is not visible`);
  }
  return layout;
}

await mkdir(outputDir, { recursive: true });
const server = await startServer();
const { port } = server.address();
const browser = await chromium.launch({ headless: true });
const profiles = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'mobile', viewport: { width: 430, height: 900 } },
];

try {
  for (const profile of profiles) {
    const page = await browser.newPage({ viewport: profile.viewport });
    await page.addInitScript(() => {
      const NativeDate = Date;
      const fixed = new NativeDate('2026-07-24T10:08:00+08:00').getTime();
      globalThis.Date = class extends NativeDate {
        constructor(...args) {
          super(...(args.length ? args : [fixed]));
        }
        static now() { return fixed; }
      };
      Object.defineProperty(navigator, 'connection', {
        configurable: true,
        value: { saveData: true },
      });
    });
    await page.route('https://**/*', (route) => route.abort());
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() =>
      document.body.classList.contains('boot-glass-stable')
      && document.body.classList.contains('app-ready'), null, { timeout: 8000 });
    await page.addStyleTag({ content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        caret-color: transparent !important;
      }
    ` });

    await capture(page, profile.name, 'home');

    await page.locator('.dock-tab[data-page="apps"]').click();
    await page.waitForFunction(() => document.body.classList.contains('page-apps-active'));
    await page.waitForSelector('.page-apps.active .shortcut-item');
    const blurWidth = await measureBackgroundWidth(page, 'wallpaper-blur');
    assert(blurWidth >= 1280, `${profile.name} apps glass is low resolution: ${blurWidth}px`);
    await capture(page, profile.name, 'apps');

    await page.locator('.dock-tab[data-page="home"]').click();
    await page.locator('#clock-trigger').click();
    await page.waitForSelector('#calendar-dialog[open]');
    await capture(page, profile.name, 'calendar');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('calendar-dialog')?.open);

    await page.locator('.dock-tab[data-page="apps"]').click();
    await page.locator('#settings-btn').click();
    await page.waitForSelector('#settings-dialog[open]');
    await capture(page, profile.name, 'settings');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('settings-dialog')?.open);
    assert(await page.locator('dialog[open]').count() === 0, `${profile.name} dialog left a visible frame`);

    await page.close();
  }
  console.log(`VISUAL AUDIT OK: screenshots in ${outputDir}`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
