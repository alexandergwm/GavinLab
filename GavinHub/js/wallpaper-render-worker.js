self.addEventListener('message', async (event) => {
  const {
    id,
    bitmap,
    width,
    height,
    filter,
    overscan,
    quality,
  } = event.data || {};

  try {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx || !('filter' in ctx)) throw new Error('filtered canvas unavailable');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.filter = filter;
    ctx.drawImage(
      bitmap,
      -overscan,
      -overscan,
      width + overscan * 2,
      height + overscan * 2,
    );
    bitmap.close?.();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    self.postMessage({ id, blob });
  } catch (error) {
    bitmap?.close?.();
    self.postMessage({ id, error: error?.message || 'wallpaper render failed' });
  }
});
