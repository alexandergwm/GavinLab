/** 主动唤醒后台页，避免浏览器偶尔漏掉新标签页创建/更新事件。 */
let attempts = 0;

function requestFocusablePage() {
  attempts += 1;
  chrome.runtime.sendMessage({ type: 'gavinhub-open-index' }, () => {
    void chrome.runtime.lastError;
  });
  if (attempts < 8) window.setTimeout(requestFocusablePage, 120);
}

requestFocusablePage();
