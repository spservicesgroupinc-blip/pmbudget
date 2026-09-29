import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Plus,
  X,
  Boxes,
  UploadCloud,
  FileText,
  GanttChartSquare,
  Share2,
} from 'lucide-react';

interface QuickAddProps {
  hasEstimate: boolean;
  onAddTrade: () => void;
  onNavigateSection: (id: string) => void;
}

interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  shortcut: string;
  disabled?: boolean;
  onClick: () => void;
}

export const QuickAdd: React.FC<QuickAddProps> = ({
  hasEstimate,
  onAddTrade,
  onNavigateSection,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Dismiss on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        close();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  const actions: QuickAction[] = [
    {
      id: 'add-trade',
      label: 'Add Trade Package',
      description: hasEstimate
        ? 'Append a subcontractor scope package'
        : 'Load an estimate to add packages',
      icon: Boxes,
      shortcut: 'A',
      disabled: !hasEstimate,
      onClick: onAddTrade,
    },
    {
      id: 'upload',
      label: 'Upload Estimate PDF',
      description: 'Analyze an Xactimate export',
      icon: UploadCloud,
      shortcut: 'U',
      onClick: () => onNavigateSection('intake'),
    },
    {
      id: 'paste',
      label: 'Paste Estimate Text',
      description: 'Type or paste line items',
      icon: FileText,
      shortcut: 'P',
      onClick: () => onNavigateSection('intake'),
    },
    {
      id: 'gantt',
      label: 'Open Gantt Schedule',
      description: 'Review the sequencing timeline',
      icon: GanttChartSquare,
      shortcut: 'G',
      onClick: () => onNavigateSection('gantt'),
    },
    {
      id: 'sync',
      label: 'Sync to Workspace',
      description: 'Push packages to Google Drive',
      icon: Share2,
      shortcut: 'S',
      onClick: () => onNavigateSection('workspace'),
    },
  ];

  const run = (action: QuickAction) => {
    if (action.disabled) return;
    close();
    action.onClick();
  };

  // Keyboard shortcuts while the panel is open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const action = actions.find((a) => a.shortcut.toLowerCase() === key);
      if (action) {
        e.preventDefault();
        run(action);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasEstimate]);

  return (
    <div
      ref={rootRef}
      className="fixed bottom-5 right-5 sm:bottom-7 sm:right-7 z-40 flex flex-col items-end gap-3"
    >
      {/* Actions panel */}
      {open && (
        <div className="w-[320px] bg-white rounded-2xl border border-slate-200 shadow-2xl shadow-slate-900/15 overflow-hidden animate-in fade-in slide-in-from-bottom-2 zoom-in-95 duration-150 origin-bottom-right">
          <div className="px-4 pt-4 pb-2.5 flex items-center justify-between border-b border-slate-100">
            <div>
              <h3 className="text-[14px] font-semibold tracking-tight text-slate-900">
                Quick Actions
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Shortcuts for fast navigation
              </p>
            </div>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md border border-slate-200 bg-slate-50 text-slate-500">
              ESC
            </span>
          </div>

          <div className="p-2">
            {actions.map((action) => {
              const Icon = action.icon;
              const disabled = action.disabled;
              return (
                <button
                  key={action.id}
                  disabled={disabled}
                  onClick={() => run(action)}
                  className={`w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-left transition-colors ${
                    disabled
                      ? 'opacity-45 cursor-not-allowed'
                      : 'hover:bg-slate-50 active:bg-slate-100'
                  }`}
                >
                  <span
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                      disabled
                        ? 'bg-slate-100 text-slate-400'
                        : 'bg-red-50 text-red-600'
                    }`}
                  >
                    <Icon className="w-[18px] h-[18px]" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold text-slate-900">
                      {action.label}
                    </span>
                    <span className="block text-[11px] text-slate-500 truncate">
                      {action.description}
                    </span>
                  </span>
                  <kbd className="min-w-[22px] h-[22px] px-1.5 rounded-md border border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500 flex items-center justify-center tabular-nums">
                    {action.shortcut}
                  </kbd>
                </button>
              );
            })}
          </div>

          {!hasEstimate && (
            <div className="px-4 py-2.5 bg-amber-50 border-t border-amber-100 text-[11px] text-amber-800">
              Load an estimate to unlock adding trade packages.
            </div>
          )}
        </div>
      )}

      {/* Floating action button */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close quick actions' : 'Open quick actions'}
        aria-expanded={open}
        className={`group relative w-14 h-14 rounded-full flex items-center justify-center text-white shadow-lg shadow-red-600/30 transition-all duration-200 hover:shadow-xl hover:shadow-red-600/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 focus-visible:ring-offset-2 ${
          open
            ? 'bg-slate-800 rotate-90'
            : 'bg-gradient-to-br from-red-600 to-rose-600 hover:scale-105 active:scale-95'
        }`}
      >
        {open ? (
          <X className="w-6 h-6" />
        ) : (
          <Plus className="w-6 h-6 transition-transform group-hover:rotate-90" />
        )}
        <span className="sr-only">{open ? 'Close' : 'Quick add'}</span>
      </button>
    </div>
  );
};
