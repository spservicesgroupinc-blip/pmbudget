import { TradeSection, ScheduledTask } from '../types/estimate';

/**
 * Checks if a given date is a weekend (Saturday or Sunday)
 */
export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Moves date forward to the nearest business day (Monday if on weekend)
 */
export function ensureBusinessDay(date: Date): Date {
  const d = new Date(date);
  while (isWeekend(d)) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

/**
 * Adds N business days to a date.
 * If duration is 1 workday, start and end date are the SAME day.
 * If duration is 2 workdays starting Mon, ends Tue.
 */
export function addWorkdays(startDate: Date, workdays: number): Date {
  const d = new Date(startDate);
  let daysToAdd = Math.max(1, workdays) - 1;

  while (daysToAdd > 0) {
    d.setDate(d.getDate() + 1);
    if (!isWeekend(d)) {
      daysToAdd--;
    }
  }
  return d;
}

/**
 * Gets the next business day immediately following a completion date
 */
export function getNextBusinessDay(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + 1);
  while (isWeekend(d)) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

export function formatDateYMD(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateYMD(str: string): Date {
  const [year, month, day] = str.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0); // Noon to avoid timezone boundary issues
}

export function getNextMonday(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = (8 - day) % 7 || 7; // days until next Monday
  const nextMon = new Date(now);
  nextMon.setDate(now.getDate() + diff);
  return formatDateYMD(nextMon);
}

/**
 * Counts the business days in an inclusive start..endInclusive span.
 * frappe-gantt reports a dragged bar back as `(start, end)` where `end` is the
 * inclusive last day, which is exactly the span a workday duration covers.
 */
export function countWorkdaysInclusive(start: Date, endInclusive: Date): number {
  const first = new Date(start);
  first.setHours(12, 0, 0, 0); // noon keeps day-stepping clear of DST edges
  const last = new Date(endInclusive);
  last.setHours(12, 0, 0, 0);
  let count = 0;
  const current = new Date(first);
  while (current <= last) {
    if (!isWeekend(current)) count++;
    current.setDate(current.getDate() + 1);
  }
  return Math.max(1, count);
}

/**
 * Schedules all trade packages using Finish-to-Start (FS) dependencies.
 */
export function computeSchedule(
  tradeSections: TradeSection[],
  projectStartStr: string
): {
  tasks: ScheduledTask[];
  projectEndDate: string;
  totalWorkdays: number;
  criticalPathTaskIds: Set<string>;
} {
  const projectStartDate = ensureBusinessDay(parseDateYMD(projectStartStr));
  const taskMap = new Map<string, TradeSection>();
  tradeSections.forEach((t) => taskMap.set(t.task_id, t));

  // Resolved task schedule details
  const scheduledMap = new Map<
    string,
    {
      startDate: Date;
      endDate: Date;
      duration: number;
      earlyStartOffset: number;
      earlyEndOffset: number;
    }
  >();

  // Helper to resolve task dates recursively with cycle detection
  const visiting = new Set<string>();

  function resolveTask(taskId: string) {
    if (scheduledMap.has(taskId)) return scheduledMap.get(taskId)!;
    if (visiting.has(taskId)) {
      // Cycle detected, fallback
      const start = new Date(projectStartDate);
      const end = addWorkdays(start, 1);
      return {
        startDate: start,
        endDate: end,
        duration: 1,
        earlyStartOffset: 0,
        earlyEndOffset: 1,
      };
    }

    visiting.add(taskId);
    const trade = taskMap.get(taskId);
    const duration = trade ? Math.max(1, trade.suggested_duration_days || 1) : 1;

    // A bar dragged on the Gantt chart pins this task's start. The pin can
    // only push a task later than the project start; the FS constraint below
    // still wins if the pin collides with a predecessor's finish.
    let taskStartDate = new Date(projectStartDate);
    const pinnedStart =
      trade?.schedule_start_override && trade.schedule_start_override.trim().length > 0
        ? ensureBusinessDay(parseDateYMD(trade.schedule_start_override))
        : null;
    if (pinnedStart && pinnedStart > taskStartDate) {
      taskStartDate = pinnedStart;
    }

    if (trade && trade.predecessors && trade.predecessors.trim().length > 0) {
      const predIds = trade.predecessors
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);

      let maxPredEndDate: Date | null = null;

      predIds.forEach((pid) => {
        if (taskMap.has(pid)) {
          const predSchedule = resolveTask(pid);
          if (!maxPredEndDate || predSchedule.endDate > maxPredEndDate) {
            maxPredEndDate = new Date(predSchedule.endDate);
          }
        }
      });

      if (maxPredEndDate) {
        const earliestFromPreds = getNextBusinessDay(maxPredEndDate);
        if (earliestFromPreds > taskStartDate) {
          taskStartDate = earliestFromPreds;
        }
      }
    }

    const taskEndDate = addWorkdays(taskStartDate, duration);

    // Compute day offsets from project start
    const earlyStartOffset = countBusinessDaysBetween(
      projectStartDate,
      taskStartDate
    );
    const earlyEndOffset = earlyStartOffset + duration;

    const res = {
      startDate: taskStartDate,
      endDate: taskEndDate,
      duration,
      earlyStartOffset,
      earlyEndOffset,
    };

    scheduledMap.set(taskId, res);
    visiting.delete(taskId);
    return res;
  }

  tradeSections.forEach((t) => resolveTask(t.task_id));

  // Find project end date
  let overallEndDate = new Date(projectStartDate);
  scheduledMap.forEach((s) => {
    if (s.endDate > overallEndDate) {
      overallEndDate = new Date(s.endDate);
    }
  });

  const totalWorkdays = countBusinessDaysBetween(
    projectStartDate,
    getNextBusinessDay(overallEndDate)
  );

  // Backward pass to find critical path (tasks with 0 float)
  const criticalPathTaskIds = new Set<string>();

  // Map successors
  const successorMap = new Map<string, string[]>();
  tradeSections.forEach((t) => {
    if (t.predecessors) {
      t.predecessors
        .split(',')
        .map((p) => p.trim())
        .forEach((pid) => {
          if (!successorMap.has(pid)) successorMap.set(pid, []);
          successorMap.get(pid)!.push(t.task_id);
        });
    }
  });

  // Late finish calculation. Offsets are measured in workdays from the project
  // start, and `earlyEndOffset` is inclusive of the task's own duration, so the
  // horizon must be the business-day count through the end of the final day.
  const lateFinishMap = new Map<string, number>();
  const totalOffsetDays = totalWorkdays;

  // Order tasks so that every task appears after all of its predecessors. The
  // backward pass below needs successors resolved before predecessors; relying
  // on the incoming array order is only correct when the caller happens to pass
  // a topologically sorted list.
  const orderedTasks: TradeSection[] = [];
  const visited = new Set<string>();
  const inProgress = new Set<string>();
  function visit(taskId: string) {
    if (visited.has(taskId) || inProgress.has(taskId)) return;
    inProgress.add(taskId);
    const trade = taskMap.get(taskId);
    if (trade?.predecessors) {
      trade.predecessors
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .forEach((pid) => {
          if (taskMap.has(pid)) visit(pid);
        });
    }
    inProgress.delete(taskId);
    visited.add(taskId);
    if (trade) orderedTasks.push(trade);
  }
  tradeSections.forEach((t) => visit(t.task_id));
  // Tasks reachable only through a dependency cycle never complete the pass
  // above; keep them scheduled rather than silently dropping them.
  tradeSections.forEach((t) => {
    if (!visited.has(t.task_id)) {
      visited.add(t.task_id);
      orderedTasks.push(t);
    }
  });

  // Backward pass: walk successors before predecessors, propagating late starts.
  for (let i = orderedTasks.length - 1; i >= 0; i--) {
    const t = orderedTasks[i];
    const sched = scheduledMap.get(t.task_id);
    if (!sched) continue;
    const succs = successorMap.get(t.task_id) || [];

    let lateFinish = totalOffsetDays;
    if (succs.length > 0) {
      let minSuccLateStart = totalOffsetDays;
      succs.forEach((sid) => {
        const sLateFinish = lateFinishMap.get(sid) ?? totalOffsetDays;
        const sDuration = scheduledMap.get(sid)?.duration || 1;
        const sLateStart = sLateFinish - sDuration;
        if (sLateStart < minSuccLateStart) {
          minSuccLateStart = sLateStart;
        }
      });
      lateFinish = minSuccLateStart;
    }

    lateFinishMap.set(t.task_id, lateFinish);
    const slack = lateFinish - sched.earlyEndOffset;
    if (slack <= 0.5) {
      criticalPathTaskIds.add(t.task_id);
    }
  }

  const tasks: ScheduledTask[] = tradeSections.map((t) => {
    const s = scheduledMap.get(t.task_id)!;
    return {
      ...t,
      startDate: formatDateYMD(s.startDate),
      endDate: formatDateYMD(s.endDate),
      startOffsetDays: s.earlyStartOffset,
      endOffsetDays: s.earlyEndOffset,
      isCriticalPath: criticalPathTaskIds.has(t.task_id),
    };
  });

  return {
    tasks,
    projectEndDate: formatDateYMD(overallEndDate),
    totalWorkdays,
    criticalPathTaskIds,
  };
}

function countBusinessDaysBetween(start: Date, end: Date): number {
  if (end <= start) return 0;
  let count = 0;
  const current = new Date(start);
  while (current < end) {
    if (!isWeekend(current)) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  return count;
}
