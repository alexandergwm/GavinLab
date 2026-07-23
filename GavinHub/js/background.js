/**
 * Chromium NTP focus handoff. Navigating the existing tab to a regular
 * extension page releases address-bar focus without creating a second tab.
 */

const NTP = /^(chrome|edge):\/\/newtab\/?$/i;
const busy = new Set();

function shouldSwapNtpTab(tab) {
  if (!tab?.id || busy.has(tab.id)) return false;

  const pending = tab.pendingUrl || '';
  const url = tab.url || '';
  const isNtp = NTP.test(pending) || NTP.test(url) || pending === 'about:newtab' || url === 'about:newtab';
  const isOurNtpShell = /\/newtab\.html(?:\?|$)/.test(pending)
    || /\/newtab\.html(?:\?|$)/.test(url);

  return isNtp || isOurNtpShell;
}

function swapNtpToFocusablePage(tabId) {
  if (!tabId || busy.has(tabId)) return false;
  busy.add(tabId);

  const indexUrl = chrome.runtime.getURL('index.html');
  chrome.tabs.update(tabId, { url: indexUrl, active: true }, (tab) => {
    if (chrome.runtime.lastError) {
      busy.delete(tabId);
      return;
    }
    setTimeout(() => busy.delete(tab?.id || tabId), 1200);
  });
  return true;
}

function maybeSwapNtpTab(tab) {
  if (!shouldSwapNtpTab(tab)) return;
  swapNtpToFocusablePage(tab.id);
}

chrome.tabs.onCreated.addListener(maybeSwapNtpTab);

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;
  maybeSwapNtpTab({ ...tab, id: tabId, url: changeInfo.url, pendingUrl: changeInfo.url });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    maybeSwapNtpTab(tab);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'gavinhub-open-index') return;
  const accepted = swapNtpToFocusablePage(sender.tab?.id);
  sendResponse({ accepted });
});
