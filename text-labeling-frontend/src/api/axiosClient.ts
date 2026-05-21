// src/api/axiosClient.ts

import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL, buildApiUrl } from './apiConfig';

type RetriableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
  _retryCount?: number;
};

const API_TIMEOUT_MS = 30000;
const MAX_GET_RETRIES = 2;
const RETRYABLE_METHODS = new Set(['get', 'head', 'options']);
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function shouldRetry(error: AxiosError) {
  const config = error.config as RetriableRequestConfig | undefined;
  if (!config) return false;

  const method = (config.method ?? 'get').toLowerCase();
  if (!RETRYABLE_METHODS.has(method)) return false;

  const retryCount = config._retryCount ?? 0;
  if (retryCount >= MAX_GET_RETRIES) return false;

  if (!error.response || error.code === 'ECONNABORTED') return true;

  return RETRYABLE_STATUS_CODES.has(error.response.status);
}

const axiosClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: API_TIMEOUT_MS,
});

// ─── Request Interceptor ────────────────────────────────────
// Attach Bearer token from localStorage to every request
axiosClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ─── Response Interceptor ───────────────────────────────────
// Handle 401 errors: attempt token refresh, then retry original request
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value?: unknown) => void;
  reject: (reason?: unknown) => void;
}> = [];

const processQueue = (error: unknown) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve();
    }
  });
  failedQueue = [];
};

axiosClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as RetriableRequestConfig | undefined;

    if (!originalRequest) {
      return Promise.reject(error);
    }

    if (shouldRetry(error)) {
      originalRequest._retryCount = (originalRequest._retryCount ?? 0) + 1;
      await wait(500 * originalRequest._retryCount);
      return axiosClient(originalRequest);
    }

    // Skip refresh for login and refresh endpoints themselves
    const skipPaths = ['/api/v1/auth/login', '/api/v1/auth/refresh'];
    if (skipPaths.some((p) => originalRequest.url?.includes(p))) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        // Queue requests while refresh is in progress
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(() => axiosClient(originalRequest));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem('refresh_token');
      if (!refreshToken) {
        // No refresh token — force logout
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
        window.location.href = '/login';
        return Promise.reject(error);
      }

      try {
        const { data } = await axios.post(buildApiUrl('/api/v1/auth/refresh'), {
          refresh_token: refreshToken,
        });

        localStorage.setItem('access_token', data.access_token);
        localStorage.setItem('refresh_token', data.refresh_token);

        axiosClient.defaults.headers.common.Authorization = `Bearer ${data.access_token}`;
        originalRequest.headers.Authorization = `Bearer ${data.access_token}`;

        processQueue(null);
        return axiosClient(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError);
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default axiosClient;
