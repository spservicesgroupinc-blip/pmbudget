/** Server-only recovery of missing selection prices from the original source. */
import { deepseekJsonWithMeta } from './deepseek.js';
import { SOURCE_DOCUMENTS_GUIDE } from './src/utils/sourceDocuments.js';
import type { CustomerSelectionInput } from './src/types/estimate.js';

const compact = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
const money = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const unit = (value: string) => value.toUpperCase().replace(/[^A-Z]/g, '')
  .replace(/^(SQFT|SQUAREFEET)$/, 'SF').replace(/^(SQYD|SQUAREYARDS)$/, 'SY')
  .replace(/^(EACH)$/, 'EA').replace(/^(GAL|GALLON|GALLONS)$/, 'GL')
  .replace(/^(LINFT|LINEARFEET)$/, 'LF');
const area = (value: string) => unit(value) === 'SF' ? 1 : unit(value) === 'SY' ? 9 : undefined;
function conversion(from: string, to: string): number | undefined {
  if (unit(from) === unit(to)) return 1;
  const a = area(from), b = area(to);
  return a && b ? b / a : undefined;
}
function containsNumber(quote: string, amount: number): boolean {
  return (quote.match(/\d[\d,]*(?:\.\d+)?/g) || []).some((token) =>
    Math.abs(Number(token.replace(/,/g, '')) - amount) < 0.000001);
}

export async function recoverCustomerSelectionPrices(
  sourceText: string, selections: CustomerSelectionInput[]
): Promise<{ selections: CustomerSelectionInput[]; tokens: number; recovered: number }> {
  const missing = selections.flatMap((item, index) => item.allowance_per_unit === null ?
    [{ selection_index: index, ...item }] : []);
  if (!missing.length) return { selections, tokens: 0, recovered: 0 };
  const response = await deepseekJsonWithMeta<unknown>({
    system: `Recover MATERIAL-ONLY customer selection prices from the original uploaded document(s).
${SOURCE_DOCUMENTS_GUIDE}
Return ONLY this JSON object: {"prices":[{"selection_index":0,"material_unit_cost":null,"material_total":null,"material_quantity":null,"material_uom":"EA","evidence":""}]}.
Return one row per requested selection_index; do not add, remove, rename or regroup selections.
A price may be listed in EITHER document: search ALL rooms of the full estimate and ALL tables
of the component report for the same product, grade, size and finish.
Read column headers carefully: Material/Mat, component unit cost, extended material amount,
Actual Cost Qty and Component Qty can provide the amount even when the combined UNIT PRICE cannot.
Prefer the matching component report when both documents list the product.
Turnkey plumbing, electrical and carpet still need material prices.
material_unit_cost is the pre-tax material rate in material_uom as printed in the source.
Never calculate a unit cost yourself: material_unit_cost MUST literally appear in the source.
When the table has only Material Total, material_unit_cost MUST be null. Copy the printed
material_total and Actual Cost Qty into material_quantity; the server performs ALL arithmetic.
For example, "Faucet | 2 | EA | Material Total 330.00 | Labor 80.00" returns
material_unit_cost:null, material_total:330, material_quantity:2, material_uom:"EA".
"Carpet | 20 | SY | Material Total 405.00" returns material_unit_cost:null,
material_total:405, material_quantity:20, material_uom:"SY", even if selection uom is SF.
Do not multiply by the installed selection quantity when the component quantity already includes waste.
Copy material_uom from the priced SOURCE row, not the requested selection. Never convert units yourself.
The server converts SF and SY. evidence MUST be a literal copy of the priced source row,
character for character. Do NOT insert column labels into a row or rewrite its text.
Read the headers to interpret the row, but do not add headers to evidence. For a table row
"Bathroom faucet | 2 | EA | 330.00 | 80.00", evidence is exactly that string, not
"Bathroom faucet | 2 | EA | Material Total 330.00 | Labor Total 80.00".
Include the price (and quantity when using a total). Never invent values.
Never use supply/install UNIT PRICE, line TOTAL, RCV, labor/equipment, tax, O&P or trade totals
as material prices. Do not estimate a material percentage or use market pricing.
If only a combined price exists, return null amounts and empty evidence for that item.`,
    user: `SELECTIONS NEEDING PRICES:\n${JSON.stringify(missing)}\n\nSOURCE DOCUMENTS (full Xactimate estimate and/or component breakdown report):\n${sourceText}`,
    temperature: 0,
    label: 'customer-selection-pricing',
    attempts: 3,
    requireComplete: true,
  });
  const data = response.data as { prices?: unknown } | null;
  if (!Array.isArray(data?.prices)) throw new Error('Customer selection pricing review did not return valid prices. Reprocess the estimate.');
  const candidates = new Map<number, Set<number>>();
  for (const raw of data.prices) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const index = row.selection_index;
    if (typeof index !== 'number' || !Number.isInteger(index) || !selections[index] ||
      selections[index].allowance_per_unit !== null) continue;
    const evidence = typeof row.evidence === 'string' ? row.evidence.trim() : '';
    if (!evidence || !compact(sourceText).includes(compact(evidence))) continue;
    const factor = conversion(String(row.material_uom || ''), selections[index].uom);
    if (factor === undefined) continue;
    let rate: number | undefined;
    if (money(row.material_unit_cost) && containsNumber(evidence, row.material_unit_cost)) {
      rate = row.material_unit_cost * factor;
    } else if (money(row.material_total) && money(row.material_quantity) && row.material_quantity > 0 &&
      containsNumber(evidence, row.material_total) && containsNumber(evidence, row.material_quantity)) {
      rate = row.material_total / row.material_quantity * factor;
    }
    if (rate === undefined || !Number.isFinite(rate)) continue;
    const values = candidates.get(index) || new Set<number>();
    values.add(Math.round((rate + Number.EPSILON) * 100) / 100);
    candidates.set(index, values);
  }
  let recovered = 0;
  const corrected = selections.map((item, index) => {
    const rates = candidates.get(index);
    if (rates?.size !== 1) return item;
    recovered++;
    return { ...item, allowance_per_unit: [...rates][0] };
  });
  return {
    selections: corrected,
    tokens: response.usage?.total_tokens || 0,
    recovered,
  };
}
