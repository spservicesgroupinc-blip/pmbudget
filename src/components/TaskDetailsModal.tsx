import React, { useEffect } from 'react';
import {
  ArrowRight,
  Flame,
  GanttChartSquare,
  Pin,
  RotateCcw,
  X,
} from 'lucide-react';
import { ScheduledTask } from '../types/estimate';

interface TaskDetailsModalProps {
  task: ScheduledTask;
  onClose: () => void;
  onResetManualDates: (taskId: string) => void;
  onOpenTradePackages: () => void;
}

function formatLongDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const DetailRow: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div>
    <span className="block text-[11px] font-semibold uppercase text-slate-400">
      {label}
    </span>
    <span className="block text-[13px] text-slate-800 mt-0.5">{children}</span>
  </div>
);

/**
 * Read-only task details, opened by double-clicking a Gantt bar. Editing lives
 * in Trade Packages; this panel explains the bar and offers schedule actions.
 */
export const TaskDetailsModal: React.FC<TaskDetailsModalProps> = ({
  task,
  onClose,
  onResetManualDates,
  onOpenTradePackages,
}) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const isPinned = Boolean(task.schedule_start_override);
  // The scheduler may have pushed the pin forward to keep FS order intact.
  const wasClamped =
    isPinned && task.schedule_start_override !== task.startDate;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-label={`Details for ${task.task_id} ${task.trade_name}`}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-xl w-full max-h-full overflow-y-auto animate-in zoom-in-95 duration-150"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-50 text-red-600">
              <GanttChartSquare className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">
                {task.trade_name}
              </h3>
              <p className="text-[12px] text-slate-500 mt-0.5">
                {task.task_id}
                {task.category_codes_included.length > 0 &&
                  ` • ${task.category_codes_included.join(', ')}`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close details"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {task.isCriticalPath ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-[11px] font-semibold text-red-700">
                <Flame className="w-3 h-3" />
                Critical path
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-[11px] font-semibold text-slate-600">
                Float
              </span>
            )}
            {isPinned && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-700">
                <Pin className="w-3 h-3" />
                Manually scheduled
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <DetailRow label="Scheduled Start">
              {formatLongDate(task.startDate)}
            </DetailRow>
            <DetailRow label="Scheduled Finish">
              {formatLongDate(task.endDate)}
            </DetailRow>
            <DetailRow label="Workdays">
              {task.suggested_duration_days}
            </DetailRow>
            <DetailRow label="Predecessors">
              {task.predecessors || 'None'}
            </DetailRow>
          </div>

          {isPinned && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-[12px] text-amber-800 leading-normal">
              <span className="font-semibold block mb-0.5">Manual start</span>
              Pinned to {formatLongDate(task.schedule_start_override!)} on the
              timeline.
              {wasClamped
                ? ` Predecessors pushed it to ${formatLongDate(task.startDate)}.`
                : ''}
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <DetailRow label="Billable Revenue">
              ${task.billable_revenue.toLocaleString()}
            </DetailRow>
            <DetailRow label="Subcontractor">
              {task.subcontractor_name
                ? `${task.subcontractor_name}${
                    task.subcontractor_bid
                      ? ` — $${task.subcontractor_bid.toLocaleString()}`
                      : ''
                  }`
                : 'Not awarded yet'}
            </DetailRow>
            {typeof task.labor_split_pct === 'number' && (
              <DetailRow label="Labor Split">
                {task.labor_split_pct}% labor
              </DetailRow>
            )}
          </div>

          <div>
            <span className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">
              Scope Summary
            </span>
            <p className="text-[12px] text-slate-700 leading-relaxed rounded-xl border border-slate-200 p-3.5 bg-white">
              {task.scope_summary ||
                'No scope summary recorded for this trade package.'}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            {isPinned && (
              <button
                type="button"
                onClick={() => onResetManualDates(task.task_id)}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-amber-300 bg-white text-[13px] font-semibold text-amber-700 hover:bg-amber-50 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset manual dates
              </button>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center h-9 px-3 rounded-lg text-[13px] font-medium text-slate-700 hover:bg-slate-200/60 transition-colors"
            >
              Close
            </button>
            <button
              type="button"
              onClick={onOpenTradePackages}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-red-600 text-[13px] font-semibold text-white hover:bg-red-700 transition-colors shadow-sm"
            >
              Open in Trade Packages
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
