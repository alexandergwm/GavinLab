/** Non-render-blocking stylesheet activation with shared in-flight promises. */
const entries = new Map();

export function ensureStyle(id) {
  const cached = entries.get(id);
  if (cached?.status === 'ready') return Promise.resolve(cached.link);
  if (cached?.promise) return cached.promise;

  const preload = document.querySelector(`link[data-lazy-style="${id}"]`);
  if (!(preload instanceof HTMLLinkElement) || !preload.href) {
    return Promise.reject(new Error(`Missing lazy stylesheet: ${id}`));
  }

  const entry = cached || { status: 'idle', link: null, promise: null };
  entry.status = 'loading';
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = preload.href;
  link.dataset.activeStyle = id;
  entry.link = link;
  entry.promise = new Promise((resolve, reject) => {
    link.addEventListener('load', () => {
      entry.status = 'ready';
      entry.promise = null;
      preload.remove();
      resolve(link);
    }, { once: true });
    link.addEventListener('error', () => {
      entry.status = 'failed';
      entry.promise = null;
      link.remove();
      reject(new Error(`Failed to load stylesheet: ${id}`));
    }, { once: true });
  });
  entries.set(id, entry);
  document.head.appendChild(link);
  return entry.promise;
}

export function getStyleStatus(id) {
  return entries.get(id)?.status || 'idle';
}
