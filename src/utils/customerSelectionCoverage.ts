import type { CustomerSelectionInput } from '../types/estimate.js';

// Concrete products with visible quantities are evidence for a coverage check.
// The follow-up AI pass still verifies replacement scope, exclusions and pricing.
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
  ['tile', /\b(?:porcelain|ceramic|floor|wall) tiles?\b/i],
  ['countertop', /\bcountertops?\b/i],
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
  const lines = source.split(/\r?\n/).filter((line) => {
    if (!/\b\d[\d,.]*\s*(?:SF|LF|EA|SY|GL|GAL|EACH|SQ\.?\s*FT)\b/i.test(line)) return false;
    if (/\b(?:credit|credited|omitted|excluded|exclude|do not perform)\b/i.test(line)) return false;
    if (/\b(?:remove|removal|detach|reset|reinstall|cleaning)\b/i.test(line) &&
        !/\b(?:replace|replacement|R\s*&\s*R)\b/i.test(line)) return false;
    return true;
  });
  return PRODUCTS.filter(([, pattern]) => lines.some((line) => pattern.test(line)) &&
    !selections.some((item) => pattern.test(item.description))).map(([label]) => label);
}
