/**
 * Regression for the room-table layout in the supplied repair estimate.
 * Source fixture retains line descriptions/numbers but no customer/contact data.
 * Run: npx tsx scripts/verify-estimate-selection-source.ts
 * Only the external model response is stubbed; PDF extraction and the server
 * selection pipeline run their real implementations.
 */
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readFileSync } from 'node:fs';
import { extractPdfText } from '../pdfText.ts';
import { processEstimate } from '../xactEngine.ts';
import { findCustomerSelectionCoverageGaps } from '../src/utils/customerSelectionCoverage.ts';
import { buildCustomerSelections, classifySelectionCategory, computeSelectionTotals } from '../src/utils/customerSelections.ts';
import { buildCustomerSelectionsPdf } from '../src/utils/customerSelectionsPdf.ts';
import { extractXactimateSelectionSource } from '../xactSelectionSource.ts';
import type { CustomerSelectionInput } from '../src/types/estimate.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
};

const lines = [
  'Repair estimate - test fixture',
  "Main Room Height: 8'",
  '60.60 SY Flooring',
  '545.38 SF Floor',
  '102.08 LF Floor Perimeter',
  'DESCRIPTION QTY REMOVE REPLACE TAX O&P TOTAL',
  '15. Install Baseboard - 3 1/4" 12.00 LF 0.00 1.89 0.00 4.54 27.22',
  '17. Carpet pad 100.00 SF 0.00 0.70 3.85 14.78 88.63',
  '24. Lay existing carpet - Labor only 240.00 SF 0.00 0.88 0.50 42.34 254.04',
  '21. Paint the surface area - two coats 192.00 SF 0.00 1.23 4.30 48.10 288.56',
  '23. Paint baseboard - one coat 12.00 LF 0.00 1.19 0.10 2.88 17.26',
  '25. Clean and deodorize carpet 545.38 SF 0.00 0.65 0.38 70.98 425.86',
  '31. Install Casing - 2 1/4" 11.00 LF 0.00 0.98 0.00 2.16 12.94',
  '32. Paint casing - two coats 14.00 LF 0.00 1.84 0.21 5.20 31.17',
  'Totals: Main Room 11.10 350.22 2,100.99',
  '545.38 SF Floor 60.60 SY Flooring 102.08 LF Floor Perimeter',
];

const paints: CustomerSelectionInput[] = [
  { trade: 'Painting & Wallcovering', description: 'Paint the surface area - two coats', qty: 192, uom: 'SF', allowance_per_unit: null, notes: 'Main Room' },
  { trade: 'Painting & Wallcovering', description: 'Paint baseboard - one coat', qty: 12, uom: 'LF', allowance_per_unit: null, notes: 'Main Room' },
  { trade: 'Painting & Wallcovering', description: 'Paint casing - two coats', qty: 14, uom: 'LF', allowance_per_unit: null, notes: 'Main Room' },
];

const polluted: CustomerSelectionInput[] = [
  ...paints,
  { trade: 'Flooring', description: 'Flooring', qty: 60.60, uom: 'SY', allowance_per_unit: null },
  { trade: 'Flooring', description: 'Carpet', qty: 545.38, uom: 'SF', allowance_per_unit: null },
  { trade: 'Flooring', description: 'Carpet pad', qty: 100, uom: 'SF', allowance_per_unit: null },
  { trade: 'Flooring', description: 'Lay existing carpet - Labor only', qty: 240, uom: 'SF', allowance_per_unit: null },
  { trade: 'Finish Trim & Doors', description: 'Install Baseboard - 3 1/4"', qty: 12, uom: 'LF', allowance_per_unit: null },
  { trade: 'Finish Trim & Doors', description: 'Install Casing - 2 1/4"', qty: 11, uom: 'LF', allowance_per_unit: null },
];

async function sourcePdfText(): Promise<string> {
  // Optional local source checks the exact uploaded PDF without committing it.
  // npx tsx scripts/verify-estimate-selection-source.ts C:/path/estimate.pdf
  if (process.argv[2]) return extractPdfText(readFileSync(process.argv[2]).toString('base64'));
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  lines.forEach((line, index) => page.drawText(line, { x: 30, y: 750 - index * 25, font, size: 8 }));
  return extractPdfText(Buffer.from(await pdf.save()).toString('base64'));
}

async function pipelineWithModelChoices(text: string, choices: CustomerSelectionInput[]) {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'offline-test';
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body || '{}')) as { messages?: Array<{ role: string; content: string }> };
    const system = request.messages?.find((message) => message.role === 'system')?.content || '';
    const content = system.includes('Recover MATERIAL-ONLY')
      ? { prices: [] }
      : {
        project_meta: { client_name: 'Regression Test', claim_number: 'TEST', total_rcv: 2100.99 },
        trade_sections: [{ task_id: 'T-1', trade_name: 'Painting & Wallcovering', category_codes_included: ['PNT'], direct_subtotal: 1750.77, suggested_duration_days: 1, predecessors: '', scope_summary: 'Paint repair surfaces.' }],
        material_allowances: [],
        customer_selections: choices,
      };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] }), { status: 200 });
  };
  try {
    return await processEstimate(text);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
}

async function main() {
  const text = await sourcePdfText();
  const compact = (value: string) => value.replace(/\s+/g, ' ').trim();
  check('PDF upload preserves the room table, column headers and paint quantities', lines.slice(2, 14).every((line) => compact(text).includes(compact(line))));

  const gaps = findCustomerSelectionCoverageGaps(text, paints);
  check('Room measurements, carpet supplies and existing carpet work demand no finish selections', gaps.length === 0, gaps.join(', '));
  check('Install-only baseboard is not a material choice', classifySelectionCategory('Finish Trim & Doors', 'Install Baseboard - 3 1/4"') === undefined);
  check('Install-only casing is not a material choice', classifySelectionCategory('Finish Trim & Doors', 'Install Casing - 2 1/4"') === undefined);

  const cases: Array<[string, CustomerSelectionInput[]]> = [['empty model inventory', []], ['correct source inventory', paints], ['polluted model inventory', polluted]];
  const expectedInstalled = [1.23, 1.19, 1.84];
  const parsed = extractXactimateSelectionSource(text);
  check('Parser retains exact installed REPLACE references separately from material prices', parsed?.length === 3 && parsed.every((item, index) => item.installed_unit_cost === expectedInstalled[index] && item.allowance_per_unit === null));
  for (const [label, modelChoices] of cases) {
    try {
      const result = await pipelineWithModelChoices(text, modelChoices);
      const selections = result.customer_selections || [];
      check(`${label}: only the three supported paint choices reach the customer page`, selections.length === 3 && selections.every((item) => item.category === 'Paint & Finishes'), selections.map((item) => item.description).join('; '));
      check(`${label}: exact source quantities survive without room-area substitution`, paints.every((expected) => selections.some((item) => item.description === expected.description && item.qty === expected.qty && item.uom === expected.uom)));
      check(`${label}: combined REPLACE rates become clearly distinguished installed allowances`, selections.length === 3 && selections.every((item, index) => item.allowance_status === 'confirmed' && item.allowance_basis === 'installed' && item.allowance_per_unit === expectedInstalled[index]) && Boolean(result.customer_selection_source?.every((item) => item.allowance_per_unit === null)));
      const rebuilt = buildCustomerSelections(result.material_allowances, result.customer_selection_source);
      check(`${label}: rebuilding selections retains the three exact installed references`, rebuilt.length === 3 && rebuilt.every((item, index) => item.installed_unit_cost === expectedInstalled[index]));
      check(`${label}: rebuild preserves allowance basis, prices and source tax`, JSON.stringify(rebuilt) === JSON.stringify(selections));
      const totals = computeSelectionTotals(selections);
      check(`${label}: installed allowances use source tax rather than taxing all labor at 7%`, totals.subtotal === 276.20 && totals.tax === 4.61 && totals.total === 280.81, JSON.stringify(totals));
      const mixed = computeSelectionTotals([...selections, { ...selections[0], id: 'material-test', qty: 1, allowance_per_unit: 100, allowance_total: 100, allowance_basis: 'material' }]);
      check(`${label}: mixed installed and material allowances use their own tax basis`, mixed.tax === 11.61 && mixed.total === 387.81);
      if (label === 'empty model inventory') {
        const pdf = await buildCustomerSelectionsPdf(result);
        const pdfText = await extractPdfText(Buffer.from(pdf).toString('base64'));
        check('Customer sheet can be generated directly from the uploaded estimate', (await PDFDocument.load(pdf)).getPageCount() >= 1);
        check('Customer sheet labels every installed allowance and prints the correct tax and total', (pdfText.match(/Installed allowance \(labor \+ materials\)/g) || []).length === 3 && pdfText.includes('$4.61') && pdfText.includes('$280.81'));
      }
    } catch (error) {
      check(`${label}: processing completes for the uploaded repair estimate`, false, error instanceof Error ? error.message : String(error));
    }
  }

  const repairOnlyText = [
    "Repair Room Height: 8'",
    'DESCRIPTION QTY REMOVE REPLACE TAX O&P TOTAL',
    '1. Drywall patch 10.00 SF 0.00 2.00 0.10 4.02 24.12',
    '2. Lay existing carpet - Labor only 240.00 SF 0.00 0.88 0.50 42.34 254.04',
    'Totals: Repair Room 0.60 46.36 278.16',
  ].join('\n');
  check('A supported repair-only table has a genuine empty finish inventory', extractXactimateSelectionSource(repairOnlyText)?.length === 0);
  try {
    const empty = await pipelineWithModelChoices(repairOnlyText, []);
    check('Genuine empty model inventory succeeds when the source has no finish choices', empty.customer_selections?.length === 0);
  } catch (error) {
    check('Genuine empty model inventory succeeds when the source has no finish choices', false, error instanceof Error ? error.message : String(error));
  }

  const unsupported = [
    'DESCRIPTION QTY UNIT PRICE TAX O&P RCV ACV',
    '1. Paint the surface area - two coats 192.00 SF 1.23 4.30 48.10 288.56 240.00',
  ].join('\n');
  check('Unsupported table layout remains on the model extraction path', extractXactimateSelectionSource(unsupported) === null);
  check('A malformed supported price row cannot yield a partial deterministic inventory', extractXactimateSelectionSource(text.replace('1.23 4.30 48.10 288.56', '1.23 4.30 48.10')) === null);
  check('Mixed supported and unsupported tables cannot drop the unsupported room choices', extractXactimateSelectionSource(`${text}\n${unsupported}`) === null);
  if (failures) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
