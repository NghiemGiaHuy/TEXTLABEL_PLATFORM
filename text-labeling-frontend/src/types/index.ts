// src/types/index.ts

// ─── Project ────────────────────────────────────────────────

export interface ProjectCreator {
  id: string;
  full_name: string;
  email: string;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  description: string | null;
  objective: string | null;
  priority: 'immediate' | 'high' | 'normal';
  status: 'not_started' | 'active' | 'completed';
  created_by: string;
  creator: ProjectCreator | null;
  deadline: string | null;
  member_count: number;
  total_samples: number;
  assigned_samples: number;
  annotated_samples: number;
  pending_review_samples: number;
  approved_samples: number;
  exported_samples: number;
  annotation_progress: number;
  review_progress: number;
  export_progress: number;
  completion_progress: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectListResponse {
  projects: Project[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface CreateProjectPayload {
  code?: string;
  name: string;
  description?: string;
  objective?: string;
  priority?: string;
  deadline?: string;
}

// ─── Project Member ─────────────────────────────────────────

export interface ProjectMember {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  role_in_project: string;
  joined_at: string;
}

export interface MemberListResponse {
  members: ProjectMember[];
}

// ─── User (Admin) ───────────────────────────────────────────

export interface Role {
  id: string;
  name: string;
  description: string | null;
}

export interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  status: string;
  roles: Role[];
  project_count: number;
  projects: Array<{
    id: string;
    code: string;
    name: string;
    role_in_project: string;
  }>;
  task_done_count: number;
  last_login_at: string | null;
  failed_login_count: number;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRoleCounts {
  admin: number;
  project_owner: number;
  annotator: number;
  reviewer: number;
}

export interface UserListResponse {
  users: AdminUser[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  role_counts: UserRoleCounts;
}

export interface CreateUserPayload {
  email: string;
  full_name: string;
  password: string;
  role_ids: string[];
}

export interface RoleListResponse {
  roles: Role[];
}

// ─── Dataset ────────────────────────────────────────────────

export interface Dataset {
  id: string;
  project_id: string;
  name: string;
  source_format: string;
  file_url: string | null;
  total_samples: number;
  assigned_samples: number;
  completed_samples: number;
  submitted_samples: number;
  approved_samples: number;
  rejected_samples: number;
  progress_percent: number;
  status: 'importing' | 'ready' | 'error';
  field_mapping: Record<string, unknown> | null;
  imported_by: string;
  created_at: string;
}

export interface DatasetListResponse {
  datasets: Dataset[];
}

export interface ImportDatasetPayload {
  name: string;
  source_format: string;
  samples: Array<{ content: string; metadata?: Record<string, unknown> }>;
  field_mapping?: Record<string, unknown>;
}

export interface ImportResultResponse {
  dataset: Dataset;
  total_imported: number;
  errors_count: number;
  errors: string[];
}

export interface DataSample {
  id: string;
  dataset_id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  sample_index: number;
  created_at: string;
}

export interface SampleListResponse {
  samples: DataSample[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// ─── Task ───────────────────────────────────────────────────

export interface TaskSample {
  id: string;
  data_sample_id: string;
  status: string;
  sample_order: number;
  content: string | null;
}

export type AnnotationType =
  | 'text_classification'
  | 'ner'
  | 'relation_extraction'
  | 'sequence_labeling';

export interface Task {
  id: string;
  project_id: string;
  dataset_id: string;
  assignee_id: string;
  assignee_name: string | null;
  assigned_by: string;
  status: string;
  assignment_status?: string | null;
  task_status?: string | null;
  assignment_method: 'manual' | 'round_robin' | string;
  annotation_type: AnnotationType | null;
  task_type?: AnnotationType | null;
  label_set_id: string | null;
  reviewer_id: string | null;
  reviewer_name: string | null;
  dataset_name: string | null;
  work_status?: string | null;
  sample_status_counts?: Record<string, number>;
  assigned_at: string;
  started_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  updated_at: string;
  sample_count: number;
}

export interface TaskDetail extends Task {
  task_samples: TaskSample[];
  progress: {
    total: number;
    completed: number;
    remaining: number;
  } | null;
}

export interface TaskListResponse {
  tasks: Task[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface AssignTasksPayload {
  dataset_id: string;
  method: 'manual' | 'round_robin';
  annotation_type?: AnnotationType;
  label_set_id?: string;
  reviewer_ids?: string[];
  annotator_ids?: string[];
  assignments?: Array<{ annotator_id: string; sample_count: number }>;
}

export interface UpdateAssignmentPayload {
  task_ids?: string[];
  status?: string;
  dataset_id?: string;
  method?: 'manual' | 'round_robin';
  annotation_type?: AnnotationType | null;
  label_set_id?: string | null;
  reviewer_ids?: string[];
  annotator_ids?: string[];
  assignments?: Array<{ annotator_id: string; sample_count?: number }>;
}

export interface AssignResultResponse {
  tasks_created: number;
  assignments: Task[];
}

export interface UpdateAssignmentResponse {
  tasks_updated: number;
  assignments: Task[];
}

// ─── Annotation ─────────────────────────────────────────────

export interface Annotation {
  id: string;
  task_sample_id: string;
  label_id: string;
  label_name: string | null;
  label_color: string | null;
  label_group_id?: string | null;
  label_group_name?: string | null;
  start_offset: number;
  end_offset: number;
  selected_text: string;
  created_by: string;
  is_ai_generated: boolean;
  is_ai_assisted: boolean;
  ai_model_name: string | null;
  ai_confidence: number | null;
  created_at: string;
  updated_at: string;
}

export interface LabelOption {
  id: string;
  name: string;
  color: string;
  shortcut_key: string | null;
  is_required: boolean;
  label_group_id?: string | null;
  label_group_name?: string | null;
}

export interface AnnotationDraft {
  id: string;
  task_sample_id: string;
  draft_data: Record<string, unknown>;
  auto_saved_at: string;
}

export interface AnnotationSampleResponse {
  task_sample_id: string;
  data_sample_id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  status: string;
  annotations: Annotation[];
  draft: AnnotationDraft | null;
  labels: LabelOption[];
}

export interface AdjacentSamplesResponse {
  prev_sample_id: string | null;
  next_sample_id: string | null;
  current_index: number;
  total_samples: number;
}

export interface CreateAnnotationPayload {
  label_id: string;
  start_offset: number;
  end_offset: number;
  selected_text: string;
  is_ai_assisted?: boolean;
  ai_model_name?: string;
  ai_confidence?: number | null;
}

export type AISuggestTaskType =
  | 'text_classification'
  | 'ner'
  | 'relation_extraction';

export interface AISuggestEntityPayload {
  id?: string;
  text: string;
  label?: string;
  start?: number;
  end?: number;
}

export interface AISuggestPayload {
  task_type: AISuggestTaskType;
  text: string;
  labels: string[];
  entities?: AISuggestEntityPayload[];
}

export interface AIClassificationSuggestion {
  label: string;
  confidence: number;
}

export interface AINERSuggestion {
  text: string;
  label: string;
  start: number;
  end: number;
  confidence: number;
}

export interface AIRelationSuggestion {
  head: string;
  tail: string;
  relation: string;
  confidence: number;
  head_id?: string | null;
  tail_id?: string | null;
}

export interface AISuggestResponse {
  task_type: AISuggestTaskType;
  model_name: string;
  suggestions: Array<
    AIClassificationSuggestion | AINERSuggestion | AIRelationSuggestion
  >;
}

export type EditableAIWorkspaceSuggestion =
  | (AIClassificationSuggestion & {
      id: string;
      task_type: 'text_classification';
      accepted: boolean;
      model_name: string;
    })
  | (AINERSuggestion & {
      id: string;
      task_type: 'ner';
      accepted: boolean;
      model_name: string;
    });

export interface EditableAIRelationSuggestion extends AIRelationSuggestion {
  id: string;
  head_id: string;
  tail_id: string;
  accepted: boolean;
  model_name: string;
}

// ─── Label Management ────────────────────────────────────────

export interface LabelItem {
  id: string;
  label_set_id: string;
  label_group_id: string | null;
  name: string;
  color: string;
  shortcut_key: string | null;
  sort_order: number;
  is_required: boolean;
  created_at: string;
}

export interface LabelGroup {
  id: string;
  label_set_id: string;
  name: string;
  sort_order: number;
}

export interface LabelSet {
  id: string;
  project_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  groups: LabelGroup[];
  labels: LabelItem[];
}

export interface LabelSetListResponse {
  label_sets: LabelSet[];
}

export interface CreateLabelSetPayload {
  name: string;
}

export interface CreateLabelPayload {
  name: string;
  color: string;
  shortcut_key?: string;
  sort_order?: number;
  is_required?: boolean;
  label_group_id?: string | null;
}
