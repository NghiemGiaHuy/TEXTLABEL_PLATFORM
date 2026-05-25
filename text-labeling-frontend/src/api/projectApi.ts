// src/api/projectApi.ts

import axiosClient from './axiosClient';
import type {
  CreateProjectPayload,
  Project,
  ProjectListResponse,
} from '../types';

// ─── Export types ─────────────────────────────────────────────
export interface ExportRecord {
  id: string;
  project_id: string;
  dataset_id: string | null;
  exported_by: string;
  format: string;
  filter_status: string;
  file_url: string | null;
  total_records: number;
  created_at: string;
}

export interface ExportDownloadData {
  export_info: ExportRecord;
  data: Array<{
    sample_id: string;
    content: string;
    annotations: Array<{
      label: string;
      start: number;
      end: number;
      text: string;
    }>;
    annotator?: string | null;
    review_status?: string | null;
    metadata?: Record<string, unknown>;
  }>;
}

// ─── Dashboard types ──────────────────────────────────────────
export interface RecentProject {
  id: string;
  name: string;
  code: string;
  deadline: string | null;
  status: string;
  progress: number;
  total_samples: number;
  pending_review: number;
}

export interface ActivityItem {
  id: string;
  action: string;
  entity_type: string;
  user_id: string | null;
  user_full_name: string | null;
  created_at: string;
}

export interface DashboardData {
  recent_projects: RecentProject[];
  recent_activity: ActivityItem[];
}

export interface DailyProgress {
  date: string;
  count: number;
}

export interface DashboardStats {
  total_samples: number;
  annotated_count: number;
  pending_review: number;
  approved_count: number;
  completion_rate: number;
  daily_progress: DailyProgress[];
}

export const projectApi = {
  getDashboard: async (): Promise<DashboardData> => {
    const { data } = await axiosClient.get<DashboardData>('/api/v1/dashboard');
    return data;
  },

  getDashboardStats: async (days?: number): Promise<DashboardStats> => {
    const { data } = await axiosClient.get<DashboardStats>('/api/v1/dashboard/stats', {
      params: days ? { days } : {},
    });
    return data;
  },

  getProjects: async (params?: {
    search?: string;
    status?: string;
    page?: number;
    page_size?: number;
  }): Promise<ProjectListResponse> => {
    const { data } = await axiosClient.get<ProjectListResponse>(
      '/api/v1/projects',
      { params }
    );
    return data;
  },

  getProject: async (projectId: string): Promise<Project> => {
    const { data } = await axiosClient.get<Project>(
      `/api/v1/projects/${projectId}`
    );
    return data;
  },

  createProject: async (payload: CreateProjectPayload): Promise<Project> => {
    const { data } = await axiosClient.post<Project>(
      '/api/v1/projects',
      payload
    );
    return data;
  },

  updateProject: async (
    projectId: string,
    payload: Partial<CreateProjectPayload & { status: string }>
  ): Promise<Project> => {
    const { data } = await axiosClient.put<Project>(
      `/api/v1/projects/${projectId}`,
      payload
    );
    return data;
  },

  deleteProject: async (projectId: string): Promise<void> => {
    await axiosClient.delete(`/api/v1/projects/${projectId}`);
  },

  archiveProject: async (projectId: string): Promise<Project> => {
    const { data } = await axiosClient.post<Project>(
      `/api/v1/projects/${projectId}/archive`
    );
    return data;
  },

  // ─── Export endpoints ─────────────────────────────────────

  /** Create an export (generates file on server) */
  createExport: async (
    projectId: string,
    payload: {
      format: 'json' | 'jsonl' | 'csv';
      filter_status: 'approved_only' | 'all';
      dataset_id?: string;
      include_metadata?: boolean;
    }
  ): Promise<ExportRecord> => {
    const { data } = await axiosClient.post<ExportRecord>(
      `/api/v1/projects/${projectId}/exports`,
      payload
    );
    return data;
  },

  /** List all exports for a project */
  listExports: async (
    projectId: string
  ): Promise<{ exports: ExportRecord[] }> => {
    const { data } = await axiosClient.get(
      `/api/v1/projects/${projectId}/exports`
    );
    return data;
  },

  /** Download export data as JSON */
  downloadExport: async (
    projectId: string,
    exportId: string
  ): Promise<ExportDownloadData> => {
    const { data } = await axiosClient.get<ExportDownloadData>(
      `/api/v1/projects/${projectId}/exports/${exportId}/download`
    );
    return data;
  },

  /** Delete an export record */
  deleteExport: async (projectId: string, exportId: string): Promise<void> => {
    await axiosClient.delete(
      `/api/v1/projects/${projectId}/exports/${exportId}`
    );
  },
};
