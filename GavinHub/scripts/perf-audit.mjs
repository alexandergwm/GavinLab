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

async function sampleActionFrames(page, selector, duration = 760) {
  return page.evaluate(({ actionSelector, sampleDuration }) => new Promise((resolve) => {
    const gaps = [];
    let startedAt = 0;
    let previous = 0;
    const frame = (now) => {
      if (!startedAt) {
        startedAt = now;
        previous = now;
        document.querySelector(actionSelector)?.click();
      } else {
        gaps.push(now - previous);
        previous = now;
      }
      if (now - startedAt < sampleDuration) requestAnimationFrame(frame);
      else {
        const sorted = [...gaps].sort((a, b) => a - b);
        resolve({
          frames: gaps.length,
          meanGapMs: Number((gaps.reduce((sum, gap) => sum + gap, 0) / Math.max(1, gaps.length)).toFixed(2)),
          p95GapMs: Number((sorted[Math.floor(sorted.length * 0.95)] || 0).toFixed(2)),
          maxGapMs: Number(Math.max(0, ...gaps).toFixed(2)),
          slowFrames: gaps.filter((gap) => gap > 34).length,
        });
      }
    };
    requestAnimationFrame(frame);
  }), { actionSelector: selector, sampleDuration: duration });
}

const server = await startServer();
const { port } = server.address();
const browser = await chromium.launch({ headless: true });
const profiles = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'mobile', viewport: { width: 430, height: 900 } },
];
const reports = [];

try {
  for (const profile of profiles) {
    const page = await browser.newPage({ viewport: profile.viewport });
    await page.addInitScript(() => {
      window.__perfAudit = { longTasks: [], layoutShift: 0 };
      new PerformanceObserver((list) => {
        window.__perfAudit.longTasks.push(...list.getEntries().map((entry) => entry.duration));
      }).observe({ type: 'longtask', buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__perfAudit.layoutShift += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
      Object.defineProperty(navigator, 'connection', {
        configurable: true,
        value: { saveData: true },
      });
    });
    await page.route('https://**/*', (route) => route.abort());
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() =>
      document.body.classList.contains('app-ready')
      && document.body.classList.contains('boot-glass-stable')
      && document.activeElement?.id === 'search-input', null, { timeout: 8000 });

    const startup = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const mark = (name) => Math.round(performance.getEntriesByName(name)[0]?.startTime || 0);
      return {
        dclMs: Math.round(nav.domContentLoadedEventEnd),
        appReadyMs: mark('gavinhub:app-ready'),
        uiSettledMs: mark('gavinhub:ui-settled'),
        glassStableMs: mark('gavinhub:glass-stable'),
        searchFocusedMs: mark('gavinhub:search-focused'),
      };
    });

    const toApps = await sampleActionFrames(page, '.dock-tab[data-page="apps"]');
    await page.waitForFunction(() => document.body.classList.contains('page-apps-active'));
    const toHome = await sampleActionFrames(page, '.dock-tab[data-page="home"]');
    await page.waitForFunction(() => !document.body.classList.contains('page-apps-active'));

    await page.locator('#search-input').blur();
    await page.waitForTimeout(180);
    const focus = await sampleActionFrames(page, '#search-input', 1100);
    const observer = await page.evaluate(() => ({
      cls: Number(window.__perfAudit.layoutShift.toFixed(4)),
      longTasks: window.__perfAudit.longTasks.length,
      maxLongTaskMs: Math.round(Math.max(0, ...window.__perfAudit.longTasks)),
    }));

    console.log(`PERF PROFILE ${profile.name}: ${JSON.stringify({ startup, observer, frames: { toApps, toHome, focus } })}`);

    for (const [name, sample] of Object.entries({ toApps, toHome, focus })) {
      assert(sample.maxGapMs < 70, `${profile.name} ${name} animation stalled: ${JSON.stringify(sample)}`);
      assert(sample.p95GapMs < 55, `${profile.name} ${name} p95 frame gap is too high: ${JSON.stringify(sample)}`);
      assert(sample.slowFrames <= 8, `${profile.name} ${name} has too many slow frames: ${JSON.stringify(sample)}`);
    }
    assert(observer.longTasks === 0, `${profile.name} startup should have no long tasks`);
    assert(observer.cls < 0.01, `${profile.name} layout shift is too high: ${observer.cls}`);
    assert(startup.appReadyMs > 0 && startup.appReadyMs < 800,
      `${profile.name} app-ready exceeded budget: ${startup.appReadyMs}ms`);

    reports.push({ profile: profile.name, startup, observer, frames: { toApps, toHome, focus } });
    await page.close();
  }

  console.log(`PERF AUDIT OK: ${JSON.stringify(reports)}`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
