// src/components/Toast.tsx

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { ToastContext, type ToastType } from './toastContext';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((type: ToastType, message: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, type, message }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const centeredToasts = toasts.filter((toast) => toast.type === 'error');
  const cornerToasts = toasts.filter((toast) => toast.type !== 'error');

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      <div className="pointer-events-none fixed left-1/2 top-5 z-[120] w-[calc(100vw-2rem)] max-w-[380px] -translate-x-1/2 sm:top-6">
        <div className="flex w-full flex-col items-center gap-2">
          {centeredToasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} centered />
          ))}
        </div>
      </div>

      <div className="fixed bottom-4 right-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2">
        {cornerToasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const STYLES = {
  success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  error: 'bg-white border-surface-200 text-surface-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
  info: 'bg-brand-50 border-brand-200 text-brand-800',
};

const ICON_COLORS = {
  success: 'text-emerald-500',
  error: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-brand-500',
};

function ToastItem({
  toast,
  onDismiss,
  centered = false,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
  centered?: boolean;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 4000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const Icon = ICONS[toast.type];
  const shellClass = centered
    ? 'pointer-events-auto w-full items-start gap-2.5 rounded-lg border-l-4 border-l-red-400 px-3.5 py-3 shadow-card'
    : 'items-start gap-2.5 px-4 py-3 rounded-xl shadow-card animate-in slide-in-from-right duration-200';

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
      className={`flex border ${shellClass} ${STYLES[toast.type]}`}
    >
      <Icon className={`${centered ? 'h-4.5 w-4.5' : 'h-5 w-5'} shrink-0 mt-0.5 ${ICON_COLORS[toast.type]}`} />
      <p className="min-w-0 flex-1 break-words text-sm font-medium leading-snug">{toast.message}</p>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 cursor-pointer rounded p-0.5 text-surface-500 transition-colors hover:bg-surface-100 hover:text-surface-700"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
