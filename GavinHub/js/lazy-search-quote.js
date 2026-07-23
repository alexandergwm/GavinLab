import { runWhenIdle } from './lifecycle.js';

/**
 * Keeps quote/weather parsing off the search-critical path. The facade mirrors
 * the quote controller API so the search module stays unaware of load timing.
 */
export function initLazySearchQuote(quoteElement, { delay = 220 } = {}) {
  if (!quoteElement) return { show() {}, hide() {}, hideImmediate() {} };

  let controller = null;
  let loadPromise = null;
  let generation = 0;
  let delayTimer = 0;
  let cancelIdle = null;

  const cancelPending = () => {
    window.clearTimeout(delayTimer);
    delayTimer = 0;
    cancelIdle?.();
    cancelIdle = null;
  };

  const load = () => {
    loadPromise ||= import('./quote.js')
      .then((module) => {
        controller = module.initSearchQuote(quoteElement);
        return controller;
      })
      .catch((error) => {
        loadPromise = null;
        throw error;
      });
    return loadPromise;
  };

  const show = (mode = 'normal') => {
    const token = ++generation;
    cancelPending();
    if (controller) {
      controller.show(mode);
      return;
    }
    delayTimer = window.setTimeout(() => {
      delayTimer = 0;
      cancelIdle = runWhenIdle(async () => {
        cancelIdle = null;
        const loaded = await load();
        if (token === generation) loaded.show(mode);
      }, { timeout: 500, fallbackDelay: 40 });
    }, delay);
  };

  const hide = () => {
    generation += 1;
    cancelPending();
    controller?.hide();
  };

  const hideImmediate = () => {
    generation += 1;
    cancelPending();
    controller?.hideImmediate();
    if (!controller) quoteElement.hidden = true;
  };

  return { show, hide, hideImmediate };
}
