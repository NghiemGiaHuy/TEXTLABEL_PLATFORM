// src/pages/Dashboard.tsx

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FolderKanban,
  CheckCircle2,
  Clock,
  TrendingUp,
  RefreshCw,
  Database,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { projectApi, type DashboardData, type DashboardStats } from '../api/projectApi';

// ─── Action label map ────────────────────────────────────────
const ACTION_LABELS: Record<string, string> = {
  LOGIN: 'Đăng nhập',
  LOGOUT: 'Đăng xuất',
  PASSWORD_RESET: 'Đặt lại mật khẩu',
  PASSWORD_CHANGED: 'Đổi mật khẩu',
  CREATE_PROJECT: 'Tạo dự án',
  UPDATE_PROJECT: 'Cập nhật dự án',
  ARCHIVE_PROJECT: 'Lưu trữ dự án',
  DELETE_PROJECT: 'Xóa dự án',
  ADD_MEMBER: 'Thêm thành viên',
  REMOVE_MEMBER: 'Xóa thành viên',
  IMPORT_DATASET: 'Import dữ liệu',
  DELETE_DATASET: 'Xóa dataset',
  ASSIGN_TASKS: 'Phân công task',
  REASSIGN_TASK: 'Phân công lại task',
  APPROVE_SAMPLE: 'Duyệt mẫu',
  REJECT_SAMPLE: 'Từ chối mẫu',
  CREATE_LABEL_SET: 'Tạo bộ nhãn',
  DELETE_LABEL_SET: 'Xóa bộ nhãn',
  CREATE_LABEL: 'Tạo nhãn',
  DELETE_LABEL: 'Xóa nhãn',
  CREATE_EXPORT: 'Xuất dữ liệu',
  CREATE_USER: 'Tạo người dùng',
  UPDATE_USER: 'Cập nhật người dùng',
  DELETE_USER: 'Xóa người dùng',
  LOCK_USER: 'Khóa tài khoản',
  UNLOCK_USER: 'Mở khóa tài khoản',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s} giây trước`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  return `${Math.floor(h / 24)} ngày trước`;
}

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  not_started: { label: 'Chưa làm',      color: '#6b7280', bg: '#f3f4f6' },
  active:      { label: 'Đang hoạt động', color: '#2563eb', bg: '#eff6ff' },
  completed:   { label: 'Hoàn thành',     color: '#16a34a', bg: '#f0fdf4' },
};

type TimeRange = '7d' | '30d' | 'all';

const RECENT_PROJECT_GRID_COLUMNS =
  'minmax(220px, 1.3fr) minmax(260px, 1.35fr) minmax(120px, 0.65fr) minmax(120px, 0.65fr) minmax(160px, 0.95fr)';

const EMPTY_DASHBOARD_DATA: DashboardData = {
  recent_projects: [],
  recent_activity: [],
};

const DASHBOARD_ERROR_MESSAGE =
  'Kh\u00f4ng t\u1ea3i \u0111\u01b0\u1ee3c d\u1eef li\u1ec7u trang ch\u1ee7. \u0110ang gi\u1eef d\u1eef li\u1ec7u g\u1ea7n nh\u1ea5t.';

const STATS_ERROR_MESSAGE =
  'Kh\u00f4ng t\u1ea3i \u0111\u01b0\u1ee3c th\u1ed1ng k\u00ea. Vui l\u00f2ng th\u1eed l\u1ea1i sau.';

// ─── Fill missing dates in range ─────────────────────────────
function fillDailyRange(
  data: { date: string; count: number }[],
  range: TimeRange,
): { date: string; count: number }[] {
  const map = new Map(data.map((d) => [d.date, d.count]));
  const days = range === '7d' ? 7 : range === '30d' ? 30 : null;
  if (!days) return data;

  const result: { date: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push({ date: key, count: map.get(key) ?? 0 });
  }
  return result;
}

// ─── Main Component ──────────────────────────────────────────
export default function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const firstName = user?.full_name?.split(' ').slice(-1)[0] || 'bạn';

  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [dashboardData, setDashboardData] = useState<DashboardData>(EMPTY_DASHBOARD_DATA);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [hasLoadedDashboard, setHasLoadedDashboard] = useState(false);
  const [hasLoadedStats, setHasLoadedStats] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [statsError, setStatsError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setDashboardError('');
    try {
      const dash = await projectApi.getDashboard();
      setDashboardData(dash);
      setLastUpdated(new Date());
    } catch {
      setDashboardError(DASHBOARD_ERROR_MESSAGE);
    } finally {
      setHasLoadedDashboard(true);
      setLoading(false);
    }
  }, []);

  const fetchStats = useCallback(async (range: TimeRange) => {
    setStatsLoading(true);
    try {
      const days = range === '7d' ? 7 : range === '30d' ? 30 : undefined;
      const s = await projectApi.getDashboardStats(days);
      setStats(s);
      setStatsError('');
    } catch {
      setStatsError(STATS_ERROR_MESSAGE);
    } finally {
      setHasLoadedStats(true);
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
    intervalRef.current = setInterval(fetchDashboard, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchDashboard]);

  useEffect(() => {
    fetchStats(timeRange);
  }, [fetchStats, timeRange]);

  const handleRefresh = () => {
    fetchDashboard();
    fetchStats(timeRange);
  };

  const chartData = stats ? fillDailyRange(stats.daily_progress, timeRange) : [];
  const showDashboardLoading = loading && !hasLoadedDashboard;
  const showStatsLoading = statsLoading && !hasLoadedStats;
  const errorMessages = [dashboardError, statsError].filter(Boolean);

  return (
    <div>
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Xin chào, {firstName}!</h1>
          <p className="text-gray-500 text-sm mt-1">Đây là tổng quan không gian làm việc gán nhãn của bạn.</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Time range filter */}
          <div className="flex items-center bg-surface-100 rounded-lg p-0.5 gap-0.5">
            {(['7d', '30d', 'all'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-150 cursor-pointer ${
                  timeRange === range
                    ? 'bg-white text-surface-900 shadow-sm'
                    : 'text-surface-500 hover:text-surface-700'
                }`}
              >
                {range === '7d' ? '7 ngày' : range === '30d' ? '30 ngày' : 'Tất cả'}
              </button>
            ))}
          </div>

          {lastUpdated && (
            <span className="text-xs text-gray-400">
              {lastUpdated.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={loading || statsLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors disabled:opacity-50 cursor-pointer text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${(loading || statsLoading) ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
        </div>
      </div>

      {/* ─── Workflow Pipeline ─── */}
      {errorMessages.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {errorMessages.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl mb-6" style={{ border: '1px solid #e5e7eb', padding: '12px 20px 14px' }}>
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Quy trình làm việc</p>
        <div className="flex items-start justify-between">
          {[
            { step: 1, label: 'Tạo dự án' },
            { step: 2, label: 'Import dữ liệu' },
            { step: 3, label: 'Cấu hình nhãn' },
            { step: 4, label: 'Gán nhãn' },
            { step: 5, label: 'Review QA' },
            { step: 6, label: 'Nghiệm thu' },
            { step: 7, label: 'Export' },
          ].map(({ step, label }, idx) => (
            <div key={step} className="flex items-start">
              <div className="flex flex-col items-center" style={{ minWidth: 60 }}>
                <div style={{
                  width: 34, height: 34, borderRadius: '50%',
                  backgroundColor: '#eff6ff', border: '2px solid #2563eb',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 700, color: '#2563eb', flexShrink: 0,
                }}>
                  {step}
                </div>
                <span style={{ fontSize: 11, color: '#374151', fontWeight: 600, textAlign: 'center', marginTop: 6, lineHeight: 1.3 }}>
                  {label}
                </span>
              </div>
              {idx < 6 && (
                <span style={{ fontSize: 16, color: '#93c5fd', margin: '0 2px', marginTop: 9, flexShrink: 0 }}>→</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ─── Stats Grid ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          {
            label: 'Tổng samples',
            value: stats?.total_samples,
            icon: Database,
            color: '#2563eb',
            topBorder: '#2563eb',
            iconBg: '#eff6ff',
            sub: 'Toàn bộ dữ liệu',
          },
          {
            label: 'Đã gán nhãn',
            value: stats?.annotated_count,
            icon: CheckCircle2,
            color: '#16a34a',
            topBorder: '#16a34a',
            iconBg: '#f0fdf4',
            sub: timeRange === '7d' ? '7 ngày qua' : timeRange === '30d' ? '30 ngày qua' : 'Tất cả thời gian',
          },
          {
            label: 'Chờ review',
            value: stats?.pending_review,
            icon: Clock,
            color: '#d97706',
            topBorder: '#f59e0b',
            iconBg: '#fffbeb',
            sub: stats?.pending_review === 0 ? 'Đã xử lý hết' : 'Cần kiểm duyệt',
          },
          {
            label: 'Tỷ lệ hoàn thành',
            value: stats ? `${stats.completion_rate}%` : undefined,
            icon: TrendingUp,
            color: '#9333ea',
            topBorder: '#a855f7',
            iconBg: '#faf5ff',
            sub: `${stats?.approved_count ?? 0} đã duyệt`,
          },
        ].map((cfg) => (
          <StatCard
            key={cfg.label}
            icon={cfg.icon}
            value={showStatsLoading ? null : (cfg.value ?? '--')}
            label={cfg.label}
            subLabel={cfg.sub}
            color={cfg.color}
            topBorder={cfg.topBorder}
            iconBg={cfg.iconBg}
          />
        ))}
      </div>

      {/* ─── Chart + Activity (same height, compact) ─── */}
      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 300px', height: 220 }}>

        {/* Tiến độ gán nhãn chart */}
        <div className="bg-white rounded-xl flex flex-col" style={{ border: '1px solid #e5e7eb' }}>
          <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid #f3f4f6' }}>
            <h3 className="font-semibold text-gray-800 text-sm">Tiến độ gán nhãn</h3>
            <span className="text-xs text-gray-400">
              {timeRange === '7d' ? '7 ngày qua' : timeRange === '30d' ? '30 ngày qua' : 'Tất cả'}
            </span>
          </div>
          <div className="flex-1 px-5 py-4">
            <AnnotationChart data={chartData} loading={showStatsLoading} />
          </div>
        </div>

        {/* Hoạt động gần đây */}
        <div className="bg-white rounded-xl flex flex-col" style={{ border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid #f3f4f6' }}>
            <h3 className="font-semibold text-gray-800 text-sm">Hoạt động gần đây</h3>
            <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#16a34a', display: 'inline-block' }} />
          </div>
          <div className="overflow-y-auto flex-1">
            {showDashboardLoading ? (
              <div className="flex items-center justify-center py-8 text-gray-400 text-sm">Đang tải...</div>
            ) : dashboardData.recent_activity.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-gray-400 text-sm">Chưa có hoạt động</div>
            ) : (
              dashboardData.recent_activity.map((item) => (
                <div key={item.id} className="flex gap-2.5 px-4 py-2.5" style={{ borderBottom: '1px solid #f9fafb' }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    backgroundColor: '#eff6ff', border: '1px solid #dbeafe',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, fontSize: 10, fontWeight: 700, color: '#2563eb',
                  }}>
                    {item.user_full_name?.split(' ').slice(-1)[0]?.[0]?.toUpperCase() ?? '?'}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-gray-800 leading-tight">{ACTION_LABELS[item.action] ?? item.action}</p>
                    <p className="text-[10px] text-blue-600 truncate">{item.user_full_name ?? 'Hệ thống'}</p>
                    <p className="text-[10px] text-gray-400">{timeAgo(item.created_at)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ─── Dự án gần đây (full width) ─── */}
      <div className="bg-white rounded-xl" style={{ border: '1px solid #e5e7eb', overflow: 'hidden' }}>
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid #f3f4f6' }}>
          <h3 className="font-semibold text-gray-800 text-sm">Dự án gần đây</h3>
          <Link
            to="/projects"
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium px-3 py-1.5 rounded-lg"
            style={{ border: '1px solid #dbeafe' }}
          >
            → Tất cả
          </Link>
        </div>
        <div className="grid items-center text-[11px] font-bold uppercase tracking-widest text-gray-400 px-5 py-2.5"
          style={{ gridTemplateColumns: RECENT_PROJECT_GRID_COLUMNS, columnGap: 20, borderBottom: '1px solid #f3f4f6' }}>
          <div>Dự án</div>
          <div>Tiến độ</div>
          <div className="text-center">Chờ review</div>
          <div className="text-center">Deadline</div>
          <div className="text-center">Trạng thái</div>
        </div>
        {showDashboardLoading ? (
          <div className="flex items-center justify-center py-10 text-gray-400 text-sm">Đang tải...</div>
        ) : dashboardData.recent_projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-gray-400">
            <FolderKanban className="w-8 h-8 mb-2 text-gray-200" />
            <span className="text-sm">Chưa có dự án nào</span>
          </div>
        ) : (
          dashboardData.recent_projects.map((proj) => {
            const cfg = STATUS_CFG[proj.status] ?? STATUS_CFG['not_started'];
            const pct = Math.round(proj.progress * 100);
            return (
              <Link
                key={proj.id}
                to={`/projects/${proj.id}`}
                className="grid px-5 py-3 hover:bg-gray-50 transition-colors"
                style={{ gridTemplateColumns: RECENT_PROJECT_GRID_COLUMNS, columnGap: 20, borderBottom: '1px solid #f9fafb', alignItems: 'center' }}
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{proj.name}</p>
                  <p className="text-xs text-gray-400">{proj.code}</p>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex-1 min-w-0 h-1.5 rounded-full bg-gray-100">
                    <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: cfg.color }} />
                  </div>
                  <span className="text-xs text-gray-500 w-7 text-right shrink-0">{pct}%</span>
                </div>
                <div className="flex items-center justify-center text-center">
                  <span className="text-xs font-semibold" style={{ color: proj.pending_review > 0 ? '#d97706' : '#9ca3af' }}>
                    {proj.pending_review.toLocaleString()}
                    <span className="font-normal text-gray-400">/{proj.total_samples.toLocaleString()}</span>
                  </span>
                </div>
                <div className="flex items-center justify-center text-center">
                  <span className="text-sm text-gray-600">
                    {proj.deadline ? new Date(proj.deadline).toLocaleDateString('vi-VN') : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-center">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
                    style={{ color: cfg.color, backgroundColor: cfg.bg }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: cfg.color, display: 'inline-block' }} />
                    {cfg.label}
                  </span>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Stat Card ───────────────────────────────────────────────
function StatCard({
  icon: Icon,
  value,
  label,
  subLabel,
  color,
  topBorder,
  iconBg,
}: {
  icon: React.ElementType;
  value: number | string | null;
  label: string;
  subLabel: string;
  color: string;
  topBorder: string;
  iconBg: string;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        backgroundColor: '#fff',
        borderRadius: '12px',
        border: `1px solid ${hovered ? topBorder : '#e5e7eb'}`,
        borderTop: `4px solid ${topBorder}`,
        padding: '20px',
        boxShadow: hovered ? `0 8px 24px rgba(0,0,0,0.08)` : '0 1px 3px rgba(0,0,0,0.04)',
        transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
        cursor: 'default',
      }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        backgroundColor: iconBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 16,
      }}>
        <Icon style={{ width: 20, height: 20, color }} />
      </div>
      <p style={{ fontSize: 32, fontWeight: 700, color, lineHeight: 1, marginBottom: 6, minHeight: 32 }}>
        {value === null ? (
          <span style={{ display: 'inline-block', width: 64, height: 28, backgroundColor: '#f3f4f6', borderRadius: 4 }} />
        ) : (
          typeof value === 'number' ? value.toLocaleString() : value
        )}
      </p>
      <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 12, color, fontWeight: 500 }}>↑ {subLabel}</p>
    </div>
  );
}

// ─── Annotation Bar Chart ─────────────────────────────────────
function AnnotationChart({
  data,
  loading,
}: {
  data: { date: string; count: number }[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-end gap-1" style={{ height: 110 }}>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex-1 rounded-t-sm animate-pulse bg-surface-100"
            style={{ height: `${30 + Math.random() * 70}%` }} />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-surface-400" style={{ height: 110 }}>
        <TrendingUp className="w-8 h-8 mb-2 text-surface-200" />
        <p className="text-sm">Chưa có dữ liệu gán nhãn</p>
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.count), 1);

  const fmtDate = (d: string) => {
    const dt = new Date(d + 'T00:00:00');
    return `${dt.getDate()}/${dt.getMonth() + 1}`;
  };

  const showEvery = Math.ceil(data.length / 8);

  return (
    <div>
      <div className="flex items-end gap-1" style={{ height: 110 }}>
        {data.map((d, i) => {
          const barH = Math.max((d.count / max) * 100, d.count > 0 ? 2 : 0);
          return (
            <div key={d.date} className="flex-1 relative group" style={{ height: 110 }}>
              {d.count > 0 && (
                <div
                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 bg-surface-800 text-white text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none"
                >
                  {d.count.toLocaleString()}
                </div>
              )}
              <div
                className="absolute bottom-0 left-0 right-0 rounded-t-sm transition-colors"
                style={{
                  height: d.count > 0 ? `${barH}%` : '4px',
                  backgroundColor: d.count > 0 ? '#2563eb' : '#e2e8f0',
                }}
              />
            </div>
          );
        })}
      </div>
      {/* X axis */}
      <div className="flex gap-1 mt-2 border-t border-surface-100 pt-2">
        {data.map((d, i) => (
          <div key={d.date} className="flex-1 text-center text-[10px] text-surface-400 overflow-hidden">
            {i % showEvery === 0 ? fmtDate(d.date) : ''}
          </div>
        ))}
      </div>
    </div>
  );
}
