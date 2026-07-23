let initialized = false;

function resolveDialog(dialogOrId) {
  if (typeof dialogOrId === 'string') return document.getElementById(dialogOrId);
  return dialogOrId;
}

export function openDialog(dialogOrId) {
  const dialog = resolveDialog(dialogOrId);
  if (!(dialog instanceof HTMLDialogElement) || dialog.open) return false;
  try {
    dialog.showModal();
    return true;
  } catch (error) {
    console.warn('[GavinHub] dialog failed to open', error);
    return false;
  }
}

export function closeDialog(dialogOrId, returnValue = '') {
  const dialog = resolveDialog(dialogOrId);
  if (!(dialog instanceof HTMLDialogElement) || !dialog.open) return false;
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
}
