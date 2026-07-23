/**
 * Let the committed NTP shell navigate itself. This avoids racing a tabs.update
 * against Chromium's initial address-bar focus assignment. The worker is only a
 * fallback for browsers that block the same-origin replacement unexpectedly.
 */
const indexUrl = new URL(chrome.runtime.getURL('index.html'));
indexUrl.searchParams.set('source', 'newtab');

function requestBackgroundFallback() {
  chrome.runtime.sendMessage({ type: 'gavinhub-open-index' }, () => {
    void chrome.runtime.lastError;
  });
}

const fallbackTimer = window.setTimeout(requestBackgroundFallback, 240);

try {
  window.location.replace(indexUrl.href);
} catch {
  window.clearTimeout(fallbackTimer);
  requestBackgroundFallback();
}
