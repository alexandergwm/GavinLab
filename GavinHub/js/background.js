/** Fallback for the client-side NTP handoff in newtab.js. */
const busy = new Set();

function swapNtpToFocusablePage(tabId) {
  if (!tabId || busy.has(tabId)) return false;
  busy.add(tabId);

  const indexUrl = `${chrome.runtime.getURL('index.html')}?source=newtab-fallback`;
  chrome.tabs.update(tabId, { url: indexUrl, active: true }, (tab) => {
    if (chrome.runtime.lastError) {
      busy.delete(tabId);
      return;
    }
    setTimeout(() => busy.delete(tab?.id || tabId), 1200);
  });
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'gavinhub-open-index') return;
  const accepted = swapNtpToFocusablePage(sender.tab?.id);
  sendResponse({ accepted });
});
