// Offline verification of the Customer Selections & Material Allowance Sheet:
// deterministic classifier, totals math, budget-engine field preservation,
// branded PDF rendering and the customer-facing money policy — every dollar
// token on the sheet must be an allow-listed allowance figure, and no carrier
// RCV / O&P / margin language or Xactimate category codes may appear.
// Run: npx tsx scripts/verify-customer-selections.ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PDFDocument } from 'pdf-lib';
import { SAMPLE_ESTIMATES } from '../src/services/sampleEstimates.ts';
import { applyBudgetEngine } from '../src/utils/budgetEngine.ts';
import { formatMoney } from '../src/utils/workOrders.ts';
import {
  buildCustomerSelections,
  classifySelectionCategory,
  computeCustomerSelectionsChecksum,
  computeSelectionTotals,
  customerSelectionsPdfFilename,
  groupSelectionsByCategory,
} from '../src/utils/customerSelections.ts';
import { buildCustomerSelectionsPdf } from '../src/utils/customerSelectionsPdf.ts';
import { extractPdfText } from '../pdfText.ts';
import { ESTIMATE_RESPONSE_SCHEMA, normalizeEstimate, processEstimate } from '../xactEngine.ts';
import { runProcessEstimate } from '../serverRoutines.ts';
import { findCustomerSelectionCoverageGaps } from '../src/utils/customerSelectionCoverage.ts';
import { recoverCustomerSelectionPrices } from '../customerSelectionPricing.ts';
import type { CustomerSelectionInput, EstimateResult, MaterialAllowanceItem } from '../src/types/estimate.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
};

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

// Category selectors that must never appear on a customer-facing document.
const CODE_LEAK_SOURCE =
  '\\b(DMO|PNT|WTR|DRY|FCT|FNH|FCC|RFG|SDG|ELE|PLM|HVC|CLN|INS|CAB|FNC|DOR|FRM|FCV|WDN)\\b';
const CODE_LEAK_RX_G = new RegExp(CODE_LEAK_SOURCE, 'g');
const FORBIDDEN_RX = /\b(RCV|Replacement\s?Cost|Overhead|Profit|margin|net\s?claim)\b/i;

/** Dollar tokens exactly as formatMoney renders them: "$1,040.00". */
const moneyTokens = (text: string): string[] => text.match(/\$[\d,]+\.\d{2}/g) || [];

const groupTotal = (items: { allowance_total: number }[]): number =>
  round2(items.reduce((sum, item) => sum + (Number.isFinite(item.allowance_total) ? item.allowance_total : 0), 0));

/** Counts text runs whose bounding boxes overlap by more than 6pt on a page. */
async function textOverlapPairs(bytes: Uint8Array): Promise<number> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: bytes, useSystemFonts: true }).promise;
  let total = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: Array<{ x: number; y: number; w: number; h: number }> = [];
    for (const raw of content.items as Array<{
      str?: string;
      transform?: number[];
      width?: number;
      height?: number;
    }>) {
      const str = (raw.str || '').trim();
      if (!str || !raw.transform) continue;
      const t = raw.transform;
      items.push({ x: t[4], y: t[5], w: raw.width || 0, h: raw.height || 8 });
    }
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (overlapX > 6 && overlapY > 6) total++;
      }
    }
  }
  return total;
}

async function main() {
  const artifactDir = mkdtempSync(join(tmpdir(), 'customer-selections-verify-'));
  // 1) Deterministic classifier checks against a fixed fixture set.
  const fixtures: MaterialAllowanceItem[] = [
    { trade: 'Flooring', description: 'Luxury Vinyl Plank (LVP)', qty: 100, uom: 'SF', unit_cost: 3.25, extended_cost: 325 },
    { trade: 'Cabinets & Countertops', description: 'Granite countertop', qty: 40, uom: 'SF', unit_cost: 55, extended_cost: 2200 },
    { trade: 'Painting & Wallcovering', description: 'Interior latex paint', qty: 10, uom: 'GL', unit_cost: 42, extended_cost: 420 },
    { trade: 'Demolition & Water Mitigation', description: '6 mil poly sheeting', qty: 4, uom: 'ROLL', unit_cost: 38, extended_cost: 152 },
    { trade: 'Drywall & Wall Prep', description: '1/2" gypsum board', qty: 50, uom: 'SH', unit_cost: 14, extended_cost: 700 },
    { trade: 'Rough Mechanicals (MEP)', description: 'Kitchen faucet', qty: 1, uom: 'EA', unit_cost: 165, extended_cost: 165 },
  ];
  const derived = buildCustomerSelections(fixtures);
  check('classifier: derived all 4 finish rows including the faucet', derived.length === 4, `${derived.length} row(s)`);
  check('classifier: flooring category', derived[0]?.category === 'Flooring', derived[0]?.category);
  check('classifier: cabinets category', derived[1]?.category === 'Cabinets & Countertops', derived[1]?.category);
  check('classifier: paint category', derived[2]?.category === 'Paint & Finishes', derived[2]?.category);
  check(
    'classifier: sequential ids',
    derived.map((d) => d.id).join(',') === 'SEL-1,SEL-2,SEL-3,SEL-4',
    derived.map((d) => d.id).join(',')
  );
  check(
    'classifier: unit passthrough + totals',
    derived[0]?.allowance_per_unit === 3.25 && derived[0]?.allowance_total === 325,
    `${derived[0]?.allowance_per_unit}/${derived[0]?.allowance_total}`
  );
  check(
    'classifier: idempotent',
    JSON.stringify(buildCustomerSelections(fixtures)) === JSON.stringify(derived)
  );
  check('classifier: demo/cleaning excluded', classifySelectionCategory('Demolition & Water Mitigation', '6 mil poly sheeting') === undefined);
  check('classifier: drywall excluded', classifySelectionCategory('Drywall & Wall Prep', '1/2" gypsum board') === undefined);
  check('classifier: MEP finish fixture retained', classifySelectionCategory('Rough Mechanicals (MEP)', 'Kitchen faucet') === 'Plumbing Fixtures');
  const categoryCases: Array<[string, string, string | undefined]> = [
    ['Flooring (Hard Surfaces)', 'Porcelain tile', 'Tile'],
    ['Cabinets & Countertops', 'Cabinet pulls', 'Hardware'],
    ['Cabinets & Countertops', 'Kitchen sink', 'Plumbing Fixtures'],
    ['Flooring', 'Laminate countertop', 'Cabinets & Countertops'],
    ['Cabinets & Countertops', 'Cabinet doors', 'Cabinets & Countertops'],
    ['Cleaning & Final Punch', 'Dishwasher', 'Appliances'],
    ['Flooring (Carpet)', 'Carpet', 'Flooring'],
    ['Electrical', 'Pendant lighting', 'Lighting & Electrical'],
    ['Siding & Exterior', 'Vinyl siding', 'Windows & Exterior'],
    ['Roofing & Gutters', 'Architectural shingle', 'Windows & Exterior'],
    ['Finish Trim & Doors', 'Interior door', 'Trim & Doors'],
    ['', 'Bathroom faucet', 'Plumbing Fixtures'],
    ['Flooring', 'Underlayment', undefined],
    ['Flooring', 'Floor adhesive', undefined],
    ['Painting', 'Primer', undefined],
    ['Flooring', 'Remove carpet', undefined],
    ['Plumbing', 'Detach and reset toilet', undefined],
    ['Cabinets', 'Cabinet install labor', undefined],
  ];
  for (const [trade, description, category] of categoryCases) {
    check(`classifier: ${description}`, classifySelectionCategory(trade, description) === category);
  }

  const source: CustomerSelectionInput[] = [
    { trade: 'Flooring', description: 'Luxury Vinyl Plank (LVP)', qty: 40, uom: 'SF', allowance_per_unit: null, notes: 'Kitchen - choose finish' },
    { trade: 'Flooring', description: 'Luxury Vinyl Plank (LVP)', qty: 60, uom: 'SF', allowance_per_unit: null, notes: 'Hall - choose finish' },
    { trade: 'Plumbing', description: 'Bathroom faucet', qty: 1, uom: 'EA', allowance_per_unit: null },
    { trade: 'Flooring (Carpet)', description: 'Bedroom carpet', qty: 200, uom: 'SF', allowance_per_unit: 2.25 },
  ];
  const combined = buildCustomerSelections([fixtures[0]], [...source, source[2]]);
  check('grouping: duplicate extraction and source/procurement overlap counted once', combined.length === 3);
  check('grouping: quantities combined without procurement waste', combined[0].qty === 100 && combined[0].allowance_total === 325);
  check('grouping: both room notes retained', Boolean(combined[0].notes?.includes('Kitchen') && combined[0].notes?.includes('Hall')));
  check('pricing: audited rate recovers unpriced source product', combined[0].allowance_per_unit === 3.25 && combined[0].allowance_status === 'confirmed');
  check('pricing: unknown faucet price requires review', combined[1].allowance_status === 'needs_review');
  check('coverage: turnkey carpet retained', combined[2].category === 'Flooring' && combined[2].qty === 200);
  check('totals: unknown pricing excluded', computeSelectionTotals(combined).subtotal === 775);
  check('grouping: differing finishes/rates remain separate', buildCustomerSelections([
    { ...fixtures[0], description: 'Oak flooring - natural', qty: 10 },
    { ...fixtures[0], description: 'Oak flooring - stained', qty: 10 },
    { ...fixtures[0], description: 'Oak flooring - natural', qty: 10, unit_cost: 4 },
  ]).length === 3);
  check('grouping: fractional and decimal specifications remain distinct', buildCustomerSelections([
    { ...fixtures[0], description: '1/2 inch hardwood' },
    { ...fixtures[0], description: '1.2 inch hardwood' },
  ]).length === 2);
  const distinctProducts = buildCustomerSelections([
    { ...fixtures[0], description: 'Porcelain tile - white', component_code: 'FCT TILE' },
    { ...fixtures[0], description: 'Porcelain tile - black', component_code: 'FCT TILE' },
  ], [{ trade: 'Flooring', description: 'Porcelain tile - white', component_code: 'FCT TILE', qty: 100, uom: 'SF', allowance_per_unit: 3.25 }]);
  check('grouping: shared component code cannot hide a different finish', distinctProducts.length === 2);
  const aliases = buildCustomerSelections([fixtures[0]], [{ ...source[0], description: 'LVP', uom: 'sq. ft.' }]);
  check('grouping: product and unit aliases match audited rows once', aliases.length === 1 && aliases[0].allowance_per_unit === 3.25 && aliases[0].uom === 'SF');
  const uncertain = buildCustomerSelections([
    fixtures[0], { ...fixtures[0], unit_cost: 4 },
  ], [source[0]]);
  check('pricing: conflicting audited rates require review', uncertain[0].allowance_status === 'needs_review');
  check('pricing: explicit source allowance survives budget scaling and conflicting procurement rates', buildCustomerSelections([
    fixtures[0], { ...fixtures[0], unit_cost: 4 },
  ], [{ ...source[0], allowance_per_unit: 2.75 }])[0].allowance_per_unit === 2.75);
  check('classifier: invalid negative and nonfinite rates discarded', buildCustomerSelections([
    { ...fixtures[0], unit_cost: -1 }, { ...fixtures[0], unit_cost: NaN }, { ...fixtures[0], qty: Infinity },
  ]).length === 0);
  check('grouping: category spelling normalized', groupSelectionsByCategory([
    { ...combined[0], category: ' flooring ' }, { ...combined[2], category: 'FLOORING' },
  ]).length === 1);

  const rawEstimate = {
    project_meta: { client_name: 'Selection Test', claim_number: 'SEL-TEST', total_rcv: 2000 },
    trade_sections: [
      { task_id: 'T-1', trade_name: 'Flooring', category_codes_included: ['FCV'], direct_subtotal: 1000, suggested_duration_days: 2, predecessors: '', scope_summary: 'Install flooring.' },
      { task_id: 'T-2', trade_name: 'Plumbing', category_codes_included: ['PLM'], direct_subtotal: 1000, suggested_duration_days: 2, predecessors: '', scope_summary: 'Install faucet.' },
    ],
    customer_selections: source,
    material_allowances: [fixtures[0], { trade: 'Plumbing', description: 'Bathroom faucet', qty: 1, uom: 'EA', unit_cost: 100 }],
  };
  const normalized = normalizeEstimate(rawEstimate);
  check('normalization: independent source survives', normalized.estimate.customer_selection_source?.length === 4);
  check('schema: customer selection extraction required', ESTIMATE_RESPONSE_SCHEMA.required.includes('customer_selections'));
  const many = normalizeEstimate({ ...rawEstimate, material_allowances: Array.from({ length: 240 }, (_, i) => ({ ...fixtures[0], description: `LVP finish ${i}` })) });
  check('normalization: no silent 200-row cutoff', many.estimate.material_allowances?.length === 240);
  const unknown = normalizeEstimate({ ...rawEstimate, customer_selections: [{ ...source[2], allowance_per_unit: 'unknown' }] });
  check('normalization: malformed price stays unknown', unknown.estimate.customer_selection_source?.[0].allowance_per_unit === null);
  check('normalization: extended material amount divided by exact quantity', normalizeEstimate({
    ...rawEstimate, customer_selections: [{ ...source[0], material_total: '$130.00' }],
  }).estimate.customer_selection_source?.[0].allowance_per_unit === 3.25);
  check('normalization: missing procurement price cannot become a free material', normalizeEstimate({
    ...rawEstimate, material_allowances: [{ ...fixtures[0], unit_cost: 'unknown' }],
  }).estimate.material_allowances?.length === 0);

  // Exercise the real server pipeline with the external model response stubbed.
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  let prompt = '';
  process.env.DEEPSEEK_API_KEY = 'offline-verification';
  globalThis.fetch = async (_url, init) => {
    prompt = String(init?.body || '');
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(rawEstimate) }, finish_reason: 'stop' }] }), { status: 200 });
  };
  let pipeline: EstimateResult;
  let unresolved: EstimateResult;
  try {
    pipeline = await processEstimate('FCV Flooring 1000.00\nPLM Faucet 1000.00\nTotal RCV 2000.00');
    const oversized = await runProcessEstimate({ textContent: 'x'.repeat(250001) });
    check('source: oversized documents rejected rather than silently clipped', oversized.status === 413);
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [{
        message: { content: JSON.stringify(calls === 1 ? { ...rawEstimate, customer_selections: [source[0]] } : rawEstimate) },
        finish_reason: calls === 1 ? 'length' : 'stop',
      }] }), { status: 200 });
    };
    const retried = await processEstimate('FCV Flooring 1000.00\nPLM Faucet 1000.00\nTotal RCV 2000.00');
    check('AI: truncated valid JSON retried to recover remaining selections', calls === 2 && retried.customer_selections?.length === 3);
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...rawEstimate, customer_selections: undefined }) }, finish_reason: 'stop' }] }), { status: 200 });
    let missingListRejected = false;
    try { await processEstimate('FCV Flooring 1000.00'); } catch { missingListRejected = true; }
    check('AI: omitted selection list cannot be reported as complete', missingListRejected);
    check('coverage: detects an omitted appliance from the source', findCustomerSelectionCoverageGaps('APP Dishwasher 1 EA, material-only $400.00/EA.', source).includes('dishwasher'));
    check('coverage: removal-only and credits do not trigger missing choices', findCustomerSelectionCoverageGaps('APP Remove dishwasher ONLY 1 EA\nPLM Credited toilet 1 EA', source).length === 0);
    let coverageCalls = 0;
    globalThis.fetch = async () => {
      coverageCalls++;
      const content = coverageCalls === 1 ? rawEstimate : { customer_selections: [
        ...source, { trade: 'Appliances', description: 'Dishwasher', qty: 1, uom: 'EA', allowance_per_unit: 400 },
      ] };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] }), { status: 200 });
    };
    const recovered = await processEstimate('APP Dishwasher 1 EA, material-only $400.00/EA.');
    check('coverage: focused review recovers omitted products without duplicates', coverageCalls === 2 && recovered.customer_selections?.length === 4 && recovered.customer_selections.some((item) => item.description === 'Dishwasher'));
    let pricingCalls = 0;
    const priceSource = 'Component report\nDescription | Qty | Unit | Material Total | Labor\nBathroom faucet | 2 | EA | 330.00 | 80.00\nBedroom carpet | 20 | SY | 405.00 | 100.00\nPendant lighting | 1 | EA | 92.00 | 25.00';
    const priceSelections = [
      { ...source[2], qty: 2 },
      { ...source[3], qty: 180, allowance_per_unit: null },
      { trade: 'Electrical', description: 'Pendant lighting', qty: 1, uom: 'EA', allowance_per_unit: null },
    ];
    globalThis.fetch = async () => {
      pricingCalls++;
      const content = pricingCalls === 1 ? { ...rawEstimate, material_allowances: [], customer_selections: priceSelections } : { prices: [
        { selection_index: 0, material_total: 330, material_quantity: 2, material_uom: 'EA', evidence: priceSource },
        { selection_index: 1, material_total: 405, material_quantity: 20, material_uom: 'SY', evidence: priceSource },
        { selection_index: 2, material_unit_cost: 92, material_uom: 'EA', evidence: priceSource },
      ] };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] }), { status: 200 });
    };
    const priced = await processEstimate(priceSource);
    check('pricing pipeline: second pass recovers all three missing material amounts', pricingCalls === 2 && Boolean(priced.customer_selections?.every((item) => item.allowance_status === 'confirmed')));
    check('pricing pipeline: material total excludes separately listed labor', priced.customer_selections?.[0].allowance_per_unit === 165);
    check('pricing pipeline: square-yard price converted to square feet', priced.customer_selections?.[1].allowance_per_unit === 2.25 && priced.customer_selections[1].allowance_total === 405);
    check('pricing pipeline: recovered allowances persist when rebuilding', JSON.stringify(buildCustomerSelections(priced.material_allowances, priced.customer_selection_source)) === JSON.stringify(priced.customer_selections));
    check('pricing pipeline: customer PDF can be generated after automatic recovery', (await buildCustomerSelectionsPdf(priced)).length > 5000);
    let unresolvedCalls = 0;
    globalThis.fetch = async () => {
      unresolvedCalls++;
      const content = unresolvedCalls === 1 ? { ...rawEstimate, material_allowances: [], customer_selections: [source[2]] } : { prices: [
        { selection_index: 0, material_unit_cost: 165, material_uom: 'EA', evidence: 'Invented material price 165.00' },
        { selection_index: 0, material_unit_cost: 1000, material_uom: 'EA', evidence: 'PLM Faucet material 999.00' },
        { selection_index: 9, material_unit_cost: 999, material_uom: 'EA', evidence: 'PLM Faucet material 999.00' },
      ] };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] }), { status: 200 });
    };
    unresolved = await processEstimate('PLM Faucet material 999.00');
    check('pricing pipeline: fabricated excerpts, unsupported amounts and invalid indices rejected', unresolvedCalls === 2 && unresolved.customer_selections?.[0].allowance_status === 'needs_review');
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'Authentication Fails: invalid API key.' } }), { status: 401 });
    const originalError = console.error;
    console.error = () => {};
    let authentication;
    try { authentication = await runProcessEstimate({ textContent: 'FCV Flooring 1000.00' }); }
    finally { console.error = originalError; }
    check('API: invalid provider key returns an actionable error', authentication.status === 502 && JSON.stringify(authentication.body).includes('Update DEEPSEEK_API_KEY'));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
  check('AI prompt: every room, turnkey choices, no row limit', prompt.includes('EVERY room') && prompt.includes('turnkey') && prompt.includes('Do not impose a row limit'));
  check('pipeline: source choices survive budget turnkey filtering', pipeline.customer_selections?.length === 3 && pipeline.material_allowances?.length === 1);
  check('pipeline: turnkey price preserved before procurement filtering', pipeline.customer_selections?.find((item) => /faucet/i.test(item.description))?.allowance_per_unit === 100);
  check('pipeline: missing price produces named source-review warning', Boolean(unresolved.processing?.warnings?.some((warning) => warning.includes('Bathroom faucet'))));
  check('rebuild: all originally extracted choices preserved', JSON.stringify(buildCustomerSelections(pipeline.material_allowances, pipeline.customer_selection_source)) === JSON.stringify(pipeline.customer_selections));
  let refused = false;
  try { await buildCustomerSelectionsPdf(unresolved); } catch { refused = true; }
  check('PDF: unconfirmed pricing cannot be issued', refused);

  if (process.argv.includes('--live-pricing')) {
    const { default: dotenv } = await import('dotenv');
    dotenv.config({ path: ['env/.env.local', 'env/.env', '.env.local', '.env'], quiet: true });
    let pricingResponse = '';
    globalThis.fetch = async (...args) => {
      const response = await originalFetch(...args);
      pricingResponse = await response.clone().text();
      return response;
    };
    const result = await recoverCustomerSelectionPrices(`Component breakdown report (pre-tax)
Description | Actual Cost Qty | Unit | Material Total | Labor Total
Bathroom faucet | 2 | EA | 330.00 | 80.00
Bedroom carpet | 20 | SY | 405.00 | 100.00
Pendant lighting | 2 | EA | 184.00 | 50.00

Estimate line without component breakdown:
Interior door slab | 1 EA | combined supply/install UNIT PRICE 260.00 | TOTAL 260.00`, [
      { ...source[2], qty: 2 },
      { ...source[3], qty: 180, allowance_per_unit: null },
      { trade: 'Electrical', description: 'Pendant lighting', qty: 2, uom: 'EA', allowance_per_unit: null },
      { trade: 'Finish Trim & Doors', description: 'Interior door slab', qty: 1, uom: 'EA', allowance_per_unit: null },
    ]);
    globalThis.fetch = originalFetch;
    if (result.recovered !== 3) console.log('Synthetic pricing diagnostics:', JSON.stringify({ result, response: pricingResponse }));
    check('live pricing: faucet material total recovered as 165/EA', result.selections[0].allowance_per_unit === 165);
    check('live pricing: carpet component SY converted to 2.25/SF', result.selections[1].allowance_per_unit === 2.25);
    check('live pricing: pendant material total recovered as 92/EA', result.selections[2].allowance_per_unit === 92);
    check('live pricing: combined supply/install price stays unknown', result.selections[3].allowance_per_unit === null);
    check('live pricing: all three supported missing amounts recovered', result.recovered === 3);
  }
  if (process.argv.includes('--live')) {
    const { default: dotenv } = await import('dotenv');
    dotenv.config({ path: ['env/.env.local', 'env/.env', '.env.local', '.env'], quiet: true });
    const live = await processEstimate(`Xactimate selection verification fixture
Insured: Selection Verification. Claim SEL-LIVE. Carrier: Test Carrier.
All prices below are material-only pre-tax allowances; labor is separately provided.
Kitchen:
1. FCV Luxury vinyl plank flooring, natural oak finish: 40 SF, material-only $3.25/SF.
2. FCT Porcelain floor tile, matte: 20 SF, material-only $4.00/SF.
3. CAB Base cabinets, shaker: 8 LF, material-only $150.00/LF.
4. CTR Granite countertop: 12 SF, material-only $55.00/SF.
5. PLM Kitchen faucet: 1 EA, material-only $165.00/EA.
6. CAB Cabinet pulls, brushed nickel: 10 EA, material-only $8.00/EA.
7. ELE Pendant lighting: 2 EA, material-only $80.00/EA.
8. APP Dishwasher: 1 EA, material-only $400.00/EA.
Hall:
9. FCV Luxury vinyl plank flooring, natural oak finish: 60 SF, material-only $3.25/SF.
10. DOR Interior door slab: 1 EA, material-only $90.00/EA.
Bedroom:
11. FCC Bedroom carpet, plush: 200 SF, material-only $2.25/SF (turnkey subcontract).
12. PNT Interior latex paint: 3 GL, material-only $42.00/GL. Customer chooses color.
Exterior:
13. SDG Vinyl siding, lap: 100 SF, material-only $3.00/SF (turnkey subcontract).
Excluded construction supplies and nonreplacement work:
14. DRY Gypsum board: 10 SH at $14.00/SH.
15. FCV Underlayment: 100 SF at $0.50/SF.
16. FCC Remove carpet ONLY: 100 SF labor $0.80/SF; no replacement carpet here.
Line Item Total 6244.00
Total RCV 6244.00`);
    const selected = live.customer_selections || [];
    if (selected.length !== 12) console.log('Synthetic fixture diagnostics:', JSON.stringify({
      choices: selected.map((item) => ({ description: item.description, trade: item.trade, category: item.category })),
      warnings: live.processing?.warnings,
    }));
    const expected: Array<[RegExp, string]> = [
      [/vinyl.*plank|lvp/i, 'Flooring'], [/porcelain.*tile/i, 'Tile'],
      [/cabinet(?!.*pull)/i, 'Cabinets & Countertops'], [/granite|countertop/i, 'Cabinets & Countertops'],
      [/faucet/i, 'Plumbing Fixtures'], [/pull|hardware/i, 'Hardware'],
      [/pendant|lighting/i, 'Lighting & Electrical'], [/dishwasher/i, 'Appliances'],
      [/door/i, 'Trim & Doors'], [/carpet/i, 'Flooring'],
      [/paint/i, 'Paint & Finishes'], [/siding/i, 'Windows & Exterior'],
    ];
    for (const [rx, category] of expected) check(`live AI: ${category} ${rx.source}`, selected.some((item) => rx.test(item.description) && item.category === category));
    check('live AI: all 12 distinct customer products found', selected.length === 12, `${selected.length} products`);
    const planks = selected.filter((item) => /vinyl.*plank|lvp/i.test(item.description));
    check('live AI: two rooms combined to 100 SF without waste', planks.length === 1 && planks[0].qty === 100, JSON.stringify(planks.map((item) => ({ qty: item.qty, description: item.description }))));
    check('live AI: no supplies or removal-only work', selected.every((item) => !/gypsum|underlayment|remove/i.test(item.description)));
    check('live AI: explicit material-only rates confirmed', selected.every((item) => item.allowance_status === 'confirmed'));
  }

  const longDescription = 'Porcelain tile ' + Array.from({ length: 85 }, (_, i) => `finishword${i}`).join(' ') + ' DESCRIPTION-END';
  const longNotes = Array.from({ length: 180 }, (_, i) => `Room${i} choose color.`).join(' ') + ' NOTES-END';
  const stressItems = Array.from({ length: 38 }, (_, i) => ({
    ...combined[0], id: `STRESS-${i}`, category: 'Tile',
    description: i === 0 ? longDescription : `Porcelain tile finish ${i}`,
    notes: i === 0 ? longNotes : `Room ${i} - choose color`,
  }));
  const stressBytes = await buildCustomerSelectionsPdf({ ...pipeline, customer_selections: stressItems });
  writeFileSync(join(artifactDir, 'out-selections-complete.pdf'), stressBytes);
  const stressText = normalize(await extractPdfText(Buffer.from(stressBytes).toString('base64')));
  check('PDF: full descriptions and room notes retained', stressText.includes('DESCRIPTION-END') && stressText.includes('NOTES-END'));
  check('PDF: all choices across pages retained', stressItems.slice(1).every((item) => stressText.includes(item.description)));
  check('PDF: repeated category and table headers', stressText.includes('Tile (continued)'));
  check('PDF: multipage long descriptions have no text overlaps', await textOverlapPairs(Uint8Array.from(stressBytes)) === 0);

  // 2) Sample-by-sample: engine preservation, totals math, PDF policy.
  for (const key of Object.keys(SAMPLE_ESTIMATES)) {
    const sample = SAMPLE_ESTIMATES[key];
    const estimate: EstimateResult = applyBudgetEngine(
      JSON.parse(JSON.stringify(sample)) as EstimateResult
    );
    const items = estimate.customer_selections || [];
    const preserved =
      JSON.stringify(items) === JSON.stringify(sample.customer_selections || []);
    check(`${key}: budget engine rerun preserves customer_selections`, preserved);

    if (items.length === 0) {
      let threw = false;
      try {
        await buildCustomerSelectionsPdf(estimate, { generatedAt: '2026-09-30' });
      } catch {
        threw = true;
      }
      check(`${key}: empty selection set -> build throws`, threw);
      continue;
    }

    let mathOk = true;
    for (const item of items) {
      if (round2(item.qty * item.allowance_per_unit) !== round2(item.allowance_total)) {
        mathOk = false;
      }
    }
    check(`${key}: qty x allowance_per_unit == allowance_total`, mathOk);

    const totals = computeSelectionTotals(items);
    const sum = groupTotal(items);
    check(`${key}: subtotal == Σ allowance_total`, round2(totals.subtotal) === sum, `${round2(totals.subtotal)} vs ${sum}`);
    check(`${key}: tax == 7.00% of subtotal`, round2(totals.tax) === round2(sum * 0.07), `${totals.tax}`);
    check(`${key}: total == subtotal + tax`, round2(totals.total) === round2(totals.subtotal + totals.tax), `${totals.total}`);

    const groups = groupSelectionsByCategory(items);
    check(
      `${key}: groups cover all items`,
      groups.reduce((a, g) => a + g.items.length, 0) === items.length
    );
    check(`${key}: checksum format`, /^SEL-CHK-[0-9A-F]{8}$/.test(computeCustomerSelectionsChecksum(estimate, items)));

    const bytes = await buildCustomerSelectionsPdf(estimate, { generatedAt: '2026-09-30' });
    check(
      `${key}: buildCustomerSelectionsPdf -> Uint8Array > 5000 bytes`,
      bytes instanceof Uint8Array && bytes.length > 5000,
      `${bytes.length} bytes`
    );
    const artifact = join(artifactDir, `out-selections-${key}.pdf`);
    writeFileSync(artifact, bytes);

    const doc = await PDFDocument.load(bytes);
    check(`${key}: pdf pages >= 1`, doc.getPageCount() >= 1, `${doc.getPageCount()} page(s)`);
    // pdfjs transfers (detaches) the buffer passed as `data`, so the overlap
    // probe gets its own copy and the later text extraction keeps `bytes`.
    const overlaps = await textOverlapPairs(Uint8Array.from(bytes));
    check(`${key}: no overlapping text runs in PDF`, overlaps === 0, `${overlaps} pair(s)`);
    const text = normalize(await extractPdfText(Buffer.from(bytes).toString('base64')));

    const allowed = new Set<string>();
    for (const item of items) {
      allowed.add(formatMoney(item.allowance_per_unit));
      allowed.add(formatMoney(item.allowance_total));
    }
    for (const group of groups) allowed.add(formatMoney(groupTotal(group.items)));
    allowed.add(formatMoney(totals.subtotal));
    allowed.add(formatMoney(totals.tax));
    allowed.add(formatMoney(totals.total));
    const leaks = moneyTokens(text).filter((token) => !allowed.has(token));
    check(`${key}: every dollar token is allow-listed`, leaks.length === 0, leaks.join('; '));

    check(`${key}: no carrier RCV/O&P/margin language`, !FORBIDDEN_RX.test(text));
    check(`${key}: no Xactimate category-code leaks`, !CODE_LEAK_RX_G.test(text));
    check(`${key}: checksum footer present`, /SEL-CHK-[0-9A-F]{8}/.test(text));
    check(
      `${key}: every category header present`,
      groups.every((g) => text.includes(g.category)),
      groups.map((g) => g.category).join('; ')
    );

    const filename = customerSelectionsPdfFilename(estimate);
    check(
      `${key}: filename sanitized + labeled`,
      /^[A-Za-z0-9_-]+\.pdf$/.test(filename) && filename.includes('Customer_Selections'),
      filename
    );
  }

  console.log(failures === 0 ? '\nAll customer-selections checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
