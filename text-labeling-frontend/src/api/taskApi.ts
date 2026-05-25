// src/api/taskApi.ts

import axiosClient from './axiosClient';
import type {
  AssignResultResponse,
  AssignTasksPayload,
  UpdateAssignmentPayload,
  UpdateAssignmentResponse,
  DatasetListResponse,
  ImportDatasetPayload,
  ImportResultResponse,
  MemberListResponse,
  SampleListResponse,
  Task,
  TaskDetail,
  TaskListResponse,
} from '../types';

export const taskApi = {
  // ─── Datasets ───────────────────────────────────────────

  /** Import a dataset with inline samples */
  importDataset: async (
    projectId: string,
    payload: ImportDatasetPayload
  ): Promise<ImportResultResponse> => {
    const { data } = await axiosClient.post<ImportResultResponse>(
      `/api/v1/projects/${projectId}/datasets/import`,
      payload
    );
    return data;
  },

  /** List all datasets in a project */
  getDatasets: async (projectId: string): Promise<DatasetListResponse> => {
    const { data } = await axiosClient.get<DatasetListResponse>(
      `/api/v1/projects/${projectId}/datasets`
    );
    return data;
  },

  /** List samples in a dataset (paginated) */
  getSamples: async (
    projectId: string,
    datasetId: string,
    page = 1,
    pageSize = 20
  ): Promise<SampleListResponse> => {
    const { data } = await axiosClient.get<SampleListResponse>(
      `/api/v1/projects/${projectId}/datasets/${datasetId}/samples`,
      { params: { page, page_size: pageSize } }
    );
    return data;
  },

  /** Delete a dataset */
  deleteDataset: async (
    projectId: string,
    datasetId: string
  ): Promise<void> => {
    await axiosClient.delete(
      `/api/v1/projects/${projectId}/datasets/${datasetId}`
    );
  },

  // ─── Tasks ──────────────────────────────────────────────

  /** List tasks in a project */
  getTasks: async (
    projectId: string,
    params?: {
      status?: string;
      assignee_id?: string;
      dataset_id?: string;
      page?: number;
      page_size?: number;
    }
  ): Promise<TaskListResponse> => {
    const { data } = await axiosClient.get<TaskListResponse>(
      `/api/v1/projects/${projectId}/tasks`,
      { params }
    );
    return data;
  },

  /** Get task detail with samples */
  getTask: async (
    projectId: string,
    taskId: string
  ): Promise<TaskDetail> => {
    const { data } = await axiosClient.get<TaskDetail>(
      `/api/v1/projects/${projectId}/tasks/${taskId}`
    );
    return data;
  },

  /** Assign tasks (manual or round-robin) */
  assignTasks: async (
    projectId: string,
    payload: AssignTasksPayload
  ): Promise<AssignResultResponse> => {
    const { data } = await axiosClient.post<AssignResultResponse>(
      `/api/v1/projects/${projectId}/tasks/assign`,
      payload
    );
    return data;
  },

  /** Update an assignment group */
  updateAssignment: async (
    projectId: string,
    payload: UpdateAssignmentPayload
  ): Promise<UpdateAssignmentResponse> => {
    const { data } = await axiosClient.put<UpdateAssignmentResponse>(
      `/api/v1/projects/${projectId}/tasks/assignments`,
      payload
    );
    return data;
  },

  /** Update an assignment group using one task as the anchor */
  updateAssignmentByTask: async (
    projectId: string,
    taskId: string,
    payload: UpdateAssignmentPayload
  ): Promise<UpdateAssignmentResponse> => {
    const { data } = await axiosClient.put<UpdateAssignmentResponse>(
      `/api/v1/projects/${projectId}/tasks/${taskId}/assignment`,
      payload
    );
    return data;
  },

  /** Reassign a task to a different annotator */
  reassignTask: async (
    projectId: string,
    taskId: string,
    newAssigneeId: string
  ): Promise<Task> => {
    const { data } = await axiosClient.put<Task>(
      `/api/v1/projects/${projectId}/tasks/${taskId}/reassign`,
      { new_assignee_id: newAssigneeId }
    );
    return data;
  },

  /** Update reviewer of a task (null = any reviewer) */
  updateTaskReviewer: async (
    projectId: string,
    taskId: string,
    newReviewerId: string | null
  ): Promise<Task> => {
    const { data } = await axiosClient.put<Task>(
      `/api/v1/projects/${projectId}/tasks/${taskId}/update-reviewer`,
      { new_reviewer_id: newReviewerId || null }
    );
    return data;
  },

  /** Delete a task assignment */
  deleteTask: async (
    projectId: string,
    taskId: string
  ): Promise<void> => {
    await axiosClient.delete(
      `/api/v1/projects/${projectId}/tasks/${taskId}`
    );
  },

  // ─── Project Members ────────────────────────────────────

  /** List project members */
  getMembers: async (projectId: string): Promise<MemberListResponse> => {
    const { data } = await axiosClient.get<MemberListResponse>(
      `/api/v1/projects/${projectId}/members`
    );
    return data;
  },

  /** Add member to project */
  addMember: async (
    projectId: string,
    userId: string,
    roleInProject: string
  ) => {
    const { data } = await axiosClient.post(
      `/api/v1/projects/${projectId}/members`,
      { user_id: userId, role_in_project: roleInProject }
    );
    return data;
  },

  /** Update a member's role in a project */
  updateMember: async (
    projectId: string,
    userId: string,
    roleInProject: string
  ) => {
    const { data } = await axiosClient.put(
      `/api/v1/projects/${projectId}/members/${userId}`,
      { role_in_project: roleInProject }
    );
    return data;
  },

  /** Remove a member from a project */
  removeMember: async (projectId: string, userId: string): Promise<void> => {
    await axiosClient.delete(
      `/api/v1/projects/${projectId}/members/${userId}`
    );
  },
};
