import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  message: string;
  consequence?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  subtitle,
  message,
  consequence,
  confirmLabel = 'Confirm Action',
  cancelLabel = 'Cancel',
  isDestructive = false,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-lg ${
                isDestructive
                  ? 'bg-rose-50 text-rose-600'
                  : 'bg-red-50 text-red-600'
              }`}
            >
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">
                {title}
              </h3>
              {subtitle && (
                <p className="text-[12px] text-slate-500 mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3">
          <p className="text-[13px] text-slate-700 leading-relaxed">{message}</p>
          {consequence && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-[12px] text-amber-800 leading-normal">
              <span className="font-semibold block mb-0.5">Consequence:</span>
              {consequence}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center justify-center h-9 px-3 rounded-lg text-[13px] font-medium text-slate-700 hover:bg-slate-200/60 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`inline-flex items-center justify-center h-9 px-4 rounded-lg text-[13px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 ${
              isDestructive
                ? 'border border-rose-200 bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500/40 shadow-sm'
                : 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500/40 shadow-sm'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
