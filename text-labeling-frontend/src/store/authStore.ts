// src/store/authStore.ts

import { create } from 'zustand';
import type { AuthState, User } from '../types/auth';

export const useAuthStore = create<AuthState>((set) => ({
  // ─── State ──────────────────────────────────────────────
  token: null,
  refreshToken: null,
  user: null,
  isAuthenticated: false,
  isInitialized: false,

  // ─── Actions ────────────────────────────────────────────

  /**
   * Called after successful login.
   * Persists token + user to localStorage and updates state.
   */
  setAuth: (token: string, refreshToken: string, user: User) => {
    localStorage.setItem('access_token', token);
    localStorage.setItem('refresh_token', refreshToken);
    localStorage.setItem('user', JSON.stringify(user));

    set({
      token,
      refreshToken,
      user,
      isAuthenticated: true,
      isInitialized: true,
    });
  },

  /**
   * Update user profile in state (e.g. after /auth/me fetch).
   */
  setUser: (user: User) => {
    localStorage.setItem('user', JSON.stringify(user));
    set({ user });
  },

  /**
   * Clear all auth state and localStorage.
   */
  logout: () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');

    set({
      token: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,
      isInitialized: true,
    });
  },

  /**
   * Rehydrate state from localStorage on app startup.
   * Called once in App.tsx or main.tsx.
   */
  initialize: () => {
    const token = localStorage.getItem('access_token');
    const refreshToken = localStorage.getItem('refresh_token');
    const userStr = localStorage.getItem('user');

    if (token && userStr) {
      try {
        const user = JSON.parse(userStr) as User;
        set({
          token,
          refreshToken,
          user,
          isAuthenticated: true,
          isInitialized: true,
        });
        return;
      } catch {
        // Corrupted data — clear everything
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
      }
    }

    set({
      token: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,
      isInitialized: true,
    });
  },
}));
