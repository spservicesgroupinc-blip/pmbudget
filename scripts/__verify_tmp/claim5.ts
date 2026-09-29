// Empirical verification of claim 5: timezone / DST robustness.
import {
  computeSchedule,
  formatDateYMD,
  parseDateYMD,
  countWorkdaysInclusive,
  addWorkdays,
  getNextBusinessDay,
  ensureBusinessDay,
} from '../../src/utils/scheduler';
import type { TradeSection } from '../../src/types/estimate';

const T = (task_id: string, dur: number, predecessors = ''): TradeSection => ({
  task_id,
  trade_name: `Trade ${task_id}`,
  category_codes_included: ['DRY'],
  billable_revenue: 1000,
  suggested_duration_days: dur,
  predecessors,
  scope_summary: `scope ${task_id}`,
});

const out: string[] = [];
const log = (s: string) => out.push(s);

log(`TZ=${process.env.TZ ?? '(unset)'}  Intl=${Intl.DateTimeFormat().resolvedOptions().timeZone}  node=${process.version}`);

function sched(label: string, tasks: TradeSection[], start: string) {
  const r = computeSchedule(tasks, start);
  log(`${label}: end=${r.projectEndDate} total=${r.totalWorkdays} critical=${JSON.stringify([...r.criticalPathTaskIds].sort())} tasks=${r.tasks.map((t) => `${t.task_id}:${t.startDate}..${t.endDate}`).join(',')}`);
}

// Long chain: 30 workdays starting Mon 2026-03-02 crosses US spring-forward (2026-03-08)
// and 30 workdays starting Mon 2026-10-19 crosses US fall-back (2026-11-01).
let chain: TradeSection[] = [];
for (let i = 1; i <= 30; i++) chain.push(T(`T-${i}`, 3, i === 1 ? '' : `T-${i - 1}`));
sched('March chain 30x3d', chain, '2026-03-02');
sched('November chain 30x3d', chain, '2026-10-19');
sched('single task spanning spring-forward (start 2026-03-06 fri, dur 3)', [T('T-1', 3)], '2026-03-06');
sched('single task start Sat 2026-03-07 (DST eve)', [T('T-1', 2)], '2026-03-07');
sched('single task start Sun 2026-11-01 (US fall-back)', [T('T-1', 2)], '2026-11-01');
sched('Auckland DST end 2026-04-05: start Fri 2026-04-03 dur 3', [T('T-1', 3)], '2026-04-03');
sched('Auckland DST start 2026-09-27: start Fri 2026-09-25 dur 3', [T('T-1', 3)], '2026-09-25');

// Direct primitive checks at the DST boundary dates.
for (const s of ['2026-03-07', '2026-03-08', '2026-03-09', '2026-11-01', '2026-11-02', '2026-04-04', '2026-04-05', '2026-09-26', '2026-09-27']) {
  const d = parseDateYMD(s);
  const nb = getNextBusinessDay(d);
  const eb = ensureBusinessDay(d);
  const a3 = addWorkdays(d, 3);
  log(`prim ${s}: parse=${formatDateYMD(d)} nextBiz=${formatDateYMD(nb)} ensureBiz=${formatDateYMD(eb)} add3=${formatDateYMD(a3)} incl(parse,nextBiz)=${countWorkdaysInclusive(d, nb)}`);
  // round-trip through UTC ISO to show the instant
  log(`      instant=${d.toISOString()} offsetMin=${-new Date(d).getTimezoneOffset()}`);
}
log('JSON=' + JSON.stringify(out));
console.log(out.join('\n'));
