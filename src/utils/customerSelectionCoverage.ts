import type { CustomerSelectionInput } from '../types/estimate.js';
import { readXactimateSelectionRows, isSelectableXactimateRow } from './xactimateSelectionSource.js';
import { classifySelectionCategory } from './customerSelections.js';

// Concrete products with visible quantities are evidence for a coverage check.
// The follow-up AI pass still verifies replacement scope, exclusions and pricing.
// Source lines may live in EITHER uploaded document (full estimate or component
// report); selection descriptions must cover every product visible in both.
const PRODUCTS: ReadonlyArray<[string, RegExp]> = [
  ['dishwasher', /\bdish\s*washers?\b/i],
  ['refrigerator', /\brefrigerators?\b/i],
  ['oven or cooktop', /\b(?:ovens?|cooktops?|(?:cooking )?ranges?)\b/i],
  ['microwave', /\bmicrowaves?\b/i],
  ['washer', /\b(?:washing machine|washer)s?\b/i],
  ['dryer', /\bdryers?\b/i],
  ['carpet', /\bcarpet\b/i],
  ['vinyl plank', /\b(?:lvp|luxury vinyl plank|vinyl plank)\b/i],
  ['hardwood flooring', /\b(?:hardwood|wood floor(?:ing)?)\b/i],
  ['flooring', /\b(?:floor(?:ing)?s?|lvp|lvt|laminate|hardwood|wood floor(?:ing)?|vinyl (?:plank|floor|sheet)|carpet|tiles?)\b/i],
  ['tile', /\b(?:porcelain|ceramic|floor|wall) tiles?\b/i],
  ['countertop', /\bcountertops?\b/i],
  ['cabinets', /\b(?:cabinets?|cabinetry|vanit(?:y|ies))\b/i],
  ['paint', /\b(?:paints?|painting|wallcover(?:ing)?|wallpaper)\b/i],
  ['light fixture', /\b(?:recessed\s+(?:lights?|cans?|lighting)|light(?:ing)?\s+fixtures?|pendants?|chandeliers?|sconces?|ceiling\s+fans?|vanity\s+lights?)\b/i],
  ['baseboard or trim', /\b(?:base\s*boards?|crown\s+moldings?|trims?)\b/i],
  ['faucet', /\bfaucets?\b/i],
  ['sink', /\bsinks?\b/i],
  ['toilet', /\btoilets?\b/i],
  ['bathtub', /\b(?:bathtub|tub)s?\b/i],
  ['showerhead', /\bshower\s*heads?\b/i],
  ['pendant lighting', /\bpendant(?: lighting| lights?)?\b/i],
  ['chandelier', /\bchandeliers?\b/i],
  ['ceiling fan', /\bceiling fans?\b/i],
  ['door', /\b(?:interior|exterior|entry|garage) doors?\b/i],
  ['siding', /\bsiding\b/i],
  ['shingles', /\bshingles?\b/i],
];

export function findCustomerSelectionCoverageGaps(
  source: string,
  selections: CustomerSelectionInput[]
): string[] {
  const documents = source.split(/^=====.*=====\s*$/m);
  const sourceLines = documents.flatMap((document) => {
    const tableRows = readXactimateSelectionRows(document);
    return tableRows === null ? document.split(/\r?\n/) : tableRows.filter(isSelectableXactimateRow).map((row) => row.line);
  });
  const lines = sourceLines.filter((line) => {
    if (!/\b\d[\d,.]*\s*(?:SF|LF|EA|SY|GL|GAL|EACH|SQ\.?\s*FT)\b/i.test(line)) return false;
    if (/\b(?:credit|credited|omitted|excluded|exclude|do not perform)\b/i.test(line)) return false;
    if (/\b(?:existing|labor only|labour only|carpet pad|padding|underlayment)\b/i.test(line)) return false;
    if (/\b(?:caulking|putty|sandpaper|tackless|seaming tape)\b/i.test(line)) return false;
    if (/\binstall\b/i.test(line) && !/\bsupply|\breplace|\breplacement|\bfurnish|R\s*&\s*R/i.test(line)) return false;
    if (/^[\d,.]+\s+(?:SF|LF|SY)\s+(?:Floor(?:ing)?|Walls?|Ceiling|(?:Floor|Ceil\.) Perimeter)\b/i.test(line)) return false;
    if (/\b(?:remove|removal|detach|reset|reinstall|cleaning)\b/i.test(line) &&
        !/\b(?:replace|replacement|R\s*&\s*R)\b/i.test(line)) return false;
    // Rough-in, supply and hidden construction lines are not customer-facing
    // finishes and must not demand a selection row.
    if (/\b(?:valve|drain|wiring|breaker|sub\s*panel|duct|housing|flue|rough(?:-|\s)?in|supply\s+line)\b/i.test(line)) return false;
    return true;
  });
  return PRODUCTS.filter(([label, pattern]) => lines.some((line) => pattern.test(line) &&
    !(label === 'baseboard or trim' && classifySelectionCategory('', line) === 'Paint & Finishes')) &&
    !selections.some((item) => pattern.test(item.description))).map(([label]) => label);
}
