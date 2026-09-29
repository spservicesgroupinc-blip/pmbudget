// Offline verification of the deterministic budget engine (applyBudgetEngine):
// carrier RCV reconciliation, per-trade checksum relations (direct cost /
// gross profit / margin), idempotence, predecessor-graph repair and the
// turnkey material rules — against SAMPLE_ESTIMATES plus synthetic cases.
// Run: npx tsx scripts/verify-budget-engine.ts
import { applyBudgetEngine } from '../src/utils/budgetEngine.ts';
import { SAMPLE_ESTIMATES } from '../src/services/sampleEstimates.ts';
import type { EstimateResult, TradeSection } from '../src/types/estimate.ts';

const TOL = 0.02;
const close = (a: unknown, b: unknown, tol = TOL): boolean =>
  typeof a === 'number' &&
  typeof b === 'number' &&
  Number.isFinite(a) &&
  Number.isFinite(b) &&
  Math.abs(a - b) <= tol + 1e-9;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const f2 = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : String(n));

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
};

const MONEY_FIELDS = [
  'billable_revenue',
  'retail_labor',
  'retail_material',
  'direct_material',
  'direct_labor',
  'equipment_tax',
  'total_direct_cost',
  'gross_profit',
  'gross_margin_pct',
] as const;

const moneySnapshot = (estimate: EstimateResult) =>
  JSON.stringify(estimate.trade_sections.map((t) => MONEY_FIELDS.map((f) => t[f])));

// ---------------------------------------------------------------------------
// 1) Sample estimates: RCV reconciliation, per-trade checksums, idempotence.
// ---------------------------------------------------------------------------
for (const key of Object.keys(SAMPLE_ESTIMATES)) {
  const sample = SAMPLE_ESTIMATES[key];
  const result = applyBudgetEngine(sample);
  const totalRcv = sample.project_meta.total_rcv;
  const audit = result.budget_audit;

  const sumRcv = sum(result.trade_sections.map((t) => num(t.billable_revenue)));
  check(
    `${key}: Σ trade billable_revenue == total_rcv`,
    close(sumRcv, totalRcv),
    `${f2(sumRcv)} vs ${f2(totalRcv)}`
  );
  check(`${key}: budget_audit populated`, !!audit);
  if (audit) {
    check(
      `${key}: budget_audit.rcv_reconciled === true`,
      audit.rcv_reconciled === true,
      `delta_rcv ${audit.delta_rcv}`
    );
    check(`${key}: budget_audit.delta_rcv ≈ 0`, close(audit.delta_rcv, 0), `${audit.delta_rcv}`);
    check(
      `${key}: budget_audit.sum_trade_rcv == total_rcv`,
      close(audit.sum_trade_rcv, totalRcv),
      `${f2(audit.sum_trade_rcv)} vs ${f2(totalRcv)}`
    );
  }

  const costIssues: string[] = [];
  const marginIssues: string[] = [];
  const labelIssues: string[] = [];
  const turnkeyIssues: string[] = [];
  const margins: number[] = [];
  for (const t of result.trade_sections) {
    const directSum = num(t.direct_material) + num(t.direct_labor) + num(t.equipment_tax);
    if (!close(t.total_direct_cost, directSum)) {
      costIssues.push(`${t.task_id} total_direct_cost=${f2(t.total_direct_cost)} vs Σ ${f2(directSum)}`);
    }
    const grossProfit = num(t.billable_revenue) - num(t.total_direct_cost);
    if (!close(t.gross_profit, grossProfit)) {
      costIssues.push(`${t.task_id} gross_profit=${f2(t.gross_profit)} vs ${f2(grossProfit)}`);
    }
    const margin = num(t.gross_margin_pct);
    if (Number.isFinite(margin)) margins.push(margin);
    if (!(Number.isFinite(margin) && margin >= 0 && margin <= 60)) {
      marginIssues.push(`${t.task_id} ${String(t.gross_margin_pct)}`);
    }
    if (!t.trade_division || !t.execution_type) labelIssues.push(t.task_id);
    if (t.execution_type === 'Turnkey Subcontract' && t.direct_material !== 0) {
      turnkeyIssues.push(`${t.task_id} direct_material=${String(t.direct_material)}`);
    }
  }
  check(
    `${key}: per-trade direct-cost / gross-profit checksums (${result.trade_sections.length} trades)`,
    costIssues.length === 0,
    costIssues.join('; ')
  );
  check(
    `${key}: gross_margin_pct within 0..60 for every trade`,
    marginIssues.length === 0,
    marginIssues.join('; ')
  );
  check(
    `${key}: trade_division & execution_type populated for every trade`,
    labelIssues.length === 0,
    labelIssues.join('; ')
  );
  check(
    `${key}: turnkey trades have direct_material === 0`,
    turnkeyIssues.length === 0,
    turnkeyIssues.join('; ')
  );

  const rerun = applyBudgetEngine(result);
  check(
    `${key}: idempotent — money fields identical on re-run`,
    moneySnapshot(result) === moneySnapshot(rerun),
    'trade money fields drifted on the second pass'
  );

  // Derived-defaults path: a clone stripped of model-extraction fields must
  // still reconcile and self-report basis 'derived_defaults'.
  const stripped: EstimateResult = JSON.parse(JSON.stringify(sample));
  delete stripped.project_meta.base_subtotal;
  delete stripped.project_meta.material_tax;
  delete stripped.project_meta.op_total;
  for (const t of stripped.trade_sections) delete t.direct_subtotal;
  const derived = applyBudgetEngine(stripped);
  check(
    `${key}: stripped input → basis 'derived_defaults'`,
    derived.budget_audit?.basis === 'derived_defaults',
    String(derived.budget_audit?.basis)
  );
  const derivedSum = sum(derived.trade_sections.map((t) => num(t.billable_revenue)));
  check(
    `${key}: derived-defaults Σ rcv == total_rcv`,
    close(derivedSum, totalRcv),
    `${f2(derivedSum)} vs ${f2(totalRcv)}`
  );

  console.log(
    `      ${result.trade_sections.length} trades · Σ rcv ${f2(sumRcv)} · margins ${Math.min(...margins).toFixed(1)}-${Math.max(...margins).toFixed(1)}%`
  );
}

// ---------------------------------------------------------------------------
// 2) Synthetic edge cases.
// ---------------------------------------------------------------------------
const makeTrade = (
  partial: Partial<TradeSection> & Pick<TradeSection, 'task_id' | 'trade_name'>
): TradeSection => ({
  category_codes_included: [],
  billable_revenue: 1000,
  suggested_duration_days: 1,
  predecessors: '',
  scope_summary: 'Synthetic verification scope.',
  ...partial,
});

const makeEstimate = (trades: TradeSection[]): EstimateResult => ({
  project_meta: {
    client_name: 'Synthetic Verification',
    claim_number: 'SYN-0001',
    carrier: 'Test Carrier',
    total_rcv: sum(trades.map((t) => num(t.billable_revenue))),
  },
  trade_sections: trades,
});

// 2a) Predecessor cycle: T-1 -> T-2 -> T-1 must be broken deterministically.
{
  const cycle = makeEstimate([
    makeTrade({
      task_id: 'T-1',
      trade_name: 'Painting & Sealing',
      category_codes_included: ['PNT'],
      predecessors: 'T-2',
    }),
    makeTrade({
      task_id: 'T-2',
      trade_name: 'Drywall & Wall Prep',
      category_codes_included: ['DRY'],
      predecessors: 'T-1',
    }),
  ]);
  const out = applyBudgetEngine(cycle);
  const byId = new Map(out.trade_sections.map((t) => [t.task_id, t]));
  const predsOf = (id: string) =>
    String(byId.get(id)?.predecessors || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const edge12 = predsOf('T-1').includes('T-2');
  const edge21 = predsOf('T-2').includes('T-1');
  check(
    'cycle: at most one of T-1→T-2 / T-2→T-1 survives',
    !(edge12 && edge21),
    `T-1 preds "${byId.get('T-1')?.predecessors}", T-2 preds "${byId.get('T-2')?.predecessors}"`
  );
  const warnings = out.processing?.warnings || [];
  check(
    'cycle: processing.warnings mentions the cycle repair',
    warnings.some((w) => /cycle/i.test(w)),
    warnings.length ? warnings.join(' | ') : '(no warnings emitted)'
  );
}

// 2b) Unknown predecessor id must be dropped from the repaired graph.
{
  const out = applyBudgetEngine(
    makeEstimate([
      makeTrade({
        task_id: 'T-1',
        trade_name: 'Painting & Sealing',
        category_codes_included: ['PNT'],
        predecessors: 'T-99',
      }),
    ])
  );
  const predecessors = String(out.trade_sections[0]?.predecessors || '');
  check(
    'unknown predecessor: "T-99" removed',
    !predecessors.includes('T-99'),
    `predecessors "${predecessors}"`
  );
}

// 2c) Turnkey trade: itemized material allowances are dropped, material = 0.
{
  const estimate = makeEstimate([
    makeTrade({
      task_id: 'T-1',
      trade_name: 'Roofing',
      category_codes_included: ['RFG'],
      billable_revenue: 10000,
      scope_summary: 'Replace roof covering per the approved scope.',
    }),
  ]);
  estimate.material_allowances = [
    {
      trade: 'Roofing',
      component_code: 'RFG-1',
      description: 'Architectural shingles, 30-year',
      qty: 32,
      uom: 'SQ',
      unit_cost: 120,
      extended_cost: 3840,
    },
  ];
  const out = applyBudgetEngine(estimate);
  const t1 = out.trade_sections[0];
  check(
    'turnkey: execution_type resolves to Turnkey Subcontract',
    t1?.execution_type === 'Turnkey Subcontract',
    String(t1?.execution_type)
  );
  check(
    'turnkey: material allowance dropped',
    (out.material_allowances || []).length === 0,
    JSON.stringify(out.material_allowances || [])
  );
  check(
    'turnkey: direct_material === 0',
    t1?.direct_material === 0,
    String(t1?.direct_material)
  );
}

// ---------------------------------------------------------------------------
// 3) Structural subtotal/summary mismatch → proportional scaling (no negative
//    trade money, no delta dumping, cent-exact Σ RCV, idempotent re-runs).
//
//    The three synthetic trades are turnkey subcontract divisions (RFG/ELE/
//    PLM): with this meta (O&P $1,218.92 and tax $218 fixed by the summary
//    while the deflated line items carry only $1,000), a labor-split trade's
//    margin is dominated by the summary's O&P-to-subtotal ratio, whereas the
//    turnkey buyout keeps the 68% benchmark (≈32% GM) — the [-60, 60] sanity
//    band below is then a real bound on the engine's math.
// ---------------------------------------------------------------------------
const makeStructuralEstimate = (subtotals: number[]): EstimateResult => ({
  project_meta: {
    client_name: 'Synthetic Structural',
    claim_number: 'SYN-STR-1',
    carrier: 'Test Carrier',
    total_rcv: 13408.12,
    base_subtotal: 11971.2,
    material_tax: 218,
    op_total: 1218.92,
  },
  trade_sections: [
    makeTrade({
      task_id: 'T-1',
      trade_name: 'Roofing & Gutters',
      category_codes_included: ['RFG'],
      billable_revenue: 0,
      direct_subtotal: subtotals[0],
    }),
    makeTrade({
      task_id: 'T-2',
      trade_name: 'Electrical',
      category_codes_included: ['ELE'],
      billable_revenue: 0,
      direct_subtotal: subtotals[1],
    }),
    makeTrade({
      task_id: 'T-3',
      trade_name: 'Plumbing',
      category_codes_included: ['PLM'],
      billable_revenue: 0,
      direct_subtotal: subtotals[2],
    }),
  ],
});

const runStructuralCase = (label: string, subtotals: number[]) => {
  const result = applyBudgetEngine(makeStructuralEstimate(subtotals));
  const rcvs = result.trade_sections.map((t) => num(t.billable_revenue));
  check(
    `${label}: every billable_revenue >= 0`,
    rcvs.every((v) => Number.isFinite(v) && v >= 0),
    JSON.stringify(rcvs)
  );
  check(
    `${label}: Σ billable_revenue == 13408.12 (±0.01)`,
    close(sum(rcvs), 13408.12, 0.01),
    f2(sum(rcvs))
  );
  check(
    `${label}: gross_profit finite and total_direct_cost >= 0`,
    result.trade_sections.every(
      (t) => Number.isFinite(num(t.gross_profit)) && num(t.total_direct_cost) >= 0
    ),
    result.trade_sections
      .map((t) => `${t.task_id}:gp=${f2(t.gross_profit)}/dc=${f2(t.total_direct_cost)}`)
      .join(' ')
  );
  const marginIssues = result.trade_sections
    .filter((t) => {
      const m = num(t.gross_margin_pct);
      return !(Number.isFinite(m) && m >= -60 && m <= 60);
    })
    .map((t) => `${t.task_id} ${String(t.gross_margin_pct)}`);
  check(
    `${label}: gross_margin_pct within [-60, 60] for every trade`,
    marginIssues.length === 0,
    marginIssues.join('; ')
  );
  const warnings = result.processing?.warnings || [];
  check(
    `${label}: warnings report the proportional scaling`,
    warnings.some((w) => /scaled|reconcile/i.test(w)),
    warnings.length ? warnings.join(' | ') : '(no warnings emitted)'
  );
  check(
    `${label}: audit.rcv_reconciled === true`,
    result.budget_audit?.rcv_reconciled === true,
    String(result.budget_audit?.rcv_reconciled)
  );
  const rerun = applyBudgetEngine(result);
  check(
    `${label}: rerun idempotent — money fields identical`,
    moneySnapshot(result) === moneySnapshot(rerun),
    'trade money fields drifted on the second pass'
  );
};

runStructuralCase('inflated subtotals', [10000, 8000, 6477]);
runStructuralCase('deflated subtotals', [300, 400, 300]);

// ---------------------------------------------------------------------------
// 3b) Summary-only estimate (carrier RCV, no per-trade money anywhere): must
//     stay honestly at $0 with an explicit warning — never invent dollars,
//     never crash, never claim reconciliation.
// ---------------------------------------------------------------------------
{
  const estimate: EstimateResult = {
    project_meta: {
      client_name: 'Synthetic Summary Only',
      claim_number: 'SYN-SUM-1',
      carrier: 'Test Carrier',
      total_rcv: 50000,
    },
    trade_sections: [
      makeTrade({
        task_id: 'T-1',
        trade_name: 'Drywall & Wall Prep',
        category_codes_included: ['DRY'],
        billable_revenue: 0,
      }),
      makeTrade({
        task_id: 'T-2',
        trade_name: 'Painting & Sealing',
        category_codes_included: ['PNT'],
        billable_revenue: 0,
      }),
    ],
  };
  const out = applyBudgetEngine(estimate);
  const rcvs = out.trade_sections.map((t) => num(t.billable_revenue));
  check(
    'summary-only: every billable_revenue === 0',
    rcvs.every((v) => v === 0),
    JSON.stringify(rcvs)
  );
  const warnings = out.processing?.warnings || [];
  check(
    'summary-only: warning names the missing per-trade basis',
    warnings.some((w) => w.includes('No per-trade')),
    warnings.length ? warnings.join(' | ') : '(no warnings emitted)'
  );
  check(
    'summary-only: audit.rcv_reconciled === false',
    out.budget_audit?.rcv_reconciled === false,
    String(out.budget_audit?.rcv_reconciled)
  );
  check(
    'summary-only: audit.carrier_total_rcv === 50000',
    out.budget_audit?.carrier_total_rcv === 50000,
    String(out.budget_audit?.carrier_total_rcv)
  );
  check(
    'summary-only: no NaN in any trade money field',
    out.trade_sections.every((t) => MONEY_FIELDS.every((f) => Number.isFinite(num(t[f])))),
    'non-finite money field'
  );
  const rerun = applyBudgetEngine(out);
  check(
    'summary-only: stable on re-run',
    moneySnapshot(out) === moneySnapshot(rerun),
    'trade money fields drifted on the second pass'
  );
}

// ---------------------------------------------------------------------------
// 3c) Zero-garbage estimate (all-zero summary, zero subtotals): all-zero,
//     no NaN, no scaling warning, stable on re-runs.
// ---------------------------------------------------------------------------
{
  const estimate: EstimateResult = {
    project_meta: {
      client_name: 'Synthetic Zero',
      claim_number: 'SYN-ZERO-1',
      carrier: 'Test Carrier',
      total_rcv: 0,
      base_subtotal: 0,
      material_tax: 0,
      op_total: 0,
    },
    trade_sections: [
      makeTrade({
        task_id: 'T-1',
        trade_name: 'Demolition & Hauling',
        category_codes_included: ['DEM'],
        billable_revenue: 0,
        direct_subtotal: 0,
      }),
      makeTrade({
        task_id: 'T-2',
        trade_name: 'Flooring (Carpet)',
        category_codes_included: ['FCC'],
        billable_revenue: 0,
        direct_subtotal: 0,
      }),
    ],
  };
  const out = applyBudgetEngine(estimate);
  check(
    'zero-garbage: no NaN in any trade money field',
    out.trade_sections.every((t) => MONEY_FIELDS.every((f) => Number.isFinite(num(t[f])))),
    'non-finite money field'
  );
  const warnings = out.processing?.warnings || [];
  check(
    'zero-garbage: no scaling warning',
    !warnings.some((w) => /scal/i.test(w)),
    warnings.length ? warnings.join(' | ') : '(no warnings emitted)'
  );
  const rerun = applyBudgetEngine(out);
  check(
    'zero-garbage: stable on re-run',
    moneySnapshot(out) === moneySnapshot(rerun),
    'trade money fields drifted on the second pass'
  );
}

// ---------------------------------------------------------------------------
// 4) Inflated line items + material allowances: the structural reconciliation
//    must scale procurement allowances too, otherwise the allowance-based
//    direct_material override exceeds the scaled trade RCV and gross margins
//    collapse far below any benchmark.
//
//    Carrier summary C = 13408.12 against Σ subtotals 24477 (+ $218 tax +
//    $1218.92 O&P) forces k = C/(S+T+O) ≈ 0.517410. Each trade carries two
//    $2,500 allowance items whose UNSCALED total ($5,350 with tax) would
//    dwarf the scaled revenue and drive gross margins to ≈ -60%/-92%.
// ---------------------------------------------------------------------------
{
  const k = 13408.12 / (24477 + 218 + 1218.92);
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const expectedUnit = round2(25 * k); // ≈ 12.94 — scaled like the rollout

  const estimate: EstimateResult = {
    project_meta: {
      client_name: 'Synthetic Inflated Allowances',
      claim_number: 'SYN-INF-1',
      carrier: 'Test Carrier',
      total_rcv: 13408.12,
      base_subtotal: 11971.2,
      material_tax: 218,
      op_total: 1218.92,
    },
    trade_sections: [
      makeTrade({
        task_id: 'T-1',
        trade_name: 'Drywall & Plaster',
        category_codes_included: ['DRY'],
        billable_revenue: 0,
        direct_subtotal: 10000,
        retail_labor: 6000,
        retail_material: 4000,
      }),
      makeTrade({
        task_id: 'T-2',
        trade_name: 'Painting & Wallcovering',
        category_codes_included: ['PNT'],
        billable_revenue: 0,
        direct_subtotal: 8000,
        retail_labor: 4800,
        retail_material: 3200,
      }),
      makeTrade({
        task_id: 'T-3',
        trade_name: 'Finish Trim & Doors',
        category_codes_included: ['FNC'],
        billable_revenue: 0,
        direct_subtotal: 6477,
        retail_labor: 3886.2,
        retail_material: 2590.8,
      }),
    ],
    material_allowances: [
      { trade: 'Drywall & Plaster', component_code: 'DRY-1', description: '1/2 in. drywall sheets', qty: 100, uom: 'EA', unit_cost: 25, extended_cost: 2500 },
      { trade: 'Drywall & Plaster', component_code: 'DRY-2', description: 'Joint compound, 4.5 gal', qty: 100, uom: 'EA', unit_cost: 25, extended_cost: 2500 },
      { trade: 'Painting & Wallcovering', component_code: 'PNT-1', description: 'Interior wall paint', qty: 100, uom: 'EA', unit_cost: 25, extended_cost: 2500 },
      { trade: 'Painting & Wallcovering', component_code: 'PNT-2', description: 'Stain-blocking primer', qty: 100, uom: 'EA', unit_cost: 25, extended_cost: 2500 },
      { trade: 'Finish Trim & Doors', component_code: 'FNC-1', description: 'Primed casing, 8 ft', qty: 100, uom: 'EA', unit_cost: 25, extended_cost: 2500 },
      { trade: 'Finish Trim & Doors', component_code: 'FNC-2', description: 'Interior door slabs', qty: 100, uom: 'EA', unit_cost: 25, extended_cost: 2500 },
    ],
  };

  const out = applyBudgetEngine(estimate);
  const kept = out.material_allowances || [];
  const rcvs = out.trade_sections.map((t) => num(t.billable_revenue));
  check(
    'inflated + allowances: every billable_revenue >= 0',
    rcvs.every((v) => Number.isFinite(v) && v >= 0),
    JSON.stringify(rcvs)
  );
  check(
    'inflated + allowances: Σ billable_revenue == 13408.12 (±0.01)',
    close(sum(rcvs), 13408.12, 0.01),
    f2(sum(rcvs))
  );
  const qtyIssues = kept
    .filter((it) => Math.abs(it.qty * it.unit_cost - it.extended_cost) > 0.01)
    .map((it) => `${it.description}: ${it.qty}×${it.unit_cost}≠${it.extended_cost}`);
  check(
    `inflated + allowances: qty × unit_cost == extended_cost for all ${kept.length} kept items`,
    kept.length === 6 && qtyIssues.length === 0,
    qtyIssues.join('; ')
  );
  const scaleIssues = kept
    .filter(
      (it) =>
        Math.abs(it.unit_cost - expectedUnit) > 0.001 ||
        Math.abs(it.extended_cost - round2(it.qty * expectedUnit)) > 0.001
    )
    .map((it) => `${it.description}: unit ${it.unit_cost}, ext ${it.extended_cost}`);
  check(
    `inflated + allowances: kept unit costs scaled by k (expected ${expectedUnit}, unscaled 25)`,
    kept.length === 6 && scaleIssues.length === 0,
    scaleIssues.join('; ')
  );
  const marginIssues = out.trade_sections
    .filter((t) => !(Number.isFinite(num(t.gross_margin_pct)) && num(t.gross_margin_pct) >= -45))
    .map((t) => `${t.task_id} ${String(t.gross_margin_pct)}%`);
  check(
    'inflated + allowances: gross_margin_pct finite and >= -45 for every trade',
    marginIssues.length === 0,
    marginIssues.join('; ')
  );
  const audit = out.budget_audit;
  const sumDirectMaterial = round2(sum(out.trade_sections.map((t) => num(t.direct_material))));
  check(
    'inflated + allowances: Σ direct_material == audit.allowance_total (±0.02) & material_reconciled',
    audit !== undefined &&
      close(sumDirectMaterial, audit.allowance_total, 0.02) &&
      audit.material_reconciled === true,
    `Σ ${f2(sumDirectMaterial)} vs allowance_total ${f2(audit?.allowance_total)} (variance ${String(audit?.material_variance)})`
  );
  const rerun = applyBudgetEngine(out);
  check(
    'inflated + allowances: rerun idempotent — money fields identical',
    moneySnapshot(out) === moneySnapshot(rerun),
    'trade money fields drifted on the second pass'
  );
  check(
    'inflated + allowances: rerun keeps allowance items byte-identical',
    JSON.stringify(kept) === JSON.stringify(rerun.material_allowances || []),
    JSON.stringify(rerun.material_allowances || [])
  );
}

console.log(failures === 0 ? '\nAll budget-engine checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
