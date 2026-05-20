// src/components/ConfirmDialog.tsx

import { useState, useCallback } from 'react';
import { AlertTriangle, Trash2, AlertCircle } from 'lucide-react';

interface ConfirmOptions {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'default';
}

export function useConfirm() {
  const [dialog, setDialog] = useState<{
    message: string;
    options: ConfirmOptions;
    resolve: (val: boolean) => void;
  } | null>(null);

  const confirm = useCallback(
    (message: string, options: ConfirmOptions = {}): Promise<boolean> =>
      new Promise((resolve) => setDialog({ message, options, resolve })),
    []
  );

  const answer = (val: boolean) => {
    dialog?.resolve(val);
    setDialog(null);
  };

  const icon =
    dialog?.options.variant === 'danger' ? (
      <Trash2 className="w-5 h-5 text-red-500" />
    ) : dialog?.options.variant === 'warning' ? (
      <AlertTriangle className="w-5 h-5 text-amber-500" />
    ) : (
      <AlertCircle className="w-5 h-5 text-brand-500" />
    );

  const iconBg =
    dialog?.options.variant === 'danger'
      ? 'bg-red-50'
      : dialog?.options.variant === 'warning'
      ? 'bg-amber-50'
      : 'bg-brand-50';

  const confirmCls =
    dialog?.options.variant === 'danger'
      ? 'text-red-600 hover:bg-red-50'
      : dialog?.options.variant === 'warning'
      ? 'text-amber-600 hover:bg-amber-50'
      : 'text-brand-600 hover:bg-brand-50';

  const ConfirmDialog = dialog ? (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-surface-950/40 backdrop-blur-[2px]"
        onClick={() => answer(false)}
      />
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-elevated border border-surface-200/60 overflow-hidden">
        <div className="px-6 pt-7 pb-5 text-center">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4 ${iconBg}`}>
            {icon}
          </div>
          <h3 className="text-base font-semibold text-surface-900 mb-2">
            {dialog.options.title ?? 'Xác nhận'}
          </h3>
          <p className="text-sm text-surface-500 leading-relaxed">{dialog.message}</p>
        </div>
        <div className="flex border-t border-surface-100">
          <button
            onClick={() => answer(false)}
            className="flex-1 py-3.5 text-sm font-medium text-surface-600 hover:bg-surface-50 transition-colors border-r border-surface-100 cursor-pointer"
          >
            {dialog.options.cancelText ?? 'Hủy'}
          </button>
          <button
            onClick={() => answer(true)}
            className={`flex-1 py-3.5 text-sm font-semibold transition-colors cursor-pointer ${confirmCls}`}
          >
            {dialog.options.confirmText ?? 'Xác nhận'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, ConfirmDialog };
}
