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
  const calculatorResults = await indexPage.evaluate(async () => {
    const { evaluateCalc } = await import('./js/smart-input.js');
    return ['1+2*3', '50%*200', '-2^2', '2^-2', '1/0']
      .map((expression) => evaluateCalc(expression));
  });
  if (JSON.stringify(calculatorResults) !== JSON.stringify([7, 100, -4, 0.25, null])) {
    throw new Error(`extension calculator failed under MV3 CSP: ${JSON.stringify(calculatorResults)}`);
  }
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
  const syncRoundTrip = await indexPage.evaluate(async () => {
    const originalFetch = window.fetch;
    const remote = {
      v: 2,
      updatedAt: 500,
      revisions: {
        'startpage-settings': 0,
        'startpage-shortcuts': 500,
        'startpage-dock': 0,
        'startpage-todos': 0,
        'startpage-goals': 0,
        'startpage-important-dates': 0,
      },
      settings: {},
      'startpage-shortcuts': [{
        id: 'remote-extension-test',
        type: 'link',
        name: 'Remote Test',
        url: 'https://example.com/remote',
      }],
      'startpage-dock': null,
      'startpage-todos': null,
      'startpage-goals': null,
      'startpage-important-dates': null,
    };
    let patchedPayload = null;
    window.fetch = async (input, init = {}) => {
      const url = String(input?.url || input);
      const method = init.method || 'GET';
      if (url.endsWith('/gists/extension-smoke-gist') && method === 'GET') {
        return new Response(JSON.stringify({
          id: 'extension-smoke-gist',
          files: { 'gavinhub-sync.json': { content: JSON.stringify(remote) } },
        }), { status: 200 });
      }
      if (url.endsWith('/gists/extension-smoke-gist') && method === 'PATCH') {
        patchedPayload = JSON.parse(JSON.parse(init.body).files['gavinhub-sync.json'].content);
        return new Response(JSON.stringify({ id: 'extension-smoke-gist' }), { status: 200 });
      }
      throw new Error(`unexpected sync request: ${method} ${url}`);
    };

    try {
      const credentials = await import('./js/credential-store.js');
      credentials.clearCredentialCache();
      localStorage.removeItem('startpage-github-sync-setup');
      localStorage.removeItem('startpage-github-sync-status');
      localStorage.removeItem('startpage-github-gist-id');
      localStorage.removeItem('startpage-github-gist-baseline');
      const coordinator = await import('./js/sync-coordinator.js');
      const storage = await import('./js/storage.js');
      const first = await coordinator.configureGithubSync({
        token: 'ghp_extension_sync_test',
        gistId: 'extension-smoke-gist',
      });
      const restoredId = JSON.parse(localStorage.getItem('startpage-shortcuts') || '[]')[0]?.id;
      storage.writeJson('startpage-shortcuts', [{
        id: 'sync-extension-test',
        type: 'link',
        name: 'Sync Test',
        url: 'https://example.com',
      }]);
      const second = await coordinator.runConfiguredGithubSync();
      const stored = await chrome.storage.local.get('gavinhubCredentials');
      const setup = JSON.parse(localStorage.getItem('startpage-github-sync-setup') || 'null');
      return {
        firstAction: first.action,
        secondAction: second.action,
        restoredId,
        uploadedId: patchedPayload?.['startpage-shortcuts']?.[0]?.id,
        storedToken: stored.gavinhubCredentials?.githubToken || '',
        setupMode: setup?.mode,
      };
    } finally {
      window.fetch = originalFetch;
    }
  });
  if (
    syncRoundTrip.firstAction !== 'downloaded'
    || syncRoundTrip.secondAction !== 'uploaded'
    || syncRoundTrip.restoredId !== 'remote-extension-test'
    || syncRoundTrip.uploadedId !== 'sync-extension-test'
    || syncRoundTrip.storedToken !== 'ghp_extension_sync_test'
    || syncRoundTrip.setupMode !== 'github'
  ) {
    throw new Error(`GitHub sync round trip failed: ${JSON.stringify(syncRoundTrip)}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`EXTENSION SMOKE OK: ${extensionId}`);
} finally {
  await context.close();
  await rm(userDataDir, { recursive: true, force: true });
}
