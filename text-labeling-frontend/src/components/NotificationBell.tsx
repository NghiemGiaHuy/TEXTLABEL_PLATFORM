// src/components/NotificationBell.tsx

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckCheck,
  Loader2,
  BellOff,
  Info,
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Calendar,
} from 'lucide-react';
import { notificationApi, type NotificationItem } from '../api/notificationApi';

const TYPE_CFG: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  task_assigned:    { icon: ClipboardList, color: 'text-blue-600',    bg: 'bg-blue-50'    },
  task_rejected:    { icon: AlertCircle,   color: 'text-red-600',     bg: 'bg-red-50'     },
  task_approved:    { icon: CheckCircle2,  color: 'text-emerald-600', bg: 'bg-emerald-50' },
  task_submitted:   { icon: ClipboardList, color: 'text-purple-600',  bg: 'bg-purple-50'  },
  project_deadline: { icon: Calendar,      color: 'text-orange-600',  bg: 'bg-orange-50'  },
  review_complete:  { icon: CheckCircle2,  color: 'text-emerald-600', bg: 'bg-emerald-50' },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Vừa xong';
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  return `${d} ngày trước`;
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await notificationApi.list({ limit: 20 });
      setNotifications(res.notifications);
      setUnreadCount(res.unread_count);
    } catch {
      // silently fail — bell is non-critical
    }
  }, []);

  // Initial fetch + poll every 60 seconds
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close panel on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleOpen = () => {
    setOpen((v) => !v);
    if (!open) {
      setLoading(true);
      notificationApi.list({ limit: 20 }).then((res) => {
        setNotifications(res.notifications);
        setUnreadCount(res.unread_count);
      }).finally(() => setLoading(false));
    }
  };

  const handleClickNotification = async (n: NotificationItem) => {
    if (!n.is_read) {
      await notificationApi.markRead(n.id);
      setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, is_read: true } : x));
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    try {
      await notificationApi.markAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={handleOpen}
        className="relative p-2 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors cursor-pointer"
        title="Thông báo"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-white rounded-2xl shadow-xl border border-surface-200 z-50 flex flex-col"
          style={{ maxHeight: 480 }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-surface-100">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-surface-600" />
              <span className="text-sm font-semibold text-surface-800">Thông báo</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 text-[10px] font-bold">
                  {unreadCount} mới
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                disabled={markingAll}
                className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50 transition-colors"
              >
                {markingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3 h-3" />}
                Đọc tất cả
              </button>
            )}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-surface-300" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center px-4">
                <BellOff className="w-8 h-8 text-surface-300" />
                <p className="text-sm text-surface-400">Chưa có thông báo nào</p>
              </div>
            ) : (
              notifications.map((n) => {
                const cfg = TYPE_CFG[n.type] ?? { icon: Info, color: 'text-surface-600', bg: 'bg-surface-100' };
                const IconComp = cfg.icon;
                return (
                  <button
                    key={n.id}
                    onClick={() => handleClickNotification(n)}
                    className={`w-full text-left px-4 py-3 border-b border-surface-50 hover:bg-surface-50 transition-colors flex items-start gap-3 ${
                      !n.is_read ? 'bg-blue-50/40' : ''
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-full ${cfg.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                      <IconComp className={`w-4 h-4 ${cfg.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm font-medium text-surface-800 leading-tight ${!n.is_read ? 'font-semibold' : ''}`}>
                          {n.title}
                        </p>
                        {!n.is_read && (
                          <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1" />
                        )}
                      </div>
                      <p className="text-xs text-surface-500 mt-0.5 line-clamp-2">{n.message}</p>
                      <p className="text-[10px] text-surface-400 mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-surface-100">
            <button
              onClick={() => { setOpen(false); navigate('/settings?tab=notifications'); }}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium transition-colors"
            >
              Cài đặt thông báo →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
