// src/api/authApi.ts

import axiosClient from './axiosClient';
import type { LoginResponse, User } from '../types/auth';

export const authApi = {
  /**
   * Login with email + password.
   * Backend expects JSON body: { email, password }
   */
  login: async (email: string, password: string): Promise<LoginResponse> => {
    const { data } = await axiosClient.post<LoginResponse>(
      '/api/v1/auth/login',
      { email, password }
    );
    return data;
  },

  /**
   * Logout: revoke refresh token server-side.
   */
  logout: async (refreshToken: string): Promise<void> => {
    await axiosClient.post('/api/v1/auth/logout', {
      refresh_token: refreshToken,
    });
  },

  /**
   * Get current authenticated user's profile.
   */
  getMe: async (): Promise<User> => {
    const { data } = await axiosClient.get<User>('/api/v1/auth/me');
    return data;
  },

  /**
   * Refresh access token.
   */
  refresh: async (refreshToken: string) => {
    const { data } = await axiosClient.post('/api/v1/auth/refresh', {
      refresh_token: refreshToken,
    });
    return data;
  },

  /**
   * Update current user's profile (name, avatar_url).
   */
  updateProfile: async (payload: { full_name?: string; avatar_url?: string }): Promise<User> => {
    const { data } = await axiosClient.put<User>('/api/v1/auth/me', payload);
    return data;
  },

  /**
   * Change password. Requires current password for verification.
   */
  changePassword: async (payload: {
    current_password: string;
    new_password: string;
  }): Promise<{ message: string }> => {
    const { data } = await axiosClient.put<{ message: string }>(
      '/api/v1/auth/me/password',
      payload
    );
    return data;
  },
};