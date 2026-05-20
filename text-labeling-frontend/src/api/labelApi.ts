// src/api/labelApi.ts

import axiosClient from './axiosClient';
import type {
  LabelSet,
  LabelSetListResponse,
  CreateLabelPayload,
  LabelItem,
} from '../types';

export type { LabelSet as LabelSetData };

type UpdateLabelPayload = Partial<CreateLabelPayload & { label_group_id: string | null }>;

export const labelApi = {
  getLabelSets: async (projectId: string): Promise<LabelSetListResponse> => {
    const { data } = await axiosClient.get<LabelSetListResponse>(
      `/api/v1/projects/${projectId}/label-sets`
    );
    return data;
  },

  listLabelSets: async (projectId: string): Promise<LabelSetListResponse> => {
    const { data } = await axiosClient.get<LabelSetListResponse>(
      `/api/v1/projects/${projectId}/label-sets`
    );
    return data;
  },

  createLabelSet: async (
    projectId: string,
    nameOrPayload: string | { name: string }
  ): Promise<LabelSet> => {
    const payload = typeof nameOrPayload === 'string'
      ? { name: nameOrPayload }
      : nameOrPayload;
    const { data } = await axiosClient.post<LabelSet>(
      `/api/v1/projects/${projectId}/label-sets`,
      payload
    );
    return data;
  },

  deleteLabelSet: async (projectId: string, labelSetId: string): Promise<void> => {
    await axiosClient.delete(
      `/api/v1/projects/${projectId}/label-sets/${labelSetId}`
    );
  },

  updateLabelSet: async (
    projectId: string,
    labelSetId: string,
    payload: { name?: string }
  ): Promise<LabelSet> => {
    const { data } = await axiosClient.put<LabelSet>(
      `/api/v1/projects/${projectId}/label-sets/${labelSetId}`,
      payload
    );
    return data;
  },

  createLabel: async (
    projectId: string,
    labelSetId: string,
    payload: CreateLabelPayload
  ): Promise<LabelItem> => {
    const { data } = await axiosClient.post<LabelItem>(
      `/api/v1/projects/${projectId}/label-sets/${labelSetId}/labels`,
      payload
    );
    return data;
  },

  deleteLabel: async (
    projectId: string,
    labelSetId: string,
    labelId: string
  ): Promise<void> => {
    await axiosClient.delete(
      `/api/v1/projects/${projectId}/label-sets/${labelSetId}/labels/${labelId}`
    );
  },

  updateLabel: async (
    projectId: string,
    labelSetId: string,
    labelId: string,
    payload: UpdateLabelPayload
  ): Promise<LabelItem> => {
    const { data } = await axiosClient.put<LabelItem>(
      `/api/v1/projects/${projectId}/label-sets/${labelSetId}/labels/${labelId}`,
      payload
    );
    return data;
  },
};
