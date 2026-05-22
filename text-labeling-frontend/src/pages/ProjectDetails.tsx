// src/pages/ProjectDetails.tsx

import React, { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import {
  ArrowLeft,
  Plus,
  X,
  Database,
  ClipboardList,
  Users,
  Upload,
  Shuffle,
  Loader2,
  AlertCircle,
  Calendar,
  ChevronDown,
  Trash2,
  UserPlus,
  Tag,
  Download,
  FileDown,
  Eye,
  RotateCcw,
  LayoutDashboard,
  FileText,
  HardDrive,
  CheckCircle2,
  Clock,
  TrendingUp,
  Check,
  Pencil,
  Info,
  UserCheck,
  ChevronRight,
  Minus,
  BadgeCheck,
  ExternalLink,
} from 'lucide-react';
import { projectApi } from '../api/projectApi';
import { taskApi } from '../api/taskApi';
import { userApi } from '../api/userApi';
import { labelApi, type LabelSetData } from '../api/labelApi';
import { useToast } from '../components/Toast';
import type {
  Project,
  Dataset,
  DataSample,
  Task,
  TaskDetail,
  ProjectMember,
  AdminUser,
} from '../types';
import Modal from '../components/Modal';
import { useConfirm } from '../components/ConfirmDialog';

function extractErrorMessage(err: unknown, fallback = 'Có lỗi xảy ra'): string {
  const e = err as { response?: { data?: { detail?: unknown } } };
  const detail = e?.response?.data?.detail;
  if (Array.isArray(detail)) return detail.map((d: { msg?: string }) => d.msg || String(d)).join('; ');
  if (typeof detail === 'string') return detail;
  if (err instanceof Error) return err.message;
  return fallback;
}

// ─── Status badge (reused) ──────────────────────────────────
const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  not_started: { bg: 'bg-surface-100', text: 'text-surface-600', dot: 'bg-surface-400', label: 'Chưa làm' },
  active:      { bg: 'bg-blue-50',     text: 'text-blue-700',    dot: 'bg-blue-500',    label: 'Đang hoạt động' },
  completed:   { bg: 'bg-emerald-50',  text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Hoàn thành' },
  draft:       { bg: 'bg-surface-100', text: 'text-surface-600', dot: 'bg-surface-400', label: 'Chưa làm' },
  archived:    { bg: 'bg-amber-50',    text: 'text-amber-700',   dot: 'bg-amber-500',   label: 'Lưu trữ' },
  todo:        { bg: 'bg-surface-100', text: 'text-surface-600', dot: 'bg-surface-400', label: 'Chờ làm' },
  in_progress: { bg: 'bg-blue-50',     text: 'text-blue-700',    dot: 'bg-blue-500',    label: 'Đang làm' },
  submitted:   { bg: 'bg-emerald-50',  text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Đã xong' },
  rework:      { bg: 'bg-orange-50',   text: 'text-orange-700',  dot: 'bg-orange-500',  label: 'Cần sửa lại' },
  approved:    { bg: 'bg-emerald-50',  text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Đã duyệt' },
  rejected:    { bg: 'bg-red-50',      text: 'text-red-700',     dot: 'bg-red-500',     label: 'Từ chối' },
  ready:       { bg: 'bg-emerald-50',  text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Ready' },
  importing:   { bg: 'bg-blue-50',     text: 'text-blue-700',    dot: 'bg-blue-500',    label: 'Importing' },
  error:       { bg: 'bg-red-50',      text: 'text-red-700',     dot: 'bg-red-500',     label: 'Error' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.not_started;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
function getTaskLifecycleStatus(task: Pick<Task, 'status' | 'task_status'>): string {
  return task.task_status ?? task.status;
}

function isApprovedTask(task: Pick<Task, 'status' | 'task_status'>): boolean {
  return getTaskLifecycleStatus(task) === 'approved';
}

// ─── Tab types ──────────────────────────────────────────────
type TabKey = 'overview' | 'data_type' | 'labels' | 'datasets' | 'tasks' | 'reviews' | 'completed_tasks' | 'assign';
type BadgeVariant = 'red' | 'green' | undefined;

const PROJECT_DETAIL_REFRESH_MS = 30_000;
const DATASET_PROGRESS_REFRESH_MS = 10_000;
const PROJECT_DETAIL_TABS: TabKey[] = ['overview', 'data_type', 'datasets', 'labels', 'assign', 'tasks', 'reviews', 'completed_tasks'];

function isProjectDetailTab(value: string | null): value is TabKey {
  return PROJECT_DETAIL_TABS.includes(value as TabKey);
}

// ─── Main Component ─────────────────────────────────────────
export default function ProjectDetails() {
  const { id: projectId } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();
  const { user } = useAuthStore();
  const tabParam = searchParams.get('tab');
  const activeTab: TabKey = isProjectDetailTab(tabParam) ? tabParam : 'overview';

  const [project, setProject] = useState<Project | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [labelSets, setLabelSets] = useState<LabelSetData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const hasProjectSnapshotRef = useRef(false);

  // Modal states
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [showAddLabel, setShowAddLabel] = useState(false);

  // ─── Fetch all data ─────────────────────────────────────
  const fetchAll = useCallback(async (options?: { silent?: boolean }) => {
    if (!projectId) return;
    const silent = options?.silent ?? false;
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const [proj, ds, ts, mem, ls] = await Promise.allSettled([
        projectApi.getProject(projectId),
        taskApi.getDatasets(projectId),
        taskApi.getTasks(projectId, { page_size: 100 }),
        taskApi.getMembers(projectId),
        labelApi.getLabelSets(projectId),
      ]);
      if (proj.status === 'rejected') {
        throw proj.reason;
      }

      setProject(proj.value);
      hasProjectSnapshotRef.current = true;
      if (ds.status === 'fulfilled') setDatasets(ds.value.datasets);
      if (ts.status === 'fulfilled') setTasks(ts.value.tasks);
      if (mem.status === 'fulfilled') setMembers(mem.value.members);
      if (ls.status === 'fulfilled') setLabelSets(ls.value.label_sets);
      setError('');
    } catch (err: any) {
      if (!silent && !hasProjectSnapshotRef.current) {
        setError(extractErrorMessage(err, 'Failed to load project'));
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [projectId]);

  const refreshDatasets = useCallback(async () => {
    if (!projectId) return;
    try {
      const ds = await taskApi.getDatasets(projectId);
      setDatasets(ds.datasets);
    } catch {
      // Keep the current table visible if a background refresh fails.
    }
  }, [projectId]);

  const selectTab = useCallback((tab: TabKey) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', tab);
    setSearchParams(nextParams);
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    fetchAll();
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchAll({ silent: true });
      }
    };
    const intervalId = setInterval(
      refreshWhenVisible,
      PROJECT_DETAIL_REFRESH_MS,
    );
    return () => clearInterval(intervalId);
  }, [fetchAll]);

  useEffect(() => {
    if (activeTab !== 'datasets') return;
    void refreshDatasets();
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshDatasets();
      }
    };
    const intervalId = setInterval(
      refreshWhenVisible,
      DATASET_PROGRESS_REFRESH_MS,
    );
    return () => clearInterval(intervalId);
  }, [activeTab, refreshDatasets]);

  // ─── Loading / Error ────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
        <span className="ml-2.5 text-sm text-surface-500">Loading project…</span>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
        <p className="text-sm text-surface-600 mb-3">{error || 'Project not found'}</p>
        <Link to="/projects" className="btn-ghost text-brand-600">
          ← Back to Projects
        </Link>
      </div>
    );
  }

  const totalLabels = labelSets.reduce((sum, ls) => sum + ls.labels.length, 0);
  const totalSamples = project.total_samples ?? datasets.reduce((sum, ds) => sum + ds.total_samples, 0);

  const pendingReviewCount = tasks.filter((t) => getTaskLifecycleStatus(t) === 'submitted').length;
  const approvedTaskCount = tasks.filter(isApprovedTask).length;

  // ─── Role-aware badge computation ───────────────────────
  const myProjectRole = user
    ? members.find((m) => m.user_id === user.id)?.role_in_project
    : undefined;

  const myAssignedTasks = tasks.filter((t) => t.assignee_id === user?.id);
  const tasksBadge: BadgeVariant =
    myProjectRole === 'annotator'
      ? myAssignedTasks.some((t) => ['todo', 'in_progress', 'rework'].includes(t.status))
        ? 'red'
        : myAssignedTasks.length > 0 &&
          myAssignedTasks.every((t) => ['submitted', 'approved'].includes(getTaskLifecycleStatus(t)))
        ? 'green'
        : undefined
      : undefined;

  const isReviewer = myProjectRole === 'reviewer' || myProjectRole === 'project_owner';
  const reviewsBadge: BadgeVariant = isReviewer && pendingReviewCount > 0 ? 'red' : undefined;
  const completedTasksBadge: BadgeVariant = approvedTaskCount > 0 ? 'green' : undefined;

  // ─── Tab config ─────────────────────────────────────────
  const tabs: Array<{ key: TabKey; label: string; icon: typeof Database; dot?: BadgeVariant }> = [
    { key: 'overview',  label: 'Tổng quan',     icon: LayoutDashboard },
    { key: 'data_type', label: 'Loại dữ liệu',  icon: FileText        },
    { key: 'datasets',  label: 'Dataset',        icon: Database        },
    { key: 'labels',    label: 'Cấu hình', icon: Tag             },
    { key: 'assign',    label: 'Phân công',      icon: UserCheck       },
    { key: 'tasks',     label: 'Annotate',       icon: ClipboardList,  dot: tasksBadge  },
    { key: 'reviews',   label: 'Review',         icon: Eye,            dot: reviewsBadge },
    { key: 'completed_tasks', label: 'Task xong', icon: CheckCircle2, dot: completedTasksBadge },
  ];

  return (
    <div>
      {/* ─── Breadcrumb ─── */}
      <div className="flex items-center gap-2 text-sm text-surface-500 mb-4">
        <Link to="/projects" className="hover:text-surface-700 transition-colors flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" />
          Dự án
        </Link>
        <span className="text-surface-300">›</span>
        <span className="text-surface-900 font-medium truncate">{project.name}</span>
      </div>

      {/* ─── Project Header Card ─── */}
      <div className="bg-surface-0 rounded-xl border border-surface-200 p-5 shadow-subtle mb-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-brand-100 flex items-center justify-center shrink-0">
              <FileText className="w-6 h-6 text-brand-600" />
            </div>
            <div>
              <div className="flex items-center gap-3 mb-1.5">
                <h1 className="text-xl font-bold text-surface-900">{project.name}</h1>
                <StatusBadge status={project.status} />
              </div>
              <div className="flex items-center gap-4 text-sm text-surface-400 flex-wrap">
                <span className="font-mono bg-surface-50 text-surface-500 px-2 py-0.5 rounded text-xs">
                  {project.code}
                </span>
                {project.creator && (
                  <span className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    PO: {project.creator.full_name}
                  </span>
                )}
                {project.deadline && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    {new Date(project.deadline).toLocaleDateString('vi-VN', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Database className="w-3.5 h-3.5" />
                  {totalSamples.toLocaleString()} items
                </span>
              </div>
            </div>
          </div>

          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-surface-200 text-sm text-surface-600 hover:bg-surface-50 transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Import
            </button>
            <button
              onClick={() => setShowExport(true)}
              className="btn-primary"
            >
              <Upload className="w-4 h-4" />
              Export
            </button>
          </div>
        </div>
      </div>

      {/* ─── Tabs ─── */}
      <div className="mb-5 w-full overflow-hidden border-b border-surface-200">
        <div className="flex w-full min-w-0 items-stretch justify-between gap-1">
          {tabs.map(({ key, label, icon: Icon, dot }) => {
            const isCompletedTasksTab = key === 'completed_tasks';

            return (
              <button
                key={key}
                onClick={() => selectTab(key)}
                className={`flex items-center justify-center gap-2 px-2 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer ${
                  isCompletedTasksTab ? 'min-w-fit shrink-0 grow-0 px-3' : 'min-w-0 flex-1'
                } ${
                  activeTab === key
                    ? 'border-brand-500 text-brand-700'
                    : 'border-transparent text-surface-500 hover:text-surface-700'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className={isCompletedTasksTab ? 'whitespace-nowrap' : 'min-w-0 truncate'}>{label}</span>
                {dot === 'red' && (
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full w-2 h-2 bg-red-500" />
                  </span>
                )}
                {dot === 'green' && (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                )}
              </button>
            );
          })}
        </div>

      </div>

      {/* ─── Tab Content ─── */}
      {activeTab === 'overview' && (
        <OverviewTab project={project} datasets={datasets} tasks={tasks} members={members} totalSamples={totalSamples} projectId={projectId!} onRefresh={fetchAll} onSwitchTab={selectTab} />
      )}
      {activeTab === 'data_type' && (
        <DataTypeTab />
      )}
      {activeTab === 'labels' && (
        <LabelsTab labelSets={labelSets} projectId={projectId!} onRefresh={fetchAll} />
      )}
      {activeTab === 'datasets' && (
        <DatasetsTab datasets={datasets} projectId={projectId!} onRefresh={fetchAll} />
      )}
      {activeTab === 'tasks' && (
        <TasksTab tasks={tasks} projectId={projectId!} />
      )}
      {activeTab === 'reviews' && (
        <ReviewsTab tasks={tasks} projectId={projectId!} />
      )}
      {activeTab === 'completed_tasks' && (
        <CompletedTasksTab tasks={tasks} projectId={projectId!} />
      )}
      {activeTab === 'assign' && (
        <AssignTab
          datasets={datasets}
          members={members}
          tasks={tasks}
          labelSets={labelSets}
          projectId={projectId!}
          onAssigned={fetchAll}
        />
      )}

      {/* ─── Modals ─── */}
      <AddLabelModal
        isOpen={showAddLabel}
        onClose={() => setShowAddLabel(false)}
        onAdded={() => { setShowAddLabel(false); fetchAll(); }}
        projectId={projectId!}
        labelSets={labelSets}
      />
      <ImportDataModal
        isOpen={showImport}
        onClose={() => setShowImport(false)}
        onImported={() => { setShowImport(false); fetchAll(); }}
        projectId={projectId!}
      />
      <ExportModal
        isOpen={showExport}
        onClose={() => setShowExport(false)}
        onExported={() => { setShowExport(false); fetchAll(); }}
        projectId={projectId!}
        datasets={datasets}
        tasks={tasks}
      />
      {showAssign && (
        <AssignModal
          datasets={datasets.filter((d) => d.status === 'ready')}
          members={members}
          labelSets={labelSets}
          tasks={tasks}
          projectId={projectId!}
          onClose={() => setShowAssign(false)}
          onAssigned={() => { setShowAssign(false); fetchAll(); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SHARED ROLE CONFIG (used by OverviewTab + MembersTab)
// ─────────────────────────────────────────────────────────────
const ROLE_OPTIONS = [
  { value: 'project_owner', label: 'Project Owner' },
  { value: 'annotator',     label: 'Annotator' },
  { value: 'reviewer',      label: 'Reviewer' },
];

const ROLE_COLORS: Record<string, string> = {
  project_owner: 'bg-brand-50 text-brand-700 border-brand-200',
  annotator:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  reviewer:      'bg-amber-50 text-amber-700 border-amber-200',
};

const ROLE_LABELS: Record<string, string> = {
  project_owner: 'Project Owner',
  annotator:     'Annotator',
  reviewer:      'Reviewer',
};

// ─────────────────────────────────────────────────────────────
// OVERVIEW TAB
// ─────────────────────────────────────────────────────────────
function OverviewTab({
  project,
  datasets,
  tasks,
  members,
  totalSamples,
  projectId,
  onRefresh,
  onSwitchTab,
}: {
  project: Project;
  datasets: Dataset[];
  tasks: Task[];
  members: ProjectMember[];
  totalSamples: number;
  projectId: string;
  onRefresh: () => void;
  onSwitchTab: (tab: TabKey) => void;
}) {
  const [infoMember, setInfoMember] = useState<ProjectMember | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<string>('');
  const [showAddMember, setShowAddMember] = useState(false);
  const { confirm, ConfirmDialog } = useConfirm();
  const { showToast } = useToast();
  const { user } = useAuthStore();
  const isAdmin = user?.roles?.some((r: string) => r.toLowerCase().includes('admin'));
  const isProjectOwner =
    project.created_by === user?.id ||
    members.some(
      (m) =>
        m.user_id === user?.id &&
        m.role_in_project.toLowerCase() === 'project_owner'
    );
  const canAddMembers = isAdmin || isProjectOwner;

  const handleRemoveMember = async (m: ProjectMember) => {
    if (!await confirm(`Xoá thành viên "${m.full_name}" khỏi dự án?`, { title: 'Xóa thành viên', variant: 'danger', confirmText: 'Xóa' })) return;
    try {
      await taskApi.removeMember(projectId, m.user_id);
      onRefresh();
    } catch (err: unknown) {
      showToast('error', extractErrorMessage(err, 'Không thể xoá thành viên'));
    }
  };

  const startEdit = (m: ProjectMember) => {
    setEditingId(m.user_id);
    setPendingRole(m.role_in_project);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setPendingRole('');
  };

  const saveRole = async (m: ProjectMember) => {
    if (pendingRole === m.role_in_project) { cancelEdit(); return; }
    setSavingId(m.user_id);
    try {
      await taskApi.updateMember(projectId, m.user_id, pendingRole);
      onRefresh();
      setEditingId(null);
    } catch (err: any) {
      showToast('error', err.response?.data?.detail || 'Không thể đổi vai trò');
    } finally {
      setSavingId(null);
    }
  };

  const annotatedCount = project.annotated_samples ?? 0;
  const pendingReview = project.pending_review_samples ?? 0;
  const annotationPct = Math.max(0, Math.min(100, Math.round(project.annotation_progress ?? 0)));
  const reviewPct = Math.max(0, Math.min(100, Math.round(project.review_progress ?? 0)));
  const completedPct = Math.max(0, Math.min(100, Math.round(project.completion_progress ?? 0)));
  const datasetPreviewLimit = 2;
  const previewDatasets = datasets.slice(0, datasetPreviewLimit);
  const hasMoreDatasets = datasets.length > datasetPreviewLimit;

  const statCards = [
    {
      label: 'Tổng samples',
      value: totalSamples.toLocaleString(),
      sub: `${datasets.length} dataset`,
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-600',
      Icon: Database,
    },
    {
      label: 'Đã gán nhãn',
      value: annotatedCount,
      sub: `+${annotationPct}% hoàn thành`,
      iconBg: 'bg-emerald-100',
      iconColor: 'text-emerald-600',
      Icon: CheckCircle2,
    },
    {
      label: 'Chờ review',
      value: pendingReview,
      sub: `${tasks.filter((t) => t.status === 'in_progress').length} đang xử lý`,
      iconBg: 'bg-amber-100',
      iconColor: 'text-amber-600',
      Icon: Clock,
    },
    {
      label: 'Thành viên',
      value: members.length,
      sub: null,
      iconBg: 'bg-purple-100',
      iconColor: 'text-purple-600',
      Icon: Users,
    },
  ];

  return (
    <div className="space-y-5">
      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div key={card.label} className="bg-surface-0 rounded-xl border border-surface-200 p-5 shadow-subtle">
            <div className={`w-10 h-10 rounded-xl ${card.iconBg} flex items-center justify-center mb-3`}>
              <card.Icon className={`w-5 h-5 ${card.iconColor}`} />
            </div>
            <p className="text-2xl font-bold text-surface-900">{card.value}</p>
            <p className="text-sm text-surface-500 mt-0.5">{card.label}</p>
            {card.sub && (
              <p className="text-xs text-emerald-600 mt-1 font-medium">{card.sub}</p>
            )}
          </div>
        ))}
      </div>

      {/* Progress + Dataset list */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-5 items-start">
        <div className="h-[210px] bg-surface-0 rounded-xl border border-surface-200 p-5 shadow-subtle flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-brand-500" />
            <h3 className="text-sm font-semibold text-surface-800">Tiến độ tổng thể</h3>
          </div>
          <div className="space-y-4">
            {[
              { label: 'Gán nhãn', pct: annotationPct, color: 'bg-brand-500' },
              { label: 'Review / QA', pct: reviewPct, color: 'bg-amber-500' },
              { label: 'Hoàn thành & Export', pct: completedPct, color: 'bg-emerald-500' },
            ].map((item) => (
              <div key={item.label}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm text-surface-600">{item.label}</span>
                  <span className="text-sm font-semibold text-surface-800">{item.pct}%</span>
                </div>
                <div className="h-2 bg-surface-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${item.color} rounded-full transition-all`}
                    style={{ width: `${item.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="h-[210px] bg-surface-0 rounded-xl border border-surface-200 p-5 shadow-subtle flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-surface-900">Dataset hiện tại</h3>
            {hasMoreDatasets && (
              <button
                onClick={() => onSwitchTab('datasets')}
                className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 transition-colors cursor-pointer"
                title="Xem tất cả dataset"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Xem tất cả
              </button>
            )}
          </div>
          {datasets.length === 0 ? (
            <p className="text-sm text-surface-400 text-center py-8 flex-1">Chưa có dataset nào</p>
          ) : (
            <div className="divide-y divide-surface-100 flex-1 min-h-0 overflow-hidden">
              {previewDatasets.map((ds) => {
                const dsTasks = tasks.filter((t) => t.dataset_id === ds.id);
                const total = ds.total_samples;
                const done = dsTasks
                  .filter((t) => ['submitted', 'approved'].includes(getTaskLifecycleStatus(t)))
                  .reduce((s, t) => s + t.sample_count, 0);
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                const dotColor = ds.status === 'ready' ? 'bg-emerald-500' : ds.status === 'importing' ? 'bg-blue-400' : 'bg-red-400';
                const labelColor = ds.status === 'ready' ? 'text-emerald-600' : ds.status === 'importing' ? 'text-blue-600' : 'text-red-500';
                const statusLabel = ds.status === 'ready' ? 'active' : ds.status === 'importing' ? 'importing' : 'error';
                return (
                  <div key={ds.id} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-semibold text-surface-900 truncate max-w-[140px]">{ds.name}</span>
                      <span className={`flex items-center gap-1.5 text-xs font-medium shrink-0 ml-2 ${labelColor}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                        {statusLabel}
                      </span>
                    </div>
                    <div className="h-1.5 bg-surface-100 rounded-full overflow-hidden mb-1">
                      <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-surface-400">{done}/{total} items</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Members list */}
      <div className="bg-surface-0 rounded-xl border border-surface-200 shadow-subtle overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-surface-900">Thành viên dự án</h3>
          {canAddMembers && (
            <button
              onClick={() => setShowAddMember(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Thêm
            </button>
          )}
        </div>
        {members.length === 0 ? (
          <p className="text-sm text-surface-400 text-center py-10">Chưa có thành viên nào</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-100">
                <Th>Thành viên</Th>
                <Th>Email</Th>
                <Th>Vai trò</Th>
                <Th>Ngày tham gia</Th>
                <Th align="right">Thao tác</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {members.map((m) => {
                const isEditing = editingId === m.user_id;
                const isSaving = savingId === m.user_id;
                return (
                <tr key={m.id} className="hover:bg-surface-50/50 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold shrink-0">
                        {m.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <span className="text-sm font-medium text-surface-900">{m.full_name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-surface-500">{m.email}</td>
                  <td className="px-5 py-3.5">
                    {isEditing ? (
                      <div className="relative inline-block">
                        <select
                          value={pendingRole}
                          onChange={(e) => setPendingRole(e.target.value)}
                          className="appearance-none text-xs font-semibold border rounded-md px-2 py-1 pr-6 outline-none focus:ring-2 focus:ring-brand-300 bg-white"
                          autoFocus
                        >
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-surface-400 pointer-events-none" />
                      </div>
                    ) : (
                      <span className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md border ${ROLE_COLORS[m.role_in_project] || 'bg-surface-100 text-surface-600 border-surface-200'}`}>
                        {ROLE_LABELS[m.role_in_project] || m.role_in_project}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-sm text-surface-500">
                    {new Date(m.joined_at).toLocaleDateString('vi-VN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-5 py-3.5">
                    {isEditing ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => saveRole(m)}
                          disabled={isSaving}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 transition-colors cursor-pointer"
                        >
                          {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Lưu'}
                        </button>
                        <button
                          onClick={cancelEdit}
                          disabled={isSaving}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium text-surface-600 bg-surface-100 hover:bg-surface-200 transition-colors cursor-pointer"
                        >
                          Hủy
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setInfoMember(m)}
                          className="p-1.5 rounded-lg text-surface-400 hover:text-brand-600 hover:bg-brand-50 transition-colors cursor-pointer"
                          title="Xem thông tin"
                        >
                          <Info className="w-4 h-4" />
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => startEdit(m)}
                            className="p-1.5 rounded-lg text-surface-400 hover:text-amber-600 hover:bg-amber-50 transition-colors cursor-pointer"
                            title="Đổi vai trò"
                          >
                            <ChevronDown className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleRemoveMember(m)}
                          className="p-1.5 rounded-lg text-surface-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                          title="Xóa thành viên"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Add member modal */}
      <AddMemberModal
        isOpen={showAddMember}
        onClose={() => setShowAddMember(false)}
        onAdded={() => { setShowAddMember(false); onRefresh(); }}
        projectId={projectId}
        existingMemberIds={members.map((m) => m.user_id)}
      />

      {/* Confirm dialog */}
      {ConfirmDialog}

      {/* Member info modal */}
      {infoMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-surface-950/40 backdrop-blur-[2px]" onClick={() => setInfoMember(null)} />
          <div className="relative w-full max-w-sm bg-surface-0 rounded-2xl shadow-elevated border border-surface-200 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-100">
              <h2 className="text-base font-semibold text-surface-900">Thông tin thành viên</h2>
              <button onClick={() => setInfoMember(null)} className="p-1.5 rounded-lg text-surface-400 hover:text-surface-600 hover:bg-surface-100 transition-colors cursor-pointer">
                <span className="text-lg leading-none">×</span>
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-lg font-bold shrink-0">
                  {infoMember.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-base font-semibold text-surface-900">{infoMember.full_name}</p>
                  <span className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md border ${ROLE_COLORS[infoMember.role_in_project] || 'bg-surface-100 text-surface-600 border-surface-200'}`}>
                    {ROLE_LABELS[infoMember.role_in_project] || infoMember.role_in_project}
                  </span>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-surface-600">
                  <span className="w-28 text-surface-400 shrink-0">Email</span>
                  <span className="font-medium text-surface-800">{infoMember.email}</span>
                </div>
                <div className="flex items-center gap-2 text-surface-600">
                  <span className="w-28 text-surface-400 shrink-0">Ngày tham gia</span>
                  <span className="font-medium text-surface-800">
                    {new Date(infoMember.joined_at).toLocaleDateString('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DATA TYPE TAB
// ─────────────────────────────────────────────────────────────
function DataTypeTab() {
  return (
    <div className="space-y-5">
      {/* Project type card */}
      <div className="bg-surface-0 rounded-xl border border-surface-200 p-5 shadow-subtle">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-brand-100 flex items-center justify-center">
              <FileText className="w-6 h-6 text-brand-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-brand-600">Văn bản</h3>
              <p className="text-sm text-surface-500">
                Dự án gán nhãn, phân tích và trích xuất thông tin từ dữ liệu văn bản.
              </p>
            </div>
          </div>
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand-200 text-brand-600 text-sm font-medium">
            <FileText className="w-3.5 h-3.5" />
            Văn bản
          </span>
        </div>
      </div>

      {/* Two info panels */}
      <div className="grid grid-cols-2 gap-5">
        {/* Accepted formats */}
        <div className="bg-surface-0 rounded-xl border border-surface-200 p-5 shadow-subtle">
          <div className="flex items-center gap-2 mb-4">
            <HardDrive className="w-4 h-4 text-brand-500" />
            <h3 className="text-sm font-semibold text-surface-800">Định dạng file chấp nhận</h3>
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            {['.csv', '.json', '.jsonl'].map((fmt) => (
              <span
                key={fmt}
                className="font-mono text-sm px-3 py-1.5 rounded-lg border border-surface-200 bg-surface-50 text-surface-700"
              >
                {fmt}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-surface-50 border border-surface-200/60">
            <Database className="w-4 h-4 text-surface-400 shrink-0" />
            <span className="text-sm text-surface-500">Kích thước tối đa: 10 MB mỗi file</span>
          </div>
        </div>

        {/* Annotation types */}
        <div className="bg-surface-0 rounded-xl border border-surface-200 p-5 shadow-subtle">
          <div className="flex items-center gap-2 mb-4">
            <Tag className="w-4 h-4 text-brand-500" />
            <h3 className="text-sm font-semibold text-surface-800">Kiểu Annotation hỗ trợ</h3>
          </div>
          <div className="space-y-3">
            {[
              {
                badge: 'NE',
                label: 'Named Entity (NER)',
                desc: 'Trích xuất thực thể có tên: người, địa điểm, tổ chức, ngày tháng…',
                color: 'bg-blue-100 text-blue-700',
              },
              {
                badge: '≡',
                label: 'Text Span',
                desc: 'Đánh dấu đoạn văn bản theo vị trí ký tự (start_offset – end_offset).',
                color: 'bg-purple-100 text-purple-700',
              },
              {
                badge: '◈',
                label: 'Text Classification',
                desc: 'Phân loại cảm xúc, chủ đề, ý định của toàn bộ văn bản.',
                color: 'bg-amber-100 text-amber-700',
              },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-3">
                <div
                  className={`w-8 h-8 rounded-lg ${item.color} flex items-center justify-center text-xs font-bold shrink-0`}
                >
                  {item.badge}
                </div>
                <div>
                  <p className="text-sm font-medium text-surface-800">{item.label}</p>
                  <p className="text-xs text-surface-500 mt-0.5 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DATASETS TAB
// ─────────────────────────────────────────────────────────────
function DatasetsTab({
  datasets,
  projectId,
  onRefresh,
}: {
  datasets: Dataset[];
  projectId: string;
  onRefresh: () => void;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [viewDataset, setViewDataset] = useState<Dataset | null>(null);
  const { confirm, ConfirmDialog } = useConfirm();
  const { showToast } = useToast();

  const getProgress = (ds: Dataset) => {
    const total = ds.total_samples;
    const done = ds.completed_samples ?? 0;
    const pct = Math.max(
      0,
      Math.min(
        100,
        Math.round(ds.progress_percent ?? (total > 0 ? (done / total) * 100 : 0)),
      ),
    );
    return { done, total, pct };
  };

  const handleDelete = async (ds: Dataset) => {
    if (!await confirm(`Xoá dataset "${ds.name}"? Không thể hoàn tác.`, { title: 'Xóa dataset', variant: 'danger', confirmText: 'Xóa' })) return;
    setDeleting(ds.id);
    try {
      await taskApi.deleteDataset(projectId, ds.id);
      onRefresh();
    } catch (err: any) {
      showToast('error', err.response?.data?.detail || 'Failed to delete');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <>
      {ConfirmDialog}

      {/* ── Empty state with Import button ── */}
      {datasets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="w-12 h-12 rounded-xl bg-surface-100 flex items-center justify-center mb-4">
            <Database className="w-6 h-6 text-surface-400" />
          </div>
          <h3 className="text-base font-medium text-surface-800 mb-1">Chưa có dataset nào</h3>
          <p className="text-sm text-surface-500 mb-4">Import dữ liệu văn bản để bắt đầu tạo annotation tasks.</p>
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4" />
            Import Dataset
          </button>
        </div>
      ) : (
        <div className="bg-surface-0 rounded-xl border border-surface-200 shadow-subtle overflow-hidden">
          <div className="px-5 py-3 border-b border-surface-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-surface-800">Danh sách Dataset</h3>
              <span className="text-xs text-surface-400">{datasets.length} dataset</span>
            </div>
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Import
            </button>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-100">
                <Th>Tên Dataset</Th>
                <Th>Nguồn</Th>
                <Th>Samples</Th>
                <Th>Tiến độ</Th>
                <Th>Trạng thái</Th>
                <Th>Ngày tạo</Th>
                <Th align="right">Thao tác</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {datasets.map((ds) => {
                const prog = getProgress(ds);
                return (
                  <tr key={ds.id} className="hover:bg-surface-50/50 transition-colors">
                    <td className="px-5 py-3.5 text-sm font-medium text-surface-900">{ds.name}</td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs font-mono bg-surface-100 text-surface-600 px-2 py-0.5 rounded">
                        {ds.source_format.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-surface-600 font-medium">
                      {ds.total_samples.toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <div className="flex-1 h-1.5 bg-surface-100 rounded-full overflow-hidden">
                          <div className="h-full bg-brand-500 rounded-full" style={{ width: `${prog.pct}%` }} />
                        </div>
                        <span className="text-xs text-surface-500 whitespace-nowrap">
                          {prog.done}/{prog.total} ({prog.pct}%)
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={ds.status} />
                    </td>
                    <td className="px-5 py-3.5 text-sm text-surface-500">
                      {new Date(ds.created_at).toLocaleDateString('vi-VN', { day: 'numeric', month: 'short' })}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          onClick={() => setViewDataset(ds)}
                          className="p-2 rounded-lg text-surface-400 hover:text-brand-600 hover:bg-brand-50 transition-colors cursor-pointer"
                          title="Xem samples"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(ds)}
                          disabled={deleting === ds.id}
                          className="p-2 rounded-lg text-surface-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50 cursor-pointer"
                          title="Xóa dataset"
                        >
                          {deleting === ds.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ImportDataModal
        isOpen={showImport}
        onClose={() => setShowImport(false)}
        onImported={() => { setShowImport(false); onRefresh(); }}
        projectId={projectId}
      />
      {viewDataset && (
        <DatasetSamplesModal
          dataset={viewDataset}
          projectId={projectId}
          onClose={() => setViewDataset(null)}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// DATASET SAMPLES MODAL
// ─────────────────────────────────────────────────────────────
function DatasetSamplesModal({
  dataset,
  projectId,
  onClose,
}: {
  dataset: Dataset;
  projectId: string;
  onClose: () => void;
}) {
  const [samples, setSamples] = useState<DataSample[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 20;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    taskApi.getSamples(projectId, dataset.id, page, PAGE_SIZE)
      .then((r) => {
        if (!cancelled) {
          setSamples(r.samples);
          setTotalPages(r.total_pages);
          setTotal(r.total);
          setLoading(false);
        }
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, dataset.id, page]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-3xl bg-surface-0 rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center">
              <Database className="w-5 h-5 text-brand-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">{dataset.name}</h2>
              <p className="text-xs text-gray-400">
                {total.toLocaleString()} samples · {dataset.source_format.toUpperCase()}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm">Đang tải...</span>
            </div>
          ) : samples.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <FileText className="w-10 h-10 mb-3 text-gray-200" />
              <p className="text-sm">Không có sample nào</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 w-16">#</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">Nội dung</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 whitespace-nowrap w-40">Ngày tạo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {samples.map((s, idx) => (
                  <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 text-xs text-gray-400 font-mono">
                      {(page - 1) * PAGE_SIZE + idx + 1}
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-800 max-w-0">
                      <p className="line-clamp-2 leading-relaxed">{s.content}</p>
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-400 whitespace-nowrap">
                      {new Date(s.created_at).toLocaleDateString('vi-VN', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer — pagination */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 shrink-0">
          <span className="text-xs text-gray-400">
            Trang {page} / {totalPages} · {total.toLocaleString()} samples
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors cursor-pointer"
            >
              ← Trước
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors cursor-pointer"
            >
              Tiếp →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TASKS TAB
// ─────────────────────────────────────────────────────────────
function TasksTab({ tasks, projectId }: { tasks: Task[]; projectId: string }) {
  if (tasks.length === 0) {
    return (
      <EmptyTab
        icon={ClipboardList}
        title="Chưa có task nào"
        description="Import dataset và phân công task cho annotator để bắt đầu."
      />
    );
  }

  return (
    <div className="bg-surface-0 rounded-xl border border-surface-200 shadow-subtle overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-surface-100">
              <Th>Task ID</Th>
              <Th>Assignee</Th>
              <Th>Samples</Th>
              <Th>Method</Th>
              <Th>Status</Th>
              <Th>Assigned</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100">
            {tasks.map((task) => (
              <tr key={task.id} className="hover:bg-surface-50/50 transition-colors">
                <td className="px-5 py-3.5">
                  <span className="text-xs font-mono text-surface-500 bg-surface-50 px-2 py-0.5 rounded">
                    {task.id.slice(0, 8)}…
                  </span>
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-[10px] font-bold shrink-0">
                      {task.assignee_name
                        ?.split(' ')
                        .map((n) => n[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase() || '??'}
                    </div>
                    <span className="text-sm text-surface-800">
                      {task.assignee_name || 'Unknown'}
                    </span>
                  </div>
                </td>
                <td className="px-5 py-3.5 text-sm text-surface-600 font-medium">
                  {task.sample_count}
                </td>
                <td className="px-5 py-3.5">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                    task.assignment_method === 'round_robin'
                      ? 'bg-purple-50 text-purple-700'
                      : 'bg-surface-100 text-surface-600'
                  }`}>
                    {task.assignment_method === 'round_robin' ? 'Round Robin' : 'Manual'}
                  </span>
                </td>
                <td className="px-5 py-3.5">
                  <StatusBadge status={getTaskLifecycleStatus(task)} />
                </td>
                <td className="px-5 py-3.5 text-sm text-surface-500">
                  {new Date(task.assigned_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </td>
                <td className="px-5 py-3.5 text-right">
                  <TaskActionButton task={task} projectId={projectId} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TaskActionButton({ task, projectId }: { task: Task; projectId: string }) {
  if (isApprovedTask(task)) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-emerald-600 bg-emerald-50 border border-emerald-100">
        <Check className="w-3 h-3" />
        Đã duyệt
      </span>
    );
  }

  if (getTaskLifecycleStatus(task) === 'submitted') {
    return (
      <Link
        to={`/review/${projectId}/${task.id}`}
        className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-purple-700 bg-purple-50 border border-purple-100 hover:bg-purple-100 hover:border-purple-200 transition-all duration-150"
      >
        <Eye className="w-3 h-3" />
        Xem lại
        <ChevronRight className="w-3 h-3 opacity-50 group-hover:translate-x-0.5 transition-transform duration-150" />
      </Link>
    );
  }

  const isRework = task.status === 'rework';
  const isInProgress = task.status === 'in_progress';
  const label = isRework ? 'Chỉnh sửa' : isInProgress ? 'Tiếp tục' : 'Bắt đầu';
  const Icon = isRework ? RotateCcw : Pencil;
  const workspacePath =
    (task.annotation_type ?? task.task_type) === 'relation_extraction'
      ? `/workspace-relation/${task.id}`
      : `/workspace/${task.id}`;

  return (
    <Link
      to={workspacePath}
      className={`group inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white transition-all duration-200 shadow-sm ${
        isRework
          ? 'bg-amber-500 hover:bg-amber-600 hover:shadow-md hover:shadow-amber-200/60'
          : 'bg-brand-500 hover:bg-brand-600 hover:shadow-md hover:shadow-brand-200/60'
      }`}
    >
      <Icon className={`w-3 h-3 transition-transform duration-200 ${isRework ? 'group-hover:-rotate-12' : 'group-hover:-rotate-6'}`} />
      {label}
      <ChevronRight className="w-3 h-3 opacity-60 group-hover:translate-x-0.5 transition-transform duration-150" />
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────
// REVIEWS TAB
// ─────────────────────────────────────────────────────────────
function ReviewsTab({ tasks, projectId }: { tasks: Task[]; projectId: string }) {
  const pendingTasks = tasks.filter((t) => getTaskLifecycleStatus(t) === 'submitted');
  const reworkTasks = tasks.filter((t) => getTaskLifecycleStatus(t) === 'rework');

  if (pendingTasks.length === 0 && reworkTasks.length === 0) {
    return (
      <EmptyTab
        icon={Eye}
        title="Không có task nào để duyệt"
        description="Khi annotator nộp task, chúng sẽ xuất hiện ở đây để reviewer duyệt."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Pending review */}
      {pendingTasks.length > 0 && (
        <div className="bg-surface-0 rounded-xl border border-surface-200 shadow-subtle overflow-hidden">
          <div className="px-5 py-3 border-b border-surface-100 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-500" />
            <h3 className="text-sm font-semibold text-surface-800">Chờ duyệt</h3>
            <span className="text-xs text-surface-400">{pendingTasks.length} task</span>
          </div>
          <ReviewTaskTable tasks={pendingTasks} projectId={projectId} />
        </div>
      )}

      {/* Rework */}
      {reworkTasks.length > 0 && (
        <div className="bg-surface-0 rounded-xl border border-surface-200 shadow-subtle overflow-hidden">
          <div className="px-5 py-3 border-b border-surface-100 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-orange-500" />
            <h3 className="text-sm font-semibold text-surface-800">Đang sửa lại</h3>
            <span className="text-xs text-surface-400">{reworkTasks.length} task</span>
          </div>
          <ReviewTaskTable tasks={reworkTasks} projectId={projectId} />
        </div>
      )}
    </div>
  );
}

function CompletedTasksTab({ tasks, projectId }: { tasks: Task[]; projectId: string }) {
  const approvedTasks = tasks.filter(isApprovedTask);

  if (approvedTasks.length === 0) {
    return (
      <EmptyTab
        icon={CheckCircle2}
        title="Chưa có task hoàn thành"
        description="Các task đã được reviewer duyệt hết sẽ được lưu tại đây."
      />
    );
  }

  return (
    <div className="bg-surface-0 rounded-xl border border-surface-200 shadow-subtle overflow-hidden">
      <div className="px-5 py-3 border-b border-surface-100 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-emerald-500" />
        <h3 className="text-sm font-semibold text-surface-800">Task đã duyệt hết</h3>
        <span className="text-xs text-surface-400">{approvedTasks.length} task</span>
      </div>
      <ReviewTaskTable tasks={approvedTasks} projectId={projectId} />
    </div>
  );
}

function ReviewTaskTable({ tasks, projectId }: { tasks: Task[]; projectId: string }) {
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-surface-100">
          <Th>Task ID</Th>
          <Th>Annotator</Th>
          <Th>Samples</Th>
          <Th>Status</Th>
          <Th>Submitted</Th>
          <Th align="right">Actions</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-surface-100">
        {tasks.map((task) => (
          <tr key={task.id} className="hover:bg-surface-50/50 transition-colors">
            <td className="px-5 py-3.5">
              <span className="text-xs font-mono text-surface-500 bg-surface-50 px-2 py-0.5 rounded">
                {task.id.slice(0, 8)}…
              </span>
            </td>
            <td className="px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-[10px] font-bold shrink-0">
                  {task.assignee_name
                    ?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '??'}
                </div>
                <span className="text-sm text-surface-800">{task.assignee_name || 'Unknown'}</span>
              </div>
            </td>
            <td className="px-5 py-3.5 text-sm text-surface-600 font-medium">
              {task.sample_count}
            </td>
            <td className="px-5 py-3.5">
              <StatusBadge status={getTaskLifecycleStatus(task)} />
            </td>
            <td className="px-5 py-3.5 text-sm text-surface-500">
              {task.submitted_at
                ? new Date(task.submitted_at).toLocaleDateString('vi-VN', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })
                : '—'}
            </td>
            <td className="px-5 py-3.5 text-right">
              {getTaskLifecycleStatus(task) === 'submitted' ? (
                <Link
                  to={`/review/${projectId}/${task.id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 transition-colors"
                >
                  <Eye className="w-3 h-3" />
                  Duyệt ngay
                </Link>
              ) : isApprovedTask(task) ? (
                <Link
                  to={`/review/${projectId}/${task.id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
                >
                  <Eye className="w-3 h-3" />
                  Xem lại
                </Link>
              ) : (
                <Link
                  to={`/review/${projectId}/${task.id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 transition-colors"
                >
                  <Eye className="w-3 h-3" />
                  Xem
                </Link>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─────────────────────────────────────────────────────────────
// ASSIGN TAB  (task list + assign modal)
// ─────────────────────────────────────────────────────────────
type AnnotationType = 'text_classification' | 'ner' | 'relation_extraction' | 'sequence_labeling';
type AssignmentMethod = 'round_robin' | 'manual';
type ManualRow = { id: string; annotator_id: string; sample_count: string };

// ── Assign Modal ─────────────────────────────────────────────
function AssignModal({
  datasets,
  members,
  labelSets,
  tasks,
  projectId,
  onClose,
  onAssigned,
}: {
  datasets: Dataset[];
  members: ProjectMember[];
  labelSets: import('../api/labelApi').LabelSetData[];
  tasks: Task[];
  projectId: string;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const { showToast } = useToast();
  const [annotationType, setAnnotationType] = useState<AnnotationType>('text_classification');
  const [datasetId, setDatasetId]     = useState(datasets[0]?.id || '');
  const [labelSetId, setLabelSetId]   = useState(labelSets[0]?.id || '');
  const [method, setMethod]           = useState<AssignmentMethod>('round_robin');
  const [manualRows, setManualRows]   = useState<ManualRow[]>([
    { id: crypto.randomUUID(), annotator_id: '', sample_count: '' },
  ]);
  const [selectedReviewerIds, setSelectedReviewerIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');

  const annotators       = members.filter((m) => m.role_in_project === 'annotator');
  const reviewers        = members.filter((m) => m.role_in_project === 'reviewer');
  const selectedDataset  = datasets.find((d) => d.id === datasetId);
  const assignedSamplesForType = tasks
    .filter((task) => task.dataset_id === datasetId)
    .filter((task) =>
      annotationType === 'sequence_labeling'
        ? task.annotation_type === 'sequence_labeling' || task.annotation_type === null
        : task.annotation_type === annotationType
    )
    .reduce((sum, task) => sum + (task.sample_count || 0), 0);
  const availableSamples = Math.max(
    0,
    (selectedDataset?.total_samples ?? 0) - assignedSamplesForType
  );
  const selectedReviewers = reviewers.filter((r) => selectedReviewerIds.has(r.user_id));

  const toggleReviewer = (id: string) =>
    setSelectedReviewerIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const addRow = () =>
    setManualRows((r) => [
      ...r,
      { id: crypto.randomUUID(), annotator_id: '', sample_count: '' },
    ]);
  const removeRow = (rid: string) =>
    setManualRows((r) => r.filter((row) => row.id !== rid));
  const updateRow = (rid: string, field: 'annotator_id' | 'sample_count', value: string) =>
    setManualRows((r) =>
      r.map((row) => (row.id === rid ? { ...row, [field]: value } : row))
    );

  const totalManual = manualRows.reduce(
    (s, r) => s + (parseInt(r.sample_count, 10) || 0),
    0
  );

  // Tasks to be created (for reviewer split preview)
  const tasksToCreate =
    method === 'round_robin'
      ? annotators.length
      : manualRows.filter((r) => r.annotator_id && r.sample_count).length;

  const handleSubmit = async () => {
    setError('');
    if (!datasetId) { setError('Chọn dataset để phân công.'); return; }
    if (!labelSetId) { setError('Chọn bộ nhãn để sử dụng cho task này.'); return; }
    if (availableSamples <= 0) {
      setError('Dataset này không còn sample chưa phân công cho loại bài toán đã chọn.');
      return;
    }
    if (method === 'round_robin' && annotators.length === 0) {
      setError('Chưa có annotator nào trong dự án. Thêm thành viên trước.');
      return;
    }
    if (method === 'manual') {
      const valid = manualRows.filter((r) => r.annotator_id && r.sample_count);
      if (valid.length === 0) {
        setError('Thêm ít nhất một annotator và số lượng sample.');
        return;
      }
      if (totalManual > availableSamples) {
        setError(
          `Tổng sample phân công (${totalManual}) vượt quá số khả dụng (${availableSamples}).`
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      const assignments =
        method === 'manual'
          ? manualRows
              .filter((r) => r.annotator_id && r.sample_count)
              .map((r) => ({
                annotator_id: r.annotator_id,
                sample_count: parseInt(r.sample_count, 10),
              }))
          : undefined;

      await taskApi.assignTasks(projectId, {
        dataset_id: datasetId,
        method,
        annotation_type: annotationType,
        label_set_id: labelSetId,
        reviewer_ids:
          selectedReviewerIds.size > 0
            ? Array.from(selectedReviewerIds)
            : undefined,
        assignments,
      });

      showToast('success', 'Phân công task thành công!');
      onAssigned();
      onClose();
    } catch (err: any) {
      setError(extractErrorMessage(err, 'Phân công thất bại'));
    } finally {
      setSubmitting(false);
    }
  };

  const ANNOTATION_TYPES: Array<{
    key: AnnotationType;
    icon: React.ReactNode;
    title: string;
    subtitle: string;
    description: string;
    activeBg: string;
    activeBorder: string;
    activeText: string;
    iconBg: string;
  }> = [
    {
      key: 'text_classification',
      icon: <BadgeCheck className="w-5 h-5" />,
      title: 'Text Classification',
      subtitle: 'Phân loại văn bản',
      description:
        'Gán nhãn toàn bộ đoạn văn bản theo chủ đề, cảm xúc, ý định hoặc nhóm nhãn được cấu hình.',
      activeBg: 'bg-amber-50',
      activeBorder: 'border-amber-400',
      activeText: 'text-amber-700',
      iconBg: 'bg-amber-100 text-amber-600',
    },
    {
      key: 'ner',
      icon: <Tag className="w-5 h-5" />,
      title: 'NER',
      subtitle: 'Nhận diện thực thể',
      description:
        'Đánh dấu và gán nhãn các thực thể trong văn bản như người, tổ chức, địa điểm hoặc miền nghiệp vụ.',
      activeBg: 'bg-sky-50',
      activeBorder: 'border-sky-400',
      activeText: 'text-sky-700',
      iconBg: 'bg-sky-100 text-sky-600',
    },
    {
      key: 'relation_extraction',
      icon: <ExternalLink className="w-5 h-5" />,
      title: 'Relation Extraction',
      subtitle: 'Trích xuất quan hệ',
      description:
        'Gán nhãn quan hệ giữa các thực thể đã xác định để phục vụ bài toán trích xuất tri thức.',
      activeBg: 'bg-emerald-50',
      activeBorder: 'border-emerald-400',
      activeText: 'text-emerald-700',
      iconBg: 'bg-emerald-100 text-emerald-600',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="relative w-full max-w-3xl bg-surface-0 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-100 flex items-center justify-center">
              <UserCheck className="w-4 h-4 text-brand-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-surface-900">Phân công Task mới</h2>
              <p className="text-xs text-surface-400">Chọn loại bài toán, dataset và danh sách người thực hiện</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-surface-400 hover:text-surface-600 hover:bg-surface-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {/* ── 1. Loại bài toán ── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
              <h3 className="text-sm font-semibold text-surface-800">Loại bài toán gán nhãn</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {ANNOTATION_TYPES.map((t) => {
                const active = annotationType === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setAnnotationType(t.key)}
                    className={`relative text-left rounded-xl border-2 p-4 transition-all cursor-pointer ${
                      active ? `${t.activeBg} ${t.activeBorder}` : 'border-surface-200 hover:border-surface-300 bg-white'
                    }`}
                  >
                    {active && (
                      <span className="absolute top-3 right-3 w-5 h-5 rounded-full bg-brand-600 flex items-center justify-center">
                        <Check className="w-3 h-3 text-white" />
                      </span>
                    )}
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-2.5 ${active ? t.iconBg : 'bg-surface-100 text-surface-400'}`}>
                      {t.icon}
                    </div>
                    <p className={`text-sm font-semibold mb-0.5 ${active ? t.activeText : 'text-surface-800'}`}>{t.title}</p>
                    <p className="text-xs text-surface-400 font-medium mb-1.5">{t.subtitle}</p>
                    <p className="text-xs text-surface-500 leading-relaxed">{t.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── 2. Cấu hình ── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
              <h3 className="text-sm font-semibold text-surface-800">Cấu hình phân công</h3>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              {/* Dataset */}
              <div>
                <label className="block text-xs font-semibold text-surface-500 mb-1.5 uppercase tracking-wide">
                  Dataset <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <select
                    value={datasetId}
                    onChange={(e) => setDatasetId(e.target.value)}
                    className="input-field pr-8 appearance-none cursor-pointer"
                  >
                    <option value="">Chọn dataset…</option>
                    {datasets.map((ds) => (
                      <option key={ds.id} value={ds.id}>
                        {ds.name} ({ds.total_samples} samples)
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none" />
                </div>
                {selectedDataset && (
                  <p className="mt-1.5 text-xs text-surface-400 flex items-center gap-1.5">
                    <Database className="w-3 h-3" />
                    {availableSamples.toLocaleString()} / {selectedDataset.total_samples.toLocaleString()} samples khả dụng
                  </p>
                )}
              </div>
              {/* Label Set */}
              <div>
                <label className="block text-xs font-semibold text-surface-500 mb-1.5 uppercase tracking-wide">
                  Bộ nhãn <span className="text-red-400">*</span>
                </label>
                {labelSets.length === 0 ? (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
                    Chưa cấu hình bộ nhãn. Vào tab "Cấu hình nhãn" để tạo trước.
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <select
                        value={labelSetId}
                        onChange={(e) => setLabelSetId(e.target.value)}
                        className="input-field pr-8 appearance-none cursor-pointer"
                      >
                        <option value="">Chọn bộ nhãn…</option>
                        {labelSets.map((ls) => (
                          <option key={ls.id} value={ls.id}>
                            {ls.name} ({ls.labels.length} nhãn)
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none" />
                    </div>
                    {labelSetId && (() => {
                      const ls = labelSets.find((l) => l.id === labelSetId);
                      return ls ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {ls.labels.slice(0, 5).map((lbl) => (
                            <span
                              key={lbl.id}
                              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium"
                              style={{ backgroundColor: lbl.color + '22', color: lbl.color }}
                            >
                              <span
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{ backgroundColor: lbl.color }}
                              />
                              {lbl.name}
                            </span>
                          ))}
                          {ls.labels.length > 5 && (
                            <span className="text-[10px] text-surface-400">+{ls.labels.length - 5} nhãn</span>
                          )}
                        </div>
                      ) : null;
                    })()}
                  </>
                )}
              </div>
            </div>
            <div>
              <div>
                <label className="block text-xs font-semibold text-surface-500 mb-1.5 uppercase tracking-wide">
                  Phương thức
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { key: 'round_robin', icon: <Shuffle className="w-4 h-4" />, label: 'Round Robin', sub: 'Chia đều' },
                    { key: 'manual',      icon: <ClipboardList className="w-4 h-4" />, label: 'Thủ công', sub: 'Chỉ định' },
                  ] as const).map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setMethod(m.key)}
                      className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all cursor-pointer ${
                        method === m.key
                          ? 'border-brand-500 bg-brand-50 text-brand-700'
                          : 'border-surface-200 text-surface-600 hover:border-surface-300'
                      }`}
                    >
                      {m.icon}
                      <span className="text-xs font-semibold">{m.label}</span>
                      <span className="text-[10px] opacity-60">{m.sub}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── 3. Annotators ── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-[10px] font-bold flex items-center justify-center shrink-0">3</span>
              <h3 className="text-sm font-semibold text-surface-800">Phân công Annotator</h3>
              <span className="text-xs text-surface-400">{annotators.length} annotator trong dự án</span>
            </div>

            {annotators.length === 0 ? (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
                <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-700">Chưa có annotator trong dự án. Thêm thành viên với vai trò Annotator trước.</p>
              </div>
            ) : method === 'round_robin' ? (
              <div className="space-y-2">
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-brand-50 border border-brand-100">
                  <Shuffle className="w-4 h-4 text-brand-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-brand-700">
                    {selectedDataset
                      ? `${availableSamples} sample chia đều cho ${annotators.length} annotator (~${Math.ceil(availableSamples / annotators.length)} sample/người)`
                      : 'Chọn dataset để xem dự tính.'}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {annotators.map((a) => (
                    <div key={a.user_id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-surface-200 bg-surface-50">
                      <div className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-[9px] font-bold shrink-0">
                        {a.full_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-surface-800 truncate">{a.full_name}</p>
                        <p className="text-[10px] text-surface-400 truncate">{a.email}</p>
                      </div>
                      {selectedDataset && (
                        <span className="ml-auto text-xs font-semibold text-brand-600 shrink-0">
                          ~{Math.ceil(availableSamples / annotators.length)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {manualRows.map((row) => (
                  <div key={row.id} className="flex items-center gap-2">
                    <div className="flex-1 relative">
                      <select
                        value={row.annotator_id}
                        onChange={(e) => updateRow(row.id, 'annotator_id', e.target.value)}
                        className="input-field pr-8 appearance-none cursor-pointer"
                      >
                        <option value="">Chọn annotator…</option>
                        {annotators.map((a) => (
                          <option key={a.user_id} value={a.user_id}>{a.full_name}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none" />
                    </div>
                    <div className="w-32">
                      <input
                        type="number"
                        min={1}
                        max={availableSamples}
                        value={row.sample_count}
                        onChange={(e) => updateRow(row.id, 'sample_count', e.target.value)}
                        placeholder="Số sample"
                        className="input-field"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      disabled={manualRows.length === 1}
                      className="p-2 rounded-lg text-surface-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 transition-colors cursor-pointer"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={addRow}
                    className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 font-medium cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    Thêm annotator
                  </button>
                  {totalManual > 0 && (
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                      totalManual > availableSamples ? 'bg-red-50 text-red-600' : 'bg-brand-50 text-brand-600'
                    }`}>
                      Tổng: {totalManual} / {availableSamples}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── 4. Reviewers ── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold flex items-center justify-center shrink-0">4</span>
              <h3 className="text-sm font-semibold text-surface-800">Người Review</h3>
              <span className="text-xs text-surface-400">{reviewers.length} reviewer trong dự án</span>
            </div>

            {reviewers.length === 0 ? (
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-surface-50 border border-surface-200">
                <Info className="w-4 h-4 text-surface-400 mt-0.5 shrink-0" />
                <p className="text-sm text-surface-500">Chưa có reviewer trong dự án. Mọi reviewer được thêm sau đều có thể duyệt task.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Chip selector */}
                <div className="flex flex-wrap gap-2">
                  {reviewers.map((r) => {
                    const selected = selectedReviewerIds.has(r.user_id);
                    return (
                      <button
                        key={r.user_id}
                        type="button"
                        onClick={() => toggleReviewer(r.user_id)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full border-2 text-sm font-medium transition-all cursor-pointer ${
                          selected
                            ? 'border-purple-400 bg-purple-50 text-purple-700'
                            : 'border-surface-200 bg-white text-surface-600 hover:border-purple-200 hover:bg-purple-50/50'
                        }`}
                      >
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                          selected ? 'bg-purple-200 text-purple-700' : 'bg-surface-100 text-surface-500'
                        }`}>
                          {r.full_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        {r.full_name}
                        {selected && <Check className="w-3.5 h-3.5 ml-0.5" />}
                      </button>
                    );
                  })}
                </div>

                {/* Auto-split preview */}
                {selectedReviewerIds.size === 0 && (
                  <p className="text-xs text-surface-400 italic">
                    Không chọn reviewer → mọi reviewer trong dự án đều có thể duyệt.
                  </p>
                )}
                {selectedReviewerIds.size === 1 && tasksToCreate > 0 && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-purple-50 border border-purple-100">
                    <UserCheck className="w-4 h-4 text-purple-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-purple-700">
                      Tất cả {tasksToCreate} task sẽ được giao cho{' '}
                      <strong>{selectedReviewers[0]?.full_name}</strong> review.
                    </p>
                  </div>
                )}
                {selectedReviewerIds.size >= 2 && tasksToCreate > 0 && (
                  <div className="p-3 rounded-lg bg-purple-50 border border-purple-100 space-y-2">
                    <div className="flex items-center gap-2">
                      <Shuffle className="w-4 h-4 text-purple-500 shrink-0" />
                      <p className="text-sm font-medium text-purple-700">
                        Auto-split: {tasksToCreate} task chia đều cho {selectedReviewerIds.size} reviewer
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {selectedReviewers.map((r, idx) => {
                        const count = Math.floor(tasksToCreate / selectedReviewerIds.size) +
                          (idx < tasksToCreate % selectedReviewerIds.size ? 1 : 0);
                        return (
                          <div key={r.user_id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-purple-100">
                            <div className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-[9px] font-bold shrink-0">
                              {r.full_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                            </div>
                            <span className="text-xs text-surface-700 truncate flex-1">{r.full_name}</span>
                            <span className="text-xs font-semibold text-purple-600 shrink-0">{count} task</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-surface-100 shrink-0">
          {error && (
            <div className="flex items-start gap-2 mb-3 p-3 rounded-lg bg-red-50 border border-red-200">
              <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost"
            >
              Huỷ
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !datasetId || !labelSetId || annotators.length === 0 || availableSamples <= 0}
              className="btn-primary disabled:opacity-50"
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Đang phân công…</>
              ) : (
                <><UserCheck className="w-4 h-4" />Phân công Task</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Assign Tab (task list view) ──────────────────────────────
function AssignTab({
  datasets,
  members,
  labelSets,
  tasks,
  projectId,
  onAssigned,
}: {
  datasets: Dataset[];
  members: ProjectMember[];
  labelSets: import('../api/labelApi').LabelSetData[];
  tasks: Task[];
  projectId: string;
  onAssigned: () => void;
}) {
  const [showModal, setShowModal] = useState(false);
  const [detailTask, setDetailTask] = useState<TaskDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editAnnotationType, setEditAnnotationType] = useState<AnnotationType>('text_classification');
  const [editDatasetId, setEditDatasetId] = useState('');
  const [editLabelSetId, setEditLabelSetId] = useState('');
  const [editMethod, setEditMethod] = useState<AssignmentMethod>('round_robin');
  const [editAnnotatorIds, setEditAnnotatorIds] = useState<Set<string>>(new Set());
  const [editReviewerIds, setEditReviewerIds] = useState<Set<string>>(new Set());
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const getDatasetName = (id: string) =>
    datasets.find((d) => d.id === id)?.name ?? id.slice(0, 8) + '…';

  const annotators = members.filter((m) => m.role_in_project === 'annotator');
  const reviewers = members.filter((m) => m.role_in_project === 'reviewer');

  const normalizeStatus = (status?: string | null) =>
    (status ?? '').toLowerCase().replace(/[\s-]+/g, '_');

  const getAssignmentStatus = (task: Task) =>
    normalizeStatus(task.assignment_status ?? task.status);


  const isNotStartedAssignment = (task: Task) =>
    ['not_started', 'todo', 'draft', 'pending'].includes(getAssignmentStatus(task));

  const isInProgressAssignment = (task: Task) =>
    ['in_progress', 'active', 'submitted', 'rework'].includes(getAssignmentStatus(task));

  const canEditAssignment = (task: Task) =>
    isNotStartedAssignment(task) || isInProgressAssignment(task);


  const isSameMemberSet = (left: string[], right: string[]) =>
    left.length === right.length && left.every((id) => right.includes(id));

  const orderedUniqueIds = (values: Array<string | null | undefined>) => {
    const seen = new Set<string>();
    const ids: string[] = [];
    values.forEach((value) => {
      if (value && !seen.has(value)) {
        seen.add(value);
        ids.push(value);
      }
    });
    return ids;
  };

  const ANNOTATION_LABEL: Record<string, { label: string; bg: string; text: string }> = {
    sequence_labeling:   { label: 'Sequence Labeling',    bg: 'bg-brand-50',   text: 'text-brand-700'   },
    text_classification: { label: 'Text Classification',  bg: 'bg-amber-50',   text: 'text-amber-700'   },
    ner:                 { label: 'NER',                  bg: 'bg-sky-50',     text: 'text-sky-700'     },
    relation_extraction: { label: 'Relation Extraction',  bg: 'bg-emerald-50', text: 'text-emerald-700' },
  };

  const getTaskAnnotationType = (task: Task): AnnotationType =>
    (task.annotation_type ?? task.task_type ?? 'sequence_labeling') as AnnotationType;

  const getAnnotationLabel = (task: Task) =>
    ANNOTATION_LABEL[getTaskAnnotationType(task)]?.label ?? getTaskAnnotationType(task);

  const sortAssignmentTasks = (items: Task[]) =>
    [...items].sort((a, b) => {
      const byAssignedAt = (a.assigned_at ?? '').localeCompare(b.assigned_at ?? '');
      return byAssignedAt || a.id.localeCompare(b.id);
    });

  const getAssignmentTasks = (sourceTask: Task) => {
    const sourceType = getTaskAnnotationType(sourceTask);
    const sourceLabelSetId = sourceTask.label_set_id ?? '';
    return sortAssignmentTasks(
      tasks.filter((task) =>
        task.dataset_id === sourceTask.dataset_id &&
        task.assignment_method === sourceTask.assignment_method &&
        task.assigned_by === sourceTask.assigned_by &&
        getTaskAnnotationType(task) === sourceType &&
        (task.label_set_id ?? '') === sourceLabelSetId
      )
    );
  };

  const formatDate = (value: string | null) =>
    value
      ? new Date(value).toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
      : '—';

  const openDetail = async (task: Task) => {
    setLoadingDetail(true);
    setDetailTask(null);
    try {
      const detail = await taskApi.getTask(projectId, task.id);
      setDetailTask(detail);
    } catch (err) {
      showToast('error', extractErrorMessage(err, 'Không thể tải chi tiết task'));
    } finally {
      setLoadingDetail(false);
    }
  };

  const getLabelSet = (id: string | null) =>
    id ? labelSets.find((ls) => ls.id === id) ?? null : null;

  const startEdit = (task: Task) => {
    const assignmentTasks = getAssignmentTasks(task);
    setEditingTask(task);
    setEditAnnotationType(getTaskAnnotationType(task));
    setEditDatasetId(task.dataset_id);
    setEditLabelSetId(task.label_set_id ?? '');
    setEditMethod(task.assignment_method === 'manual' ? 'manual' : 'round_robin');
    setEditAnnotatorIds(new Set(orderedUniqueIds(assignmentTasks.map((item) => item.assignee_id))));
    setEditReviewerIds(new Set(orderedUniqueIds(assignmentTasks.map((item) => item.reviewer_id))));
    setEditError('');
  };

  const saveEdit = async () => {
    if (!editingTask) return;

    const assignmentTasks = getAssignmentTasks(editingTask);
    const originalAnnotatorIds = orderedUniqueIds(assignmentTasks.map((task) => task.assignee_id));
    const originalReviewerIds = orderedUniqueIds(assignmentTasks.map((task) => task.reviewer_id));
    const selectedAnnotatorIds = Array.from(editAnnotatorIds);
    const selectedReviewerIds = Array.from(editReviewerIds);
    const assignmentStatus = getAssignmentStatus(editingTask);
    const canEditFullConfig = isNotStartedAssignment(editingTask);
    const canEditPeople = canEditFullConfig || isInProgressAssignment(editingTask);

    setEditError('');
    if (!canEditPeople) {
      setEditError('Chỉ có thể sửa phân công ở trạng thái Chưa làm hoặc Đang làm.');
      return;
    }
    if (canEditFullConfig && !editDatasetId) {
      setEditError('Chọn dataset để lưu thay đổi.');
      return;
    }
    if (canEditFullConfig && !editLabelSetId) {
      setEditError('Chọn bộ nhãn để lưu thay đổi.');
      return;
    }
    if (selectedAnnotatorIds.length === 0) {
      setEditError('Chọn ít nhất một annotator.');
      return;
    }
    if (isInProgressAssignment(editingTask)) {
      if (selectedAnnotatorIds.length !== originalAnnotatorIds.length) {
        setEditError(`Phân công đang làm phải giữ đúng ${originalAnnotatorIds.length} annotator ban đầu.`);
        return;
      }
      if (selectedReviewerIds.length !== originalReviewerIds.length) {
        setEditError(`Phân công đang làm phải giữ đúng ${originalReviewerIds.length} reviewer ban đầu.`);
        return;
      }
    }

    const selectedDataset = datasets.find((dataset) => dataset.id === editDatasetId);
    const excludedTaskIds = new Set(assignmentTasks.map((task) => task.id));
    const assignedOutsideGroup = tasks
      .filter((task) => task.dataset_id === editDatasetId)
      .filter((task) => !excludedTaskIds.has(task.id))
      .filter((task) => getTaskAnnotationType(task) === editAnnotationType)
      .reduce((sum, task) => sum + (task.sample_count || 0), 0);
    const availableForManual = Math.max(0, (selectedDataset?.total_samples ?? 0) - assignedOutsideGroup);
    const preserveManualCounts =
      editMethod === 'manual' &&
      editDatasetId === editingTask.dataset_id &&
      editAnnotationType === getTaskAnnotationType(editingTask) &&
      selectedAnnotatorIds.length === assignmentTasks.length;

    if (canEditFullConfig && editMethod === 'manual' && !preserveManualCounts && availableForManual <= 0) {
      setEditError('Dataset đã chọn không còn sample khả dụng để chia thủ công.');
      return;
    }

    const manualAssignments =
      canEditFullConfig && editMethod === 'manual'
        ? selectedAnnotatorIds.map((annotatorId, index) => {
            const sampleCount = preserveManualCounts
              ? assignmentTasks[index]?.sample_count ?? 0
              : Math.floor(availableForManual / selectedAnnotatorIds.length) +
                (index < availableForManual % selectedAnnotatorIds.length ? 1 : 0);
            return { annotator_id: annotatorId, sample_count: sampleCount };
          })
        : undefined;

    const payload = canEditFullConfig
      ? {
          status: assignmentStatus,
          dataset_id: editDatasetId,
          method: editMethod,
          annotation_type: editAnnotationType,
          label_set_id: editLabelSetId || null,
          annotator_ids: selectedAnnotatorIds,
          reviewer_ids: selectedReviewerIds,
          assignments: manualAssignments,
        }
      : {
          status: assignmentStatus,
          annotator_ids: selectedAnnotatorIds,
          reviewer_ids: selectedReviewerIds,
        };

    setSavingEdit(true);
    try {
      await taskApi.updateAssignmentByTask(projectId, editingTask.id, payload);
      showToast('success', 'Đã cập nhật phân công');
      setEditingTask(null);
      onAssigned();
    } catch (err) {
      const message = extractErrorMessage(err, 'Cập nhật phân công thất bại');
      setEditError(message);
      showToast('error', message);
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteTask = async (task: Task) => {
    const ok = await confirm(
      `Xóa task phân công cho ${task.assignee_name ?? 'annotator'}?`,
      {
        title: 'Xóa phân công',
        confirmText: 'Xóa',
        cancelText: 'Hủy',
        variant: 'danger',
      }
    );
    if (!ok) return;

    setDeletingId(task.id);
    try {
      await taskApi.deleteTask(projectId, task.id);
      showToast('success', 'Đã xóa phân công');
      onAssigned();
    } catch (err) {
      showToast('error', extractErrorMessage(err, 'Xóa phân công thất bại'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      {showModal && (
        <AssignModal
          datasets={datasets}
          members={members}
          labelSets={labelSets}
          tasks={tasks}
          projectId={projectId}
          onClose={() => setShowModal(false)}
          onAssigned={() => { setShowModal(false); onAssigned(); }}
        />
      )}

      {tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-14 h-14 rounded-2xl bg-brand-100 flex items-center justify-center mb-4">
            <UserCheck className="w-7 h-7 text-brand-500" />
          </div>
          <h3 className="text-base font-semibold text-surface-800 mb-1">Chưa có task nào</h3>
          <p className="text-sm text-surface-500 mb-5">Import dataset và phân công task cho annotator để bắt đầu.</p>
          <button
            onClick={() => setShowModal(true)}
            className="btn-primary cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Phân công mới
          </button>
        </div>
      ) : (
        <div className="bg-surface-0 rounded-xl border border-surface-200 shadow-subtle overflow-hidden">
          {/* Header */}
          <div className="px-5 py-3.5 border-b border-surface-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-surface-800">Danh sách phân công</h3>
              <span className="text-xs text-surface-400">{tasks.length} task</span>
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="btn-primary text-sm py-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Phân công mới
            </button>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-100">
                  <Th>Task</Th>
                  <Th>Người phụ trách</Th>
                  <Th>Samples</Th>
                  <Th>Trạng thái</Th>
                  <Th align="right">Thao tác</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {tasks.map((task) => {
                  const at = task.annotation_type ? ANNOTATION_LABEL[task.annotation_type] : null;
                  return (
                    <tr key={task.id} className="hover:bg-surface-50/50 transition-colors">
                      {/* Task */}
                      <td className="px-5 py-4 min-w-[240px]">
                        <div className="flex flex-col gap-1.5">
                          {at ? (
                            <span className={`inline-flex w-fit items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${at.bg} ${at.text}`}>
                              {task.annotation_type === 'sequence_labeling'
                                ? <Tag className="w-3 h-3" />
                                : <BadgeCheck className="w-3 h-3" />}
                              {at.label}
                            </span>
                          ) : (
                            <span className="text-xs text-surface-400 italic">Chưa xác định</span>
                          )}
                          <p className="text-sm text-surface-700 truncate max-w-[280px]">
                            {getDatasetName(task.dataset_id)}
                          </p>
                        </div>
                      </td>
                      {/* People */}
                      <td className="px-5 py-4 min-w-[220px]">
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-[10px] font-bold shrink-0">
                              {(task.assignee_name ?? '?').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-surface-800 truncate">{task.assignee_name ?? 'Unknown'}</p>
                              <p className="text-[11px] text-surface-400">Annotator</p>
                            </div>
                          </div>
                          <div className="pl-9 text-xs text-surface-500">
                            Review: <span className="font-medium text-surface-700">{task.reviewer_name ?? 'Bất kỳ reviewer'}</span>
                          </div>
                        </div>
                      </td>
                      {/* Samples */}
                      <td className="px-5 py-4">
                        <span className="text-sm font-semibold text-surface-800">{task.sample_count}</span>
                        <span className="ml-1 text-xs text-surface-400">mẫu</span>
                      </td>
                      {/* Status */}
                      <td className="px-5 py-4"><StatusBadge status={getTaskLifecycleStatus(task)} /></td>
                      {/* Actions */}
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openDetail(task)}
                            title="Xem chi tiết"
                            aria-label="Xem chi tiết task"
                            className="p-2 rounded-lg text-surface-500 hover:text-brand-600 hover:bg-brand-50 transition-colors cursor-pointer"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => startEdit(task)}
                            disabled={!canEditAssignment(task)}
                            title={!canEditAssignment(task) ? 'Chỉ sửa được phân công Chưa làm hoặc Đang làm' : 'Sửa phân công'}
                            aria-label="Sửa phân công"
                            className="p-2 rounded-lg text-surface-500 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-surface-500 transition-colors cursor-pointer"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteTask(task)}
                            disabled={!isNotStartedAssignment(task) || deletingId === task.id}
                            title={isNotStartedAssignment(task) ? 'Xóa phân công' : 'Chỉ xóa được phân công Chưa làm'}
                            aria-label="Xóa phân công"
                            className="p-2 rounded-lg text-surface-500 hover:text-red-600 hover:bg-red-50 disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-surface-500 transition-colors cursor-pointer"
                          >
                            {deletingId === task.id
                              ? <Loader2 className="w-4 h-4 animate-spin" />
                              : <Trash2 className="w-4 h-4" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        isOpen={loadingDetail || !!detailTask}
        onClose={() => { setDetailTask(null); setLoadingDetail(false); }}
        title="Chi tiết phân công"
        maxWidth="max-w-2xl"
      >
        {loadingDetail ? (
          <div className="flex items-center justify-center py-12 text-surface-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Đang tải chi tiết...
          </div>
        ) : detailTask ? (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-surface-400 mb-2">Task</p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                    detailTask.annotation_type === 'text_classification'
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-brand-50 text-brand-700'
                  }`}>
                    {detailTask.annotation_type === 'text_classification'
                      ? <BadgeCheck className="w-3 h-3" />
                      : <Tag className="w-3 h-3" />}
                    {getAnnotationLabel(detailTask)}
                  </span>
                  <StatusBadge status={getTaskLifecycleStatus(detailTask)} />
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-surface-400">Samples</p>
                <p className="text-2xl font-semibold text-surface-900">{detailTask.sample_count}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <DetailItem label="Dataset" value={getDatasetName(detailTask.dataset_id)} />
              <DetailItem label="Phương thức" value={detailTask.assignment_method === 'round_robin' ? 'Round Robin' : 'Thủ công'} />
              <DetailItem label="Annotator" value={detailTask.assignee_name ?? 'Unknown'} />
              <DetailItem label="Reviewer" value={detailTask.reviewer_name ?? 'Bất kỳ reviewer'} />
              <DetailItem label="Ngày phân công" value={formatDate(detailTask.assigned_at)} />
              <DetailItem label="Cập nhật lần cuối" value={formatDate(detailTask.updated_at)} />
            </div>

            {(() => {
              const ls = getLabelSet(detailTask.label_set_id ?? null);
              if (!ls) return null;
              return (
                <div className="rounded-xl border border-surface-200 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Tag className="w-3.5 h-3.5 text-surface-400" />
                    <p className="text-xs font-semibold uppercase tracking-wide text-surface-400">Bộ nhãn</p>
                  </div>
                  <p className="text-sm font-medium text-surface-800 mb-2">{ls.name}</p>
                  {ls.labels.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {ls.labels.map((lbl) => (
                        <span
                          key={lbl.id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white"
                          style={{ backgroundColor: lbl.color }}
                        >
                          {lbl.name}
                          {lbl.shortcut_key && (
                            <span className="opacity-70 text-[10px]">[{lbl.shortcut_key}]</span>
                          )}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-surface-400">Chưa có nhãn nào</p>
                  )}
                </div>
              );
            })()}

            {detailTask.progress && (
              <div className="rounded-xl border border-surface-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-surface-800">Tiến độ</span>
                  <span className="text-sm text-surface-500">
                    {detailTask.progress.completed}/{detailTask.progress.total}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-surface-100 overflow-hidden">
                  <div
                    className="h-full bg-brand-500"
                    style={{
                      width: `${detailTask.progress.total > 0
                        ? (detailTask.progress.completed / detailTask.progress.total) * 100
                        : 0}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {detailTask.task_samples?.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-surface-400 mb-2">Mẫu dữ liệu</p>
                <div className="max-h-48 overflow-y-auto rounded-xl border border-surface-200 divide-y divide-surface-100">
                  {detailTask.task_samples.slice(0, 8).map((sample) => (
                    <div key={sample.id} className="px-3 py-2.5">
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <span className="text-xs font-medium text-surface-500">#{sample.sample_order + 1}</span>
                        <StatusBadge status={sample.status} />
                      </div>
                      <p className="text-sm text-surface-700 line-clamp-2">{sample.content ?? 'Không có nội dung'}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      {editingTask && (() => {
        const closeEdit = () => {
          setEditingTask(null);
          setEditError('');
        };
        const assignmentTasks = getAssignmentTasks(editingTask);
        const taskAnnotationType = getTaskAnnotationType(editingTask);
        const assignmentStatus = getAssignmentStatus(editingTask);
        const canEditFullConfig = isNotStartedAssignment(editingTask);
        const canEditPeople = canEditFullConfig || isInProgressAssignment(editingTask);
        const originalAnnotatorIds = orderedUniqueIds(assignmentTasks.map((task) => task.assignee_id));
        const originalReviewerIds = orderedUniqueIds(assignmentTasks.map((task) => task.reviewer_id));
        const selectedAnnotatorIds = Array.from(editAnnotatorIds);
        const selectedReviewerIds = Array.from(editReviewerIds);
        const annotatorCountOk =
          !isInProgressAssignment(editingTask) || selectedAnnotatorIds.length === originalAnnotatorIds.length;
        const reviewerCountOk =
          !isInProgressAssignment(editingTask) || selectedReviewerIds.length === originalReviewerIds.length;
        const canChooseReviewers =
          canEditPeople && (!isInProgressAssignment(editingTask) || originalReviewerIds.length > 0);
        const currentLabelSet = getLabelSet(editLabelSetId || editingTask.label_set_id);
        const originalMethod = editingTask.assignment_method === 'manual' ? 'manual' : 'round_robin';
        const configChanged =
          canEditFullConfig &&
          (editAnnotationType !== taskAnnotationType ||
            editDatasetId !== editingTask.dataset_id ||
            (editLabelSetId || '') !== (editingTask.label_set_id ?? '') ||
            editMethod !== originalMethod);
        const peopleChanged =
          canEditPeople &&
          (!isSameMemberSet(selectedAnnotatorIds, originalAnnotatorIds) ||
            !isSameMemberSet(selectedReviewerIds, originalReviewerIds));
        const hasChanges = configChanged || peopleChanged;
        const assigneeOptions = annotators.map((member) => ({
          user_id: member.user_id,
          full_name: member.full_name,
          email: member.email,
        }));
        assignmentTasks.forEach((task) => {
          if (!assigneeOptions.some((member) => member.user_id === task.assignee_id)) {
            assigneeOptions.push({
              user_id: task.assignee_id,
              full_name: task.assignee_name ?? 'Annotator hiện tại',
              email: '',
            });
          }
        });
        const reviewerOptions = reviewers.map((member) => ({
          user_id: member.user_id,
          full_name: member.full_name,
          email: member.email,
        }));
        assignmentTasks.forEach((task) => {
          if (task.reviewer_id && !reviewerOptions.some((member) => member.user_id === task.reviewer_id)) {
            reviewerOptions.push({
              user_id: task.reviewer_id,
              full_name: task.reviewer_name ?? 'Reviewer hiện tại',
              email: '',
            });
          }
        });
        const annotationOptions = [
          {
            key: 'text_classification' as AnnotationType,
            icon: <BadgeCheck className="w-5 h-5" />,
            title: 'Text Classification',
            subtitle: 'Phân loại văn bản',
            activeBorder: 'border-amber-400',
            activeIcon: 'bg-amber-100 text-amber-600',
            activeCheck: 'bg-amber-500',
          },
          {
            key: 'ner' as AnnotationType,
            icon: <Tag className="w-5 h-5" />,
            title: 'NER',
            subtitle: 'Nhận diện thực thể',
            activeBorder: 'border-sky-400',
            activeIcon: 'bg-sky-100 text-sky-600',
            activeCheck: 'bg-sky-500',
          },
          {
            key: 'relation_extraction' as AnnotationType,
            icon: <ExternalLink className="w-5 h-5" />,
            title: 'Relation Extraction',
            subtitle: 'Trích xuất quan hệ',
            activeBorder: 'border-emerald-400',
            activeIcon: 'bg-emerald-100 text-emerald-600',
            activeCheck: 'bg-emerald-500',
          },
        ];
        if (taskAnnotationType === 'sequence_labeling') {
          annotationOptions.unshift({
            key: 'sequence_labeling' as AnnotationType,
            icon: <Tag className="w-5 h-5" />,
            title: 'Sequence Labeling',
            subtitle: 'Gán nhãn chuỗi',
            activeBorder: 'border-brand-400',
            activeIcon: 'bg-brand-100 text-brand-600',
            activeCheck: 'bg-brand-600',
          });
        }

        const toggleAnnotator = (id: string) => {
          if (!canEditPeople) return;
          setEditAnnotatorIds((prev) => {
            if (isInProgressAssignment(editingTask) && originalAnnotatorIds.length === 1) {
              return new Set([id]);
            }
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
          });
        };

        const toggleReviewer = (id: string) => {
          if (!canChooseReviewers) return;
          setEditReviewerIds((prev) => {
            if (isInProgressAssignment(editingTask) && originalReviewerIds.length === 1) {
              return new Set([id]);
            }
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
          });
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
              onClick={closeEdit}
            />
            <div className="relative w-full max-w-4xl bg-surface-0 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-surface-100 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                    <Pencil className="w-4 h-4 text-amber-600" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-surface-900">Sửa phân công</h2>
                    <p className="text-xs text-surface-400">
                      {canEditFullConfig
                        ? 'Trạng thái Chưa làm: có thể cấu hình lại toàn bộ phân công'
                        : 'Trạng thái Đang làm: chỉ thay annotator và reviewer, giữ nguyên cấu hình gốc'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={closeEdit}
                  className="p-1.5 rounded-lg text-surface-400 hover:text-surface-600 hover:bg-surface-100 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
                    <h3 className="text-sm font-semibold text-surface-800">Loại bài toán gán nhãn</h3>
                    {!canEditFullConfig && <span className="text-xs text-surface-400">Đã khóa</span>}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {annotationOptions.map((option) => {
                      const active = editAnnotationType === option.key;
                      const style = ANNOTATION_LABEL[option.key];
                      return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => canEditFullConfig && setEditAnnotationType(option.key)}
                          disabled={!canEditFullConfig}
                          className={`relative text-left rounded-xl border-2 p-4 transition-all ${
                            active ? `${style.bg} ${option.activeBorder}` : 'border-surface-200 bg-white hover:border-surface-300'
                          } ${canEditFullConfig ? 'cursor-pointer' : 'cursor-default opacity-80'}`}
                        >
                          {active && (
                            <span className={`absolute top-3 right-3 w-5 h-5 rounded-full ${option.activeCheck} flex items-center justify-center`}>
                              <Check className="w-3 h-3 text-white" />
                            </span>
                          )}
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-2.5 ${
                            active ? option.activeIcon : 'bg-surface-100 text-surface-400'
                          }`}>
                            {option.icon}
                          </div>
                          <p className={`text-sm font-semibold mb-0.5 ${active ? style.text : 'text-surface-800'}`}>{option.title}</p>
                          <p className="text-xs text-surface-400 font-medium">{option.subtitle}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
                    <h3 className="text-sm font-semibold text-surface-800">Cấu hình phân công</h3>
                    {!canEditFullConfig && <span className="text-xs text-surface-400">Dataset, bộ nhãn và method đã khóa</span>}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-surface-500 mb-1.5 uppercase tracking-wide">Dataset</label>
                      <div className="relative">
                        <select
                          value={editDatasetId}
                          onChange={(e) => setEditDatasetId(e.target.value)}
                          disabled={!canEditFullConfig}
                          className={`input-field pr-8 appearance-none ${canEditFullConfig ? 'cursor-pointer' : 'bg-surface-50 cursor-not-allowed'}`}
                        >
                          <option value="">Chọn dataset...</option>
                          {datasets.map((dataset) => (
                            <option key={dataset.id} value={dataset.id}>
                              {dataset.name} ({dataset.total_samples} samples)
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-surface-500 mb-1.5 uppercase tracking-wide">Bộ nhãn</label>
                      <div className="relative">
                        <select
                          value={editLabelSetId}
                          onChange={(e) => setEditLabelSetId(e.target.value)}
                          disabled={!canEditFullConfig}
                          className={`input-field pr-8 appearance-none ${canEditFullConfig ? 'cursor-pointer' : 'bg-surface-50 cursor-not-allowed'}`}
                        >
                          <option value="">Chọn bộ nhãn...</option>
                          {labelSets.map((labelSet) => (
                            <option key={labelSet.id} value={labelSet.id}>
                              {labelSet.name} ({labelSet.labels.length} nhãn)
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none" />
                      </div>
                      {currentLabelSet && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {currentLabelSet.labels.slice(0, 5).map((label) => (
                            <span
                              key={label.id}
                              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium"
                              style={{ backgroundColor: label.color + '22', color: label.color }}
                            >
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: label.color }} />
                              {label.name}
                            </span>
                          ))}
                          {currentLabelSet.labels.length > 5 && (
                            <span className="text-[10px] text-surface-400">+{currentLabelSet.labels.length - 5} nhãn</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-surface-500 mb-1.5 uppercase tracking-wide">Method</label>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          { key: 'round_robin' as AssignmentMethod, icon: <Shuffle className="w-4 h-4" />, label: 'Round-robin' },
                          { key: 'manual' as AssignmentMethod, icon: <ClipboardList className="w-4 h-4" />, label: 'Thủ công' },
                        ]).map((item) => (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => canEditFullConfig && setEditMethod(item.key)}
                            disabled={!canEditFullConfig}
                            className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                              editMethod === item.key
                                ? 'border-brand-500 bg-brand-50 text-brand-700'
                                : 'border-surface-200 text-surface-600 hover:border-surface-300'
                            } ${canEditFullConfig ? 'cursor-pointer' : 'cursor-default opacity-80'}`}
                          >
                            {item.icon}
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-surface-200 bg-surface-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-surface-400 mb-2">Trạng thái</p>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={assignmentStatus} />
                        <span className="text-xs text-surface-400">{assignmentTasks.length} task chunk</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-[10px] font-bold flex items-center justify-center shrink-0">3</span>
                    <h3 className="text-sm font-semibold text-surface-800">Annotator</h3>
                    <span className={`text-xs ${annotatorCountOk ? 'text-surface-400' : 'text-red-500'}`}>
                      {isInProgressAssignment(editingTask)
                        ? `Cần đúng ${originalAnnotatorIds.length} người, đang chọn ${selectedAnnotatorIds.length}`
                        : `${selectedAnnotatorIds.length} người được chọn`}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {assigneeOptions.map((member) => {
                      const selected = editAnnotatorIds.has(member.user_id);
                      return (
                        <button
                          key={member.user_id}
                          type="button"
                          onClick={() => toggleAnnotator(member.user_id)}
                          disabled={!canEditPeople}
                          className={`relative flex items-center gap-2.5 rounded-xl border-2 px-3 py-2.5 text-left transition-all ${
                            selected
                              ? 'border-brand-400 bg-brand-50'
                              : 'border-surface-200 bg-white hover:border-surface-300'
                          } ${canEditPeople ? 'cursor-pointer' : 'cursor-default opacity-90'}`}
                        >
                          <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-[10px] font-bold shrink-0">
                            {member.full_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-surface-800 truncate">{member.full_name}</p>
                            {member.email && <p className="text-[11px] text-surface-400 truncate">{member.email}</p>}
                          </div>
                          {selected && <Check className="w-4 h-4 text-brand-600 ml-auto shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold flex items-center justify-center shrink-0">4</span>
                    <h3 className="text-sm font-semibold text-surface-800">Reviewer</h3>
                    <span className={`text-xs ${reviewerCountOk ? 'text-surface-400' : 'text-red-500'}`}>
                      {isInProgressAssignment(editingTask)
                        ? `Cần đúng ${originalReviewerIds.length} người, đang chọn ${selectedReviewerIds.length}`
                        : `${selectedReviewerIds.length} reviewer được chọn`}
                    </span>
                  </div>
                  {isInProgressAssignment(editingTask) && originalReviewerIds.length === 0 && (
                    <div className="mb-3 flex items-start gap-2 p-3 rounded-lg bg-surface-50 border border-surface-200">
                      <Info className="w-4 h-4 text-surface-400 mt-0.5 shrink-0" />
                      <p className="text-sm text-surface-500">Phân công ban đầu chưa gán reviewer cụ thể, nên trạng thái Đang làm không thể thêm reviewer mới.</p>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {!isInProgressAssignment(editingTask) && (
                      <button
                        type="button"
                        onClick={() => setEditReviewerIds(new Set())}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full border-2 text-sm font-medium transition-all ${
                          selectedReviewerIds.length === 0
                            ? 'border-purple-400 bg-purple-50 text-purple-700'
                            : 'border-surface-200 bg-white text-surface-600 hover:border-purple-200 hover:bg-purple-50/50'
                        } cursor-pointer`}
                      >
                        Bất kỳ reviewer
                        {selectedReviewerIds.length === 0 && <Check className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    {reviewerOptions.map((member) => {
                      const selected = editReviewerIds.has(member.user_id);
                      return (
                        <button
                          key={member.user_id}
                          type="button"
                          onClick={() => toggleReviewer(member.user_id)}
                          disabled={!canChooseReviewers}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-full border-2 text-sm font-medium transition-all ${
                            selected
                              ? 'border-purple-400 bg-purple-50 text-purple-700'
                              : 'border-surface-200 bg-white text-surface-600 hover:border-purple-200 hover:bg-purple-50/50'
                          } ${canChooseReviewers ? 'cursor-pointer' : 'cursor-default opacity-70'}`}
                        >
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                            selected ? 'bg-purple-200 text-purple-700' : 'bg-surface-100 text-surface-500'
                          }`}>
                            {member.full_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                          {member.full_name}
                          {selected && <Check className="w-3.5 h-3.5 ml-0.5" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-surface-100 shrink-0">
                {editError && (
                  <div className="flex items-start gap-2 mb-3 p-3 rounded-lg bg-red-50 border border-red-200">
                    <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-red-700">{editError}</p>
                  </div>
                )}
                <div className="flex items-center justify-end gap-3">
                  <button type="button" onClick={closeEdit} className="btn-ghost">
                    Hủy
                  </button>
                  <button
                    type="button"
                    onClick={saveEdit}
                    disabled={
                      savingEdit ||
                      !hasChanges ||
                      !canEditPeople ||
                      (canEditFullConfig && (!editDatasetId || !editLabelSetId)) ||
                      selectedAnnotatorIds.length === 0 ||
                      !annotatorCountOk ||
                      !reviewerCountOk
                    }
                    className="btn-primary disabled:opacity-50"
                  >
                    {savingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
                    Lưu thay đổi
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {ConfirmDialog}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// MEMBERS TAB
// ─────────────────────────────────────────────────────────────
function MembersTab({
  members,
  projectId,
  onRefresh,
}: {
  members: ProjectMember[];
  projectId: string;
  onRefresh: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<string>('');
  const { showToast } = useToast();

  const startEdit = (m: ProjectMember) => {
    setEditingId(m.user_id);
    setPendingRole(m.role_in_project);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setPendingRole('');
  };

  const saveRole = async (m: ProjectMember) => {
    if (pendingRole === m.role_in_project) { cancelEdit(); return; }
    setSavingId(m.user_id);
    try {
      await taskApi.updateMember(projectId, m.user_id, pendingRole);
      onRefresh();
      setEditingId(null);
    } catch (err: any) {
      showToast('error', err.response?.data?.detail || 'Không thể đổi vai trò');
    } finally {
      setSavingId(null);
    }
  };

  if (members.length === 0) {
    return (
      <EmptyTab
        icon={Users}
        title="Chưa có thành viên"
        description="Thêm thành viên vào dự án để bắt đầu."
      />
    );
  }

  return (
    <div className="bg-surface-0 rounded-xl border border-surface-200 shadow-subtle overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-surface-100">
            <Th>Thành viên</Th>
            <Th>Email</Th>
            <Th>Vai trò</Th>
            <Th>Ngày tham gia</Th>
            <Th align="right">Thao tác</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-100">
          {members.map((m) => {
            const isEditing = editingId === m.user_id;
            const isSaving = savingId === m.user_id;
            return (
              <tr key={m.id} className="hover:bg-surface-50/50 transition-colors">
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold shrink-0">
                      {m.full_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <span className="text-sm font-medium text-surface-900">{m.full_name}</span>
                  </div>
                </td>
                <td className="px-5 py-3.5 text-sm text-surface-500">{m.email}</td>
                <td className="px-5 py-3.5">
                  {isEditing ? (
                    <div className="relative inline-block">
                      <select
                        value={pendingRole}
                        onChange={(e) => setPendingRole(e.target.value)}
                        className="appearance-none text-xs font-semibold border rounded-md px-2 py-1 pr-6 outline-none focus:ring-2 focus:ring-brand-300 bg-white"
                        autoFocus
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-surface-400 pointer-events-none" />
                    </div>
                  ) : (
                    <span
                      className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md border ${
                        ROLE_COLORS[m.role_in_project] || 'bg-surface-100 text-surface-600 border-surface-200'
                      }`}
                    >
                      {ROLE_LABELS[m.role_in_project] || m.role_in_project}
                    </span>
                  )}
                </td>
                <td className="px-5 py-3.5 text-sm text-surface-500">
                  {new Date(m.joined_at).toLocaleDateString('vi-VN', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })}
                </td>
                <td className="px-5 py-3.5 text-right">
                  {isEditing ? (
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => saveRole(m)}
                        disabled={isSaving}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 transition-colors cursor-pointer"
                      >
                        {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Lưu'}
                      </button>
                      <button
                        onClick={cancelEdit}
                        disabled={isSaving}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium text-surface-600 bg-surface-100 hover:bg-surface-200 transition-colors cursor-pointer"
                      >
                        Hủy
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => startEdit(m)}
                      className="p-1.5 rounded-lg text-surface-400 hover:text-brand-600 hover:bg-brand-50 transition-colors cursor-pointer"
                      title="Đổi vai trò"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// IMPORT DATA MODAL
// ─────────────────────────────────────────────────────────────
const ACCEPTED_FORMATS = ['.csv', '.json', '.jsonl'] as const;

function parseFileSamples(text: string, ext: string): string[] {
  if (ext === 'json') {
    const data = JSON.parse(text);
    if (Array.isArray(data)) {
      return data.map((item) =>
        typeof item === 'string' ? item : (item.content ?? item.text ?? item.sentence ?? JSON.stringify(item))
      );
    }
    return [];
  }
  if (ext === 'jsonl') {
    return text
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          const obj = JSON.parse(l);
          return typeof obj === 'string' ? obj : (obj.content ?? obj.text ?? obj.sentence ?? JSON.stringify(obj));
        } catch {
          return l.trim();
        }
      })
      .filter(Boolean);
  }
  if (ext === 'csv') {
    const lines = text.split('\n').filter((l) => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
    const contentIdx = headers.findIndex((h) => ['content', 'text', 'sentence', 'data', 'sample'].includes(h));
    return lines
      .slice(1)
      .map((line) => {
        const cols = line.split(',');
        const val = contentIdx >= 0 && cols[contentIdx] ? cols[contentIdx] : cols[0];
        return val?.replace(/^"|"$/g, '').trim() ?? '';
      })
      .filter(Boolean);
  }
  return [];
}

type FileEntry = { id: string; file: File; samples: string[]; error?: string };

function ImportDataModal({
  isOpen,
  onClose,
  onImported,
  projectId,
}: {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void;
  projectId: string;
}) {
  const [mode, setMode] = useState<'file' | 'text'>('file');
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null);
  const [rawText, setRawText] = useState('');
  const [textName, setTextName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setMode('file');
      setFileEntries([]);
      setPreviewEntry(null);
      setRawText('');
      setTextName('');
      setIsDragging(false);
      setError('');
    }
  }, [isOpen]);

  const processFiles = (inputFiles: FileList | File[]) => {
    Array.from(inputFiles).forEach((f) => {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      const id = `${f.name}-${f.size}`;
      if (!['csv', 'json', 'jsonl'].includes(ext)) {
        setFileEntries((prev) =>
          prev.some((e) => e.id === id) ? prev : [...prev, { id, file: f, samples: [], error: 'Định dạng không hỗ trợ' }]
        );
        return;
      }
      setFileEntries((prev) =>
        prev.some((e) => e.id === id) ? prev : [...prev, { id, file: f, samples: [] }]
      );
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        let entry: FileEntry;
        try {
          const samples = parseFileSamples(text, ext);
          entry = { id, file: f, samples, error: samples.length === 0 ? 'Không tìm thấy dữ liệu' : undefined };
        } catch {
          entry = { id, file: f, samples: [], error: 'Không thể đọc file' };
        }
        setFileEntries((prev) => prev.map((e) => (e.id === id ? entry : e)));
      };
      reader.readAsText(f, 'utf-8');
    });
  };

  const removeFile = (id: string) => setFileEntries((prev) => prev.filter((e) => e.id !== id));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'file') {
      const valid = fileEntries.filter((e) => !e.error && e.samples.length > 0);
      if (valid.length === 0) { setError('Thêm ít nhất một file hợp lệ trước khi import.'); return; }
      setSubmitting(true);
      const errs: string[] = [];
      for (const entry of valid) {
        const ext = entry.file.name.split('.').pop()?.toLowerCase() ?? 'json';
        try {
          await taskApi.importDataset(projectId, {
            name: entry.file.name.replace(/\.[^.]+$/, ''),
            source_format: ext,
            samples: entry.samples.map((content) => ({ content })),
          });
        } catch (err: unknown) {
          errs.push(`${entry.file.name}: ${extractErrorMessage(err, 'Import thất bại')}`);
        }
      }
      setSubmitting(false);
      if (errs.length > 0) setError(errs.join('\n'));
      else onImported();
    } else {
      const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) { setError('Nhập ít nhất một dòng văn bản.'); return; }
      setSubmitting(true);
      try {
        await taskApi.importDataset(projectId, {
          name: textName.trim() || `Dataset ${new Date().toISOString().slice(0, 10)}`,
          source_format: 'json',
          samples: lines.map((content) => ({ content })),
        });
        onImported();
      } catch (err: unknown) {
        setError(extractErrorMessage(err, 'Import thất bại'));
      } finally {
        setSubmitting(false);
      }
    }
  };

  const textLineCount = rawText.split('\n').filter((l) => l.trim()).length;
  const validEntries = fileEntries.filter((e) => !e.error && e.samples.length > 0);
  const totalSamples = mode === 'file'
    ? validEntries.reduce((s, e) => s + e.samples.length, 0)
    : textLineCount;
  const canSubmit = mode === 'file' ? validEntries.length > 0 : textLineCount > 0;

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Import dữ liệu" maxWidth="max-w-xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200/60">
              <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
              <p className="text-sm text-red-700 whitespace-pre-line">{error}</p>
            </div>
          )}

          {/* Mode toggle */}
          <div className="flex rounded-lg border border-surface-200 overflow-hidden">
            <button type="button" onClick={() => setMode('file')}
              className={`flex-1 py-2 text-sm font-medium transition-colors cursor-pointer ${mode === 'file' ? 'bg-brand-50 text-brand-700' : 'text-surface-500 hover:text-surface-700'}`}>
              Upload file
            </button>
            <button type="button" onClick={() => setMode('text')}
              className={`flex-1 py-2 text-sm font-medium border-l border-surface-200 transition-colors cursor-pointer ${mode === 'text' ? 'bg-brand-50 text-brand-700' : 'text-surface-500 hover:text-surface-700'}`}>
              Dán văn bản
            </button>
          </div>

          {/* File upload */}
          {mode === 'file' && (
            <div className="space-y-2">
              <div
                className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${isDragging ? 'border-brand-400 bg-brand-50' : 'border-surface-200 hover:border-brand-400'}`}
                onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); processFiles(e.dataTransfer.files); }}
              >
                <Upload className={`w-8 h-8 mx-auto mb-2 ${isDragging ? 'text-brand-400' : 'text-surface-300'}`} />
                <p className="text-sm text-surface-600 mb-1">Chọn file hoặc kéo thả vào đây</p>
                <p className="text-xs text-surface-400 mb-3">
                  Định dạng chấp nhận:{' '}
                  {ACCEPTED_FORMATS.map((f) => (
                    <span key={f} className="inline-block font-mono bg-surface-100 text-surface-600 px-1.5 py-0.5 rounded mx-0.5">{f}</span>
                  ))}
                </p>
                <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium cursor-pointer hover:bg-brand-700 transition-colors">
                  <Upload className="w-4 h-4" />
                  Chọn file
                  <input type="file" multiple accept=".csv,.json,.jsonl" className="hidden"
                    onChange={(e) => { if (e.target.files) processFiles(e.target.files); e.target.value = ''; }} />
                </label>
              </div>

              {/* File list */}
              {fileEntries.length > 0 && (
                <div className="space-y-1.5">
                  {fileEntries.map((entry) => (
                    <div key={entry.id}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${entry.error ? 'bg-red-50 border-red-200/60' : entry.samples.length === 0 ? 'bg-surface-50 border-surface-200' : 'bg-emerald-50 border-emerald-200/60'}`}>
                      <span className={`w-2 h-2 rounded-full shrink-0 ${entry.error ? 'bg-red-400' : entry.samples.length === 0 ? 'bg-surface-300' : 'bg-emerald-500'}`} />
                      <span className={`text-sm truncate flex-1 ${entry.error ? 'text-red-700' : 'text-emerald-700'}`}>{entry.file.name}</span>
                      {entry.error ? (
                        <span className="text-xs text-red-500 shrink-0">{entry.error}</span>
                      ) : entry.samples.length === 0 ? (
                        <Loader2 className="w-3.5 h-3.5 text-surface-400 animate-spin shrink-0" />
                      ) : (
                        <span className="text-xs text-emerald-600 shrink-0">{entry.samples.length} samples</span>
                      )}
                      <button type="button"
                        onClick={() => setPreviewEntry(entry)}
                        disabled={entry.samples.length === 0}
                        className="p-1 rounded text-surface-400 hover:text-brand-600 hover:bg-brand-50 transition-colors disabled:opacity-30 cursor-pointer"
                        title="Xem trước"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button type="button"
                        onClick={() => removeFile(entry.id)}
                        className="p-1 rounded text-surface-400 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
                        title="Xoá"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Text paste */}
          {mode === 'text' && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1.5">Tên dataset</label>
                <input type="text" placeholder="VD: News Articles Batch 1" value={textName}
                  onChange={(e) => setTextName(e.target.value)} className="input-field" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-surface-700">Văn bản <span className="text-red-400">*</span></label>
                  <span className="text-xs text-surface-400">{textLineCount} sample{textLineCount !== 1 ? 's' : ''}</span>
                </div>
                <textarea rows={7}
                  placeholder={`Mỗi dòng là một sample:\n\nViệt Nam là quốc gia ở Đông Nam Á.\nApple Inc. was founded by Steve Jobs.`}
                  value={rawText} onChange={(e) => setRawText(e.target.value)}
                  className="input-field resize-none font-mono text-[13px] leading-relaxed" />
                <p className="text-xs text-surface-400 mt-1.5">Mỗi dòng không trống sẽ thành một data sample.</p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">Hủy</button>
            <button type="submit" disabled={submitting || !canSubmit} className="btn-primary">
              {submitting
                ? <><Loader2 className="w-4 h-4 animate-spin" />Đang import…</>
                : <><Upload className="w-4 h-4" />Import {totalSamples > 0 ? `${totalSamples} samples` : ''}{mode === 'file' && validEntries.length > 1 ? ` · ${validEntries.length} files` : ''}</>
              }
            </button>
          </div>
        </form>
      </Modal>

      {/* Preview modal */}
      {previewEntry && (
        <Modal isOpen onClose={() => setPreviewEntry(null)} title={`Xem trước — ${previewEntry.file.name}`} maxWidth="max-w-2xl">
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
            {previewEntry.samples.slice(0, 100).map((s, i) => (
              <div key={i} className="flex gap-3 px-3 py-2 rounded-lg bg-surface-50 border border-surface-200/60">
                <span className="text-xs text-surface-400 font-mono shrink-0 mt-0.5 w-6 text-right">{i + 1}</span>
                <p className="text-sm text-surface-700 leading-relaxed">{s}</p>
              </div>
            ))}
            {previewEntry.samples.length > 100 && (
              <p className="text-xs text-surface-400 text-center py-2">
                … và {previewEntry.samples.length - 100} sample khác
              </p>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// ASSIGN TASKS MODAL
// ─────────────────────────────────────────────────────────────
function AssignTasksModal({
  isOpen,
  onClose,
  onAssigned,
  projectId,
  datasets,
  annotators,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAssigned: () => void;
  projectId: string;
  datasets: Dataset[];
  annotators: ProjectMember[];
}) {
  const [datasetId, setDatasetId] = useState('');
  const [method, setMethod] = useState<'round_robin' | 'manual'>('round_robin');
  const [manualAssignee, setManualAssignee] = useState('');
  const [manualCount, setManualCount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setDatasetId(datasets[0]?.id || '');
      setMethod('round_robin');
      setManualAssignee('');
      setManualCount('');
      setError('');
    }
  }, [isOpen, datasets]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!datasetId) {
      setError('Select a dataset.');
      return;
    }
    if (method === 'round_robin' && annotators.length === 0) {
      setError('No annotators in this project. Add annotator members first.');
      return;
    }
    if (method === 'manual' && (!manualAssignee || !manualCount)) {
      setError('Select an annotator and enter sample count for manual assignment.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await taskApi.assignTasks(projectId, {
        dataset_id: datasetId,
        method,
        assignments:
          method === 'manual'
            ? [{ annotator_id: manualAssignee, sample_count: parseInt(manualCount, 10) }]
            : undefined,
      });
      onAssigned();
    } catch (err: any) {
      setError(extractErrorMessage(err, 'Assignment failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Assign Tasks">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200/60">
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Dataset select */}
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1.5">
            Dataset <span className="text-red-400">*</span>
          </label>
          <div className="relative">
            <select
              required
              value={datasetId}
              onChange={(e) => setDatasetId(e.target.value)}
              className="input-field pr-8 appearance-none"
            >
              <option value="">Select dataset…</option>
              {datasets.map((ds) => (
                <option key={ds.id} value={ds.id}>
                  {ds.name} ({ds.total_samples} samples)
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none" />
          </div>
        </div>

        {/* Method */}
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-2">
            Assignment Method
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMethod('round_robin')}
              className={`flex items-center gap-2.5 p-3 rounded-lg border-2 text-left transition-all ${
                method === 'round_robin'
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-surface-200 text-surface-600 hover:border-surface-300'
              } cursor-pointer`}
            >
              <Shuffle className="w-4 h-4 shrink-0" />
              <div>
                <span className="text-sm font-medium block">Round Robin</span>
                <span className="text-[11px] opacity-70">Split evenly</span>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setMethod('manual')}
              className={`flex items-center gap-2.5 p-3 rounded-lg border-2 text-left transition-all ${
                method === 'manual'
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-surface-200 text-surface-600 hover:border-surface-300'
              } cursor-pointer`}
            >
              <ClipboardList className="w-4 h-4 shrink-0" />
              <div>
                <span className="text-sm font-medium block">Manual</span>
                <span className="text-[11px] opacity-70">Choose annotator</span>
              </div>
            </button>
          </div>
        </div>

        {/* Round robin info */}
        {method === 'round_robin' && (
          <div className="p-3 rounded-lg bg-surface-50 border border-surface-200/60">
            <p className="text-sm text-surface-600">
              Samples will be split evenly across{' '}
              <strong>{annotators.length}</strong> annotator
              {annotators.length !== 1 ? 's' : ''} in this project.
            </p>
            {annotators.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {annotators.map((a) => (
                  <span key={a.user_id} className="text-xs bg-white border border-surface-200 rounded-full px-2.5 py-0.5 text-surface-600">
                    {a.full_name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Manual assignment fields */}
        {method === 'manual' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1.5">
                Annotator <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <select
                  value={manualAssignee}
                  onChange={(e) => setManualAssignee(e.target.value)}
                  className="input-field pr-8 appearance-none"
                >
                  <option value="">Select…</option>
                  {annotators.map((a) => (
                    <option key={a.user_id} value={a.user_id}>
                      {a.full_name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1.5">
                Sample Count <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                min="1"
                value={manualCount}
                onChange={(e) => setManualCount(e.target.value)}
                placeholder="e.g. 50"
                className="input-field"
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? (
              <><Loader2 className="w-4 h-4 animate-spin" />Assigning…</>
            ) : (
              <><Shuffle className="w-4 h-4" />Assign Tasks</>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// ADD MEMBER MODAL
// ─────────────────────────────────────────────────────────────
function AddMemberModal({
  isOpen,
  onClose,
  onAdded,
  projectId,
  existingMemberIds,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdded: () => void;
  projectId: string;
  existingMemberIds: string[];
}) {
  const [allUsers, setAllUsers] = useState<AdminUser[]>([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [role, setRole] = useState('annotator');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedUser('');
      setRole('annotator');
      setError('');
      setSearch('');
      setDropdownOpen(false);
      setLoadingUsers(true);
      import('../api/axiosClient').then(({ default: axios }) => {
        axios.get('/api/v1/users/search', { params: { page_size: 500 } })
          .then((r) => setAllUsers(r.data.users))
          .catch(() => {})
          .finally(() => setLoadingUsers(false));
      });
    }
  }, [isOpen]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (dropdownOpen) setTimeout(() => searchRef.current?.focus(), 50);
  }, [dropdownOpen]);

  const availableUsers = allUsers.filter(
    (u) => !existingMemberIds.includes(u.id)
  );

  const filteredUsers = search.trim()
    ? availableUsers.filter(
        (u) =>
          u.full_name.toLowerCase().includes(search.toLowerCase()) ||
          u.email.toLowerCase().includes(search.toLowerCase())
      )
    : availableUsers;

  const selectedUserObj = allUsers.find((u) => u.id === selectedUser);

  const handleSelect = (userId: string) => {
    setSelectedUser(userId);
    setDropdownOpen(false);
    setSearch('');
    setError('');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedUser) {
      setError('Vui lòng chọn thành viên.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await taskApi.addMember(projectId, selectedUser, role);
      onAdded();
    } catch (err: any) {
      setError(extractErrorMessage(err, 'Không thể thêm thành viên'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Thêm thành viên dự án">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200/60">
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Custom user dropdown */}
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1.5">
            Thành viên <span className="text-red-400">*</span>
          </label>
          <div className="relative" ref={dropdownRef}>
            {/* Trigger */}
            <button
              type="button"
              onClick={() => !loadingUsers && setDropdownOpen((v) => !v)}
              disabled={loadingUsers}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-sm transition-all focus:outline-none ${
                dropdownOpen
                  ? 'border-brand-400 ring-2 ring-brand-100'
                  : 'border-surface-200 hover:border-surface-300'
              } bg-white disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              {loadingUsers ? (
                <span className="flex items-center gap-2 text-surface-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Đang tải danh sách…
                </span>
              ) : selectedUserObj ? (
                <span className="flex items-center gap-2.5 min-w-0">
                  <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-[10px] font-bold shrink-0">
                    {selectedUserObj.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </span>
                  <span className="flex flex-col min-w-0 text-left">
                    <span className="text-sm font-medium text-surface-900 truncate">{selectedUserObj.full_name}</span>
                    <span className="text-xs text-surface-400 truncate">{selectedUserObj.email}</span>
                  </span>
                </span>
              ) : (
                <span className="text-surface-400">-- Chọn người dùng --</span>
              )}
              <ChevronDown className={`w-4 h-4 text-surface-400 shrink-0 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown panel */}
            {dropdownOpen && (
              <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white rounded-xl border border-surface-200 shadow-lg overflow-hidden">
                {/* Search */}
                <div className="p-2 border-b border-surface-100">
                  <input
                    ref={searchRef}
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Tìm kiếm..."
                    className="w-full px-3 py-2 text-sm rounded-lg border border-surface-200 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-400 transition-all"
                  />
                </div>

                {/* List */}
                <div className="max-h-52 overflow-y-auto">
                  {filteredUsers.length === 0 ? (
                    <p className="text-sm text-surface-400 text-center py-6">
                      {availableUsers.length === 0
                        ? 'Tất cả người dùng đã là thành viên'
                        : 'Không tìm thấy người dùng'}
                    </p>
                  ) : (
                    filteredUsers.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => handleSelect(u.id)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-brand-50 transition-colors text-left"
                      >
                        <span className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold shrink-0">
                          {u.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </span>
                        <span className="flex flex-col min-w-0">
                          <span className="text-sm font-semibold text-surface-900">{u.full_name}</span>
                          <span className="text-xs text-surface-400">{u.email}</span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Role selector */}
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1.5">
            Vai trò trong dự án <span className="text-red-400">*</span>
          </label>
          <div className="relative">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="input-field pr-8 appearance-none"
            >
              <option value="annotator">Annotator</option>
              <option value="reviewer">Reviewer</option>
              <option value="project_owner">Project Owner</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none" />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">Hủy</button>
          <button type="submit" disabled={submitting || !selectedUser} className="btn-primary">
            {submitting ? (
              <><Loader2 className="w-4 h-4 animate-spin" />Đang thêm…</>
            ) : (
              <><UserPlus className="w-4 h-4" />Thêm thành viên</>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// LABELS TAB
// ─────────────────────────────────────────────────────────────
const LABEL_COLORS = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E', '#14B8A6',
  '#3B82F6', '#6366F1', '#A855F7', '#EC4899', '#78716C',
];

const COLOR_PALETTE = [
  '#EF4444', '#F97316', '#F59E0B', '#EAB308', '#84CC16',
  '#22C55E', '#10B981', '#14B8A6', '#06B6D4', '#3B82F6',
  '#60A5FA', '#6366F1', '#8B5CF6', '#A855F7', '#D946EF',
  '#EC4899', '#F43F5E', '#64748B', '#78716C', '#1E293B',
];

function TextClassIllustration() {
  return (
    <div className="absolute top-4 left-4 right-4 space-y-2.5">
      {/* Sample text box */}
      <div className="bg-surface-100 rounded-xl px-3 py-2.5 border border-surface-200">
        <p className="text-[11px] text-surface-600 leading-relaxed">
          To have faith is to trust yourself to the water.
        </p>
      </div>
      {/* Choice panel */}
      <div className="bg-white rounded-xl px-3 py-2.5 border border-surface-200">
        <p className="text-[11px] font-bold text-surface-800 mb-2">Choose text sentiment</p>
        <div className="flex items-center gap-4">
          {[
            { label: 'Positive', n: 1, checked: true },
            { label: 'Negative', n: 2, checked: false },
            { label: 'Neutral',  n: 3, checked: false },
          ].map(({ label, n, checked }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${checked ? 'bg-brand-500' : 'border-2 border-surface-300 bg-white'}`}>
                {checked && <Check className="w-2.5 h-2.5 text-white" />}
              </div>
              <span className="text-[10px] font-semibold text-surface-800">
                {label}<sup className="text-[7px] ml-px">[{n}]</sup>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NERIllustration() {
  const tags = [
    { text: 'Person', color: '#EF4444', n: 1 },
    { text: 'Fact',   color: '#F97316', n: 2 },
    { text: 'Date',   color: '#6366F1', n: 3 },
    { text: 'Time',   color: '#14B8A6', n: 4 },
    { text: 'Ordinal',color: '#A855F7', n: 5 },
  ];
  return (
    <div className="absolute top-4 left-4 right-4 space-y-2.5">
      {/* Label tag bar */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {tags.map((t) => (
          <span
            key={t.n}
            className="px-2 py-0.5 rounded text-[10px] font-bold text-white"
            style={{ backgroundColor: t.color }}
          >
            {t.text}<sup className="text-[7px] ml-px">[{t.n}]</sup>
          </span>
        ))}
      </div>
      {/* Text with entity highlights */}
      <div className="bg-white rounded-xl px-3 py-2.5 border border-surface-200">
        <p className="text-[10px] text-surface-700 leading-loose">
          <mark className="rounded px-0.5 not-italic font-medium" style={{ backgroundColor: '#EF444428', color: '#EF4444' }}>
            Opossums<sup className="text-[7px]">[Person]</sup>
          </mark>
          {' are '}
          <mark className="rounded px-0.5 not-italic font-medium" style={{ backgroundColor: '#F9731628', color: '#F97316' }}>
            usually solitary<sup className="text-[7px]">[Fact]</sup>
          </mark>
          {' and nomadic, staying in one area. '}
          <mark className="rounded px-0.5 not-italic font-medium" style={{ backgroundColor: '#A855F728', color: '#A855F7' }}>
            much<sup className="text-[7px]">[Ordinal]</sup>
          </mark>
          {' effort into building their own.'}
        </p>
      </div>
    </div>
  );
}

function RelationExtractionIllustration() {
  return (
    <div className="absolute top-3 left-4 right-4 space-y-2">
      {/* Entity chips */}
      <div className="flex items-center gap-1.5">
        <span className="px-2 py-0.5 rounded text-[10px] font-bold text-white" style={{ backgroundColor: '#8B5CF6' }}>Apple Inc</span>
        <span className="text-[9px] text-surface-400 font-medium">ORG</span>
        <span className="ml-1 px-2 py-0.5 rounded text-[10px] font-bold text-white" style={{ backgroundColor: '#F97316' }}>Tim Cook</span>
        <span className="text-[9px] text-surface-400 font-medium">PER</span>
      </div>
      {/* Arrow relation */}
      <div className="bg-white rounded-xl px-3 py-2 border border-surface-200">
        <div className="flex items-center gap-2 text-[10px]">
          <span className="px-1.5 py-0.5 rounded font-bold text-white" style={{ backgroundColor: '#8B5CF6' }}>Apple</span>
          <div className="flex-1 flex flex-col items-center gap-0.5">
            <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">CEO_OF</span>
            <div className="relative w-full flex items-center">
              <div className="flex-1 h-px bg-emerald-400" />
              <svg width="6" height="6" viewBox="0 0 6 6" className="text-emerald-400 shrink-0">
                <path d="M0 0 L6 3 L0 6 Z" fill="currentColor" />
              </svg>
            </div>
          </div>
          <span className="px-1.5 py-0.5 rounded font-bold text-white" style={{ backgroundColor: '#F97316' }}>Tim</span>
        </div>
      </div>
      {/* Second relation */}
      <div className="bg-white rounded-xl px-3 py-1.5 border border-surface-200">
        <div className="flex items-center gap-2 text-[10px]">
          <span className="px-1.5 py-0.5 rounded font-bold text-white" style={{ backgroundColor: '#F97316' }}>Tim</span>
          <div className="flex-1 flex flex-col items-center gap-0.5">
            <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">WORKS_AT</span>
            <div className="relative w-full flex items-center">
              <div className="flex-1 h-px bg-blue-400" />
              <svg width="6" height="6" viewBox="0 0 6 6" className="text-blue-400 shrink-0">
                <path d="M0 0 L6 3 L0 6 Z" fill="currentColor" />
              </svg>
            </div>
          </div>
          <span className="px-1.5 py-0.5 rounded font-bold text-white" style={{ backgroundColor: '#8B5CF6' }}>Apple</span>
        </div>
      </div>
    </div>
  );
}

function LabelsTab({
  labelSets,
  projectId,
  onRefresh,
}: {
  labelSets: LabelSetData[];
  projectId: string;
  onRefresh: () => void;
}) {
  const [showTextClass, setShowTextClass] = useState(false);
  const [showNER, setShowNER] = useState(false);
  const [showRE, setShowRE] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [setTypes, setSetTypes] = useState<Record<string, 'tc' | 'sl' | 're'>>({});
  const [editingSet, setEditingSet] = useState<{ set: LabelSetData; type: 'tc' | 'sl' | 're' } | null>(null);
  const { confirm, ConfirmDialog } = useConfirm();
  const { showToast } = useToast();

  const handleDeleteLabel = async (labelSetId: string, labelId: string) => {
    if (!await confirm('Xoá nhãn này?', { title: 'Xóa nhãn', variant: 'danger', confirmText: 'Xóa' })) return;
    setDeleting(labelId);
    try {
      await labelApi.deleteLabel(projectId, labelSetId, labelId);
      onRefresh();
    } catch (err: unknown) {
      showToast('error', extractErrorMessage(err, 'Xoá nhãn thất bại'));
    } finally {
      setDeleting(null);
    }
  };

  const handleDeleteSet = async (ls: LabelSetData) => {
    if (!await confirm(`Xoá bộ nhãn "${ls.name}" và toàn bộ nhãn bên trong?`, { title: 'Xóa bộ nhãn', variant: 'danger', confirmText: 'Xóa' })) return;
    try {
      await labelApi.deleteLabelSet(projectId, ls.id);
      onRefresh();
    } catch (err: unknown) {
      showToast('error', extractErrorMessage(err, 'Xoá bộ nhãn thất bại'));
    }
  };

  const populatedSets = labelSets.filter((ls) => ls.labels.length > 0);

  const TYPE_BADGE: Record<'tc' | 'sl' | 're', { label: string; cls: string }> = {
    tc: { label: 'Text Classification',  cls: 'bg-brand-50 text-brand-600' },
    sl: { label: 'Sequence Labeling',    cls: 'bg-purple-50 text-purple-600' },
    re: { label: 'Relation Extraction',  cls: 'bg-emerald-50 text-emerald-600' },
  };

  return (
    <div className="space-y-6">
      {ConfirmDialog}
      {/* Type selection cards */}
      <p className="text-sm font-semibold text-surface-600">Chọn bài toán để cấu hình nhãn</p>
      <div className="grid grid-cols-3 gap-4">
        <button
          onClick={() => setShowTextClass(true)}
          className="group relative h-44 rounded-2xl border-2 border-surface-200 bg-white overflow-hidden
            hover:border-brand-400 hover:scale-[1.02] transition-all duration-200 shadow-subtle hover:shadow-card text-left cursor-pointer"
        >
          <TextClassIllustration />
          <div className="absolute inset-0 bg-gradient-to-t from-white via-white/60 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <p className="text-base font-bold text-surface-900">Text Classification</p>
            <p className="text-xs text-surface-500 mt-0.5">Gán nhãn phân loại cho toàn bộ văn bản</p>
          </div>
        </button>

        <button
          onClick={() => setShowNER(true)}
          className="group relative h-44 rounded-2xl border-2 border-surface-200 bg-white overflow-hidden
            hover:border-brand-400 hover:scale-[1.02] transition-all duration-200 shadow-subtle hover:shadow-card text-left cursor-pointer"
        >
          <NERIllustration />
          <div className="absolute inset-0 bg-gradient-to-t from-white via-white/60 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <p className="text-base font-bold text-surface-900">Sequence Labeling</p>
            <p className="text-xs text-surface-500 mt-0.5">Đánh dấu thực thể trong từng đoạn văn bản</p>
          </div>
        </button>

        <button
          onClick={() => setShowRE(true)}
          className="group relative h-44 rounded-2xl border-2 border-surface-200 bg-white overflow-hidden
            hover:border-emerald-400 hover:scale-[1.02] transition-all duration-200 shadow-subtle hover:shadow-card text-left cursor-pointer"
        >
          <RelationExtractionIllustration />
          <div className="absolute inset-0 bg-gradient-to-t from-white via-white/50 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <p className="text-base font-bold text-surface-900">Relation Extraction</p>
            <p className="text-xs text-surface-500 mt-0.5">Gán quan hệ giữa các thực thể trong văn bản</p>
          </div>
        </button>
      </div>

      {/* Section divider */}
      {populatedSets.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-surface-200" />
          <span className="text-xs font-semibold text-surface-400 tracking-widest uppercase">Danh sách Labels</span>
          <div className="flex-1 h-px bg-surface-200" />
        </div>
      )}

      {/* Existing label sets */}
      {populatedSets.length > 0 && (
        <div className="space-y-4">
          {populatedSets.map((ls) => {
            const typeKey = setTypes[ls.id];
            const badge = typeKey ? TYPE_BADGE[typeKey] : null;
            return (
              <div key={ls.id} className="bg-surface-0 rounded-xl border border-surface-200 shadow-subtle overflow-hidden">
                <div className="px-5 py-3 border-b border-surface-100 flex items-center gap-2">
                  <Tag className="w-4 h-4 text-surface-400 shrink-0" />
                  <h3 className="text-sm font-semibold text-surface-800">{ls.name}</h3>
                  <span className="text-xs text-surface-400">{ls.labels.length} nhãn</span>
                  {badge && (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${badge.cls}`}>
                      {badge.label}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-0.5">
                    <button
                      onClick={() => setEditingSet({ set: ls, type: typeKey ?? 'sl' })}
                      className="p-1.5 rounded-md text-surface-400 hover:text-brand-600 hover:bg-brand-50 transition-colors cursor-pointer"
                      title="Chỉnh sửa"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteSet(ls)}
                      className="p-1.5 rounded-md text-surface-400 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
                      title="Xoá bộ nhãn"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {ls.labels.map((label) => (
                    <div
                      key={label.id}
                      className="group flex items-center gap-3 px-3.5 py-2.5 rounded-lg border border-surface-200/60 hover:border-surface-300 transition-colors"
                    >
                      <span className="w-4 h-4 rounded shrink-0" style={{ backgroundColor: label.color }} />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-surface-800 block truncate">{label.name}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          {label.shortcut_key && (
                            <kbd className="text-[10px] font-mono text-surface-400 bg-surface-100 px-1 py-0.5 rounded border border-surface-200">
                              {label.shortcut_key}
                            </kbd>
                          )}
                          {label.is_required && (
                            <span className="text-[10px] text-red-500 font-medium">Required</span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteLabel(ls.id, label.id)}
                        disabled={deleting === label.id}
                        className="p-1 rounded text-surface-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                      >
                        {deleting === label.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create modals */}
      <TextClassificationModal
        isOpen={showTextClass}
        onClose={() => setShowTextClass(false)}
        onCreated={(setId) => { setSetTypes((p) => ({ ...p, [setId]: 'tc' })); setShowTextClass(false); onRefresh(); }}
        projectId={projectId}
      />
      <NERLabelModal
        isOpen={showNER}
        onClose={() => setShowNER(false)}
        onCreated={(setId) => { setSetTypes((p) => ({ ...p, [setId]: 'sl' })); setShowNER(false); onRefresh(); }}
        projectId={projectId}
      />
      <RelationExtractionModal
        isOpen={showRE}
        onClose={() => setShowRE(false)}
        onCreated={(setId) => { setSetTypes((p) => ({ ...p, [setId]: 're' })); setShowRE(false); onRefresh(); }}
        projectId={projectId}
      />

      {/* Edit modals */}
      {editingSet?.type === 'tc' && (
        <TextClassificationModal
          isOpen
          onClose={() => setEditingSet(null)}
          onCreated={(setId) => { setSetTypes((p) => ({ ...p, [setId]: 'tc' })); setEditingSet(null); onRefresh(); }}
          projectId={projectId}
          editingSet={editingSet.set}
        />
      )}
      {editingSet?.type === 'sl' && (
        <NERLabelModal
          isOpen
          onClose={() => setEditingSet(null)}
          onCreated={(setId) => { setSetTypes((p) => ({ ...p, [setId]: 'sl' })); setEditingSet(null); onRefresh(); }}
          projectId={projectId}
          editingSet={editingSet.set}
        />
      )}
      {editingSet?.type === 're' && (
        <RelationExtractionModal
          isOpen
          onClose={() => setEditingSet(null)}
          onCreated={(setId) => { setSetTypes((p) => ({ ...p, [setId]: 're' })); setEditingSet(null); onRefresh(); }}
          projectId={projectId}
          editingSet={editingSet.set}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TEXT CLASSIFICATION MODAL
// ─────────────────────────────────────────────────────────────
function TextClassificationModal({
  isOpen,
  onClose,
  onCreated,
  projectId,
  editingSet,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (setId: string) => void;
  projectId: string;
  editingSet?: LabelSetData;
}) {
  const [setName, setSetName] = useState('Phân loại văn bản');
  const [choicesText, setChoicesText] = useState('');
  const [customColors, setCustomColors] = useState<Record<string, string>>({});
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setSetName(editingSet?.name ?? 'Phân loại văn bản');
      setChoicesText(editingSet ? editingSet.labels.map((l) => l.name).join('\n') : '');
      setCustomColors(editingSet ? Object.fromEntries(editingSet.labels.map((l) => [l.name, l.color])) : {});
      setOpenPicker(null);
      setError('');
    }
  }, [isOpen, editingSet]);

  const choices = choicesText.split('\n').map((s) => s.trim()).filter(Boolean);

  const handleSubmit = async () => {
    if (choices.length === 0) return;
    setSubmitting(true);
    setError('');
    try {
      let targetSetId: string;
      if (editingSet) {
        targetSetId = editingSet.id;
        if (setName.trim() && setName.trim() !== editingSet.name) {
          await labelApi.updateLabelSet(projectId, targetSetId, { name: setName.trim() });
        }
        for (let i = 0; i < choices.length; i++) {
          const existing = editingSet.labels[i];
          const color = getColor(choices[i], i);
          if (existing) {
            await labelApi.updateLabel(projectId, targetSetId, existing.id, {
              name: choices[i],
              color,
              sort_order: i,
            });
          } else {
            await labelApi.createLabel(projectId, targetSetId, {
              name: choices[i],
              color,
              sort_order: i,
            });
          }
        }
        for (const removedLabel of editingSet.labels.slice(choices.length)) {
          await labelApi.deleteLabel(projectId, targetSetId, removedLabel.id);
        }
      } else {
        const newSet = await labelApi.createLabelSet(projectId, setName.trim() || 'Phân loại văn bản');
        targetSetId = newSet.id;
        for (let i = 0; i < choices.length; i++) {
          await labelApi.createLabel(projectId, targetSetId, {
            name: choices[i],
            color: customColors[choices[i]] ?? LABEL_COLORS[i % LABEL_COLORS.length],
          });
        }
      }
      onCreated(targetSetId);
    } catch (err) {
      setError(extractErrorMessage(err, 'Tạo nhãn thất bại'));
    } finally {
      setSubmitting(false);
    }
  };

  const getColor = (name: string, idx: number) =>
    customColors[name] ?? editingSet?.labels[idx]?.color ?? LABEL_COLORS[idx % LABEL_COLORS.length];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editingSet ? 'Chỉnh sửa — Text Classification' : 'Text Classification'} maxWidth="max-w-4xl">
      <div className="grid grid-cols-2 gap-6">
        {/* Left: config */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1.5">Tên bộ nhãn</label>
            <input
              type="text"
              value={setName}
              onChange={(e) => setSetName(e.target.value)}
              className="input-field"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1.5">
              Các lựa chọn
              <span className="ml-1.5 text-xs font-normal text-surface-400">(mỗi dòng một lựa chọn)</span>
            </label>
            <textarea
              value={choicesText}
              onChange={(e) => setChoicesText(e.target.value)}
              placeholder={'Tích cực\nTiêu cực\nTrung lập'}
              rows={6}
              className="input-field resize-none"
            />
          </div>
          {choices.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {choices.map((c, i) => (
                <div key={i} className="relative">
                  <button
                    type="button"
                    title="Đổi màu"
                    onClick={() => setOpenPicker(openPicker === c ? null : c)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white hover:brightness-90 transition-all cursor-pointer"
                    style={{ backgroundColor: getColor(c, i) }}
                  >
                    {c}
                    <span className="w-2.5 h-2.5 rounded-full bg-white/30 flex items-center justify-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
                    </span>
                  </button>
                  {openPicker === c && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setOpenPicker(null)} />
                      <div className="absolute top-9 left-0 z-20 bg-white rounded-xl shadow-elevated border border-surface-200 p-2.5 grid grid-cols-5 gap-1.5" style={{ width: 154 }}>
                        {COLOR_PALETTE.map((col) => (
                          <button
                            key={col}
                            type="button"
                            onClick={() => { setCustomColors((p) => ({ ...p, [c]: col })); setOpenPicker(null); }}
                            className={`w-6 h-6 rounded-full hover:scale-110 transition-transform border-2 cursor-pointer ${getColor(c, i) === col ? 'border-surface-800 scale-110' : 'border-transparent'}`}
                            style={{ backgroundColor: col }}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: preview */}
        <div>
          <p className="text-sm font-medium text-surface-700 mb-3">Xem trước</p>
          <div className="border border-surface-200 rounded-xl bg-surface-50 overflow-hidden">
            <div className="px-4 py-3 border-b border-surface-200 bg-white">
              <p className="text-xs text-surface-400 font-medium uppercase tracking-wide mb-1">Văn bản</p>
              <p className="text-sm text-surface-600 leading-relaxed">
                Đây là ví dụ về văn bản cần được phân loại. Annotator sẽ đọc nội dung này và chọn nhãn phù hợp bên dưới.
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-surface-400 font-medium uppercase tracking-wide mb-2.5">Nhãn</p>
              {choices.length === 0 ? (
                <p className="text-xs text-surface-400 italic">Thêm các lựa chọn để xem trước</p>
              ) : (
                <div className="space-y-2">
                  {choices.map((c, i) => (
                    <div key={i} className="flex items-center gap-2.5">
                      <div className="w-4 h-4 rounded border-2 border-surface-300 shrink-0" />
                      <span className="text-sm text-surface-700">{c}</span>
                      <span className="ml-auto w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: getColor(c, i) }} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200/60">
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} disabled={submitting} className="btn-ghost">Hủy</button>
        <button
          onClick={handleSubmit}
          disabled={choices.length === 0 || submitting}
          className="btn-primary"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {editingSet ? 'Lưu thay đổi' : 'Tạo nhãn'}
        </button>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// NER LABEL MODAL
// ─────────────────────────────────────────────────────────────
function NERLabelModal({
  isOpen,
  onClose,
  onCreated,
  projectId,
  editingSet,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (setId: string) => void;
  projectId: string;
  editingSet?: LabelSetData;
}) {
  const [setName, setSetName] = useState('Thực thể văn bản');
  const [labelsText, setLabelsText] = useState('');
  const [customColors, setCustomColors] = useState<Record<string, string>>({});
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setSetName(editingSet?.name ?? 'Thực thể văn bản');
      setLabelsText(editingSet ? editingSet.labels.map((l) => l.name).join('\n') : '');
      setCustomColors(editingSet ? Object.fromEntries(editingSet.labels.map((l) => [l.name, l.color])) : {});
      setOpenPicker(null);
      setError('');
    }
  }, [isOpen, editingSet]);

  const labelNames = labelsText.split('\n').map((s) => s.trim()).filter(Boolean);

  const handleSubmit = async () => {
    if (labelNames.length === 0) return;
    setSubmitting(true);
    setError('');
    try {
      let targetSetId: string;
      if (editingSet) {
        targetSetId = editingSet.id;
        if (setName.trim() && setName.trim() !== editingSet.name) {
          await labelApi.updateLabelSet(projectId, targetSetId, { name: setName.trim() });
        }
        for (let i = 0; i < labelNames.length; i++) {
          const existing = editingSet.labels[i];
          const color = getColor(labelNames[i], i);
          if (existing) {
            await labelApi.updateLabel(projectId, targetSetId, existing.id, {
              name: labelNames[i],
              color,
              sort_order: i,
            });
          } else {
            await labelApi.createLabel(projectId, targetSetId, {
              name: labelNames[i],
              color,
              sort_order: i,
            });
          }
        }
        for (const removedLabel of editingSet.labels.slice(labelNames.length)) {
          await labelApi.deleteLabel(projectId, targetSetId, removedLabel.id);
        }
      } else {
        const newSet = await labelApi.createLabelSet(projectId, setName.trim() || 'Thực thể văn bản');
        targetSetId = newSet.id;
        for (let i = 0; i < labelNames.length; i++) {
          await labelApi.createLabel(projectId, targetSetId, {
            name: labelNames[i],
            color: customColors[labelNames[i]] ?? LABEL_COLORS[i % LABEL_COLORS.length],
          });
        }
      }
      onCreated(targetSetId);
    } catch (err) {
      setError(extractErrorMessage(err, 'Tạo nhãn thất bại'));
    } finally {
      setSubmitting(false);
    }
  };

  const getColor = (name: string, idx: number) =>
    customColors[name] ?? editingSet?.labels[idx]?.color ?? LABEL_COLORS[idx % LABEL_COLORS.length];

  const sampleSpans: { text: string; idx: number }[] = [
    { text: 'Nguyễn Văn A', idx: 0 },
    { text: ' làm việc tại ', idx: -1 },
    { text: 'Hà Nội', idx: 2 },
    { text: ', CEO của ', idx: -1 },
    { text: 'Công ty ABC', idx: 1 },
    { text: ' từ năm ', idx: -1 },
    { text: '2024', idx: 3 },
    { text: '.', idx: -1 },
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editingSet ? 'Chỉnh sửa — Sequence Labeling' : 'Sequence Labeling'} maxWidth="max-w-4xl">
      <div className="grid grid-cols-2 gap-6">
        {/* Left: config */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1.5">Tên bộ nhãn</label>
            <input
              type="text"
              value={setName}
              onChange={(e) => setSetName(e.target.value)}
              className="input-field"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1.5">
              Tên các nhãn
              <span className="ml-1.5 text-xs font-normal text-surface-400">(mỗi dòng một nhãn)</span>
            </label>
            <textarea
              value={labelsText}
              onChange={(e) => setLabelsText(e.target.value)}
              placeholder={'PER\nORG\nLOC\nDATE'}
              rows={6}
              className="input-field resize-none"
            />
          </div>
          {labelNames.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {labelNames.map((name, i) => (
                <div key={i} className="relative">
                  <button
                    type="button"
                    title="Đổi màu"
                    onClick={() => setOpenPicker(openPicker === name ? null : name)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white hover:brightness-90 transition-all cursor-pointer"
                    style={{ backgroundColor: getColor(name, i) }}
                  >
                    {name}
                    <span className="w-2.5 h-2.5 rounded-full bg-white/30 flex items-center justify-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
                    </span>
                  </button>
                  {openPicker === name && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setOpenPicker(null)} />
                      <div className="absolute top-9 left-0 z-20 bg-white rounded-xl shadow-elevated border border-surface-200 p-2.5 grid grid-cols-5 gap-1.5" style={{ width: 154 }}>
                        {COLOR_PALETTE.map((col) => (
                          <button
                            key={col}
                            type="button"
                            onClick={() => { setCustomColors((p) => ({ ...p, [name]: col })); setOpenPicker(null); }}
                            className={`w-6 h-6 rounded-full hover:scale-110 transition-transform border-2 cursor-pointer ${getColor(name, i) === col ? 'border-surface-800 scale-110' : 'border-transparent'}`}
                            style={{ backgroundColor: col }}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: NER preview */}
        <div>
          <p className="text-sm font-medium text-surface-700 mb-3">Xem trước</p>
          <div className="border border-surface-200 rounded-xl bg-surface-50 overflow-hidden">
            <div className="px-4 py-3 border-b border-surface-200 bg-white">
              <p className="text-xs text-surface-400 font-medium uppercase tracking-wide mb-2">Văn bản</p>
              <p className="text-sm text-surface-700 leading-loose">
                {sampleSpans.map((span, i) =>
                  span.idx === -1 ? (
                    <span key={i}>{span.text}</span>
                  ) : (
                    <mark
                      key={i}
                      className="rounded px-1 font-medium not-italic"
                      style={{
                        backgroundColor: (LABEL_COLORS[span.idx] ?? '#3B82F6') + '28',
                        color: LABEL_COLORS[span.idx] ?? '#3B82F6',
                      }}
                    >
                      {span.text}
                    </mark>
                  )
                )}
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-surface-400 font-medium uppercase tracking-wide mb-2.5">Nhãn</p>
              {labelNames.length === 0 ? (
                <p className="text-xs text-surface-400 italic">Thêm tên nhãn để xem trước</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {labelNames.map((name, i) => (
                    <span
                      key={i}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium text-white"
                      style={{ backgroundColor: getColor(name, i) }}
                    >
                      {name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200/60">
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} disabled={submitting} className="btn-ghost">Hủy</button>
        <button
          onClick={handleSubmit}
          disabled={labelNames.length === 0 || submitting}
          className="btn-primary"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {editingSet ? 'Lưu thay đổi' : 'Tạo nhãn'}
        </button>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// RELATION EXTRACTION MODAL
// ─────────────────────────────────────────────────────────────
const RE_NER_GROUP_NAME = 'NER Labels';
const RE_RELATION_GROUP_NAME = 'Relation Labels';

function normalizeGroupName(name: string) {
  return name.trim().toLowerCase();
}

function isNerGroupName(name: string) {
  const normalized = normalizeGroupName(name);
  return normalized.includes('ner') || normalized.includes('entity') || normalized.includes('thực thể');
}

function isRelationGroupName(name: string) {
  const normalized = normalizeGroupName(name);
  return normalized.includes('relation') || normalized.includes('quan hệ');
}

function RelationExtractionModal({
  isOpen,
  onClose,
  onCreated,
  projectId,
  editingSet,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (setId: string) => void;
  projectId: string;
  editingSet?: LabelSetData;
}) {
  const [setName, setSetName] = useState('Quan hệ thực thể');
  const [nerLabelsText, setNerLabelsText] = useState('');
  const [labelsText, setLabelsText] = useState('');
  const [customColors, setCustomColors] = useState<Record<string, string>>({});
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      const nerGroupIds = new Set(
        (editingSet?.groups ?? [])
          .filter((group) => isNerGroupName(group.name))
          .map((group) => group.id)
      );
      const relationGroupIds = new Set(
        (editingSet?.groups ?? [])
          .filter((group) => isRelationGroupName(group.name))
          .map((group) => group.id)
      );
      const nerLabels = editingSet?.labels.filter((label) =>
        label.label_group_id ? nerGroupIds.has(label.label_group_id) : false
      ) ?? [];
      const relationLabels = editingSet?.labels.filter((label) =>
        label.label_group_id ? relationGroupIds.has(label.label_group_id) : true
      ) ?? [];

      setSetName(editingSet?.name ?? 'Quan hệ thực thể');
      setNerLabelsText(editingSet ? (nerLabels.length > 0 ? nerLabels.map((l) => l.name).join('\n') : 'PERSON\nORG\nLOCATION') : 'PERSON\nORG\nLOCATION');
      setLabelsText(editingSet ? relationLabels.map((l) => l.name).join('\n') : 'works_for\nfounded_by\nlocated_in\nacquired\npart_of\nrelated_to');
      setCustomColors(editingSet ? Object.fromEntries(editingSet.labels.map((l) => [l.name, l.color])) : {});
      setOpenPicker(null);
      setError('');
    }
  }, [isOpen, editingSet]);

  const nerLabelNames = nerLabelsText.split('\n').map((s) => s.trim()).filter(Boolean);
  const labelNames = labelsText.split('\n').map((s) => s.trim()).filter(Boolean);
  const getColor = (name: string, idx: number) =>
    customColors[name] ?? editingSet?.labels.find((label) => label.name === name)?.color ?? LABEL_COLORS[idx % LABEL_COLORS.length];

  const handleSubmit = async () => {
    if (nerLabelNames.length === 0 || labelNames.length === 0) return;
    setSubmitting(true);
    setError('');
    try {
      let targetSetId: string;
      if (editingSet) {
        targetSetId = editingSet.id;
        if (setName.trim() && setName.trim() !== editingSet.name) {
          await labelApi.updateLabelSet(projectId, targetSetId, { name: setName.trim() });
        }
      } else {
        const newSet = await labelApi.createLabelSet(projectId, setName.trim() || 'Quan hệ thực thể');
        targetSetId = newSet.id;
      }

      const ensureGroup = async (
        groupName: string,
        sortOrder: number,
        matcher: (name: string) => boolean
      ) => {
        const existingGroup = editingSet?.groups.find((group) => matcher(group.name));
        if (existingGroup) return existingGroup;
        return labelApi.createLabelGroup(projectId, targetSetId, {
          name: groupName,
          sort_order: sortOrder,
        });
      };

      const nerGroup = await ensureGroup(RE_NER_GROUP_NAME, 0, isNerGroupName);
      const relationGroup = await ensureGroup(RE_RELATION_GROUP_NAME, 1, isRelationGroupName);

      const syncLabels = async (
        names: string[],
        groupId: string,
        startIndex: number,
        includeUngrouped = false
      ) => {
        const existingLabels = (editingSet?.labels ?? []).filter((label) =>
          label.label_group_id === groupId || (includeUngrouped && !label.label_group_id)
        );

        for (let i = 0; i < names.length; i++) {
          const existing = existingLabels[i];
          const color = getColor(names[i], startIndex + i);
          if (existing) {
            await labelApi.updateLabel(projectId, targetSetId, existing.id, {
              name: names[i],
              color,
              sort_order: i,
              label_group_id: groupId,
            });
          } else {
            await labelApi.createLabel(projectId, targetSetId, {
              name: names[i],
              color,
              sort_order: i,
              label_group_id: groupId,
            });
          }
        }

        for (const removedLabel of existingLabels.slice(names.length)) {
          await labelApi.deleteLabel(projectId, targetSetId, removedLabel.id);
        }
      };

      await syncLabels(nerLabelNames, nerGroup.id, 0);
      await syncLabels(labelNames, relationGroup.id, nerLabelNames.length, true);

      if (editingSet) {
        const syncedGroupIds = new Set([nerGroup.id, relationGroup.id]);
        const staleGroupedLabels = editingSet.labels.filter((label) =>
          label.label_group_id && !syncedGroupIds.has(label.label_group_id)
        );
        for (const removedLabel of staleGroupedLabels) {
          await labelApi.deleteLabel(projectId, targetSetId, removedLabel.id);
        }
      }
      onCreated(targetSetId);
    } catch (err) {
      setError(extractErrorMessage(err, 'Tạo nhãn thất bại'));
    } finally {
      setSubmitting(false);
    }
  };

  const previewRelations = [
    { head: 'Nguyễn Văn A', rel: labelNames[0], tail: 'Công ty ABC', relIdx: 0 },
    { head: 'Công ty ABC', rel: labelNames[1], tail: 'Hà Nội', relIdx: 1 },
  ].filter((r) => r.rel);
  const previewEntityLabels = [
    { text: 'Nguyễn Văn A', label: nerLabelNames[0], idx: 0 },
    { text: 'Công ty ABC', label: nerLabelNames[1], idx: 1 },
    { text: 'Hà Nội', label: nerLabelNames[2], idx: 2 },
  ].filter((item) => item.label);
  const colorPreviewLabels = [
    ...nerLabelNames.map((name, idx) => ({ name, idx })),
    ...labelNames.map((name, idx) => ({ name, idx: nerLabelNames.length + idx })),
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editingSet ? 'Chỉnh sửa — Relation Extraction' : 'Relation Extraction'} maxWidth="max-w-4xl">
      <div className="grid grid-cols-2 gap-6">
        {/* Left: config */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1.5">Tên bộ nhãn</label>
            <input
              type="text"
              value={setName}
              onChange={(e) => setSetName(e.target.value)}
              className="input-field"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1.5">
              Nhãn NER
              <span className="ml-1.5 text-xs font-normal text-surface-400">(mỗi dòng một nhãn)</span>
            </label>
            <textarea
              value={nerLabelsText}
              onChange={(e) => setNerLabelsText(e.target.value)}
              placeholder={'PERSON\nORG\nLOCATION'}
              rows={4}
              className="input-field resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1.5">
              Relation label
              <span className="ml-1.5 text-xs font-normal text-surface-400">(mỗi dòng một loại)</span>
            </label>
            <textarea
              value={labelsText}
              onChange={(e) => setLabelsText(e.target.value)}
              placeholder={'works_for\nfounded_by\nlocated_in\nacquired\npart_of\nrelated_to'}
              rows={5}
              className="input-field resize-none"
            />
          </div>
          {colorPreviewLabels.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {colorPreviewLabels.map(({ name, idx }) => (
                <div key={`${name}-${idx}`} className="relative">
                  <button
                    type="button"
                    title="Đổi màu"
                    onClick={() => setOpenPicker(openPicker === name ? null : name)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white hover:brightness-90 transition-all cursor-pointer"
                    style={{ backgroundColor: getColor(name, idx) }}
                  >
                    {name}
                    <span className="w-2.5 h-2.5 rounded-full bg-white/30 flex items-center justify-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
                    </span>
                  </button>
                  {openPicker === name && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setOpenPicker(null)} />
                      <div className="absolute top-9 left-0 z-20 bg-white rounded-xl shadow-elevated border border-surface-200 p-2.5 grid grid-cols-5 gap-1.5" style={{ width: 154 }}>
                        {COLOR_PALETTE.map((col) => (
                          <button
                            key={col}
                            type="button"
                            onClick={() => { setCustomColors((p) => ({ ...p, [name]: col })); setOpenPicker(null); }}
                            className={`w-6 h-6 rounded-full hover:scale-110 transition-transform border-2 cursor-pointer ${getColor(name, idx) === col ? 'border-surface-800 scale-110' : 'border-transparent'}`}
                            style={{ backgroundColor: col }}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: RE preview */}
        <div>
          <p className="text-sm font-medium text-surface-700 mb-3">Xem trước</p>
          <div className="border border-surface-200 rounded-xl bg-surface-50 overflow-hidden">
            <div className="px-4 py-3 border-b border-surface-200 bg-white">
              <p className="text-xs text-surface-400 font-medium uppercase tracking-wide mb-2">Văn bản mẫu</p>
              <p className="text-sm text-surface-700 leading-loose">
                <mark className="rounded px-1 font-medium not-italic" style={{ backgroundColor: '#8B5CF628', color: '#8B5CF6' }}>Nguyễn Văn A</mark>
                {' làm CEO tại '}
                <mark className="rounded px-1 font-medium not-italic" style={{ backgroundColor: '#F9731628', color: '#F97316' }}>Công ty ABC</mark>
                {' đặt trụ sở ở '}
                <mark className="rounded px-1 font-medium not-italic" style={{ backgroundColor: '#10B98128', color: '#10B981' }}>Hà Nội</mark>
                {'.'}
              </p>
              {previewEntityLabels.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {previewEntityLabels.map((item) => (
                    <span
                      key={item.text}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold"
                      style={{
                        backgroundColor: `${getColor(item.label!, item.idx)}1A`,
                        color: getColor(item.label!, item.idx),
                      }}
                    >
                      {item.text}
                      <span className="text-[10px] opacity-70">{item.label}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-surface-400 font-medium uppercase tracking-wide mb-2.5">Quan hệ</p>
              {labelNames.length === 0 ? (
                <p className="text-xs text-surface-400 italic">Thêm loại quan hệ để xem trước</p>
              ) : (
                <div className="space-y-2">
                  {previewRelations.map((r, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="px-2 py-0.5 rounded font-medium text-white text-xs" style={{ backgroundColor: '#8B5CF6' }}>{r.head}</span>
                      <div className="flex-1 flex flex-col items-center">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ backgroundColor: getColor(r.rel!, r.relIdx) }}>{r.rel}</span>
                        <div className="flex w-full items-center mt-0.5">
                          <div className="flex-1 h-px" style={{ backgroundColor: getColor(r.rel!, r.relIdx) }} />
                          <svg width="5" height="5" viewBox="0 0 5 5" style={{ color: getColor(r.rel!, r.relIdx) }}>
                            <path d="M0 0 L5 2.5 L0 5 Z" fill="currentColor" />
                          </svg>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded font-medium text-white text-xs" style={{ backgroundColor: i === 0 ? '#F97316' : '#10B981' }}>{r.tail}</span>
                    </div>
                  ))}
                  {labelNames.slice(2).map((name, i) => (
                    <div key={i + 2} className="flex items-center gap-2">
                      <span
                        className="px-3 py-1 rounded-lg text-sm font-medium text-white"
                        style={{ backgroundColor: getColor(name, i + 2) }}
                      >
                        {name}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200/60">
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} disabled={submitting} className="btn-ghost">Hủy</button>
        <button
          onClick={handleSubmit}
          disabled={nerLabelNames.length === 0 || labelNames.length === 0 || submitting}
          className="btn-primary"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {editingSet ? 'Lưu thay đổi' : 'Tạo nhãn quan hệ'}
        </button>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// ADD LABEL MODAL
// ─────────────────────────────────────────────────────────────
const DEFAULT_COLORS = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E', '#14B8A6',
  '#3B82F6', '#6366F1', '#A855F7', '#EC4899', '#78716C',
];

function AddLabelModal({
  isOpen,
  onClose,
  onAdded,
  projectId,
  labelSets,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdded: () => void;
  projectId: string;
  labelSets: LabelSetData[];
}) {
  const [labelSetId, setLabelSetId] = useState('');
  const [newSetName, setNewSetName] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_COLORS[0]);
  const [shortcutKey, setShortcutKey] = useState('');
  const [isRequired, setIsRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setLabelSetId(labelSets[0]?.id || '__new__');
      setNewSetName('');
      setName('');
      setColor(DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)]);
      setShortcutKey('');
      setIsRequired(false);
      setError('');
    }
  }, [isOpen, labelSets]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError('');

    try {
      let targetSetId = labelSetId;

      // Create a new label set if needed
      if (labelSetId === '__new__') {
        const setName = newSetName.trim() || 'Default Labels';
        const newSet = await labelApi.createLabelSet(projectId, setName);
        targetSetId = newSet.id;
      }

      await labelApi.createLabel(projectId, targetSetId, {
        name: name.trim(),
        color,
        shortcut_key: shortcutKey.trim() || undefined,
        is_required: isRequired,
      });
      onAdded();
    } catch (err: any) {
      setError(extractErrorMessage(err, 'Failed to add label'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Label">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200/60">
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Label Set selector */}
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1.5">Label Set</label>
          <div className="relative">
            <select
              value={labelSetId}
              onChange={(e) => setLabelSetId(e.target.value)}
              className="input-field pr-8 appearance-none"
            >
              {labelSets.map((ls) => (
                <option key={ls.id} value={ls.id}>{ls.name}</option>
              ))}
              <option value="__new__">+ Create new label set</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none" />
          </div>
        </div>

        {labelSetId === '__new__' && (
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1.5">New Set Name</label>
            <input
              type="text"
              placeholder="e.g. NER Labels"
              value={newSetName}
              onChange={(e) => setNewSetName(e.target.value)}
              className="input-field"
            />
          </div>
        )}

        {/* Label name */}
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1.5">
            Label Name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            required
            autoFocus
            placeholder="e.g. PERSON, LOCATION, ORG"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-field"
          />
        </div>

        {/* Color picker */}
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1.5">Color</label>
          <div className="flex items-center gap-2 flex-wrap">
            {DEFAULT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-lg transition-all cursor-pointer ${
                  color === c ? 'ring-2 ring-offset-2 ring-brand-500 scale-110' : 'hover:scale-105'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value.toUpperCase())}
              className="w-7 h-7 rounded-lg cursor-pointer border border-surface-200"
            />
          </div>
        </div>

        {/* Shortcut + Required */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1.5">Shortcut Key</label>
            <input
              type="text"
              maxLength={1}
              placeholder="e.g. p"
              value={shortcutKey}
              onChange={(e) => setShortcutKey(e.target.value)}
              className="input-field font-mono text-center"
            />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isRequired}
                onChange={(e) => setIsRequired(e.target.checked)}
                className="w-4 h-4 rounded border-surface-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="text-sm text-surface-700">Required label</span>
            </label>
          </div>
        </div>

        {/* Preview */}
        <div className="p-3 rounded-lg bg-surface-50 border border-surface-200/60">
          <p className="text-xs text-surface-400 mb-2">Preview</p>
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 rounded" style={{ backgroundColor: color }} />
            <span className="text-sm font-medium text-surface-800">{name || 'Label Name'}</span>
            {shortcutKey && (
              <kbd className="text-[10px] font-mono text-surface-400 bg-white px-1.5 py-0.5 rounded border border-surface-200">
                {shortcutKey}
              </kbd>
            )}
            {isRequired && <span className="text-[10px] text-red-500 font-medium">Required</span>}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={submitting || !name.trim()} className="btn-primary">
            {submitting ? (
              <><Loader2 className="w-4 h-4 animate-spin" />Adding…</>
            ) : (
              <><Plus className="w-4 h-4" />Add Label</>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// EXPORTS TAB
// ─────────────────────────────────────────────────────────────
const FORMAT_OPTIONS = [
  {
    value: 'json' as const,
    label: 'JSON (Native)',
    description: 'Xuất toàn bộ annotation văn bản kèm vị trí ký tự (start_offset, end_offset). Hỗ trợ NER, text classification, relation extraction.',
  },
  {
    value: 'csv' as const,
    label: 'CSV (Excel)',
    description: 'Xuất dữ liệu dạng bảng, tương thích với Excel và các công cụ phân tích dữ liệu.',
  },
  {
    value: 'jsonl' as const,
    label: 'JSON Lines (.jsonl)',
    description: 'Mỗi dòng là một JSON object, phù hợp với các pipeline ML xử lý dữ liệu lớn.',
  },
] as const;

const FILTER_OPTIONS = [
  { value: 'approved_only' as const, label: 'Chỉ task đã Approved (khuyến nghị)' },
  { value: 'all' as const, label: 'Toàn bộ task (kể cả chưa hoàn thành)' },
  { value: 'by_dataset' as const, label: 'Theo một dataset cụ thể' },
];

// ─────────────────────────────────────────────────────────────
// EXPORT MODAL
// ─────────────────────────────────────────────────────────────
function ExportModal({
  isOpen,
  onClose,
  onExported,
  projectId,
  datasets,
  tasks,
}: {
  isOpen: boolean;
  onClose: () => void;
  onExported: () => void;
  projectId: string;
  datasets: Dataset[];
  tasks: Task[];
}) {
  const [creating, setCreating] = useState(false);
  const [format, setFormat] = useState<'json' | 'jsonl' | 'csv'>('json');
  const [filterMode, setFilterMode] = useState<'approved_only' | 'all' | 'by_dataset'>('approved_only');
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setFormat('json');
      setFilterMode('approved_only');
      setSelectedDatasetId('');
      setError('');
    }
  }, [isOpen]);

  const approvedSampleCount = tasks
    .filter((t) => t.status === 'approved')
    .reduce((sum, t) => sum + t.sample_count, 0);

  const selectedFormat = FORMAT_OPTIONS.find((f) => f.value === format)!;

  const isDisabled =
    creating ||
    (filterMode === 'approved_only' && approvedSampleCount === 0) ||
    (filterMode === 'by_dataset' && !selectedDatasetId);

  const handleExport = async () => {
    setCreating(true);
    setError('');
    try {
      const payload: Parameters<typeof projectApi.createExport>[1] = {
        format,
        filter_status: filterMode === 'by_dataset' ? 'approved_only' : filterMode,
        include_metadata: true,
      };
      if (filterMode === 'by_dataset' && selectedDatasetId) {
        payload.dataset_id = selectedDatasetId;
      }
      await projectApi.createExport(projectId, payload);
      onExported();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e.response?.data?.detail || 'Export thất bại');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Xuất dữ liệu Annotation" maxWidth="max-w-lg">
      <div className="space-y-5">
        {/* Format */}
        <div>
          <label className="block text-sm font-semibold text-surface-700 mb-2">
            Định dạng xuất <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as typeof format)}
              className="w-full appearance-none border border-surface-300 rounded-lg px-4 py-2.5 pr-10 text-sm text-surface-800 bg-white outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 cursor-pointer"
            >
              {FORMAT_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none" />
          </div>
          <p className="mt-1.5 text-xs text-surface-500 leading-relaxed">{selectedFormat.description}</p>
        </div>

        {/* Filter mode */}
        <div>
          <label className="block text-sm font-semibold text-surface-700 mb-2">
            Phạm vi xuất <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <select
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value as typeof filterMode)}
              className="w-full appearance-none border border-surface-300 rounded-lg px-4 py-2.5 pr-10 text-sm text-surface-800 bg-white outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 cursor-pointer"
            >
              {FILTER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none" />
          </div>
        </div>

        {/* Dataset selector */}
        {filterMode === 'by_dataset' && (
          <div>
            <label className="block text-sm font-semibold text-surface-700 mb-2">
              Chọn dataset <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <select
                value={selectedDatasetId}
                onChange={(e) => setSelectedDatasetId(e.target.value)}
                className="w-full appearance-none border border-brand-400 rounded-lg px-4 py-2.5 pr-10 text-sm text-surface-800 bg-white outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 cursor-pointer"
              >
                <option value="">-- Chọn dataset --</option>
                {datasets.map((ds) => (
                  <option key={ds.id} value={ds.id}>{ds.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none" />
            </div>
          </div>
        )}

        {/* Approved count info */}
        {filterMode === 'approved_only' && (
          <div
            className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs"
            style={{
              backgroundColor: approvedSampleCount > 0 ? '#f0fdf4' : '#fffbeb',
              border: `1px solid ${approvedSampleCount > 0 ? '#bbf7d0' : '#fde68a'}`,
              color: approvedSampleCount > 0 ? '#15803d' : '#92400e',
            }}
          >
            <div
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: approvedSampleCount > 0 ? '#22c55e' : '#f59e0b' }}
            />
            {approvedSampleCount > 0
              ? `${approvedSampleCount.toLocaleString()} sample đã được duyệt, sẵn sàng export`
              : 'Chưa có sample nào được duyệt'}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200/60">
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Export button */}
        <button
          onClick={handleExport}
          disabled={isDisabled}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: isDisabled ? '#93c5fd' : '#2563eb' }}
        >
          {creating ? (
            <><Loader2 className="w-4 h-4 animate-spin" />Đang xuất…</>
          ) : (
            <><FileDown className="w-4 h-4" />Export {format.toUpperCase()}</>
          )}
        </button>
      </div>
    </Modal>
  );
}


// ─────────────────────────────────────────────────────────────
// SHARED COMPONENTS
// ─────────────────────────────────────────────────────────────
function DetailItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-surface-200 bg-white px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-400 mb-1">
        {label}
      </p>
      <div className="text-sm font-medium text-surface-800 break-words">
        {value}
      </div>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: string }) {
  return (
    <th className={`text-${align} text-xs font-semibold text-surface-500 uppercase tracking-wider px-5 py-3`}>
      {children}
    </th>
  );
}

function EmptyTab({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Database;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="w-12 h-12 rounded-xl bg-surface-100 flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-surface-400" />
      </div>
      <h3 className="text-base font-medium text-surface-800 mb-1">{title}</h3>
      <p className="text-sm text-surface-500">{description}</p>
    </div>
  );
}
