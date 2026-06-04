// src/pages/Users.tsx

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  AlertCircle,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Search,
  Shield,
  Tag,
  Trash2,
  Unlock,
  Users as UsersIcon,
  type LucideIcon,
} from 'lucide-react';
import { userApi } from '../api/userApi';
import type { AdminUser, Role, UserRoleCounts } from '../types';
import Modal from '../components/Modal';
import { useConfirm } from '../components/ConfirmDialog';
import { useToast } from '../components/toastContext';
import { useAuthStore } from '../store/authStore';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  project_owner: 'Project Owner',
  annotator: 'Annotator',
  reviewer: 'Reviewer',
};

const ROLE_STYLES: Record<
  string,
  { bg: string; text: string; icon: LucideIcon; accent: string }
> = {
  admin: {
    bg: 'bg-red-50',
    text: 'text-red-700',
    icon: Shield,
    accent: 'text-red-600',
  },
  project_owner: {
    bg: 'bg-brand-50',
    text: 'text-brand-700',
    icon: Pencil,
    accent: 'text-brand-600',
  },
  annotator: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    icon: Tag,
    accent: 'text-emerald-600',
  },
  reviewer: {
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    icon: Eye,
    accent: 'text-amber-600',
  },
};

const ROLE_CARDS: Array<keyof UserRoleCounts> = [
  'project_owner',
  'annotator',
  'reviewer',
];

const EMPTY_ROLE_COUNTS: UserRoleCounts = {
  admin: 0,
  project_owner: 0,
  annotator: 0,
  reviewer: 0,
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeRole(name: string) {
  return name.toLowerCase();
}

function hasAdminRole(roles?: string[]) {
  return roles?.some((role) => normalizeRole(role) === 'admin') ?? false;
}

function getRoleLabel(name: string) {
  return ROLE_LABELS[normalizeRole(name)] ?? name.replace('_', ' ');
}

function roleDisplayName(name: string) {
  return getRoleLabel(name);
}

type ApiError = {
  response?: {
    data?: {
      detail?: string | Array<{ msg?: string }>;
    };
  };
};

function getErrorMessage(err: unknown, fallback: string) {
  const detail = (err as ApiError)?.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d: { msg?: string }) => d.msg || String(d))
      .join('; ');
  }
  return typeof detail === 'string' ? detail : fallback;
}

function getEmailValidationError(value: string, showRequired = false) {
  const email = value.trim();
  if (!email) return showRequired ? 'Vui lòng nhập email.' : '';
  if (!EMAIL_PATTERN.test(email)) return 'Email không đúng định dạng.';
  return '';
}

function getPasswordValidationError(value: string, showRequired = false) {
  if (!value) return showRequired ? 'Vui lòng nhập mật khẩu.' : '';
  if (value.length < 8) return 'Mật khẩu cần tối thiểu 8 ký tự.';
  if (value.length > 128) return 'Mật khẩu tối đa 128 ký tự.';
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/\d/.test(value)) {
    return 'Mật khẩu cần có chữ hoa, chữ thường và số.';
  }
  return '';
}

function inputClass(hasError: boolean, extra = '') {
  return [
    'input-field',
    hasError && 'border-red-400 focus:border-red-500 focus:ring-red-500/20',
    extra,
  ]
    .filter(Boolean)
    .join(' ');
}

function formatDate(value: string | null, withTime = false) {
  if (!value) return 'Chưa đăng nhập';
  return new Date(value).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

function getInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function deriveRoleCounts(users: AdminUser[]): UserRoleCounts {
  return users.reduce(
    (acc, user) => {
      user.roles.forEach((role) => {
        const name = normalizeRole(role.name);
        if (name in acc) acc[name as keyof UserRoleCounts] += 1;
      });
      return acc;
    },
    { ...EMPTY_ROLE_COUNTS }
  );
}

function RoleBadge({ name }: { name: string }) {
  const roleName = normalizeRole(name);
  const style = ROLE_STYLES[roleName] || ROLE_STYLES.annotator;
  const Icon = style.icon;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${style.bg} ${style.text}`}
    >
      <Icon className="w-3 h-3" />
      {getRoleLabel(roleName)}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const isActive = status === 'active';
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
        isActive ? 'text-emerald-600' : 'text-red-500'
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          isActive ? 'bg-emerald-500' : 'bg-red-400'
        }`}
      />
      {isActive ? 'Hoạt động' : 'Đã khóa'}
    </span>
  );
}

function RoleCountCard({
  roleName,
  count,
}: {
  roleName: keyof UserRoleCounts;
  count: number;
}) {
  const style = ROLE_STYLES[roleName];
  const Icon = style.icon;

  return (
    <div className="bg-white rounded-lg border border-surface-200/70 px-5 py-4 shadow-subtle">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-surface-500">
            {ROLE_LABELS[roleName]}
          </p>
          <p className={`mt-2 text-3xl font-bold ${style.accent}`}>{count}</p>
        </div>
        <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${style.bg}`}>
          <Icon className={`w-5 h-5 ${style.text}`} />
        </div>
      </div>
    </div>
  );
}

function IconActionButton({
  title,
  onClick,
  disabled,
  tone = 'default',
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  children: ReactNode;
}) {
  const toneClass =
    tone === 'danger'
      ? 'text-surface-500 hover:text-red-600 hover:bg-red-50'
      : 'text-surface-500 hover:text-brand-700 hover:bg-brand-50';

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`w-9 h-9 inline-flex items-center justify-center rounded-lg border border-surface-200 bg-white transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}
    >
      {children}
    </button>
  );
}

export default function Users() {
  const currentUser = useAuthStore((s) => s.user);
  const isAdmin = hasAdminRole(currentUser?.roles);
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roleCounts, setRoleCounts] = useState<UserRoleCounts>(EMPTY_ROLE_COUNTS);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<AdminUser | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await userApi.getUsers({
        search: search || undefined,
        role: roleFilter || undefined,
        status: statusFilter || undefined,
        page_size: 100,
      });
      setUsers(res.users);
      setTotal(res.total);
      setRoleCounts(res.role_counts ?? deriveRoleCounts(res.users));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Không tải được danh sách người dùng'));
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, statusFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchUsers();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchUsers]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const handleToggleLock = async (user: AdminUser) => {
    const key = `lock:${user.id}`;
    setActionLoading(key);
    try {
      if (user.status === 'active') {
        await userApi.lockUser(user.id);
        showToast('success', `Đã khóa tài khoản ${user.full_name}`);
      } else {
        await userApi.unlockUser(user.id);
        showToast('success', `Đã mở khóa tài khoản ${user.full_name}`);
      }
      fetchUsers();
    } catch (err: unknown) {
      showToast('error', getErrorMessage(err, 'Thao tác thất bại'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteUser = async (user: AdminUser) => {
    const ok = await confirm(
      `Xóa tài khoản ${user.full_name}? Thao tác này không thể hoàn tác.`,
      {
        title: 'Xóa tài khoản',
        confirmText: 'Xóa',
        variant: 'danger',
      }
    );
    if (!ok) return;

    const key = `delete:${user.id}`;
    setActionLoading(key);
    try {
      await userApi.deleteUser(user.id);
      showToast('success', `Đã xóa tài khoản ${user.full_name}`);
      fetchUsers();
    } catch (err: unknown) {
      showToast('error', getErrorMessage(err, 'Không xóa được tài khoản'));
    } finally {
      setActionLoading(null);
    }
  };

  const hasSearch = !!search || !!roleFilter || !!statusFilter;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quản lý người dùng</h1>
          <p className="text-surface-500 text-[15px] mt-0.5">
            {total} thành viên
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowCreate(true)}
            className="btn-primary self-start"
          >
            <Plus className="w-4 h-4" />
            Thêm user
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {ROLE_CARDS.map((roleName) => (
          <RoleCountCard
            key={roleName}
            roleName={roleName}
            count={roleCounts[roleName] ?? 0}
          />
        ))}
      </div>

      <div className="flex flex-col lg:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
          <input
            type="text"
            placeholder="Tìm tên, email..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="input-field pl-9"
          />
        </div>
        <div className="relative">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="input-field pr-8 appearance-none min-w-[170px]"
          >
            <option value="">Tất cả vai trò</option>
            <option value="admin">Admin</option>
            <option value="project_owner">Project Owner</option>
            <option value="annotator">Annotator</option>
            <option value="reviewer">Reviewer</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none" />
        </div>
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input-field pr-8 appearance-none min-w-[180px]"
          >
            <option value="">Tất cả trạng thái</option>
            <option value="active">Hoạt động</option>
            <option value="locked">Đã khóa</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none" />
        </div>
        <div className="flex items-center text-sm text-surface-500 px-1">
          {total} kết quả
        </div>
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchUsers} />
      ) : users.length === 0 ? (
        <EmptyState hasSearch={hasSearch} />
      ) : (
        <div className="bg-white rounded-lg border border-surface-200/70 shadow-subtle overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px]">
              <thead>
                <tr className="border-b border-surface-100 bg-surface-50/70">
                  <TableHead>Thành viên</TableHead>
                  <TableHead>Vai trò</TableHead>
                  <TableHead>Dự án</TableHead>
                  <TableHead>Task xong</TableHead>
                  <TableHead>Đăng nhập gần đây</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  {isAdmin && <TableHead align="right">Thao tác</TableHead>}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {users.map((user) => {
                  const isSelf = currentUser?.id === user.id;
                  const projectCount = user.project_count ?? user.projects?.length ?? 0;
                  const projectTitle =
                    user.projects?.map((p) => `${p.code} - ${p.name}`).join('\n') ||
                    'Chưa có dự án';
                  const actionBusy = !!actionLoading;

                  return (
                    <tr
                      key={user.id}
                      className="hover:bg-surface-50/60 transition-colors"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold shrink-0">
                            {getInitials(user.full_name)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-surface-900 truncate">
                              {user.full_name}
                            </p>
                            <p className="text-xs text-surface-400 truncate">
                              {user.email}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="px-5 py-3.5">
                        <div className="flex flex-wrap gap-1.5">
                          {user.roles.map((role) => (
                            <RoleBadge key={role.id} name={role.name} />
                          ))}
                        </div>
                      </td>

                      <td
                        className="px-5 py-3.5 text-sm font-semibold text-surface-700"
                        title={projectTitle}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <BriefcaseBusiness className="w-4 h-4 text-surface-400" />
                          {projectCount}
                        </span>
                      </td>

                      <td className="px-5 py-3.5 text-sm font-semibold text-surface-700">
                        <span className="inline-flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          {user.task_done_count ?? 0}
                        </span>
                      </td>

                      <td className="px-5 py-3.5 text-sm text-surface-500">
                        {formatDate(user.last_login_at, true)}
                      </td>

                      <td className="px-5 py-3.5">
                        <StatusPill status={user.status} />
                      </td>

                      {isAdmin && (
                        <td className="px-5 py-3.5">
                          <div className="flex items-center justify-end gap-1.5">
                            <IconActionButton
                              title="Sửa người dùng"
                              onClick={() => setEditingUser(user)}
                              disabled={actionBusy}
                            >
                              <Pencil className="w-4 h-4" />
                            </IconActionButton>
                            <IconActionButton
                              title="Đặt lại mật khẩu"
                              onClick={() => setResetPasswordUser(user)}
                              disabled={actionBusy}
                            >
                              <KeyRound className="w-4 h-4" />
                            </IconActionButton>
                            <IconActionButton
                              title={
                                isSelf
                                  ? 'Không thể khóa chính bạn'
                                  : user.status === 'active'
                                  ? 'Khóa tài khoản'
                                  : 'Mở khóa tài khoản'
                              }
                              onClick={() => handleToggleLock(user)}
                              disabled={actionBusy || isSelf}
                            >
                              {actionLoading === `lock:${user.id}` ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : user.status === 'active' ? (
                                <Lock className="w-4 h-4" />
                              ) : (
                                <Unlock className="w-4 h-4" />
                              )}
                            </IconActionButton>
                            <IconActionButton
                              title={
                                isSelf
                                  ? 'Không thể xóa chính bạn'
                                  : 'Xóa tài khoản'
                              }
                              onClick={() => handleDeleteUser(user)}
                              disabled={actionBusy || isSelf}
                              tone="danger"
                            >
                              {actionLoading === `delete:${user.id}` ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </IconActionButton>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <CreateUserModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          setShowCreate(false);
          fetchUsers();
        }}
      />
      <EditUserModal
        user={editingUser}
        isOpen={!!editingUser}
        onClose={() => setEditingUser(null)}
        onSaved={() => {
          setEditingUser(null);
          fetchUsers();
        }}
      />
      <ResetPasswordModal
        user={resetPasswordUser}
        isOpen={!!resetPasswordUser}
        onClose={() => setResetPasswordUser(null)}
        onSaved={() => {
          setResetPasswordUser(null);
          fetchUsers();
        }}
      />
      {ConfirmDialog}
    </div>
  );
}

function TableHead({
  children,
  align = 'left',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
}) {
  const alignment = align === 'right' ? 'text-right' : 'text-left';

  return (
    <th
      className={`${alignment} text-xs font-semibold text-surface-500 uppercase tracking-wider px-5 py-3`}
    >
      {children}
    </th>
  );
}

function RoleOptionGrid({
  roles,
  selectedRoles,
  onToggle,
  selectionMode = 'multiple',
}: {
  roles: Role[];
  selectedRoles: string[];
  onToggle: (roleId: string) => void;
  selectionMode?: 'single' | 'multiple';
}) {
  return (
    <div
      role={selectionMode === 'single' ? 'radiogroup' : 'group'}
      className="grid grid-cols-1 sm:grid-cols-2 gap-2"
    >
      {roles.map((role) => {
        const roleName = normalizeRole(role.name);
        const isSelected = selectedRoles.includes(role.id);
        const style = ROLE_STYLES[roleName] || ROLE_STYLES.annotator;
        const Icon = style.icon;

        return (
          <button
            key={role.id}
            type="button"
            onClick={() => onToggle(role.id)}
            role={selectionMode === 'single' ? 'radio' : undefined}
            aria-checked={selectionMode === 'single' ? isSelected : undefined}
            aria-pressed={selectionMode === 'multiple' ? isSelected : undefined}
            className={`flex items-center gap-2.5 p-3 rounded-lg border-2 text-left transition-all duration-150 ${
              isSelected
                ? `${style.bg} border-current ${style.text}`
                : 'border-surface-200 text-surface-600 hover:border-surface-300 hover:bg-surface-50'
            } cursor-pointer`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="text-sm font-medium">
              {roleDisplayName(roleName)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function CreateUserModal({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const timer = window.setTimeout(() => {
      setEmail('');
      setFullName('');
      setPassword('');
      setSelectedRoles([]);
      setError('');
      setSubmitted(false);
      setShowPassword(false);
      setSubmitting(false);
      userApi.getRoles().then((res) => setRoles(res.roles)).catch(() => {});
    }, 0);

    return () => window.clearTimeout(timer);
  }, [isOpen]);

  const toggleRole = (roleId: string) => {
    setSelectedRoles((prev) => (prev[0] === roleId ? [] : [roleId]));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);

    const nextEmailError = getEmailValidationError(email, true);
    const nextPasswordError = getPasswordValidationError(password, true);

    if (!fullName.trim()) {
      setError('Vui lòng nhập họ tên.');
      return;
    }
    if (nextEmailError || nextPasswordError) {
      setError('');
      return;
    }
    if (selectedRoles.length === 0) {
      setError('Vui lòng chọn một vai trò.');
      return;
    }
    setSubmitting(true);
    setError('');

    try {
      await userApi.createUser({
        email: email.trim(),
        full_name: fullName.trim(),
        password,
        role_ids: selectedRoles,
      });
      onCreated();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Không tạo được người dùng'));
    } finally {
      setSubmitting(false);
    }
  };

  const emailError = getEmailValidationError(email, submitted || email.length > 0);
  const passwordError = getPasswordValidationError(
    password,
    submitted || password.length > 0
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Thêm user">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && <InlineError message={error} />}

        <FieldLabel label="Họ tên" required>
          <input
            type="text"
            required
            autoFocus
            placeholder="Nguyễn Văn A"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="input-field"
          />
        </FieldLabel>

        <FieldLabel label="Email" required>
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="user@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!emailError}
            aria-describedby={emailError ? 'create-user-email-error' : undefined}
            className={inputClass(!!emailError)}
          />
          <FieldError id="create-user-email-error" message={emailError} />
        </FieldLabel>

        <FieldLabel label="Mật khẩu" required>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              placeholder="Tối thiểu 8 ký tự, có chữ hoa, chữ thường và số"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!passwordError}
              aria-describedby={
                passwordError ? 'create-user-password-error' : undefined
              }
              className={inputClass(!!passwordError, 'pr-11')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-700 transition-colors cursor-pointer"
            >
              {showPassword ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>
          <FieldError id="create-user-password-error" message={passwordError} />
        </FieldLabel>

        <div>
          <p className="block text-sm font-medium text-surface-700 mb-2">
            Vai trò <span className="text-red-400">*</span>
          </p>
          <RoleOptionGrid
            roles={roles}
            selectedRoles={selectedRoles}
            onToggle={toggleRole}
            selectionMode="single"
          />
          {selectedRoles.length === 0 && (
            <p className="text-xs text-surface-400 mt-1.5">
              Chọn một vai trò
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Hủy
          </button>
          <button
            type="submit"
            disabled={submitting || selectedRoles.length === 0}
            className="btn-primary"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Đang tạo...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                Thêm user
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditUserModal({
  user,
  isOpen,
  onClose,
  onSaved,
}: {
  user: AdminUser | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !user) return;

    const timer = window.setTimeout(() => {
      setFullName(user.full_name);
      setSelectedRoles(user.roles[0] ? [user.roles[0].id] : []);
      setRoles(user.roles);
      setError('');
      userApi.getRoles().then((res) => setRoles(res.roles)).catch(() => {});
    }, 0);

    return () => window.clearTimeout(timer);
  }, [isOpen, user]);

  const toggleRole = (roleId: string) => {
    setSelectedRoles((prev) => (prev[0] === roleId ? [] : [roleId]));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!fullName.trim() || selectedRoles.length === 0) {
      setError('Vui lòng nhập họ tên và chọn một vai trò.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await userApi.updateUser(user.id, {
        full_name: fullName.trim(),
        role_ids: selectedRoles,
      });
      onSaved();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Không cập nhật được người dùng'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Sửa người dùng">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <InlineError message={error} />}

        <FieldLabel label="Họ tên" required>
          <input
            type="text"
            required
            autoFocus
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="input-field"
          />
        </FieldLabel>

        <FieldLabel label="Email">
          <input
            type="email"
            value={user?.email ?? ''}
            disabled
            className="input-field bg-surface-50 text-surface-500"
          />
        </FieldLabel>

        <div>
          <p className="block text-sm font-medium text-surface-700 mb-2">
            Vai trò <span className="text-red-400">*</span>
          </p>
          <RoleOptionGrid
            roles={roles}
            selectedRoles={selectedRoles}
            onToggle={toggleRole}
            selectionMode="single"
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Hủy
          </button>
          <button
            type="submit"
            disabled={submitting || selectedRoles.length === 0}
            className="btn-primary"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Đang lưu...
              </>
            ) : (
              <>
                <Pencil className="w-4 h-4" />
                Lưu thay đổi
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({
  user,
  isOpen,
  onClose,
  onSaved,
}: {
  user: AdminUser | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    setNewPassword('');
    setShowNewPassword(false);
    setError('');
    setSubmitting(false);
  }, [isOpen, user?.id]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (!newPassword) {
      setError('Vui lòng nhập mật khẩu mới.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Mật khẩu mới cần tối thiểu 8 ký tự.');
      return;
    }
    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setError('Mật khẩu mới cần có chữ hoa, chữ thường và số.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await userApi.resetPassword(user.id, newPassword);
      showToast('success', `Đã đặt lại mật khẩu cho ${user.full_name}`);
      onSaved();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Không đặt lại được mật khẩu'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Đặt lại mật khẩu">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <InlineError message={error} />}

        <FieldLabel label="Người dùng">
          <input
            type="text"
            value={user ? `${user.full_name} · ${user.email}` : ''}
            disabled
            className="input-field bg-surface-50 text-surface-500"
          />
        </FieldLabel>

        <FieldLabel label="Mật khẩu mới" required>
          <div className="relative">
            <input
              type={showNewPassword ? 'text' : 'password'}
              required
              minLength={8}
              autoFocus
              autoComplete="new-password"
              placeholder="Tối thiểu 8 ký tự, có chữ hoa, chữ thường và số"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="input-field pr-11"
            />
            <button
              type="button"
              onClick={() => setShowNewPassword((visible) => !visible)}
              title={showNewPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              aria-label={showNewPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-700 transition-colors cursor-pointer"
            >
              {showNewPassword ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>
        </FieldLabel>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Hủy
          </button>
          <button
            type="submit"
            disabled={submitting || !newPassword}
            className="btn-primary"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Đang lưu...
              </>
            ) : (
              <>
                <KeyRound className="w-4 h-4" />
                Đặt lại mật khẩu
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function FieldLabel({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-surface-700 mb-1.5">
        {label} {required && <span className="text-red-400">*</span>}
      </span>
      {children}
    </label>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200/60">
      <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
      <p className="text-sm text-red-700">{message}</p>
    </div>
  );
}

function FieldError({ id, message }: { id: string; message: string }) {
  if (!message) return null;

  return (
    <p id={id} className="mt-1.5 flex items-center gap-1.5 text-xs text-red-600">
      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
      {message}
    </p>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
      <span className="ml-2.5 text-sm text-surface-500">Đang tải người dùng...</span>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="w-12 h-12 rounded-lg bg-red-50 flex items-center justify-center mb-4">
        <AlertCircle className="w-6 h-6 text-red-400" />
      </div>
      <p className="text-sm text-surface-600 mb-3">{message}</p>
      <button onClick={onRetry} className="btn-ghost text-brand-600">
        Thử lại
      </button>
    </div>
  );
}

function EmptyState({ hasSearch }: { hasSearch: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="w-12 h-12 rounded-lg bg-surface-100 flex items-center justify-center mb-4">
        <UsersIcon className="w-6 h-6 text-surface-400" />
      </div>
      <p className="text-sm text-surface-600">
        {hasSearch ? 'Không có user phù hợp bộ lọc' : 'Chưa có user'}
      </p>
    </div>
  );
}
