import { nextPaint } from './lifecycle.js';

/**
 * Small cancellable router for page-level UI. A newer navigation invalidates
 * any older async enter hook before it can mutate the next page.
 */
export function createPageRouter({
  pages,
  initialPage,
  beforeChange,
  prepare,
  applyChange,
  afterPaint,
  enter,
  afterChange,
  onError,
}) {
  const allowed = new Set(pages);
  let currentPage = initialPage;
  let revision = 0;
  let pendingPage = null;

  const isCurrent = (token) => token === revision;

  async function navigate(nextPage, { force = false } = {}) {
    if (!allowed.has(nextPage)) return false;
    if (!force && nextPage === currentPage) {
      if (pendingPage && pendingPage !== currentPage) {
        revision += 1;
        pendingPage = null;
        return true;
      }
      return false;
    }
    if (!force && nextPage === pendingPage) return false;

    const token = ++revision;
    pendingPage = nextPage;
    const fromPage = currentPage;
    const context = { fromPage, nextPage, token, isCurrent: () => isCurrent(token) };

    try {
      await beforeChange?.(context);
      if (!isCurrent(token)) return false;

      await prepare?.(context);
      if (!isCurrent(token)) return false;

      currentPage = nextPage;
      pendingPage = null;
      applyChange?.(context);
      await nextPaint(2);
      if (!isCurrent(token)) return false;

      await afterPaint?.(context);
      if (!isCurrent(token)) return false;

      await enter?.(context);
      if (!isCurrent(token)) return false;

      await afterChange?.(context);
      if (isCurrent(token)) pendingPage = null;
      return isCurrent(token);
    } catch (error) {
      if (isCurrent(token)) pendingPage = null;
      onError?.(error, context);
      return false;
    }
  }

  return {
    navigate,
    getCurrentPage: () => currentPage,
    getPendingPage: () => pendingPage,
    isNavigating: () => pendingPage !== null,
  };
}
