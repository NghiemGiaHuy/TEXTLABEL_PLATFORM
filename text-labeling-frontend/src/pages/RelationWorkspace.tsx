// src/pages/RelationWorkspace.tsx

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  Send,
  Trash2,
  Plus,
  Clock,
  Edit2,
  X,
  CheckCircle2,
  Hash,
} from 'lucide-react';
import { annotationApi } from '../api/annotationApi';
import { buildApiUrl } from '../api/apiConfig';
import { useAuthStore } from '../store/authStore';
import { useToast } from '../components/toastContext';
import { useConfirm } from '../components/ConfirmDialog';
import AIRelationSuggestionsPanel, {
  AIRelationSuggestButton,
} from '../components/AIRelationSuggestionsPanel';
import type {
  Annotation,
  AnnotationSampleResponse,
  EditableAIRelationSuggestion,
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

const IMPORTED_ENTITY_COLORS = [
  '#8B5CF6',
  '#F97316',
  '#10B981',
  '#3B82F6',
  '#EC4899',
  '#14B8A6',
  '#EAB308',
  '#EF4444',
];

interface Relation {
  id: string;
  headId: string;   // entity.id
  tailId: string;
  relationType: string;
  relLabelId: string;
  color: string;
  isAiAssisted?: boolean;
  aiModelName?: string;
  aiConfidence?: number;
}

interface TextSelection {
  startOffset: number;
  endOffset: number;
  selectedText: string;
}

type WorkspaceStep = 'entities' | 'relations';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function metadataArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function buildMetadataEntities(sample: AnnotationSampleResponse): Entity[] {
  const metadata = sample.metadata;
  if (!isRecord(metadata)) return [];
  const rawItems = [
    ...metadataArray(metadata.ner_annotations),
    ...metadataArray(metadata.annotations),
    ...metadataArray(metadata.entities),
  ];
  const seen = new Set<string>();

  return rawItems.flatMap((item, index): Entity[] => {
    if (!isRecord(item)) return [];
    const label = item.label ?? item.label_name ?? item.type ?? item.entity_label ?? item.name;
    const start = Number(item.start ?? item.start_offset ?? item.begin);
    const end = Number(item.end ?? item.end_offset ?? item.stop);
    if (typeof label !== 'string' || !Number.isFinite(start) || !Number.isFinite(end)) return [];
    if (start < 0 || end <= start || end > sample.content.length) return [];
    const key = `${start}:${end}:${label}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      id: `imported-${start}-${end}-${label}-${index}`,
      text: typeof item.text === 'string'
        ? item.text
        : typeof item.selected_text === 'string'
          ? item.selected_text
          : sample.content.slice(start, end),
      start,
      end,
      label,
      color: typeof item.label_color === 'string'
        ? item.label_color
        : typeof item.color === 'string'
          ? item.color
          : IMPORTED_ENTITY_COLORS[index % IMPORTED_ENTITY_COLORS.length],
    }];
  });
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
        isAiAssisted: rel.isAiAssisted ?? false,
        aiModelName: rel.aiModelName,
        aiConfidence: rel.aiConfidence,
      };
    })
    .filter((rel): rel is Relation => rel !== null);
}

type SampleStatus = 'pending' | 'annotated' | 'done' | 'submitted' | 'approved' | 'rejected' | 'rework';
type SampleStatusFilter = 'all' | 'pending' | 'annotated' | 'done' | 'rejected' | 'approved';

const STATUS_CFG: Record<SampleStatus, { label: string; bg: string; text: string; dot: string }> = {
  pending:   { label: 'Chưa làm',   bg: 'bg-surface-100', text: 'text-surface-500', dot: 'bg-surface-400' },
  annotated: { label: 'Đang làm',   bg: 'bg-blue-50',     text: 'text-blue-700',    dot: 'bg-blue-500'    },
  done:      { label: 'Đã xong',    bg: 'bg-emerald-50',  text: 'text-emerald-700', dot: 'bg-emerald-500' },
  submitted: { label: 'Đã xong',    bg: 'bg-emerald-50',  text: 'text-emerald-700', dot: 'bg-emerald-500' },
  approved:  { label: 'Đã duyệt',   bg: 'bg-emerald-50',  text: 'text-emerald-700', dot: 'bg-emerald-500' },
  rejected:  { label: 'Từ chối',    bg: 'bg-red-50',      text: 'text-red-700',     dot: 'bg-red-500'     },
  rework:    { label: 'Từ chối',    bg: 'bg-red-50',      text: 'text-red-700',     dot: 'bg-red-500'     },
};

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

function normalizeGroupName(name: string | null | undefined) {
  return (name ?? '').trim().toLowerCase();
}

function isNerLabel(label: LabelOption) {
  const groupName = normalizeGroupName(label.label_group_name);
  return groupName.includes('ner') || groupName.includes('entity') || groupName.includes('thực thể');
}

function isRelationLabel(label: LabelOption) {
  const groupName = normalizeGroupName(label.label_group_name);
  return groupName.includes('relation') || groupName.includes('quan hệ');
}

function hasLabelGroups(labels: LabelOption[]) {
  return labels.some((label) => Boolean(label.label_group_id || label.label_group_name));
}

function mergeEntities(primary: Entity[], secondary: Entity[]) {
  const seen = new Set<string>();
  const merged: Entity[] = [];

  for (const ent of [...primary, ...secondary]) {
    const key = `${ent.start}:${ent.end}:${ent.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(ent);
  }

  return merged.sort((a, b) => a.start - b.start || a.end - b.end);
}

// ─── Annotated text ────────────────────────────────────────────

function AnnotatedText({
  text,
  entities,
  selectedHead,
  selectedTail,
  onEntityClick,
  onSelectionChange,
  entityRefs,
  relationMode = false,
}: {
  text: string;
  entities: Entity[];
  selectedHead: string | null;
  selectedTail: string | null;
  onEntityClick: (e: Entity) => void;
  onSelectionChange?: (selection: TextSelection | null) => void;
  entityRefs: React.MutableRefObject<Record<string, HTMLElement | null>>;
  relationMode?: boolean;
}) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const sorted = [...entities].sort((a, b) => a.start - b.start);
  const parts: { text: string; entity?: Entity }[] = [];
  let cursor = 0;

  for (const ent of sorted) {
    if (ent.start > cursor) parts.push({ text: text.slice(cursor, ent.start) });
    parts.push({ text: text.slice(ent.start, ent.end), entity: ent });
    cursor = ent.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });

  const getTextOffset = (container: HTMLElement, node: Node, offset: number) => {
    let total = 0;
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(textNode) {
          const parent = textNode.parentElement;
          if (parent?.closest('[data-selection-ignore="true"]')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    let current = walker.nextNode();
    while (current) {
      const length = current.textContent?.length ?? 0;
      if (current === node) return total + Math.min(offset, length);
      total += length;
      current = walker.nextNode();
    }
    return null;
  };

  const handleSelection = () => {
    if (!onSelectionChange) return;
    const selection = window.getSelection();
    const container = textRef.current;
    if (!selection || !container || selection.rangeCount === 0 || selection.isCollapsed) {
      onSelectionChange(null);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      onSelectionChange(null);
      return;
    }

    const rawStart = getTextOffset(container, range.startContainer, range.startOffset);
    const rawEnd = getTextOffset(container, range.endContainer, range.endOffset);
    if (rawStart === null || rawEnd === null || rawStart === rawEnd) {
      onSelectionChange(null);
      return;
    }

    let startOffset = Math.min(rawStart, rawEnd);
    let endOffset = Math.max(rawStart, rawEnd);
    let selectedText = text.slice(startOffset, endOffset);
    const leadingSpace = selectedText.length - selectedText.trimStart().length;
    const trailingSpace = selectedText.length - selectedText.trimEnd().length;
    startOffset += leadingSpace;
    endOffset -= trailingSpace;
    selectedText = text.slice(startOffset, endOffset);

    onSelectionChange(
      selectedText
        ? { startOffset, endOffset, selectedText }
        : null
    );
  };

  return (
    <p
      ref={textRef}
      onMouseUp={handleSelection}
      onKeyUp={handleSelection}
      className="text-sm text-surface-800 leading-9 select-text"
    >
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
            onClick={(event) => {
              if (!relationMode) return;
              event.stopPropagation();
              onEntityClick(ent);
            }}
            className={`rounded px-1 not-italic font-semibold transition-all ${relationMode ? 'cursor-pointer' : 'cursor-default'}`}
            style={{
              backgroundColor: `rgba(${rgb}, 0.18)`,
              color: ent.color,
              outline: isHead ? `2px solid ${ent.color}` : isTail ? `2px dashed ${ent.color}` : 'none',
              outlineOffset: '2px',
            }}
            title={relationMode ? `${ent.label}${isHead ? ' [HEAD]' : isTail ? ' [TAIL]' : ''} — click để chọn` : ent.label}
          >
            {part.text}
            <sup data-selection-ignore="true" className="text-[9px] ml-0.5 font-normal opacity-60">{ent.label}</sup>
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
      const verticalPadding = 12;
      setSvgTop(minY - verticalPadding);
      setSvgHeight(maxY - minY + verticalPadding * 2);
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
          <path
            d={p.d}
            transform={`translate(0 ${-svgTop})`}
            fill="none"
            stroke={p.color}
            strokeWidth="1.5"
            markerEnd={`url(#arr-${p.id})`}
          />
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
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const { user } = useAuthStore();
  const projectIdParam = searchParams.get('projectId');
  const explicitViewMode = searchParams.get('mode') === 'view';
  const isAdmin = user?.roles?.some((role) => role.toLowerCase().includes('admin')) ?? false;

  const { sidebarOpen } = useOutletContext<{ sidebarOpen: boolean }>();

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [sampleData, setSampleData] = useState<AnnotationSampleResponse | null>(null);
  const [currentSampleIndex, setCurrentSampleIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [doneLoading, setDoneLoading] = useState(false);
  const [error, setError] = useState('');
  const [sampleNumberQuery, setSampleNumberQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<SampleStatusFilter>('all');

  // Per-sample relation state
  const [entities, setEntities] = useState<Entity[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [selectedHead, setSelectedHead] = useState<string | null>(null);
  const [selectedTail, setSelectedTail] = useState<string | null>(null);
  const [selectedRelLabelId, setSelectedRelLabelId] = useState('');
  const [editingRelId, setEditingRelId] = useState<string | null>(null);
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [workspaceStep, setWorkspaceStep] = useState<WorkspaceStep>('entities');
  const [aiSuggestions, setAISuggestions] = useState<EditableAIRelationSuggestion[]>([]);
  const [aiLoading, setAILoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const entityRefs = useRef<Record<string, HTMLElement | null>>({});

  const labelOptions: LabelOption[] = sampleData?.labels ?? [];
  const groupedLabels = hasLabelGroups(labelOptions);
  const nerLabelOptions = groupedLabels ? labelOptions.filter(isNerLabel) : [];
  const relTypeOptions: LabelOption[] = groupedLabels ? labelOptions.filter(isRelationLabel) : labelOptions;

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
      const dataHasGroups = hasLabelGroups(data.labels);
      const nerLabelIds = new Set(
        dataHasGroups
          ? data.labels.filter(isNerLabel).map((label) => label.id)
          : []
      );
      const currentEntityAnnotations = dataHasGroups
        ? data.annotations.filter((ann) => nerLabelIds.has(ann.label_id))
        : [];
      const importedEntities = buildMetadataEntities(data);
      const ents = mergeEntities(
        mergeEntities(
          buildEntities(currentEntityAnnotations),
          buildEntities(nerAnnotations)
        ),
        importedEntities
      );
      const restoredRelations = restoreRelations(data, ents);
      const draftData = data.draft?.draft_data as { entityStepSaved?: boolean } | undefined;
      setSampleData(data);
      setTask((prev) => prev ? {
        ...prev,
        task_samples: prev.task_samples.map((s) =>
          s.id === data.task_sample_id ? { ...s, status: data.status } : s
        ),
      } : prev);
      setEntities(ents);
      setRelations(restoredRelations);
      setSelectedHead(null);
      setSelectedTail(null);
      setSelectedRelLabelId('');
      setEditingRelId(null);
      setSelection(null);
      setWorkspaceStep(
        !dataHasGroups || importedEntities.length > 0 || draftData?.entityStepSaved || restoredRelations.length > 0
          ? 'relations'
          : 'entities'
      );
      entityRefs.current = {};
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
      const taskDetail = projectIdParam
        ? await annotationApi.getTask(projectIdParam, taskId).then((detail) => ({ ...detail, status: detail.task_status ?? detail.status }))
        : await fetchMyTask(taskId);
      if (!taskDetail) {
        setError('Không tìm thấy task này hoặc bạn không có quyền xem task');
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
      if (loadedTask.task_samples.length > 0) {
        setCurrentSampleIndex(0);
        await loadSample(taskId, loadedTask.task_samples[0]);
      }
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail ?? 'Không thể tải workspace');
    } finally {
      setLoading(false);
    }
  }, [taskId, projectIdParam, explicitViewMode, user?.id, isAdmin, loadSample]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadTask(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadTask]);

  // ── Navigate samples ────────────────────────────────────────
  const goTo = useCallback(async (idx: number) => {
    if (!task || !taskId) return;
    const clamped = Math.max(0, Math.min(idx, task.task_samples.length - 1));
    setAISuggestions([]);
    setCurrentSampleIndex(clamped);
    await loadSample(taskId, task.task_samples[clamped]);
  }, [task, taskId, loadSample]);

  const samples: TaskSample[] = task?.task_samples ?? [];
  const totalSamples = samples.length;
  const currentSample = samples[currentSampleIndex];
  const currentSampleStatus = currentSample?.status ?? 'pending';
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

  // ── Entity selection ────────────────────────────────────────
  const handleEntityClick = (ent: Entity) => {
    if (isReadOnly) return;
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
  const selectedRelLabel = relTypeOptions.find((l) => l.id === selectedRelLabelId);

  const handleAddRelation = () => {
    if (isReadOnly) return;
    if (!selectedHead || !selectedTail || !selectedRelLabel) return;
    const existing = editingRelId
      ? relations.find((relation) => relation.id === editingRelId)
      : undefined;
    const entry = {
      id: editingRelId ?? `rel-${Date.now()}`,
      headId: selectedHead,
      tailId: selectedTail,
      relationType: selectedRelLabel.name,
      relLabelId: selectedRelLabel.id,
      color: selectedRelLabel.color,
      isAiAssisted: existing?.isAiAssisted,
      aiModelName: existing?.aiModelName,
      aiConfidence: existing?.aiConfidence,
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
    if (isReadOnly) return;
    setSelectedHead(rel.headId);
    setSelectedTail(rel.tailId);
    setSelectedRelLabelId(rel.relLabelId);
    setEditingRelId(rel.id);
  };

  const handleDeleteRelation = (relId: string) => {
    if (isReadOnly) return;
    setRelations((prev) => prev.filter((r) => r.id !== relId));
    if (editingRelId === relId) {
      setEditingRelId(null);
      setSelectedHead(null);
      setSelectedTail(null);
      setSelectedRelLabelId('');
    }
  };

  // ── Ephemeral AI relation suggestions ──────────────────────
  const handleRequestAISuggestions = useCallback(async () => {
    if (isReadOnly || !sampleData || entities.length < 2 || relTypeOptions.length === 0) return;
    setAILoading(true);
    try {
      const response = await annotationApi.suggestByAI({
        task_type: 'relation_extraction',
        text: sampleData.content,
        labels: relTypeOptions.map((label) => label.name),
        entities: entities.map((entity) => ({
          id: entity.id,
          text: entity.text,
          label: entity.label,
          start: entity.start,
          end: entity.end,
        })),
      });
      const now = Date.now();
      const suggestions: EditableAIRelationSuggestion[] = response.suggestions.flatMap((suggestion, index) =>
        'relation' in suggestion && suggestion.head_id && suggestion.tail_id
          ? [{
              ...suggestion,
              id: `ai-relation-${now}-${index}`,
              head_id: suggestion.head_id,
              tail_id: suggestion.tail_id,
              accepted: false,
              model_name: response.model_name,
            }]
          : []
      );
      setAISuggestions(suggestions);
      if (suggestions.length === 0) {
        showToast('info', 'Gemini không tìm thấy quan hệ phù hợp');
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast('error', e.response?.data?.detail || 'Không thể lấy gợi ý AI');
    } finally {
      setAILoading(false);
    }
  }, [isReadOnly, sampleData, entities, relTypeOptions, showToast]);

  const handleChangeAISuggestion = useCallback((
    id: string,
    patch: Partial<EditableAIRelationSuggestion>
  ) => {
    setAISuggestions((previous) => previous.map((suggestion) => {
      if (suggestion.id !== id) return suggestion;
      const headId = patch.head_id ?? suggestion.head_id;
      const tailId = patch.tail_id ?? suggestion.tail_id;
      return {
        ...suggestion,
        ...patch,
        head: entities.find((entity) => entity.id === headId)?.text ?? suggestion.head,
        tail: entities.find((entity) => entity.id === tailId)?.text ?? suggestion.tail,
      };
    }));
  }, [entities]);

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

  const handleAddAcceptedAISuggestions = useCallback(() => {
    if (isReadOnly) return;
    const accepted = aiSuggestions.filter((suggestion) => suggestion.accepted);
    if (accepted.length === 0) return;
    const additions: Relation[] = [];
    for (const suggestion of accepted) {
      const label = relTypeOptions.find((option) => option.name === suggestion.relation);
      if (!label || suggestion.head_id === suggestion.tail_id) continue;
      const duplicate = [...relations, ...additions].some((relation) =>
        relation.headId === suggestion.head_id
        && relation.tailId === suggestion.tail_id
        && relation.relLabelId === label.id
      );
      if (duplicate) continue;
      additions.push({
        id: `rel-ai-${Date.now()}-${additions.length}`,
        headId: suggestion.head_id,
        tailId: suggestion.tail_id,
        relationType: label.name,
        relLabelId: label.id,
        color: label.color,
        isAiAssisted: true,
        aiModelName: suggestion.model_name,
        aiConfidence: suggestion.confidence,
      });
    }
    setRelations((previous) => [...previous, ...additions]);
    setAISuggestions((previous) => previous.filter((suggestion) => !suggestion.accepted));
    showToast('success', 'Đã đưa gợi ý AI vào bản nháp.');
  }, [isReadOnly, aiSuggestions, relTypeOptions, relations, showToast]);

  const handleCreateEntity = useCallback(async (label: LabelOption) => {
    if (isReadOnly || !taskId || !task || !selection) return;
    const sample = task.task_samples[currentSampleIndex];
    if (!sample) return;

    const overlaps = entities.some((ent) =>
      Math.max(ent.start, selection.startOffset) < Math.min(ent.end, selection.endOffset)
    );
    if (overlaps) {
      showToast('error', 'Vùng text này đã trùng với entity khác');
      return;
    }

    setSaving(true);
    try {
      await annotationApi.createAnnotation(taskId, sample.id, {
        label_id: label.id,
        start_offset: selection.startOffset,
        end_offset: selection.endOffset,
        selected_text: selection.selectedText,
      });
      window.getSelection()?.removeAllRanges();
      setSelection(null);
      showToast('success', 'Đã thêm entity');
      await loadSample(taskId, sample);
    } catch {
      showToast('error', 'Không thể thêm entity');
    } finally {
      setSaving(false);
    }
  }, [isReadOnly, taskId, task, currentSampleIndex, selection, entities, loadSample, showToast]);

  const handleEntityStepSave = useCallback(async (showMessage = true) => {
    if (isReadOnly || !taskId || !task || !sampleData) return;
    const sample = task.task_samples[currentSampleIndex];
    if (!sample) return;

    setSaving(true);
    try {
      await annotationApi.saveDraft(taskId, sample.id, {
        ...(sampleData.draft?.draft_data ?? {}),
        kind: 'relation_extraction',
        entityStepSaved: true,
        relations,
      });
      setWorkspaceStep('relations');
      setSelection(null);
      if (showMessage) showToast('success', 'Đã lưu entity, tiếp tục gán quan hệ');
    } catch {
      showToast('error', 'Lưu thất bại');
    } finally {
      setSaving(false);
    }
  }, [isReadOnly, taskId, task, sampleData, currentSampleIndex, relations, showToast]);

  // ── Save relation annotations for this sample ───────────────
  const handleSave = useCallback(async () => {
    if (isReadOnly || !taskId || !task || !sampleData) return;
    const sampleId = task.task_samples[currentSampleIndex]?.id;
    if (!sampleId) return;
    setSaving(true);
    try {
      const payload = relations.flatMap((rel) => {
        const head = entities.find((e) => e.id === rel.headId);
        const tail = entities.find((e) => e.id === rel.tailId);
        if (!head || !tail) return [];
        return {
          label_id: rel.relLabelId,
          start_offset: Math.min(head.start, tail.start),
          end_offset: Math.max(head.end, tail.end),
          selected_text: `${head.text} -> ${tail.text}`,
          is_ai_assisted: rel.isAiAssisted ?? false,
          ai_model_name: rel.aiModelName,
          ai_confidence: rel.aiConfidence,
        };
      });

      const relationLabelIds = new Set(relTypeOptions.map((label) => label.id));
      const existingRelationAnnotations = sampleData.annotations.filter((ann) =>
        relationLabelIds.has(ann.label_id)
      );
      for (const ann of existingRelationAnnotations) {
        await annotationApi.deleteAnnotation(taskId, sampleId, ann.id);
      }
      for (const annotation of payload) {
        await annotationApi.createAnnotation(taskId, sampleId, annotation);
      }

      await annotationApi.saveDraft(taskId, sampleId, {
        kind: 'relation_extraction',
        entityStepSaved: true,
        relations,
      });
      showToast('success', 'Đã lưu quan hệ');
      await loadSample(taskId, task.task_samples[currentSampleIndex]);
    } catch {
      showToast('error', 'Lưu thất bại');
    } finally {
      setSaving(false);
    }
  }, [isReadOnly, taskId, task, sampleData, currentSampleIndex, relations, entities, relTypeOptions, loadSample, showToast]);

  const handleClearLabels = useCallback(async () => {
    if (isReadOnly || !taskId || !task || !sampleData) return;
    const sample = task.task_samples[currentSampleIndex];
    if (!sample) return;
    if (sampleData.annotations.length === 0 && relations.length === 0) return;

    setSaving(true);
    try {
      for (const ann of sampleData.annotations) {
        await annotationApi.deleteAnnotation(taskId, sample.id, ann.id);
      }

      await annotationApi.saveDraft(taskId, sample.id, {
        ...(sampleData.draft?.draft_data ?? {}),
        kind: 'relation_extraction',
        entityStepSaved: false,
        relations: [],
      });

      setEntities([]);
      setRelations([]);
      setSelectedHead(null);
      setSelectedTail(null);
      setSelectedRelLabelId('');
      setEditingRelId(null);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
      await loadSample(taskId, sample);
      showToast('success', 'Đã xoá nhãn NER và quan hệ');
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast('error', e?.response?.data?.detail || 'Xoá nhãn thất bại');
    } finally {
      setSaving(false);
    }
  }, [isReadOnly, taskId, task, sampleData, currentSampleIndex, relations.length, loadSample, showToast]);

  // ── Mark sample done/undone ─────────────────────────────────
  const handleMarkDone = useCallback(async () => {
    if (isReadOnly || !taskId || !task) return;
    const sample = task.task_samples[currentSampleIndex];
    if (!sample) return;
    const newStatus: 'annotated' | 'done' = sample.status === 'done' ? 'annotated' : 'done';
    setDoneLoading(true);
    try {
      if (newStatus === 'done') {
        if (workspaceStep === 'entities') {
          await handleEntityStepSave(false);
        } else {
          await handleSave();
        }
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
  }, [isReadOnly, taskId, task, currentSampleIndex, workspaceStep, handleEntityStepSave, handleSave, showToast]);

  // ── Submit task ─────────────────────────────────────────────
  const handleSubmit = async () => {
    if (isReadOnly || !taskId) return;
    if (!await confirm('Nộp task này để review?', { title: 'Nộp task', confirmText: 'Nộp' })) return;
    setSubmitLoading(true);
    try {
      const currentSample = task?.task_samples[currentSampleIndex];
      const currentSampleComplete = ['done', 'submitted', 'approved'].includes(currentSample?.status ?? '');
      if (!currentSampleComplete) {
        if (workspaceStep === 'entities') {
          await handleEntityStepSave(false);
        } else {
          await handleSave();
        }
      }
      await annotationApi.submitTask(taskId);
      showToast('success', 'Đã chuyển task cho reviewer');
      navigate(-1);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      const detail = e.response?.data?.detail || 'Nộp thất bại';
      showToast('error', typeof detail === 'string' ? detail : JSON.stringify(detail));
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

  const doneCount = samples.filter((s) => isSampleProcessed(s.status)).length;
  const sampleNumber = Number(sampleNumberQuery.trim());
  const hasSampleNumber = sampleNumberQuery.trim() !== '';

  const filteredSamples = samples
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => {
      const numberMatches = !hasSampleNumber
        || (Number.isInteger(sampleNumber) && sampleNumber === i + 1);
      const statusMatches = statusFilter === 'all'
        || getSampleStatusFilter(s.status) === statusFilter;
      return numberMatches && statusMatches;
    });

  const headEntity = entities.find((e) => e.id === selectedHead);
  const tailEntity = entities.find((e) => e.id === selectedTail);
  const canClearLabels = Boolean(sampleData && (sampleData.annotations.length > 0 || relations.length > 0));

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
        {canEditTask && !isSubmitted ? (
          <button
            onClick={handleSubmit}
            disabled={submitLoading || saving}
            className="btn-primary flex items-center justify-center gap-1.5 text-sm"
          >
            {submitLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Nộp task
          </button>
        ) : (
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${
            isSubmitted
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-surface-100 text-surface-600'
          }`}>
            <CheckCircle2 className="w-4 h-4" />
            {isSubmitted ? 'Đã nộp' : 'Chỉ xem'}
          </div>
        )}
      </div>

      {/* ── Main 3-panel layout ──────────────────────────────── */}
      <div className="flex flex-col xl:flex-row flex-1 min-h-0">

        {/* LEFT: Sample list */}
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
            ) : filteredSamples.map(({ s, i }) => {
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
                    {(s.content ?? '').slice(0, 50)}{(s.content ?? '').length > 50 ? '...' : ''}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* CENTER: Text with entity highlights + arrows */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden min-h-[560px] xl:min-h-0">
          <div className="flex-1 overflow-y-auto px-4 pt-4 sm:px-6 sm:pt-6 min-h-0">
            {sampleData ? (
              <div className="max-w-4xl mx-auto min-h-full flex flex-col">
                {/* Sample header */}
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
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
                  <div className="flex items-center gap-2">
                    {workspaceStep === 'relations' && (
                      <button
                        onClick={() => {
                          setWorkspaceStep('entities');
                          setSelectedHead(null);
                          setSelectedTail(null);
                          setSelectedRelLabelId('');
                          setEditingRelId(null);
                        }}
                        disabled={saving || isReadOnly}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-surface-200 text-surface-600 hover:bg-surface-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        NER label
                      </button>
                    )}
                    {workspaceStep === 'entities' && (
                      <button
                        onClick={() => void handleEntityStepSave()}
                        disabled={saving || isReadOnly}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-surface-200 text-surface-600 hover:bg-surface-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      >
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        Lưu NER label
                      </button>
                    )}
                  </div>
                </div>

                {/* Instruction */}
                <div className="bg-brand-50 border border-brand-100 rounded-xl px-4 py-2.5 text-xs text-brand-700">
                  {workspaceStep === 'entities' ? (
                    <>
                      Bôi đen text gốc, chọn nhãn NER ở panel phải, rồi nhấn <strong>Lưu NER label</strong> để chuyển sang gán quan hệ.
                    </>
                  ) : (
                    <>
                      Click vào <strong>entity đầu (HEAD)</strong> trước, rồi click <strong>entity đuôi (TAIL)</strong>,
                      chọn loại quan hệ ở panel phải, rồi nhấn <strong>Thêm quan hệ</strong>.
                    </>
                  )}
                </div>

                <div className="flex-1 flex items-center py-4 sm:py-6">
                  {/* Text with entity highlights */}
                  <div className="w-full bg-white rounded-2xl border border-surface-200 shadow-subtle p-5 relative" ref={containerRef}>
                    {workspaceStep === 'relations' && entities.length === 0 && (
                      <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                        Không có entity nào. Sample này cần được gán nhãn NER trước.
                      </div>
                    )}
                    {relations.length > 0 && workspaceStep === 'relations' && (
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
                      onSelectionChange={workspaceStep === 'entities' && !isReadOnly ? setSelection : undefined}
                      entityRefs={entityRefs}
                      relationMode={workspaceStep === 'relations' && !isReadOnly}
                    />
                  </div>
                </div>
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
                  onClick={() => void handleClearLabels()}
                  disabled={!canClearLabels || saving || isReadOnly}
                  className="flex shrink-0 items-center justify-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg border border-surface-200 text-sm font-medium text-surface-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Xoá nhãn
                </button>

                <button
                  onClick={handleMarkDone}
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
        <div className={`w-full xl:shrink-0 min-h-0 overflow-y-auto xl:overflow-hidden xl:flex xl:flex-col bg-white border-t xl:border-t-0 xl:border-l border-surface-200 transition-[width] duration-200 ${sidebarOpen ? 'xl:w-72' : 'xl:w-[360px]'}`}>
          {workspaceStep === 'entities' ? (
            <>
              <div className="px-4 py-3 border-b border-surface-100">
                <h2 className="text-sm font-semibold text-surface-800">Gán entity</h2>
                <p className="text-xs text-surface-400 mt-0.5">Bôi đen text rồi chọn nhãn NER</p>
              </div>

              <div className="p-4 space-y-4 xl:flex-1 xl:min-h-0 xl:overflow-y-auto">
                <div className="rounded-xl border border-surface-200 bg-surface-50 p-3">
                  <p className="text-xs font-semibold text-surface-500 uppercase tracking-wide mb-2">
                    Text đã chọn
                  </p>
                  {selection ? (
                    <p className="text-sm font-medium text-surface-800 leading-6">"{selection.selectedText}"</p>
                  ) : (
                    <p className="text-xs text-surface-400 italic">Chưa chọn text</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-surface-500 mb-1.5 uppercase tracking-wide">
                    Nhãn NER
                  </label>
                  {nerLabelOptions.length === 0 ? (
                    <p className="text-xs text-surface-400 italic">Chưa có nhãn NER được cấu hình.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {nerLabelOptions.map((opt) => (
                        <button
                          key={opt.id}
                          onClick={() => void handleCreateEntity(opt)}
                          disabled={!selection || saving || isReadOnly}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border disabled:opacity-40 disabled:cursor-not-allowed"
                          style={selection && !saving
                            ? { backgroundColor: opt.color, borderColor: opt.color, color: 'white' }
                            : { borderColor: '#e2e8f0', color: opt.color, backgroundColor: 'white' }
                          }
                        >
                          {opt.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {entities.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <p className="text-xs font-semibold text-surface-500 uppercase tracking-wide">Entity đã gán</p>
                      <span className="px-1.5 py-0.5 rounded-full bg-surface-100 text-surface-500 text-[10px] font-bold">{entities.length}</span>
                    </div>
                    <div className="space-y-2">
                      {entities.map((ent) => (
                        <div key={ent.id} className="rounded-xl border border-surface-200 bg-surface-50 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-surface-800 truncate">{ent.text}</span>
                            <span
                              className="px-2 py-0.5 rounded-md font-semibold text-white text-[11px] shrink-0"
                              style={{ backgroundColor: ent.color }}
                            >
                              {ent.label}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
          <div className="px-4 py-3 border-b border-surface-100 bg-white flex justify-center xl:shrink-0">
            <AIRelationSuggestButton
              entitiesCount={entities.length}
              labelsCount={relTypeOptions.length}
              loading={aiLoading}
              disabled={isReadOnly || saving}
              onSuggest={() => void handleRequestAISuggestions()}
            />
          </div>

          <div className="p-4 space-y-4 xl:flex-1 xl:min-h-0 xl:overflow-y-auto">
            <AIRelationSuggestionsPanel
              suggestions={aiSuggestions}
              entities={entities}
              labels={relTypeOptions}
              loading={aiLoading}
              disabled={isReadOnly || saving}
              showSuggestButton={false}
              onSuggest={() => void handleRequestAISuggestions()}
              onChange={handleChangeAISuggestion}
              onToggleAccept={handleToggleAcceptAISuggestion}
              onReject={handleRejectAISuggestion}
              onAddAccepted={handleAddAcceptedAISuggestions}
            />
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
                    <button
                      onClick={clear}
                      disabled={isReadOnly}
                      className="text-surface-400 hover:text-surface-700 shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
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
                      disabled={isReadOnly}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border ${
                        selectedRelLabelId === opt.id
                          ? 'text-white border-transparent'
                          : 'bg-white border-surface-200 text-surface-600 hover:border-surface-300'
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
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
              disabled={!selectedHead || !selectedTail || !selectedRelLabelId || isReadOnly}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={
                selectedHead && selectedTail && selectedRelLabelId && !isReadOnly
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
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className="px-2 py-0.5 rounded-md font-semibold text-white text-[11px] min-w-0 truncate"
                                style={{ backgroundColor: head?.color ?? '#6366F1' }}
                              >
                                {head?.text ?? '?'}
                              </span>
                              <ChevronRight className="w-3 h-3 text-surface-400 shrink-0" />
                              <span
                                className="px-2 py-0.5 rounded-md font-semibold text-white text-[11px] min-w-0 truncate"
                                style={{ backgroundColor: tail?.color ?? '#F97316' }}
                              >
                                {tail?.text ?? '?'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => handleEditRelation(rel)}
                                disabled={isReadOnly}
                                className="p-1 rounded text-surface-400 hover:text-brand-600 hover:bg-brand-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => handleDeleteRelation(rel.id)}
                                disabled={isReadOnly}
                                className="p-1 rounded text-surface-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="h-px flex-1 min-w-4" style={{ backgroundColor: rel.color }} />
                            <span
                              className="max-w-full truncate text-[10px] font-bold px-2 py-1 rounded-full text-white"
                              style={{ backgroundColor: rel.color }}
                            >
                              {rel.relationType}
                            </span>
                            {rel.isAiAssisted && (
                              <span className="text-[9px] font-bold uppercase tracking-wide text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                                AI
                              </span>
                            )}
                            <div className="h-px flex-1 min-w-4" style={{ backgroundColor: rel.color }} />
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
