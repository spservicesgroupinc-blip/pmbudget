/** Deterministic finish recovery for supported Xactimate estimate tables. */
import { classifySelectionCategory } from './src/utils/customerSelections.js';
import { isSelectableXactimateRow, readXactimateSelectionRows } from './src/utils/xactimateSelectionSource.js';
import type { CustomerSelectionInput } from './src/types/estimate.js';

function scopeSelections(sourceText: string): CustomerSelectionInput[] | null {
  const rows = readXactimateSelectionRows(sourceText);
  if (rows === null) return null;
  return rows.filter(isSelectableXactimateRow).map((row) => ({
    trade: classifySelectionCategory('', row.description) === 'Paint & Finishes' ? 'Painting & Wallcovering' :
      classifySelectionCategory('', row.description) || 'Other',
    description: row.description, qty: row.qty, uom: row.uom,
    allowance_per_unit: null,
    installed_unit_cost: row.replace,
    installed_tax_per_unit: row.tax / row.qty,
    notes: [row.room, /\bpaint|stain\b/i.test(row.description) ? 'Customer to choose color/finish.' : 'Customer to choose replacement finish.'].filter(Boolean).join('; '),
  }));
}

function family(description: string): string {
  const category = classifySelectionCategory('', description) || 'Other';
  const product = description.match(/\b(stain|wallpaper|wallcovering|carpet|vinyl|hardwood|laminate|countertops?|cabinets?|faucets?|sinks?|toilets?|windows?|shingles?|siding|doors?|pendants?|chandeliers?|sconces?|fans?)\b/i)?.[1]?.toLowerCase().replace(/s$/, '') || '';
  return `${category}:${product}`;
}

/** Material section only: identical column headers also occur on labor/equipment pages. */
function materialSelections(source: string): CustomerSelectionInput[] | null {
  let inMaterials = false;
  let found = false;
  const selections: CustomerSelectionInput[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^MATERIAL COMPONENTS\s*$/i.test(line)) { inMaterials = true; found = true; continue; }
    if (/^(?:EQUIPMENT COMPONENTS|LABOR COMPONENTS|Total\b)/i.test(line)) inMaterials = false;
    if (!inMaterials || !line || /^Code\s+Description/i.test(line)) continue;
    const match = line.match(/^([A-Z][A-Z0-9/+\-]*)\s+(.+?)\s+([\d,]+(?:\.\d+)?)\s+([A-Z]+)\s+@\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\*?$/);
    if (!match) return null;
    const category = classifySelectionCategory('', match[2]);
    if (!category) continue;
    const qty = Number(match[3].replace(/,/g, ''));
    const unit = Number(match[5].replace(/,/g, ''));
    const total = Number(match[6].replace(/,/g, ''));
    if (qty <= 0) continue;
    // Displayed quantities may be rounded (*): reject impossible totals instead
    // of treating arbitrary source text as verified component pricing.
    if (Math.abs(qty * unit - total) > unit * 0.005 + 0.011) return null;
    selections.push({ trade: category === 'Paint & Finishes' ? 'Painting & Wallcovering' : category,
      component_code: match[1], description: match[2], qty, uom: match[4], allowance_per_unit: unit,
      source_pricing: { qty, unit_cost: unit, total },
      notes: `Customer to choose color/finish.${Math.abs(qty * unit - total) > 0.01 ? ' Source quantity is rounded; allowance uses the printed component total.' : ''}` });
  }
  return found ? selections : null;
}

export function extractXactimateSelectionSource(sourceText: string): CustomerSelectionInput[] | null {
  const componentStart = sourceText.search(/^===== COMPONENT BREAKDOWN REPORT|^MATERIAL COMPONENTS\s*$/m);
  const primary = componentStart >= 0 ? sourceText.slice(0, componentStart) : sourceText;
  const scope = scopeSelections(primary);
  const components = materialSelections(sourceText);
  if (components === null) {
    // Unknown component layouts still use AI; do not silently drop that document.
    if (componentStart >= 0) return null;
    return scope;
  }
  if (scope === null && /^\s*(?:DESCRIPTION\b|\d+\.\s)/m.test(primary)) return null;
  // More than one possible material for a scope requires the model's grade/
  // finish matching; never attach every area to multiple alternative products.
  if ((scope || []).some((item) => components.filter((component) => family(component.description) === family(item.description)).length > 1)) return null;
  // Family matching alone cannot merge two distinct finishes onto a generic
  // component. Plain paint applications are compatible scope for one paint;
  // named finishes, grades or colors need the AI's exact product matching.
  for (const component of components) {
    const matching = (scope || []).filter((item) => family(item.description) === family(component.description));
    const descriptions = new Set(matching.map((item) => item.description.toLowerCase()));
    const plainPaint = matching.every((item) => /^Paint (?:the surface area|baseboard|casing|walls?|ceilings?)\s*-\s*(?:one|two|three|\d+) coats?$/i.test(item.description));
    if (descriptions.size > 1 && !plainPaint) return null;
  }
  const joined = components.map((component) => ({ ...component,
    notes: [component.notes, ...(scope || []).filter((item) => family(item.description) === family(component.description))
      .map((item) => `${item.notes} ${item.description}: ${item.qty} ${item.uom}.`)].filter(Boolean).join(' ') }));
  return [...joined, ...(scope || []).filter((item) => !components.some((component) => family(component.description) === family(item.description)))];
}
