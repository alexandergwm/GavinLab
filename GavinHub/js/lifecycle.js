/** Browser lifecycle helpers shared by startup, routing, and deferred features. */

export function nextPaint(frames = 1) {
  return new Promise((resolve) => {
    const step = (remaining) => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => step(remaining - 1));
    };
    step(Math.max(1, frames));
  });
}

export function waitForTransition(element, {
  property,
  timeout = 420,
} = {}) {
  if (!(element instanceof Element)) return nextPaint();
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return nextPaint();

  return new Promise((resolve) => {
    let timer = 0;
    const finish = () => {
      element.removeEventListener('transitionend', onEnd);
      element.removeEventListener('transitioncancel', finish);
      window.clearTimeout(timer);
      resolve();
    };
    const onEnd = (event) => {
      if (event.target !== element) return;
      if (property && event.propertyName !== property) return;
      finish();
    };
    element.addEventListener('transitionend', onEnd);
    element.addEventListener('transitioncancel', finish, { once: true });
    timer = window.setTimeout(finish, timeout);
  });
}

export async function loadOptionalModules(loaders, onError = console.error) {
  const entries = Object.entries(loaders);
  const loaded = await Promise.all(entries.map(async ([name, loader]) => {
    try {
      return [name, await loader()];
    } catch (error) {
      onError(`[GavinHub] ${name} failed to load`, error);
      return [name, null];
    }
  }));
  return Object.fromEntries(loaded);
}

export function settleWithin(promise, timeoutMs) {
  let timer = 0;
  const result = Promise.resolve(promise).then(
    (value) => ({ settled: true, value, error: null }),
    (error) => ({ settled: true, value: null, error }),
  );
  const timeout = new Promise((resolve) => {
    timer = window.setTimeout(() => {
      resolve({ settled: false, value: null, error: null });
    }, timeoutMs);
  });
  return Promise.race([result, timeout]).finally(() => window.clearTimeout(timer));
}

export function runWhenIdle(task, { timeout = 1000, fallbackDelay = 160 } = {}) {
  let cancelled = false;
  const run = () => {
    if (cancelled) return;
    Promise.resolve().then(task).catch((error) => {
      console.warn('[GavinHub] deferred task failed', error);
    });
  };

  if ('requestIdleCallback' in window) {
    const id = requestIdleCallback(run, { timeout });
    return () => {
      cancelled = true;
      cancelIdleCallback(id);
    };
  }

  const id = window.setTimeout(run, fallbackDelay);
  return () => {
    cancelled = true;
    window.clearTimeout(id);
  };
}
