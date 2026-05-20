// src/api/notificationApi.ts

import axiosClient from './axiosClient';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  actor_name: string | null;
  created_at: string;
}

export interface NotificationListResponse {
  notifications: NotificationItem[];
  unread_count: number;
  total: number;
}

export interface NotificationPrefs {
  task_assigned: boolean;
  task_rejected: boolean;
  project_deadline: boolean;
  review_complete: boolean;
  task_submitted: boolean;
  annotation_milestone: boolean;
  export_ready: boolean;
}

export const notificationApi = {
  list: async (params?: { limit?: number; offset?: number; unread_only?: boolean }): Promise<NotificationListResponse> => {
    const { data } = await axiosClient.get<NotificationListResponse>('/api/v1/notifications', { params });
    return data;
  },

  markRead: async (id: string): Promise<void> => {
    await axiosClient.post(`/api/v1/notifications/${id}/read`);
  },

  markAllRead: async (): Promise<void> => {
    await axiosClient.post('/api/v1/notifications/read-all');
  },

  getPreferences: async (): Promise<NotificationPrefs> => {
    const { data } = await axiosClient.get<NotificationPrefs>('/api/v1/notifications/preferences');
    return data;
  },

  updatePreferences: async (prefs: NotificationPrefs): Promise<NotificationPrefs> => {
    const { data } = await axiosClient.put<NotificationPrefs>('/api/v1/notifications/preferences', prefs);
    return data;
  },
};
