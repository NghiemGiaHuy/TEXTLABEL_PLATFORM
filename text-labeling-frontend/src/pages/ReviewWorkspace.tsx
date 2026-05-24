// src/pages/ReviewWorkspace.tsx

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  BadgeCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Tag,
  Hash,
  MessageSquare,
  User,
  RefreshCw,
  ExternalLink,
  Send,
} from 'lucide-react';
import { annotationApi } from '../api/annotationApi';
import { reviewApi, type ReviewAnnotation, type ReviewSampleDetail, type ReviewRecord } from '../api/reviewApi';
import { useToast } from '../components/Toast';
import type { TaskDetail } from '../types';

// ─── Color utility ──────────────────────────────────────────
function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function SampleStatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    pending:   { bg: '#f3f4f6', color: '#4b5563', label: 'Chưa duyệt' },
    annotated: { bg: '#eff6ff', color: '#1d4ed8', label: 'Đã đánh nhãn' },
    submitted: { bg: '#f5f3ff', color: '#6d28d9', label: 'Chờ duyệt' },
    approved:  { bg: '#f0fdf4', color: '#15803d', label: 'Đã duyệt' },
    rejected:  { bg: '#fef2f2', color: '#b91c1c', label: 'Từ chối' },
    rework:    { bg: '#fff7ed', color: '#c2410c', label: 'Cần sửa' },
  };
  const s = map[status] || map.pending;
  return (
    <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

function normalizeTaskStatus(task: TaskDetail): TaskDetail {
  return { ...task, status: task.task_status ?? task.status };
}

type ReviewWorkspaceKind = 'classification' | 'sequence' | 'relation';

interface ReviewEntity {
  id: string;
  text: string;
  start: number;
  end: number;
  label: string;
  color: string;
}

interface ReviewRelationLink {
  id: string;
  headId?: string;
  tailId?: string;
  headText: string;
  tailText: string;
  relationType: string;
  relLabelId?: string;
  color: string;
}

interface RelationReviewData {
  entities: ReviewEntity[];
  relations: ReviewRelationLink[];
  entityAnnotations: ReviewAnnotation[];
  relationAnnotations: ReviewAnnotation[];
}

const EMPTY_RELATION_REVIEW_DATA: RelationReviewData = {
  entities: [],
  relations: [],
  entityAnnotations: [],
  relationAnnotations: [],
};

function getReviewWorkspaceKind(annotationType: string | null | undefined): ReviewWorkspaceKind {
  if (annotationType === 'text_classification') return 'classification';
  if (annotationType === 'relation_extraction') return 'relation';
  return 'sequence';
}

function normalizeGroupName(name: string | null | undefined) {
  return (name ?? '').trim().toLowerCase();
}

function isEntityGroupName(name: string | null | undefined) {
  const groupName = normalizeGroupName(name);
  return groupName.includes('ner') || groupName.includes('entity') || groupName.includes('thực thể');
}

function isRelationGroupName(name: string | null | undefined) {
  const groupName = normalizeGroupName(name);
  return groupName.includes('relation') || groupName.includes('quan hệ');
}

function buildReviewEntity(annotation: ReviewAnnotation): ReviewEntity {
  return {
    id: annotation.id,
    text: annotation.selected_text,
    start: annotation.start_offset,
    end: annotation.end_offset,
    label: annotation.label_name || 'Label',
    color: annotation.label_color || '#6366F1',
  };
}

function readDraftRelations(draftData: Record<string, unknown> | undefined): ReviewRelationLink[] {
  const rawRelations = draftData?.relations;
  if (!Array.isArray(rawRelations)) return [];

  return rawRelations.flatMap((item, index): ReviewRelationLink[] => {
    if (!item || typeof item !== 'object') return [];
    const rel = item as Record<string, unknown>;
    const headId = typeof rel.headId === 'string' ? rel.headId : undefined;
    const tailId = typeof rel.tailId === 'string' ? rel.tailId : undefined;
    if (!headId || !tailId) return [];

    return [{
      id: typeof rel.id === 'string' ? rel.id : `draft-rel-${index}`,
      headId,
      tailId,
      headText: '',
      tailText: '',
      relationType: typeof rel.relationType === 'string' ? rel.relationType : 'Quan hệ',
      relLabelId: typeof rel.relLabelId === 'string' ? rel.relLabelId : undefined,
      color: typeof rel.color === 'string' ? rel.color : '#10B981',
    }];
  });
}

function parseRelationText(selectedText: string) {
  const [head, ...tailParts] = selectedText.split(' -> ');
  if (tailParts.length === 0) {
    return { headText: selectedText, tailText: '' };
  }
  return { headText: head.trim(), tailText: tailParts.join(' -> ').trim() };
}

function mergeReviewAnnotations(primary: ReviewAnnotation[], secondary: ReviewAnnotation[]) {
  const seen = new Set<string>();
  const merged: ReviewAnnotation[] = [];

  for (const annotation of [...primary, ...secondary]) {
    const key = `${annotation.start_offset}:${annotation.end_offset}:${annotation.label_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(annotation);
  }

  return merged.sort((a, b) => a.start_offset - b.start_offset || a.end_offset - b.end_offset);
}

function buildRelationReviewData(sampleDetail: ReviewSampleDetail | null): RelationReviewData {
  if (!sampleDetail) return EMPTY_RELATION_REVIEW_DATA;

  const annotations = sampleDetail.annotations ?? [];
  const draftRelations = readDraftRelations(sampleDetail.draft?.draft_data);
  const draftEndpointIds = new Set<string>();
  const draftRelationLabelIds = new Set<string>();

  draftRelations.forEach((relation) => {
    if (relation.headId) draftEndpointIds.add(relation.headId);
    if (relation.tailId) draftEndpointIds.add(relation.tailId);
    if (relation.relLabelId) draftRelationLabelIds.add(relation.relLabelId);
  });

  const relationAnnotations = annotations.filter((annotation) =>
    draftRelationLabelIds.has(annotation.label_id)
    || isRelationGroupName(annotation.label_group_name)
    || annotation.selected_text.includes(' -> ')
  );
  const relationAnnotationIds = new Set(relationAnnotations.map((annotation) => annotation.id));

  const currentEntityAnnotations = annotations.filter((annotation) => {
    if (relationAnnotationIds.has(annotation.id)) return false;
    if (draftEndpointIds.has(annotation.id)) return true;
    if (isEntityGroupName(annotation.label_group_name)) return true;
    return draftEndpointIds.size === 0 && !isRelationGroupName(annotation.label_group_name);
  });

  const entityAnnotations = mergeReviewAnnotations(
    currentEntityAnnotations,
    sampleDetail.related_entities ?? []
  );
  const entityById = new Map(entityAnnotations.map((annotation) => [annotation.id, buildReviewEntity(annotation)]));
  const entities = [...entityById.values()].sort((a, b) => a.start - b.start || a.end - b.end);
  const labelById = new Map(annotations.map((annotation) => [annotation.label_id, annotation]));

  const relationsFromDraft = draftRelations.flatMap((relation): ReviewRelationLink[] => {
    const head = relation.headId ? entityById.get(relation.headId) : undefined;
    const tail = relation.tailId ? entityById.get(relation.tailId) : undefined;
    const labelAnnotation = relation.relLabelId ? labelById.get(relation.relLabelId) : undefined;
    if (!head && !tail) return [];

    return [{
      ...relation,
      headText: head?.text || relation.headText,
      tailText: tail?.text || relation.tailText,
      relationType: labelAnnotation?.label_name || relation.relationType,
      color: labelAnnotation?.label_color || relation.color,
    }];
  });

  const draftRelationKeys = new Set(
    relationsFromDraft.map((relation) => `${relation.relLabelId || ''}:${relation.headText}->${relation.tailText}`)
  );
  const fallbackRelations = relationAnnotations.flatMap((annotation): ReviewRelationLink[] => {
    const { headText, tailText } = parseRelationText(annotation.selected_text);
    const key = `${annotation.label_id}:${headText}->${tailText}`;
    if (draftRelationKeys.has(key)) return [];
    return [{
      id: annotation.id,
      headText,
      tailText,
      relationType: annotation.label_name || 'Quan hệ',
      relLabelId: annotation.label_id,
      color: annotation.label_color || '#10B981',
    }];
  });

  return {
    entities,
    relations: [...relationsFromDraft, ...fallbackRelations],
    entityAnnotations,
    relationAnnotations,
  };
}

type ReviewSampleStatusFilter = 'all' | 'pending' | 'submitted' | 'approved' | 'rejected' | 'fixed';

const REVIEW_SAMPLE_STATUS: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  pending:   { label: 'Chưa duyệt', bg: 'bg-surface-100', text: 'text-surface-500', dot: 'bg-surface-400' },
  annotated: { label: 'Đã đánh nhãn', bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  submitted: { label: 'Chờ duyệt', bg: 'bg-purple-50', text: 'text-purple-700', dot: 'bg-purple-500' },
  approved:  { label: 'Đã duyệt', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  rejected:  { label: 'Từ chối', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  rework:    { label: 'Cần sửa', bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
  fixed:     { label: 'Mới sửa', bg: 'bg-indigo-50', text: 'text-indigo-700', dot: 'bg-indigo-500' },
};

const REVIEW_SAMPLE_STATUS_FILTERS: Array<{ value: ReviewSampleStatusFilter; label: string }> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'submitted', label: 'Chờ duyệt' },
  { value: 'fixed', label: 'Mới sửa' },
  { value: 'approved', label: 'Đã duyệt' },
  { value: 'rejected', label: 'Từ chối' },
];

function getReviewSampleStatusFilter(status: string, newlyFixed: boolean): ReviewSampleStatusFilter {
  if (newlyFixed) return 'fixed';
  if (status === 'approved') return 'approved';
  if (status === 'rejected' || status === 'rework') return 'rejected';
  if (status === 'submitted') return 'submitted';
  return 'pending';
}


function reviewWordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function ReviewSampleListPanel({
  samples,
  currentIndex,
  rejectionMap,
  onNavigate,
}: {
  samples: TaskDetail['task_samples'];
  currentIndex: number;
  rejectionMap: Record<string, { feedback: string; reviewer_name: string | null; reviewed_at: string }>;
  onNavigate: (i: number) => void;
}) {
  const [sampleNumberQuery, setSampleNumberQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ReviewSampleStatusFilter>('all');

  const filteredSamples = useMemo(() => {
    const sampleNumber = Number(sampleNumberQuery.trim());
    const hasSampleNumber = sampleNumberQuery.trim() !== '';

    return samples
      .map((sample, index) => ({ sample, index }))
      .filter(({ sample, index }) => {
        const newlyFixed = sample.status === 'submitted' && !!rejectionMap[sample.id];
        const numberMatches = !hasSampleNumber
          || (Number.isInteger(sampleNumber) && sampleNumber === index + 1);
        const statusMatches = statusFilter === 'all'
          || getReviewSampleStatusFilter(sample.status, newlyFixed) === statusFilter;
        return numberMatches && statusMatches;
      });
  }, [samples, sampleNumberQuery, statusFilter, rejectionMap]);

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
          onChange={(event) => setStatusFilter(event.target.value as ReviewSampleStatusFilter)}
          aria-label="Lọc theo trạng thái sample"
          className="min-w-0 flex-1 rounded-lg border border-surface-200 bg-white px-2.5 py-1.5 text-xs font-medium text-surface-700 outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        >
          {REVIEW_SAMPLE_STATUS_FILTERS.map((option) => (
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
          const newlyFixed = s.status === 'submitted' && !!rejectionMap[s.id];
          const cfg = newlyFixed ? REVIEW_SAMPLE_STATUS.fixed : (REVIEW_SAMPLE_STATUS[s.status] ?? REVIEW_SAMPLE_STATUS.pending);
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

function ReviewBottomBar({
  currentIndex,
  total,
  pendingReviewCount,
  onBack,
  onRefresh,
  onNext,
}: {
  currentIndex: number;
  total: number;
  pendingReviewCount: number;
  onBack: () => void;
  onRefresh: () => void;
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
        onClick={onRefresh}
        className="flex shrink-0 items-center justify-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg border border-surface-200 text-sm font-medium text-surface-600 hover:bg-surface-50 transition-colors"
      >
        <RefreshCw className="w-4 h-4" />
        Tải lại
      </button>

      <div className="hidden sm:flex flex-1 items-center justify-center text-xs text-surface-400">
        {pendingReviewCount > 0 ? `Còn ${pendingReviewCount} sample chưa duyệt` : 'Tất cả sample đã có quyết định'}
      </div>

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
// MAIN REVIEW WORKSPACE
// ============================================================
export default function ReviewWorkspace() {
  const { projectId, taskId } = useParams<{ projectId: string; taskId: string }>();
  const { showToast } = useToast();

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [currentSampleIndex, setCurrentSampleIndex] = useState(0);
  const [sampleDetail, setSampleDetail] = useState<ReviewSampleDetail | null>(null);
  const [rejectionMap, setRejectionMap] = useState<Record<string, { feedback: string; reviewer_name: string | null; reviewed_at: string }>>({});

  const [loading, setLoading] = useState(true);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [reviewSubmitLoading, setReviewSubmitLoading] = useState(false);
  const [error, setError] = useState('');

  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectFeedback, setRejectFeedback] = useState('');
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [approveFeedback, setApproveFeedback] = useState('');

  // ─── Load sample detail ──────────────────────────────────
  const loadSample = useCallback(async (tid: string, sampleId: string) => {
    setSampleLoading(true);
    try {
      const detail = await reviewApi.getReviewSample(tid, sampleId);
      setSampleDetail(detail);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e.response?.data?.detail || 'Không thể tải sample');
    } finally {
      setSampleLoading(false);
    }
  }, []);

  // ─── Reload task (refresh sample statuses + rejection map after action) ──
  const reloadTask = useCallback(async (): Promise<TaskDetail | null> => {
    if (!projectId || !taskId) return null;
    try {
      const [t, fb] = await Promise.all([
        annotationApi.getTask(projectId, taskId),
        annotationApi.getRejectionFeedback(taskId).catch(() => ({ feedback: {} })),
      ]);
      const normalizedTask = normalizeTaskStatus(t);
      setTask(normalizedTask);
      setRejectionMap(fb.feedback);
      return normalizedTask;
    } catch {
      return null;
    }
  }, [projectId, taskId]);

  // ─── Load task on mount ──────────────────────────────────
  useEffect(() => {
    if (!projectId || !taskId) return;
    setLoading(true);
    Promise.all([
      annotationApi.getTask(projectId, taskId),
      annotationApi.getRejectionFeedback(taskId).catch(() => ({ feedback: {} })),
    ])
      .then(([t, fb]) => {
        const normalizedTask = normalizeTaskStatus(t);
        setTask(normalizedTask);
        setRejectionMap(fb.feedback);
        if (normalizedTask.task_samples.length > 0) {
          loadSample(taskId, normalizedTask.task_samples[0].id);
        }
      })
      .catch((err: unknown) => {
        const e = err as { response?: { data?: { detail?: string } } };
        setError(e.response?.data?.detail || 'Không thể tải task');
      })
      .finally(() => setLoading(false));
  }, [projectId, taskId, loadSample]);

  // ─── Navigate between samples ────────────────────────────
  const navigateSample = useCallback(
    async (index: number, currentTask: TaskDetail) => {
      if (!taskId) return;
      setCurrentSampleIndex(index);
      await loadSample(taskId, currentTask.task_samples[index].id);
    },
    [taskId, loadSample]
  );

  // ─── Approve ────────────────────────────────────────────
  const handleApprove = useCallback(async () => {
    if (!taskId || !sampleDetail) return;
    setActionLoading(true);
    try {
      await reviewApi.approveSample(
        taskId,
        sampleDetail.task_sample_id,
        approveFeedback.trim() || undefined
      );
      showToast('success', 'Sample đã được duyệt!');
      setShowApproveDialog(false);
      setApproveFeedback('');
      // Reload sample detail + task (to refresh all sample statuses)
      const [freshTask] = await Promise.all([
        reloadTask(),
        loadSample(taskId, sampleDetail.task_sample_id),
      ]);
      // Auto-advance to next unreviewed sample
      if (freshTask) {
        const nextIdx = freshTask.task_samples.findIndex(
          (s, i) => i > currentSampleIndex && s.status !== 'approved'
        );
        if (nextIdx !== -1) {
          setTimeout(() => navigateSample(nextIdx, freshTask), 700);
        }
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast('error', e.response?.data?.detail || 'Duyệt thất bại');
    } finally {
      setActionLoading(false);
    }
  }, [taskId, sampleDetail, approveFeedback, currentSampleIndex, loadSample, reloadTask, navigateSample, showToast]);

  // ─── Reject ─────────────────────────────────────────────
  const handleReject = useCallback(async () => {
    if (!taskId || !sampleDetail || !rejectFeedback.trim()) return;
    setActionLoading(true);
    try {
      await reviewApi.rejectSample(
        taskId,
        sampleDetail.task_sample_id,
        rejectFeedback.trim()
      );
      showToast('warning', 'Sample đã bị từ chối. Bấm Submit để chốt review.');
      setShowRejectDialog(false);
      setRejectFeedback('');
      // Reload sample detail + task
      const [freshTask] = await Promise.all([
        reloadTask(),
        loadSample(taskId, sampleDetail.task_sample_id),
      ]);
      // Auto-advance to next unreviewed sample
      if (freshTask) {
        const nextIdx = freshTask.task_samples.findIndex(
          (s, i) => i > currentSampleIndex && s.status !== 'approved' && s.status !== 'rejected'
        );
        if (nextIdx !== -1) {
          setTimeout(() => navigateSample(nextIdx, freshTask), 700);
        }
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast('error', e.response?.data?.detail || 'Từ chối thất bại');
    } finally {
      setActionLoading(false);
    }
  }, [taskId, sampleDetail, rejectFeedback, currentSampleIndex, loadSample, reloadTask, navigateSample, showToast]);

  const handleSubmitReview = useCallback(async () => {
    if (!taskId || !task) return;

    const pendingCount = task.task_samples.filter((sample) => sample.status === 'submitted').length;
    if (pendingCount > 0) {
      showToast('error', `Còn ${pendingCount} sample chưa duyệt`);
      return;
    }

    setReviewSubmitLoading(true);
    try {
      const result = await reviewApi.submitReviewTask(taskId);
      const freshTask = await reloadTask();
      const sampleId = freshTask?.task_samples[currentSampleIndex]?.id;
      if (sampleId) {
        await loadSample(taskId, sampleId);
      }
      showToast(result.status === 'rework' ? 'warning' : 'success', result.message);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast('error', e.response?.data?.detail || 'Không thể submit review');
    } finally {
      setReviewSubmitLoading(false);
    }
  }, [taskId, task, currentSampleIndex, loadSample, reloadTask, showToast]);

  const annotationType = task?.annotation_type ?? task?.task_type ?? 'sequence_labeling';
  const reviewKind = getReviewWorkspaceKind(annotationType);
  const relationReviewData = useMemo(() => buildRelationReviewData(sampleDetail), [sampleDetail]);
  const isClassification = reviewKind === 'classification';
  const isRelationExtraction = reviewKind === 'relation';

  // ─── Loading / Error ────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
        <span className="ml-2.5 text-sm text-gray-500">Đang tải workspace duyệt…</span>
      </div>
    );
  }

  if (error && !sampleDetail) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
        <p className="text-sm text-gray-600 mb-3">{error}</p>
        <Link to={`/projects/${projectId}`} className="text-sm text-blue-600 hover:underline">
          ← Quay lại dự án
        </Link>
      </div>
    );
  }

  const samples = task?.task_samples || [];
  const currentSample = samples[currentSampleIndex];
  const currentSampleStatus = currentSample?.status || 'submitted';
  const isReviewSubmitted = task?.status === 'submitted';
  const isReviewFinalized = task?.status === 'approved' || task?.status === 'rework';
  const sampleReviewDecision = currentSampleStatus === 'approved'
    ? 'approved'
    : currentSampleStatus === 'rejected' || currentSampleStatus === 'rework'
      ? 'rejected'
      : null;
  const isAlreadyReviewed = sampleReviewDecision !== null;

  // Newly fixed = sample is submitted AND was previously rejected by reviewer
  const isNewlyFixed =
    currentSampleStatus === 'submitted' && currentSample && !!rejectionMap[currentSample.id];
  const currentRejectionContext = currentSample ? rejectionMap[currentSample.id] : undefined;

  const pendingReviewCount = samples.filter((s) => s.status === 'submitted').length;

  const refreshSample = async () => {
    const freshTask = await reloadTask();
    if (freshTask && taskId) {
      const sampleId = freshTask.task_samples[currentSampleIndex]?.id;
      if (sampleId) loadSample(taskId, sampleId);
    }
  };
  return (
    <div className="-m-6 flex flex-col min-h-[calc(100vh-64px)] xl:h-[calc(100vh-64px)] xl:overflow-hidden">
      <div className="shrink-0 bg-white flex flex-col md:flex-row md:items-center md:justify-between gap-3 px-3 sm:px-5 py-3 border-b border-surface-200">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to={`/projects/${projectId}`}
            className="flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-800 transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            Quay lại
          </Link>
          <div className="w-px h-4 bg-surface-200" />
          <div className="flex items-center gap-2 min-w-0">
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isClassification ? 'bg-amber-100' : isRelationExtraction ? 'bg-emerald-100' : 'bg-purple-100'}`}>
              {isClassification ? (
                <BadgeCheck className="w-4 h-4 text-amber-600" />
              ) : isRelationExtraction ? (
                <ExternalLink className="w-4 h-4 text-emerald-600" />
              ) : (
                <Tag className="w-4 h-4 text-purple-600" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-surface-900 leading-none">
                {isClassification
                  ? 'Text Classification Review'
                  : isRelationExtraction
                    ? 'Relation Extraction Review'
                    : annotationType === 'ner'
                      ? 'NER Review'
                      : 'Sequence Labeling Review'}
              </p>
              <p className="text-[11px] text-surface-400 mt-0.5">
                #{taskId?.slice(0, 8)}
                {task?.assignee_name && <span className="ml-2 text-surface-500">→ {task.assignee_name}</span>}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end">
          <SampleStatusBadge status={task?.status || 'submitted'} />
          {isReviewSubmitted ? (
            <button
              onClick={handleSubmitReview}
              disabled={reviewSubmitLoading || actionLoading}
              className="btn-primary flex items-center gap-1.5 text-sm"
              title={pendingReviewCount > 0 ? `${pendingReviewCount} sample chưa duyệt` : 'Submit review'}
            >
              {reviewSubmitLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Submit
            </button>
          ) : (
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${task?.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700'}`}>
              {task?.status === 'approved' ? <CheckCircle2 className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
              {task?.status === 'approved' ? 'Hoàn thành task' : task?.status === 'rework' ? 'Đã trả annotator' : 'Đã chốt'}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col xl:flex-row flex-1 min-h-0">
        <ReviewSampleListPanel
          samples={samples}
          currentIndex={currentSampleIndex}
          rejectionMap={rejectionMap}
          onNavigate={(i) => task && navigateSample(i, task)}
        />

        <div className="flex-1 min-w-0 flex flex-col bg-slate-50/50 min-h-[560px] xl:min-h-0">
          <div className="shrink-0 bg-white border-b border-surface-200 px-4 sm:px-6 py-2.5 flex items-center gap-4 overflow-x-auto">
            <div className="flex items-center gap-4 sm:gap-6 min-w-max">
              <ReviewStepDot step={1} active={!showApproveDialog && !showRejectDialog && !isAlreadyReviewed && !isReviewFinalized} done={isAlreadyReviewed || isReviewFinalized} label="Kiểm tra nhãn" />
              <div className="flex items-center gap-1 text-surface-300">
                <div className="w-6 h-px bg-surface-300" />
                <ChevronRight className="w-3 h-3" />
              </div>
              <ReviewStepDot step={2} active={showApproveDialog || showRejectDialog} done={isAlreadyReviewed || isReviewFinalized} label="Ra quyết định" />
              <div className="flex items-center gap-1 text-surface-300">
                <div className="w-6 h-px bg-surface-300" />
                <ChevronRight className="w-3 h-3" />
              </div>
              <ReviewStepDot step={3} active={pendingReviewCount === 0 && isReviewSubmitted} done={isReviewFinalized} label="Submit review" />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-5 sm:py-6">
            {sampleLoading ? (
              <div className="flex items-center justify-center h-full py-20">
                <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
              </div>
            ) : sampleDetail ? (
              <div className="max-w-4xl mx-auto">
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <h2 className="text-sm font-bold text-surface-700">Sample #{currentSampleIndex + 1}</h2>
                  <SampleStatusBadge status={currentSampleStatus} />
                  {isNewlyFixed && (
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700">
                      Mới sửa lại
                    </span>
                  )}
                  <div className="flex-1" />
                  <div className="flex items-center gap-3 text-xs text-surface-400 flex-wrap">
                    <span>{sampleDetail.content.length.toLocaleString()} ký tự</span>
                    <span>·</span>
                    <span>{reviewWordCount(sampleDetail.content).toLocaleString()} từ</span>
                    <span>·</span>
                    {isRelationExtraction ? (
                      <>
                        <span>{relationReviewData.entities.length} entities</span>
                        <span>·</span>
                        <span>{relationReviewData.relations.length} quan hệ</span>
                      </>
                    ) : (
                      <span>{sampleDetail.annotations.length} nhãn</span>
                    )}
                  </div>
                </div>

                {isClassification ? (
                  <ClassificationReviewTextPanel
                    content={sampleDetail.content}
                    annotations={sampleDetail.annotations}
                  />
                ) : isRelationExtraction ? (
                  <RelationReviewTextPanel
                    content={sampleDetail.content}
                    relationData={relationReviewData}
                  />
                ) : (
                  <div className="bg-white rounded-2xl border border-surface-200 shadow-subtle">
                    <div className="px-4 sm:px-8 py-5 sm:py-7">
                      <ReviewTextPanel
                        content={sampleDetail.content}
                        annotations={sampleDetail.annotations}
                      />
                    </div>
                    {sampleDetail.metadata && Object.keys(sampleDetail.metadata).length > 0 && (
                      <div className="px-6 py-3 border-t border-surface-100 bg-surface-50/60 flex items-center gap-4 flex-wrap rounded-b-2xl">
                        {Object.entries(sampleDetail.metadata).slice(0, 5).map(([k, v]) => (
                          <div key={k} className="flex items-center gap-1.5 text-xs text-surface-400">
                            <span className="font-semibold text-surface-500">{k}:</span>
                            <span>{String(v)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <ReviewBottomBar
            currentIndex={currentSampleIndex}
            total={samples.length}
            pendingReviewCount={pendingReviewCount}
            onBack={() => task && currentSampleIndex > 0 && navigateSample(currentSampleIndex - 1, task)}
            onRefresh={refreshSample}
            onNext={() => task && currentSampleIndex < samples.length - 1 && navigateSample(currentSampleIndex + 1, task)}
          />
        </div>

        <div className="w-full xl:w-72 xl:shrink-0 bg-white border-t xl:border-t-0 xl:border-l border-surface-200 flex flex-col overflow-hidden">
          {sampleDetail && (
            <ReviewPanel
              sampleDetail={sampleDetail}
              isClassification={isClassification}
              isRelationExtraction={isRelationExtraction}
              relationData={relationReviewData}
              isAlreadyReviewed={isAlreadyReviewed}
              sampleReviewDecision={sampleReviewDecision}
              isReviewFinalized={isReviewFinalized}
              taskStatus={task?.status || 'submitted'}
              isNewlyFixed={!!isNewlyFixed}
              rejectionContext={currentRejectionContext}
              actionLoading={actionLoading}
              showRejectDialog={showRejectDialog}
              rejectFeedback={rejectFeedback}
              showApproveDialog={showApproveDialog}
              approveFeedback={approveFeedback}
              onApproveClick={() => setShowApproveDialog(true)}
              onRejectClick={() => setShowRejectDialog(true)}
              onApproveConfirm={handleApprove}
              onRejectConfirm={handleReject}
              onRejectFeedbackChange={setRejectFeedback}
              onApproveFeedbackChange={setApproveFeedback}
              onCancelReject={() => { setShowRejectDialog(false); setRejectFeedback(''); }}
              onCancelApprove={() => { setShowApproveDialog(false); setApproveFeedback(''); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// REVIEW TEXT PANEL — Read-only
// ============================================================
function ReviewTextPanel({
  content,
  annotations,
}: {
  content: string;
  annotations: ReviewSampleDetail['annotations'];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const segments = useMemo(() => {
    if (annotations.length === 0) return [{ text: content, annotation: undefined }];
    const sorted = [...annotations].sort((a, b) => a.start_offset - b.start_offset);
    const segs: Array<{ text: string; annotation?: (typeof annotations)[0] }> = [];
    let cursor = 0;
    for (const ann of sorted) {
      if (ann.start_offset < cursor) continue;
      if (ann.start_offset > cursor) segs.push({ text: content.slice(cursor, ann.start_offset), annotation: undefined });
      segs.push({ text: content.slice(ann.start_offset, ann.end_offset), annotation: ann });
      cursor = ann.end_offset;
    }
    if (cursor < content.length) segs.push({ text: content.slice(cursor), annotation: undefined });
    return segs;
  }, [content, annotations]);

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
        <Clock className="w-4 h-4 text-amber-500 shrink-0" />
        <p className="text-xs text-amber-700 font-medium">
          Chế độ duyệt — chỉ xem. Duyệt hoặc từ chối ở bảng bên phải.
        </p>
      </div>

      <div ref={containerRef} className="text-[15px] leading-[2] text-gray-800 select-text">
        {segments.map((seg, i) =>
          seg.annotation ? (
            <mark
              key={i}
              style={{
                backgroundColor: `rgba(${hexToRgb(seg.annotation.label_color || '#4c6ef5')}, 0.18)`,
                borderBottom: `2px solid ${seg.annotation.label_color || '#4c6ef5'}`,
                borderRadius: '2px',
                padding: '1px 0',
                position: 'relative',
              }}
              className="group/mark cursor-default"
              title={seg.annotation.label_name || ''}
            >
              {seg.text}
              <span
                style={{ backgroundColor: seg.annotation.label_color || '#4c6ef5' }}
                className="absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded text-[10px] font-semibold text-white whitespace-nowrap opacity-0 group-hover/mark:opacity-100 transition-opacity pointer-events-none z-20 select-none"
              >
                {seg.annotation.label_name}
              </span>
            </mark>
          ) : (
            <span key={i}>{seg.text}</span>
          )
        )}
      </div>
    </div>
  );
}

function ClassificationReviewTextPanel({
  content,
  annotations,
}: {
  content: string;
  annotations: ReviewSampleDetail['annotations'];
}) {
  return (
    <div className="space-y-5">
      <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
        <Clock className="w-4 h-4 text-amber-500 shrink-0" />
        <p className="text-xs text-amber-700 font-medium">
          Chế độ duyệt — chỉ xem. Duyệt hoặc từ chối ở bảng bên phải.
        </p>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center">
            <BadgeCheck className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">Phân loại văn bản</p>
            <p className="text-xs text-gray-400">{content.length.toLocaleString()} ký tự</p>
          </div>
        </div>
        <span className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-white border border-gray-200 text-gray-500">
          {annotations.length} nhãn
        </span>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/70">
          {annotations.length === 0 ? (
            <p className="text-sm text-gray-400">Chưa chọn nhãn</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {annotations.map((ann) => {
                const color = ann.label_color || '#f59e0b';
                return (
                  <span
                    key={ann.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
                    style={{
                      backgroundColor: `rgba(${hexToRgb(color)}, 0.12)`,
                      color,
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                    {ann.label_name || 'Label'}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <div className="p-6">
          <p className="text-[15px] leading-8 text-gray-800 whitespace-pre-wrap break-words">
            {content}
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// RELATION REVIEW PANEL — read-only relation extraction view
// ============================================================
function RelationReviewTextPanel({
  content,
  relationData,
}: {
  content: string;
  relationData: RelationReviewData;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const entityRefs = useRef<Record<string, HTMLElement | null>>({});
  const drawableRelations = relationData.relations.filter((relation) => relation.headId && relation.tailId);

  return (
    <div className="space-y-4">
      <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
        <Clock className="w-4 h-4 text-amber-500 shrink-0" />
        <p className="text-xs text-amber-700 font-medium">
          Chế độ duyệt — chỉ xem. Kiểm tra entity, hướng quan hệ và nhãn quan hệ trước khi duyệt.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-surface-200 shadow-subtle p-5 relative" ref={containerRef}>
        {drawableRelations.length > 0 && (
          <RelationReviewArrows
            relations={drawableRelations}
            entityRefs={entityRefs}
            containerRef={containerRef}
          />
        )}
        <RelationReviewAnnotatedText
          content={content}
          entities={relationData.entities}
          entityRefs={entityRefs}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-surface-200 bg-white p-3">
          <div className="flex items-center gap-2 mb-2">
            <Hash className="w-3.5 h-3.5 text-surface-400" />
            <p className="text-[11px] font-semibold text-surface-500 uppercase tracking-wide">Entities</p>
            <span className="ml-auto text-[10px] font-bold text-surface-400 bg-surface-100 px-2 py-0.5 rounded-full">
              {relationData.entities.length}
            </span>
          </div>
          {relationData.entities.length === 0 ? (
            <p className="text-xs text-surface-400 py-2">Không có entity để duyệt.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {relationData.entities.map((entity) => (
                <span
                  key={entity.id}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold"
                  style={{
                    backgroundColor: `rgba(${hexToRgb(entity.color)}, 0.12)`,
                    color: entity.color,
                  }}
                >
                  <span className="truncate">{entity.text}</span>
                  <span className="text-[9px] opacity-60 shrink-0">{entity.label}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-surface-200 bg-white p-3">
          <div className="flex items-center gap-2 mb-2">
            <ExternalLink className="w-3.5 h-3.5 text-surface-400" />
            <p className="text-[11px] font-semibold text-surface-500 uppercase tracking-wide">Quan hệ</p>
            <span className="ml-auto text-[10px] font-bold text-surface-400 bg-surface-100 px-2 py-0.5 rounded-full">
              {relationData.relations.length}
            </span>
          </div>
          {relationData.relations.length === 0 ? (
            <p className="text-xs text-surface-400 py-2">Chưa có quan hệ nào.</p>
          ) : (
            <div className="space-y-2">
              {relationData.relations.map((relation) => (
                <div key={relation.id} className="rounded-lg border border-surface-200 bg-surface-50 p-2.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="min-w-0 truncate rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-surface-700 border border-surface-200">
                      {relation.headText || '?'}
                    </span>
                    <ChevronRight className="w-3 h-3 text-surface-400 shrink-0" />
                    <span className="min-w-0 truncate rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-surface-700 border border-surface-200">
                      {relation.tailText || '?'}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 min-w-0">
                    <div className="h-px flex-1 min-w-4" style={{ backgroundColor: relation.color }} />
                    <span
                      className="max-w-full truncate rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                      style={{ backgroundColor: relation.color }}
                    >
                      {relation.relationType}
                    </span>
                    <div className="h-px flex-1 min-w-4" style={{ backgroundColor: relation.color }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RelationReviewAnnotatedText({
  content,
  entities,
  entityRefs,
}: {
  content: string;
  entities: ReviewEntity[];
  entityRefs: MutableRefObject<Record<string, HTMLElement | null>>;
}) {
  const segments = useMemo(() => {
    const sorted = [...entities].sort((a, b) => a.start - b.start || a.end - b.end);
    const parts: Array<{ text: string; entity?: ReviewEntity }> = [];
    let cursor = 0;

    for (const entity of sorted) {
      if (entity.start < cursor || entity.start >= entity.end) continue;
      if (entity.start > cursor) parts.push({ text: content.slice(cursor, entity.start) });
      parts.push({ text: content.slice(entity.start, entity.end), entity });
      cursor = entity.end;
    }
    if (cursor < content.length) parts.push({ text: content.slice(cursor) });
    return parts.length > 0 ? parts : [{ text: content }];
  }, [content, entities]);

  return (
    <p className="text-[15px] leading-9 text-surface-800 select-text">
      {segments.map((segment, index) => {
        if (!segment.entity) return <span key={index}>{segment.text}</span>;
        const entity = segment.entity;
        return (
          <mark
            key={index}
            ref={(el) => { entityRefs.current[entity.id] = el; }}
            className="rounded px-1 not-italic font-semibold"
            style={{
              backgroundColor: `rgba(${hexToRgb(entity.color)}, 0.18)`,
              color: entity.color,
              outline: `1px solid rgba(${hexToRgb(entity.color)}, 0.32)`,
              outlineOffset: '1px',
            }}
            title={entity.label}
          >
            {segment.text}
            <sup className="ml-0.5 text-[9px] font-normal opacity-60">{entity.label}</sup>
          </mark>
        );
      })}
    </p>
  );
}

function RelationReviewArrows({
  relations,
  entityRefs,
  containerRef,
}: {
  relations: ReviewRelationLink[];
  entityRefs: MutableRefObject<Record<string, HTMLElement | null>>;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const [paths, setPaths] = useState<Array<{ d: string; color: string; label: string; lx: number; ly: number }>>([]);
  const [svgTop, setSvgTop] = useState(0);
  const [svgHeight, setSvgHeight] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updatePaths = () => {
      const cRect = container.getBoundingClientRect();
      const nextPaths: Array<{ d: string; color: string; label: string; lx: number; ly: number }> = [];
      let minY = Infinity;
      let maxY = -Infinity;

      relations.forEach((relation) => {
        if (!relation.headId || !relation.tailId) return;
        const headEl = entityRefs.current[relation.headId];
        const tailEl = entityRefs.current[relation.tailId];
        if (!headEl || !tailEl) return;

        const headRect = headEl.getBoundingClientRect();
        const tailRect = tailEl.getBoundingClientRect();
        const x1 = headRect.left + headRect.width / 2 - cRect.left;
        const y1 = headRect.top - cRect.top;
        const x2 = tailRect.left + tailRect.width / 2 - cRect.left;
        const y2 = tailRect.top - cRect.top;
        const arcHeight = Math.max(22, Math.min(96, Math.abs(x2 - x1) * 0.25));
        const midY = Math.min(y1, y2) - arcHeight;
        const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;

        minY = Math.min(minY, midY, y1, y2);
        maxY = Math.max(maxY, y1, y2);
        nextPaths.push({
          d,
          color: relation.color,
          label: relation.relationType,
          lx: (x1 + x2) / 2,
          ly: midY,
        });
      });

      if (nextPaths.length === 0 || minY === Infinity) {
        setPaths([]);
        return;
      }

      setSvgTop(minY - 6);
      setSvgHeight(maxY - minY + 12);
      setPaths(nextPaths);
    };

    const frame = window.requestAnimationFrame(updatePaths);
    window.addEventListener('resize', updatePaths);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updatePaths);
    };
  }, [relations, entityRefs, containerRef]);

  if (paths.length === 0) return null;

  return (
    <svg
      className="absolute left-0 pointer-events-none z-10"
      style={{ top: svgTop, height: svgHeight, width: '100%' }}
    >
      <defs>
        {paths.map((path, index) => (
          <marker key={index} id={`review-arr-${index}`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0 L0,7 L7,3.5 z" fill={path.color} />
          </marker>
        ))}
      </defs>
      {paths.map((path, index) => {
        const labelWidth = Math.max(42, path.label.length * 7);
        return (
          <g key={index}>
            <path d={path.d} fill="none" stroke={path.color} strokeWidth="1.5" markerEnd={`url(#review-arr-${index})`} />
            <rect
              x={path.lx - labelWidth / 2}
              y={path.ly - svgTop - 10}
              width={labelWidth}
              height={16}
              rx="4"
              fill={path.color}
              opacity={0.92}
            />
            <text x={path.lx} y={path.ly - svgTop + 1} textAnchor="middle" fill="white" fontSize="8" fontWeight="700">
              {path.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ============================================================
// REVIEW PANEL — Actions + history
// ============================================================
function ReviewPanel({
  sampleDetail,
  isClassification,
  isRelationExtraction,
  relationData,
  isAlreadyReviewed,
  sampleReviewDecision,
  isReviewFinalized,
  taskStatus,
  isNewlyFixed,
  rejectionContext,
  actionLoading,
  showRejectDialog,
  rejectFeedback,
  showApproveDialog,
  approveFeedback,
  onApproveClick,
  onRejectClick,
  onApproveConfirm,
  onRejectConfirm,
  onRejectFeedbackChange,
  onApproveFeedbackChange,
  onCancelReject,
  onCancelApprove,
}: {
  sampleDetail: ReviewSampleDetail;
  isClassification: boolean;
  isRelationExtraction: boolean;
  relationData: RelationReviewData;
  isAlreadyReviewed: boolean;
  sampleReviewDecision: 'approved' | 'rejected' | null;
  isReviewFinalized: boolean;
  taskStatus: string;
  isNewlyFixed: boolean;
  rejectionContext?: { feedback: string; reviewer_name: string | null; reviewed_at: string };
  actionLoading: boolean;
  showRejectDialog: boolean;
  rejectFeedback: string;
  showApproveDialog: boolean;
  approveFeedback: string;
  onApproveClick: () => void;
  onRejectClick: () => void;
  onApproveConfirm: () => void;
  onRejectConfirm: () => void;
  onRejectFeedbackChange: (v: string) => void;
  onApproveFeedbackChange: (v: string) => void;
  onCancelReject: () => void;
  onCancelApprove: () => void;
}) {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Newly fixed banner */}
      {isNewlyFixed && (
        <div className="mx-3 mt-3 flex items-start gap-2.5 p-3 rounded-xl bg-indigo-50 border border-indigo-200/60">
          <RefreshCw className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-indigo-700">Annotator vừa sửa lại sample này</p>
            {rejectionContext?.feedback && (
              <p className="text-[11px] text-indigo-600 mt-0.5 line-clamp-3">
                Lý do từ chối trước: "{rejectionContext.feedback}"
              </p>
            )}
          </div>
        </div>
      )}
      {/* Annotator info */}
      <div className="px-4 py-2.5 border-b border-gray-100">
        <div className="flex items-center gap-2 min-w-0">
          <User className="w-4 h-4 text-gray-400 shrink-0" />
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide shrink-0">Người đánh nhãn</span>
          <span className="ml-auto min-w-0 truncate text-sm font-medium text-gray-800">
            {sampleDetail.annotator_name || 'Không rõ'}
          </span>
        </div>
      </div>

      {/* Annotations summary */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center gap-2 mb-3">
          {isClassification ? (
            <BadgeCheck className="w-4 h-4 text-gray-400" />
          ) : isRelationExtraction ? (
            <ExternalLink className="w-4 h-4 text-gray-400" />
          ) : (
            <Hash className="w-4 h-4 text-gray-400" />
          )}
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            {isClassification ? 'Nhãn phân loại' : isRelationExtraction ? 'Thực thể & quan hệ' : 'Nhãn đã đánh'}
          </span>
          <span className="ml-auto text-xs text-gray-400">
            {isRelationExtraction
              ? `${relationData.entities.length}/${relationData.relations.length}`
              : sampleDetail.annotations.length}
          </span>
        </div>
        {isRelationExtraction ? (
          <div className="space-y-3 max-h-72 overflow-y-auto">
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Entities</p>
              {relationData.entities.length === 0 ? (
                <p className="text-xs text-gray-400 py-2">Không có entity</p>
              ) : (
                <div className="space-y-1.5">
                  {relationData.entities.map((entity) => (
                    <div
                      key={entity.id}
                      className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-gray-50"
                      style={{ borderLeft: `3px solid ${entity.color}` }}
                    >
                      <span className="w-3 h-3 rounded shrink-0" style={{ backgroundColor: entity.color }} />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate" style={{ color: entity.color }}>{entity.label}</p>
                        <p className="text-[12px] text-gray-700 truncate">"{entity.text}"</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Quan hệ</p>
              {relationData.relations.length === 0 ? (
                <p className="text-xs text-gray-400 py-2">Chưa có quan hệ</p>
              ) : (
                <div className="space-y-1.5">
                  {relationData.relations.map((relation) => (
                    <div
                      key={relation.id}
                      className="rounded-lg bg-gray-50 px-2.5 py-2"
                      style={{ borderLeft: `3px solid ${relation.color}` }}
                    >
                      <p className="text-xs font-semibold truncate" style={{ color: relation.color }}>
                        {relation.relationType}
                      </p>
                      <p className="text-[12px] text-gray-700 truncate">
                        {relation.headText || '?'} → {relation.tailText || '?'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : sampleDetail.annotations.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-3">Chưa có nhãn nào</p>
        ) : isClassification ? (
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {[...sampleDetail.annotations]
              .sort((a, b) => (a.label_name || '').localeCompare(b.label_name || ''))
              .map((ann) => {
                const color = ann.label_color || '#f59e0b';
                return (
                  <div
                    key={ann.id}
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-gray-50"
                    style={{ borderLeft: `3px solid ${color}` }}
                  >
                    <span className="w-3.5 h-3.5 rounded shrink-0" style={{ backgroundColor: color }} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color }}>
                        {ann.label_name || 'Label'}
                      </p>
                      <p className="text-[11px] text-gray-400">Toàn bộ văn bản</p>
                    </div>
                  </div>
                );
              })}
          </div>
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {[...sampleDetail.annotations]
              .sort((a, b) => a.start_offset - b.start_offset)
              .map((ann) => {
                const color = ann.label_color || '#4c6ef5';
                return (
                  <div
                    key={ann.id}
                    className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-gray-50"
                    style={{ borderLeft: `3px solid ${color}` }}
                  >
                    <div className="flex-1 min-w-0">
                      <span
                        className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: `rgba(${hexToRgb(color)}, 0.12)`, color }}
                      >
                        {ann.label_name || 'Label'}
                      </span>
                      <p className="text-[12px] text-gray-700 mt-1 line-clamp-2 leading-snug">
                        "{ann.selected_text}"
                      </p>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Review Actions */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center gap-2 mb-3">
          <Tag className="w-4 h-4 text-gray-400" />
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Quyết định duyệt</span>
        </div>

        {isReviewFinalized ? (
          <div className={`flex items-center gap-2 p-3 rounded-xl text-sm font-medium ${taskStatus === 'approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700'}`}>
            {taskStatus === 'approved' ? <CheckCircle2 className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
            {taskStatus === 'approved' ? 'Task đã hoàn thành' : 'Task đã chuyển lại cho annotator'}
          </div>
        ) : isAlreadyReviewed ? (
          <div className={`flex items-center gap-2 p-3 rounded-xl text-sm font-medium ${sampleReviewDecision === 'approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {sampleReviewDecision === 'approved' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {sampleReviewDecision === 'approved' ? 'Sample đã được duyệt' : 'Sample đã bị từ chối'}
          </div>
        ) : showApproveDialog ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <button onClick={onCancelApprove} className="w-20 shrink-0 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">
                Hủy
              </button>
              <button
                onClick={onApproveConfirm}
                disabled={actionLoading}
                className="min-w-0 flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
                <span className="truncate">Xác nhận duyệt</span>
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Ghi chú (không bắt buộc)
              </label>
              <textarea
                rows={3}
                value={approveFeedback}
                onChange={(e) => onApproveFeedbackChange(e.target.value)}
                placeholder="Nhận xét thêm cho annotator…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none outline-none focus:border-blue-400"
              />
            </div>
          </div>
        ) : showRejectDialog ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <button onClick={onCancelReject} className="w-20 shrink-0 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">
                Hủy
              </button>
              <button
                onClick={onRejectConfirm}
                disabled={actionLoading || !rejectFeedback.trim()}
                className="min-w-0 flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
                <span className="truncate">Xác nhận từ chối</span>
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Lý do từ chối <span className="text-red-400">*</span>
              </label>
              <textarea
                rows={3}
                value={rejectFeedback}
                onChange={(e) => onRejectFeedbackChange(e.target.value)}
                placeholder="Mô tả rõ lý do để annotator có thể sửa lại…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none outline-none focus:border-blue-400"
                autoFocus
              />
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={onApproveClick}
              disabled={actionLoading}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              Duyệt
            </button>
            <button
              onClick={onRejectClick}
              disabled={actionLoading}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50"
            >
              <XCircle className="w-4 h-4" />
              Từ chối
            </button>
          </div>
        )}
      </div>

      {/* Review History */}
      {sampleDetail.review_history.length > 0 && (
        <div className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-4 h-4 text-gray-400" />
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Lịch sử duyệt
            </span>
          </div>
          <div className="space-y-2">
            {[...sampleDetail.review_history]
              .sort((a, b) => new Date(b.reviewed_at).getTime() - new Date(a.reviewed_at).getTime())
              .map((r) => (
                <ReviewHistoryItem key={r.id} record={r} />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewStepDot({ step, active, done, label }: { step: number; active: boolean; done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-all"
        style={{
          backgroundColor: done ? '#10b981' : active ? '#3b82f6' : '#e5e7eb',
          color: done || active ? 'white' : '#9ca3af',
        }}
      >
        {done ? <CheckCircle2 className="w-3 h-3" /> : step}
      </div>
      <span className={`text-[11px] font-medium ${active ? 'text-blue-600' : done ? 'text-emerald-600' : 'text-gray-400'}`}>
        {label}
      </span>
    </div>
  );
}
function ReviewHistoryItem({ record }: { record: ReviewRecord }) {
  const isApproved = record.result === 'approved';
  return (
    <div className={`p-3 rounded-xl border ${
      isApproved ? 'border-emerald-200/60 bg-emerald-50/50' : 'border-orange-200/60 bg-orange-50/50'
    }`}>
      <div className="flex items-center gap-2 mb-1">
        {isApproved
          ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          : <XCircle className="w-3.5 h-3.5 text-red-500" />
        }
        <span className={`text-xs font-semibold ${isApproved ? 'text-emerald-700' : 'text-red-700'}`}>
          {isApproved ? 'Đã duyệt' : 'Đã từ chối'}
        </span>
        <span className="text-[10px] text-gray-400 ml-auto">
          {formatTime(record.reviewed_at)}
        </span>
      </div>
      {record.reviewer_name && (
        <p className="text-[11px] text-gray-500 mb-1 pl-5">bởi {record.reviewer_name}</p>
      )}
      {record.feedback && (
        <p className="text-xs text-gray-700 pl-5 italic">"{record.feedback}"</p>
      )}
    </div>
  );
}
