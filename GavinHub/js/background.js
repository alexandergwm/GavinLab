/** 新标签页焦点修复
 *
 * Chromium 的 NTP 覆盖页会强制把焦点留在地址栏，页面 focus() 无效。
 * 因此在同一位置打开普通扩展页 index.html，再关闭 NTP 壳页。
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
  if (!tabId || busy.has(tabId)) return;
  busy.add(tabId);

  const indexUrl = chrome.runtime.getURL('index.html');

  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) {
      busy.delete(tabId);
      return;
    }

    const insertIndex = typeof tab?.index === 'number' ? tab.index : undefined;
    chrome.tabs.create({ url: indexUrl, active: true, index: insertIndex }, (created) => {
      if (chrome.runtime.lastError) {
        busy.delete(tabId);
        return;
      }
      chrome.tabs.remove(tabId, () => {
        busy.delete(tabId);
        void chrome.runtime.lastError;
      });
      if (created?.id) setTimeout(() => busy.delete(created.id), 1500);
    });
  });
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
