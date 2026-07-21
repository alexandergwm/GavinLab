/** 全站 localStorage / sessionStorage 键名 — 扩展功能时在此登记 */

export const KEYS = {
  settings: 'startpage-settings',
  wallpaperFavorites: 'startpage-wallpaper-favorites',
  wallpaperRotation: 'startpage-wallpaper-rotation',
  wallpaperLast: 'startpage-wallpaper-last',
  wallpaperRecent: 'startpage-wallpaper-recent',
  bingWallpaperIdx: 'startpage-bing-wallpaper-idx',
  shortcuts: 'startpage-shortcuts',
  dock: 'startpage-dock',
  todos: 'startpage-todos',
  countdowns: 'startpage-countdowns',
  goals: 'startpage-goals',
  importantDates: 'startpage-important-dates',
  rssSources: 'startpage-rss-sources',
  rssStats: 'startpage-rss-stats',
  newsCache: 'startpage-news-cache',
  arxivKeywords: 'startpage-arxiv-keywords',
  weatherLoc: 'startpage-weather-loc',
  weatherData: 'startpage-weather-data',
  aiLoginHint: 'startpage-ai-login-hint',
  fxRates: 'startpage-fx-rates',
  greetingLast: 'startpage-greeting-last',
  githubToken: 'startpage-github-token',
  githubGistId: 'startpage-github-gist-id',
};

export const SESSION_KEYS = {
  newsRotation: 'startpage-news-rotation',
};

/** 命中后不再请求搜索引擎联想的智能建议 id */
export const BLOCKING_SMART_IDS = ['url', 'doi', 'weather', 'calc', 'base', 'datasize'];
