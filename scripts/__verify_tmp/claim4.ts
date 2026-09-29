// Empirical verification of claim 4: schedule_start_override behaviour.
import { computeSchedule } from '../../src/utils/scheduler';
import type { TradeSection } from '../../src/types/estimate';

const T = (task_id: string, dur: number, predecessors = '', override?: string): TradeSection => ({
  task_id,
  trade_name: `Trade ${task_id}`,
  category_codes_included: ['DRY'],
  billable_revenue: 1000,
  suggested_duration_days: dur,
  predecessors,
  scope_summary: `scope ${task_id}`,
  ...(override === undefined ? {} : { schedule_start_override: override }),
});

function show(label: string, tasks: TradeSection[], start = '2026-03-02') {
  try {
    const r = computeSchedule(tasks, start);
    console.log(`\n=== ${label} (start ${start}) ===`);
    console.log('tasks    :', r.tasks.map((t) => `${t.task_id}[${t.startDate}..${t.endDate}] off=${t.startOffsetDays}/${t.endOffsetDays} crit=${t.isCriticalPath}`).join('  '));
    console.log('projectEnd:', r.projectEndDate, '| totalWorkdays:', r.totalWorkdays, '| critical:', JSON.stringify([...r.criticalPathTaskIds].sort()));
  } catch (e: any) {
    console.log(`\n=== ${label} (start ${start}) ===`);
    console.log('THREW:', e?.name, e?.message);
  }
}

console.log('########## CLAIM 4 ##########');
console.log('\n-- (a) pin EARLIER than project start (start Mon 2026-03-02, pin 2026-02-20) --');
show('4a pin before project start', [T('T-1', 3, '', '2026-02-20')]);
console.log('expected: start stays 2026-03-02 (pin ignored)');

console.log('\n-- (b) pin on weekend --');
show('4b pin Saturday 2026-03-07', [T('T-1', 2, '', '2026-03-07')]);
show('4b2 pin Sunday 2026-03-08', [T('T-1', 2, '', '2026-03-08')]);
show('4b3 pin Saturday 2026-03-14', [T('T-1', 2, '', '2026-03-14')]);
console.log('expected: moves to Monday 2026-03-09 / 2026-03-09 / 2026-03-16');

console.log('\n-- (c) pin collides with predecessor (T-1 dur3 ends Wed 03-04; T-2 pin Tue 03-03) --');
show('4c pin before predecessor finish', [T('T-1', 3), T('T-2', 2, 'T-1', '2026-03-03')]);
show('4c2 pin ON predecessor finish day (03-04)', [T('T-1', 3), T('T-2', 2, 'T-1', '2026-03-04')]);
show('4c3 pin AFTER predecessor finish (03-10)', [T('T-1', 3), T('T-2', 2, 'T-1', '2026-03-10')]);
console.log('expected: 03-05 (FS wins) / 03-05 / 03-10 (pin wins)');

console.log('\n-- (d) pin far beyond project end (T-2 pin 2026-06-01) --');
show('4d pin far future', [T('T-1', 1), T('T-2', 2, '', '2026-06-01')]);
console.log('expected: projectEndDate includes 2026-06-02, totalWorkdays ~66');

console.log('\n-- (e) malformed / invalid override strings --');
for (const bad of ['not-a-date', '2026-13-45', '2026-02-30', '2026-00-10', '2026-03-02T00:00:00Z', '  ', '', 'March 5 2026', '2026-3-2', '9999999999-01-01', '0-0-0', '-2026-03-02']) {
  show(`4e override=${JSON.stringify(bad)}`, [T('T-1', 2, '', bad)]);
}
console.log('expected: no throw; "not-a-date" -> Invalid Date -> comparison false -> ignored;');
console.log('          "2026-13-45" -> naive Date rollover (2027-02-14) -> pin ACCEPTED if later than project start');
console.log('          "2026-02-30" -> naive rollover to 2026-03-02 (a Monday) -> pin ACCEPTED');
