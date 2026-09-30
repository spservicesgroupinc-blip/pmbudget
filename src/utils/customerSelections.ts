/**
 * Customer material selections (the "Customer Selections & Material Allowance
 * Sheet" data layer). Pure, environment-neutral — imported by the serverless
 * extraction graph (xactEngine.ts) and the browser UI alike.
 *
 * Selection rows are DERIVED from the budget engine's `material_allowances`
 * (Output 2) by a deterministic classifier, so extraction stays schema-stable.
 * The office can then edit them in the Customer Selections section and render
 * them with customerSelectionsPdf.ts. They are stored separately from
 * `material_allowances` so customer-facing edits never touch the procurement
 * list, the budget engine, or its audit checksums.
 */
import type {
  CustomerSelectionItem,
  EstimateResult,
  MaterialAllowanceItem,
} from '../types/estimate.js';

/** Canonical display order for selection categories on the allowance sheet. */
export const SELECTION_CATEGORIES = [
  'Flooring',
  'Tile',
  'Cabinets & Countertops',
  'Paint & Finishes',
  'Trim & Doors',
  'Plumbing Fixtures',
  'Hardware',
  'Appliances',
  'Other',
] as const;

export type SelectionCategory = (typeof SELECTION_CATEGORIES)[number];

/** Indiana material sales tax — keep in sync with budgetEngine.MATERIAL_TAX_RATE. */
export const SELECTION_TAX_RATE = 0.07;

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

// Trades whose materials are never customer-finish selections (procurement-only
// or turnkey). Turnkey rows are already dropped by the budget engine; this
// guard also keeps demolition/cleaning consumables off the customer sheet.
const NON_SELECTION_TRADE_RX =
  /demoli|mitigat|clean|drywall|plaster|insulat|framing|rough|mechan|mep|roof|gutter|siding|exterior|electri|plumb|hvac/i;

const TRADE_CATEGORY: ReadonlyArray<[RegExp, SelectionCategory]> = [
  [/tile/i, 'Tile'],
  [/floor/i, 'Flooring'],
  [/cabinet|counter/i, 'Cabinets & Countertops'],
  [/paint|wallcover/i, 'Paint & Finishes'],
  [/trim|door/i, 'Trim & Doors'],
  [/hardware/i, 'Hardware'],
  [/appliance/i, 'Appliances'],
];

const DESCRIPTION_CATEGORY: ReadonlyArray<[RegExp, SelectionCategory]> = [
  [/tile|grout|thinset/i, 'Tile'],
  [/carpet|lvp|lvt|vinyl|hardwood|laminate|underlayment|padding/i, 'Flooring'],
  [/cabinet|countertop|backsplash|vanity top/i, 'Cabinets & Countertops'],
  [/paint|primer|stain|wallcover/i, 'Paint & Finishes'],
  [/baseboard|casing|trim|crown|door slab|jamb|stile/i, 'Trim & Doors'],
  [/faucet|sink|shower|tub|toilet|valve/i, 'Plumbing Fixtures'],
  [/knob|handle|hinge|lock|hardware/i, 'Hardware'],
  [/refrigerator|dishwasher|range|oven|microwave|appliance/i, 'Appliances'],
];

/**
 * Maps a procurement allowance row to a customer-selection category, or
 * undefined when the row is not a customer-finish selection (lumber, drywall,
 * consumables, turnkey-scope materials).
 */
export function classifySelectionCategory(
  trade: string,
  description: string
): SelectionCategory | undefined {
  const tradeLabel = String(trade || '').trim();
  const desc = String(description || '').trim();
  if (!tradeLabel) return undefined;
  if (NON_SELECTION_TRADE_RX.test(tradeLabel)) return undefined;
  for (const [rx, category] of TRADE_CATEGORY) {
    if (rx.test(tradeLabel)) return category;
  }
  for (const [rx, category] of DESCRIPTION_CATEGORY) {
    if (rx.test(desc)) return category;
  }
  return undefined;
}

/** Derives customer-selection rows from the budget engine's procurement allowances. */
export function buildCustomerSelections(
  allowances: MaterialAllowanceItem[] | undefined
): CustomerSelectionItem[] {
  const items: CustomerSelectionItem[] = [];
  let n = 0;
  for (const allowance of allowances || []) {
    const category = classifySelectionCategory(allowance.trade, allowance.description);
    if (!category) continue;
    const qty = Number.isFinite(allowance.qty) ? allowance.qty : 0;
    const unit = Number.isFinite(allowance.unit_cost) ? allowance.unit_cost : 0;
    if (qty <= 0 || !String(allowance.description || '').trim()) continue;
    const unitRounded = round2(unit);
    items.push({
      id: `SEL-${++n}`,
      category,
      trade: String(allowance.trade || '').trim(),
      component_code: allowance.component_code,
      description: String(allowance.description || '').trim(),
      qty,
      uom: String(allowance.uom || 'EA').toUpperCase(),
      allowance_per_unit: unitRounded,
      allowance_total: round2(qty * unitRounded),
      vendor: allowance.vendor ? String(allowance.vendor) : undefined,
      source: 'estimate',
    });
  }
  return items;
}

export interface SelectionTotals {
  subtotal: number;
  tax: number;
  total: number;
}

/** Sheet totals: subtotal + Indiana material tax + grand total. */
export function computeSelectionTotals(
  items: CustomerSelectionItem[] | undefined
): SelectionTotals {
  const subtotal = round2(
    (items || []).reduce(
      (sum, item) => sum + (Number.isFinite(item.allowance_total) ? item.allowance_total : 0),
      0
    )
  );
  const tax = round2(subtotal * SELECTION_TAX_RATE);
  return { subtotal, tax, total: round2(subtotal + tax) };
}

/** Groups selection rows by category in canonical display order. */
export function groupSelectionsByCategory(
  items: CustomerSelectionItem[]
): Array<{ category: string; items: CustomerSelectionItem[] }> {
  const order = new Map<string, number>();
  SELECTION_CATEGORIES.forEach((category, i) => order.set(category, i));
  const groups = new Map<string, CustomerSelectionItem[]>();
  for (const item of items || []) {
    const category = item.category || 'Other';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category)!.push(item);
  }
  return Array.from(groups.entries())
    .sort((a, b) => (order.get(a[0]) ?? 999) - (order.get(b[0]) ?? 999))
    .map(([category, groupItems]) => ({ category, items: groupItems }));
}

const fileSafe = (value: unknown): string =>
  String(value ?? '').replace(/[^A-Za-z0-9_-]+/g, '_');

/** Send-ready document name, e.g. Michael_Jenkins_Claim_92-8419-X21_Customer_Selections.pdf */
export function customerSelectionsPdfFilename(estimate: EstimateResult): string {
  const client = fileSafe(estimate.project_meta?.client_name || 'Client');
  const claim = fileSafe(estimate.project_meta?.claim_number || 'Claim');
  return `${client}_Claim_${claim}_Customer_Selections.pdf`;
}

/** Verification token printed on every page of the customer selections sheet. */
export function computeCustomerSelectionsChecksum(
  estimate: EstimateResult,
  items: CustomerSelectionItem[]
): string {
  const basis = JSON.stringify({
    client: estimate.project_meta?.client_name || '',
    claim: estimate.project_meta?.claim_number || '',
    items: (items || []).map((item) => [
      item.id,
      item.description,
      item.qty,
      item.uom,
      item.allowance_per_unit,
    ]),
  });
  let hash = 5381;
  for (let i = 0; i < basis.length; i++) {
    hash = ((hash << 5) + hash + basis.charCodeAt(i)) | 0;
  }
  return `SEL-CHK-${(hash >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}
