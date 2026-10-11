// Offline verification of the schedule predecessor dropdown and the
// expanded-timeline control.
//
// 1) Pure graph helpers (parse/format, cycle blocking, option list, toggling).
// 2) End-to-end: a link written by the dropdown really re-sequences the Gantt
//    schedule through computeSchedule().
// 3) Server-rendered TaskDetailsModal markup: the free-text field is gone and
//    the picker shows linked trades / stale ids.
// 4) Source invariants for the full-screen timeline overlay (no DOM available
//    in this runner, so the wiring is asserted against the source text).
//
// Run: npx tsx scripts/verify-predecessor-picker.tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import {
  buildPredecessorOptions,
  describePredecessors,
  formatPredecessors,
  parsePredecessors,
  togglePredecessor,
  wouldCreateCycle,
} from '../src/utils/predecessors.ts';
import { computeSchedule } from '../src/utils/scheduler.ts';
import { TaskDetailsModal } from '../src/components/TaskDetailsModal.tsx';
import type { ScheduledTask, TradeSection } from '../src/types/estimate.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
};

const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

// ---------------------------------------------------------------------------
// 1) Pure helpers
// ---------------------------------------------------------------------------
eq('parse: tolerates commas, semicolons and whitespace', parsePredecessors(' T-1 ,T-2; T-3 '), ['T-1', 'T-2', 'T-3']);
eq('parse: de-duplicates and preserves order', parsePredecessors('T-2, T-1, T-2'), ['T-2', 'T-1']);
eq('parse: empty / undefined / null are empty', [parsePredecessors(''), parsePredecessors(undefined), parsePredecessors(null)], [[], [], []]);
eq('format: canonical string form', formatPredecessors(['T-1', 'T-1', ' T-2 ']), 'T-1, T-2');
eq('format: empty selection persists as empty string', formatPredecessors([]), '');

const TRADES = [
  { task_id: 'T-1', trade_name: 'Framing', predecessors: '', suggested_duration_days: 3 },
  { task_id: 'T-2', trade_name: 'Electrical Rough-In', predecessors: 'T-1', suggested_duration_days: 2 },
  { task_id: 'T-3', trade_name: 'Drywall', predecessors: 'T-2', suggested_duration_days: 2 },
  { task_id: 'T-4', trade_name: 'Paint', predecessors: 'T-2', suggested_duration_days: 1 },
];

check('cycles: a trade that depends on the edited task is blocked (direct)', wouldCreateCycle(TRADES, 'T-1', 'T-2'));
check('cycles: a trade that depends on it transitively is blocked', wouldCreateCycle(TRADES, 'T-1', 'T-3'));
check('cycles: self is blocked', wouldCreateCycle(TRADES, 'T-1', 'T-1'));
check('cycles: an independent downstream trade is allowed', !wouldCreateCycle(TRADES, 'T-3', 'T-4'));
check('cycles: a redundant but acyclic link is allowed', !wouldCreateCycle(TRADES, 'T-3', 'T-1'));

const options = buildPredecessorOptions(TRADES, 'T-1', []);
eq('options: every other trade is offered, in schedule order', options.map((o) => o.taskId), ['T-2', 'T-3', 'T-4']);
check('options: the edited task is never offered', !options.some((o) => o.taskId === 'T-1'));
check('options: trade names travel with the ids', options[0].tradeName === 'Electrical Rough-In');
check('options: durations travel with the ids', options[0].durationDays === 2);
check(
  'options: everything that would loop is blocked with a reason',
  options.every((o) => o.createsCycle && Boolean(o.blockedReason)),
  JSON.stringify(options.map((o) => [o.taskId, o.createsCycle]))
);

const downstreamOptions = buildPredecessorOptions(TRADES, 'T-4', ['T-2']);
eq('options: linked flag reflects the current selection', downstreamOptions.filter((o) => o.linked).map((o) => o.taskId), ['T-2']);
check(
  'options: a downstream trade with no path back stays linkable',
  downstreamOptions.find((o) => o.taskId === 'T-3')!.createsCycle === false
);

eq('toggle: linking appends', togglePredecessor([], { taskId: 'T-1', linked: false, createsCycle: false }), ['T-1']);
eq('toggle: re-clicking a link removes it (unlink)', togglePredecessor(['T-1', 'T-2'], { taskId: 'T-1', linked: true, createsCycle: false }), ['T-2']);
eq('toggle: a blocked trade cannot be linked', togglePredecessor([], { taskId: 'T-2', linked: false, createsCycle: true }), []);
eq(
  'toggle: an existing link can always be removed, so a legacy loop stays fixable',
  togglePredecessor(['T-2'], { taskId: 'T-2', linked: true, createsCycle: true }),
  []
);
eq('toggle: order is preserved across edits', togglePredecessor(['T-2'], { taskId: 'T-3', linked: false, createsCycle: false }), ['T-2', 'T-3']);

eq('summary: no links reads as the project start', describePredecessors([], TRADES), 'None — starts at project start');
eq('summary: names the linked trades', describePredecessors(['T-1', 'T-3'], TRADES), 'T-1 · Framing, T-3 · Drywall');
eq('summary: flags ids that left the schedule', describePredecessors(['T-9'], TRADES), 'T-9 (not on schedule)');

// ---------------------------------------------------------------------------
// 2) End-to-end: what the dropdown writes actually re-sequences the schedule
// ---------------------------------------------------------------------------
const PROJECT_START = '2026-03-02'; // a Monday
const asTrade = (t: (typeof TRADES)[number], predecessors: string): TradeSection => ({
  task_id: t.task_id,
  trade_name: t.trade_name,
  category_codes_included: [],
  billable_revenue: 0,
  suggested_duration_days: t.suggested_duration_days,
  predecessors,
  scope_summary: '',
});

const scheduled = (trades: TradeSection[]) =>
  new Map(computeSchedule(trades, PROJECT_START).tasks.map((t) => [t.task_id, t]));

const independent = scheduled(TRADES.map((t) => asTrade(t, '')));
check(
  'FS: without links every trade starts at the project start',
  ['T-1', 'T-2', 'T-3', 'T-4'].every((id) => independent.get(id)!.startDate === PROJECT_START)
);

// Link T-3 to T-1 through the same helper the picker uses.
const afterLink = togglePredecessor([], { taskId: 'T-1', linked: false, createsCycle: false });
const linkedTrades = TRADES.map((t) =>
  asTrade(t, t.task_id === 'T-3' ? formatPredecessors(afterLink) : t.predecessors)
);
const linkedSchedule = scheduled(linkedTrades);
const t1 = linkedSchedule.get('T-1')!;
const t3 = linkedSchedule.get('T-3')!;
check(
  'FS: a dropdown link makes the follower start after its predecessor finishes',
  t3.startDate > t1.endDate,
  `T-3 ${t3.startDate} vs T-1 end ${t1.endDate}`
);
check('FS: the predecessor itself does not move', t1.startDate === PROJECT_START);

const twoLinks = formatPredecessors(['T-1', 'T-2']);
const twoLinkSchedule = scheduled(
  TRADES.map((t) => asTrade(t, t.task_id === 'T-4' ? twoLinks : t.predecessors))
);
const t2 = twoLinkSchedule.get('T-2')!;
const t4 = twoLinkSchedule.get('T-4')!;
check(
  'FS: multiple links wait for the latest finishing predecessor',
  t4.startDate > t2.endDate && t4.startDate > t1.endDate,
  `T-4 ${t4.startDate}, T-2 end ${t2.endDate}, T-1 end ${t1.endDate}`
);

const unlinked = scheduled(TRADES.map((t) => asTrade(t, '')));
check(
  'unlink: clearing the selection returns the trade to the project start',
  unlinked.get('T-3')!.startDate === PROJECT_START
);

// ---------------------------------------------------------------------------
// 3) Rendered markup of the details modal
// ---------------------------------------------------------------------------
const withDates = (t: TradeSection): ScheduledTask => {
  const s = computeSchedule([t], PROJECT_START).tasks[0];
  return s;
};
const allTasks: ScheduledTask[] = TRADES.map((t) => withDates(asTrade(t, t.predecessors)));

const renderModal = (predecessors: string) => {
  const base = asTrade(TRADES[2], predecessors);
  return renderToStaticMarkup(
    React.createElement(TaskDetailsModal, {
      task: { ...base, ...withDates(base) } as ScheduledTask,
      allTasks,
      onClose: () => {},
      onUpdateTrade: () => {},
      onRemoveTrade: () => {},
      onResetManualDates: () => {},
      onOpenTradePackages: () => {},
      onShowToast: () => {},
    })
  );
};

const linkMarkup = renderModal('T-1');
check('render: linked predecessor is named in the picker', linkMarkup.includes('T-1 · Framing'));
check('render: linked predecessor has an unlink control', linkMarkup.includes('Unlink predecessor T-1'));
check('render: the picker is a listbox dropdown', linkMarkup.includes('aria-haspopup="listbox"'));
check(
  'render: the old free-text predecessor field is gone',
  !linkMarkup.includes('e.g. T-1, T-2') && !linkMarkup.includes('Unknown predecessor')
);
check('render: nothing linked reads as the project start', renderModal('').includes('None — starts at project start'));
check('render: a stale id is flagged as off-schedule', renderModal('T-99').includes('not on schedule'));

// ---------------------------------------------------------------------------
// 4) Source invariants (the runner has no DOM, so the full-screen overlay and
//    the modal wiring are asserted against the source text)
// ---------------------------------------------------------------------------
const ganttSource = readFileSync(new URL('../src/components/sections/GanttScheduleSection.tsx', import.meta.url), 'utf8');
const modalSource = readFileSync(new URL('../src/components/TaskDetailsModal.tsx', import.meta.url), 'utf8');

check('full screen: overlay covers the viewport', ganttSource.includes('fixed inset-0 z-50 flex flex-col'));
check('full screen: toggle button is labelled for both states', ganttSource.includes('Exit full screen') && ganttSource.includes('View and edit the timeline full screen'));
check(
  'full screen: the toggle is on the timeline card itself, not only in the toolbar above',
  (ganttSource.match(/\{renderFullscreenToggle\(\)\}/g) || []).length >= 2,
  `${(ganttSource.match(/\{renderFullscreenToggle\(\)\}/g) || []).length} call site(s)`
);
check(
  'full screen: the expanded state highlights the minimize control',
  ganttSource.includes("'border-slate-900 bg-slate-900 text-white hover:bg-slate-800'")
);
check('full screen: chart area grows to fill the overlay', ganttSource.includes("'flex-1 min-h-0 overflow-auto p-3'"));
check('full screen: Escape collapses it when no dialog is open', ganttSource.includes("event.key !== 'Escape'") && ganttSource.includes('[role="dialog"][aria-modal="true"]'));
check('full screen: page scroll is locked while expanded', ganttSource.includes("document.body.style.overflow = 'hidden'"));
check('full screen: scale + critical-path controls stay reachable when expanded', ganttSource.includes('{isFullscreen && (') && ganttSource.includes('renderViewScale()'));
check('full screen: the chart is not rebuilt when expanding', ganttSource.includes("}, [viewMode, hasSchedule]);"));
check('modal: receives the full task list for the dropdown', ganttSource.includes('allTasks={tasks}'));
check('modal: renders the shared picker', modalSource.includes('<PredecessorPicker'));
check('modal: no id-typing fallback left behind', !modalSource.includes('allTaskIds'));

console.log(failures === 0 ? '\nAll predecessor-picker checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
