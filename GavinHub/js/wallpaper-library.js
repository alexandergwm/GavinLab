import { closeDialog, openDialog } from './dialog-ui.js';
import {
  getLibraryWallpapers,
  getLibraryWallpaper,
  saveWallpaperToLibrary,
  removeLibraryWallpaper,
  libraryEntryToWallpaper,
} from './media-store.js';

export {
  saveWallpaperBlobCache,
  getWallpaperBlobCache,
  getLibraryWallpapers,
  getLibraryWallpaper,
  saveWallpaperToLibrary,
  removeLibraryWallpaper,
  libraryEntryToWallpaper,
  saveIconBlobCache,
  getIconBlobCache,
  getIconObjectUrl,
} from './media-store.js';

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
    return Promise.all(getWallpaperFavorites().map(async (item) => {
      if (item.source === 'library') {
        try {
          const resolved = libraryEntryToWallpaper(await getLibraryWallpaper(item.id));
          if (resolved) {
            return { ...item, ...resolved, thumbUrl: resolved.url, origin: 'favorite' };
          }
        } catch { /* keep the favorite metadata as a fallback */ }
      }
      const thumbUrl = item.url?.startsWith('blob:') ? '' : item.url;
      return { ...item, thumbUrl, origin: 'favorite' };
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
  let renderGeneration = 0;
  let libraryActive = false;

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
    const generation = ++renderGeneration;
    const tab = activeTab;
    let nextItems;
    try {
      nextItems = await loadGridItems(tab);
    } catch {
      if (generation === renderGeneration && libraryActive) {
        setStatus('图库加载失败，请稍后重试', true);
      }
      return;
    }
    if (generation !== renderGeneration || !libraryActive) {
      revokeThumbUrls(nextItems);
      return;
    }
    revokeThumbUrls(currentItems);
    currentItems = nextItems;
    grid.replaceChildren();

    if (!currentItems.length) {
      emptyEl.hidden = false;
      emptyEl.textContent = tab === 'favorites' ? '暂无收藏，点击红心收藏当前壁纸' : '暂无已保存壁纸，点击下方保存当前壁纸';
      return;
    }

    emptyEl.hidden = true;
    for (const item of currentItems) {
      grid.append(createThumb(item, async (selected) => {
        try {
          const payload = selected.origin === 'library'
            ? libraryEntryToWallpaper(await getLibraryWallpaper(selected.id))
            : selected;
          if (!payload) throw new Error('Wallpaper missing');
          await applySelectedWallpaper(payload);
          closeDialog(dialog);
          onFavoriteChange?.();
        } catch {
          setStatus('壁纸应用失败，请重试', true);
        }
      }));
    }
  };

  const open = () => {
    libraryActive = true;
    openDialog(dialog);
    void renderGrid();
  };

  tabs?.forEach((tab) => {
    tab.addEventListener('click', () => {
      activeTab = tab.dataset.wallpaperTab;
      tabs.forEach((el) => el.classList.toggle('active', el === tab));
      void renderGrid();
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

  dialog.addEventListener('close', () => {
    libraryActive = false;
    renderGeneration += 1;
    revokeThumbUrls(currentItems);
    currentItems = [];
  });

  return { open };
}
