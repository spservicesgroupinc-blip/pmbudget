/**
 * Deterministic dollar-mining recovery for raw Xactimate estimate text.
 *
 * The LLM extraction stage (`xactEngine.processEstimate` -> DeepSeek) can return
 * zero or missing per-trade `direct_subtotal` values (and sometimes zero summary
 * totals) even when every amount is plainly present in the source text. This
 * module re-parses the raw text (pdfjs output or pasted text) with regex
 * heuristics so `applyMinedBackfill` in xactEngine.ts can restore the dollars
 * WITHOUT any extra model calls.
 *
 * Pure function: no I/O, no state, no network. The only dependency is the
 * canonical division taxonomy exported by the deterministic budget engine.
 */
import { DIVISION_PROFILES, matchDivision } from './src/utils/budgetEngine';

export interface MinedLine {
  code: string;
  amounts: number[];
  total: number;
  qty?: number;
  unit?: number;
}

export interface MinedEstimate {
  summary: {
    base_subtotal?: number;
    material_tax?: number;
    op_total?: number;
    total_rcv?: number;
    deductible?: number;
    net_claim?: number;
    overhead_and_profit?: number;
  };
  lines: MinedLine[];
  codes_totals: Record<string, number>;
  division_totals: Record<string, number>;
  amount_tokens: number;
}

/** Defensive extras on top of the canonical division codes. */
const EXTRA_CODES = ['HAZ', 'DMO', 'TLF', 'HVA'];

/** Union of every canonical code in the budget engine plus the extras. */
const KNOWN_CODES: string[] = Array.from(
  new Set<string>([
    ...DIVISION_PROFILES.flatMap((profile) => profile.codes.map((code) => code.toUpperCase())),
    ...EXTRA_CODES,
  ])
).sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));

const CODE_TOKEN_RE = new RegExp(`\\b(?:${KNOWN_CODES.join('|')})\\b`);
/**
 * Loose candidate scan for money-like numbers - every candidate is validated
 * by `isMoneyToken` before it counts as money. The scan stays loose so the
 * `%` lookahead below sees the full numeric run ("7.000%" wins over "7.0").
 */
const MONEY_CANDIDATE_RE = /\$ ?-?\d[\d,]*(?:\.\d+)?|-?\d[\d,]*(?:\.\d+)?/g;
const SUMMARY_ROW_RE =
  /line\s*item\s*total|subtotal|overhead|sales\s*tax|replacement\s*cost|deductible|net\s*claim|total\s*rcv/i;
const MAX_MINED_LINES = 400;
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Strict money-token recognition. Bare integers (quantities, list numbers,
 * years, dimension fragments like `3-1/2`) are NOT money. A token qualifies
 * only when it is one of:
 *   a) `$`-prefixed: `\$ ?-?\d[\d,]*` (`$2,500.00`, `$ 445`);
 *   b) exactly two decimal places: `-?\d{1,3}(?:,\d{3})*\.\d{2}` or
 *      `-?\d+\.\d{2}` (`1,369.60`, `46.50`);
 *   c) a thousands-grouped integer: `-?\d{1,3}(?:,\d{3})+` (`11,971`).
 */
function isMoneyToken(raw: string): boolean {
  const hasDollar = raw.startsWith('$');
  let body = (hasDollar ? raw.slice(1) : raw).trim();
  if (body.startsWith('-')) body = body.slice(1);

  const dot = body.indexOf('.');
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const decPart = dot === -1 ? undefined : body.slice(dot + 1);

  if (!/^\d{1,3}(?:,\d{3})*$/.test(intPart) && !/^\d+$/.test(intPart)) return false;
  if (decPart !== undefined) return /^\d{2}$/.test(decPart);
  if (hasDollar) return true;
  return intPart.includes(','); // ungrouped integer: quantity, list number or year
}

/**
 * Extracts ordered money values from `text`, accepting strict shapes only
 * (see `isMoneyToken`). Bare integers and dimension fragments are skipped,
 * as are tokens immediately followed by `%` (e.g. `7.000%`).
 */
function extractMoneyValues(text: string): number[] {
  const values: number[] = [];
  const re = new RegExp(MONEY_CANDIDATE_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const raw = match[0];
    // Walk across the full numeric run so "7.000%" is recognised as one percent token.
    let cursor = match.index + raw.length;
    while (cursor < text.length && /[0-9.,]/.test(text[cursor])) cursor++;
    if (text[cursor] === '%') {
      re.lastIndex = cursor + 1;
      continue;
    }
    if (!isMoneyToken(raw)) continue;
    const value = Number(raw.replace(/[$, ]/g, ''));
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
}

/** Mines a single source line into a rolled-up trade line (code + dollars). */
function mineLine(rawLine: string): MinedLine | undefined {
  if (!rawLine.trim()) return undefined;

  const upper = rawLine.toUpperCase();
  const codeMatch = CODE_TOKEN_RE.exec(upper);
  if (!codeMatch) return undefined;
  const code = codeMatch[0];

  const amounts = extractMoneyValues(rawLine);
  if (amounts.length === 0) return undefined;

  // Summary rows are handled by the summary miner; a row is still mined when
  // its code token appears before any summary keyword text.
  const summaryRow = SUMMARY_ROW_RE.exec(rawLine);
  if (summaryRow && codeMatch.index > summaryRow.index) return undefined;

  const total = amounts[amounts.length - 1];
  let qty: number | undefined;
  let unit: number | undefined;
  if (amounts.length >= 3) {
    // Assume the trailing [qty, unit, total] shape; formulas vary so only keep
    // qty/unit when they actually multiply out to the total.
    const q = amounts[amounts.length - 3];
    const u = amounts[amounts.length - 2];
    if (Math.abs(q * u - total) <= Math.max(1, Math.abs(total) * 0.01)) {
      qty = q;
      unit = u;
    }
  } else if (amounts.length === 2 && amounts[0] > 0) {
    qty = amounts[0];
  }
  return { code, amounts, total, qty, unit };
}

type SummaryField = keyof MinedEstimate['summary'];

/**
 * Keyword cores used to locate each summary row. Amounts are read from the
 * remainder of the same line (or a standalone amount on the following line),
 * which is tolerant of `:`, `$`, commas and long alignment whitespace.
 */
const SUMMARY_PATTERNS: Array<{ field: SummaryField; patterns: RegExp[] }> = [
  { field: 'total_rcv', patterns: [/(?:replacement\s*cost\s*value|total\s*rcv|\brcv\b)/i] },
  { field: 'base_subtotal', patterns: [/line\s*item\s*total/i, /(?:base\s*subtotal|subtotal)/i] },
  { field: 'material_tax', patterns: [/(?:material\s*sales\s*tax|sales\s*tax)/i] },
  { field: 'op_total', patterns: [/(?:overhead\s*(?:&|and)\s*profit|\bO\s*&\s*P\b|op\s*total)/i] },
  {
    field: 'overhead_and_profit',
    patterns: [/(?:overhead\s*(?:&|and)\s*profit|\bO\s*&\s*P\b|op\s*total)/i],
  },
  { field: 'deductible', patterns: [/deductible/i] },
  { field: 'net_claim', patterns: [/net\s*claim/i] },
];

/** Reads the money value that follows a summary keyword occurrence. */
function valueAfterKeyword(text: string, keyword: RegExp): number | undefined {
  const re = new RegExp(keyword.source, keyword.flags.includes('i') ? 'gi' : 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const from = match.index + match[0].length;
    const lineEnd = text.indexOf('\n', from);
    const tail = text.slice(from, lineEnd === -1 ? text.length : lineEnd);
    const values = extractMoneyValues(tail);
    if (values.length > 0) return values[values.length - 1];
    if (lineEnd !== -1) {
      // Tolerate layouts where the amount sits alone on the next line.
      const nextEnd = text.indexOf('\n', lineEnd + 1);
      const nextLine = text.slice(lineEnd + 1, nextEnd === -1 ? text.length : nextEnd).trim();
      if (isMoneyToken(nextLine)) {
        const value = Number(nextLine.replace(/[$, ]/g, ''));
        if (Number.isFinite(value)) return value;
      }
    }
  }
  return undefined;
}

/**
 * Mine dollar amounts straight out of raw estimate text.
 *
 * Returns empty structures (never throws) for empty/garbage input.
 */
export function mineEstimateDollars(text: string): MinedEstimate {
  const safe = typeof text === 'string' ? text : '';
  const summary: MinedEstimate['summary'] = {};

  if (safe.trim()) {
    for (const { field, patterns } of SUMMARY_PATTERNS) {
      for (const pattern of patterns) {
        const value = valueAfterKeyword(safe, pattern);
        if (value !== undefined) {
          summary[field] = value;
          break; // first pattern with a hit wins (caller-defined priority)
        }
      }
    }
  }

  const lines: MinedLine[] = [];
  if (safe) {
    for (const rawLine of safe.split(/\r?\n/)) {
      if (lines.length >= MAX_MINED_LINES) break;
      const mined = mineLine(rawLine);
      if (mined) lines.push(mined);
    }
  }

  const codes_totals: Record<string, number> = {};
  const division_totals: Record<string, number> = {};
  for (const line of lines) {
    codes_totals[line.code] = round2((codes_totals[line.code] || 0) + line.total);
    const division = matchDivision({ category_codes_included: [line.code] }).division;
    division_totals[division] = round2((division_totals[division] || 0) + line.total);
  }

  return {
    summary,
    lines,
    codes_totals,
    division_totals,
    amount_tokens: extractMoneyValues(safe).length,
  };
}
