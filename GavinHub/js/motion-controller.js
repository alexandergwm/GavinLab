import { nextPaint } from './lifecycle.js';

export function createMotionController(root = document.body) {
  const channels = new Map();
  let revision = 0;

  function begin(name, {
    rootClasses = [],
    element = null,
    elementClasses = [],
    busyElement = null,
  } = {}) {
    channels.get(name)?.cancel();
    const token = ++revision;
    let settled = false;

    root?.classList.add(...rootClasses);
    element?.classList.add(...elementClasses);
    busyElement?.setAttribute('aria-busy', 'true');

    const isCurrent = () => channels.get(name)?.token === token;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      root?.classList.remove(...rootClasses);
      element?.classList.remove(...elementClasses);
      busyElement?.removeAttribute('aria-busy');
      if (isCurrent()) channels.delete(name);
    };

    const lease = {
      token,
      isCurrent,
      finish: cleanup,
      cancel: cleanup,
      async wait(target, {
        property,
        animation,
        timeout = 420,
      } = {}) {
        if (!(target instanceof Element)) {
          await nextPaint();
          return isCurrent();
        }
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
          await nextPaint();
          return isCurrent();
        }
        await new Promise((resolve) => {
          let timer = 0;
          const done = () => {
            target.removeEventListener('transitionend', onTransition);
            target.removeEventListener('transitioncancel', done);
            target.removeEventListener('animationend', onAnimation);
            target.removeEventListener('animationcancel', done);
            window.clearTimeout(timer);
            resolve();
          };
          const onTransition = (event) => {
            if (event.target !== target || (property && event.propertyName !== property)) return;
            done();
          };
          const onAnimation = (event) => {
            if (event.target !== target || (animation && event.animationName !== animation)) return;
            done();
          };
          target.addEventListener('transitionend', onTransition);
          target.addEventListener('transitioncancel', done, { once: true });
          target.addEventListener('animationend', onAnimation);
          target.addEventListener('animationcancel', done, { once: true });
          timer = window.setTimeout(done, timeout);
        });
        return isCurrent();
      },
    };

    channels.set(name, lease);
    return lease;
  }

  function cancel(name) {
    channels.get(name)?.cancel();
  }

  function cancelAll() {
    for (const lease of [...channels.values()]) lease.cancel();
  }

  window.addEventListener('pagehide', cancelAll, { once: true, passive: true });
  return { begin, cancel, cancelAll, isActive: (name) => channels.has(name) };
}

export const motionController = createMotionController();
