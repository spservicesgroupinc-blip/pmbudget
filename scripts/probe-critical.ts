// Validates computeSchedule's critical path against an independent
// longest-path calculation over the same FS dependency graph.
// Run: npx tsx scripts/probe-critical.ts
import { SAMPLE_ESTIMATES } from '../src/services/sampleEstimates.ts';
import { computeSchedule, countWorkdaysInclusive } from '../src/utils/scheduler.ts';
import type { ScheduledTask } from '../src/types/estimate.ts';

/**
 * Independent critical-path expectation, computed from scratch:
 *   earliest finish EF(t) = duration(t) + max(EF(pred))
 *   latest finish   LF(t) = projectEnd - longestPathFrom(t) + duration(t)
 *   slack(t)              = LF(t) - EF(t)
 * A task is critical iff slack is zero, i.e. it lies on a longest path.
 */
function expectedCritical(tasks: ScheduledTask[]): { critical: Set<string>; projectLength: number } {
  const byId = new Map(tasks.map((t) => [t.task_id, t]));
  const predsOf = (t: ScheduledTask) =>
    (t.predecessors || '')
      .split(',')
      .map((p) => p.trim())
      .filter((p) => byId.has(p));

  // Longest path from a task through its successors to the end of the network.
  const downMemo = new Map<string, number>();
  const down = (id: string, seen = new Set<string>()): number => {
    if (downMemo.has(id)) return downMemo.get(id)!;
    if (seen.has(id)) return 0; // cycle guard
    seen.add(id);
    const t = byId.get(id);
    if (!t) return 0;
    const succs = tasks.filter((x) => predsOf(x).includes(id));
    const tail = succs.length ? Math.max(...succs.map((s) => down(s.task_id, seen))) : 0;
    const value = t.suggested_duration_days + tail;
    downMemo.set(id, value);
    return value;
  };

  // Earliest finish.
  const efMemo = new Map<string, number>();
  const ef = (id: string, seen = new Set<string>()): number => {
    if (efMemo.has(id)) return efMemo.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const t = byId.get(id);
    if (!t) return 0;
    const preds = predsOf(t);
    const start = preds.length ? Math.max(...preds.map((p) => ef(p, seen))) : 0;
    const value = start + t.suggested_duration_days;
    efMemo.set(id, value);
    return value;
  };

  const projectLength = Math.max(...tasks.map((t) => ef(t.task_id)));
  const critical = new Set(
    tasks
      .filter((t) => {
        const latestFinish = projectLength - down(t.task_id) + t.suggested_duration_days;
        return latestFinish - ef(t.task_id) === 0;
      })
      .map((t) => t.task_id)
  );
  return { critical, projectLength };
}

let failures = 0;
const START = '2026-10-05';

for (const key of Object.keys(SAMPLE_ESTIMATES)) {
  const { trade_sections } = SAMPLE_ESTIMATES[key];
  const result = computeSchedule(trade_sections, START);
  const { tasks, totalWorkdays, criticalPathTaskIds, projectEndDate } = result;

  const { critical: expected, projectLength } = expectedCritical(tasks);
  const got = [...criticalPathTaskIds].sort().join(',');
  const want = [...expected].sort().join(',');
  const ok = got === want;
  if (!ok) failures++;

  console.log(`${ok ? 'PASS' : 'FAIL'}  ${key}`);
  console.log(
    `      ${tasks.length} tasks, ${totalWorkdays} workdays, ends ${projectEndDate}, longest chain ${projectLength}d`
  );
  console.log(`      critical: [${got}]${ok ? '' : `\n      expected: [${want}]`}`);

  // The reported schedule length must equal the longest dependency chain.
  if (totalWorkdays !== projectLength) {
    failures++;
    console.log(`      FAIL totalWorkdays ${totalWorkdays} !== longest chain ${projectLength}`);
  }

  // Every task should be scheduled to start on a business day.
  const weekend = tasks.filter((t) => {
    const d = new Date(t.startDate + 'T12:00:00');
    return d.getDay() === 0 || d.getDay() === 6;
  });
  if (weekend.length) {
    failures++;
    console.log(`      FAIL weekend start dates: ${weekend.map((t) => t.task_id).join(', ')}`);
  }

  // Predecessors must finish strictly before their successors begin.
  const byId = new Map(tasks.map((t) => [t.task_id, t]));
  for (const t of tasks) {
    for (const pid of (t.predecessors || '').split(',').map((p) => p.trim()).filter(Boolean)) {
      const p = byId.get(pid);
      if (p && !(p.endDate < t.startDate)) {
        failures++;
        console.log(`      FAIL ${pid} ends ${p.endDate} but ${t.task_id} starts ${t.startDate}`);
      }
    }
  }
}

// --- Manual schedule overrides -------------------------------------------
// A dragged bar pins `schedule_start_override`; computeSchedule must honor it,
// cascade successors, clamp collisions with predecessors, and never schedule
// a task before the project start.
{
  const check = (label: string, ok: boolean, detail = '') => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  };

  const sampleKey = Object.keys(SAMPLE_ESTIMATES)[0];
  const base = SAMPLE_ESTIMATES[sampleKey].trade_sections;
  const rootId = base.find((t) => !(t.predecessors || '').trim())!.task_id;
  const dependent = base.find((t) => (t.predecessors || '').trim().length > 0);
  const withOverride = (taskId: string, date: string) =>
    base.map((t) =>
      t.task_id === taskId ? { ...t, schedule_start_override: date } : t
    );
  const auto = computeSchedule(base, START);

  // 1) A pin two weeks out moves the task without pulling the schedule earlier.
  const pinned = computeSchedule(withOverride(rootId, '2026-10-19'), START);
  const pinnedRoot = pinned.tasks.find((t) => t.task_id === rootId)!;
  check(
    `override moves pinned task (${sampleKey})`,
    pinnedRoot.startDate === '2026-10-19' &&
      pinned.projectEndDate >= auto.projectEndDate,
    `${pinnedRoot.startDate}, project end ${pinned.projectEndDate} vs auto ${auto.projectEndDate}`
  );

  // 2) A pinned override must never break FS order or freeze successors.
  const pinnedById = new Map(pinned.tasks.map((t) => [t.task_id, t]));
  const fsViolations = pinned.tasks.filter((t) =>
    (t.predecessors || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .some((pid) => {
        const p = pinnedById.get(pid);
        return p ? p.endDate >= t.startDate : false;
      })
  );
  check(
    'override keeps FS order',
    fsViolations.length === 0,
    fsViolations.map((t) => t.task_id).join(', ')
  );
  const successors = pinned.tasks.filter((t) =>
    (t.predecessors || '').split(',').map((p) => p.trim()).includes(rootId)
  );
  const cascaded =
    successors.length === 0 ||
    successors.some((t) => {
      const before = auto.tasks.find((x) => x.task_id === t.task_id)!;
      return t.startDate > before.startDate;
    });
  check(
    'override cascades to successors',
    cascaded,
    successors.map((t) => t.task_id).join(', ')
  );

  // 3) A pin before the project start floors at the project start.
  const floored = computeSchedule(withOverride(rootId, '2026-09-21'), START);
  const flooredRoot = floored.tasks.find((t) => t.task_id === rootId)!;
  check(
    'pin before project start floors at project start',
    flooredRoot.startDate === START,
    flooredRoot.startDate
  );

  // 4) A weekend pin snaps forward to the next business day (Sat -> Mon).
  const weekendPin = computeSchedule(withOverride(rootId, '2026-10-17'), START);
  const weekendRoot = weekendPin.tasks.find((t) => t.task_id === rootId)!;
  check(
    'weekend pin snaps to Monday',
    weekendRoot.startDate === '2026-10-19',
    weekendRoot.startDate
  );

  // 5) A pin that collides with predecessors clamps forward, keeping FS.
  if (dependent) {
    const autoDep = auto.tasks.find((t) => t.task_id === dependent.task_id)!;
    if (autoDep.startDate > START) {
      const clamped = computeSchedule(withOverride(dependent.task_id, START), START);
      const clampedDep = clamped.tasks.find((t) => t.task_id === dependent.task_id)!;
      check(
        'pin colliding with predecessors clamps forward',
        clampedDep.startDate === autoDep.startDate && clampedDep.startDate > START,
        `${clampedDep.startDate} vs auto ${autoDep.startDate}`
      );
    } else {
      console.log(`SKIP  pin-clamp check (${dependent.task_id} auto-starts at the project start)`);
    }
  }

  // 6) Workday counting, as used by the drag adapter.
  check(
    'workdays Mon..Fri = 5',
    countWorkdaysInclusive(
      new Date('2026-10-05T12:00:00'),
      new Date('2026-10-09T12:00:00')
    ) === 5
  );
  check(
    'workdays Fri..Mon = 2',
    countWorkdaysInclusive(
      new Date('2026-10-09T12:00:00'),
      new Date('2026-10-12T12:00:00')
    ) === 2
  );
  check(
    'weekend-only span clamps to 1',
    countWorkdaysInclusive(
      new Date('2026-10-17T12:00:00'),
      new Date('2026-10-18T12:00:00')
    ) === 1
  );
  check(
    'midnight start / 23:59:59 end counts one day',
    countWorkdaysInclusive(
      new Date('2026-10-05T00:00:00'),
      new Date('2026-10-05T23:59:59')
    ) === 1
  );
}

console.log(failures === 0 ? '\nAll critical-path checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

