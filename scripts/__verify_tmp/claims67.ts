// Empirical verification of claims 6 and 7 via the REAL functions with mocked fetch.
import { createSheetsBudget, syncCalendarEvents } from '../../src/services/workspaceApi';
import type { EstimateResult, ScheduledTask } from '../../src/types/estimate';

const calls: { url: string; method: string; body: any }[] = [];

function installMock() {
  calls.length = 0;
  (globalThis as any).fetch = async (url: string, init: any = {}) => {
    let body: any = undefined;
    try { body = init.body ? JSON.parse(init.body) : undefined; } catch { body = init.body; }
    calls.push({ url: String(url), method: init.method || 'GET', body });
    if (String(url) === 'https://sheets.googleapis.com/v4/spreadsheets' && init.method === 'POST') {
      return new Response(JSON.stringify({ spreadsheetId: 'SID123', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/SID123/edit' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

const estimate: EstimateResult = {
  project_meta: {
    client_name: 'ACME', claim_number: 'C-1', carrier: 'CarrierX',
    policy_number: 'P-9', total_rcv: 10000, net_claim: 9000, overhead_and_profit: 1000,
  },
  trade_sections: [
    { task_id: 'T-1', trade_name: 'Drywall', category_codes_included: ['DRY'], billable_revenue: 1000, suggested_duration_days: 2, predecessors: '', scope_summary: 's1', subcontractor_name: 'Sub A', subcontractor_bid: 0 },
    { task_id: 'T-2', trade_name: 'Paint', category_codes_included: ['PNT'], billable_revenue: 2000, suggested_duration_days: 3, predecessors: 'T-1', scope_summary: 's2' },
  ],
} as EstimateResult;

console.log('################ CLAIM 6 ################');
installMock();
// subBids pin T-2 to a zero-dollar bid; T-1 has subcontractor_bid: 0 and no subBids entry.
await createSheetsBudget('tok', estimate, 60, { 'T-2': { name: 'Self-performed', amount: 0 } });
const update = calls.find((c) => c.url.includes('/values/'));
console.log('update URL       :', update?.url);
console.log('range in body    :', update?.body?.range, '| majorDimension:', update?.body?.majorDimension);
const rows: any[][] = update?.body?.values ?? [];
console.log('rowCount(rows)   :', rows.length);
const lens = rows.map((r) => r.length);
console.log('columns per row  :', JSON.stringify(lens));
console.log('distinct lengths :', JSON.stringify([...new Set(lens)].sort((a, b) => a - b)));
console.log('rows with <12    :', lens.map((n, i) => (n < 12 ? i + 1 : null)).filter(Boolean).join(','));
console.log('rows with >12    :', lens.filter((n) => n > 12).length);
rows.forEach((r, i) => console.log(`  row ${String(i + 1).padStart(2)} (len ${String(r.length).padStart(2)}): ${JSON.stringify(r)}`));

console.log('\n################ CLAIM 7a: zero-dollar bids ################');
const t1 = rows.find((r) => r[0] === 'T-1');
const t2 = rows.find((r) => r[0] === 'T-2');
console.log('T-1 row (rcv=1000, targetBuyout=600, subcontractor_bid=0, no subBids entry):');
console.log('   name=', t1?.[5], ' actualSub=', t1?.[6], ' variance=', t1?.[7], ' margin=', t1?.[8]);
console.log('   EXPECTED actualSub for a genuine $0 bid: 0 ; margin 100.0%');
console.log('T-2 row (rcv=2000, targetBuyout=1200, subBids amount=0):');
console.log('   name=', t2?.[5], ' actualSub=', t2?.[6], ' variance=', t2?.[7], ' margin=', t2?.[8]);
console.log('   EXPECTED actualSub for a genuine $0 bid: 0 ; margin 100.0%');

// A truthy-but-zero-equivalent string bid:
const est2 = JSON.parse(JSON.stringify(estimate)) as EstimateResult;
(est2.trade_sections[1] as any).subcontractor_bid = 0;
installMock();
await createSheetsBudget('tok', est2, 60, {});
const rows2: any[][] = calls.find((c) => c.url.includes('/values/'))!.body.values;
const r2 = rows2.find((r) => r[0] === 'T-2');
console.log('T-2 with t.subcontractor_bid=0 and no subBids entry: actualSub=', r2?.[6], '(expected 0)');

console.log('\n################ CLAIM 7b: syncCalendarEvents exclusive end date ################');
const mkTask = (id: string, startDate: string, endDate: string): ScheduledTask => ({
  task_id: id, trade_name: `Trade ${id}`, category_codes_included: ['DRY'], billable_revenue: 1000,
  suggested_duration_days: 3, predecessors: '', scope_summary: 's', startDate, endDate,
  startOffsetDays: 0, endOffsetDays: 3, isCriticalPath: true,
} as ScheduledTask);

const dates = [
  ['2026-03-05', '2026-03-06'], // Fri end, before US spring-forward
  ['2026-03-06', '2026-03-07'], // Sat end (DST eve)
  ['2026-03-07', '2026-03-08'], // Sun end = US spring-forward day itself
  ['2026-03-08', '2026-03-09'], // Mon end, after spring-forward
  ['2026-10-30', '2026-11-01'], // Sun end = US fall-back day
  ['2026-11-02', '2026-11-03'], // Tue end
];
const tasks = dates.map((d, i) => mkTask(`T-${i + 1}`, d[0], d[1]));
installMock();
await syncCalendarEvents('tok', estimate, tasks);
console.log(`TZ=${process.env.TZ ?? '(unset)'} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
const evs = calls.filter((c) => c.url.includes('calendar/v3'));
evs.forEach((c, i) => {
  const t = tasks[i];
  const expected = (() => { const [y, m, d] = t.endDate.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, d + 1)); return x.toISOString().split('T')[0]; })();
  console.log(`  ${t.task_id} start=${t.startDate} endDate(incl)=${t.endDate} -> event.end=${c.body.end.date} | expected next-day=${expected} ${c.body.end.date === expected ? 'OK' : '*** OFF BY ONE ***'}`);
});
