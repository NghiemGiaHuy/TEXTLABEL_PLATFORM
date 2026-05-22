// src/api/annotationApi.ts

import axiosClient from './axiosClient';
import type {
  AdjacentSamplesResponse,
  Annotation,
  AnnotationSampleResponse,
  CreateAnnotationPayload,
  TaskDetail,
} from '../types';

export const annotationApi = {
  // ─── Task lifecycle ─────────────────────────────────────

  /** Get task detail with samples list */
  getTask: async (
    projectId: string,
    taskId: string
  ): Promise<TaskDetail> => {
    const { data } = await axiosClient.get<TaskDetail>(
      `/api/v1/projects/${projectId}/tasks/${taskId}`
    );
    return data;
  },

  /** Start a task (todo → in_progress) */
  startTask: async (taskId: string): Promise<void> => {
    await axiosClient.post(`/api/v1/annotations/tasks/${taskId}/start`);
  },

  /** Submit a task for review */
  submitTask: async (taskId: string): Promise<void> => {
    await axiosClient.post(`/api/v1/annotations/tasks/${taskId}/submit`);
  },

  /** Get rejection feedback per sample (for annotator rework view) */
  getRejectionFeedback: async (
    taskId: string
  ): Promise<{ feedback: Record<string, { feedback: string; reviewer_name: string | null; reviewed_at: string }> }> => {
    const { data } = await axiosClient.get(
      `/api/v1/annotations/tasks/${taskId}/rejection-feedback`
    );
    return data;
  },

  // ─── Sample data ────────────────────────────────────────

  /** Get full sample data for annotation UI */
  getSample: async (
    taskId: string,
    taskSampleId: string
  ): Promise<AnnotationSampleResponse> => {
    const { data } = await axiosClient.get<AnnotationSampleResponse>(
      `/api/v1/annotations/tasks/${taskId}/samples/${taskSampleId}`
    );
    return data;
  },

  /** Get NER entities that can be used as relation endpoints */
  getSampleEntities: async (
    taskId: string,
    taskSampleId: string
  ): Promise<Annotation[]> => {
    const { data } = await axiosClient.get<Annotation[]>(
      `/api/v1/annotations/tasks/${taskId}/samples/${taskSampleId}/entities`
    );
    return data;
  },

  /** Get previous/next sample IDs */
  getAdjacent: async (
    taskId: string,
    taskSampleId: string
  ): Promise<AdjacentSamplesResponse> => {
    const { data } = await axiosClient.get<AdjacentSamplesResponse>(
      `/api/v1/annotations/tasks/${taskId}/samples/${taskSampleId}/adjacent`
    );
    return data;
  },

  // ─── Annotations CRUD ──────────────────────────────────

  /** Create a new annotation on a text span */
  createAnnotation: async (
    taskId: string,
    taskSampleId: string,
    payload: CreateAnnotationPayload
  ): Promise<Annotation> => {
    const { data } = await axiosClient.post<Annotation>(
      `/api/v1/annotations/tasks/${taskId}/samples/${taskSampleId}/annotations`,
      payload
    );
    return data;
  },

  /** Delete an annotation */
  deleteAnnotation: async (
    taskId: string,
    taskSampleId: string,
    annotationId: string
  ): Promise<void> => {
    await axiosClient.delete(
      `/api/v1/annotations/tasks/${taskId}/samples/${taskSampleId}/annotations/${annotationId}`
    );
  },

  /** Bulk replace all annotations for a sample */
  bulkUpdateAnnotations: async (
    taskId: string,
    taskSampleId: string,
    annotations: CreateAnnotationPayload[]
  ): Promise<Annotation[]> => {
    const { data } = await axiosClient.put<Annotation[]>(
      `/api/v1/annotations/tasks/${taskId}/samples/${taskSampleId}/annotations/bulk`,
      { annotations }
    );
    return data;
  },

  /** Toggle sample status between 'annotated' and 'done' */
  markSampleStatus: async (
    taskId: string,
    taskSampleId: string,
    status: 'annotated' | 'done'
  ): Promise<{ task_sample_id: string; status: string }> => {
    const { data } = await axiosClient.patch(
      `/api/v1/annotations/tasks/${taskId}/samples/${taskSampleId}/status`,
      { status }
    );
    return data;
  },

  // ─── Draft ──────────────────────────────────────────────

  /** Save / update annotation draft */
  saveDraft: async (
    taskId: string,
    taskSampleId: string,
    draftData: Record<string, unknown>
  ) => {
    const { data } = await axiosClient.put(
      `/api/v1/annotations/tasks/${taskId}/samples/${taskSampleId}/draft`,
      { draft_data: draftData }
    );
    return data;
  },
};
