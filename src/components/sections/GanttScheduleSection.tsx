import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Gantt, { GanttTask } from 'frappe-gantt';
// frappe-gantt's `exports` map does not expose its stylesheet, so vite.config.ts
// aliases this exact specifier to the real file on disk.
import 'frappe-gantt/dist/frappe-gantt.css';
import {
  GanttChartSquare,
  Calendar,
  Clock,
  Flame,
  ArrowRight,
  Link2,
  AlertCircle,
  Pin,
} from 'lucide-react';
import { EstimateResult, ScheduledTask, TradeSection } from '../../types/estimate';
import {
  computeSchedule,
  countWorkdaysInclusive,
  formatDateYMD,
  getNextMonday,
  isWeekend,
} from '../../utils/scheduler';
import { TaskDetailsModal } from '../TaskDetailsModal';

type ViewMode = 'Day' | 'Week' | 'Month';

type ToastType = 'success' | 'warning' | 'error';

interface GanttScheduleSectionProps {
  estimate: EstimateResult | null;
  onNavigateSection: (id: string) => void;
  /** Persists drag/resize results into the estimate (App.handleUpdateTrade). */
  onUpdateTrade: (taskId: string, updated: Partial<TradeSection>) => void;
  onShowToast: (type: ToastType, message: string) => void;
}

function toGanttTaskDate(iso: string): string {
  // Bare `YYYY-MM-DD` strings parse as UTC midnight, which renders as the
  // previous day in western timezones. Anchor at local noon like the scheduler.
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * frappe-gantt renders `padding` columns of lead-in and leaves the container at
 * scrollLeft 0, so the schedule starts off part-way across the viewport. Trim
 * that dead space so the first bar sits near the left edge.
 */
function focusedStart(chart: Gantt | null): void {
  const container = chart?.$container;
  if (!container) return;
  const firstBar = container.querySelector('.bar-wrapper .bar');
  if (!firstBar) return;
  const target =
    firstBar.getBoundingClientRect().x -
    container.getBoundingClientRect().x +
    container.scrollLeft;
  container.scrollLeft = Math.max(0, target - 48);
}

export const GanttScheduleSection: React.FC<GanttScheduleSectionProps> = ({
  estimate,
  onNavigateSection,
  onUpdateTrade,
  onShowToast,
}) => {
  const [projectStartDate, setProjectStartDate] = useState<string>(getNextMonday());
  const [highlightCriticalPath, setHighlightCriticalPath] = useState<boolean>(true);
  const [viewMode, setViewMode] = useState<ViewMode>('Day');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [detailsTaskId, setDetailsTaskId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const ganttRef = useRef<Gantt | null>(null);
  const ganttTasksRef = useRef<GanttTask[]>([]);
  const rafRef = useRef<number | null>(null);

  // The chart outlives individual renders, so its callbacks read props and
  // schedule data through refs instead of capturing them at creation time.
  const taskByIdRef = useRef<Map<string, ScheduledTask>>(new Map());
  const updateTradeRef = useRef(onUpdateTrade);
  const showToastRef = useRef(onShowToast);
  updateTradeRef.current = onUpdateTrade;
  showToastRef.current = onShowToast;

  // Drag bookkeeping. The library fires `date_change` continuously while a bar
  // is moved or resized, so commits are debounced until the gesture settles.
  // Nothing touches React state mid-drag: a re-render would rebuild the chart
  // underneath the pointer and abort the gesture.
  const pendingPatchRef = useRef<{
    taskId: string;
    patch: Partial<TradeSection>;
  } | null>(null);
  const commitTimerRef = useRef<number | null>(null);
  // Which bar the current gesture started on (set on mousedown).
  const draggedBarIdRef = useRef<string | null>(null);
  // Whether the gesture is an edge-resize (duration change) vs a move.
  const resizingRef = useRef<boolean>(false);
  const didInitialScrollRef = useRef(false);
  const lastScrollRef = useRef(0);
  const clampNotifiedRef = useRef<Set<string>>(new Set());

  const scheduleData = useMemo(() => {
    if (!estimate) return null;
    return computeSchedule(estimate.trade_sections, projectStartDate);
  }, [estimate, projectStartDate]);

  const tasks = scheduleData?.tasks ?? [];

  const ganttTasks: GanttTask[] = useMemo(
    () =>
      tasks.map((task) => ({
        id: task.task_id,
        name: task.trade_name,
        start: task.startDate,
        // A bare `end` date is treated by the library as a full final day
        // (it extends it by 24h), which matches the scheduler's inclusive
        // `endDate` exactly — no conversion needed.
        end: task.endDate,
        // The app does not track completion, so bars render as not-started.
        progress: 0,
        dependencies: task.predecessors || '',
        // The library applies custom_class with `classList.add`, which rejects
        // multi-token strings; the critical-path "off" state ('xg-plain') and
        // the dragged-pin marker ('xg-pinned') are synced onto the bar wrappers
        // after render instead (see the class-sync effect below).
        custom_class: task.isCriticalPath ? 'xg-critical' : 'xg-standard',
        description: `${task.task_id} • ${task.suggested_duration_days} workday${
          task.suggested_duration_days === 1 ? '' : 's'
        }`,
        _startDate: task.startDate,
        _endDate: task.endDate,
        _duration: task.suggested_duration_days,
        _predecessors: task.predecessors || 'None',
      })),
    // highlightCriticalPath intentionally omitted: the per-bar class sync
    // effect below applies it without rebuilding the chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks]
  );

  ganttTasksRef.current = ganttTasks;

  const taskById = useMemo(() => {
    const map = new Map<string, (typeof tasks)[number]>();
    tasks.forEach((t) => map.set(t.task_id, t));
    return map;
  }, [tasks]);

  taskByIdRef.current = taskById;

  const hasSchedule = Boolean(estimate && scheduleData && tasks.length > 0);

  /** Applies a queued drag/resize patch and clears the debounce timer. */
  const flushPendingCommit = useCallback(() => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    const pending = pendingPatchRef.current;
    pendingPatchRef.current = null;
    if (pending) updateTradeRef.current(pending.taskId, pending.patch);
  }, []);

  /** Queues a drag/resize result, committing once the gesture has settled. */
  const queueCommit = useCallback(
    (taskId: string, patch: Partial<TradeSection>) => {
      const pending = pendingPatchRef.current;
      if (pending && pending.taskId !== taskId) flushPendingCommit();
      pendingPatchRef.current = {
        taskId,
        patch: { ...(pending?.taskId === taskId ? pending.patch : {}), ...patch },
      };
      if (commitTimerRef.current !== null) {
        window.clearTimeout(commitTimerRef.current);
      }
      commitTimerRef.current = window.setTimeout(flushPendingCommit, 350);
    },
    [flushPendingCommit]
  );

  // Never lose a queued edit if the section unmounts mid-debounce.
  useEffect(() => () => flushPendingCommit(), [flushPendingCommit]);

  // The library drags the whole dependency chain, so every follower bar fires
  // its own `date_change`. Remember which bar the gesture started on and only
  // persist that one; the followers re-sequence through the scheduler.
  const handleContainerMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element | null;
    const wrapper = target ? target.closest('.bar-wrapper') : null;
    draggedBarIdRef.current = wrapper ? wrapper.getAttribute('data-id') : null;
    // The library draws `.handle.left` / `.handle.right` rects inside the
    // wrapper; grabbing either one resizes instead of moving.
    resizingRef.current = Boolean(
      target && target.closest('.handle.left, .handle.right')
    );
  };

  // Create the chart. Recreated only when the view mode changes (the library
  // has no API for removing a view mode from an existing chart). Data changes —
  // a committed drag/resize or a project-start edit — are applied in place by
  // the refresh effect below, which avoids tearing down the SVG and replaying
  // the grow-in animation on every adjustment.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || ganttTasksRef.current.length === 0) return;

    el.innerHTML = '';
    setRenderError(null);
    ganttRef.current = null;

    try {
      ganttRef.current = new Gantt(el, ganttTasksRef.current, {
        view_mode: viewMode,
        // Moving and edge-resizing are enabled; completion tracking is not part
        // of the data model, so the progress handle stays hidden.
        readonly: false,
        readonly_dates: false,
        readonly_progress: true,
        popup_on: 'hover',
        infinite_padding: false,
        container_height: 'auto',
        bar_height: 26,
        bar_corner_radius: 4,
        padding: 18,
        arrow_curve: 4,
        // The stock Month mode spends a 120px column plus two months of padding,
        // which squashes a multi-week project into a few unreadable slivers. A
        // wider column keeps 2-day bars (~13px) legible and fills the pane.
        view_modes: [
          'Day',
          'Week',
          {
            name: 'Month',
            padding: '1m',
            step: '1m',
            column_width: 200,
            date_format: 'YYYY-MM',
            snap_at: '7d',
            lower_text: 'MMMM',
            upper_text: (current, previous) =>
              !previous || current.getFullYear() !== previous.getFullYear()
                ? String(current.getFullYear())
                : '',
            upper_text_frequency: 1,
            thick_line: (d) => d.getMonth() % 3 === 0,
          },
        ],
        // Scroll to the project start rather than "today" so a future-dated
        // project is visible on first paint. The library still leaves a column
        // or two of dead space at scrollLeft 0; focusedStart() trims it below.
        scroll_to: 'start',
        is_weekend: isWeekend,
        holidays: { 'var(--g-weekend-highlight-color)': 'weekend' },
        popup: ({ task, set_title, set_subtitle, set_details }) => {
          const source = taskByIdRef.current.get(task.id);
          set_title(task.name);
          set_subtitle(`${task.id} • ${source?.suggested_duration_days ?? ''} workdays`);
          const lines = [
            `${toGanttTaskDate(String(task._startDate ?? task.start))} → ${toGanttTaskDate(
              String(task._endDate ?? task.end)
            )}`,
            `Predecessors: ${source?.predecessors || 'None'}`,
          ];
          if (source?.billable_revenue) {
            lines.push(`Billable: $${source.billable_revenue.toLocaleString()}`);
          }
          if (source?.isCriticalPath) {
            lines.push('<strong>On critical path</strong>');
          }
          set_details(lines.join('<br/>'));
        },
        // A dragged bar reports its new span continuously; the queued,
        // debounced commit keeps React out of the way until the gesture
        // settles. `end` is the inclusive last day, so the duration counts
        // workdays inclusively.
        on_date_change: (task, start, end) => {
          // Followers of a dependency-chain drag report dates too; ignore them.
          if (task.id !== draggedBarIdRef.current) return;
          const source = taskByIdRef.current.get(task.id);
          if (!source) return;
          const nextStart = formatDateYMD(start);
          const patch: Partial<TradeSection> = {};
          if (nextStart !== source.startDate) {
            patch.schedule_start_override = nextStart;
          }
          // Only a resize changes the duration. A plain move must preserve the
          // workday duration: the library reports calendar-day spans, so when a
          // bar lands across a weekend its reported end under-counts the
          // workdays (e.g. a 5-day bar moved onto a Tuesday reads back as 4).
          if (resizingRef.current) {
            const nextDuration = countWorkdaysInclusive(start, end);
            if (nextDuration !== source.suggested_duration_days) {
              patch.suggested_duration_days = nextDuration;
            }
          }
          if (Object.keys(patch).length > 0) queueCommit(task.id, patch);
        },
        // Double-click (or double-tap) opens the details modal.
        on_double_click: (task) => setDetailsTaskId(task.id),
      });
      // First paint: pull the scroll position onto the first bar so the
      // schedule starts at the left edge of the viewport instead of `padding`
      // columns in. Later rebuilds (e.g. after a drag commit) restore the
      // user's scroll position instead of yanking the view back.
      if (!didInitialScrollRef.current) {
        didInitialScrollRef.current = true;
        focusedStart(ganttRef.current);
        rafRef.current = requestAnimationFrame(() => focusedStart(ganttRef.current));
      } else {
        const container = ganttRef.current.$container;
        const target = lastScrollRef.current;
        container.scrollLeft = target;
        rafRef.current = requestAnimationFrame(() => {
          container.scrollLeft = target;
        });
      }
    } catch (err) {
      console.error('Failed to render Gantt chart', err);
      setRenderError(err instanceof Error ? err.message : 'Unknown chart error');
    }

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (ganttRef.current && ganttRef.current.$container) {
        lastScrollRef.current = ganttRef.current.$container.scrollLeft;
        ganttRef.current.$container.remove();
      }
      ganttRef.current = null;
    };
  }, [viewMode, hasSchedule]);

  // Apply schedule data changes in place so the chart does not flash or lose
  // its scroll position when the scheduler re-sequences tasks after a committed
  // drag/resize or a project-start edit.
  const firstRefreshRef = useRef(true);
  useEffect(() => {
    if (firstRefreshRef.current) {
      firstRefreshRef.current = false;
      return;
    }
    const chart = ganttRef.current;
    if (!chart) return;

    const container = chart.$container;
    const saved = container.scrollLeft;

    // The library re-renders with a smooth `scrollTo` back to the project
    // start; suspend that during refresh and restore the user's position.
    const setScrollPosition = chart.set_scroll_position;
    chart.set_scroll_position = () => {};
    try {
      chart.refresh(ganttTasksRef.current);
    } finally {
      chart.set_scroll_position = setScrollPosition;
    }

    // Strip the SMIL width animations so refreshed bars snap to their final
    // size instead of replaying a grow-in on every adjustment.
    chart.$svg.querySelectorAll('animate').forEach((node) => node.remove());

    container.scrollLeft = saved;
    rafRef.current = requestAnimationFrame(() => {
      container.scrollLeft = saved;
    });
  }, [scheduleData]);

  // Per-bar class sync. The library only accepts a single custom_class token,
  // so the critical-path "off" state (`xg-plain`) and the dragged-pin marker
  // (`xg-pinned`) are applied to the wrapper groups here, then a stylesheet
  // recalc is forced because a class change alone does not repaint SVG.
  useEffect(() => {
    const chart = ganttRef.current;
    if (!chart) return;
    (chart.$container.querySelectorAll('.bar-wrapper.xg-critical') as NodeListOf<SVGGElement>)
      .forEach((group) => group.classList.toggle('xg-plain', !highlightCriticalPath));
    (chart.$container.querySelectorAll('.bar-wrapper') as NodeListOf<SVGGElement>).forEach(
      (group) => {
        const id = group.getAttribute('data-id');
        const task = id ? taskByIdRef.current.get(id) : undefined;
        group.classList.toggle('xg-pinned', Boolean(task?.schedule_start_override));
      }
    );
    const svg = chart.$container.querySelector('svg');
    if (svg instanceof SVGElement) {
      svg.style.display = 'none';
      void svg.getBoundingClientRect();
      svg.style.display = '';
    }
  }, [highlightCriticalPath, viewMode, scheduleData]);

  // When the scheduler has to push a pinned start later (a predecessor is
  // still running), tell the user once instead of silently disagreeing with
  // the bar they just dropped.
  useEffect(() => {
    if (!scheduleData) return;
    scheduleData.tasks.forEach((task) => {
      if (
        !task.schedule_start_override ||
        task.schedule_start_override === task.startDate
      ) {
        return;
      }
      const key = `${task.task_id}:${task.schedule_start_override}`;
      if (clampNotifiedRef.current.has(key)) return;
      clampNotifiedRef.current.add(key);
      showToastRef.current(
        'warning',
        `${task.task_id} (${task.trade_name}) starts ${task.startDate} — its start was pushed to respect predecessors.`
      );
    });
  }, [scheduleData]);

  const detailsTask = detailsTaskId
    ? (scheduleData?.tasks.find((t) => t.task_id === detailsTaskId) ?? null)
    : null;

  if (!hasSchedule) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-none">
        <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center mb-3">
          <GanttChartSquare className="w-6 h-6" />
        </div>
        <h3 className="text-[14px] font-semibold text-slate-800">
          No Schedule Available
        </h3>
        <p className="text-[12px] text-slate-500 max-w-sm mx-auto mt-1">
          Upload an Xactimate estimate to generate Finish-to-Start subcontractor
          dependencies and Gantt sequencing.
        </p>
      </div>
    );
  }

  const { projectEndDate, totalWorkdays, criticalPathTaskIds } = scheduleData!;

  return (
    <div className="space-y-6">
      {/* Top Schedule Controls & Metrics */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-none">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-red-50 text-red-600">
                <GanttChartSquare className="w-4 h-4" />
              </span>
              <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">
                Subcontractor Finish-to-Start (FS) Gantt Scheduler
              </h3>
            </div>
            <p className="text-[12px] text-slate-500 mt-0.5">
              Sequenced by Xactimate trade codes, dry-times, and inspection
              milestones (skips weekends automatically).
            </p>
          </div>

          {/* Start Date, View Mode & Critical Path Toggle */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-[12px] font-medium text-slate-600">
                Start Date:
              </label>
              <input
                type="date"
                value={projectStartDate}
                onChange={(e) => setProjectStartDate(e.target.value)}
                className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-[12px] text-slate-900 font-medium"
              />
            </div>

            {/* View mode selector */}
            <div
              role="group"
              aria-label="Timeline scale"
              className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5"
            >
              {(['Day', 'Week', 'Month'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={viewMode === mode}
                  onClick={() => setViewMode(mode)}
                  className={`h-8 px-2.5 rounded-md text-[12px] font-semibold transition-colors ${
                    viewMode === mode
                      ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>

            <button
              type="button"
              aria-pressed={highlightCriticalPath}
              onClick={() => setHighlightCriticalPath(!highlightCriticalPath)}
              className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12px] font-semibold border transition-colors ${
                highlightCriticalPath
                  ? 'border-red-300 bg-red-50 text-red-700'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Flame className="w-3.5 h-3.5" />
              <span>Critical Path ({criticalPathTaskIds.size} Tasks)</span>
            </button>
          </div>
        </div>

        {/* Milestone Statistics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-100">
          <div>
            <span className="text-[11px] text-slate-400 font-semibold uppercase">
              Project Start
            </span>
            <p className="text-[14px] font-bold text-slate-900 font-mono">
              {tasks[0]?.startDate ?? projectStartDate}
            </p>
          </div>

          <div>
            <span className="text-[11px] text-slate-400 font-semibold uppercase">
              Projected Finish
            </span>
            <p className="text-[14px] font-bold text-slate-900 font-mono">
              {projectEndDate}
            </p>
          </div>

          <div>
            <span className="text-[11px] text-slate-400 font-semibold uppercase">
              Working Duration
            </span>
            <p className="text-[14px] font-bold text-slate-900 tabular-nums">
              {totalWorkdays} Business Days
            </p>
          </div>

          <div>
            <span className="text-[11px] text-slate-400 font-semibold uppercase">
              Calendar Span
            </span>
            <p className="text-[14px] font-bold text-emerald-700 tabular-nums">
              ~{(totalWorkdays * 1.4).toFixed(0)} Calendar Days
            </p>
          </div>
        </div>
      </div>

      {/* Interactive Gantt Chart Panel */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-none">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[12px] text-slate-600">
            <span className="font-semibold text-slate-900">Timeline:</span>
            <span>
              {viewMode} scale &bull; business days (Mon – Fri), weekends shaded
              &bull; drag bars to move or resize
            </span>
          </div>

          <div className="flex items-center gap-4 text-[11px] text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-red-600" />
              <span>Critical Path</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-slate-700" />
              <span>Standard Trade</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-slate-100 border border-slate-200" />
              <span>Weekend</span>
            </span>
          </div>
        </div>

        {renderError && (
          <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 flex items-start gap-2 text-[12px] text-amber-800">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              The interactive timeline could not be rendered ({renderError}). The
              schedule data above is still valid.
            </span>
          </div>
        )}

        <div className="p-3">
          {/* frappe-gantt builds its own DOM inside this node. */}
          <div
            ref={containerRef}
            className="xg-gantt w-full"
            onMouseDown={handleContainerMouseDown}
          />
        </div>

        {/* Footer with Sync CTA */}
        <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[12px]">
          <div className="text-slate-500 flex items-start gap-1.5">
            <Link2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              FS Dependencies:{' '}
              <span className="text-slate-700 font-medium">
                Drywall depends on MEP/Insulation &bull; Painting on Drywall &bull;
                Flooring/Trim on Paint &bull; Punch on all
              </span>
            </span>
          </div>
          <button
            onClick={() => onNavigateSection('workspace')}
            className="inline-flex items-center gap-1.5 font-semibold text-red-600 hover:text-red-700 shrink-0"
          >
            <span>Sync to Google Calendar &amp; Sheets</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Critical path detail table — the chart shows sequence, this shows slack */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-none">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-400" />
          <h4 className="text-[13px] font-semibold text-slate-900">
            Schedule Detail
          </h4>
          <span className="text-[11px] text-slate-400">
            {tasks.length} trade package{tasks.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-slate-50 text-[11px] uppercase text-slate-400 font-semibold">
              <tr>
                <th className="px-5 py-2">Trade</th>
                <th className="px-3 py-2">Start</th>
                <th className="px-3 py-2">Finish</th>
                <th className="px-3 py-2 text-right">Workdays</th>
                <th className="px-3 py-2">Predecessors</th>
                <th className="px-5 py-2">Dependency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tasks.map((task) => (
                <tr key={task.task_id} className="hover:bg-slate-50/70">
                  <td className="px-5 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-1.5 py-0.5 rounded font-mono font-bold text-[11px] ${
                          task.isCriticalPath
                            ? 'bg-red-50 text-red-700 border border-red-200'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                      >
                        {task.task_id}
                      </span>
                      <span className="font-medium text-slate-900">
                        {task.trade_name}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-600">
                    <span className="inline-flex items-center gap-1.5">
                      {task.schedule_start_override && (
                        <span title="Manually scheduled — double-click the bar to reset">
                          <Pin className="w-3 h-3 text-amber-500" />
                        </span>
                      )}
                      {task.startDate}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-600">
                    {task.endDate}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                    {task.suggested_duration_days}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-500">
                    {task.predecessors || '—'}
                  </td>
                  <td className="px-5 py-2">
                    {task.isCriticalPath ? (
                      <span className="inline-flex items-center gap-1 text-red-700 font-semibold">
                        <Flame className="w-3 h-3" />
                        Critical
                      </span>
                    ) : (
                      <span className="text-slate-400">Float</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2 text-[11px] text-slate-500">
          <Clock className="w-3.5 h-3.5" />
          <span>
            Hover a bar for a quick summary, drag it to reschedule, drag either
            edge to change its duration, or double-click for full details.
            Pinned bars show a pin icon and can be reset from their details.
          </span>
        </div>
      </div>

      {detailsTask && (
        <TaskDetailsModal
          task={detailsTask}
          onClose={() => setDetailsTaskId(null)}
          onResetManualDates={(taskId) =>
            onUpdateTrade(taskId, { schedule_start_override: undefined })
          }
          onOpenTradePackages={() => {
            setDetailsTaskId(null);
            onNavigateSection('packages');
          }}
        />
      )}
    </div>
  );
};
