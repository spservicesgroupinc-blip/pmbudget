// Offline verification of the deterministic estimate text miner
// (estimateTextMiner.ts) and its backfill hook (applyMinedBackfill in
// xactEngine.ts):
//   1. full Xactimate-style fixture -> summary totals + per-division recovery
//   2. quantity-only sample         -> bare quantities/list numbers are NOT money
//   3. summary-only text            -> summary recovered, no trade lines
//   4. no-money text                -> zero tokens, empty summary, no crash
//   5. applyMinedBackfill           -> zeroed estimate recovers real dollars
// Optional live e2e (real DeepSeek call, 30-90s):
//   npx tsx scripts/verify-miner.ts --live   (requires DEEPSEEK_API_KEY)
import { mineEstimateDollars } from '../estimateTextMiner.ts';
import { applyMinedBackfill } from '../xactEngine.ts';
import { RAW_ESTIMATE_SNIPPET } from '../src/services/sampleEstimates.ts';
import type { EstimateResult } from '../src/types/estimate.ts';

const TOL = 0.02;
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
};
const close = (a: unknown, b: unknown, tol = TOL): boolean =>
  typeof a === 'number' &&
  typeof b === 'number' &&
  Number.isFinite(a) &&
  Number.isFinite(b) &&
  Math.abs(a - b) <= tol + 1e-9;
const f2 = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : String(n));

// Full fixture copied verbatim from scripts/__verify_tmp/repro-dollars.ts
// (do not modify that file — this is a frozen copy for the miner tests).
const ESTIMATE_LINES = [
  'Xactimate Professional Estimate',
  'Claim Number: 92-8419-X21    Policy Number: HO-3 44-99201-7',
  'Insured: Michael and Sarah Jenkins',
  'Property: 4821 Maple Ridge Drive, Fort Wayne, IN 46815',
  'Home Phone: (260) 555-0193',
  'Carrier: State Farm Fire and Casualty Company',
  'Type of Loss: Water Damage            Date of Loss: 8/14/2026',
  'Price List: INDIANA 10/2026',
  '',
  'DWE  Great Room & Hallway',
  'WTR  Water extraction - carpet and pad, 2 rooms                     180.00 SY     46.50    8,370.00',
  'WTR  Air mover - 1/2 HP, per day (4 units x 3 days)                  12.00 EA     32.00      384.00',
  'WTR  Dehumidifier - LGR, per day (2 units x 3 days)                   6.00 EA    105.00      630.00',
  'DEM  Remove and dispose carpet and pad - flooded                    180.00 SY      3.25      585.00',
  'DEM  Remove baseboard - 5-1/4" MDF                                   98.00 LF      1.85      181.30',
  'DRY  1/2" Drywall - hung, taped, floated, ready for paint           640.00 SF      2.14    1,369.60',
  'DRY  R&R Insulation - batts, R-13, kraft faced                       640.00 SF      1.41      902.40',
  'PNT  Paint - interior walls, two coats                              640.00 SF      0.96      614.40',
  'PNT  Paint - ceiling, two coats                                     420.00 SF      1.02      428.40',
  'FCV  Luxury Vinyl Plank - floating floor installed                  312.00 SF      4.85    1,513.20',
  'FNC  Baseboard - MDF 5-1/4", R&R                                   312.00 LF      3.95    1,232.40',
  'ELE  R&R Outlet - receptacle, ground fault                         4.00 EA      48.50      194.00',
  'ELE  R&R Switch - single pole                                     2.00 EA      42.00       84.00',
  '',
  'DWE  Kitchen',
  'DEM  Remove and dispose - cabinetry, lower 8 LF                       8.00 LF     12.50      100.00',
  'CAB  Cabinets - base, semi custom, R&R                                8.00 LF    185.00    1,480.00',
  'CTR  Countertop - laminate, fabricated and installed                 18.00 SF     42.00      756.00',
  'PLM  R&R Supply line - 1/2" PEX per LF                               24.00 LF      6.25      150.00',
  'PLM  R&R Sink - kitchen, stainless, single bowl                       1.00 EA    265.00      265.00',
  'FCV  Tile - ceramic, floor, R&R                                     110.00 SF     11.50    1,265.00',
  'DRY  1/2" Drywall - hung, taped, floated, ready for paint           180.00 SF      2.14      385.20',
  'PNT  Paint - interior walls, two coats                              180.00 SF      0.96      172.80',
  '',
  'DWE  Bedroom 2',
  'FCC  Carpet - R&R, medium grade                                     144.00 SY     18.75    2,700.00',
  'FCC  Pad - rebond 6 lb, R&R                                         144.00 SY      4.25      612.00',
  'CLN  Cleaning - construction debris sweep                           186.00 SF      0.55      102.30',
  'HAZ  Containment - plastic sheeting, 6 mil                           200.00 SF      0.95      190.00',
  '',
  'Line Item Total                                                                11,971.20',
  'Material Sales Tax 7.000%                                                         218.00',
  'Subtotal                                                                       12,189.20',
  'Overhead & Profit 10/10                                                         1,218.92',
  'Replacement Cost Value                                                          13,408.12',
  'Deductible                                                                      1,000.00',
  'Net Claim                                                                      12,408.12',
];

const fullText = ESTIMATE_LINES.join('\n');

// ---------------------------------------------------------------------------
// 1) Full fixture: summary totals, per-division recovery, line shape.
// ---------------------------------------------------------------------------
console.log('--- 1) full estimate fixture ---');
const full = mineEstimateDollars(fullText);

check('full: summary.total_rcv ≈ 13408.12', close(full.summary.total_rcv, 13408.12), f2(full.summary.total_rcv));
check('full: summary.base_subtotal ≈ 11971.20', close(full.summary.base_subtotal, 11971.2), f2(full.summary.base_subtotal));
check('full: summary.material_tax ≈ 218.00', close(full.summary.material_tax, 218), f2(full.summary.material_tax));
check('full: summary.op_total ≈ 1218.92', close(full.summary.op_total, 1218.92), f2(full.summary.op_total));
check('full: summary.overhead_and_profit ≈ 1218.92', close(full.summary.overhead_and_profit, 1218.92), f2(full.summary.overhead_and_profit));
check('full: summary.deductible ≈ 1000.00', close(full.summary.deductible, 1000), f2(full.summary.deductible));
check('full: summary.net_claim ≈ 12408.12', close(full.summary.net_claim, 12408.12), f2(full.summary.net_claim));
check('full: amount_tokens > 0', full.amount_tokens > 0, String(full.amount_tokens));
check('full: mined 25 trade lines', full.lines.length === 25, String(full.lines.length));

const div = (name: string) => full.division_totals[name];
check("full: 'Demolition & Hauling' > 9000", (div('Demolition & Hauling') || 0) > 9000, f2(div('Demolition & Hauling')));
check("full: 'Demolition & Hauling' ≈ 10440.30", close(div('Demolition & Hauling'), 10440.3), f2(div('Demolition & Hauling')));
check("full: 'Drywall & Plaster' ≈ 2657.20", close(div('Drywall & Plaster'), 2657.2), f2(div('Drywall & Plaster')));
check("full: 'Painting & Wallcovering' ≈ 1215.60", close(div('Painting & Wallcovering'), 1215.6), f2(div('Painting & Wallcovering')));
check("full: 'Flooring (Hard Surfaces)' ≈ 2778.20", close(div('Flooring (Hard Surfaces)'), 2778.2), f2(div('Flooring (Hard Surfaces)')));
check("full: 'Flooring (Carpet)' ≈ 3312.00", close(div('Flooring (Carpet)'), 3312), f2(div('Flooring (Carpet)')));
check("full: 'Finish Trim & Doors' ≈ 1232.40", close(div('Finish Trim & Doors'), 1232.4), f2(div('Finish Trim & Doors')));
check("full: 'Cabinets & Countertops' ≈ 2236.00", close(div('Cabinets & Countertops'), 2236), f2(div('Cabinets & Countertops')));
check("full: 'Electrical' ≈ 278.00", close(div('Electrical'), 278), f2(div('Electrical')));
check("full: 'Plumbing' ≈ 415.00", close(div('Plumbing'), 415), f2(div('Plumbing')));
check("full: 'Cleaning & Final Punch' ≈ 102.30", close(div('Cleaning & Final Punch'), 102.3), f2(div('Cleaning & Final Punch')));

check('full: codes_totals.WTR ≈ 9384.00', close(full.codes_totals['WTR'], 9384), f2(full.codes_totals['WTR']));
check('full: codes_totals.DRY ≈ 2657.20', close(full.codes_totals['DRY'], 2657.2), f2(full.codes_totals['DRY']));
check('full: codes_totals.FCC ≈ 3312.00', close(full.codes_totals['FCC'], 3312), f2(full.codes_totals['FCC']));

const wtrLine = full.lines.find((line) => line.code === 'WTR' && close(line.total, 8370));
check(
  'full: WTR extraction line qty/unit = 180 SY @ 46.50',
  !!wtrLine && close(wtrLine.qty, 180) && close(wtrLine.unit, 46.5),
  wtrLine ? `qty=${wtrLine.qty} unit=${wtrLine.unit}` : 'line not found'
);

// ---------------------------------------------------------------------------
// 2) Quantity-only sample (app's RAW_ESTIMATE_SNIPPET): line items carry only
//    quantities/list numbers - none of them may be mined as dollars, while the
//    $-prefixed summary rows must all be recovered.
// ---------------------------------------------------------------------------
console.log('--- 2) quantity-only sample ---');
const sampleMined = mineEstimateDollars(RAW_ESTIMATE_SNIPPET);

check('sample: no trade lines mined', sampleMined.lines.length === 0, String(sampleMined.lines.length));
check(
  'sample: codes_totals empty',
  Object.keys(sampleMined.codes_totals).length === 0,
  JSON.stringify(sampleMined.codes_totals)
);
check(
  'sample: division_totals empty',
  Object.keys(sampleMined.division_totals).length === 0,
  JSON.stringify(sampleMined.division_totals)
);
check('sample: summary.base_subtotal ≈ 44291.36', close(sampleMined.summary.base_subtotal, 44291.36), f2(sampleMined.summary.base_subtotal));
check('sample: summary.total_rcv ≈ 48720.50', close(sampleMined.summary.total_rcv, 48720.5), f2(sampleMined.summary.total_rcv));
check('sample: summary.deductible ≈ 2500.00', close(sampleMined.summary.deductible, 2500), f2(sampleMined.summary.deductible));
check('sample: summary.net_claim ≈ 46220.50', close(sampleMined.summary.net_claim, 46220.5), f2(sampleMined.summary.net_claim));
check(
  'sample: summary has exactly the 4 dollar rows',
  Object.keys(sampleMined.summary).sort().join(',') === 'base_subtotal,deductible,net_claim,total_rcv',
  JSON.stringify(sampleMined.summary)
);
check('sample: amount_tokens >= 5', sampleMined.amount_tokens >= 5, String(sampleMined.amount_tokens));

// Integration: mined output must never fabricate trade dollars from quantities.
const quantityEstimate: EstimateResult = {
  project_meta: {
    client_name: 'Quantity Only',
    claim_number: 'Q-1',
    carrier: 'Test Carrier',
    total_rcv: 0,
    net_claim: 0,
    overhead_and_profit: 0,
    base_subtotal: 0,
    material_tax: 0,
    op_total: 0,
    deductible: 0,
  },
  trade_sections: [
    {
      task_id: 'T-1',
      trade_name: 'Water Mitigation',
      category_codes_included: ['WTR'],
      billable_revenue: 0,
      suggested_duration_days: 2,
      predecessors: '',
      scope_summary: 'Extract water from carpet and pad.',
      direct_subtotal: 0,
    },
    {
      task_id: 'T-2',
      trade_name: 'Drywall Package',
      category_codes_included: ['DRY'],
      billable_revenue: 0,
      suggested_duration_days: 4,
      predecessors: 'T-1',
      scope_summary: 'Hang and finish drywall.',
      direct_subtotal: 0,
    },
  ],
  material_allowances: [],
};
const quantityResult = applyMinedBackfill(quantityEstimate, sampleMined);
check(
  'sample+backfill: trades stay at $0 (no fabrication)',
  quantityEstimate.trade_sections.every((trade) => trade.direct_subtotal === 0),
  quantityEstimate.trade_sections.map((trade) => `${trade.task_id}=${f2(trade.direct_subtotal)}`).join(', ')
);
check(
  'sample+backfill: could-not-map warning present',
  quantityResult.warnings.includes('Dollar amounts exist in the source text but could not be mapped to trade packages.')
);

// ---------------------------------------------------------------------------
// 2) Summary-only text: totals present, no line items.
// ---------------------------------------------------------------------------
console.log('--- 3) summary-only text ---');
const SUMMARY_ONLY_LINES = [
  'PROJECT SUMMARY',
  'Line Item Total: $4,321.10',
  'Material Sales Tax 7.000%   302.48',
  'Subtotal $4,623.58',
  'Overhead & Profit 10/10  462.36',
  'Replacement Cost Value $5,085.94',
  'Deductible $1,000.00',
  'Net Claim $4,085.94',
];
const summaryOnly = mineEstimateDollars(SUMMARY_ONLY_LINES.join('\n'));
check('summary-only: no trade lines mined', summaryOnly.lines.length === 0, String(summaryOnly.lines.length));
check('summary-only: total_rcv ≈ 5085.94', close(summaryOnly.summary.total_rcv, 5085.94), f2(summaryOnly.summary.total_rcv));
check('summary-only: base_subtotal ≈ 4321.10', close(summaryOnly.summary.base_subtotal, 4321.1), f2(summaryOnly.summary.base_subtotal));
check('summary-only: material_tax ≈ 302.48', close(summaryOnly.summary.material_tax, 302.48), f2(summaryOnly.summary.material_tax));
check('summary-only: op_total ≈ 462.36', close(summaryOnly.summary.op_total, 462.36), f2(summaryOnly.summary.op_total));
check('summary-only: amount_tokens > 0', summaryOnly.amount_tokens > 0, String(summaryOnly.amount_tokens));

// ---------------------------------------------------------------------------
// 3) No-money text: no tokens, empty summary, no crash.
// ---------------------------------------------------------------------------
console.log('--- 4) no-money text ---');
const noMoney = mineEstimateDollars('hello world 2026, 7.000% tax');
check('no-money: amount_tokens === 0', noMoney.amount_tokens === 0, String(noMoney.amount_tokens));
check(
  'no-money: summary fields all undefined',
  Object.values(noMoney.summary).every((value) => value === undefined),
  JSON.stringify(noMoney.summary)
);
check('no-money: no lines', noMoney.lines.length === 0, String(noMoney.lines.length));
const emptyMined = mineEstimateDollars('');
check('empty text: no throw, zero tokens, no lines', emptyMined.amount_tokens === 0 && emptyMined.lines.length === 0);

// ---------------------------------------------------------------------------
// 4) applyMinedBackfill: zeroed estimate recovers real dollars + warnings.
// ---------------------------------------------------------------------------
console.log('--- 5) applyMinedBackfill ---');
const baseEstimate = (): EstimateResult => ({
  project_meta: {
    client_name: 'Zero Co',
    claim_number: 'Z-1',
    carrier: 'Test Carrier',
    total_rcv: 0,
    net_claim: 0,
    overhead_and_profit: 0,
    base_subtotal: 0,
    material_tax: 0,
    op_total: 0,
    deductible: 0,
  },
  trade_sections: [
    {
      task_id: 'T-1',
      trade_name: 'Drywall Package',
      category_codes_included: ['DRY'],
      billable_revenue: 0,
      suggested_duration_days: 4,
      predecessors: '',
      scope_summary: 'Hang and finish drywall.',
      direct_subtotal: 0,
    },
    {
      task_id: 'T-2',
      trade_name: 'Paint Package',
      category_codes_included: ['PNT'],
      billable_revenue: 0,
      suggested_duration_days: 3,
      predecessors: 'T-1',
      scope_summary: 'Paint walls and ceilings.',
      direct_subtotal: 0,
    },
  ],
  material_allowances: [],
});

const unitEstimate = baseEstimate();
const unitResult = applyMinedBackfill(unitEstimate, full);
check(
  'backfill: T-1 subtotal ≈ 2657.20 (code match)',
  close(unitEstimate.trade_sections[0].direct_subtotal, 2657.2),
  f2(unitEstimate.trade_sections[0].direct_subtotal)
);
check(
  'backfill: T-2 subtotal ≈ 1215.60 (code match)',
  close(unitEstimate.trade_sections[1].direct_subtotal, 1215.6),
  f2(unitEstimate.trade_sections[1].direct_subtotal)
);
check('backfill: meta.total_rcv ≈ 13408.12', close(unitEstimate.project_meta.total_rcv, 13408.12), f2(unitEstimate.project_meta.total_rcv));
check('backfill: meta.base_subtotal ≈ 11971.20', close(unitEstimate.project_meta.base_subtotal, 11971.2), f2(unitEstimate.project_meta.base_subtotal));
check('backfill: meta.material_tax ≈ 218.00', close(unitEstimate.project_meta.material_tax, 218), f2(unitEstimate.project_meta.material_tax));
check('backfill: meta.op_total ≈ 1218.92', close(unitEstimate.project_meta.op_total, 1218.92), f2(unitEstimate.project_meta.op_total));
check('backfill: meta.deductible ≈ 1000.00', close(unitEstimate.project_meta.deductible, 1000), f2(unitEstimate.project_meta.deductible));
check('backfill: meta.net_claim ≈ 12408.12', close(unitEstimate.project_meta.net_claim, 12408.12), f2(unitEstimate.project_meta.net_claim));
check('backfill: filled count > 0', unitResult.filled > 0, String(unitResult.filled));
check(
  'backfill: trade warning present',
  unitResult.warnings.some((w) => w.startsWith('T-1: recovered $2657.20') && w.includes('model returned no subtotal'))
);
check(
  'backfill: summary warning present',
  unitResult.warnings.some((w) => w === 'Recovered estimate summary totals from raw text (model returned partial/zero values).')
);
check('backfill: no could-not-map warning when trades were filled', !unitResult.warnings.some((w) => w.includes('could not be mapped')));

// Division fallback (no codes -> matchDivision by trade_name).
const divisionEstimate = baseEstimate();
divisionEstimate.trade_sections = [
  {
    task_id: 'T-1',
    trade_name: 'Drywall repairs and texture',
    category_codes_included: [],
    billable_revenue: 0,
    suggested_duration_days: 4,
    predecessors: '',
    scope_summary: '',
    direct_subtotal: 0,
  },
];
applyMinedBackfill(divisionEstimate, full);
check(
  'backfill: division fallback assigns 2657.20',
  close(divisionEstimate.trade_sections[0].direct_subtotal, 2657.2),
  f2(divisionEstimate.trade_sections[0].direct_subtotal)
);

// Positive model values are never overwritten.
const keepEstimate = baseEstimate();
keepEstimate.trade_sections[0].direct_subtotal = 999;
applyMinedBackfill(keepEstimate, full);
check('backfill: positive model value kept (T-1 stays 999)', keepEstimate.trade_sections[0].direct_subtotal === 999);

// Empty-trades rescue: synthesized packages from mined divisions.
const rescueEstimate = baseEstimate();
rescueEstimate.trade_sections = [];
const rescueResult = applyMinedBackfill(rescueEstimate, full);
check('rescue: 10 packages rebuilt from mined divisions', rescueEstimate.trade_sections.length === 10, String(rescueEstimate.trade_sections.length));
const rescueSum = rescueEstimate.trade_sections.reduce((sum, trade) => sum + (trade.direct_subtotal || 0), 0);
check('rescue: Σ subtotal ≈ 24667.00', close(rescueSum, 24667.0), f2(rescueSum));
check(
  'rescue: warning present',
  rescueResult.warnings.includes('Rebuilt 10 trade packages from raw line items (model returned none).')
);

// Zero-visibility warnings.
const emptyResult = applyMinedBackfill(baseEstimate(), mineEstimateDollars(''));
check(
  'backfill: zero-token warning on empty text',
  emptyResult.warnings.includes('No dollar amounts were found in the source text - the budget cannot be populated from this file.')
);
const unmatched = mineEstimateDollars('miscellaneous fee $1,234.56');
const unmatchedEstimate = baseEstimate();
const unmatchedResult = applyMinedBackfill(unmatchedEstimate, unmatched);
check('unmapped fixture: tokens > 0 but no divisions', unmatched.amount_tokens > 0 && Object.keys(unmatched.division_totals).length === 0);
check(
  'backfill: could-not-map warning present',
  unmatchedResult.warnings.includes('Dollar amounts exist in the source text but could not be mapped to trade packages.')
);

// ---------------------------------------------------------------------------
// Optional live e2e: real DeepSeek call through processEstimate.
// ---------------------------------------------------------------------------
console.log('--- 6) live e2e (optional) ---');
if (!process.argv.includes('--live')) {
  console.log('SKIP  live e2e (run with --live and DEEPSEEK_API_KEY to enable)');
} else {
  const dotenv = (await import('dotenv')).default;
  dotenv.config({ path: ['.env.local', '.env'] });
  if (!process.env.DEEPSEEK_API_KEY) {
    console.log('SKIP  live e2e (DEEPSEEK_API_KEY not set)');
  } else {
    const { processEstimate } = await import('../xactEngine.ts');
    console.log('live: calling processEstimate … (may take 30-90s)');
    const startedAt = Date.now();
    const result = await processEstimate(fullText);
    console.log(`live: completed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    for (const warning of result.processing?.warnings || []) {
      console.log(`live: warning: ${warning}`);
    }
    check(
      'live: budget_audit.carrier_total_rcv ≈ 13408.12',
      close(result.budget_audit?.carrier_total_rcv, 13408.12),
      f2(result.budget_audit?.carrier_total_rcv)
    );
    const negativeTrades = result.trade_sections.filter(
      (trade) => !(typeof trade.billable_revenue === 'number' && trade.billable_revenue >= 0)
    );
    check(
      'live: every trade billable_revenue >= 0',
      negativeTrades.length === 0,
      negativeTrades.map((trade) => trade.task_id).join(', ')
    );
    check(
      'live: at least one trade billable_revenue > 0',
      result.trade_sections.some((trade) => trade.billable_revenue > 0),
      String(result.trade_sections.length) + ' trades'
    );
    for (const trade of result.trade_sections) {
      console.log(
        `live: ${trade.task_id} ${trade.trade_name} rcv=${f2(trade.billable_revenue)} sub=${f2(trade.direct_subtotal)}`
      );
    }
  }
}

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll miner checks passed.');
