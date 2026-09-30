// Offline verification of the Customer Selections & Material Allowance Sheet:
// deterministic classifier, totals math, budget-engine field preservation,
// branded PDF rendering and the customer-facing money policy — every dollar
// token on the sheet must be an allow-listed allowance figure, and no carrier
// RCV / O&P / margin language or Xactimate category codes may appear.
// Run: npx tsx scripts/verify-customer-selections.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
import type { EstimateResult, MaterialAllowanceItem } from '../src/types/estimate.ts';

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
  check('classifier: derived 3 selection rows', derived.length === 3, `${derived.length} row(s)`);
  check('classifier: flooring category', derived[0]?.category === 'Flooring', derived[0]?.category);
  check('classifier: cabinets category', derived[1]?.category === 'Cabinets & Countertops', derived[1]?.category);
  check('classifier: paint category', derived[2]?.category === 'Paint & Finishes', derived[2]?.category);
  check(
    'classifier: sequential ids',
    derived.map((d) => d.id).join(',') === 'SEL-1,SEL-2,SEL-3',
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
  check('classifier: turnkey MEP excluded', classifySelectionCategory('Rough Mechanicals (MEP)', 'Kitchen faucet') === undefined);

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
    const artifact = join('scripts', '__verify_tmp', `out-selections-${key}.pdf`);
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
