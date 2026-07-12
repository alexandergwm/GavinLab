import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, 'test-results');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});

async function runScenario(name, setup) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded' });
  if (setup) await page.evaluate(setup);
  await page.reload({ waitUntil: 'domcontentloaded' });

  let bg = 'none';
  for (let i = 0; i < 24; i++) {
    bg = await page.evaluate(() => getComputedStyle(document.getElementById('wallpaper')).backgroundImage);
    if (bg && bg !== 'none') break;
    await page.waitForTimeout(500);
  }

  const hasImage = bg && bg !== 'none';
  const shot = join(outDir, `wallpaper-${name}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  await page.close();
  return { name, hasImage, backgroundImage: bg, errors: errors.slice(0, 8), screenshot: shot };
}

const results = [];
results.push(await runScenario('fresh', null));
results.push(await runScenario('poisoned-blob', () => {
  localStorage.setItem('startpage-wallpaper-last', JSON.stringify({
    id: 'bing-test',
    url: 'blob:http://127.0.0.1:8765/dead-blob-id',
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
results.push(await runScenario('dead-cache', () => {
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
}));

writeFileSync(join(outDir, 'wallpaper-check.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
process.exit(results.every((r) => r.hasImage) ? 0 : 1);
