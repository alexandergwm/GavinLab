import { KEYS } from './keys.js';

const CREDENTIALS_KEY = 'gavinhubCredentials';
let cachedToken = null;

function hasExtensionStorage() {
  return typeof chrome !== 'undefined' && chrome.storage?.local;
}

function storageGet(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      void chrome.runtime.lastError;
      resolve(result?.[key] || null);
    });
  });
}

function storageSet(value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [CREDENTIALS_KEY]: value }, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

export async function loadGithubToken() {
  if (cachedToken != null) return cachedToken;
  const legacyToken = localStorage.getItem(KEYS.githubToken) || '';

  if (!hasExtensionStorage()) {
    cachedToken = legacyToken;
    return cachedToken;
  }

  const stored = await storageGet(CREDENTIALS_KEY);
  cachedToken = stored?.githubToken || legacyToken;
  if (!stored?.githubToken && legacyToken) {
    await storageSet({ ...(stored || {}), githubToken: legacyToken });
    localStorage.removeItem(KEYS.githubToken);
  }
  return cachedToken;
}

export async function saveGithubToken(token) {
  const trimmed = token?.trim() || '';
  if (!hasExtensionStorage()) {
    if (trimmed) localStorage.setItem(KEYS.githubToken, trimmed);
    else localStorage.removeItem(KEYS.githubToken);
    cachedToken = trimmed;
    return;
  }

  const stored = await storageGet(CREDENTIALS_KEY);
  await storageSet({ ...(stored || {}), githubToken: trimmed });
  localStorage.removeItem(KEYS.githubToken);
  cachedToken = trimmed;
}

export function clearCredentialCache() {
  cachedToken = null;
}
