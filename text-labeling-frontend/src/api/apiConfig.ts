// src/api/apiConfig.ts

const DEFAULT_API_URL = 'http://localhost:8000';

export const API_BASE_URL = (import.meta.env.VITE_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');

export function buildApiUrl(path: string) {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}
