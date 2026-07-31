/** Shared IndexedDB storage for wallpapers and shortcut icon blobs. */

const DB_NAME = 'wallpaper-db';
const STORE_NAME = 'wallpapers';
const CACHE_STORE = 'wallpaper-cache';
const EFFECT_CACHE_STORE = 'wallpaper-effect-cache';
const ICON_CACHE_STORE = 'icon-cache';
const CACHE_TIMESTAMP_INDEX = 'savedAt';
const MAX_WALLPAPER_CACHE_ITEMS = 6;
const MAX_EFFECT_CACHE_ITEMS = 12;

const libraryObjectUrls = new Map();
const iconObjectUrls = new Map();
let dbPromise = null;

window.addEventListener('pagehide', () => {
  for (const url of libraryObjectUrls.values()) URL.revokeObjectURL(url);
  libraryObjectUrls.clear();
  for (const url of iconObjectUrls.values()) URL.revokeObjectURL(url);
  iconObjectUrls.clear();
  void dbPromise?.then((db) => db.close()).catch(() => {});
  dbPromise = null;
}, { once: true });

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 4);
    let settled = false;
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      const cacheStore = db.objectStoreNames.contains(CACHE_STORE)
        ? event.target.transaction.objectStore(CACHE_STORE)
        : db.createObjectStore(CACHE_STORE, { keyPath: 'cacheKey' });
      if (!cacheStore.indexNames.contains(CACHE_TIMESTAMP_INDEX)) {
        cacheStore.createIndex(CACHE_TIMESTAMP_INDEX, 'savedAt');
      }
      const effectStore = db.objectStoreNames.contains(EFFECT_CACHE_STORE)
        ? event.target.transaction.objectStore(EFFECT_CACHE_STORE)
        : db.createObjectStore(EFFECT_CACHE_STORE, { keyPath: 'effectKey' });
      if (!effectStore.indexNames.contains(CACHE_TIMESTAMP_INDEX)) {
        effectStore.createIndex(CACHE_TIMESTAMP_INDEX, 'savedAt');
      }
      if (!db.objectStoreNames.contains(ICON_CACHE_STORE)) {
        db.createObjectStore(ICON_CACHE_STORE, { keyPath: 'iconKey' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      if (settled) return;
      settled = true;
      dbPromise = null;
      reject(req.error);
    };
    req.onblocked = () => {
      if (settled) return;
      settled = true;
      dbPromise = null;
      reject(new Error('wallpaper database upgrade blocked by another tab'));
    };
  });
  return dbPromise;
}

async function pruneStore(storeName, maxItems) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const index = store.index(CACHE_TIMESTAMP_INDEX);
      let kept = 0;
      const req = index.openKeyCursor(null, 'prev');
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        kept += 1;
        if (kept > maxItems) store.delete(cursor.primaryKey);
        cursor.continue();
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* cache pruning is best-effort */
  }
}

export async function saveWallpaperBlobCache(cacheKey, blob) {
  if (!cacheKey || !blob) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    tx.objectStore(CACHE_STORE).put({ cacheKey, blob, savedAt: Date.now() });
    tx.oncomplete = () => {
      resolve();
      void pruneStore(CACHE_STORE, MAX_WALLPAPER_CACHE_ITEMS);
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteWallpaperBlobCache(cacheKey) {
  if (!cacheKey) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    tx.objectStore(CACHE_STORE).delete(cacheKey);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function getWallpaperBlobCache(cacheKey) {
  if (!cacheKey) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readonly');
    const req = tx.objectStore(CACHE_STORE).get(cacheKey);
    req.onsuccess = () => resolve(req.result?.blob || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveWallpaperEffectBlobCache(effectKey, blob) {
  if (!effectKey || !blob?.size) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EFFECT_CACHE_STORE, 'readwrite');
    tx.objectStore(EFFECT_CACHE_STORE).put({ effectKey, blob, savedAt: Date.now() });
    tx.oncomplete = () => {
      resolve();
      void pruneStore(EFFECT_CACHE_STORE, MAX_EFFECT_CACHE_ITEMS);
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function getWallpaperEffectBlobCache(effectKey) {
  if (!effectKey) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EFFECT_CACHE_STORE, 'readonly');
    const req = tx.objectStore(EFFECT_CACHE_STORE).get(effectKey);
    req.onsuccess = () => resolve(req.result?.blob || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getLibraryWallpapers() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      const items = (req.result || []).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getLibraryWallpaper(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveWallpaperToLibrary(entry) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve(entry);
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeLibraryWallpaper(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => {
      const url = libraryObjectUrls.get(id);
      if (url) URL.revokeObjectURL(url);
      libraryObjectUrls.delete(id);
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export function libraryEntryToWallpaper(entry) {
  if (!entry) return null;
  let url = entry.objectUrl || entry.url;
  if (!url && entry.blob) {
    url = libraryObjectUrls.get(entry.id);
    if (!url) {
      url = URL.createObjectURL(entry.blob);
      libraryObjectUrls.set(entry.id, url);
    }
  }
  return {
    id: entry.id,
    url,
    type: entry.type || 'image',
    css: entry.css || '',
    title: entry.title || '已保存壁纸',
    description: entry.description || '',
    credit: entry.credit || '本地收藏库',
    dateKey: entry.id,
    source: 'library',
  };
}

export async function saveIconBlobCache(iconKey, blob) {
  if (!iconKey || !blob) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ICON_CACHE_STORE, 'readwrite');
    tx.objectStore(ICON_CACHE_STORE).put({ iconKey, blob, savedAt: Date.now() });
    tx.oncomplete = () => {
      const url = iconObjectUrls.get(iconKey);
      if (url) URL.revokeObjectURL(url);
      iconObjectUrls.delete(iconKey);
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function getIconBlobCache(iconKey) {
  if (!iconKey) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ICON_CACHE_STORE, 'readonly');
    const req = tx.objectStore(ICON_CACHE_STORE).get(iconKey);
    req.onsuccess = () => resolve(req.result?.blob || null);
    req.onerror = () => reject(req.error);
  });
}

/** Returns a stable, session-scoped blob URL for a cached icon. */
export async function getIconObjectUrl(iconKey) {
  const existing = iconObjectUrls.get(iconKey);
  if (existing) return existing;
  const blob = await getIconBlobCache(iconKey);
  if (!blob) return null;
  const concurrent = iconObjectUrls.get(iconKey);
  if (concurrent) return concurrent;
  const url = URL.createObjectURL(blob);
  iconObjectUrls.set(iconKey, url);
  return url;
}
