import { ensureStyle, getStyleStatus } from './style-registry.js';
import { motionController } from './motion-controller.js';

let initialized = false;
const pendingOpen = new WeakMap();
const pendingDialogs = new Set();
const dialogMotions = new WeakMap();

function resolveDialog(dialogOrId) {
  if (typeof dialogOrId === 'string') return document.getElementById(dialogOrId);
  return dialogOrId;
}

function getDialogStyleIds(dialog) {
  return ['dialogs', dialog?.dataset.dialogStyle].filter(Boolean);
}

export function prepareDialogStyles(dialogOrId) {
  const dialog = resolveDialog(dialogOrId);
  if (!(dialog instanceof HTMLDialogElement)) return Promise.resolve([]);
  return Promise.allSettled(getDialogStyleIds(dialog).map(ensureStyle));
}

export function openDialog(dialogOrId) {
  const dialog = resolveDialog(dialogOrId);
  if (!(dialog instanceof HTMLDialogElement) || dialog.open) return false;
  const token = {};
  pendingOpen.set(dialog, token);
  pendingDialogs.add(dialog);
  const show = () => {
    if (pendingOpen.get(dialog) !== token) return;
    pendingOpen.delete(dialog);
    pendingDialogs.delete(dialog);
    if (dialog.open) return;
    try {
      dialog.showModal();
      const motion = motionController.begin('dialog', {
        rootClasses: ['dialog-transitioning'],
        element: dialog,
        elementClasses: ['dialog-opening'],
      });
      dialogMotions.set(dialog, motion);
      void motion.wait(dialog, {
        animation: 'gavinhub-dialog-enter',
        timeout: 340,
      }).then(() => motion.finish());
    } catch (error) {
      console.warn('[GavinHub] dialog failed to open', error);
    }
  };
  const styleIds = getDialogStyleIds(dialog);
  if (styleIds.every((id) => getStyleStatus(id) === 'ready')) show();
  else void prepareDialogStyles(dialog).then(show);
  return true;
}

export function closeDialog(dialogOrId, returnValue = '') {
  const dialog = resolveDialog(dialogOrId);
  if (!(dialog instanceof HTMLDialogElement)) return false;
  const wasPending = pendingOpen.delete(dialog);
  pendingDialogs.delete(dialog);
  dialogMotions.get(dialog)?.cancel();
  dialogMotions.delete(dialog);
  motionController.cancel('dialog');
  if (!dialog.open) return wasPending;
  dialog.close(returnValue);
  return true;
}

export function initDialogController() {
  if (initialized) return;
  initialized = true;

  document.addEventListener('click', (event) => {
    const closeButton = event.target.closest?.('.modal-close');
    if (closeButton) {
      event.preventDefault();
      closeDialog(closeButton.closest('dialog'));
      return;
    }

    if (event.target instanceof HTMLDialogElement) {
      closeDialog(event.target);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !pendingDialogs.size) return;
    for (const dialog of pendingDialogs) {
      pendingOpen.delete(dialog);
    }
    pendingDialogs.clear();
  }, true);

  document.addEventListener('close', (event) => {
    const dialog = event.target;
    if (!(dialog instanceof HTMLDialogElement)) return;
    dialogMotions.get(dialog)?.cancel();
    dialogMotions.delete(dialog);
    motionController.cancel('dialog');
  }, true);
}
