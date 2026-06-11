// src/pages/Login.tsx

import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Tag, AlertCircle, LogIn } from 'lucide-react';
import { authApi } from '../api/authApi';
import { useAuthStore } from '../store/authStore';

type LoginApiError = {
  response?: {
    status?: number;
    data?: {
      message?: string;
      detail?: string;
    };
  };
};

const LOGIN_ERROR_MESSAGES = {
  invalid: 'Email ho\u1eb7c m\u1eadt kh\u1ea9u kh\u00f4ng \u0111\u00fang',
  locked: 'T\u00e0i kho\u1ea3n \u0111ang b\u1ecb kh\u00f3a. Vui l\u00f2ng th\u1eed l\u1ea1i sau.',
  network: 'Kh\u00f4ng k\u1ebft n\u1ed1i \u0111\u01b0\u1ee3c API. Ki\u1ec3m tra backend, CORS ho\u1eb7c VITE_API_URL.',
  server: 'M\u00e1y ch\u1ee7 \u0111ang l\u1ed7i. Vui l\u00f2ng th\u1eed l\u1ea1i sau.',
  generic: '\u0110\u0103ng nh\u1eadp th\u1ea5t b\u1ea1i. Vui l\u00f2ng th\u1eed l\u1ea1i.',
};

function getLoginErrorMessage(error: unknown) {
  const response = (error as LoginApiError).response;

  if (!response) {
    return LOGIN_ERROR_MESSAGES.network;
  }

  if (response.status === 401) {
    return LOGIN_ERROR_MESSAGES.invalid;
  }

  if (response.status === 423) {
    return response.data?.message ?? LOGIN_ERROR_MESSAGES.locked;
  }

  if (response.status && response.status >= 500) {
    return LOGIN_ERROR_MESSAGES.server;
  }

  return response.data?.message ?? response.data?.detail ?? LOGIN_ERROR_MESSAGES.generic;
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const setAuth = useAuthStore((s) => s.setAuth);
  const from = (location.state as { from?: { pathname?: string; search?: string; hash?: string } } | null)?.from;
  const redirectTo = from?.pathname
    ? `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`
    : '/';

  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe]   = useState(false);
  const [error, setError]             = useState('');
  const [isLoading, setIsLoading]     = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const data = await authApi.login(email, password);
      setAuth(data.access_token, data.refresh_token, data.user);
      navigate(redirectTo, { replace: true });
    } catch (error) {
      setError(getLoginErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="h-screen overflow-hidden flex items-center justify-center p-4"
      style={{
        backgroundImage: [
          'linear-gradient(rgba(13,17,23,0.88) 0%, rgba(15,23,42,0.84) 50%, rgba(13,17,23,0.92) 100%)',
          "url('/login-bg.jpg')",
        ].join(', '),
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      {/* Subtle grid overlay */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(92,124,250,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(92,124,250,0.04) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* ─── Login Card ─── */}
      <div className="relative w-full max-w-[420px]">
        {/* Logo */}
        <div className="flex flex-col items-center mb-5">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 shadow-lg"
            style={{ background: 'linear-gradient(135deg, #4c6ef5, #5c7cfa)' }}
          >
            <Tag className="w-7 h-7 text-white" strokeWidth={2.2} />
          </div>
          <h1 className="text-white text-2xl font-bold tracking-tight">
            TextLabel Platform
          </h1>
          <p className="text-slate-400 text-sm mt-1">Annotation workspace</p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl border p-7"
          style={{
            background: 'rgba(13, 17, 34, 0.88)',
            borderColor: 'rgba(255,255,255,0.08)',
            backdropFilter: 'blur(24px)',
            boxShadow: '0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)',
          }}
        >
          {/* Card heading */}
          <div className="mb-5">
            <h2 className="text-white text-xl font-semibold">Đăng nhập</h2>
            <p className="text-slate-400 text-sm mt-1">
              Chào mừng trở lại! Vui lòng nhập thông tin tài khoản.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Error */}
            {error && (
              <div
                className="flex items-start gap-2.5 p-3 rounded-xl"
                style={{
                  background: 'rgba(239,68,68,0.12)',
                  border: '1px solid rgba(239,68,68,0.25)',
                }}
              >
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-sm text-red-300 leading-snug">{error}</p>
              </div>
            )}

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Email / Tên đăng nhập
              </label>
              <input
                type="text"
                required
                autoComplete="email"
                autoFocus
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-all"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.10)',
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = 'rgba(92,124,250,0.6)';
                  e.target.style.boxShadow = '0 0 0 3px rgba(92,124,250,0.12)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'rgba(255,255,255,0.10)';
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Mật khẩu
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl px-4 py-2.5 pr-10 text-sm text-white placeholder-slate-500 outline-none transition-all"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.10)',
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = 'rgba(92,124,250,0.6)';
                    e.target.style.boxShadow = '0 0 0 3px rgba(92,124,250,0.12)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'rgba(255,255,255,0.10)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Remember me */}
            <div className="flex items-center">
              <label className="flex items-center gap-2 cursor-pointer select-none group">
                <div className="relative">
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <div
                    className="w-4 h-4 rounded flex items-center justify-center transition-all"
                    style={{
                      background: rememberMe ? '#4c6ef5' : 'rgba(255,255,255,0.07)',
                      border: rememberMe ? '1px solid #4c6ef5' : '1px solid rgba(255,255,255,0.15)',
                    }}
                  >
                    {rememberMe && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 8">
                        <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                </div>
                <span className="text-sm text-slate-400 group-hover:text-slate-300 transition-colors">
                  Ghi nhớ đăng nhập
                </span>
              </label>

            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-xl py-2.5 text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                background: isLoading
                  ? 'rgba(76,110,245,0.7)'
                  : 'linear-gradient(135deg, #4c6ef5 0%, #5c7cfa 100%)',
                boxShadow: isLoading ? 'none' : '0 4px 20px rgba(76,110,245,0.35)',
              }}
              onMouseEnter={(e) => {
                if (!isLoading)
                  e.currentTarget.style.boxShadow = '0 6px 24px rgba(76,110,245,0.5)';
              }}
              onMouseLeave={(e) => {
                if (!isLoading)
                  e.currentTarget.style.boxShadow = '0 4px 20px rgba(76,110,245,0.35)';
              }}
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Đang đăng nhập…
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  Đăng nhập
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="mt-4 text-center space-y-1.5">
          <p className="text-xs text-slate-600">
            Bằng cách đăng nhập, bạn đồng ý với{' '}
            <button type="button" className="text-slate-500 hover:text-slate-400 underline underline-offset-2 transition-colors cursor-pointer">
              Điều khoản sử dụng
            </button>
            {' '}·{' '}
            <button type="button" className="text-slate-500 hover:text-slate-400 underline underline-offset-2 transition-colors cursor-pointer">
              Chính sách bảo mật
            </button>
          </p>
          <p className="text-xs text-slate-700">
            Text Labeling Platform v1.0
          </p>
        </div>
      </div>
    </div>
  );
}
