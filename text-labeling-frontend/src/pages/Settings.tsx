// src/pages/Settings.tsx

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  User,
  Lock,
  Palette,
  Bell,
  Info,
  Save,
  Eye,
  EyeOff,
  Check,
  AlertCircle,
  Loader2,
  Shield,
  Globe,
  Type,
  Sun,
  Camera,
  Mail,
  Calendar,
  BadgeCheck,
  Code2,
  Cpu,
  Database,
  Server,
  BookOpen,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../api/authApi';
import { notificationApi } from '../api/notificationApi';
import { useToast } from '../components/toastContext';
import { applyUiTheme, normalizeUiTheme, type UiTheme } from '../utils/theme';

// ─── Types ──────────────────────────────────────────────────────

type Tab = 'profile' | 'security' | 'appearance' | 'notifications' | 'system';

interface UISettings {
  theme: UiTheme;
  language: 'vi';
  annotationFontSize: 'sm' | 'md' | 'lg';
}

interface NotificationPrefs {
  task_assigned: boolean;
  task_rejected: boolean;
  project_deadline: boolean;
  review_complete: boolean;
  task_submitted: boolean;
  annotation_milestone: boolean;
  export_ready: boolean;
}

const DEFAULT_UI: UISettings = { theme: 'light', language: 'vi', annotationFontSize: 'md' };
const DEFAULT_NOTIF: NotificationPrefs = {
  task_assigned: true,
  task_rejected: true,
  project_deadline: true,
  review_complete: true,
  task_submitted: true,
  annotation_milestone: false,
  export_ready: true,
};

function loadUISettings(): UISettings {
  try {
    const raw = localStorage.getItem('settings_ui');
    if (!raw) return DEFAULT_UI;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_UI,
      ...parsed,
      theme: normalizeUiTheme(),
      language: 'vi',
    };
  } catch { return DEFAULT_UI; }
}

// ─── Role display ────────────────────────────────────────────────

const ROLE_DISPLAY: Record<string, { label: string; color: string; bg: string }> = {
  admin:          { label: 'Quản trị viên', color: 'text-red-700',     bg: 'bg-red-50'     },
  project_owner:  { label: 'Chủ dự án',     color: 'text-amber-700',   bg: 'bg-amber-50'   },
  reviewer:       { label: 'Reviewer',       color: 'text-purple-700',  bg: 'bg-purple-50'  },
  annotator:      { label: 'Annotator',      color: 'text-blue-700',    bg: 'bg-blue-50'    },
};

function getRoleDisplay(roles: string[]) {
  const r = roles?.[0]?.toLowerCase() || '';
  return ROLE_DISPLAY[r] ?? { label: roles?.[0] || 'Người dùng', color: 'text-surface-700', bg: 'bg-surface-100' };
}

// ─── Sub-components ──────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-surface-800 mb-4">{children}</h3>;
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex w-10 h-5.5 rounded-full transition-colors focus:outline-none ${
        checked ? 'bg-brand-500' : 'bg-surface-300'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      style={{ height: 22, width: 40 }}
    >
      <span
        className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow-sm transition-transform`}
        style={{
          width: 18,
          height: 18,
          top: 2,
          left: checked ? 20 : 2,
          transition: 'left 0.15s',
        }}
      />
    </button>
  );
}

// ─── Tab: Profile ───────────────────────────────────────────────

function NotifRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-surface-50 last:border-0">
      <div className="flex-1 min-w-0 pr-4">
        <p className="text-sm font-medium text-surface-800">{label}</p>
        <p className="text-xs text-surface-400 mt-0.5">{desc}</p>
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} />
    </div>
  );
}

function ProfileTab() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const { showToast } = useToast();
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || '');
  const [avatarPreviewOk, setAvatarPreviewOk] = useState(false);
  const [saving, setSaving] = useState(false);

  const initials = (user?.full_name || '??')
    .split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  const roleDisplay = getRoleDisplay(user?.roles || []);

  const handleSave = async () => {
    if (!fullName.trim()) { showToast('error', 'Tên không được để trống'); return; }
    setSaving(true);
    try {
      const updated = await authApi.updateProfile({
        full_name: fullName.trim(),
        avatar_url: avatarUrl.trim() || undefined,
      });
      setUser(updated);
      showToast('success', 'Đã cập nhật thông tin');
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast('error', e.response?.data?.detail || 'Cập nhật thất bại');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Profile hero card */}
      <div className="bg-gradient-to-br from-brand-50 to-blue-50 rounded-2xl border border-brand-100 p-6 flex items-center gap-5">
        {/* Avatar */}
        <div className="relative shrink-0">
          {avatarPreviewOk && avatarUrl ? (
            <img
              src={avatarUrl}
              alt="avatar"
              className="w-20 h-20 rounded-full object-cover border-2 border-white shadow-md"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-brand-500 text-white flex items-center justify-center text-2xl font-bold shadow-md border-2 border-white">
              {initials}
            </div>
          )}
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-white shadow border border-surface-200 flex items-center justify-center">
            <Camera className="w-3 h-3 text-surface-500" />
          </div>
        </div>

        {/* Info */}
        <div>
          <h2 className="text-xl font-bold text-surface-900">{user?.full_name || '—'}</h2>
          <p className="text-sm text-surface-500 mt-0.5">{user?.email}</p>
          <div className="flex items-center gap-2 mt-2">
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${roleDisplay.bg} ${roleDisplay.color}`}>
              <Shield className="w-3 h-3" />
              {roleDisplay.label}
            </span>
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
              user?.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${user?.status === 'active' ? 'bg-emerald-500' : 'bg-red-500'}`} />
              {user?.status === 'active' ? 'Active' : 'Locked'}
            </span>
          </div>
        </div>

        {/* Join date */}
        <div className="ml-auto text-right hidden sm:block">
          <p className="text-[11px] font-semibold text-surface-400 uppercase tracking-wide">Tham gia</p>
          <p className="text-sm font-medium text-surface-600 mt-0.5">
            {user?.created_at
              ? new Date(user.created_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
              : '—'}
          </p>
        </div>
      </div>

      {/* Read-only info */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { icon: Mail, label: 'Email', value: user?.email || '—' },
          { icon: Calendar, label: 'Ngày tham gia', value: user?.created_at ? new Date(user.created_at).toLocaleDateString('vi-VN') : '—' },
          { icon: BadgeCheck, label: 'Vai trò', value: roleDisplay.label },
          { icon: Shield, label: 'Trạng thái', value: user?.status === 'active' ? 'Hoạt động' : 'Bị khoá' },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="bg-surface-50 rounded-xl border border-surface-200 px-4 py-3 flex items-center gap-3">
            <Icon className="w-4 h-4 text-surface-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-surface-400 uppercase tracking-wide">{label}</p>
              <p className="text-sm font-medium text-surface-700 truncate mt-0.5">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Edit form */}
      <div className="bg-white rounded-2xl border border-surface-200 p-5 space-y-4">
        <SectionTitle>Chỉnh sửa thông tin</SectionTitle>

        <div>
          <label className="block text-xs font-semibold text-surface-500 mb-1.5">Họ và tên</label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Nhập tên hiển thị..."
            className="w-full px-3.5 py-2.5 rounded-xl border border-surface-200 text-sm text-surface-800 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-400 transition-all"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-surface-500 mb-1.5">Avatar URL</label>
          <div className="flex gap-2">
            <input
              type="url"
              value={avatarUrl}
              onChange={(e) => { setAvatarUrl(e.target.value); setAvatarPreviewOk(false); }}
              placeholder="https://... (để trống dùng initials)"
              className="flex-1 px-3.5 py-2.5 rounded-xl border border-surface-200 text-sm text-surface-800 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-400 transition-all"
            />
            {avatarUrl && (
              <img
                src={avatarUrl}
                alt=""
                className="w-10 h-10 rounded-full object-cover border border-surface-200 shrink-0"
                onLoad={() => setAvatarPreviewOk(true)}
                onError={() => setAvatarPreviewOk(false)}
              />
            )}
          </div>
          <p className="text-[11px] text-surface-400 mt-1">Nhập URL ảnh công khai (JPG, PNG, WebP)</p>
        </div>

        <div className="pt-1">
          <button
            onClick={handleSave}
            disabled={saving || !fullName.trim()}
            className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Lưu thay đổi
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Security ──────────────────────────────────────────────

function SecurityTab() {
  const { showToast } = useToast();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [show, setShow] = useState({ current: false, next: false, confirm: false });
  const [saving, setSaving] = useState(false);
  const [strength, setStrength] = useState(0);

  const calcStrength = (pw: string) => {
    let s = 0;
    if (pw.length >= 8) s++;
    if (/[A-Z]/.test(pw)) s++;
    if (/[a-z]/.test(pw)) s++;
    if (/\d/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    return s;
  };

  const handleChange = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setForm((f) => ({ ...f, [field]: v }));
    if (field === 'next') setStrength(calcStrength(v));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.next !== form.confirm) { showToast('error', 'Mật khẩu xác nhận không khớp'); return; }
    if (form.next.length < 8) { showToast('error', 'Mật khẩu mới phải có ít nhất 8 ký tự'); return; }
    setSaving(true);
    try {
      await authApi.changePassword({ current_password: form.current, new_password: form.next });
      showToast('success', 'Đã đổi mật khẩu thành công');
      setForm({ current: '', next: '', confirm: '' });
      setStrength(0);
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast('error', e.response?.data?.detail || 'Đổi mật khẩu thất bại');
    } finally {
      setSaving(false);
    }
  };

  const strengthColors = ['bg-surface-200', 'bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-blue-500', 'bg-emerald-500'];
  const strengthLabels = ['', 'Rất yếu', 'Yếu', 'Trung bình', 'Mạnh', 'Rất mạnh'];

  return (
    <div className="space-y-6">
      {/* Change password */}
      <div className="bg-white rounded-2xl border border-surface-200 p-5">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
            <Lock className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <SectionTitle>Đổi mật khẩu</SectionTitle>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {[
            { field: 'current' as const, label: 'Mật khẩu hiện tại', placeholder: 'Nhập mật khẩu hiện tại...' },
            { field: 'next' as const, label: 'Mật khẩu mới', placeholder: 'Ít nhất 8 ký tự, có chữ hoa và số...' },
            { field: 'confirm' as const, label: 'Xác nhận mật khẩu mới', placeholder: 'Nhập lại mật khẩu mới...' },
          ].map(({ field, label, placeholder }) => (
            <div key={field}>
              <label className="block text-xs font-semibold text-surface-500 mb-1.5">{label}</label>
              <div className="relative">
                <input
                  type={show[field] ? 'text' : 'password'}
                  value={form[field]}
                  onChange={handleChange(field)}
                  placeholder={placeholder}
                  required
                  className="w-full pr-10 px-3.5 py-2.5 rounded-xl border border-surface-200 text-sm text-surface-800 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-400 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => ({ ...s, [field]: !s[field] }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600"
                >
                  {show[field] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {/* Password strength (only for new password) */}
              {field === 'next' && form.next && (
                <div className="mt-2 space-y-1">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-colors ${i <= strength ? strengthColors[strength] : 'bg-surface-200'}`}
                      />
                    ))}
                  </div>
                  <p className={`text-[11px] font-medium ${strength <= 2 ? 'text-red-500' : strength <= 3 ? 'text-yellow-600' : 'text-emerald-600'}`}>
                    {strengthLabels[strength]}
                  </p>
                </div>
              )}

              {/* Confirm mismatch */}
              {field === 'confirm' && form.confirm && form.next !== form.confirm && (
                <p className="text-[11px] text-red-500 mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Mật khẩu không khớp
                </p>
              )}
              {field === 'confirm' && form.confirm && form.next === form.confirm && (
                <p className="text-[11px] text-emerald-600 mt-1 flex items-center gap-1">
                  <Check className="w-3 h-3" /> Khớp rồi!
                </p>
              )}
            </div>
          ))}

          <div className="pt-1">
            <button
              type="submit"
              disabled={saving || !form.current || !form.next || !form.confirm}
              className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              Đổi mật khẩu
            </button>
          </div>
        </form>
      </div>

      {/* Tips */}
      <div className="bg-blue-50 rounded-2xl border border-blue-100 p-4 flex items-start gap-3">
        <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
        <div className="text-sm text-blue-700 space-y-1">
          <p className="font-semibold">Lưu ý bảo mật</p>
          <ul className="text-xs space-y-0.5 list-disc ml-3 text-blue-600">
            <li>Dùng ít nhất 8 ký tự, bao gồm chữ hoa, chữ thường và số</li>
            <li>Không dùng thông tin cá nhân dễ đoán (tên, ngày sinh…)</li>
            <li>Sau khi đổi, các phiên đăng nhập khác sẽ bị đăng xuất</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Appearance ─────────────────────────────────────────────

function AppearanceTab() {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<UISettings>(loadUISettings);

  useEffect(() => {
    applyUiTheme();
  }, [settings.theme]);

  const handleSave = () => {
    localStorage.setItem('settings_ui', JSON.stringify(settings));
    showToast('success', 'Đã lưu cài đặt giao diện');
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-surface-200 p-5 space-y-6">

        {/* Theme */}
        <div>
          <SectionTitle>Chủ đề màu sắc</SectionTitle>
          <div className="grid grid-cols-1 gap-3">
            {([
              { value: 'light', label: 'Sáng', icon: Sun, preview: 'theme-preview-light border-2' },
            ] as const).map(({ value, label, icon: Icon, preview }) => {
              const active = settings.theme === value;
              return (
                <button
                  key={value}
                  onClick={() => setSettings((s) => ({ ...s, theme: value }))}
                  className={`relative rounded-xl border-2 p-4 text-center transition-all ${
                    active ? 'border-brand-500 bg-brand-50' : 'border-surface-200 hover:border-surface-300 bg-surface-50'
                  }`}
                >
                  {active && (
                    <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-brand-500 flex items-center justify-center">
                      <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                    </span>
                  )}
                  <div className={`w-12 h-8 rounded-lg mx-auto mb-2 ${preview} border-surface-200 shadow-sm`} />
                  <Icon className={`w-4 h-4 mx-auto mb-1 ${active ? 'text-brand-600' : 'text-surface-400'}`} />
                  <p className={`text-xs font-semibold ${active ? 'text-brand-700' : 'text-surface-600'}`}>{label}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="h-px bg-surface-100" />

        {/* Language */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Globe className="w-4 h-4 text-surface-500" />
            <SectionTitle>Ngôn ngữ</SectionTitle>
          </div>
          <div className="flex gap-3">
            {([
              { value: 'vi', label: '🇻🇳 Tiếng Việt' },
            ] as const).map(({ value, label }) => {
              const active = settings.language === value;
              return (
                <button
                  key={value}
                  onClick={() => setSettings((s) => ({ ...s, language: value }))}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 text-sm font-semibold transition-all ${
                    active
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-surface-200 text-surface-600 hover:border-surface-300'
                  }`}
                >
                  {active && <Check className="w-3.5 h-3.5" />}
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="h-px bg-surface-100" />

        {/* Annotation font size */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Type className="w-4 h-4 text-surface-500" />
            <SectionTitle>Cỡ chữ khi đánh nhãn</SectionTitle>
          </div>
          <p className="text-xs text-surface-400 mb-3">Áp dụng cho văn bản hiển thị trong workspace đánh nhãn</p>
          <div className="flex gap-3">
            {([
              { value: 'sm', label: 'Nhỏ', size: 'text-xs' },
              { value: 'md', label: 'Vừa', size: 'text-sm' },
              { value: 'lg', label: 'Lớn', size: 'text-base' },
            ] as const).map(({ value, label, size }) => {
              const active = settings.annotationFontSize === value;
              return (
                <button
                  key={value}
                  onClick={() => setSettings((s) => ({ ...s, annotationFontSize: value }))}
                  className={`flex-1 flex flex-col items-center gap-2 px-4 py-3.5 rounded-xl border-2 transition-all ${
                    active
                      ? 'border-brand-500 bg-brand-50'
                      : 'border-surface-200 hover:border-surface-300 bg-surface-50'
                  }`}
                >
                  <span className={`font-medium ${size} ${active ? 'text-brand-700' : 'text-surface-600'}`}>Aa</span>
                  <span className={`text-[11px] font-semibold ${active ? 'text-brand-600' : 'text-surface-400'}`}>{label}</span>
                  {active && <Check className="w-3 h-3 text-brand-500" />}
                </button>
              );
            })}
          </div>

          {/* Preview */}
          <div className="mt-3 bg-surface-50 rounded-xl border border-surface-200 px-4 py-3">
            <p className="text-[10px] font-semibold text-surface-400 uppercase tracking-wide mb-1.5">Xem trước</p>
            <p
              className="text-surface-700 leading-relaxed"
              style={{
                fontSize:
                  settings.annotationFontSize === 'sm' ? 13 :
                  settings.annotationFontSize === 'lg' ? 18 : 15,
                fontFamily: 'system-ui, -apple-system, sans-serif',
              }}
            >
              Đây là ví dụ về văn bản sẽ hiển thị khi bạn thực hiện đánh nhãn. Cỡ chữ giúp bạn đọc thoải mái hơn trong thời gian dài.
            </p>
          </div>
        </div>

        <div className="pt-1 border-t border-surface-100">
          <button onClick={handleSave} className="btn-primary flex items-center gap-2 text-sm">
            <Save className="w-4 h-4" />
            Lưu cài đặt
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Notifications ──────────────────────────────────────────

function NotificationsTab() {
  const user = useAuthStore((s) => s.user);
  const { showToast } = useToast();
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIF);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const isAnnotator = user?.roles?.some((r) => r === 'annotator' || r === 'ANNOTATOR');
  const isReviewer = user?.roles?.some((r) => r === 'reviewer' || r === 'REVIEWER');
  const isPO = user?.roles?.some((r) => r === 'project_owner' || r === 'PROJECT_OWNER');
  const isAdmin = user?.roles?.some((r) => r === 'admin' || r === 'ADMIN');

  useEffect(() => {
    notificationApi.getPreferences()
      .then((data) => setPrefs({ ...DEFAULT_NOTIF, ...data }))
      .catch(() => {/* keep defaults */})
      .finally(() => setLoading(false));
  }, []);

  const toggle = (key: keyof NotificationPrefs) =>
    setPrefs((p) => ({ ...p, [key]: !p[key] }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await notificationApi.updatePreferences(prefs);
      showToast('success', 'Đã lưu cài đặt thông báo');
    } catch {
      showToast('error', 'Lưu thất bại, vui lòng thử lại');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Annotator / Everyone */}
      <div className="bg-white rounded-2xl border border-surface-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center">
            <User className="w-4 h-4 text-blue-600" />
          </div>
          <p className="text-sm font-semibold text-surface-800">
            {isAnnotator || (!isReviewer && !isPO && !isAdmin) ? 'Dành cho Annotator' : 'Thông báo chung'}
          </p>
        </div>
        <div>
          <NotifRow label="Được phân công task" desc="Khi admin giao task mới cho bạn" checked={prefs.task_assigned} onChange={() => toggle('task_assigned')} />
          <NotifRow label="Task bị từ chối" desc="Khi reviewer từ chối bài làm của bạn và yêu cầu sửa lại" checked={prefs.task_rejected} onChange={() => toggle('task_rejected')} />
          <NotifRow label="Gần đến hạn dự án" desc="Nhắc nhở 2 ngày trước deadline dự án" checked={prefs.project_deadline} onChange={() => toggle('project_deadline')} />
          <NotifRow label="Review hoàn tất" desc="Khi task của bạn được duyệt xong" checked={prefs.review_complete} onChange={() => toggle('review_complete')} />
        </div>
      </div>

      {/* Reviewer / PO */}
      {(isReviewer || isPO || isAdmin) && (
        <div className="bg-white rounded-2xl border border-surface-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-purple-100 flex items-center justify-center">
              <Shield className="w-4 h-4 text-purple-600" />
            </div>
            <p className="text-sm font-semibold text-surface-800">Dành cho Reviewer</p>
          </div>
          <div>
            <NotifRow label="Task được nộp để review" desc="Khi annotator submit task và chờ bạn kiểm duyệt" checked={prefs.task_submitted} onChange={() => toggle('task_submitted')} />
            <NotifRow label="Cột mốc annotation" desc="Thông báo khi đạt 50%, 80%, 100% mẫu trong dự án" checked={prefs.annotation_milestone} onChange={() => toggle('annotation_milestone')} />
          </div>
        </div>
      )}

      {/* Project Owner */}
      {(isPO || isAdmin) && (
        <div className="bg-white rounded-2xl border border-surface-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-amber-600" />
            </div>
            <p className="text-sm font-semibold text-surface-800">Dành cho Project Owner</p>
          </div>
          <div>
            <NotifRow label="Export hoàn tất" desc="Khi file xuất dữ liệu đã sẵn sàng để tải về" checked={prefs.export_ready} onChange={() => toggle('export_ready')} />
          </div>
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="btn-primary flex items-center gap-2 text-sm disabled:opacity-60"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {saving ? 'Đang lưu...' : 'Lưu cài đặt'}
      </button>
    </div>
  );
}

// ─── Tab: System ─────────────────────────────────────────────────

function SystemTab() {
  const techStack = [
    { name: 'FastAPI', desc: 'Backend framework', icon: Server },
    { name: 'React 19', desc: 'Frontend library', icon: Code2 },
    { name: 'PostgreSQL', desc: 'Database', icon: Database },
    { name: 'SQLAlchemy', desc: 'ORM', icon: Database },
    { name: 'Tailwind CSS v4', desc: 'Styling', icon: Palette },
  ];

  return (
    <div className="space-y-5">
      {/* App info */}
      <div className="bg-gradient-to-br from-brand-600 to-blue-700 rounded-2xl p-6 text-white">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
            <Cpu className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold">TextLabel Platform</h2>
            <p className="text-blue-200 text-sm">Phiên bản 1.0.0</p>
          </div>
        </div>
        <p className="text-blue-100 text-sm leading-relaxed">
          Nền tảng đánh nhãn văn bản thông minh dành cho các tác vụ NLP: phân loại văn bản,
          nhận dạng thực thể (NER), trích xuất quan hệ. Hỗ trợ quản lý dự án, phân công
          nhiệm vụ và kiểm duyệt đa cấp.
        </p>
      </div>

      {/* Developer */}
      <div className="bg-white rounded-2xl border border-surface-200 p-5">
        <SectionTitle>Nhà phát triển</SectionTitle>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-brand-400 to-blue-600 flex items-center justify-center text-white text-xl font-bold shrink-0">
            H
          </div>
          <div>
            <p className="text-base font-bold text-surface-900">Nghiêm Gia Huy</p>
            <p className="text-sm text-surface-500 mt-0.5">Full-stack Developer · Đồ án tốt nghiệp 2026</p>
            <div className="flex items-center gap-3 mt-2">
              <a
                href="mailto:nghiemhuy03@gmail.com"
                className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 font-medium transition-colors"
              >
                <Mail className="w-3.5 h-3.5" />
                nghiemhuy03@gmail.com
              </a>
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-surface-500 hover:text-surface-700 font-medium transition-colors"
              >
                <Code2 className="w-3.5 h-3.5" />
                GitHub
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Tech stack */}
      <div className="bg-white rounded-2xl border border-surface-200 p-5">
        <SectionTitle>Công nghệ sử dụng</SectionTitle>
        <div className="grid grid-cols-2 gap-2.5">
          {techStack.map(({ name, desc, icon: Icon }) => (
            <div key={name} className="flex items-center gap-2.5 px-3 py-2.5 bg-surface-50 rounded-xl border border-surface-100">
              <Icon className="w-4 h-4 text-surface-400 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-surface-700">{name}</p>
                <p className="text-[11px] text-surface-400">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Version info */}
      <div className="bg-surface-50 rounded-2xl border border-surface-200 p-4">
        <div className="grid grid-cols-2 gap-y-2.5 text-sm">
          {[
            { label: 'Phiên bản',    value: '1.0.0' },
            { label: 'API Version',  value: 'v1' },
            { label: 'Môi trường',   value: import.meta.env.MODE || 'production' },
            { label: 'Năm phát triển', value: '2026' },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center gap-2">
              <span className="text-surface-400 text-xs w-32 shrink-0">{label}:</span>
              <span className="text-surface-700 text-xs font-medium">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Settings Page ──────────────────────────────────────────

export default function Settings() {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const t = searchParams.get('tab') as Tab;
    return ['profile', 'security', 'appearance', 'notifications', 'system'].includes(t) ? t : 'profile';
  });

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'profile',       label: 'Thông tin cá nhân', icon: User    },
    { id: 'security',      label: 'Bảo mật',            icon: Lock    },
    { id: 'appearance',    label: 'Giao diện',           icon: Palette },
    { id: 'notifications', label: 'Thông báo',           icon: Bell    },
    { id: 'system',        label: 'Hệ thống',            icon: Info    },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-surface-900">Cài đặt</h1>
        <p className="text-sm text-surface-500 mt-1">Quản lý tài khoản và tuỳ chỉnh hệ thống theo sở thích của bạn</p>
      </div>

      <div className="flex gap-6 items-start">
        {/* Left sidebar: tabs */}
        <div className="w-52 shrink-0 bg-white rounded-2xl border border-surface-200 p-2 space-y-0.5">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left ${
                activeTab === id
                  ? 'bg-brand-50 text-brand-700 font-semibold'
                  : 'text-surface-600 hover:bg-surface-50 hover:text-surface-800'
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${activeTab === id ? 'text-brand-600' : 'text-surface-400'}`} />
              {label}
            </button>
          ))}
        </div>

        {/* Right: content */}
        <div className="flex-1 min-w-0">
          {activeTab === 'profile'       && <ProfileTab />}
          {activeTab === 'security'      && <SecurityTab />}
          {activeTab === 'appearance'    && <AppearanceTab />}
          {activeTab === 'notifications' && <NotificationsTab />}
          {activeTab === 'system'        && <SystemTab />}
        </div>
      </div>
    </div>
  );
}
