// src/api/userApi.ts

import axiosClient from './axiosClient';
import type {
  AdminUser,
  CreateUserPayload,
  RoleListResponse,
  UserListResponse,
} from '../types';

export const userApi = {
  getUsers: async (params?: {
    search?: string;
    role?: string;
    status?: string;
    page?: number;
    page_size?: number;
    sort_by?: string;
    sort_order?: string;
  }): Promise<UserListResponse> => {
    const { data } = await axiosClient.get<UserListResponse>(
      '/api/v1/admin/users',
      { params }
    );
    return data;
  },

  getUser: async (userId: string): Promise<AdminUser> => {
    const { data } = await axiosClient.get<AdminUser>(
      `/api/v1/admin/users/${userId}`
    );
    return data;
  },

  createUser: async (payload: CreateUserPayload): Promise<AdminUser> => {
    const { data } = await axiosClient.post<AdminUser>(
      '/api/v1/admin/users',
      payload
    );
    return data;
  },

  updateUser: async (
    userId: string,
    payload: { full_name?: string; role_ids?: string[] }
  ): Promise<AdminUser> => {
    const { data } = await axiosClient.put<AdminUser>(
      `/api/v1/admin/users/${userId}`,
      payload
    );
    return data;
  },

  lockUser: async (userId: string): Promise<AdminUser> => {
    const { data } = await axiosClient.post<AdminUser>(
      `/api/v1/admin/users/${userId}/lock`
    );
    return data;
  },

  unlockUser: async (userId: string): Promise<AdminUser> => {
    const { data } = await axiosClient.post<AdminUser>(
      `/api/v1/admin/users/${userId}/unlock`
    );
    return data;
  },

  resetPassword: async (
    userId: string,
    newPassword?: string
  ): Promise<{ status: string; message: string }> => {
    const { data } = await axiosClient.post<{ status: string; message: string }>(
      `/api/v1/admin/users/${userId}/reset-password`,
      newPassword ? { new_password: newPassword } : undefined
    );
    return data;
  },

  deleteUser: async (userId: string): Promise<void> => {
    await axiosClient.delete(`/api/v1/admin/users/${userId}`);
  },

  getRoles: async (): Promise<RoleListResponse> => {
    const { data } = await axiosClient.get<RoleListResponse>(
      '/api/v1/admin/roles'
    );
    return data;
  },
};
