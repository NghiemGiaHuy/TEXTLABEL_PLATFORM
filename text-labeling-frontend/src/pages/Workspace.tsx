// src/pages/Workspace.tsx

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useParams, Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  BadgeCheck,
  Trash2,
  Send,
  CheckCircle2,
  XCircle,
  MousePointer,
  Tag,
  Hash,
  FileText,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { annotationApi } from '../api/annotationApi';
import { buildApiUrl } from '../api/apiConfig';
import { useAuthStore } from '../store/authStore';
import { useToast } from '../components/toastContext';
import { useConfirm } from '../components/ConfirmDialog';
import AISuggestionsPanel from '../components/AISuggestionsPanel';
import type {
  Annotation,
  AnnotationSampleResponse,
  EditableAIWorkspaceSuggestion,
  LabelOption,
  TaskDetail,
} from '../types';

type RejectionFeedbackMap = Record<string, {
  feedback: string;
  reviewer_name: string | null;
  reviewed_at: string;
}>;

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

interface TextSelection {
  startOffset: number;
  endOffset: number;
  selectedText: string;
}

// ─── Shared status config ──────────────────────────────────────
const SAMPLE_STATUS: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  pending:     { label: 'Chưa làm',  bg: 'bg-surface-100', text: 'text-surface-500', dot: 'bg-surface-400' },
  todo:        { label: 'Chưa làm',  bg: 'bg-surface-100', text: 'text-surface-500', dot: 'bg-surface-400' },
  annotated:   { label: 'Đang làm',  bg: 'bg-blue-50',     text: 'text-blue-700',    dot: 'bg-blue-500'    },
  in_progress: { label: 'Đang làm',  bg: 'bg-blue-50',     text: 'text-blue-700',    dot: 'bg-blue-500'    },
  done:        { label: 'Đã xong',   bg: 'bg-emerald-50',  text: 'text-emerald-700', dot: 'bg-emerald-500' },
  submitted:   { label: 'Đã xong',   bg: 'bg-emerald-50',  text: 'text-emerald-700', dot: 'bg-emerald-500' },
  approved:    { label: 'Đã duyệt',  bg: 'bg-emerald-50',  text: 'text-emerald-700', dot: 'bg-emerald-500' },
  rejected:    { label: 'Từ chối',   bg: 'bg-red-50',      text: 'text-red-700',     dot: 'bg-red-500'     },
  rework:      { label: 'Từ chối',   bg: 'bg-red-50',      text: 'text-red-700',     dot: 'bg-red-500'     },
};

type SampleStatusFilter = 'all' | 'pending' | 'annotated' | 'done' | 'rejected' | 'approved';

const SAMPLE_STATUS_FILTERS: Array<{ value: SampleStatusFilter; label: string }> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'pending', label: 'Chưa làm' },
  { value: 'annotated', label: 'Đang làm' },
  { value: 'done', label: 'Đã xong' },
  { value: 'rejected', label: 'Bị từ chối' },
  { value: 'approved', label: 'Đã duyệt' },
];

function getSampleStatusFilter(status: string): SampleStatusFilter {
  if (status === 'approved') return 'approved';
  if (status === 'rejected' || status === 'rework') return 'rejected';
  if (status === 'done' || status === 'submitted') return 'done';
  if (status === 'annotated' || status === 'in_progress') return 'annotated';
  return 'pending';
}

function sampleDotColor(status: string) {
  if (status === 'approved') return '#10b981';
  if (status === 'done' || status === 'submitted') return '#10b981';
  if (status === 'annotated' || status === 'in_progress') return '#3b82f6';
  if (status === 'rejected' || status === 'rework') return '#ef4444';
  return '#cbd5e1';
}

function isSampleProcessed(status: string) {
  return !['pending', 'todo'].includes(status);
}

// ─── Left sample list (shared) ────────────────────────────────
function SampleListPanel({
  samples,
  currentIndex,
  onNavigate,
}: {
  samples: { id: string; status: string; content: string | null }[];
  currentIndex: number;
  onNavigate: (i: number) => void;
}) {
  const [sampleNumberQuery, setSampleNumberQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<SampleStatusFilter>('all');

  const filteredSamples = useMemo(() => {
    const sampleNumber = Number(sampleNumberQuery.trim());
    const hasSampleNumber = sampleNumberQuery.trim() !== '';

    return samples
      .map((sample, index) => ({ sample, index }))
      .filter(({ sample, index }) => {
        const numberMatches = !hasSampleNumber
          || (Number.isInteger(sampleNumber) && sampleNumber === index + 1);
        const statusMatches = statusFilter === 'all'
          || getSampleStatusFilter(sample.status) === statusFilter;
        return numberMatches && statusMatches;
      });
  }, [samples, sampleNumberQuery, statusFilter]);

  return (
    <div className="w-full xl:w-60 xl:shrink-0 bg-white border-b xl:border-b-0 xl:border-r border-surface-200 flex flex-col max-h-64 xl:max-h-none">
      <div className="px-3 py-2.5 border-b border-surface-100 bg-surface-50/60 flex items-center justify-between">
        <span className="text-xs font-semibold text-surface-500 uppercase tracking-wide">Samples</span>
        <span className="text-[10px] font-medium text-surface-400 bg-surface-100 px-2 py-0.5 rounded-full">
          {filteredSamples.length === samples.length ? samples.length : `${filteredSamples.length}/${samples.length}`}
        </span>
      </div>
      <div className="px-3 py-2.5 border-b border-surface-100 bg-white flex items-center gap-2">
        <input
          value={sampleNumberQuery}
          onChange={(event) => setSampleNumberQuery(event.target.value.replace(/\D/g, ''))}
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="Số"
          aria-label="Tìm theo thứ tự sample"
          className="w-16 min-w-0 rounded-lg border border-surface-200 bg-white px-2.5 py-1.5 text-xs font-medium text-surface-700 placeholder:text-surface-400 outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        />
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as SampleStatusFilter)}
          aria-label="Lọc theo trạng thái sample"
          className="min-w-0 flex-1 rounded-lg border border-surface-200 bg-white px-2.5 py-1.5 text-xs font-medium text-surface-700 outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        >
          {SAMPLE_STATUS_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filteredSamples.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-surface-400">
            Không có sample phù hợp
          </div>
        ) : filteredSamples.map(({ sample: s, index: i }) => {
          const isActive = i === currentIndex;
          const cfg = SAMPLE_STATUS[s.status] ?? SAMPLE_STATUS.pending;
          return (
            <button
              key={s.id}
              onClick={() => onNavigate(i)}
              className={`w-full text-left px-3 py-2.5 border-b border-surface-100 transition-colors ${
                isActive ? 'bg-brand-50 border-l-2 border-l-brand-500' : 'hover:bg-surface-50'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Hash className="w-3 h-3 text-surface-400 shrink-0" />
                  <span className={`text-xs font-semibold ${isActive ? 'text-brand-700' : 'text-surface-600'}`}>
                    Sample {i + 1}
                  </span>
                </div>
                <span className={`inline-flex items-center gap-1 px-1.5 py-px rounded-full text-[10px] font-medium shrink-0 ${cfg.bg} ${cfg.text}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                  {cfg.label}
                </span>
              </div>
              <p className="text-[11px] text-surface-400 truncate">
                {(s.content ?? '').slice(0, 50)}{(s.content ?? '').length > 50 ? '…' : ''}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Bottom actions bar (shared) ──────────────────────────────
function BottomBar({
  currentIndex,
  total,
  canClear,
  saving,
  isReadOnly,
  isDone,
  canMarkDone,
  doneLoading,
  onBack,
  onClear,
  onToggleDone,
  onNext,
}: {
  currentIndex: number;
  total: number;
  canClear: boolean;
  saving: boolean;
  isReadOnly: boolean;
  isDone: boolean;
  canMarkDone: boolean;
  doneLoading: boolean;
  onBack: () => void;
  onClear: () => void;
  onToggleDone: () => void;
  onNext: () => void;
}) {
  return (
    <div className="shrink-0 bg-white border-t border-surface-200 px-3 sm:px-6 py-3 flex flex-nowrap items-center gap-2 sm:gap-3 overflow-x-auto">
      <button
        onClick={onBack}
        disabled={currentIndex === 0}
        className="flex shrink-0 items-center justify-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg border border-surface-200 text-sm font-medium text-surface-600 hover:bg-surface-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Quay lại
      </button>

      <button
        onClick={onClear}
        disabled={!canClear || saving || isReadOnly}
        className="flex shrink-0 items-center justify-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg border border-surface-200 text-sm font-medium text-surface-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <Trash2 className="w-4 h-4" />
        Xoá nhãn
      </button>

      <button
        onClick={onToggleDone}
        disabled={!canMarkDone || doneLoading || isReadOnly}
        className={`flex shrink-0 items-center justify-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
          isDone
            ? 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-400'
            : 'border-surface-200 text-surface-600 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200'
        }`}
      >
        {doneLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
        {isDone ? 'Đã xong' : 'Xong'}
      </button>

      <div className="hidden sm:block flex-1" />

      <button
        onClick={onNext}
        disabled={currentIndex >= total - 1}
        className="flex shrink-0 items-center justify-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg border border-surface-200 text-sm font-medium text-surface-600 hover:bg-surface-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        Tiếp theo
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

// ============================================================
// MAIN WORKSPACE
// ============================================================
export default function Workspace() {
  const { taskId } = useParams<{ taskId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const { sidebarOpen } = useOutletContext<{ sidebarOpen: boolean }>();
  const { user } = useAuthStore();
  const projectIdParam = searchParams.get('projectId');
  const explicitViewMode = searchParams.get('mode') === 'view';
  const isAdmin = user?.roles?.some((role) => role.toLowerCase().includes('admin')) ?? false;

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [sampleData, setSampleData] = useState<AnnotationSampleResponse | null>(null);
  const [currentSampleIndex, setCurrentSampleIndex] = useState(0);
  const [rejectionFeedback, setRejectionFeedback] = useState<RejectionFeedbackMap>({});
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);
  const [doneLoading, setDoneLoading] = useState(false);
  const [isSingleLabel, setIsSingleLabel] = useState(false);
  const [aiSuggestions, setAISuggestions] = useState<EditableAIWorkspaceSuggestion[]>([]);
  const [aiLoading, setAILoading] = useState(false);

  const fetchMyTaskInfo = useCallback(async (tid: string): Promise<TaskDetail | null> => {
    try {
      const res = await fetch(
        buildApiUrl('/api/v1/annotations/my-tasks?page_size=100'),
        { headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` } }
      );
      const data = await res.json();
      const found = data.tasks?.find((t: TaskDetail) => t.id === tid);
      if (!found) return null;
      const detail = await annotationApi.getTask(found.project_id, tid);
      return { ...detail, status: detail.task_status ?? detail.status };
    } catch { return null; }
  }, []);

  const loadSample = useCallback(async (tid: string, sampleId: string) => {
    try {
      const sample = await annotationApi.getSample(tid, sampleId);
      setSampleData(sample);
      setTask((prev) => prev ? {
        ...prev,
        task_samples: prev.task_samples.map((s) =>
          s.id === sample.task_sample_id ? { ...s, status: sample.status } : s
        ),
      } : prev);
      setSelection(null);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e.response?.data?.detail || 'Không thể tải mẫu văn bản');
    }
  }, []);

  // ── Task loading ────────────────────────────────────────────
  const loadTask = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    setError('');
    try {
      const taskDetail = projectIdParam
        ? await annotationApi.getTask(projectIdParam, taskId).then((detail) => ({ ...detail, status: detail.task_status ?? detail.status }))
        : await fetchMyTaskInfo(taskId);
      if (!taskDetail) {
        setError('Không tìm thấy nhiệm vụ hoặc bạn không có quyền xem task này');
        setLoading(false);
        return;
      }

      let loadedTask: TaskDetail = taskDetail;
      const canEditLoadedTask = !explicitViewMode && (loadedTask.assignee_id === user?.id || isAdmin);
      if (canEditLoadedTask && loadedTask.status === 'todo') {
        try {
          await annotationApi.startTask(taskId);
          loadedTask = await annotationApi.getTask(loadedTask.project_id, taskId)
            .then((detail) => ({ ...detail, status: detail.task_status ?? detail.status }));
        } catch { /* already started or not editable */ }
      }

      setTask(loadedTask);

      if (loadedTask.status === 'rework') {
        try {
          const fb = await annotationApi.getRejectionFeedback(taskId);
          setRejectionFeedback(fb.feedback);
        } catch { /* optional */ }
      }

      if (loadedTask.task_samples.length > 0) {
        let startIndex = 0;
        if (loadedTask.status === 'rework') {
          const firstRejected = loadedTask.task_samples.findIndex(
            (s) => s.status === 'rejected' || s.status === 'rework'
          );
          if (firstRejected !== -1) startIndex = firstRejected;
        }
        setCurrentSampleIndex(startIndex);
        await loadSample(taskId, loadedTask.task_samples[startIndex].id);
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e.response?.data?.detail || 'Không thể tải workspace');
    } finally {
      setLoading(false);
    }
  }, [taskId, projectIdParam, explicitViewMode, user, isAdmin, fetchMyTaskInfo, loadSample]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadTask(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadTask]);

  const navigateSample = useCallback(async (index: number, taskDetail: TaskDetail) => {
    if (!taskId) return;
    const sampleId = taskDetail.task_samples[index]?.id;
    if (!sampleId) return;
    setAISuggestions([]);
    setCurrentSampleIndex(index);
    await loadSample(taskId, sampleId);
  }, [taskId, loadSample]);

  const samples = task?.task_samples || [];
  const currentSample = samples[currentSampleIndex];
  const currentSampleStatus = currentSample?.status || 'pending';
  const canEditTask = Boolean(
    task &&
    user?.id &&
    !explicitViewMode &&
    (task.assignee_id === user.id || isAdmin)
  );
  const isSubmitted = task?.status === 'submitted' || task?.status === 'approved';
  const isReadOnly =
    !canEditTask ||
    isSubmitted ||
    (task?.status === 'rework' && currentSampleStatus === 'approved');

  // ── Ephemeral AI suggestions ────────────────────────────────
  const handleRequestAISuggestions = useCallback(async () => {
    if (isReadOnly || !sampleData || !task) return;
    const taskType = task.annotation_type === 'text_classification'
      ? 'text_classification'
      : 'ner';
    setAILoading(true);
    try {
      const response = await annotationApi.suggestByAI({
        task_type: taskType,
        text: sampleData.content,
        labels: sampleData.labels.map((label) => label.name),
      });
      const now = Date.now();
      const suggestions: EditableAIWorkspaceSuggestion[] = taskType === 'text_classification'
        ? response.suggestions.flatMap((suggestion, index) =>
            'label' in suggestion && !('start' in suggestion)
              ? [{
                  ...suggestion,
                  id: `ai-classification-${now}-${index}`,
                  task_type: 'text_classification' as const,
                  accepted: false,
                  model_name: response.model_name,
                }]
              : []
          )
        : response.suggestions.flatMap((suggestion, index) =>
            'label' in suggestion && 'start' in suggestion && 'end' in suggestion
              ? [{
                  ...suggestion,
                  id: `ai-ner-${now}-${index}`,
                  task_type: 'ner' as const,
                  accepted: false,
                  model_name: response.model_name,
                }]
              : []
          );
      setAISuggestions(suggestions);
      if (suggestions.length === 0) {
        showToast('info', 'Gemini không tìm thấy gợi ý phù hợp');
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast('error', e.response?.data?.detail || 'Không thể lấy gợi ý AI');
    } finally {
      setAILoading(false);
    }
  }, [isReadOnly, sampleData, task, showToast]);

  const handleChangeAISuggestion = useCallback((
    id: string,
    patch: Partial<EditableAIWorkspaceSuggestion>
  ) => {
    setAISuggestions((previous) => previous.map((suggestion) =>
      suggestion.id === id
        ? { ...suggestion, ...patch } as EditableAIWorkspaceSuggestion
        : suggestion
    ));
  }, []);

  const handleToggleAcceptAISuggestion = useCallback((id: string) => {
    setAISuggestions((previous) => previous.map((suggestion) =>
      suggestion.id === id
        ? { ...suggestion, accepted: !suggestion.accepted }
        : suggestion
    ));
  }, []);

  const handleRejectAISuggestion = useCallback((id: string) => {
    setAISuggestions((previous) => previous.filter((suggestion) => suggestion.id !== id));
  }, []);

  const handleSaveAISuggestions = useCallback(async () => {
    if (isReadOnly || !sampleData || !taskId || !task) return;
    const sampleId = task.task_samples[currentSampleIndex]?.id;
    if (!sampleId) return;
    let accepted = aiSuggestions.filter((suggestion) => suggestion.accepted);
    if (isSingleLabel && task.annotation_type === 'text_classification') {
      accepted = accepted.slice(0, 1);
    }
    if (accepted.length === 0) return;

    setSaving(true);
    try {
      if (isSingleLabel && task.annotation_type === 'text_classification') {
        for (const annotation of sampleData.annotations) {
          await annotationApi.deleteAnnotation(taskId, sampleId, annotation.id);
        }
      }

      const existingKeys = new Set(
        isSingleLabel && task.annotation_type === 'text_classification'
          ? []
          : sampleData.annotations.map((annotation) =>
              `${annotation.label_id}:${annotation.start_offset}:${annotation.end_offset}`
            )
      );
      for (const suggestion of accepted) {
        const label = sampleData.labels.find((option) => option.name === suggestion.label);
        if (!label) throw new Error(`Unknown label: ${suggestion.label}`);
        const start = suggestion.task_type === 'ner' ? suggestion.start : 0;
        const end = suggestion.task_type === 'ner' ? suggestion.end : sampleData.content.length;
        const selectedText = suggestion.task_type === 'ner'
          ? sampleData.content.slice(start, end)
          : sampleData.content.slice(0, 5000);
        if (start < 0 || end <= start || end > sampleData.content.length || !selectedText) {
          throw new Error('AI suggestion offsets are invalid');
        }
        const key = `${label.id}:${start}:${end}`;
        if (existingKeys.has(key)) continue;
        await annotationApi.createAnnotation(taskId, sampleId, {
          label_id: label.id,
          start_offset: start,
          end_offset: end,
          selected_text: selectedText,
          is_ai_assisted: true,
          ai_model_name: suggestion.model_name,
          ai_confidence: suggestion.confidence,
        });
        existingKeys.add(key);
      }
      setAISuggestions((previous) => previous.filter((suggestion) => !suggestion.accepted));
      await loadSample(taskId, sampleId);
      showToast('success', 'Đã lưu gợi ý AI được chấp nhận');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } }; message?: string };
      showToast('error', e.response?.data?.detail || e.message || 'Không thể lưu gợi ý AI');
    } finally {
      setSaving(false);
    }
  }, [
    isReadOnly,
    sampleData,
    taskId,
    task,
    currentSampleIndex,
    aiSuggestions,
    isSingleLabel,
    loadSample,
    showToast,
  ]);

  // ── Annotation handlers ─────────────────────────────────────
  const handleCreateAnnotation = useCallback(async (label: LabelOption) => {
    if (isReadOnly || !selection || !taskId || !task) return;
    const sampleId = task.task_samples[currentSampleIndex]?.id;
    if (!sampleId) return;
    setSaving(true);
    try {
      await annotationApi.createAnnotation(taskId, sampleId, {
        label_id: label.id,
        start_offset: selection.startOffset,
        end_offset: selection.endOffset,
        selected_text: selection.selectedText,
      });
      setSelection(null);
      await loadSample(taskId, sampleId);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast('error', e.response?.data?.detail || 'Không thể lưu annotation');
    } finally {
      setSaving(false);
    }
  }, [isReadOnly, selection, taskId, task, currentSampleIndex, loadSample, showToast]);

  const handleToggleClassificationLabel = useCallback(async (label: LabelOption) => {
    if (isReadOnly || !sampleData || !taskId || !task) return;
    if (!sampleData.content.length) { showToast('error', 'Mẫu văn bản rỗng.'); return; }
    const sampleId = task.task_samples[currentSampleIndex]?.id;
    if (!sampleId) return;
    const existing = sampleData.annotations.find((ann) => ann.label_id === label.id);
    setSaving(true);
    try {
      if (isSingleLabel) {
        for (const ann of sampleData.annotations) {
          await annotationApi.deleteAnnotation(taskId, sampleId, ann.id);
        }
        if (!existing) {
          await annotationApi.createAnnotation(taskId, sampleId, {
            label_id: label.id,
            start_offset: 0,
            end_offset: sampleData.content.length,
            selected_text: sampleData.content.slice(0, 5000),
          });
        }
      } else {
        if (existing) {
          await annotationApi.deleteAnnotation(taskId, sampleId, existing.id);
        } else {
          await annotationApi.createAnnotation(taskId, sampleId, {
            label_id: label.id,
            start_offset: 0,
            end_offset: sampleData.content.length,
            selected_text: sampleData.content.slice(0, 5000),
          });
        }
      }
      await loadSample(taskId, sampleId);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast('error', e.response?.data?.detail || 'Không thể lưu nhãn');
    } finally {
      setSaving(false);
    }
  }, [isReadOnly, sampleData, taskId, task, currentSampleIndex, isSingleLabel, loadSample, showToast]);

  const handleDeleteAnnotation = useCallback(async (annotationId: string) => {
    if (isReadOnly || !taskId || !task) return;
    const sampleId = task.task_samples[currentSampleIndex]?.id;
    if (!sampleId) return;
    try {
      await annotationApi.deleteAnnotation(taskId, sampleId, annotationId);
      await loadSample(taskId, sampleId);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast('error', e.response?.data?.detail || 'Không thể xóa annotation');
    }
  }, [isReadOnly, taskId, task, currentSampleIndex, loadSample, showToast]);

  const handleClearAnnotations = useCallback(async () => {
    if (isReadOnly || !taskId || !task || !sampleData) return;
    const sampleId = task.task_samples[currentSampleIndex]?.id;
    if (!sampleId || sampleData.annotations.length === 0) return;
    try {
      for (const ann of sampleData.annotations) {
        await annotationApi.deleteAnnotation(taskId, sampleId, ann.id);
      }
      await loadSample(taskId, sampleId);
      setSelection(null);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast('error', e.response?.data?.detail || 'Xoá nhãn thất bại');
    }
  }, [isReadOnly, taskId, task, sampleData, currentSampleIndex, loadSample, showToast]);

  const handleSubmit = useCallback(async () => {
    if (isReadOnly || !taskId) return;
    if (!await confirm(
      'Bạn có muốn nộp toàn bộ task này để kiểm duyệt? Sau khi nộp, bạn sẽ không thể chỉnh sửa thêm.',
      { title: 'Nộp toàn bộ task', variant: 'warning', confirmText: 'Nộp' }
    )) return;
    setSubmitLoading(true);
    try {
      await annotationApi.submitTask(taskId);
      showToast('success', 'Đã chuyển task cho reviewer');
      setTimeout(() => {
        if (task?.project_id) navigate(`/projects/${task.project_id}`, { replace: true });
        else navigate('/', { replace: true });
      }, 1200);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      const detail = e.response?.data?.detail || 'Nộp thất bại';
      showToast('error', typeof detail === 'string' ? detail : JSON.stringify(detail));
    } finally {
      setSubmitLoading(false);
    }
  }, [isReadOnly, taskId, task, navigate, showToast, confirm]);

  const handleMarkDone = useCallback(async () => {
    if (isReadOnly || !taskId || !task) return;
    const sample = task.task_samples[currentSampleIndex];
    if (!sample) return;
    const newStatus: 'annotated' | 'done' = sample.status === 'done' ? 'annotated' : 'done';
    setDoneLoading(true);
    try {
      await annotationApi.markSampleStatus(taskId, sample.id, newStatus);
      setTask((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          task_samples: prev.task_samples.map((s, i) =>
            i === currentSampleIndex ? { ...s, status: newStatus } : s
          ),
        };
      });
      setSampleData((prev) => prev ? { ...prev, status: newStatus } : prev);
      showToast('success', newStatus === 'done' ? 'Đã đánh dấu Xong' : 'Đã chuyển về Đang làm');
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast('error', e.response?.data?.detail || 'Không thể cập nhật trạng thái');
    } finally {
      setDoneLoading(false);
    }
  }, [isReadOnly, taskId, task, currentSampleIndex, showToast]);

  // ── Keyboard shortcuts ──────────────────────────────────────
  useEffect(() => {
    if (!sampleData || isReadOnly) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const label = sampleData.labels.find(
        (l) => l.shortcut_key && l.shortcut_key.toLowerCase() === e.key.toLowerCase()
      );
      if (!label) return;
      if (task?.annotation_type === 'text_classification') {
        e.preventDefault();
        handleToggleClassificationLabel(label);
        return;
      }
      if (selection) { e.preventDefault(); handleCreateAnnotation(label); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [sampleData, isReadOnly, selection, task?.annotation_type, handleCreateAnnotation, handleToggleClassificationLabel]);

  // ── Loading / error states ──────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-32">
        <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
        <span className="ml-2.5 text-sm text-gray-500">Đang tải workspace…</span>
      </div>
    );
  }

  if (error && !sampleData) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
        <p className="text-sm text-gray-600 mb-3">{error}</p>
        <Link to="/projects" className="text-sm text-blue-600 hover:underline">← Quay lại Dự án</Link>
      </div>
    );
  }

  const isClassification = task?.annotation_type === 'text_classification';

  const currentRejectionFeedback = currentSample ? rejectionFeedback[currentSample.id] : undefined;

  // ─── Shared top bar ──────────────────────────────────────────
  const topBar = (
    <div className="shrink-0 bg-white flex flex-col md:flex-row md:items-center md:justify-between gap-3 px-3 sm:px-5 py-3 border-b border-surface-200">
      <div className="flex items-center gap-3 min-w-0">
        <Link
          to={task ? `/projects/${task.project_id}` : '/projects'}
          className="flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-800 transition-colors shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          Quay lại
        </Link>
        <div className="w-px h-4 bg-surface-200" />
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isClassification ? 'bg-amber-100' : 'bg-purple-100'}`}>
            {isClassification
              ? <BadgeCheck className="w-4 h-4 text-amber-600" />
              : <Tag className="w-4 h-4 text-purple-600" />
            }
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-surface-900 leading-none">
              {isClassification ? 'Text Classification' : 'Sequence Labeling (NER)'}
            </p>
            <p className="text-[11px] text-surface-400 mt-0.5">#{taskId?.slice(0, 8)}</p>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 justify-end">
        <TaskStatusBadge status={task?.status || 'todo'} />
        {canEditTask && !isSubmitted ? (
          <button
            onClick={handleSubmit}
            disabled={submitLoading}
            className="btn-primary flex items-center gap-1.5 text-sm"
          >
            {submitLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Submit
          </button>
        ) : (
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${
            isSubmitted
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-surface-100 text-surface-600'
          }`}>
            <CheckCircle2 className="w-4 h-4" />{isSubmitted ? 'Đã nộp' : 'Chỉ xem'}
          </div>
        )}
      </div>
    </div>
  );

  // ─── Rejection banner ────────────────────────────────────────
  const rejectionBanner = (currentSampleStatus === 'rejected' || currentSampleStatus === 'rework') && (
    <div className="mx-5 mt-2 flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 shrink-0">
      <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-red-700">Sample bị từ chối — cần sửa lại</p>
        {currentRejectionFeedback && (
          <p className="text-sm text-red-600 mt-0.5">"{currentRejectionFeedback.feedback}"</p>
        )}
      </div>
    </div>
  );

  const currentIsDone = currentSample?.status === 'done';
  const hasAnnotations = (sampleData?.annotations.length ?? 0) > 0;

  const bottomBarProps = {
    currentIndex: currentSampleIndex,
    total: samples.length,
    canClear: hasAnnotations,
    saving,
    isReadOnly,
    isDone: currentIsDone,
    canMarkDone: Boolean(currentSample),
    doneLoading,
    onBack: () => task && currentSampleIndex > 0 && navigateSample(currentSampleIndex - 1, task),
    onClear: handleClearAnnotations,
    onToggleDone: handleMarkDone,
    onNext: () => task && currentSampleIndex < samples.length - 1 && navigateSample(currentSampleIndex + 1, task),
  };

  // ══════════════════════════════════════════════════════════
  // TEXT CLASSIFICATION — 3-panel
  // ══════════════════════════════════════════════════════════
  if (isClassification) {
    return (
      <div className="-m-6 flex flex-col min-h-[calc(100vh-64px)] xl:h-[calc(100vh-64px)] xl:overflow-hidden">
        {ConfirmDialog}
        {topBar}
        {rejectionBanner}

        <div className="flex flex-col xl:flex-row flex-1 min-h-0">
          {/* LEFT */}
          <SampleListPanel
            samples={samples}
            currentIndex={currentSampleIndex}
            onNavigate={(i) => task && navigateSample(i, task)}
          />

          {/* CENTER */}
          <div className="flex-1 min-w-0 flex flex-col bg-slate-50/50 min-h-[520px] xl:min-h-0">
            <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-5 sm:py-6">
              {sampleData && (
                <div className="max-w-4xl mx-auto">
                  {/* Sample header */}
                  <div className="flex flex-wrap items-center gap-3 mb-4">
                    <h2 className="text-sm font-bold text-surface-700">Sample #{currentSampleIndex + 1}</h2>
                    <SampleStatusBadge status={sampleData.status} />
                    <div className="flex-1" />
                    <div className="flex items-center gap-3 text-xs text-surface-400 flex-wrap">
                      <span className="flex items-center gap-1">
                        <FileText className="w-3.5 h-3.5" />
                        {sampleData.content.length.toLocaleString()} ký tự
                      </span>
                      <span>·</span>
                      <span>{wordCount(sampleData.content).toLocaleString()} từ</span>
                    </div>
                  </div>

                  {/* Text card */}
                  <div className="bg-white rounded-2xl border border-surface-200 shadow-subtle overflow-hidden">
                    {sampleData.annotations.length > 0 && (
                      <div className="px-6 py-3 border-b border-surface-100 bg-amber-50/50 flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-surface-500 shrink-0">Nhãn đã chọn:</span>
                        {sampleData.annotations.map((ann) => (
                          <span
                            key={ann.id}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
                            style={{ backgroundColor: `rgba(${hexToRgb(ann.label_color || '#f59e0b')}, 0.12)`, color: ann.label_color || '#f59e0b' }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ann.label_color || '#f59e0b' }} />
                            {ann.label_name || 'Nhãn'}
                            {ann.is_ai_assisted && (
                              <span className="text-[9px] uppercase tracking-wide opacity-70">AI</span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="px-4 sm:px-8 py-5 sm:py-7">
                      <p className="text-surface-800 whitespace-pre-wrap break-words"
                        style={{ fontSize: 15, lineHeight: '2', fontFamily: 'Georgia, "Times New Roman", serif' }}>
                        {sampleData.content}
                      </p>
                    </div>
                    {sampleData.metadata && Object.keys(sampleData.metadata).length > 0 && (
                      <div className="px-6 py-3 border-t border-surface-100 bg-surface-50/60 flex items-center gap-4 flex-wrap">
                        {Object.entries(sampleData.metadata).slice(0, 5).map(([k, v]) => (
                          <div key={k} className="flex items-center gap-1.5 text-xs text-surface-400">
                            <span className="font-semibold text-surface-500">{k}:</span>
                            <span>{String(v)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <BottomBar {...bottomBarProps} />
          </div>

          {/* RIGHT: Label selector */}
          <div className={`w-full xl:shrink-0 min-h-0 overflow-y-auto bg-white border-t xl:border-t-0 xl:border-l border-surface-200 flex flex-col transition-[width] duration-200 ${sidebarOpen ? 'xl:w-64' : 'xl:w-80'}`}>
            <AISuggestionsPanel
              suggestions={aiSuggestions}
              labels={sampleData?.labels ?? []}
              sourceText={sampleData?.content ?? ''}
              loading={aiLoading}
              saving={saving}
              disabled={isReadOnly || !sampleData || (sampleData?.labels.length ?? 0) === 0}
              onSuggest={() => void handleRequestAISuggestions()}
              onChange={handleChangeAISuggestion}
              onToggleAccept={handleToggleAcceptAISuggestion}
              onReject={handleRejectAISuggestion}
              onSave={() => void handleSaveAISuggestions()}
            />
            <div className="px-4 py-3 border-b border-surface-100">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-surface-800">Chọn nhãn</p>
                  <p className="text-xs text-surface-400 mt-0.5">{sampleData?.annotations.length ?? 0} nhãn đã chọn</p>
                </div>
                <button
                  onClick={() => setIsSingleLabel((v) => !v)}
                  disabled={isReadOnly}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-surface-200 text-xs font-medium text-surface-600 hover:bg-surface-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title={isSingleLabel ? 'Chọn 1 nhãn' : 'Chọn nhiều nhãn'}
                >
                  {isSingleLabel ? <ToggleLeft className="w-4 h-4 text-amber-500" /> : <ToggleRight className="w-4 h-4 text-brand-500" />}
                  {isSingleLabel ? 'Chọn 1' : 'Chọn nhiều'}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {sampleData ? (
                sampleData.labels.length === 0 ? (
                  <div className="text-center py-12">
                    <Tag className="w-8 h-8 text-surface-300 mx-auto mb-2" />
                    <p className="text-xs text-surface-400">Chưa có nhãn nào.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sampleData.labels.map((label) => {
                      const selected = sampleData.annotations.some((a) => a.label_id === label.id);
                      const disabled = isReadOnly || saving;
                      const rgb = hexToRgb(label.color);
                      return (
                        <button
                          key={label.id}
                          onClick={() => handleToggleClassificationLabel(label)}
                          disabled={disabled}
                          className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-left text-sm font-medium transition-all disabled:cursor-not-allowed"
                          style={{
                            backgroundColor: selected ? `rgba(${rgb}, 0.10)` : '#f8fafc',
                            border: selected ? `1.5px solid rgba(${rgb}, 0.50)` : '1.5px solid #e2e8f0',
                            color: selected ? label.color : '#374151',
                            opacity: disabled ? 0.5 : 1,
                          }}
                        >
                          <span
                            className="shrink-0 flex items-center justify-center transition-all"
                            style={{
                              width: 18, height: 18,
                              borderRadius: isSingleLabel ? '50%' : 4,
                              border: selected ? `2px solid ${label.color}` : '2px solid #cbd5e1',
                              backgroundColor: selected ? label.color : 'white',
                            }}
                          >
                            {selected && (
                              isSingleLabel
                                ? <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: 'white', display: 'block' }} />
                                : <CheckCircle2 className="w-3 h-3 text-white" strokeWidth={3} />
                            )}
                          </span>
                          <span className="flex-1 truncate">{label.name}</span>
                          {label.shortcut_key && (
                            <kbd className="text-[10px] font-mono text-surface-400 bg-white px-1.5 py-0.5 rounded border border-surface-200 shrink-0">
                              {label.shortcut_key}
                            </kbd>
                          )}
                          {saving && selected && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" style={{ color: label.color }} />}
                        </button>
                      );
                    })}
                  </div>
                )
              ) : (
                <div className="flex items-center justify-center h-20">
                  <Loader2 className="w-5 h-5 animate-spin text-surface-300" />
                </div>
              )}
            </div>
            {/* Progress dots */}
            {samples.length > 0 && samples.length <= 40 && (
              <div className="px-4 py-3 border-t border-surface-100">
                <p className="text-[10px] font-semibold text-surface-400 uppercase tracking-wide mb-2">Tiến độ</p>
                <div className="flex flex-wrap gap-1">
                  {samples.map((s, i) => {
                    const isActive = i === currentSampleIndex;
                    const dc = sampleDotColor(s.status);
                    return (
                      <button key={s.id} onClick={() => task && navigateSample(i, task)}
                        title={`Sample ${i + 1}`} className="cursor-pointer transition-all"
                        style={{ width: isActive ? 10 : 7, height: isActive ? 10 : 7, borderRadius: '50%', backgroundColor: dc, opacity: isActive ? 1 : 0.65, outline: isActive ? `2px solid ${dc}` : 'none', outlineOffset: 2 }}
                      />
                    );
                  })}
                </div>
                <p className="text-[11px] text-surface-400 mt-2">
                  {samples.filter((s) => isSampleProcessed(s.status)).length} / {samples.length} đã xử lý
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  // SEQUENCE LABELING (NER) — 3-panel redesign
  // ══════════════════════════════════════════════════════════
  return (
    <div className="-m-6 flex flex-col min-h-[calc(100vh-64px)] xl:h-[calc(100vh-64px)] xl:overflow-hidden">
      {ConfirmDialog}
      {topBar}
      {rejectionBanner}

      <div className="flex flex-col xl:flex-row flex-1 min-h-0">
        {/* LEFT: Sample list */}
        <SampleListPanel
          samples={samples}
          currentIndex={currentSampleIndex}
          onNavigate={(i) => task && navigateSample(i, task)}
        />

        {/* CENTER: Text annotation area */}
        <div className="flex-1 min-w-0 flex flex-col bg-slate-50/50 min-h-[560px] xl:min-h-0">
          {/* Selection guide bar */}
          <div className="shrink-0 bg-white border-b border-surface-200 px-4 sm:px-6 py-2.5 flex items-center gap-4 overflow-x-auto">
            {selection ? (
              <>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="w-2 h-2 rounded-full bg-brand-500 shrink-0" />
                  <span className="text-xs font-semibold text-brand-700">
                    Đã chọn {selection.endOffset - selection.startOffset} ký tự:
                  </span>
                  <span className="text-xs text-surface-700 truncate font-medium">
                    "{selection.selectedText}"
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-surface-400">→ Chọn nhãn bên phải</span>
                  <button
                    onClick={() => setSelection(null)}
                    className="text-xs text-surface-400 hover:text-surface-700 px-2 py-1 rounded hover:bg-surface-100 transition-colors"
                  >
                    Bỏ chọn
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-4 sm:gap-6 min-w-max">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-brand-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
                  <span className="text-xs font-medium text-brand-700">Bôi đen văn bản</span>
                </div>
                <div className="flex items-center gap-1 text-surface-300">
                  <div className="w-6 h-px bg-surface-300" />
                  <ChevronRight className="w-3 h-3" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-surface-200 text-surface-500 text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
                  <span className="text-xs font-medium text-surface-400">Chọn nhãn entity</span>
                </div>
                <div className="flex items-center gap-1 text-surface-300">
                  <div className="w-6 h-px bg-surface-300" />
                  <ChevronRight className="w-3 h-3" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-surface-200 text-surface-500 text-[10px] font-bold flex items-center justify-center shrink-0">3</span>
                  <span className="text-xs font-medium text-surface-400">Text được highlight</span>
                </div>
              </div>
            )}
          </div>

          {/* Text content */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-5 sm:py-6">
            {sampleData ? (
              <div className="max-w-4xl mx-auto">
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <h2 className="text-sm font-bold text-surface-700">Sample #{currentSampleIndex + 1}</h2>
                  <SampleStatusBadge status={sampleData.status} />
                  <div className="flex-1" />
                  <div className="flex items-center gap-3 text-xs text-surface-400 flex-wrap">
                    <span>{sampleData.content.length.toLocaleString()} ký tự</span>
                    <span>·</span>
                    <span>{wordCount(sampleData.content).toLocaleString()} từ</span>
                    <span>·</span>
                    <span>{sampleData.annotations.length} entities</span>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-surface-200 shadow-subtle">
                  <div className="px-4 sm:px-8 py-5 sm:py-7">
                    <NERTextPanel
                      content={sampleData.content}
                      annotations={sampleData.annotations}
                      selection={selection}
                      onSelectionChange={isReadOnly ? undefined : setSelection}
                      labels={sampleData.labels}
                    />
                  </div>
                  {sampleData.metadata && Object.keys(sampleData.metadata).length > 0 && (
                    <div className="px-6 py-3 border-t border-surface-100 bg-surface-50/60 flex items-center gap-4 flex-wrap rounded-b-2xl">
                      {Object.entries(sampleData.metadata).slice(0, 5).map(([k, v]) => (
                        <div key={k} className="flex items-center gap-1.5 text-xs text-surface-400">
                          <span className="font-semibold text-surface-500">{k}:</span>
                          <span>{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-5 h-5 animate-spin text-surface-300" />
              </div>
            )}
          </div>

          <BottomBar {...bottomBarProps} />
        </div>

        {/* RIGHT: Entity labels + entity list */}
        <div className={`w-full xl:shrink-0 min-h-0 overflow-y-auto bg-white border-t xl:border-t-0 xl:border-l border-surface-200 flex flex-col transition-[width] duration-200 ${sidebarOpen ? 'xl:w-72' : 'xl:w-[360px]'}`}>
          <AISuggestionsPanel
            suggestions={aiSuggestions}
            labels={sampleData?.labels ?? []}
            sourceText={sampleData?.content ?? ''}
            loading={aiLoading}
            saving={saving}
            disabled={isReadOnly || !sampleData || (sampleData?.labels.length ?? 0) === 0}
            onSuggest={() => void handleRequestAISuggestions()}
            onChange={handleChangeAISuggestion}
            onToggleAccept={handleToggleAcceptAISuggestion}
            onReject={handleRejectAISuggestion}
            onSave={() => void handleSaveAISuggestions()}
          />
          {/* Label buttons */}
          <div className="px-4 pt-4 pb-3 border-b border-surface-100">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-surface-500 uppercase tracking-wide">Nhãn thực thể</p>
              {selection && (
                <span className="text-[10px] font-medium text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full">
                  Nhấp để gán
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {sampleData?.labels.map((label) => {
                const hasSelection = !!selection && !isReadOnly;
                const rgb = hexToRgb(label.color);
                return (
                  <button
                    key={label.id}
                    onClick={() => hasSelection && handleCreateAnnotation(label)}
                    onMouseDown={(e) => e.preventDefault()}
                    disabled={!hasSelection || saving}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition-all disabled:cursor-not-allowed"
                    style={{
                      backgroundColor: hasSelection ? `rgba(${rgb}, 0.10)` : '#f8fafc',
                      border: hasSelection ? `1.5px solid rgba(${rgb}, 0.45)` : '1.5px solid #e2e8f0',
                      color: hasSelection ? label.color : '#6b7280',
                      opacity: !hasSelection && !saving ? 0.7 : saving ? 0.5 : 1,
                    }}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded shrink-0"
                      style={{ backgroundColor: label.color }}
                    />
                    <span className="flex-1 truncate">{label.name}</span>
                    {label.shortcut_key && (
                      <kbd className="text-[10px] font-mono text-surface-400 bg-white px-1.5 py-0.5 rounded border border-surface-200 shrink-0">
                        {label.shortcut_key}
                      </kbd>
                    )}
                    {saving && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" style={{ color: label.color }} />}
                  </button>
                );
              })}
              {sampleData?.labels.length === 0 && (
                <p className="text-xs text-surface-400 text-center py-3">Chưa có nhãn nào được cấu hình.</p>
              )}
            </div>
          </div>

          {/* Entity list */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-3 flex items-center gap-2 border-b border-surface-50">
              <p className="text-xs font-semibold text-surface-500 uppercase tracking-wide">Entities đã gán</p>
              <span className="ml-auto text-[10px] font-bold text-surface-400 bg-surface-100 px-2 py-0.5 rounded-full">
                {sampleData?.annotations.length ?? 0}
              </span>
            </div>

            {(sampleData?.annotations.length ?? 0) === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center px-4">
                <div className="w-10 h-10 rounded-full bg-surface-100 flex items-center justify-center">
                  <MousePointer className="w-5 h-5 text-surface-300" />
                </div>
                <p className="text-xs text-surface-400">Chưa có entity nào.<br />Bôi đen văn bản và chọn nhãn.</p>
              </div>
            ) : (
              <div className="p-3 space-y-1.5">
                {[...(sampleData?.annotations ?? [])]
                  .sort((a, b) => a.start_offset - b.start_offset)
                  .map((ann) => (
                    <NEREntityItem
                      key={ann.id}
                      annotation={ann}
                      isReadOnly={isReadOnly}
                      onDelete={handleDeleteAnnotation}
                    />
                  ))}
              </div>
            )}
          </div>

          {/* Progress dots */}
          {samples.length > 0 && samples.length <= 40 && (
            <div className="px-4 py-3 border-t border-surface-100">
              <p className="text-[10px] font-semibold text-surface-400 uppercase tracking-wide mb-2">Tiến độ</p>
              <div className="flex flex-wrap gap-1">
                {samples.map((s, i) => {
                  const isActive = i === currentSampleIndex;
                  const dc = sampleDotColor(s.status);
                  return (
                    <button key={s.id} onClick={() => task && navigateSample(i, task)}
                      title={`Sample ${i + 1}`} className="cursor-pointer transition-all"
                      style={{ width: isActive ? 10 : 7, height: isActive ? 10 : 7, borderRadius: '50%', backgroundColor: dc, opacity: isActive ? 1 : 0.65, outline: isActive ? `2px solid ${dc}` : 'none', outlineOffset: 2 }}
                    />
                  );
                })}
              </div>
              <p className="text-[11px] text-surface-400 mt-2">
                {samples.filter((s) => isSampleProcessed(s.status)).length} / {samples.length} đã xử lý
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// NER TEXT PANEL — text with entity highlights + selection
// ============================================================
function NERTextPanel({
  content,
  annotations,
  selection,
  onSelectionChange,
  labels,
}: {
  content: string;
  annotations: Annotation[];
  selection: TextSelection | null;
  onSelectionChange?: (sel: TextSelection | null) => void;
  labels: LabelOption[];
}) {
  const textRef = useRef<HTMLDivElement>(null);

  const labelColors = useMemo(() => {
    const map: Record<string, string> = {};
    labels.forEach((l) => { map[l.id] = l.color; });
    annotations.forEach((a) => { if (a.label_color) map[a.label_id] = a.label_color; });
    return map;
  }, [labels, annotations]);

  useEffect(() => {
    if (!selection) window.getSelection()?.removeAllRanges();
  }, [selection]);

  const getAbsoluteOffset = useCallback(
    (container: Node, targetNode: Node, nodeOffset: number): number => {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode(node: Node): number {
          let el = node.parentElement;
          while (el && el !== container) {
            if (el.dataset.tooltip) return NodeFilter.FILTER_REJECT;
            el = el.parentElement;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      let abs = 0;
      let cur = walker.nextNode();
      while (cur) {
        if (cur === targetNode) return abs + nodeOffset;
        abs += (cur.textContent || '').length;
        cur = walker.nextNode();
      }
      return abs + nodeOffset;
    }, []
  );

  useEffect(() => {
    if (!onSelectionChange || !textRef.current) return;
    const container = textRef.current;
    const capture = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return;
      const start = getAbsoluteOffset(container, range.startContainer, range.startOffset);
      const end = getAbsoluteOffset(container, range.endContainer, range.endOffset);
      if (start >= end || end > content.length) return;
      const txt = content.slice(start, end);
      if (!txt.trim()) return;
      onSelectionChange({ startOffset: start, endOffset: end, selectedText: txt });
    };
    const onMouseUp = () => requestAnimationFrame(capture);
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey || e.key.includes('Arrow') || e.key === 'Home' || e.key === 'End')
        requestAnimationFrame(capture);
    };
    document.addEventListener('mouseup', onMouseUp);
    container.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      container.removeEventListener('keyup', onKeyUp);
    };
  }, [onSelectionChange, content, getAbsoluteOffset]);

  const renderedContent = useMemo(() => {
    if (annotations.length === 0) return content;
    const sorted = [...annotations].sort((a, b) => a.start_offset - b.start_offset);
    const segments: Array<{ text: string; annotation?: Annotation }> = [];
    let cursor = 0;
    for (const ann of sorted) {
      if (ann.start_offset < cursor) continue;
      if (ann.start_offset > cursor) segments.push({ text: content.slice(cursor, ann.start_offset) });
      segments.push({ text: content.slice(ann.start_offset, ann.end_offset), annotation: ann });
      cursor = ann.end_offset;
    }
    if (cursor < content.length) segments.push({ text: content.slice(cursor) });
    return segments;
  }, [content, annotations]);

  return (
    <div
      ref={textRef}
      className={onSelectionChange ? 'cursor-text select-text' : ''}
      style={{
        fontSize: 15,
        lineHeight: '2.1',
        color: '#1e293b',
        userSelect: onSelectionChange ? 'text' : 'none',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {typeof renderedContent === 'string' ? (
        <span>{renderedContent}</span>
      ) : (
        renderedContent.map((seg, i) => {
          if (!seg.annotation) return <span key={i}>{seg.text}</span>;
          const color = labelColors[seg.annotation.label_id] || '#6366F1';
          const rgb = hexToRgb(color);
          return (
            <mark
              key={i}
              className="group/mark relative"
              style={{
                backgroundColor: `rgba(${rgb}, 0.15)`,
                color: '#1e293b',
                borderBottom: `2.5px solid ${color}`,
                borderRadius: '3px 3px 0 0',
                padding: '1px 2px',
                userSelect: 'text',
                WebkitUserSelect: 'text',
                cursor: 'text',
              }}
            >
              {seg.text}
              {/* Label badge above */}
              <span
                data-tooltip="true"
                className="absolute -top-6 left-0 pointer-events-none z-20 select-none
                           opacity-0 group-hover/mark:opacity-100 transition-opacity"
                style={{
                  backgroundColor: color,
                  color: 'white',
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: 4,
                  whiteSpace: 'nowrap',
                  letterSpacing: '0.02em',
                }}
              >
                {seg.annotation.label_name}
              </span>
            </mark>
          );
        })
      )}
    </div>
  );
}

// ============================================================
// NER ENTITY ITEM
// ============================================================
function NEREntityItem({
  annotation: ann,
  isReadOnly,
  onDelete,
}: {
  annotation: Annotation;
  isReadOnly: boolean;
  onDelete: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const color = ann.label_color || '#6366F1';
  const rgb = hexToRgb(color);

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete(ann.id);
    setDeleting(false);
  };

  return (
    <div
      className="group flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-colors hover:bg-surface-50"
      style={{ borderColor: `rgba(${rgb}, 0.25)`, backgroundColor: `rgba(${rgb}, 0.04)` }}
    >
      {/* Color + label */}
      <div
        className="shrink-0 px-2 py-0.5 rounded text-[10px] font-bold text-white tracking-wide"
        style={{ backgroundColor: color }}
      >
        {ann.label_name}
      </div>

      {/* Text */}
      <span className="flex-1 min-w-0 text-xs text-surface-700 font-medium truncate">
        "{ann.selected_text}"
      </span>
      {ann.is_ai_assisted && (
        <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
          AI
        </span>
      )}

      {/* Delete */}
      {!isReadOnly && (
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="shrink-0 p-1 rounded text-surface-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50 cursor-pointer"
        >
          {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
        </button>
      )}
    </div>
  );
}

// ============================================================
// STATUS BADGE helpers
// ============================================================
function SampleStatusBadge({ status }: { status: string }) {
  const cfg = SAMPLE_STATUS[status] ?? SAMPLE_STATUS.pending;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function TaskStatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    todo:        { bg: '#f3f4f6', color: '#4b5563', label: 'Chưa làm'  },
    in_progress: { bg: '#eff6ff', color: '#1d4ed8', label: 'Đang làm'  },
    submitted:   { bg: '#f0fdf4', color: '#15803d', label: 'Đã xong'   },
    rework:      { bg: '#fef2f2', color: '#b91c1c', label: 'Từ chối'   },
    approved:    { bg: '#f0fdf4', color: '#15803d', label: 'Đã duyệt'  },
    rejected:    { bg: '#fef2f2', color: '#b91c1c', label: 'Từ chối'   },
  };
  const s = styles[status] || styles.todo;
  return (
    <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}
