import { classifySelectionCategory } from './customerSelections.js';

export interface XactimateSelectionRow {
  line: string;
  description: string;
  qty: number;
  uom: string;
  replace: number;
  tax: number;
  room: string;
}

/** Read numbered estimate rows only, never room dimensions or summary totals.
 * null means an unsupported/incomplete table: keep the AI extraction path.
 */
export function readXactimateSelectionRows(source: string): XactimateSelectionRow[] | null {
  const lines = source.split(/\r?\n/);
  const rows: XactimateSelectionRow[] = [];
  let table = false;
  let found = false;
  let room = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const roomHeader = line.match(/^(.+?)\s+Height:\s*/i);
    if (roomHeader) room = roomHeader[1].trim();
    if (/^DESCRIPTION\b/i.test(line) && !/^DESCRIPTION\s+(?:QTY|QUANTITY)\s+REMOVE\s+REPLACE\s+TAX\s+O&P\s+TOTAL\s*$/i.test(line)) return null;
    if (/^DESCRIPTION\s+(?:QTY|QUANTITY)\s+REMOVE\s+REPLACE\s+TAX\s+O&P\s+TOTAL\s*$/i.test(line)) {
      table = true;
      found = true;
      continue;
    }
    if (/^(?:Totals?:|Line Item Totals?:|=====)/i.test(line)) table = false;
    if (!table || !/^\d+\.\s/.test(line)) continue;
    let text = line;
    // PDF text can wrap a description before its quantity/price columns.
    while (!/\s[\d,.]+\s+(?:SF|LF|EA|SY|GL|GAL|SH|SQ|ROLL|SET)\s/i.test(text) &&
      i + 1 < lines.length && !/^\s*(?:\d+\.\s|Totals?:|=====)/i.test(lines[i + 1])) {
      text += ` ${lines[++i].trim()}`;
    }
    const match = text.match(/^\d+\.\s+(.+?)\s+(-?[\d,]+(?:\.\d+)?)\s+(SF|LF|EA|SY|GL|GAL|SH|SQ|ROLL|SET)\s+(.+)$/i);
    if (!match) return null;
    const amounts = match[4].trim().split(/\s+/);
    // Refuse other column layouts rather than interpreting ACV or tax as a rate.
    if (amounts.length !== 5 || amounts.some((token) => !/^-?[\d,]+\.\d{2}$/.test(token))) return null;
    rows.push({ line: text, description: match[1].trim(), qty: Number(match[2].replace(/,/g, '')),
      uom: match[3].toUpperCase(), replace: Number(amounts[1].replace(/,/g, '')),
      tax: Number(amounts[2].replace(/,/g, '')), room });
  }
  return found ? rows : null;
}

/** Installation of an existing/customer-supplied product is not a new choice. */
export function isSelectableXactimateRow(row: XactimateSelectionRow): boolean {
  return row.qty > 0 && row.replace > 0 &&
    !/\b(?:credit|credited|omitted|excluded|do not perform|existing|labor only|labour only)\b/i.test(row.description) &&
    Boolean(classifySelectionCategory('', row.description));
}
