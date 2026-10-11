/**
 * Customer material selections (the "Customer Selections & Material Allowance
 * Sheet" data layer). Pure, environment-neutral — imported by the serverless
 * extraction graph (xactEngine.ts) and the browser UI alike.
 *
 * Selection rows combine explicit AI finish selections with the budget engine's
 * audited allowances. Turnkey customer choices are retained independently.
 * The office can then edit them in the Customer Selections section and render
 * them with customerSelectionsPdf.ts. They are stored separately from
 * `material_allowances` so customer-facing edits never touch the procurement
 * list, the budget engine, or its audit checksums.
 */
import type {
  CustomerSelectionItem,
  CustomerSelectionInput,
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
  'Lighting & Electrical',
  'Windows & Exterior',
  'Hardware',
  'Appliances',
  'Other',
] as const;

export type SelectionCategory = (typeof SELECTION_CATEGORIES)[number];

/** Indiana material sales tax — keep in sync with budgetEngine.MATERIAL_TAX_RATE. */
export const SELECTION_TAX_RATE = 0.07;

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

// Exclude work and hidden construction supplies, rather than entire turnkey
// trades: customers still choose their carpet, fixtures and exterior finishes.
const NON_SELECTION_TRADE_RX =
  /demoli|mitigat|clean/i;
const NON_SELECTION_DESCRIPTION_RX =
  /\b(?:remove|removal|demolition|detach|reset|reinstall|clean|cleaning|protect|protection|masking|labor|labour|drywall|gypsum|insulation|lumber|studs?|joists?|subfloor|underlayment|padding|carpet pad|thinset|mortar|adhesive|caulk|sealant|primer|fasteners?|screws?|nails?|tape|poly sheeting|consumables?|supplies|rough[- ]?in|pipes?|conduit|wiring|junction box|ductwork)\b/i;

const TRADE_CATEGORY: ReadonlyArray<[RegExp, SelectionCategory]> = [
  [/tile/i, 'Tile'],
  [/floor/i, 'Flooring'],
  [/cabinet|counter/i, 'Cabinets & Countertops'],
  [/paint|wallcover/i, 'Paint & Finishes'],
  [/trim|door/i, 'Trim & Doors'],
  [/hardware/i, 'Hardware'],
  [/appliance/i, 'Appliances'],
  [/plumb/i, 'Plumbing Fixtures'],
  [/light|electri/i, 'Lighting & Electrical'],
  [/window|roof|gutter|siding|exterior/i, 'Windows & Exterior'],
];

const DESCRIPTION_CATEGORY: ReadonlyArray<[RegExp, SelectionCategory]> = [
  [/\b(?:tiles?|grout|backsplash)\b/i, 'Tile'],
  [/\b(?:knobs?|handles?|hinges?|locks?|hardware|pulls?|towel bars?|toilet paper holders?)\b/i, 'Hardware'],
  [/\b(?:refrigerator|dishwasher|range|oven|microwave|appliance|washer|dryer|cooktop)\b/i, 'Appliances'],
  [/\b(?:cabinets?|cabinetry|countertops?|vanity|vanities)\b|vanity top/i, 'Cabinets & Countertops'],
  [/\b(?:carpet|lvp|lvt|hardwood|laminate|flooring)\b|vinyl (?:plank|floor|sheet)|wood floor/i, 'Flooring'],
  [/\b(?:paint|stain|wallcover|wallpaper|finish color)\b/i, 'Paint & Finishes'],
  [/\b(?:faucets?|sinks?|showers?|tubs?|bathtubs?|toilets?|lavatory|showerheads?|fixture valve)\b/i, 'Plumbing Fixtures'],
  [/\b(?:light|lighting|chandelier|sconce|pendant|ceiling fan|switch plate|outlet cover)\b/i, 'Lighting & Electrical'],
  [/\b(?:window|shingle|roofing|siding|gutter|soffit|exterior door|garage door)\b/i, 'Windows & Exterior'],
  [/\b(?:baseboards?|casing|trim|crown|doors?|jamb|stile|moulding|molding)\b/i, 'Trim & Doors'],
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
  if (!desc || NON_SELECTION_DESCRIPTION_RX.test(desc)) return undefined;
  for (const [rx, category] of DESCRIPTION_CATEGORY) {
    if (rx.test(desc)) return category;
  }
  if (NON_SELECTION_TRADE_RX.test(tradeLabel)) return undefined;
  if (/drywall|plaster|insulat|framing|rough|mechan|mep|hvac/i.test(tradeLabel)) return undefined;
  for (const [rx, category] of TRADE_CATEGORY) {
    if (rx.test(tradeLabel)) return category;
  }
  return undefined;
}

const normalized = (value: string | undefined): string =>
  String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();

const productLabel = (value: string): string => normalized(value)
  .replace(/\s*\((?:lvp|lvt)\)/g, '')
  .replace(/\blvp\b/g, 'luxury vinyl plank')
  .replace(/\blvt\b/g, 'luxury vinyl tile');

const normalizedUom = (value: string): string => {
  const unit = String(value || 'EA').toUpperCase().replace(/[\s.]+/g, '');
  return ({ SQFT: 'SF', SQUAREFEET: 'SF', SQYD: 'SY', SQUAREYARDS: 'SY',
    LINFT: 'LF', LINEARFEET: 'LF', EACH: 'EA', GALLON: 'GL', GALLONS: 'GL', GAL: 'GL' } as Record<string, string>)[unit] || unit;
};

/** Combines only compatible products/rates; differing finishes stay separate. */
export function consolidateCustomerSelections(items: CustomerSelectionItem[]): CustomerSelectionItem[] {
  const groups = new Map<string, CustomerSelectionItem>();
  for (const item of items) {
    const key = JSON.stringify([
      item.category, productLabel(item.description), normalized(item.component_code),
      item.uom, item.allowance_per_unit, normalized(item.vendor),
      item.allowance_status || 'confirmed', item.source,
    ]);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...item });
      continue;
    }
    existing.qty = Math.round((existing.qty + item.qty) * 1e6) / 1e6;
    existing.allowance_total = round2(existing.qty * existing.allowance_per_unit);
    existing.trade = [...new Set([...existing.trade.split('; '), item.trade].filter(Boolean))].join('; ');
    existing.notes = [...new Set([...(existing.notes || '').split('; '), item.notes].filter(Boolean))].join('; ') || undefined;
  }
  return Array.from(groups.values()).map((item, i) => ({ ...item, id: `SEL-${i + 1}` }));
}

/** Uses explicit selections first, then fills gaps from audited procurement. */
export function buildCustomerSelections(
  allowances: MaterialAllowanceItem[] | undefined,
  source: CustomerSelectionInput[] = []
): CustomerSelectionItem[] {
  const items: CustomerSelectionItem[] = [];
  const procurement = (allowances || []).filter((item) =>
    Number.isFinite(item.qty) && item.qty > 0 && Number.isFinite(item.unit_cost) && item.unit_cost >= 0
  );
  const sameProduct = (a: { description: string; component_code?: string; uom: string }, b: typeof a) =>
    normalizedUom(a.uom) === normalizedUom(b.uom) &&
    productLabel(a.description) === productLabel(b.description) &&
    (!a.component_code || !b.component_code || normalized(a.component_code) === normalized(b.component_code));
  const append = (input: CustomerSelectionInput, useAudited = true) => {
    const category = classifySelectionCategory(input.trade, input.description);
    if (!category || !Number.isFinite(input.qty) || input.qty <= 0) return;
    const matches = useAudited ? procurement.filter((item) => sameProduct(item, input)) : [];
    const rates = new Set(matches.map((item) => round2(item.unit_cost)));
    // A single audited rate is safe to reuse; conflicting rates need review.
    const audited = rates.size === 1 ? matches[0] : undefined;
    const extracted = input.allowance_per_unit;
    const confirmed = rates.size <= 1 && (Boolean(audited) ||
      (typeof extracted === 'number' && Number.isFinite(extracted) && extracted >= 0));
    const unit = confirmed ? round2(audited?.unit_cost ?? extracted!) : 0;
    items.push({
      id: '', category, trade: input.trade.trim(), component_code: input.component_code,
      description: input.description.trim(), qty: input.qty,
      uom: normalizedUom(input.uom),
      allowance_per_unit: unit, allowance_total: round2(input.qty * unit),
      vendor: input.vendor || audited?.vendor, notes: input.notes,
      allowance_status: confirmed ? 'confirmed' : 'needs_review', source: 'estimate',
    });
  };
  const seen = new Set<string>();
  for (const input of source) {
    const identity = JSON.stringify([
      normalized(input.trade), normalized(input.component_code), normalized(input.description),
      input.qty, normalizedUom(input.uom), input.allowance_per_unit,
      normalized(input.vendor), normalized(input.notes),
    ]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    append(input);
  }
  for (const allowance of procurement) {
    const category = classifySelectionCategory(allowance.trade, allowance.description);
    if (!category) continue;
    if (source.some((input) => Number.isFinite(input.qty) && input.qty > 0 &&
      classifySelectionCategory(input.trade, input.description) && sameProduct(input, allowance))) continue;
    append({ ...allowance, allowance_per_unit: allowance.unit_cost }, false);
  }
  return consolidateCustomerSelections(items);
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
      (sum, item) => sum + (item.allowance_status !== 'needs_review' && Number.isFinite(item.allowance_total) ? item.allowance_total : 0),
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
    const category = SELECTION_CATEGORIES.find((category) => normalized(category) === normalized(item.category)) || 'Other';
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
      item.category,
      item.allowance_status,
      item.vendor,
      item.notes,
    ]),
  });
  let hash = 5381;
  for (let i = 0; i < basis.length; i++) {
    hash = ((hash << 5) + hash + basis.charCodeAt(i)) | 0;
  }
  return `SEL-CHK-${(hash >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}
