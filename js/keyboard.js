const PAGE_KEYS = { 1: 'home', 2: 'apps' };

function isTypingContext() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  if (el.closest('[contenteditable="true"]')) return true;
  return false;
}

function isBlockingDialogOpen() {
  return Boolean(document.querySelector('dialog[open]:not(#shortcuts-dialog)'));
}

export function initKeyboard({ getCurrentPage, onSwitchPage, focusSearch, handleEscape }) {
  const helpDialog = document.getElementById('shortcuts-dialog');

  function showHelp() {
    helpDialog?.showModal();
  }

  function hideHelp() {
    helpDialog?.close();
  }

  helpDialog?.addEventListener('click', (e) => {
    if (e.target === helpDialog) hideHelp();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (helpDialog?.open) {
        e.preventDefault();
        hideHelp();
        return;
      }
      if (handleEscape?.()) return;
      document.getElementById('search-input')?.blur();
      return;
    }

    if (helpDialog?.open) return;

    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
      e.preventDefault();
      showHelp();
      return;
    }

    if (isTypingContext() || isBlockingDialogOpen()) return;

    if (e.key === '/' && !e.shiftKey) {
      e.preventDefault();
      if (getCurrentPage() !== 'home') onSwitchPage('home');
      focusSearch?.();
      return;
    }

    const page = PAGE_KEYS[e.key];
    if (page) {
      e.preventDefault();
      onSwitchPage(page);
    }
  });
}
