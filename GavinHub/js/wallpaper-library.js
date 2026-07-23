import { closeDialog, openDialog } from './dialog-ui.js';

const DB_NAME = 'wallpaper-db';
const STORE_NAME = 'wallpapers';
const CACHE_STORE = 'wallpaper-cache';
const ICON_CACHE_STORE = 'icon-cache';

function openDb() {
  return new Promise((resolve, reject) => {
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
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function libraryEntryToWallpaper(entry) {
  if (!entry) return null;
  const url = entry.objectUrl || (entry.blob ? URL.createObjectURL(entry.blob) : entry.url);
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

async function blobFromWallpaper(wallpaper) {
  if (wallpaper.type === 'gradient' && wallpaper.css) {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    const stops = wallpaper.css.match(/#[0-9a-fA-F]{3,8}/g) || ['#667eea', '#764ba2'];
    stops.forEach((color, i) => {
      gradient.addColorStop(i / Math.max(stops.length - 1, 1), color);
    });
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  }

  if (!wallpaper.url) throw new Error('No wallpaper url');

  try {
    const res = await fetch(wallpaper.url, { mode: 'cors', cache: 'no-store' });
    if (res.ok) return res.blob();
  } catch {
    /* fall through to canvas capture */
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 1920;
      canvas.height = img.naturalHeight || 1080;
      canvas.getContext('2d').drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas export failed'));
      }, 'image/jpeg', 0.92);
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = wallpaper.url;
  });
}

export async function downloadWallpaperToLibrary(wallpaper) {
  const blob = await blobFromWallpaper(wallpaper);
  const id = `lib-${Date.now()}`;
  const entry = {
    id,
    blob,
    type: 'image',
    title: wallpaper.title || '已保存壁纸',
    description: wallpaper.description || '',
    credit: wallpaper.credit || '',
    originalUrl: wallpaper.url || '',
    savedAt: Date.now(),
  };
  await saveWallpaperToLibrary(entry);
  return entry;
}

let activeTab = 'favorites';
let refreshGrid = null;

function createThumb(item, onSelect) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'wallpaper-thumb';
  btn.title = item.title || '壁纸';

  if (item.type === 'gradient' && item.css) {
    btn.style.backgroundImage = item.css;
  } else if (item.thumbUrl) {
    btn.style.backgroundImage = `url("${item.thumbUrl}")`;
  } else if (item.url) {
    btn.style.backgroundImage = `url("${item.url}")`;
  }

  const label = document.createElement('span');
  label.className = 'wallpaper-thumb-label';
  label.textContent = item.title || '壁纸';
  btn.append(label);

  btn.addEventListener('click', () => onSelect(item));
  return btn;
}

async function loadGridItems(tab) {
  const { getWallpaperFavorites } = await import('./storage.js');

  if (tab === 'favorites') {
    return getWallpaperFavorites().map((item) => ({
      ...item,
      thumbUrl: item.url,
      origin: 'favorite',
    }));
  }

  const library = await getLibraryWallpapers();
  return library.map((entry) => {
    const url = URL.createObjectURL(entry.blob);
    return {
      id: entry.id,
      url,
      thumbUrl: url,
      type: 'image',
      title: entry.title,
      description: entry.description,
      credit: entry.credit,
      dateKey: entry.id,
      source: 'library',
      origin: 'library',
      _revoke: url,
    };
  });
}

function revokeThumbUrls(items) {
  for (const item of items) {
    if (item._revoke) URL.revokeObjectURL(item._revoke);
  }
}

export function initWallpaperLibrary({ getCurrentWallpaper, applySelectedWallpaper, onFavoriteChange }) {
  const dialog = document.getElementById('wallpaper-library-dialog');
  const grid = document.getElementById('wallpaper-library-grid');
  const emptyEl = document.getElementById('wallpaper-library-empty');
  const statusEl = document.getElementById('wallpaper-library-status');
  const tabs = dialog?.querySelectorAll('[data-wallpaper-tab]');
  const saveBtn = document.getElementById('wallpaper-library-save');
  if (!dialog || !grid) return;

  let currentItems = [];

  const setStatus = (text, isError = false) => {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.hidden = !text;
    statusEl.classList.toggle('is-error', isError);
    if (text) {
      clearTimeout(setStatus._timer);
      setStatus._timer = setTimeout(() => {
        statusEl.hidden = true;
        statusEl.textContent = '';
      }, 2800);
    }
  };

  const renderGrid = async () => {
    revokeThumbUrls(currentItems);
    currentItems = await loadGridItems(activeTab);
    grid.replaceChildren();

    if (!currentItems.length) {
      emptyEl.hidden = false;
      emptyEl.textContent = activeTab === 'favorites' ? '暂无收藏，点击红心收藏当前壁纸' : '暂无已保存壁纸，点击下方保存当前壁纸';
      return;
    }

    emptyEl.hidden = true;
    for (const item of currentItems) {
      grid.append(createThumb(item, async (selected) => {
        await applySelectedWallpaper(selected);
        closeDialog(dialog);
        onFavoriteChange?.();
      }));
    }
  };

  const open = () => {
    openDialog(dialog);
    renderGrid();
  };

  refreshGrid = renderGrid;

  tabs?.forEach((tab) => {
    tab.addEventListener('click', () => {
      activeTab = tab.dataset.wallpaperTab;
      tabs.forEach((el) => el.classList.toggle('active', el === tab));
      renderGrid();
    });
  });

  saveBtn?.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      const wp = getCurrentWallpaper();
      await downloadWallpaperToLibrary(wp);
      setStatus('已保存到本地库');
      if (activeTab === 'library') await renderGrid();
    } catch {
      setStatus('保存失败，请换一张壁纸重试', true);
    } finally {
      saveBtn.disabled = false;
    }
  });

  dialog.addEventListener('close', () => revokeThumbUrls(currentItems));

  return { open };
}

export function refreshWallpaperLibraryGrid() {
  refreshGrid?.();
}

// ===== Icon blob cache (for shortcut/dock favicons etc. to avoid repeated remote fetches) =====

export async function saveIconBlobCache(iconKey, blob) {
  if (!iconKey || !blob) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ICON_CACHE_STORE, 'readwrite');
    tx.objectStore(ICON_CACHE_STORE).put({ iconKey, blob, savedAt: Date.now() });
    tx.oncomplete = () => resolve();
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

/** Returns a blob: object URL if cached, else null. Caller should keep the url for revoke if needed (for shortcuts we keep per-session). */
export async function getIconObjectUrl(iconKey) {
  const blob = await getIconBlobCache(iconKey);
  if (blob) return URL.createObjectURL(blob);
  return null;
}
