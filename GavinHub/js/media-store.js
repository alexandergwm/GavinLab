/** Shared IndexedDB storage for wallpapers and shortcut icon blobs. */

const DB_NAME = 'wallpaper-db';
const STORE_NAME = 'wallpapers';
const CACHE_STORE = 'wallpaper-cache';
const ICON_CACHE_STORE = 'icon-cache';

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
    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'cacheKey' });
      }
      if (!db.objectStoreNames.contains(ICON_CACHE_STORE)) {
        db.createObjectStore(ICON_CACHE_STORE, { keyPath: 'iconKey' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

export async function saveWallpaperBlobCache(cacheKey, blob) {
  if (!cacheKey || !blob) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    tx.objectStore(CACHE_STORE).put({ cacheKey, blob, savedAt: Date.now() });
    tx.oncomplete = () => resolve();
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
