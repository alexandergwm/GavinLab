import { closeDialog, openDialog } from './dialog-ui.js';

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
    openDialog(helpDialog);
  }

  function hideHelp() {
    closeDialog(helpDialog);
  }

  document.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;

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

    /* 输入框内不要劫持 ? /，否则搜不到问号 */
    if (isTypingContext() || isBlockingDialogOpen()) return;

    if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
      e.preventDefault();
      showHelp();
      return;
    }

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
