// src/api/apiConfig.ts

const LOCAL_API_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;
const rawApiUrl = (import.meta.env.VITE_API_URL ?? '').trim();

const shouldUseDevProxy =
  import.meta.env.DEV && (!rawApiUrl || LOCAL_API_ORIGIN.test(rawApiUrl));

export const API_BASE_URL = (shouldUseDevProxy ? '' : rawApiUrl).replace(/\/+$/, '');

export function buildApiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return API_BASE_URL ? `${API_BASE_URL}${normalizedPath}` : normalizedPath;
}
