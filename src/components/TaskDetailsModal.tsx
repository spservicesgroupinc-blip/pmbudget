import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Flame,
  GanttChartSquare,
  Pin,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { ConfirmModal } from './ConfirmModal';
import { PredecessorPicker } from './PredecessorPicker';
import { ScheduledTask, TradeSection } from '../types/estimate';
import {
  addWorkdays,
  formatDateYMD,
  parseDateYMD,
} from '../utils/scheduler';
import {
  buildPredecessorOptions,
  describePredecessors,
  formatPredecessors,
  parsePredecessors,
  wouldCreateCycle,
} from '../utils/predecessors';

interface TaskDetailsModalProps {
  task: ScheduledTask;
  /** Every task on the schedule, used to populate the predecessor dropdown. */
  allTasks: ScheduledTask[];
  onClose: () => void;
  onUpdateTrade: (taskId: string, updated: Partial<TradeSection>) => void;
  onRemoveTrade: (taskId: string) => void;
  onResetManualDates: (taskId: string) => void;
  onOpenTradePackages: () => void;
  onShowToast: (type: 'success' | 'warning' | 'error', message: string) => void;
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
 * Editable task details, opened by clicking a Gantt bar. Workdays, the linked
 * predecessor trades (chosen from a dropdown of everything else on the
 * schedule) and the manual start override can be adjusted here, and the task
 * can be removed from the schedule entirely.
 */
export const TaskDetailsModal: React.FC<TaskDetailsModalProps> = ({
  task,
  allTasks,
  onClose,
  onUpdateTrade,
  onRemoveTrade,
  onResetManualDates,
  onOpenTradePackages,
  onShowToast,
}) => {
  const [days, setDays] = useState(String(task.suggested_duration_days));
  const [preds, setPreds] = useState(task.predecessors || '');
  const [startOverride, setStartOverride] = useState(
    task.schedule_start_override || ''
  );
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Resync from the parent whenever the underlying task values change (this
  // also refreshes the inputs after a save).
  useEffect(() => {
    setDays(String(task.suggested_duration_days));
    setPreds(task.predecessors || '');
    setStartOverride(task.schedule_start_override || '');
  }, [
    task.task_id,
    task.suggested_duration_days,
    task.predecessors,
    task.schedule_start_override,
  ]);

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

  const scheduleIds = useMemo(
    () => new Set(allTasks.map((t) => t.task_id)),
    [allTasks]
  );
  const selectedPreds = useMemo(() => parsePredecessors(preds), [preds]);
  const linkedPreds = useMemo(
    () => selectedPreds.filter((id) => id !== task.task_id && scheduleIds.has(id)),
    [selectedPreds, scheduleIds, task.task_id]
  );
  const offSchedulePreds = useMemo(
    () => selectedPreds.filter((id) => !scheduleIds.has(id)),
    [selectedPreds, scheduleIds]
  );
  const predecessorOptions = useMemo(
    () => buildPredecessorOptions(allTasks, task.task_id, linkedPreds),
    [allTasks, task.task_id, linkedPreds]
  );

  const effStart = startOverride.trim() || task.startDate;
  const previewDays = Number(days.trim());
  const finishPreview =
    Number.isInteger(previewDays) && previewDays >= 1
      ? formatLongDate(
          formatDateYMD(addWorkdays(parseDateYMD(effStart), previewDays))
        )
      : '—';

  const handleSave = () => {
    const parsedDays = Number(days.trim());
    if (!Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > 365) {
      setError('Workdays must be a whole number between 1 and 365.');
      return;
    }
    const tokens = parsePredecessors(preds);
    if (tokens.includes(task.task_id)) {
      setError('A task cannot depend on itself.');
      return;
    }
    const valid = tokens.filter((p) => scheduleIds.has(p));
    // The scheduler falls back to a 1-day stub on a loop and the budget engine
    // would silently break it, so refuse the save and name the offending link.
    const loop = valid.find((p) => wouldCreateCycle(allTasks, task.task_id, p));
    if (loop) {
      setError(
        `${loop} already depends on ${task.task_id}, directly or through other trades — linking it would create a circular dependency. Unlink one side of the loop first.`
      );
      return;
    }
    const dropped = tokens.filter((p) => !scheduleIds.has(p));
    const normalizedPreds = formatPredecessors(valid);
    const patch: Partial<TradeSection> = {};
    if (parsedDays !== task.suggested_duration_days) {
      patch.suggested_duration_days = parsedDays;
    }
    if (normalizedPreds !== (task.predecessors || '')) {
      patch.predecessors = normalizedPreds;
    }
    const newOverride = startOverride.trim();
    if (newOverride !== (task.schedule_start_override || '')) {
      patch.schedule_start_override =
        newOverride.length > 0 ? newOverride : undefined;
    }
    if (Object.keys(patch).length === 0) {
      onShowToast('warning', 'No changes to save.');
      return;
    }
    setError(null);
    onUpdateTrade(task.task_id, patch);
    if (dropped.length > 0) {
      onShowToast(
        'warning',
        `Saved ${task.task_id} — dropped ${dropped.join(
          ', '
        )} (no longer on this schedule).`
      );
    } else {
      onShowToast('success', `Saved ${task.task_id} — schedule re-sequenced.`);
    }
  };

  return (
    <>
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
            <DetailRow label="Scheduled Finish">{finishPreview}</DetailRow>
            <label>
              <span className="block text-[11px] font-semibold uppercase text-slate-400">
                Workdays
              </span>
              <input
                type="number"
                min={1}
                max={365}
                step={1}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className="mt-1 w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-[13px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-200"
              />
            </label>
            <label>
              <span className="block text-[11px] font-semibold uppercase text-slate-400">
                Manual start override
              </span>
              <input
                type="date"
                value={startOverride}
                onChange={(e) => setStartOverride(e.target.value)}
                className="mt-1 w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-[13px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-200"
              />
            </label>
            <div className="col-span-2">
              <span className="block text-[11px] font-semibold uppercase text-slate-400">
                Predecessors
              </span>
              <PredecessorPicker
                taskId={task.task_id}
                selectedIds={linkedPreds}
                offScheduleIds={offSchedulePreds}
                options={predecessorOptions}
                summary={describePredecessors(linkedPreds, allTasks)}
                onChange={(next) => setPreds(formatPredecessors(next))}
              />
              <p className="mt-1.5 text-[11px] text-slate-500 leading-normal">
                Pick the trades this package follows. Linking waits for the
                selected trade to finish; unlink to let it start earlier. Leave
                the override empty to let the scheduler auto-sequence — it never
                starts before the project start or before linked predecessors
                finish.
              </p>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-[12px] text-rose-700 leading-normal">
              {error}
            </div>
          )}

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
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-rose-300 bg-white text-[13px] font-semibold text-rose-700 hover:bg-rose-50 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Remove from schedule
            </button>
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
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg border border-slate-200 bg-white text-[13px] font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
            >
              Open in Trade Packages
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-red-600 text-[13px] font-semibold text-white hover:bg-red-700 transition-colors shadow-sm"
            >
              <Save className="w-3.5 h-3.5" />
              Save Changes
            </button>
          </div>
        </div>
      </div>
      </div>
      <ConfirmModal
        isOpen={confirmRemove}
        title={`Remove ${task.task_id} from schedule?`}
        subtitle={task.trade_name}
        message={`${task.task_id} (${task.trade_name}) will be permanently removed from the estimate's trade packages.`}
        consequence={`Any other task that lists ${task.task_id} as a predecessor will have that dependency cleared and will re-sequence from the project start.`}
        confirmLabel="Remove Task"
        isDestructive
        onConfirm={() => {
          setConfirmRemove(false);
          onRemoveTrade(task.task_id);
          onClose();
        }}
        onCancel={() => setConfirmRemove(false)}
      />
    </>
  );
};
