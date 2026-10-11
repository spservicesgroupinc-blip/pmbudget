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
import { buildCustomerSelections, classifySelectionCategory, computeSelectionTotals, selectionAllowanceTotal } from '../src/utils/customerSelections.ts';
import { buildCustomerSelectionsPdf } from '../src/utils/customerSelectionsPdf.ts';
import { extractXactimateSelectionSource } from '../xactSelectionSource.ts';
import type { CustomerSelectionInput } from '../src/types/estimate.ts';
import { componentDocumentHeader, estimateDocumentHeader } from '../src/utils/sourceDocuments.ts';

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
  check('A malformed supported price row cannot yield a partial deterministic inventory', extractXactimateSelectionSource(text.replace(/1\.23\s+4\.30\s+48\.10\s+288\.56/, '1.23 4.30 48.10')) === null);
  check('Mixed supported and unsupported tables cannot drop the unsupported room choices', extractXactimateSelectionSource(`${text}\n${unsupported}`) === null);

  const componentLines = [
    'MATERIAL COMPONENTS', 'Code Description Quantity @ Unit Price Total',
    'PNTCALK Caulking - acrylic 0.21 TB @ 4.015 0.85*',
    'PNTL Latex paint 1.11 GL @ 57.180 63.41*',
    "PNTPUT Painter's putty 0.04 GL @ 26.480 1.05*",
    'PNTSANDP 160 - 180 grit sandpaper - per sheet 0.44 SH @ 1.173 0.51*',
    'FCCPRE1/2 Carpet pad - rebond, 6 lb 104.96 SF @ 0.524 55.00',
    'FCCTACK Carpet tackless strip - 400 lf/box 0.06 BX @ 42.840 2.49*',
    'Total 158.67', 'EQUIPMENT COMPONENTS', 'Code Description Quantity @ Unit Price Total',
    'FCCPS Carpet power stretcher 0.35 DA @ 45.678 15.91*',
    'Total 48.87', 'LABOR COMPONENTS (CONTRACTOR)', 'Code Description Quantity @ Unit Price Total',
    'PNT Painter 2.49 HR @ 84.53 210.24*', 'Total 20.19 HR 1,526.54',
  ];
  const components = process.argv[3] ? await extractPdfText(readFileSync(process.argv[3]).toString('base64')) : componentLines.join('\n');
  const both = `${estimateDocumentHeader('estimate.pdf')}\n${text}\n${componentDocumentHeader('components.pdf')}\n${components}`;
  const joined = extractXactimateSelectionSource(both);
  check('Two documents join the three paint application scopes to one physical paint product', joined?.length === 1 && joined[0].component_code === 'PNTL' && paints.every((paint) => joined[0].notes?.includes(paint.description)));
  check('Component quantities and prices are copied exactly without adding waste', joined?.[0].qty === 1.11 && joined[0].uom === 'GL' && joined[0].allowance_per_unit === 57.18 && joined[0].source_pricing?.total === 63.41);
  check('Coverage accepts paint on existing baseboard without demanding new trim', findCustomerSelectionCoverageGaps(both, joined || []).length === 0);
  for (const description of ['Caulking - acrylic', "Painter's putty", '160 - 180 grit sandpaper - per sheet']) check(`${description} is preparation, not a customer finish`, classifySelectionCategory('Painting & Wallcovering', description) === undefined);
  const merged = await pipelineWithModelChoices(both, polluted);
  check('Two-document pipeline corrects polluted AI output into one confirmed material selection', merged.customer_selections?.length === 1 && merged.customer_selections[0].allowance_status === 'confirmed' && merged.customer_selections[0].allowance_basis !== 'installed');
  const totals = computeSelectionTotals(merged.customer_selections);
  check('Component report printed total survives displayed quantity rounding', totals.subtotal === 63.41 && totals.tax === 4.44 && totals.total === 67.85, JSON.stringify(totals));
  check('Component pricing remains stable through rebuild', JSON.stringify(buildCustomerSelections(merged.material_allowances, merged.customer_selection_source)) === JSON.stringify(merged.customer_selections));
  check('Editing component quantity recomputes the allowance', selectionAllowanceTotal({ ...merged.customer_selections![0], qty: 2 }) === 114.36);
  check('Ambiguous component products keep the AI matching path', extractXactimateSelectionSource(both.replace('PNTL', 'PNTALT Enamel paint 1.00 GL @ 30.000 30.00\nPNTL')) === null);
  check('Invalid component totals cannot be marked verified', extractXactimateSelectionSource(both.replace('63.41*', '999.00*')) === null);
  const diverseJobs = [
    { name: 'Kitchen rebuild', products: [
      ['CABBASE', 'Base cabinets - shaker', 8, 'LF', 150],
      ['CTRGRAN', 'Granite countertop', 12, 'SF', 55],
      ['PLMFAU', 'Kitchen faucet', 1, 'EA', 165],
      ['APPDISH', 'Dishwasher', 1, 'EA', 400],
    ] },
    { name: 'Bedroom and bathroom repairs', products: [
      ['FCCCAR', 'Bedroom carpet', 20, 'SY', 22.5],
      ['FCTPOR', 'Porcelain tile', 25, 'SF', 4],
      ['PLMSINK', 'Bathroom sink', 1, 'EA', 120],
      ['ELEPEND', 'Pendant lighting', 2, 'EA', 80],
      ['DORSLAB', 'Interior door slab', 1, 'EA', 90],
    ] },
    { name: 'Exterior storm repairs', products: [
      ['SDGVIN', 'Vinyl siding', 100, 'SF', 3],
      ['RFGSHIN', 'Architectural shingle', 2, 'SQ', 120],
      ['WDWWIN', 'Replacement window', 2, 'EA', 200],
    ] },
  ];
  for (const job of diverseJobs) {
    const source = `${estimateDocumentHeader('generic.pdf')}\n${job.name} Height: 8'\nDESCRIPTION QTY REMOVE REPLACE TAX O&P TOTAL\n` +
      job.products.map(([code, description, qty, unit, rate], index) => `${index + 1}. ${description} ${Number(qty).toFixed(2)} ${unit} 0.00 ${(Number(rate) + 10).toFixed(2)} 0.00 0.00 ${(Number(qty) * (Number(rate) + 10)).toFixed(2)}`).join('\n') +
      `\nTotals: ${job.name}\n${componentDocumentHeader('generic-components.pdf')}\nMATERIAL COMPONENTS\nCode Description Quantity @ Unit Price Total\n` +
      job.products.map(([code, description, qty, unit, rate]) => `${code} ${description} ${qty} ${unit} @ ${Number(rate).toFixed(3)} ${(Number(qty) * Number(rate)).toFixed(2)}`).join('\n') + '\nTotal 9999.00';
    const inventory = extractXactimateSelectionSource(source);
    check(`${job.name}: all products use component quantities and prices once`, inventory?.length === job.products.length && job.products.every(([code, description, qty, unit, rate]) => inventory.some((item) => item.component_code === code && item.qty === qty && item.uom === unit && item.allowance_per_unit === rate)));
    const result = await pipelineWithModelChoices(source, []);
    check(`${job.name}: customer selections survive an empty AI list across trades`, result.customer_selections?.length === job.products.length && result.customer_selections.every((item) => item.allowance_status === 'confirmed'));
  }
  const variants = `${estimateDocumentHeader('different-finishes.pdf')}\nRoom Height: 8'\nDESCRIPTION QTY REMOVE REPLACE TAX O&P TOTAL\n1. Luxury vinyl plank flooring - oak premium 20.00 SF 0.00 8.00 0.00 0.00 160.00\n2. Luxury vinyl plank flooring - walnut economy 30.00 SF 0.00 7.00 0.00 0.00 210.00\nTotals: Room\n${componentDocumentHeader('components.pdf')}\nMATERIAL COMPONENTS\nCode Description Quantity @ Unit Price Total\nFCVLVP Luxury vinyl plank flooring 50 SF @ 3.000 150.00\nTotal 150.00`;
  check('Different finishes cannot be collapsed onto one generic component product', extractXactimateSelectionSource(variants) === null);
  const sheet = await extractPdfText(Buffer.from(await buildCustomerSelectionsPdf(merged)).toString('base64'));
  check('Joined material allowance exports with printed source prices and all room scope notes', sheet.includes('$63.41') && sheet.includes('$67.85') && paints.every((paint) => sheet.replace(/\s+/g, ' ').includes(paint.description)));
  if (failures) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
