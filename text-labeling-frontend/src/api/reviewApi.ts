// src/api/reviewApi.ts

import axiosClient from './axiosClient';

export interface ReviewAnnotation {
  id: string;
  label_id: string;
  label_name?: string;
  label_color?: string;
  label_group_id?: string | null;
  label_group_name?: string | null;
  start_offset: number;
  end_offset: number;
  selected_text: string;
  is_ai_generated?: boolean;
}

export interface ReviewRecord {
  id: string;
  task_sample_id: string;
  reviewer_id: string;
  reviewer_name?: string;
  result: 'approved' | 'rejected';
  feedback?: string;
  reviewed_at: string;
}

export interface ReviewSubmitResult {
  status: 'approved' | 'rework';
  message: string;
  rejected_count: number;
  approved_count: number;
}

export interface ReviewAnnotationDraft {
  id: string;
  task_sample_id: string;
  draft_data: Record<string, unknown>;
  auto_saved_at: string;
}

export interface ReviewSampleDetail {
  task_sample_id: string;
  task_id: string;
  content: string;
  metadata?: Record<string, unknown>;
  annotations: ReviewAnnotation[];
  related_entities?: ReviewAnnotation[];
  draft?: ReviewAnnotationDraft | null;
  annotator_name?: string;
  review_history: ReviewRecord[];
}

export const reviewApi = {
  getReviewSample: async (
    taskId: string,
    sampleId: string
  ): Promise<ReviewSampleDetail> => {
    const { data } = await axiosClient.get<ReviewSampleDetail>(
      `/api/v1/reviews/tasks/${taskId}/samples/${sampleId}`
    );
    return data;
  },

  approveSample: async (
    taskId: string,
    sampleId: string,
    feedback?: string
  ): Promise<ReviewRecord> => {
    const { data } = await axiosClient.post<ReviewRecord>(
      `/api/v1/reviews/tasks/${taskId}/samples/${sampleId}/approve`,
      { feedback: feedback || null }
    );
    return data;
  },

  rejectSample: async (
    taskId: string,
    sampleId: string,
    feedback: string
  ): Promise<ReviewRecord> => {
    const { data } = await axiosClient.post<ReviewRecord>(
      `/api/v1/reviews/tasks/${taskId}/samples/${sampleId}/reject`,
      { feedback }
    );
    return data;
  },

  submitReviewTask: async (taskId: string): Promise<ReviewSubmitResult> => {
    const { data } = await axiosClient.post<ReviewSubmitResult>(
      `/api/v1/reviews/tasks/${taskId}/submit`
    );
    return data;
  },
};
