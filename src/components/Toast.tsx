import React, { useEffect } from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'warning' | 'error';
  message: string;
}

interface ToastProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
}

export const Toast: React.FC<ToastProps> = ({ toast, onDismiss }) => {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      onDismiss();
    }, 5000);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!toast) return null;

  return (
    <div className="fixed top-20 right-5 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="bg-white rounded-xl border border-slate-200 shadow-lg max-w-sm px-4 py-3 flex items-center gap-3">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            toast.type === 'success'
              ? 'bg-emerald-500'
              : toast.type === 'warning'
              ? 'bg-amber-500'
              : 'bg-rose-500'
          }`}
        />
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {toast.type === 'success' && (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          )}
          {toast.type === 'warning' && (
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          )}
          {toast.type === 'error' && (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <p className="text-[13px] font-medium text-slate-800 leading-tight">
            {toast.message}
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="text-slate-400 hover:text-slate-600 p-1 rounded-md transition-colors"
          aria-label="Dismiss toast"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
