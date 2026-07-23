/** 主动唤醒后台页；收到接管确认后立即停止重试。 */
let attempts = 0;
let retryTimer = 0;

function requestFocusablePage() {
  attempts += 1;
  chrome.runtime.sendMessage({ type: 'gavinhub-open-index' }, (response) => {
    void chrome.runtime.lastError;
    if (response?.accepted) {
      clearTimeout(retryTimer);
      return;
    }
    if (attempts < 6) {
      retryTimer = window.setTimeout(requestFocusablePage, Math.min(80 * (2 ** attempts), 500));
    }
  });
}

requestFocusablePage();
