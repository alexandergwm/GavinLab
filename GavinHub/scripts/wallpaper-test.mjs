import { chromium } from 'playwright';
import { createServer } from 'http';
import { writeFileSync, mkdirSync } from 'fs';
import { readFile, stat } from 'fs/promises';
import { dirname, extname, join, normalize } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, 'test-results');
mkdirSync(outDir, { recursive: true });

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

const server = await startServer();
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true });

async function runScenario(name, setup) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('https://**/*', (route) => route.abort());

  await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('app-ready'), null, {
    timeout: 5000,
  }).catch(() => {});
  await page.evaluate(() => localStorage.clear());
  if (setup) await page.evaluate(setup);
  await page.reload({ waitUntil: 'domcontentloaded' });

  let state = null;
  for (let i = 0; i < 24; i++) {
    state = await page.evaluate(() => {
      const wallpaper = document.getElementById('wallpaper');
      const image = document.getElementById('wallpaper-img');
      const preview = document.getElementById('wallpaper-preview');
      const wallpaperStyle = getComputedStyle(wallpaper);
      const previewStyle = getComputedStyle(preview);
      return {
        gradient: wallpaper.classList.contains('is-gradient')
          && wallpaperStyle.backgroundImage !== 'none',
        image: !image.hidden
          && image.complete
          && image.naturalWidth > 0
          && image.classList.contains('wallpaper-show'),
        preview: previewStyle.backgroundImage !== 'none'
          && Number(previewStyle.opacity) > 0,
        src: image.getAttribute('src') || '',
      };
    });
    if (state.gradient || state.image || state.preview) break;
    await page.waitForTimeout(250);
  }

  const initialState = state;
  try {
    await page.waitForFunction(() => {
      const wallpaper = document.getElementById('wallpaper');
      const image = document.getElementById('wallpaper-img');
      return wallpaper?.classList.contains('is-gradient')
        || Boolean(
          image
          && !image.hidden
          && image.complete
          && image.naturalWidth > 0
          && image.classList.contains('wallpaper-show'),
        );
    }, null, { timeout: 5000 });
  } catch {
    /* reflected in hasImage below */
  }
  state = await page.evaluate(async () => {
    const wallpaper = document.getElementById('wallpaper');
    const image = document.getElementById('wallpaper-img');
    const wallpaperModule = await import('./js/wallpaper.js');
    return {
      gradient: wallpaper.classList.contains('is-gradient'),
      image: !image.hidden
        && image.complete
        && image.naturalWidth > 0
        && image.classList.contains('wallpaper-show'),
      src: image.getAttribute('src') || '',
      current: wallpaperModule.getCurrentWallpaper(),
      meta: JSON.parse(localStorage.getItem('startpage-wallpaper-last') || 'null'),
      classes: document.body.className,
    };
  });
  const hasImage = Boolean(
    (initialState?.gradient || initialState?.image || initialState?.preview)
    && (state.gradient || state.image),
  );
  const shot = join(outDir, `wallpaper-${name}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  await page.close();
  return {
    name,
    hasImage,
    initialState,
    settledState: state,
    errors: errors.slice(0, 8),
    screenshot: shot,
  };
}

const results = [];
results.push(await runScenario('fresh', null));
results.push(await runScenario('poisoned-blob', () => {
  localStorage.setItem('startpage-wallpaper-last', JSON.stringify({
    id: 'bing-test',
    url: 'blob:http://127.0.0.1/dead-blob-id',
    title: 'test',
    source: 'bing',
    type: 'image',
    cacheKey: 'bing-test',
    cachedAt: Date.now(),
  }));
  localStorage.setItem('startpage-settings', JSON.stringify({
    wallpaperSource: 'bing',
    wallpaperRotation: 'manual',
  }));
}));
const deadCacheResult = await runScenario('dead-cache', () => {
  localStorage.setItem('startpage-wallpaper-last', JSON.stringify({
    id: 'bing-dead',
    url: 'https://www.bing.com/th?id=INVALID_DEAD_URL_UHD.jpg',
    title: 'dead',
    source: 'bing',
    type: 'image',
    cacheKey: 'bing-dead',
    cachedAt: Date.now(),
  }));
  localStorage.setItem('startpage-settings', JSON.stringify({
    wallpaperSource: 'bing',
    wallpaperRotation: 'manual',
  }));
});
deadCacheResult.cacheRecovered = deadCacheResult.settledState?.current?.id === 'local-default'
  && deadCacheResult.settledState?.meta?.id === 'local-default';
results.push(deadCacheResult);
const libraryPreviewResult = await runScenario('library-preview', async () => {
  const media = await import('./js/media-store.js');
  const wallpaper = await import('./js/wallpaper.js');
  const id = 'wallpaper-test-local-library';
  const blob = await fetch('assets/default-wallpaper-preview.jpg').then((response) => response.blob());
  await media.saveWallpaperToLibrary({
    id,
    blob,
    type: 'image',
    title: 'Local library startup',
    savedAt: Date.now(),
  });
  const selected = media.libraryEntryToWallpaper(await media.getLibraryWallpaper(id));
  await wallpaper.applySelectedWallpaper(selected);
  const started = Date.now();
  while (Date.now() - started < 3000) {
    const preview = JSON.parse(localStorage.getItem('startpage-wallpaper-boot-preview') || 'null');
    if (preview?.key === id && preview.dataUrl) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
});
libraryPreviewResult.libraryRecovered = Boolean(
  libraryPreviewResult.initialState?.preview
  && libraryPreviewResult.settledState?.src?.startsWith('blob:')
  && libraryPreviewResult.settledState?.meta?.url === '',
);
results.push(libraryPreviewResult);

writeFileSync(join(outDir, 'wallpaper-check.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
await new Promise((resolve) => server.close(resolve));
process.exit(results.every((r) => r.hasImage
  && (r.name !== 'dead-cache' || r.cacheRecovered)
  && (r.name !== 'library-preview' || r.libraryRecovered)) ? 0 : 1);
