// src/pages/Projects.tsx

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  FolderKanban,
  Loader2,
  AlertCircle,
  RefreshCw,
  ChevronDown,
  Users,
  Trash2,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  X,
  History,
  Download,
  FileDown,
  Activity,
  CheckCheck,
} from 'lucide-react';
import { projectApi, type ExportRecord } from '../api/projectApi';
import { taskApi } from '../api/taskApi';
import { useAuthStore } from '../store/authStore';
import type { Project, ProjectMember, Dataset, AdminUser } from '../types';
import Modal from '../components/Modal';
import { useConfirm } from '../components/ConfirmDialog';
import { useToast } from '../components/toastContext';
import { downloadExportFile } from '../utils/exportDownload';

// ─── Config ─────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  not_started: { label: 'Chưa làm',      color: '#6b7280', bg: '#f3f4f6', border: '#9ca3af' },
  active:      { label: 'Đang hoạt động', color: '#1d4ed8', bg: '#eff6ff', border: '#2563eb' },
  completed:   { label: 'Hoàn thành',     color: '#065f46', bg: '#ecfdf5', border: '#059669' },
};

const PRIORITY_CFG: Record<string, { label: string; color: string; bg: string }> = {
  immediate: { label: 'Ngay lập tức', color: '#ffffff', bg: '#b91c1c' },
  high:      { label: 'Cao',          color: '#ffffff', bg: '#b45309' },
  normal:    { label: 'Bình thường',  color: '#ffffff', bg: '#15803d' },
};

const PROJECT_PROGRESS_REFRESH_MS = 30_000;

type ProjectsApiError = {
  response?: {
    status?: number;
    data?: {
      detail?: string;
      message?: string;
    };
  };
};

const PROJECTS_ERROR_MESSAGE =
  'Kh\u00f4ng t\u1ea3i \u0111\u01b0\u1ee3c danh s\u00e1ch d\u1ef1 \u00e1n';

const PROJECTS_STALE_WARNING =
  'Kh\u00f4ng c\u1eadp nh\u1eadt \u0111\u01b0\u1ee3c danh s\u00e1ch d\u1ef1 \u00e1n. \u0110ang gi\u1eef d\u1eef li\u1ec7u g\u1ea7n nh\u1ea5t.';
const PROJECT_DELETE_PROGRESS_MESSAGE =
  'Chỉ có thể xóa dự án khi tiến độ annotation là 0% hoặc 100%.';

function getAnnotationProgressPercent(project: Project) {
  return Math.max(0, Math.min(100, Math.round(project.annotation_progress ?? 0)));
}

function canDeleteProjectByAnnotationProgress(project: Project) {
  const annotationPct = getAnnotationProgressPercent(project);
  return annotationPct === 0 || annotationPct === 100;
}

function getProjectsErrorMessage(error: unknown) {
  const response = (error as ProjectsApiError).response;

  if (!response) {
    return 'Kh\u00f4ng k\u1ebft n\u1ed1i \u0111\u01b0\u1ee3c API. Backend c\u00f3 th\u1ec3 \u0111ang kh\u1edfi \u0111\u1ed9ng ho\u1eb7c b\u1ecb timeout.';
  }

  if (response.status === 401) {
    return 'Phi\u00ean \u0111\u0103ng nh\u1eadp h\u1ebft h\u1ea1n. Vui l\u00f2ng \u0111\u0103ng nh\u1eadp l\u1ea1i.';
  }

  if (response.status && response.status >= 500) {
    return 'M\u00e1y ch\u1ee7 \u0111ang l\u1ed7i khi t\u1ea3i danh s\u00e1ch d\u1ef1 \u00e1n.';
  }

  return response.data?.detail ?? response.data?.message ?? PROJECTS_ERROR_MESSAGE;
}

// ─── Main Component ─────────────────────────────────────────
export default function Projects() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.roles?.some((r) => r.toLowerCase().includes('admin'));
  const isProjectOwner = user?.roles?.some((r) => r.toLowerCase().includes('project_owner'));
  const canCreateProject = isAdmin || isProjectOwner;

  const [projects, setProjects]   = useState<Project[]>([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(true);
  const [hasLoadedProjects, setHasLoadedProjects] = useState(false);
  const [hasProjectSnapshot, setHasProjectSnapshot] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError]         = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch]       = useState('');
  const [statusFilter, setStatusFilter]   = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [detailProject, setDetailProject] = useState<Project | null>(null);
  const { confirm, ConfirmDialog } = useConfirm();
  const { showToast } = useToast();
  const requestSeq = useRef(0);
  const hasProjectSnapshotRef = useRef(false);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchProjects = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    const requestId = silent ? requestSeq.current : ++requestSeq.current;
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const res = await projectApi.getProjects({
        search: search || undefined,
        status: statusFilter || undefined,
        page_size: 50,
      });
      if (requestId !== requestSeq.current) return;
      setProjects(res.projects);
      setDetailProject((current) =>
        current ? (res.projects.find((p) => p.id === current.id) ?? current) : current
      );
      setTotal(res.total);
      setLastUpdated(new Date());
      hasProjectSnapshotRef.current = true;
      setHasProjectSnapshot(true);
      setError('');
    } catch (err: unknown) {
      if (requestId !== requestSeq.current) return;
      if (!silent) {
        setError(hasProjectSnapshotRef.current ? PROJECTS_STALE_WARNING : getProjectsErrorMessage(err));
      }
    } finally {
      if (requestId === requestSeq.current && !silent) {
        setHasLoadedProjects(true);
        setLoading(false);
      }
    }
  }, [search, statusFilter]);

  useEffect(() => {
    fetchProjects();
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchProjects({ silent: true });
      }
    };
    const intervalId = setInterval(
      refreshWhenVisible,
      PROJECT_PROGRESS_REFRESH_MS,
    );
    return () => clearInterval(intervalId);
  }, [fetchProjects]);

  // Client-side priority filter
  const displayed = priorityFilter
    ? projects.filter((p) => p.priority === priorityFilter)
    : projects;

  // Stat counts
  const activeCount = projects.filter((p) => p.status === 'active').length;
  const completedCount = projects.filter((p) => p.status === 'completed').length;
  const showInitialLoading = loading && (!hasLoadedProjects || !hasProjectSnapshot);
  const showBlockingError = Boolean(error && !hasProjectSnapshot);
  const showInlineWarning = Boolean(error && hasProjectSnapshot);

  const handleDelete = async (project: Project) => {
    if (!canDeleteProjectByAnnotationProgress(project)) {
      showToast('error', PROJECT_DELETE_PROGRESS_MESSAGE);
      return;
    }

    if (!await confirm('Bạn có chắc muốn xóa dự án này?', { title: 'Xóa dự án', variant: 'danger', confirmText: 'Xóa' })) return;
    try {
      await projectApi.deleteProject(project.id);
      fetchProjects();
    } catch (err: unknown) {
      const response = (err as ProjectsApiError).response;
      showToast('error', response?.data?.detail ?? 'Không xóa được dự án');
    }
  };

  return (
    <div>
      {ConfirmDialog}
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold text-surface-900" style={{ letterSpacing: '-0.02em' }}>Quản lý Dự án</h1>
          <p className="text-sm text-surface-500 mt-0.5">
            {total} dự án · {activeCount} đang hoạt động
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs text-surface-400">
              {lastUpdated.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={() => fetchProjects()}
            disabled={loading}
            className="p-2 rounded-lg border border-surface-200 text-surface-500 hover:bg-surface-50 hover:border-surface-300 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {canCreateProject && (
            <button
              onClick={() => setShowCreate(true)}
              className="btn-primary"
            >
              <Plus className="w-4 h-4" />
              Tạo dự án
            </button>
          )}
        </div>
      </div>

      {/* ─── Stat Cards ─── */}
      {showInlineWarning && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 mb-7">
        {[
          { label: 'Tổng dự án',     value: total,          icon: FolderKanban, iconBg: '#2563EB', iconColor: '#fff', borderColor: '#2563EB' },
          { label: 'Đang hoạt động', value: activeCount,    icon: Activity,     iconBg: '#2563EB', iconColor: '#fff', borderColor: '#2563EB' },
          { label: 'Hoàn thành',     value: completedCount, icon: CheckCheck,   iconBg: '#2563EB', iconColor: '#fff', borderColor: '#2563EB' },
        ].map(({ label, value, icon: Icon, iconBg, iconColor, borderColor }) => (
          <div key={label} className="bg-white rounded-xl p-6" style={{ border: `2px solid ${borderColor}`, boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)' }}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-4xl font-bold text-surface-950" style={{ letterSpacing: '-0.02em' }}>{value}</p>
                <p className="text-base text-surface-600 font-semibold mt-2">{label}</p>
              </div>
              <div className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: iconBg }}>
                <Icon className="w-6 h-6" style={{ color: iconColor }} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ─── Filters ─── */}
      <div className="flex items-center gap-3 mb-6">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
          <input
            type="text"
            placeholder="Tìm theo tên, mã..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-surface-200 bg-white text-surface-900 placeholder:text-surface-400 focus:outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 transition-all duration-150"
          />
        </div>

        {/* Status filter */}
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="appearance-none pl-3 pr-8 py-2 text-sm rounded-lg border border-surface-200 bg-white text-surface-700 focus:outline-none focus:border-brand-700 cursor-pointer transition-all duration-150"
          >
            <option value="">Tất cả trạng thái</option>
            <option value="not_started">Chưa làm</option>
            <option value="active">Đang hoạt động</option>
            <option value="completed">Hoàn thành</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none" />
        </div>

        {/* Priority filter */}
        <div className="relative">
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="appearance-none pl-3 pr-8 py-2 text-sm rounded-lg border border-surface-200 bg-white text-surface-700 focus:outline-none focus:border-brand-700 cursor-pointer transition-all duration-150"
          >
            <option value="">Mức độ ưu tiên</option>
            <option value="immediate">Ngay lập tức</option>
            <option value="high">Cao</option>
            <option value="normal">Bình thường</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none" />
        </div>
      </div>

      {/* ─── Content ─── */}
      {showInitialLoading ? (
        <div className="flex items-center justify-center py-20 text-surface-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm">Đang tải...</span>
        </div>
      ) : showBlockingError ? (
        <div className="flex flex-col items-center justify-center py-20">
          <AlertCircle className="w-8 h-8 text-red-400 mb-3" />
          <p className="text-sm text-surface-600 mb-3">{error}</p>
          <button onClick={() => fetchProjects()} className="text-sm text-brand-700 hover:underline cursor-pointer">Thử lại</button>
        </div>
      ) : displayed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-surface-400">
          <FolderKanban className="w-10 h-10 mb-3 text-surface-200" />
          <p className="text-sm">Không tìm thấy dự án nào</p>
          {(searchInput || statusFilter || priorityFilter) && (
            <button
              onClick={() => { setSearchInput(''); setStatusFilter(''); setPriorityFilter(''); }}
              className="text-sm text-brand-700 hover:underline mt-2 cursor-pointer"
            >
              Xóa bộ lọc
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-4">
          {displayed.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onDetail={setDetailProject}
            />
          ))}
        </div>
      )}

      {/* ─── Detail Modal ─── */}
      {detailProject && (
        <ProjectDetailModal
          project={detailProject}
          onClose={() => setDetailProject(null)}
          onDelete={async (projectToDelete) => { setDetailProject(null); await handleDelete(projectToDelete); }}
          onRefresh={fetchProjects}
        />
      )}

      {/* ─── Create Modal ─── */}
      <CreateProjectModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => { setShowCreate(false); fetchProjects(); }}
        currentUserName={user?.full_name ?? ''}
      />
    </div>
  );
}

// ─── Project Card ────────────────────────────────────────────
function ProjectCard({
  project,
  onDetail,
}: {
  project: Project;
  onDetail: (p: Project) => void;
}) {
  const statusCfg = STATUS_CFG[project.status] ?? STATUS_CFG.not_started;
  const priorityCfg = PRIORITY_CFG[project.priority] ?? PRIORITY_CFG.normal;
  const annotationPct = getAnnotationProgressPercent(project);
  return (
    <Link
      to={`/projects/${project.id}`}
      className="block cursor-pointer"
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '14px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 4px 12px rgba(0,0,0,0.04)',
      }}
    >
      <div className="p-5 relative">
        {/* Eye icon */}
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDetail(project); }}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-lg text-surface-700 border border-surface-300 bg-white hover:bg-[#2563EB] hover:border-[#2563EB] hover:text-white transition-colors duration-150 z-10 cursor-pointer"
          title="Xem chi tiết"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>

        {/* Code + name */}
        <div className="flex items-start justify-between mb-3 pr-10">
          <div>
            <span
              className="inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded mb-1.5"
              style={{ color: statusCfg.color, backgroundColor: statusCfg.bg, letterSpacing: '0.08em' }}
            >
              {project.code}
            </span>
            <h3 className="text-[15px] font-bold text-surface-900 leading-snug" style={{ letterSpacing: '-0.01em' }}>
              {project.name}
            </h3>
          </div>
          <span
            className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ml-2 uppercase tracking-wide"
            style={{ color: priorityCfg.color, backgroundColor: priorityCfg.bg }}
          >
            ★ {priorityCfg.label}
          </span>
        </div>

        {/* Progress */}
        <div className="mt-3 mb-1">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-surface-400 font-medium">Tiến độ annotation</span>
            <span className="text-xs font-bold" style={{ color: '#2563eb' }}>{annotationPct}%</span>
          </div>
          <div className="w-full h-1 rounded-full" style={{ background: '#e2e8f0' }}>
            <div className="h-1 rounded-full transition-all duration-500" style={{ width: `${annotationPct}%`, background: 'linear-gradient(90deg, #2563eb, #60a5fa)' }} />
          </div>
        </div>

        {/* Divider */}
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid #e2e8f0' }}>
          <div className="flex flex-wrap items-center gap-3 text-xs text-surface-400">
            {project.creator && (
              <span className="flex items-center gap-1">
                <span className="font-semibold">PO:</span>
                {project.creator.full_name}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {project.member_count} thành viên
            </span>
            {project.deadline && (
              <span className="flex items-center gap-1">
                <span className="font-semibold">Deadline:</span>
                {new Date(project.deadline).toLocaleDateString('vi-VN')}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

// ─── Role badge config ───────────────────────────────────────
const ROLE_BADGE: Record<string, { label: string; cls: string }> = {
  project_owner: { label: 'Owner',     cls: 'bg-amber-50 text-amber-800 border border-amber-200' },
  annotator:     { label: 'Annotator', cls: 'bg-brand-50 text-brand-700 border border-brand-100' },
  reviewer:      { label: 'Reviewer',  cls: 'bg-purple-50 text-purple-700 border border-purple-200' },
};

// ─── Project Detail Modal ────────────────────────────────────
function ProjectDetailModal({
  project,
  onClose,
  onDelete,
  onRefresh,
}: {
  project: Project;
  onClose: () => void;
  onDelete: (project: Project) => void;
  onRefresh: () => void;
}) {
  const navigate = useNavigate();
  const [members,  setMembers]  = useState<ProjectMember[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [showEdit,          setShowEdit]          = useState(false);
  const [showMembers,       setShowMembers]       = useState(false);
  const [showExportHistory, setShowExportHistory] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const [mRes, dRes] = await Promise.allSettled([
        taskApi.getMembers(project.id),
        taskApi.getDatasets(project.id),
      ]);
      if (!cancelled) {
        if (mRes.status === 'fulfilled') setMembers(mRes.value.members);
        if (dRes.status === 'fulfilled') setDatasets(dRes.value.datasets);
        setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [project.id]);

  // Progress calculations
  const totalSamples = project.total_samples ?? datasets.reduce((s, d) => s + d.total_samples, 0);
  const annotationDone = project.annotated_samples ?? 0;
  const reviewDone = (project.pending_review_samples ?? 0) + (project.approved_samples ?? 0);
  const approvedDone = project.approved_samples ?? 0;
  const annPct = getAnnotationProgressPercent(project);
  const revPct = Math.max(0, Math.min(100, Math.round(project.review_progress ?? 0)));
  const appPct = Math.max(0, Math.min(100, Math.round(project.completion_progress ?? 0)));
  const canDeleteProject = canDeleteProjectByAnnotationProgress(project);

  const statusCfg = STATUS_CFG[project.status] ?? STATUS_CFG.not_started;

  const refreshMembers = async () => {
    try {
      const mRes = await taskApi.getMembers(project.id);
      setMembers(mRes.members);
    } catch { /* ignore */ }
  };

  const fmtDate = (s: string | null) =>
    s ? new Date(s).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const fmtDateShort = (s: string | null) =>
    s ? new Date(s).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-surface-950/50 backdrop-blur-[3px]" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-2xl flex flex-col max-h-[90vh]" style={{ background: '#f8fafc', boxShadow: '0 24px 64px rgba(0,0,0,0.18), 0 8px 24px rgba(0,0,0,0.10)' }}>

        {/* ── Header ── */}
        <div className="px-6 pt-6 pb-4 shrink-0" style={{ borderBottom: '1px solid #e2e8f0' }}>
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #2563eb 0%, #60a5fa 100%)' }}>
              <FolderKanban className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-surface-400 uppercase tracking-widest">{project.code}</p>
              <h2 className="text-lg font-bold text-surface-900 leading-tight mt-0.5" style={{ letterSpacing: '-0.015em' }}>{project.name}</h2>
              <span
                className="inline-block mt-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full"
                style={{ color: statusCfg.color, backgroundColor: statusCfg.bg }}
              >
                {statusCfg.label}
              </span>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-surface-400 hover:text-surface-700 hover:bg-surface-100 transition-colors shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div className="overflow-y-auto flex-1 px-6 pb-2">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-surface-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm">Đang tải...</span>
            </div>
          ) : (
            <div className="space-y-6">

              {/* Description */}
              {project.description && (
                <p className="text-sm text-surface-500 leading-relaxed border-b border-surface-100 pb-4">
                  {project.description}
                </p>
              )}

              {/* ── Annotation progress ── */}
              <div>
                <p className="text-[10px] font-bold text-surface-400 uppercase tracking-widest mb-3">Tiến độ Annotation</p>
                <div className="space-y-3.5">
                  {[
                    { label: 'Annotation', done: annotationDone, pct: annPct, bar: 'linear-gradient(90deg,#2563eb,#60a5fa)' },
                    { label: 'Review',     done: reviewDone,     pct: revPct, bar: 'linear-gradient(90deg,#059669,#34d399)' },
                    { label: 'Approved',   done: approvedDone,   pct: appPct, bar: 'linear-gradient(90deg,#d97706,#fbbf24)' },
                  ].map((row) => (
                    <div key={row.label}>
                      <div className="flex items-center justify-between text-sm mb-1.5">
                        <span className="text-surface-700 font-medium text-xs">{row.label}</span>
                        <div className="flex items-center gap-3 text-surface-500">
                          <span className="font-bold text-surface-800 text-xs">{row.pct}%</span>
                          <span className="text-xs text-surface-400">{row.done.toLocaleString()} / {totalSamples.toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#e2e8f0' }}>
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${row.pct}%`, background: row.bar }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Project info ── */}
              <div>
                <p className="text-[10px] font-bold text-surface-400 uppercase tracking-widest mb-3">Thông tin dự án</p>
                <div className="grid grid-cols-2 gap-x-8 gap-y-4 border-t border-surface-100 pt-3">
                  {[
                    { label: 'Chủ sở hữu',  value: project.creator?.full_name ?? '—' },
                    { label: 'Deadline',     value: fmtDateShort(project.deadline) },
                    { label: 'Tổng items',   value: totalSamples.toLocaleString() },
                    { label: 'Số dataset',   value: datasets.length.toString() },
                    { label: 'Thành viên',   value: `${members.length} người` },
                    { label: 'Cập nhật',     value: fmtDate(project.updated_at) },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <p className="text-[10px] text-surface-400 uppercase tracking-wide font-semibold mb-0.5">{label}</p>
                      <p className="text-sm font-medium text-surface-800">{value}</p>
                    </div>
                  ))}
                  {project.objective && (
                    <div className="col-span-2">
                      <p className="text-[10px] text-surface-400 uppercase tracking-wide font-semibold mb-0.5">Mục tiêu</p>
                      <p className="text-sm text-surface-700">{project.objective}</p>
                    </div>
                  )}
                  <div className="col-span-2">
                    <p className="text-xs text-surface-400">Tạo lúc: {fmtDate(project.created_at)}</p>
                  </div>
                </div>
              </div>

              {/* ── Members ── */}
              <div>
                <p className="text-[10px] font-bold text-surface-400 uppercase tracking-widest mb-3">
                  Thành viên ({members.length})
                </p>
                {members.length === 0 ? (
                  <p className="text-sm text-surface-400 py-4 text-center">Chưa có thành viên</p>
                ) : (
                  <table className="w-full text-sm border-t border-surface-100">
                    <thead>
                      <tr style={{ background: '#f1f5f9' }}>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-surface-500">Thành viên</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-surface-500">Vai trò</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-surface-500">Tham gia</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-100">
                      {members.map((m) => {
                        const badge = ROLE_BADGE[m.role_in_project] ?? { label: m.role_in_project, cls: 'bg-surface-100 text-surface-600' };
                        const emailHandle = m.email.split('@')[0];
                        return (
                          <tr key={m.id} className="hover:bg-surface-50 transition-colors">
                            <td className="px-3 py-2.5">
                              <p className="font-medium text-surface-900">{m.full_name}</p>
                              <p className="text-xs text-surface-400">@{emailHandle}</p>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${badge.cls}`}>
                                {badge.label}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-xs text-surface-500">
                              {new Date(m.joined_at).toLocaleDateString('vi-VN', {
                                day: '2-digit', month: '2-digit', year: 'numeric',
                                hour: '2-digit', minute: '2-digit',
                              })}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-4 flex items-center gap-2 shrink-0 flex-wrap" style={{ borderTop: '1px solid #e2e8f0' }}>
          <button
            onClick={() => navigate(`/projects/${project.id}`)}
            className="btn-primary text-sm py-2"
          >
            <ExternalLink className="w-4 h-4" />
            Mở dự án
          </button>
          <button
            onClick={() => setShowEdit(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-all duration-150 cursor-pointer border border-surface-200 text-surface-700 hover:bg-surface-100"
          >
            <Pencil className="w-4 h-4" />
            Sửa dự án
          </button>
          <button
            onClick={() => setShowMembers(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-all duration-150 cursor-pointer border border-surface-200 text-surface-700 hover:bg-surface-100"
          >
            <Users className="w-4 h-4" />
            Thành viên
          </button>
          <button
            onClick={() => setShowExportHistory(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-surface-200 text-surface-600 hover:bg-surface-50 text-sm font-semibold transition-colors cursor-pointer"
          >
            <History className="w-4 h-4" />
            Lịch sử Export
          </button>
          <button
            onClick={() => {
              if (canDeleteProject) onDelete(project);
            }}
            disabled={!canDeleteProject}
            title={canDeleteProject ? 'Xóa dự án' : PROJECT_DELETE_PROGRESS_MESSAGE}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-semibold transition-colors ${
              canDeleteProject
                ? 'border-red-200 text-red-600 hover:bg-red-50 cursor-pointer'
                : 'border-surface-200 text-surface-400 bg-surface-50 cursor-not-allowed'
            }`}
          >
            <Trash2 className="w-4 h-4" />
            Xóa
          </button>
          <button
            onClick={onClose}
            className="ml-auto px-3 py-2 rounded-lg border border-surface-200 text-surface-600 hover:bg-surface-50 text-sm font-semibold transition-colors cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>

      {/* ── Sub-modals ── */}
      {showEdit && (
        <EditProjectModal
          project={project}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); onRefresh(); }}
        />
      )}
      {showMembers && (
        <MembersModal
          project={project}
          members={members}
          onClose={() => setShowMembers(false)}
          onChanged={refreshMembers}
        />
      )}
      {showExportHistory && (
        <ExportHistoryModal
          project={project}
          datasets={datasets}
          onClose={() => setShowExportHistory(false)}
        />
      )}
    </div>
  );
}

// ─── Edit Project Modal ──────────────────────────────────────
function EditProjectModal({
  project,
  onClose,
  onSaved,
}: {
  project: Project;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code,        setCode]        = useState(project.code ?? '');
  const [name,        setName]        = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [objective,   setObjective]   = useState(project.objective ?? '');
  const [priority,    setPriority]    = useState(project.priority);
  const [deadline,    setDeadline]    = useState(
    project.deadline ? project.deadline.slice(0, 10) : ''
  );
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await projectApi.updateProject(project.id, {
        code: code.trim() || undefined,
        name: name.trim(),
        description: description.trim() || undefined,
        objective: objective.trim() || undefined,
        priority,
        deadline: deadline || undefined,
      });
      onSaved();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: unknown } } };
      const detail = e.response?.data?.detail;
      setError(Array.isArray(detail)
        ? detail.map((d: { msg?: string }) => d.msg || String(d)).join('; ')
        : typeof detail === 'string' ? detail : 'Không lưu được dự án');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400';
  const labelCls = 'block text-sm font-medium text-gray-700 mb-1.5';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-0 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Sửa dự án</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto max-h-[70vh]">
          <form id="edit-project-form" onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
                <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Mã dự án</label>
                <input type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Tên dự án <span className="text-red-500">*</span></label>
                <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Mô tả</label>
              <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={`${inputCls} resize-none`} />
            </div>
            <div>
              <label className={labelCls}>Mục tiêu</label>
              <input type="text" value={objective} onChange={(e) => setObjective(e.target.value)} className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Mức độ ưu tiên</label>
                <div className="relative">
                  <select value={priority} onChange={(e) => setPriority(e.target.value as Project['priority'])} className={`${inputCls} appearance-none pr-8`}>
                    <option value="normal">Bình thường</option>
                    <option value="high">Cao</option>
                    <option value="immediate">Ngay lập tức</option>
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              </div>
              <div>
                <label className={labelCls}>Deadline</label>
                <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={inputCls} />
              </div>
            </div>
          </form>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">
            Hủy
          </button>
          <button form="edit-project-form" type="submit" disabled={submitting} className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors disabled:opacity-60 cursor-pointer">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Lưu thay đổi
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Members Modal ───────────────────────────────────────────
function MembersModal({
  project,
  members,
  onClose,
  onChanged,
}: {
  project: Project;
  members: ProjectMember[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [allUsers,    setAllUsers]    = useState<AdminUser[]>([]);
  const [usersError,  setUsersError]  = useState('');
  const [selectedId,  setSelectedId]  = useState('');
  const [selectedName, setSelectedName] = useState('');
  const [role,        setRole]        = useState('annotator');
  const [adding,      setAdding]      = useState(false);
  const [removingId,  setRemovingId]  = useState<string | null>(null);
  const [dropOpen,    setDropOpen]    = useState(false);
  const [search,      setSearch]      = useState('');

  useEffect(() => {
    import('../api/axiosClient').then(({ default: axios }) => {
      axios.get('/api/v1/users/search', { params: { page_size: 500 } })
        .then((r) => setAllUsers(r.data.users))
        .catch(() => setUsersError('Không tải được danh sách người dùng'));
    });
  }, []);

  const availableUsers = allUsers.filter(
    (u) => !members.some((m) => m.user_id === u.id)
  );
  const filteredUsers = search.trim()
    ? availableUsers.filter((u) =>
        u.full_name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase())
      )
    : availableUsers;

  const dropRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dropOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setDropOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropOpen]);

  const handleAdd = async () => {
    if (!selectedId) return;
    setAdding(true);
    try {
      await taskApi.addMember(project.id, selectedId, role);
      setSelectedId('');
      setSelectedName('');
      setSearch('');
      onChanged();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast('error', e.response?.data?.detail || 'Không thêm được thành viên');
    } finally { setAdding(false); }
  };

  const handleRemove = async (m: ProjectMember) => {
    if (!await confirm(`Xóa "${m.full_name}" khỏi dự án?`, { title: 'Xóa thành viên', variant: 'danger', confirmText: 'Xóa' })) return;
    setRemovingId(m.user_id);
    try {
      await taskApi.removeMember(project.id, m.user_id);
      onChanged();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast('error', e.response?.data?.detail || 'Không xóa được thành viên');
    } finally { setRemovingId(null); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {ConfirmDialog}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-surface-0 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Thành viên: {project.name}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto max-h-[70vh]">
          {/* Add member row */}
          <div>
            {usersError && (
              <p className="text-xs text-red-500 mb-2">{usersError}</p>
            )}
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-end">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Thêm thành viên</label>
                <div className="relative" ref={dropRef}>
                  {/* Trigger */}
                  <button
                    type="button"
                    onClick={() => { setDropOpen((v) => !v); setSearch(''); }}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg border border-surface-200 hover:border-brand-700 focus:outline-none bg-surface-0 text-left cursor-pointer"
                  >
                    <span className={selectedId ? 'text-gray-900' : 'text-gray-400'}>
                      {selectedName || '-- Chọn người dùng --'}
                    </span>
                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${dropOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Dropdown panel */}
                  {dropOpen && (
                    <div className="absolute z-20 mt-1 w-full bg-surface-0 border border-surface-200 rounded-lg shadow-lg overflow-hidden">
                      {/* Search */}
                      <div className="px-2 py-2 border-b border-gray-100">
                        <input
                          autoFocus
                          type="text"
                          placeholder="Tìm kiếm..."
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          className="w-full px-2 py-1.5 text-sm rounded-md border border-gray-200 focus:outline-none focus:border-blue-400"
                        />
                      </div>
                      {/* List */}
                      <div className="max-h-48 overflow-y-auto">
                        {filteredUsers.length === 0 ? (
                          <p className="text-sm text-gray-400 text-center py-4">
                            {availableUsers.length === 0 ? 'Không có người dùng khả dụng' : 'Không tìm thấy'}
                          </p>
                        ) : (
                          filteredUsers.map((u) => (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => {
                                setSelectedId(u.id);
                                setSelectedName(`${u.full_name} (${u.email})`);
                                setDropOpen(false);
                                setSearch('');
                              }}
                              className="w-full text-left px-3 py-2.5 hover:bg-blue-50 transition-colors"
                            >
                              <p className="text-sm font-medium text-gray-900">{u.full_name}</p>
                              <p className="text-xs text-gray-400">{u.email}</p>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Vai trò</label>
                <div className="relative">
                  <select value={role} onChange={(e) => setRole(e.target.value)} className="appearance-none px-3 py-2 pr-8 text-sm rounded-lg border border-surface-200 focus:outline-none focus:border-brand-700 bg-surface-0">
                    <option value="annotator">Annotator</option>
                    <option value="reviewer">Reviewer</option>
                    <option value="project_owner">Project Owner</option>
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              </div>
              <button
                onClick={handleAdd}
                disabled={!selectedId || adding}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 cursor-pointer"
              >
                {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Thêm
              </button>
            </div>
          </div>

          {/* Member table */}
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 rounded-lg">
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 rounded-l-lg">Thành viên</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500">Vai trò</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500">Tham gia</th>
                <th className="px-3 py-2.5 rounded-r-lg" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.map((m) => {
                const badge = ROLE_BADGE[m.role_in_project] ?? { label: m.role_in_project, cls: 'bg-gray-100 text-gray-600' };
                const emailHandle = m.email.split('@')[0];
                return (
                  <tr key={m.id}>
                    <td className="px-3 py-3">
                      <p className="font-medium text-gray-900">{m.full_name}</p>
                      <p className="text-xs text-gray-400">@{emailHandle}</p>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${badge.cls}`}>{badge.label}</span>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-500">
                      {new Date(m.joined_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        onClick={() => handleRemove(m)}
                        disabled={removingId === m.user_id}
                        className="text-xs font-semibold text-red-500 hover:text-red-700 disabled:opacity-50 transition-colors cursor-pointer"
                      >
                        {removingId === m.user_id ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Xóa'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-blue-300 text-blue-600 hover:bg-blue-50 text-sm font-semibold transition-colors cursor-pointer">
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Export History Modal ────────────────────────────────────
function ExportHistoryModal({
  project,
  datasets,
  onClose,
}: {
  project: Project;
  datasets: Dataset[];
  onClose: () => void;
}) {
  const [exportList, setExportList] = useState<ExportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { confirm, ConfirmDialog } = useConfirm();
  const { showToast } = useToast();

  useEffect(() => {
    projectApi.listExports(project.id)
      .then((r) => setExportList(r.exports))
      .catch(() => showToast('error', 'Không tải được lịch sử export'))
      .finally(() => setLoading(false));
  }, [project.id, showToast]);

  const handleDownload = async (exp: ExportRecord) => {
    setDownloading(exp.id);
    try {
      const result = await projectApi.downloadExport(project.id, exp.id);
      const filename = `export_${project.id.slice(0, 8)}.${exp.format}`;
      downloadExportFile(result, `export_${project.id.slice(0, 8)}`);
      showToast('success', `Đã tải ${filename}`);
    } catch {
      showToast('error', 'Tải xuống thất bại');
    } finally {
      setDownloading(null);
    }
  };

  const handleDelete = async (exp: ExportRecord) => {
    if (!await confirm('Xóa export này?', { title: 'Xóa lịch sử export', variant: 'danger', confirmText: 'Xóa' })) return;
    setDeletingId(exp.id);
    try {
      await projectApi.deleteExport(project.id, exp.id);
      setExportList((prev) => prev.filter((e) => e.id !== exp.id));
      showToast('success', 'Đã xoá export');
    } catch {
      showToast('error', 'Xoá thất bại');
    } finally {
      setDeletingId(null);
    }
  };

  const getDatasetName = (datasetId: string | null) => {
    if (!datasetId) return 'Tất cả';
    return datasets.find((d) => d.id === datasetId)?.name ?? 'Tất cả';
  };

  const getFilterLabel = (filter: string) => {
    if (filter === 'approved_only') return 'Đã duyệt';
    if (filter === 'all') return 'Tất cả';
    return filter;
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {ConfirmDialog}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-surface-0 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Lịch sử Export: {project.name}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto max-h-[60vh]">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm">Đang tải...</span>
            </div>
          ) : exportList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <FileDown className="w-10 h-10 mb-3 text-gray-200" />
              <p className="text-sm">Chưa có lịch sử export</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Dataset</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Định dạng</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Phạm vi</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Trạng thái</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Thời gian</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {exportList.map((exp) => (
                  <tr key={exp.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700 max-w-[140px] truncate">{getDatasetName(exp.dataset_id)}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs font-bold uppercase bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                        {exp.format}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{getFilterLabel(exp.filter_status)}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        {exp.total_records > 0 ? 'Hoàn thành' : 'Rỗng'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(exp.created_at).toLocaleDateString('vi-VN', {
                        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleDownload(exp)}
                          disabled={downloading === exp.id}
                          className="p-1.5 rounded text-blue-600 hover:bg-blue-50 disabled:opacity-50 transition-colors cursor-pointer"
                          title="Tải xuống"
                        >
                          {downloading === exp.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Download className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => handleDelete(exp)}
                          disabled={deletingId === exp.id}
                          className="p-1.5 rounded text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors cursor-pointer"
                          title="Xóa"
                        >
                          {deletingId === exp.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex justify-end px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-blue-300 text-blue-600 hover:bg-blue-50 text-sm font-semibold transition-colors cursor-pointer">
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Create Project Modal ────────────────────────────────────
function CreateProjectModal({
  isOpen,
  onClose,
  onCreated,
  currentUserName,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
  currentUserName: string;
}) {
  const [code, setCode]               = useState('');
  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [objective, setObjective]     = useState('');
  const [priority, setPriority]       = useState('normal');
  const [deadline, setDeadline]       = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');

  useEffect(() => {
    if (isOpen) {
      setCode(''); setName(''); setDescription('');
      setObjective(''); setPriority('normal'); setDeadline(''); setError('');
    }
  }, [isOpen]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const trimmedCode = code.trim();
    if (trimmedCode && !/^[A-Za-z0-9\-_]+$/.test(trimmedCode)) {
      setError('Mã dự án chỉ được chứa chữ cái, số, dấu - hoặc _');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await projectApi.createProject({
        code: trimmedCode || undefined,
        name: name.trim(),
        description: description.trim() || undefined,
        objective: objective.trim() || undefined,
        priority,
        deadline: deadline || undefined,
      });
      onCreated();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: unknown } } };
      const detail = e.response?.data?.detail;
      if (Array.isArray(detail)) {
        setError(detail.map((d: { msg?: string }) => d.msg || String(d)).join('; '));
      } else {
        setError(typeof detail === 'string' ? detail : 'Không tạo được dự án');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400';
  const labelCls = 'block text-sm font-medium text-gray-700 mb-1.5';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Tạo dự án mới">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Mã + Tên - 2 col */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>
              Mã dự án
            </label>
            <input
              type="text"
              placeholder="VD: CV-CLS-2025"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className={inputCls}
            />
            <p className="text-xs text-gray-400 mt-1">Chỉ chữ cái, số, dấu - hoặc _</p>
          </div>
          <div>
            <label className={labelCls}>
              Tên dự án <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="Tên đầy đủ của dự án"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        {/* Mô tả */}
        <div>
          <label className={labelCls}>Mô tả</label>
          <textarea
            rows={3}
            placeholder="Mô tả ngắn gọn về dự án..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={`${inputCls} resize-none`}
          />
        </div>

        {/* Mục tiêu */}
        <div>
          <label className={labelCls}>Mục tiêu</label>
          <input
            type="text"
            placeholder="VD: Gán nhãn thực thể và phân loại văn bản"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            className={inputCls}
          />
        </div>

        {/* Chủ sở hữu + Mức độ ưu tiên */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Chủ sở hữu</label>
            <div className="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-gray-50 text-gray-600 truncate">
              {currentUserName || 'Tài khoản hiện tại'}
            </div>
          </div>
          <div>
            <label className={labelCls}>Mức độ ưu tiên</label>
            <div className="relative">
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className={`${inputCls} appearance-none pr-8`}
              >
                <option value="normal">Bình thường</option>
                <option value="high">Cao</option>
                <option value="immediate">Ngay lập tức</option>
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Deadline */}
        <div>
          <label className={labelCls}>Deadline</label>
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className={inputCls}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors disabled:opacity-60 cursor-pointer"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            ✓ Lưu dự án
          </button>
        </div>
      </form>
    </Modal>
  );
}
