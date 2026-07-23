#!/usr/bin/env node
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { chromium } from 'playwright';

const root = new URL('..', import.meta.url).pathname;
const extensionPath = join(root, 'dist', 'gavinhub-edge');

async function waitForIndexPage(context, extensionId, timeoutMs = 12000) {
  const prefix = `chrome-extension://${extensionId}/index.html`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = context.pages().find((candidate) => {
      try {
        return !candidate.isClosed() && candidate.url().startsWith(prefix);
      } catch {
        return false;
      }
    });
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${prefix}`);
}
const userDataDir = await mkdtemp(join(tmpdir(), 'gavinhub-edge-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});

try {
  await context.route('https://**/*', (route) => route.abort());
  const worker = context.serviceWorkers()[0]
    || await context.waitForEvent('serviceworker', { timeout: 8000 });
  const extensionId = new URL(worker.url()).host;
  const ntpPage = await context.newPage();
  const errors = [];
  ntpPage.on('pageerror', (error) => errors.push(error.message));
  try {
    await ntpPage.goto('chrome://newtab/');
  } catch (error) {
    /* 壳页可能在 goto 完成前跳转到 index.html，导航中止属于正常成功路径。 */
    if (!/Target page, context or browser has been closed/i.test(error?.message || '')) throw error;
  }
  const indexPage = await waitForIndexPage(context, extensionId);
  if (indexPage !== ntpPage) {
    throw new Error('NTP handoff created a second tab instead of reusing the current tab');
  }
  indexPage.on('pageerror', (error) => errors.push(error.message));
  await indexPage.waitForSelector('#clock', { state: 'visible', timeout: 8000 });
  await indexPage.waitForSelector('#search-input', { state: 'visible', timeout: 8000 });
  await indexPage.waitForFunction(() => document.body.classList.contains('boot-ui-settled'), null, { timeout: 8000 });
  await indexPage.waitForFunction(
    () => document.hasFocus() && document.activeElement?.id === 'search-input',
    null,
    { timeout: 8000 },
  );
  const credentialMigration = await indexPage.evaluate(async () => {
    await chrome.storage.local.remove('gavinhubCredentials');
    localStorage.setItem('startpage-github-token', 'ghp_extension_migration_test');
    const credentials = await import('./js/credential-store.js');
    credentials.clearCredentialCache();
    const token = await credentials.loadGithubToken();
    const stored = await chrome.storage.local.get('gavinhubCredentials');
    const legacyRemoved = !localStorage.getItem('startpage-github-token');
    await chrome.storage.local.remove('gavinhubCredentials');
    credentials.clearCredentialCache();
    return {
      token,
      storedToken: stored.gavinhubCredentials?.githubToken || '',
      legacyRemoved,
    };
  });
  if (
    credentialMigration.token !== 'ghp_extension_migration_test'
    || credentialMigration.storedToken !== 'ghp_extension_migration_test'
    || !credentialMigration.legacyRemoved
  ) {
    throw new Error(`credential migration failed: ${JSON.stringify(credentialMigration)}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`EXTENSION SMOKE OK: ${extensionId}`);
} finally {
  await context.close();
  await rm(userDataDir, { recursive: true, force: true });
}
