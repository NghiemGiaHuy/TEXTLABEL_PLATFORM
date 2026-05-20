// src/layouts/MainLayout.tsx

import { useRef, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderKanban,
  Users,
  Tag,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Settings,
  UserCircle,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../api/authApi';
import NotificationBell from '../components/NotificationBell';

// ─── Navigation Config ──────────────────────────────────────
const navSections = [
  {
    section: 'TỔNG QUAN',
    items: [
      { to: '/', label: 'Trang chủ', icon: LayoutDashboard, end: true },
    ],
  },
  {
    section: 'QUẢN LÝ',
    items: [
      { to: '/projects', label: 'Dự án', icon: FolderKanban, end: false },
    ],
  },
  {
    section: 'HỆ THỐNG',
    items: [
      { to: '/admin/users', label: 'Người dùng', icon: Users, end: false },
    ],
  },
  {
    section: 'TÀI KHOẢN',
    items: [
      { to: '/settings', label: 'Cài đặt', icon: Settings, end: false },
    ],
  },
];

export default function MainLayout() {
  const { user, refreshToken, logout } = useAuthStore();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const handleLogout = async () => {
    try {
      if (refreshToken) await authApi.logout(refreshToken);
    } catch { /* server-side revoke failed — still clear client state */ }
    finally {
      logout();
      navigate('/login', { replace: true });
    }
  };

  const initials = user?.full_name
    ?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '??';

  const roleLabel =
    user?.roles?.[0] === 'admin' || user?.roles?.[0] === 'ADMIN'
      ? 'Quản trị viên'
      : user?.roles?.[0] === 'project_owner' || user?.roles?.[0] === 'PROJECT_OWNER'
      ? 'Chủ dự án'
      : user?.roles?.[0] === 'reviewer' || user?.roles?.[0] === 'REVIEWER'
      ? 'Reviewer'
      : 'Annotator';

  return (
    <div className="flex h-screen bg-[#f0f2f5]">
      {/* ─── Sidebar ─────────────────────────────────────── */}
      <aside
        className={`shrink-0 flex flex-col transition-all duration-200 ${
          sidebarOpen ? 'w-[240px]' : 'w-0 overflow-hidden'
        }`}
        style={{ backgroundColor: '#1a2d42' }}
      >
        {/* Brand */}
        <div className="h-16 flex items-center gap-3 px-5 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center shrink-0">
            <Tag className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <div className="leading-tight min-w-0">
            <span className="text-sm font-semibold text-white block">TextLabel</span>
            <span className="text-[10px] text-blue-300 uppercase tracking-wider font-medium">Platform</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-3 overflow-y-auto space-y-5">
          {navSections.map(({ section, items }) => {
            return (
              <div key={section}>
                <p
                  className="text-[10px] font-bold uppercase tracking-widest px-3 mb-1.5"
                  style={{ color: 'rgba(255,255,255,0.35)' }}
                >
                  {section}
                </p>
                <div className="space-y-0.5">
                  {items.map(({ to, label, icon: Icon, end }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={end}
                      className={({ isActive }) =>
                        `group flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                          isActive
                            ? 'bg-blue-600 text-white'
                            : 'text-blue-100/70 hover:bg-white/8 hover:text-white'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <Icon
                            className={`w-[18px] h-[18px] shrink-0 ${
                              isActive ? 'text-white' : 'text-blue-300/70 group-hover:text-blue-200'
                            }`}
                          />
                          <span className="flex-1">{label}</span>
                          {isActive && <ChevronRight className="w-3.5 h-3.5 text-blue-300 shrink-0" />}
                        </>
                      )}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        {/* User card */}
        <div className="p-3 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-center gap-2.5 p-2.5 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
                {initials}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user?.full_name || 'Unknown'}</p>
              <p className="text-[11px] text-blue-300/70">{roleLabel}</p>
            </div>
            <button
              onClick={handleLogout}
              title="Đăng xuất"
              className="p-1.5 rounded-md text-blue-300/70 hover:text-red-400 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ─── Main Content ────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="h-16 shrink-0 bg-white flex items-center justify-between px-4" style={{ borderBottom: '1px solid #e5e7eb' }}>
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="p-2 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors cursor-pointer"
            title={sidebarOpen ? 'Ẩn menu' : 'Hiện menu'}
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <div className="flex items-center gap-2">
            {/* Notification Bell */}
            <NotificationBell />

            {/* User menu */}
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
              >
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover border border-gray-200" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-bold">
                    {initials}
                  </div>
                )}
                <div className="leading-tight hidden sm:block">
                  <p className="text-sm font-medium text-gray-800">{user?.full_name || 'Unknown'}</p>
                  <p className="text-[11px] text-gray-400">{roleLabel}</p>
                </div>
              </button>

              {/* Dropdown */}
              {userMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-2 w-52 bg-white rounded-xl shadow-xl border border-surface-200 py-1.5 z-50"
                  onMouseLeave={() => setUserMenuOpen(false)}
                >
                  <div className="px-3 py-2 border-b border-surface-100 mb-1">
                    <p className="text-sm font-semibold text-surface-800 truncate">{user?.full_name}</p>
                    <p className="text-xs text-surface-400 truncate">{user?.email}</p>
                  </div>
                  <button
                    onClick={() => { setUserMenuOpen(false); navigate('/settings'); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-surface-700 hover:bg-surface-50 transition-colors"
                  >
                    <UserCircle className="w-4 h-4 text-surface-400" />
                    Thông tin cá nhân
                  </button>
                  <button
                    onClick={() => { setUserMenuOpen(false); navigate('/settings?tab=security'); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-surface-700 hover:bg-surface-50 transition-colors"
                  >
                    <Settings className="w-4 h-4 text-surface-400" />
                    Cài đặt
                  </button>
                  <div className="border-t border-surface-100 mt-1 pt-1">
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      Đăng xuất
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
