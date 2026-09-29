// Empirical verification of scheduler claims 1-3. No src files are modified.
import { computeSchedule } from '../../src/utils/scheduler';
import type { TradeSection } from '../../src/types/estimate';

const T = (task_id: string, dur: number, predecessors = '', extra: Partial<TradeSection> = {}): TradeSection => ({
  task_id,
  trade_name: `Trade ${task_id}`,
  category_codes_included: ['DRY'],
  billable_revenue: 1000,
  suggested_duration_days: dur,
  predecessors,
  scope_summary: `scope ${task_id}`,
  ...extra,
});

// ---------------------------------------------------------------------------
// Independent reference implementation (does NOT import scheduler internals).
// ---------------------------------------------------------------------------
const isWk = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
const nextBiz = (d: Date) => { const x = new Date(d); do { x.setDate(x.getDate() + 1); } while (isWk(x)); return x; };
const addW = (d: Date, n: number) => { const x = new Date(d); let k = Math.max(1, n) - 1; while (k > 0) { x.setDate(x.getDate() + 1); if (!isWk(x)) k--; } return x; };
const idx = (start: Date, d: Date) => { let c = 0; const cur = new Date(start); while (cur < d) { if (!isWk(cur)) c++; cur.setDate(cur.getDate() + 1); } return c; };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const p = (s: string) => { const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd, 12); };

function reference(tasks: TradeSection[], startStr: string) {
  const start = p(startStr);
  while (isWk(start)) start.setDate(start.getDate() + 1);
  const map = new Map(tasks.map((t) => [t.task_id, t]));
  // topo order
  const order: TradeSection[] = []; const seen = new Set<string>(); const stack = new Set<string>();
  const vis = (id: string) => {
    if (seen.has(id) || stack.has(id)) return;
    stack.add(id);
    const t = map.get(id);
    if (t?.predecessors) for (const pid of t.predecessors.split(',').map((s) => s.trim()).filter(Boolean)) if (map.has(pid)) vis(pid);
    stack.delete(id); seen.add(id); if (t) order.push(t);
  };
  tasks.forEach((t) => vis(t.task_id));
  tasks.forEach((t) => { if (!seen.has(t.task_id)) { seen.add(t.task_id); order.push(t); } });

  const es = new Map<string, Date>(); const ee = new Map<string, number>(); const eds = new Map<string, Date>();
  for (const t of order) {
    let s = new Date(start);
    const pin = (t as any).schedule_start_override;
    if (pin && String(pin).trim()) { const ps = p(String(pin).trim()); while (isWk(ps)) ps.setDate(ps.getDate() + 1); if (ps > s) s = ps; }
    if (t.predecessors) {
      let maxEnd: Date | null = null;
      for (const pid of t.predecessors.split(',').map((x) => x.trim()).filter(Boolean)) {
        if (!map.has(pid)) continue;
        const pe = eds.get(pid); if (pe && (!maxEnd || pe > maxEnd)) maxEnd = pe;
      }
      if (maxEnd) { const nb = nextBiz(maxEnd); if (nb > s) s = nb; }
    }
    const dur = Math.max(1, t.suggested_duration_days || 1);
    const e = addW(s, dur);
    es.set(t.task_id, s); eds.set(t.task_id, e); ee.set(t.task_id, idx(start, s) + dur);
  }
  const H = Math.max(0, ...order.map((t) => ee.get(t.task_id) ?? 0));
  const succs = new Map<string, string[]>();
  for (const t of tasks) if (t.predecessors) for (const pid of t.predecessors.split(',').map((x) => x.trim())) {
    if (!succs.has(pid)) succs.set(pid, []); succs.get(pid)!.push(t.task_id);
  }
  const lf = new Map<string, number>(); const critical = new Set<string>();
  for (let i = order.length - 1; i >= 0; i--) {
    const t = order[i];
    const sc = (succs.get(t.task_id) || []).filter((s) => map.has(s));
    let L = H;
    if (sc.length) {
      let m = H;
      for (const sid of sc) { const sl = (lf.get(sid) ?? H) - Math.max(1, map.get(sid)!.suggested_duration_days || 1); if (sl < m) m = sl; }
      L = m;
    }
    lf.set(t.task_id, L);
    if (L - (ee.get(t.task_id) ?? 0) <= 0.5) critical.add(t.task_id);
  }
  const end = new Date(start); for (const t of order) { const e = eds.get(t.task_id)!; if (e > end) end.setTime(e.getTime()); }
  return { H, critical, dates: Object.fromEntries(order.map((t) => [t.task_id, `${ymd(es.get(t.task_id)!)}..${ymd(eds.get(t.task_id)!)}`])), end: ymd(end) };
}

function run(label: string, tasks: TradeSection[], start: string) {
  const r = computeSchedule(tasks, start);
  const ref = reference(tasks, start);
  const got = [...r.criticalPathTaskIds].sort();
  const exp = [...ref.critical].sort();
  console.log(`\n=== ${label} (start ${start}) ===`);
  console.log('tasks           :', r.tasks.map((t) => `${t.task_id}[${t.startDate}..${t.endDate}] off=${t.startOffsetDays}/${t.endOffsetDays} crit=${t.isCriticalPath}`).join('  '));
  console.log('projectEndDate  :', r.projectEndDate, '| referenceEnd:', ref.end, r.projectEndDate === ref.end ? 'MATCH' : 'MISMATCH');
  console.log('totalWorkdays   :', r.totalWorkdays, '| referenceHorizon H:', ref.H, r.totalWorkdays === ref.H ? 'MATCH' : 'MISMATCH');
  console.log('criticalPath    :', JSON.stringify(got), '| reference:', JSON.stringify(exp), JSON.stringify(got) === JSON.stringify(exp) ? 'MATCH' : 'MISMATCH');
  console.log('ref dates       :', JSON.stringify(ref.dates));
  return { r, ref };
}

console.log('################ CLAIM 1 ################');
// 1a. simple 2-task FS chain, durations 2 and 3, Monday start
run('1a: 2-task FS chain d2->d3', [T('T-1', 2), T('T-2', 3, 'T-1')], '2026-03-02');
// 1b. 4 tasks: A->B and A->C (parallel branch), then D joins B,C
run('1b: parallel branch A(2)->B(3), A->C(2), D(1) preds B,C', [T('T-A', 2), T('T-B', 3, 'T-A'), T('T-C', 2, 'T-A'), T('T-D', 1, 'T-B,T-C')], '2026-03-02');
// 1c. empty
run('1c: empty trade_sections', [], '2026-03-02');
// 1d. single task
run('1d: single task d1', [T('T-1', 1)], '2026-03-02');
run('1d2: single task d5', [T('T-1', 5)], '2026-03-02');
// 1e. project start on a Saturday
run('1e: 2-task chain starting Saturday 2026-03-07', [T('T-1', 2), T('T-2', 3, 'T-1')], '2026-03-07');
// 1f. out-of-order array (does the topological order fixup matter?)
run('1f: 2-task chain passed in reverse array order', [T('T-2', 3, 'T-1'), T('T-1', 2)], '2026-03-02');
// 1g. branch with a genuinely non-critical middle task followed by a long task
run('1g: A(1)->B(1) and A->C(10), D(1) preds B only', [T('T-A', 1), T('T-B', 1, 'T-A'), T('T-C', 10, 'T-A'), T('T-D', 1, 'T-B')], '2026-03-02');

console.log('\n################ CLAIM 2 ################');
// 2a. two tasks that are each other's predecessors
run('2a: T-1 preds T-2, T-2 preds T-1 (durations 5 and 1)', [T('T-1', 5, 'T-2'), T('T-2', 1, 'T-1')], '2026-03-02');
// 2b. self-dependency
run('2b: T-1 preds T-1 (duration 2)', [T('T-1', 2, 'T-1')], '2026-03-02');
// 2c. 3-cycle + a 4th task depending on the cycle
run('2c: 3-cycle T-1->T-2->T-3->T-1, T-4 preds T-1', [T('T-1', 2, 'T-3'), T('T-2', 2, 'T-1'), T('T-3', 2, 'T-2'), T('T-4', 1, 'T-1')], '2026-03-02');
// 2d. 2-cycle with the cyclic pair passed last (does array order change the outcome?)
run('2d: same 2-cycle, array order [T-2, T-1]', [T('T-2', 1, 'T-1'), T('T-1', 5, 'T-2')], '2026-03-02');

console.log('\n################ CLAIM 3 ################');
run('3a: T-2 preds non-existent T-9', [T('T-1', 2), T('T-2', 3, 'T-9')], '2026-03-02');
run('3b: preds "T-1,,T-2" empty segment', [T('T-1', 2), T('T-2', 2), T('T-3', 1, 'T-1,,T-2')], '2026-03-02');
run('3c: preds " t-1 " whitespace + lowercase', [T('T-1', 2), T('T-2', 3, ' t-1 ')], '2026-03-02');
run('3d: preds "T-1;T-2" semicolon', [T('T-1', 2), T('T-2', 2), T('T-3', 3, 'T-1;T-2')], '2026-03-02');
run('3e: preds "T-1, T-1" duplicate', [T('T-1', 2), T('T-2', 3, 'T-1, T-1')], '2026-03-02');
run('3f: preds mix "T-1, T-9, ,T-2"', [T('T-1', 2), T('T-2', 4), T('T-3', 1, 'T-1, T-9, ,T-2')], '2026-03-02');
