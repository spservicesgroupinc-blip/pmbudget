/** Deterministic finish recovery for supported Xactimate estimate tables. */
import { classifySelectionCategory } from './src/utils/customerSelections.js';
import { isSelectableXactimateRow, readXactimateSelectionRows } from './src/utils/xactimateSelectionSource.js';
import type { CustomerSelectionInput } from './src/types/estimate.js';

export function extractXactimateSelectionSource(sourceText: string): CustomerSelectionInput[] | null {
  const rows = readXactimateSelectionRows(sourceText);
  if (rows === null) return null;
  return rows.filter(isSelectableXactimateRow).map((row) => ({
    trade: classifySelectionCategory('', row.description) === 'Paint & Finishes' ? 'Painting & Wallcovering' :
      classifySelectionCategory('', row.description) || 'Other',
    description: row.description, qty: row.qty, uom: row.uom,
    allowance_per_unit: null,
    installed_unit_cost: row.replace,
    notes: [row.room, /\bpaint|stain\b/i.test(row.description) ? 'Customer to choose color/finish.' : 'Customer to choose replacement finish.'].filter(Boolean).join('; '),
  }));
}
