// src/pages/RelationWorkspace.tsx

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  Send,
  Trash2,
  Plus,
  Search,
  Clock,
  Edit2,
  X,
  CheckCircle2,
} from 'lucide-react';
import { annotationApi } from '../api/annotationApi';
import { buildApiUrl } from '../api/apiConfig';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import type {
  Annotation,
  AnnotationSampleResponse,
  LabelOption,
  TaskDetail,
  TaskSample,
} from '../types';

// ─── Local types ───────────────────────────────────────────────

interface Entity {
  id: string;       // annotation.id from the loaded NER annotations
  text: string;
  start: number;
  end: number;
  label: string;
  color: string;
}

interface Relation {
  id: string;
  headId: string;   // entity.id
  tailId: string;
  relationType: string;
  relLabelId: string;
  color: string;
}

function buildEntities(annotations: Annotation[]): Entity[] {
  return annotations
    .filter((ann) => ann.start_offset < ann.end_offset)
    .map((ann) => ({
      id: ann.id,
      text: ann.selected_text,
      start: ann.start_offset,
      end: ann.end_offset,
      label: ann.label_name ?? '',
      color: ann.label_color ?? '#6366F1',
    }));
}

function restoreRelations(
  sample: AnnotationSampleResponse,
  entities: Entity[]
): Relation[] {
  const rawRelations = sample.draft?.draft_data?.relations;
  const draftRelations: unknown[] = Array.isArray(rawRelations)
    ? rawRelations
    : [];
  const entityIds = new Set(entities.map((ent) => ent.id));
  const labelById = new Map(sample.labels.map((label) => [label.id, label]));

  return draftRelations
    .map((item: unknown): Relation | null => {
      const rel = item as Partial<Relation>;
      if (
        !rel.id ||
        !rel.headId ||
        !rel.tailId ||
        !rel.relLabelId ||
        !entityIds.has(rel.headId) ||
        !entityIds.has(rel.tailId)
      ) {
        return null;
      }

      const label = labelById.get(rel.relLabelId);
      return {
        id: rel.id,
        headId: rel.headId,
        tailId: rel.tailId,
        relLabelId: rel.relLabelId,
        relationType: label?.name ?? rel.relationType ?? '',
        color: label?.color ?? rel.color ?? '#10B981',
      };
    })
    .filter((rel): rel is Relation => rel !== null);
}

type SampleStatus = 'pending' | 'annotated' | 'done' | 'submitted' | 'approved' | 'rejected' | 'rework';

const STATUS_CFG: Record<SampleStatus, { label: string; bg: string; text: string; dot: string }> = {
  pending:   { label: 'Chưa làm',   bg: 'bg-surface-100', text: 'text-surface-500', dot: 'bg-surface-400' },
  annotated: { label: 'Đang làm',   bg: 'bg-blue-50',     text: 'text-blue-700',    dot: 'bg-blue-500'    },
  done:      { label: 'Đã xong',    bg: 'bg-emerald-50',  text: 'text-emerald-700', dot: 'bg-emerald-500' },
  submitted: { label: 'Đã xong',    bg: 'bg-emerald-50',  text: 'text-emerald-700', dot: 'bg-emerald-500' },
  approved:  { label: 'Đã duyệt',   bg: 'bg-emerald-50',  text: 'text-emerald-700', dot: 'bg-emerald-500' },
  rejected:  { label: 'Từ chối',    bg: 'bg-red-50',      text: 'text-red-700',     dot: 'bg-red-500'     },
  rework:    { label: 'Từ chối',    bg: 'bg-red-50',      text: 'text-red-700',     dot: 'bg-red-500'     },
};

function isSampleProcessed(status: string) {
  return !['pending', 'todo'].includes(status);
}

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

// ─── Annotated text ────────────────────────────────────────────

function AnnotatedText({
  text,
  entities,
  selectedHead,
  selectedTail,
  onEntityClick,
  entityRefs,
}: {
  text: string;
  entities: Entity[];
  selectedHead: string | null;
  selectedTail: string | null;
  onEntityClick: (e: Entity) => void;
  entityRefs: React.MutableRefObject<Record<string, HTMLElement | null>>;
}) {
  const sorted = [...entities].sort((a, b) => a.start - b.start);
  const parts: { text: string; entity?: Entity }[] = [];
  let cursor = 0;

  for (const ent of sorted) {
    if (ent.start > cursor) parts.push({ text: text.slice(cursor, ent.start) });
    parts.push({ text: text.slice(ent.start, ent.end), entity: ent });
    cursor = ent.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });

  return (
    <p className="text-sm text-surface-800 leading-9 select-text">
      {parts.map((part, i) => {
        if (!part.entity) return <span key={i}>{part.text}</span>;
        const ent = part.entity;
        const isHead = selectedHead === ent.id;
        const isTail = selectedTail === ent.id;
        const rgb = hexToRgb(ent.color);
        return (
          <mark
            key={i}
            ref={(el) => { entityRefs.current[ent.id] = el; }}
            onClick={() => onEntityClick(ent)}
            className="rounded px-1 not-italic font-semibold cursor-pointer transition-all"
            style={{
              backgroundColor: `rgba(${rgb}, 0.18)`,
              color: ent.color,
              outline: isHead ? `2px solid ${ent.color}` : isTail ? `2px dashed ${ent.color}` : 'none',
              outlineOffset: '2px',
            }}
            title={`${ent.label}${isHead ? ' [HEAD]' : isTail ? ' [TAIL]' : ''} — click để chọn`}
          >
            {part.text}
            <sup className="text-[9px] ml-0.5 font-normal opacity-60">{ent.label}</sup>
          </mark>
        );
      })}
    </p>
  );
}

// ─── SVG arc arrows between entities ──────────────────────────

function RelationArrows({
  relations,
  entities,
  entityRefs,
  containerRef,
}: {
  relations: Relation[];
  entities: Entity[];
  entityRefs: React.MutableRefObject<Record<string, HTMLElement | null>>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [paths, setPaths] = useState<{ id: string; d: string; color: string; label: string; lx: number; ly: number }[]>([]);
  const [svgTop, setSvgTop] = useState(0);
  const [svgHeight, setSvgHeight] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    const newPaths: typeof paths = [];
    let minY = Infinity;
    let maxY = -Infinity;

    for (const rel of relations) {
      const hEl = entityRefs.current[rel.headId];
      const tEl = entityRefs.current[rel.tailId];
      if (!hEl || !tEl) continue;
      const hR = hEl.getBoundingClientRect();
      const tR = tEl.getBoundingClientRect();
      const x1 = hR.left + hR.width / 2 - cRect.left;
      const y1 = hR.top - cRect.top;
      const x2 = tR.left + tR.width / 2 - cRect.left;
      const y2 = tR.top - cRect.top;
      const arcHeight = Math.max(20, Math.abs(x2 - x1) * 0.3);
      const midY = Math.min(y1, y2) - arcHeight;
      minY = Math.min(minY, midY, y1, y2);
      maxY = Math.max(maxY, y1, y2);
      const lx = (x1 + x2) / 2;
      const ly = midY;
      const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
      newPaths.push({ id: rel.id, d, color: rel.color, label: rel.relationType, lx, ly });
    }

    if (newPaths.length > 0 && minY < Infinity) {
      setSvgTop(minY - 4);
      setSvgHeight(maxY - minY + 8);
    }
    setPaths(newPaths);
  }, [relations, entities, entityRefs, containerRef]);

  if (paths.length === 0) return null;

  return (
    <svg
      className="absolute left-0 pointer-events-none"
      style={{ top: svgTop, height: svgHeight, width: '100%' }}
    >
      <defs>
        {paths.map((p) => (
          <marker key={p.id} id={`arr-${p.id}`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0 L0,7 L7,3.5 z" fill={p.color} />
          </marker>
        ))}
      </defs>
      {paths.map((p) => (
        <g key={p.id}>
          <path d={p.d} fill="none" stroke={p.color} strokeWidth="1.5" markerEnd={`url(#arr-${p.id})`} />
          <rect
            x={p.lx - p.label.length * 3.5}
            y={p.ly - svgTop - 9}
            width={p.label.length * 7}
            height={14}
            rx="4"
            fill={p.color}
            opacity={0.9}
          />
          <text x={p.lx} y={p.ly - svgTop + 1} textAnchor="middle" fill="white" fontSize="8" fontWeight="700">
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ─── Main component ────────────────────────────────────────────

export default function RelationWorkspace() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [sampleData, setSampleData] = useState<AnnotationSampleResponse | null>(null);
  const [currentSampleIndex, setCurrentSampleIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [doneLoading, setDoneLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  // Per-sample relation state
  const [entities, setEntities] = useState<Entity[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [selectedHead, setSelectedHead] = useState<string | null>(null);
  const [selectedTail, setSelectedTail] = useState<string | null>(null);
  const [selectedRelLabelId, setSelectedRelLabelId] = useState('');
  const [editingRelId, setEditingRelId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const entityRefs = useRef<Record<string, HTMLElement | null>>({});

  // ── Fetch task via my-tasks list ────────────────────────────
  async function fetchMyTask(tid: string): Promise<TaskDetail | null> {
    try {
      const res = await fetch(
        buildApiUrl('/api/v1/annotations/my-tasks?page_size=100'),
        { headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` } }
      );
      const myTasks = await res.json();
      const found = myTasks.tasks?.find((t: TaskDetail) => t.id === tid);
      if (!found) return null;
      const detail = await annotationApi.getTask(found.project_id, tid);
      return { ...detail, status: detail.task_status ?? detail.status };
    } catch {
      return null;
    }
  }

  const loadSample = useCallback(async (tid: string, sample: TaskSample) => {
    try {
      const [data, nerAnnotations] = await Promise.all([
        annotationApi.getSample(tid, sample.id),
        annotationApi.getSampleEntities(tid, sample.id),
      ]);
      const ents = buildEntities(nerAnnotations);
      setSampleData(data);
      setTask((prev) => prev ? {
        ...prev,
        task_samples: prev.task_samples.map((s) =>
          s.id === data.task_sample_id ? { ...s, status: data.status } : s
        ),
      } : prev);
      setEntities(ents);
      setRelations(restoreRelations(data, ents));
      setSelectedHead(null);
      setSelectedTail(null);
      setSelectedRelLabelId('');
      setEditingRelId(null);
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail ?? 'Không thể tải sample');
    }
  }, []);

  const loadTask = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    setError('');
    try {
      try { await annotationApi.startTask(taskId); } catch { /* already started */ }
      const taskDetail = await fetchMyTask(taskId);
      if (!taskDetail) {
        setError('Không tìm thấy task này trong danh sách của bạn');
        return;
      }
      setTask(taskDetail);
      if (taskDetail.task_samples.length > 0) {
        setCurrentSampleIndex(0);
        await loadSample(taskId, taskDetail.task_samples[0]);
      }
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail ?? 'Không thể tải workspace');
    } finally {
      setLoading(false);
    }
  }, [taskId, loadSample]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadTask(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadTask]);

  // ── Navigate samples ────────────────────────────────────────
  const goTo = useCallback(async (idx: number) => {
    if (!task || !taskId) return;
    const clamped = Math.max(0, Math.min(idx, task.task_samples.length - 1));
    setCurrentSampleIndex(clamped);
    await loadSample(taskId, task.task_samples[clamped]);
  }, [task, taskId, loadSample]);

  // ── Entity selection ────────────────────────────────────────
  const handleEntityClick = (ent: Entity) => {
    if (!selectedHead || (selectedHead && selectedTail)) {
      setSelectedHead(ent.id);
      setSelectedTail(null);
    } else if (selectedHead === ent.id) {
      setSelectedHead(null);
    } else {
      setSelectedTail(ent.id);
    }
  };

  // ── Add / update relation ───────────────────────────────────
  const selectedRelLabel = sampleData?.labels.find((l) => l.id === selectedRelLabelId);

  const handleAddRelation = () => {
    if (!selectedHead || !selectedTail || !selectedRelLabel) return;
    const entry = {
      id: editingRelId ?? `rel-${Date.now()}`,
      headId: selectedHead,
      tailId: selectedTail,
      relationType: selectedRelLabel.name,
      relLabelId: selectedRelLabel.id,
      color: selectedRelLabel.color,
    };
    if (editingRelId) {
      setRelations((prev) => prev.map((r) => r.id === editingRelId ? entry : r));
      setEditingRelId(null);
    } else {
      setRelations((prev) => [...prev, entry]);
    }
    setSelectedHead(null);
    setSelectedTail(null);
    setSelectedRelLabelId('');
  };

  const handleEditRelation = (rel: Relation) => {
    setSelectedHead(rel.headId);
    setSelectedTail(rel.tailId);
    setSelectedRelLabelId(rel.relLabelId);
    setEditingRelId(rel.id);
  };

  const handleDeleteRelation = (relId: string) => {
    setRelations((prev) => prev.filter((r) => r.id !== relId));
    if (editingRelId === relId) {
      setEditingRelId(null);
      setSelectedHead(null);
      setSelectedTail(null);
      setSelectedRelLabelId('');
    }
  };

  // ── Save (bulk replace annotations for this sample) ─────────
  const handleSave = useCallback(async () => {
    if (!taskId || !task || !sampleData) return;
    const sampleId = task.task_samples[currentSampleIndex]?.id;
    if (!sampleId) return;
    setSaving(true);
    try {
      // Save relations as annotations: head_start → tail_end span with relation label
      const payload = relations.flatMap((rel) => {
        const head = entities.find((e) => e.id === rel.headId);
        const tail = entities.find((e) => e.id === rel.tailId);
        if (!head || !tail) return [];
        return {
          label_id: rel.relLabelId,
          start_offset: Math.min(head.start, tail.start),
          end_offset: Math.max(head.end, tail.end),
          selected_text: `${head?.text ?? ''} → ${tail?.text ?? ''}`,
        };
      });
      await annotationApi.bulkUpdateAnnotations(taskId, sampleId, payload);
      await annotationApi.saveDraft(taskId, sampleId, {
        kind: 'relation_extraction',
        relations,
      });
      showToast('success', 'Đã lưu quan hệ');
      await loadSample(taskId, task.task_samples[currentSampleIndex]);
    } catch {
      showToast('error', 'Lưu thất bại');
    } finally {
      setSaving(false);
    }
  }, [taskId, task, sampleData, currentSampleIndex, relations, entities, loadSample, showToast]);

  // ── Mark sample done/undone ─────────────────────────────────
  const handleMarkDone = useCallback(async () => {
    if (!taskId || !task) return;
    const sample = task.task_samples[currentSampleIndex];
    if (!sample) return;
    const newStatus: 'annotated' | 'done' = sample.status === 'done' ? 'annotated' : 'done';
    setDoneLoading(true);
    try {
      if (newStatus === 'done' && relations.length > 0) {
        await handleSave();
      }
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
      showToast('error', e?.response?.data?.detail || 'Không thể cập nhật trạng thái');
    } finally {
      setDoneLoading(false);
    }
  }, [taskId, task, currentSampleIndex, relations.length, handleSave, showToast]);

  // ── Submit task ─────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!taskId) return;
    if (!await confirm('Nộp task này để review?', { title: 'Nộp task', confirmText: 'Nộp' })) return;
    setSubmitLoading(true);
    try {
      await handleSave();
      await annotationApi.submitTask(taskId);
      showToast('success', 'Đã chuyển task cho reviewer');
      navigate(-1);
    } catch {
      showToast('error', 'Nộp task thất bại');
    } finally {
      setSubmitLoading(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-64px)]">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-64px)] gap-4">
        <AlertCircle className="w-10 h-10 text-red-400" />
        <p className="text-surface-600">{error || 'Không tải được dữ liệu'}</p>
        <button onClick={() => navigate(-1)} className="btn-ghost">Quay lại</button>
      </div>
    );
  }

  const samples: TaskSample[] = task.task_samples;
  const totalSamples = samples.length;
  const doneCount = samples.filter((s) => isSampleProcessed(s.status)).length;
  const relTypeOptions: LabelOption[] = sampleData?.labels ?? [];

  const filteredSamples = samples
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !search || (s.content ?? '').toLowerCase().includes(search.toLowerCase()));

  const headEntity = entities.find((e) => e.id === selectedHead);
  const tailEntity = entities.find((e) => e.id === selectedTail);

  return (
    <div className="-m-6 flex flex-col min-h-[calc(100vh-64px)] xl:h-[calc(100vh-64px)] bg-surface-50 xl:overflow-hidden">
      {ConfirmDialog}

      {/* ── Top bar ─────────────────────────────────────────── */}
      <div className="bg-white border-b border-surface-200 px-3 sm:px-5 py-3 flex flex-col md:flex-row md:items-center gap-3 md:gap-4 shrink-0">
        <Link
          to={`/projects/${task.project_id}`}
          className="flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-800 transition-colors shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          Quay lại
        </Link>
        <div className="h-4 w-px bg-surface-200" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-surface-900 truncate">Relation Extraction</p>
          <p className="text-xs text-surface-400">Project: {task.project_id.slice(0, 8)}…</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-surface-500 md:ml-auto">
          <span className="font-medium">{doneCount}/{totalSamples}</span>
          <span>đã xử lý</span>
          <div className="w-24 h-1.5 bg-surface-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full transition-all"
              style={{ width: `${totalSamples > 0 ? (doneCount / totalSamples) * 100 : 0}%` }}
            />
          </div>
        </div>
        <button
          onClick={handleSubmit}
          disabled={submitLoading || saving}
          className="btn-primary flex items-center justify-center gap-1.5 text-sm"
        >
          {submitLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Nộp task
        </button>
      </div>

      {/* ── Main 3-panel layout ──────────────────────────────── */}
      <div className="flex flex-col xl:flex-row flex-1 min-h-0">

        {/* LEFT: Sample list */}
        <div className="w-full xl:w-64 xl:shrink-0 bg-white border-b xl:border-b-0 xl:border-r border-surface-200 flex flex-col max-h-72 xl:max-h-none">
          <div className="p-3 border-b border-surface-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-400" />
              <input
                type="text"
                placeholder="Tìm kiếm..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-surface-200 focus:outline-none focus:ring-2 focus:ring-brand-300 bg-surface-50"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredSamples.map(({ s, i }) => {
              const cfg = STATUS_CFG[s.status as SampleStatus] ?? STATUS_CFG.pending;
              const isActive = i === currentSampleIndex;
              return (
                <button
                  key={s.id}
                  onClick={() => goTo(i)}
                  className={`w-full text-left px-3 py-2.5 border-b border-surface-100 transition-colors ${
                    isActive ? 'bg-brand-50 border-l-2 border-l-brand-500' : 'hover:bg-surface-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-surface-700 truncate">
                        {(s.content ?? '').slice(0, 55)}{(s.content ?? '').length > 55 ? '…' : ''}
                      </p>
                      <div className={`mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${cfg.bg} ${cfg.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                        {cfg.label}
                      </div>
                    </div>
                    <span className="text-[10px] text-surface-400 shrink-0 mt-0.5">#{i + 1}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="p-3 border-t border-surface-100 flex items-center justify-between">
            <button
              onClick={() => goTo(currentSampleIndex - 1)}
              disabled={currentSampleIndex === 0}
              className="p-1.5 rounded-lg border border-surface-200 text-surface-500 hover:bg-surface-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs text-surface-500 font-medium">{currentSampleIndex + 1} / {totalSamples}</span>
            <button
              onClick={() => goTo(currentSampleIndex + 1)}
              disabled={currentSampleIndex >= totalSamples - 1}
              className="p-1.5 rounded-lg border border-surface-200 text-surface-500 hover:bg-surface-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* CENTER: Text with entity highlights + arrows */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden min-h-[560px] xl:min-h-0">
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 min-h-0">
            {sampleData ? (
              <div className="max-w-4xl mx-auto space-y-4">
                {/* Sample header */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-surface-400 uppercase tracking-wide">
                      Sample #{currentSampleIndex + 1}
                    </span>
                    {(() => {
                      const cfg = STATUS_CFG[sampleData.status as SampleStatus] ?? STATUS_CFG.pending;
                      return (
                        <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${cfg.bg} ${cfg.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                          {cfg.label}
                        </span>
                      );
                    })()}
                  </div>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-surface-200 text-surface-600 hover:bg-surface-50 transition-colors disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    Lưu
                  </button>
                </div>

                {/* Instruction */}
                <div className="bg-brand-50 border border-brand-100 rounded-xl px-4 py-2.5 text-xs text-brand-700">
                  Click vào <strong>entity đầu (HEAD)</strong> trước, rồi click <strong>entity đuôi (TAIL)</strong>,
                  chọn loại quan hệ ở panel phải, rồi nhấn <strong>Thêm quan hệ</strong>.
                </div>

                {/* Text with entity highlights */}
                <div className="bg-white rounded-2xl border border-surface-200 shadow-subtle p-5 relative" ref={containerRef}>
                  {entities.length === 0 ? (
                    <div className="space-y-3">
                      <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                        Không có entity nào. Sample này cần được gán nhãn NER trước.
                      </div>
                      <p className="text-sm text-surface-700 leading-8">{sampleData.content}</p>
                    </div>
                  ) : (
                    <>
                      {relations.length > 0 && (
                        <RelationArrows
                          relations={relations}
                          entities={entities}
                          entityRefs={entityRefs}
                          containerRef={containerRef}
                        />
                      )}
                      <AnnotatedText
                        text={sampleData.content}
                        entities={entities}
                        selectedHead={selectedHead}
                        selectedTail={selectedTail}
                        onEntityClick={handleEntityClick}
                        entityRefs={entityRefs}
                      />
                    </>
                  )}
                </div>

                {/* Entity chip legend */}
                {entities.length > 0 && (
                  <div className="bg-white rounded-xl border border-surface-200 p-3">
                    <p className="text-[11px] font-semibold text-surface-400 uppercase tracking-wide mb-2">
                      Entities ({entities.length}) — click để chọn HEAD/TAIL
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {entities.map((ent) => {
                        const isHead = selectedHead === ent.id;
                        const isTail = selectedTail === ent.id;
                        const rgb = hexToRgb(ent.color);
                        return (
                          <button
                            key={ent.id}
                            onClick={() => handleEntityClick(ent)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all"
                            style={{
                              backgroundColor: `rgba(${rgb}, 0.15)`,
                              color: ent.color,
                              outline: isHead ? `2px solid ${ent.color}` : isTail ? `2px dashed ${ent.color}` : 'none',
                              outlineOffset: '1px',
                            }}
                          >
                            {isHead && <span className="text-[9px] font-black mr-0.5 bg-current text-white rounded px-0.5">H</span>}
                            {isTail && <span className="text-[9px] font-black mr-0.5 bg-current text-white rounded px-0.5">T</span>}
                            {ent.text}
                            <span className="text-[9px] opacity-50 ml-0.5">{ent.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-surface-400 text-sm">
                Chọn sample để bắt đầu
              </div>
            )}
          </div>

          {/* Bottom bar */}
          {(() => {
            const currentSample = samples[currentSampleIndex];
            const isDone = currentSample?.status === 'done';
            const canMarkDone = Boolean(currentSample);
            return (
              <div className="shrink-0 bg-white border-t border-surface-200 px-3 sm:px-6 py-3 flex flex-nowrap items-center gap-2 sm:gap-3 overflow-x-auto">
                <button
                  onClick={() => goTo(currentSampleIndex - 1)}
                  disabled={currentSampleIndex === 0}
                  className="flex shrink-0 items-center justify-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg border border-surface-200 text-sm font-medium text-surface-600 hover:bg-surface-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Quay lại
                </button>

                <button
                  onClick={() => {
                    setRelations([]);
                    setSelectedHead(null);
                    setSelectedTail(null);
                    setSelectedRelLabelId('');
                  }}
                  disabled={relations.length === 0}
                  className="flex shrink-0 items-center justify-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg border border-surface-200 text-sm font-medium text-surface-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Xoá nhãn
                </button>

                <button
                  onClick={handleMarkDone}
                  disabled={!canMarkDone || doneLoading}
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
                  onClick={() => goTo(currentSampleIndex + 1)}
                  disabled={currentSampleIndex >= totalSamples - 1}
                  className="flex shrink-0 items-center justify-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg border border-surface-200 text-sm font-medium text-surface-600 hover:bg-surface-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Tiếp theo
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            );
          })()}
        </div>

        {/* RIGHT: Relation editor */}
        <div className="w-full xl:w-72 xl:shrink-0 bg-white border-t xl:border-t-0 xl:border-l border-surface-200 flex flex-col">
          <div className="px-4 py-3 border-b border-surface-100">
            <h2 className="text-sm font-semibold text-surface-800">Gán quan hệ</h2>
            <p className="text-xs text-surface-400 mt-0.5">Chọn HEAD → TAIL → loại quan hệ</p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* HEAD / TAIL pickers */}
            <div className="space-y-2">
              {[
                { label: 'HEAD', entity: headEntity, clear: () => setSelectedHead(null) },
                { label: 'TAIL', entity: tailEntity, clear: () => setSelectedTail(null) },
              ].map(({ label, entity, clear }) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="w-10 text-[11px] font-bold text-surface-400 uppercase shrink-0">{label}</span>
                  <div
                    className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-colors ${
                      entity ? 'font-medium' : 'border-dashed border-surface-200 text-surface-400'
                    }`}
                    style={entity
                      ? { borderColor: entity.color, color: entity.color, backgroundColor: `rgba(${hexToRgb(entity.color)}, 0.08)` }
                      : {}
                    }
                  >
                    {entity ? (
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate">{entity.text}</span>
                        <span className="text-[10px] opacity-60 shrink-0">{entity.label}</span>
                      </div>
                    ) : (
                      <span className="text-xs">Click entity {label === 'HEAD' ? 'đầu' : 'đuôi'}…</span>
                    )}
                  </div>
                  {entity && (
                    <button onClick={clear} className="text-surface-400 hover:text-surface-700 shrink-0">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Relation type */}
            <div>
              <label className="block text-xs font-semibold text-surface-500 mb-1.5 uppercase tracking-wide">
                Loại quan hệ
              </label>
              {relTypeOptions.length === 0 ? (
                <p className="text-xs text-surface-400 italic">Không có nhãn quan hệ nào được cấu hình.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {relTypeOptions.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setSelectedRelLabelId(opt.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border ${
                        selectedRelLabelId === opt.id
                          ? 'text-white border-transparent'
                          : 'bg-white border-surface-200 text-surface-600 hover:border-surface-300'
                      }`}
                      style={selectedRelLabelId === opt.id ? { backgroundColor: opt.color, borderColor: opt.color } : {}}
                    >
                      {opt.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Add / update button */}
            <button
              onClick={handleAddRelation}
              disabled={!selectedHead || !selectedTail || !selectedRelLabelId}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={
                selectedHead && selectedTail && selectedRelLabelId
                  ? { backgroundColor: '#10B981', color: 'white' }
                  : { backgroundColor: '#f1f5f9', color: '#94a3b8' }
              }
            >
              <Plus className="w-4 h-4" />
              {editingRelId ? 'Cập nhật quan hệ' : 'Thêm quan hệ'}
            </button>

            {/* Relations list */}
            {relations.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-xs font-semibold text-surface-500 uppercase tracking-wide">Quan hệ đã gán</p>
                  <span className="px-1.5 py-0.5 rounded-full bg-surface-100 text-surface-500 text-[10px] font-bold">{relations.length}</span>
                </div>
                <div className="space-y-2">
                  {relations.map((rel) => {
                    const head = entities.find((e) => e.id === rel.headId);
                    const tail = entities.find((e) => e.id === rel.tailId);
                    const isEditing = editingRelId === rel.id;
                    return (
                      <div
                        key={rel.id}
                        className={`rounded-xl border p-3 transition-all ${
                          isEditing ? 'border-brand-300 bg-brand-50' : 'border-surface-200 bg-surface-50'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className="px-2 py-0.5 rounded-md font-semibold text-white text-[11px] shrink-0"
                            style={{ backgroundColor: head?.color ?? '#6366F1' }}
                          >
                            {head?.text ?? '?'}
                          </span>
                          <div className="flex flex-col items-center flex-1 min-w-0">
                            <span
                              className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white mb-0.5 truncate max-w-full"
                              style={{ backgroundColor: rel.color }}
                            >
                              {rel.relationType}
                            </span>
                            <div className="flex w-full items-center">
                              <div className="flex-1 h-px" style={{ backgroundColor: rel.color }} />
                              <svg width="5" height="5" viewBox="0 0 5 5" style={{ color: rel.color }}>
                                <path d="M0 0 L5 2.5 L0 5 Z" fill="currentColor" />
                              </svg>
                            </div>
                          </div>
                          <span
                            className="px-2 py-0.5 rounded-md font-semibold text-white text-[11px] shrink-0"
                            style={{ backgroundColor: tail?.color ?? '#F97316' }}
                          >
                            {tail?.text ?? '?'}
                          </span>
                          <div className="flex items-center gap-1 ml-1 shrink-0">
                            <button
                              onClick={() => handleEditRelation(rel)}
                              className="p-1 rounded text-surface-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => handleDeleteRelation(rel.id)}
                              className="p-1 rounded text-surface-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {relations.length === 0 && entities.length > 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Clock className="w-8 h-8 text-surface-300" />
                <p className="text-xs text-surface-400">Chưa có quan hệ nào.<br />Click entity để bắt đầu.</p>
              </div>
            )}

            {entities.length === 0 && sampleData && (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <AlertCircle className="w-8 h-8 text-amber-400" />
                <p className="text-xs text-surface-400">Sample này chưa có entity.<br />Cần gán nhãn NER trước.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
