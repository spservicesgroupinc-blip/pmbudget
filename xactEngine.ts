/**
 * Xactimate -> budget extraction engine (server-only).
 *
 * Stage 1 (LLM): extract/pack metadata, trade roll-ups, direct subtotals,
 * retail labor/material splits, exclusions, scheduling hints and material
 * allowance line items.
 * Stage 2 (deterministic): normalize + validate, then run the shared budget
 * engine so every number and checksum is recomputed in code, never trusted
 * from the model.
 */
import { DeepSeekDeadlineError, deepseekJsonWithMeta, resolveModel } from './deepseek.js';
import { applyBudgetEngine, DIVISION_PROFILES, matchDivision } from './src/utils/budgetEngine.js';
import { buildCustomerSelections, classifySelectionCategory } from './src/utils/customerSelections.js';
import { findCustomerSelectionCoverageGaps } from './src/utils/customerSelectionCoverage.js';
import { recoverCustomerSelectionPrices } from './customerSelectionPricing.js';
import { runCustomerSelectionRerun } from './customerSelectionExtraction.js';
import { mineEstimateDollars } from './estimateTextMiner.js';
import { extractXactimateSelectionSource } from './xactSelectionSource.js';
import { SOURCE_DOCUMENTS_GUIDE } from './src/utils/sourceDocuments.js';
import type { MinedEstimate } from './estimateTextMiner.js';
import type {
  EstimateResult,
  CustomerSelectionInput,
  MaterialAllowanceItem,
  TradeSection,
} from './src/types/estimate.js';

export const ESTIMATE_ENGINE_VERSION = 'budget-engine-v6-source-selections';

const DIVISION_TABLE = `- Demolition & Hauling | DEM, DMO, WTR | In-House Self-Perform | direct labor = 72% of retail labor; consumables only
- Framing & Rough Carpentry | FRM | In-House Self-Perform | direct labor = 72%
- Finish Trim & Doors | FNC, DOR, FIN | In-House Self-Perform | direct labor = 72%
- Drywall & Plaster | DRY, PLA, INS | Subcontract (Labor Only) | sub labor = 68%
- Painting & Wallcovering | PNT, WAL | In-House Self-Perform | direct labor = 70%
- Flooring (Hard Surfaces) | FCV, FCT, WDN, FCH, FNH | Subcontract (Labor Only) | sub labor = 65%
- Flooring (Carpet) | FCC | Turnkey Subcontract | total buyout = 68% of trade RCV
- Cabinets & Countertops | CAB, CTR | Split (Buyout + In-House) | install labor = 72%
- Roofing & Gutters | RFG, GUT | Turnkey Subcontract | total buyout = 68%
- Siding & Exterior | SDG, SOF, WDW | Turnkey Subcontract | total buyout = 68%
- Electrical | ELE | Turnkey Subcontract | total buyout = 68%
- Plumbing | PLM | Turnkey Subcontract | total buyout = 68%
- HVAC | HVC | Turnkey Subcontract | total buyout = 68%
- Cleaning & Final Punch | CLN | In-House Self-Perform | direct labor = 72%; consumables only`;

const ESTIMATE_SYSTEM_PROMPT = `You are the Senior Construction Estimator and Controller for Hays + Sons Complete Restoration.
You convert raw Xactimate insurance estimates into ONE strict JSON object that drives subcontractor
budgeting, buyout and field work-order generation. You work with audit precision.

NON-NEGOTIABLE RULES
1. Return only the JSON object. No markdown, no commentary, no trailing text.
2. Never invent line items or money. Extract what is present; use 0 when a value is genuinely absent.
3. All numbers are plain JSON numbers (no $ signs, commas or text).
4. Direct subtotals are PRE-tax and PRE-O&P. Billable amounts include tax/O&P only when stated.

1) PROJECT METADATA
Extract client_name (insured), claim_number, carrier, policy_number, property_address (loss site),
insured_phone, deductible, total_rcv (gross Replacement Cost Value), net_claim,
overhead_and_profit (dollars), base_subtotal (sum of line items before tax and O&P),
material_tax (sales tax included in the summary), op_total (total overhead + profit dollars).
Use 0 for absent numbers and "" for absent strings. Never guess contact details.

2) TRADE PACKAGE ROLL-UP
Consolidate every line item across all rooms into 9-16 trade packages (never output micro line items).
Assign each package to exactly one canonical division (use these exact names + execution types):
${DIVISION_TABLE}
For each trade package provide:
- task_id: sequential T-1..T-N in standard construction sequence.
- trade_name: plain-language package name (no codes).
- trade_division + execution_type: exactly as the table above.
- category_codes_included: top-level Xactimate codes only, e.g. ["DRY"].
- direct_subtotal: sum of this package's line items before tax and O&P.
  Every package MUST carry a positive direct_subtotal whenever its line items appear in the estimate - never return 0 when line items exist.
- retail_labor: labor + equipment dollars carried by this package when visible in the estimate; else 0.
- retail_material: material dollars carried by this package when visible; else 0.
- billable_revenue: best-effort package RCV (the server recomputes this deterministically).
- suggested_duration_days: realistic integer workdays: demo/mitigation 1-3, insulation 1-2,
  MEP rough-in 2-4, drywall 3-7 (allow mud/dry time), paint 2-5, flooring 2-4,
  cabinetry/trim 2-4, exterior/roof 2-4, final punch 1-2.
- predecessors: Finish-to-Start task ids, e.g. "T-2, T-3"; "" for the first package.
  Drywall depends on framing/insulation/MEP; paint after drywall; flooring after paint;
  trim/cabinets after paint; punch after all prior trades. Parallel rough trades share predecessors.
- scope_summary: 2-4 sentences of action-oriented field scope in plain language. Start with a verb.
  Include the main rooms/areas and quantities that are visible. NEVER include money, unit rates,
  margin language, insurance jargon or Xactimate category codes in this summary.
- exclusions: credited, omitted or DO NOT PERFORM items for this package; [] when none.

3) CUSTOMER SELECTIONS (customer_selections, independent of procurement)
${SOURCE_DOCUMENTS_GUIDE}
Customer selection data is often SPLIT across the two documents: the full estimate names the
choice and the installed room-by-room scope, while the component report supplies the exact
material quantity and material-only price for the same product - join them into ONE row per
product, never duplicate.
Read EVERY room and line item of the full estimate AND every table of the component report,
including customer choices supplied by turnkey subcontractors.
Extract ALL new/replacement finishes the customer must choose: flooring/carpet, tile and grout
color, cabinets, countertops, paint/wallcovering, trim/doors, plumbing fixtures, decorative
lighting, windows/exterior finishes, hardware and appliances. Customer-choice signals such as
"customer to select", "owner to choose", "TBD", and color/finish/grade/style notes indicate a
selection even when no price is shown. Never omit a finish because it appears in only one
document, its trade is turnkey or its material price is absent. Do not impose a row limit.
- Exclude removal-only, detach/reset/reinstall, cleaning, labor-only, credited/negative and
  DO NOT PERFORM items, and hidden construction supplies (drywall, framing, adhesives, etc.).
  A replacement line that includes installation still represents a customer material choice.
- Keep different materials, grades, sizes, finishes and units separate. Each physical product
  appears once: do not count both the estimate line and its component-report equivalent.
- When the component report provides that product, use its exact material quantity and unit,
  WITHOUT additional waste. Otherwise use the estimate's installed quantity, WITHOUT waste.
- Use the same plain-language product description and component_code as material_allowances
  for matching products. Include rooms/areas and the choice needed in notes.
- allowance_per_unit is MATERIAL-ONLY, pre-tax pricing explicitly supported by the source.
  Read component pricing tables and Material/Mat columns, not just the estimate's
  combined UNIT PRICE. If only an extended material amount is shown, return it as
  material_total and divide by that material quantity to obtain allowance_per_unit.
  Convert component units to the selection unit when needed (1 SY = 9 SF).
  NEVER use a combined supply/install rate, labor, tax or O&P as a material allowance.
  Use null when material-only pricing is unavailable; an explicit zero is allowed only if stated.
- trade matches the owning trade_name; suggested vendor may be omitted if unknown.
- Before returning, check every source room/category in BOTH documents against this list for
  omitted choices. Return [] only when the source contains no customer-selectable replacement finishes.
- Paint application rows still require a color/finish choice: retain the painted SF/LF scope
  when no paint gallon quantity is stated. Do not invent gallons or material-only prices.
- Room measurements (SF Floor, SY Flooring, LF Perimeter) describe geometry, not replacement scope.
  "Install Baseboard"/"Install Casing" are installation-only; exclude them unless supply is stated.

4) MATERIAL ALLOWANCE ITEMS (procurement list, Output 2)
Itemize direct materials trades must procure. Rules:
- When a component breakdown exists, use exact component quantities; do NOT add extra waste factors.
- Otherwise apply waste: flooring/tile/trim +10%, drywall sheets +8%, paint/hardware/appliances +0%.
- unit_cost is the direct (non-retail-markup) cost per unit in plain dollars; qty x unit_cost will be
  recomputed server-side. Provide uom (SF, LF, EA, SH, GL, ROLL, ...) and a suggested vendor.
- trade must exactly match the trade_name above.
- Skip turnkey divisions entirely (carpet, roofing/gutters, siding/exterior, electrical, plumbing, HVAC):
  those subcontractors furnish their own materials.
- Include all supported materials, deduplicated. If materials cannot be itemized reliably, return an empty array
  instead of inventing rows.

5) OUTPUT
Return exactly the schema object described in the developer message. Unknown optional values may be
omitted, but task_id, trade_name, direct_subtotal and scheduling fields should always be present.`;

export const ESTIMATE_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    project_meta: {
      type: 'object',
      properties: {
        client_name: { type: 'string' },
        claim_number: { type: 'string' },
        carrier: { type: 'string' },
        policy_number: { type: 'string' },
        property_address: { type: 'string' },
        insured_phone: { type: 'string' },
        deductible: { type: 'number' },
        total_rcv: { type: 'number', description: 'Gross Replacement Cost Value' },
        net_claim: { type: 'number' },
        overhead_and_profit: { type: 'number' },
        base_subtotal: { type: 'number', description: 'Sum of line items before tax and O&P' },
        material_tax: { type: 'number', description: 'Material sales tax included in the summary' },
        op_total: { type: 'number', description: 'Total overhead + profit dollars' },
      },
      required: ['client_name', 'claim_number', 'total_rcv'],
    },
    trade_sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'T-1, T-2, ...' },
          trade_name: { type: 'string' },
          trade_division: { type: 'string' },
          execution_type: { type: 'string' },
          category_codes_included: { type: 'array', items: { type: 'string' } },
          direct_subtotal: { type: 'number' },
          retail_labor: { type: 'number' },
          retail_material: { type: 'number' },
          billable_revenue: { type: 'number' },
          suggested_duration_days: { type: 'integer' },
          predecessors: { type: 'string' },
          scope_summary: { type: 'string' },
          exclusions: { type: 'array', items: { type: 'string' } },
        },
        required: ['task_id', 'trade_name', 'direct_subtotal', 'suggested_duration_days', 'predecessors'],
      },
    },
    customer_selections: {
      type: 'array',
      description: 'All customer finish choices, including turnkey trades and unpriced choices.',
      items: {
        type: 'object',
        properties: {
          trade: { type: 'string' },
          component_code: { type: 'string' },
          description: { type: 'string' },
          qty: { type: 'number' },
          uom: { type: 'string' },
          allowance_per_unit: { type: ['number', 'null'] },
          material_total: { type: ['number', 'null'], description: 'Extended material-only pre-tax amount for this selection quantity, never combined line total.' },
          vendor: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['trade', 'description', 'qty', 'uom', 'allowance_per_unit'],
      },
    },
    material_allowances: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          trade: { type: 'string' },
          component_code: { type: 'string' },
          description: { type: 'string' },
          qty: { type: 'number' },
          uom: { type: 'string' },
          unit_cost: { type: 'number' },
          vendor: { type: 'string' },
        },
        required: ['trade', 'description', 'qty', 'uom', 'unit_cost'],
      },
    },
  },
  required: ['project_meta', 'trade_sections', 'customer_selections'],
} as const;

/**
 * customer_selections schema slice shared with the standalone rerun prompt
 * (`runCustomerSelectionRerun` in customerSelectionExtraction.ts).
 */
const SELECTION_SCHEMA_JSON = JSON.stringify(
  ESTIMATE_RESPONSE_SCHEMA.properties.customer_selections,
  null,
  2
);

const num = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};
const optNum = (value: unknown): number | undefined => {
  const parsed = num(value);
  return parsed !== 0 ? parsed : undefined;
};
const materialPrice = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value :
    typeof value === 'string' && /^\s*\$?\s*(?:\d[\d,]*(?:\.\d+)?|\.\d+)\s*$/.test(value) ? num(value) : null;
  return parsed !== null && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const str = (value: unknown): string =>
  value === undefined || value === null ? '' : String(value).trim();
const strList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((v) => str(v)).filter(Boolean)
    : str(value)
      ? [str(value)]
      : [];

/** Normalizes raw model output into a safe EstimateResult (without budget math). */
export function normalizeEstimate(raw: unknown): { estimate: EstimateResult; warnings: string[] } {
  const warnings: string[] = [];
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const metaRaw = (obj.project_meta && typeof obj.project_meta === 'object'
    ? obj.project_meta
    : {}) as Record<string, unknown>;

  const project_meta: EstimateResult['project_meta'] = {
    client_name: str(metaRaw.client_name) || 'Unknown Insured',
    claim_number: str(metaRaw.claim_number) || 'N/A',
    carrier: str(metaRaw.carrier) || 'Unknown Carrier',
    policy_number: str(metaRaw.policy_number) || undefined,
    total_rcv: num(metaRaw.total_rcv),
    net_claim: optNum(metaRaw.net_claim),
    overhead_and_profit: optNum(metaRaw.overhead_and_profit),
    property_address: str(metaRaw.property_address) || undefined,
    insured_phone: str(metaRaw.insured_phone) || undefined,
    deductible: optNum(metaRaw.deductible),
    base_subtotal: optNum(metaRaw.base_subtotal),
    material_tax: optNum(metaRaw.material_tax),
    op_total: optNum(metaRaw.op_total),
  };

  const usedIds = new Set<string>();
  const rawTrades = Array.isArray(obj.trade_sections) ? obj.trade_sections : [];
  const trade_sections: TradeSection[] = rawTrades.map((item, index) => {
    const t = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    let taskId = str(t.task_id).toUpperCase().replace(/\s+/g, '');
    const match = taskId.match(/^T-(\d+)$/);
    taskId = match ? `T-${parseInt(match[1], 10)}` : `T-${index + 1}`;
    while (usedIds.has(taskId)) taskId = `T-${parseInt(taskId.slice(2), 10) + 1}`;
    usedIds.add(taskId);

    const tradeName = str(t.trade_name) || `Trade Package ${index + 1}`;
    if (!str(t.trade_name)) warnings.push(`${taskId}: missing trade_name; placeholder assigned.`);
    const scope = str(t.scope_summary);
    if (!scope) warnings.push(`${taskId} (${tradeName}): missing scope_summary.`);

    const duration = Math.min(30, Math.max(1, Math.round(num(t.suggested_duration_days) || 2)));

    return {
      task_id: taskId,
      trade_name: tradeName,
      category_codes_included: strList(t.category_codes_included).map((c) => c.toUpperCase()),
      billable_revenue: num(t.billable_revenue),
      suggested_duration_days: duration,
      predecessors: str(t.predecessors),
      scope_summary: scope,
      trade_division: str(t.trade_division) || undefined,
      execution_type: str(t.execution_type) || undefined,
      direct_subtotal: optNum(t.direct_subtotal),
      retail_labor: optNum(t.retail_labor),
      retail_material: optNum(t.retail_material),
      exclusions: strList(t.exclusions),
    };
  });

  if (trade_sections.length === 0) warnings.push('No trade sections were extracted from the estimate.');
  if (trade_sections.length > 24) warnings.push('More than 24 trade sections extracted; verify the roll-up quality.');

  const rawAllowances = Array.isArray(obj.material_allowances) ? obj.material_allowances : [];
  const material_allowances: MaterialAllowanceItem[] = rawAllowances
    .flatMap((item) => {
      const a = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const qty = num(a.qty);
      const unit = materialPrice(a.unit_cost);
      if (unit === null) return [];
      return [{
        trade: str(a.trade),
        component_code: str(a.component_code) || undefined,
        description: str(a.description),
        qty,
        uom: str(a.uom).toUpperCase() || 'EA',
        unit_cost: unit,
        extended_cost: Math.round(qty * unit * 100) / 100,
        vendor: str(a.vendor) || undefined,
      }];
    })
    .filter((a) => a.description && a.qty > 0 && a.trade && a.unit_cost >= 0);

  const rawSelections = Array.isArray(obj.customer_selections) ? obj.customer_selections : [];
  if (!Array.isArray(obj.customer_selections)) {
    warnings.push('AI omitted the customer selection list; only procurement-derived choices are available. Reprocess the estimate to include turnkey finishes.');
  }
  const customer_selection_source: CustomerSelectionInput[] = [];
  for (const raw of rawSelections) {
    const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const description = str(input.description);
    const trade = str(input.trade);
    const qty = num(input.qty);
    if (!description || qty <= 0 || !classifySelectionCategory(trade, description)) {
      warnings.push(`Customer selection omitted: ${description || 'unnamed item'} has no supported finish or positive quantity.`);
      continue;
    }
    let unit = materialPrice(input.allowance_per_unit);
    const total = materialPrice(input.material_total);
    if (unit === null && total !== null) unit = total / qty;
    customer_selection_source.push({
      trade, description, qty,
      component_code: str(input.component_code) || undefined,
      uom: str(input.uom).toUpperCase() || 'EA',
      allowance_per_unit: unit !== null && Number.isFinite(unit) && unit >= 0 ? unit : null,
      vendor: str(input.vendor) || undefined,
      notes: str(input.notes) || undefined,
      ...(materialPrice(input.installed_unit_cost) !== null ? { installed_unit_cost: materialPrice(input.installed_unit_cost)! } : {}),
      ...(materialPrice(input.installed_tax_per_unit) !== null ? { installed_tax_per_unit: materialPrice(input.installed_tax_per_unit)! } : {}),
    });
  }

  const estimate: EstimateResult = {
    project_meta,
    trade_sections,
    material_allowances,
    customer_selection_source,
  };
  return { estimate, warnings };
}

const TRADE_WARNING_CAP = 12;

const isLiveAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Realistic default durations for packages rebuilt by the text miner (field order). */
function minedDefaultDuration(division: string): number {
  if (/demolition|cleaning/i.test(division)) return 2;
  if (/drywall/i.test(division)) return 4;
  if (/electrical|plumbing|hvac/i.test(division)) return 3;
  if (/painting/i.test(division)) return 3;
  if (/flooring/i.test(division)) return 3;
  if (/framing/i.test(division)) return 3;
  return 2;
}

/**
 * Deterministic backfill of dollars the LLM failed to extract (no extra model
 * calls): restores missing per-trade subtotals from mined line-item totals,
 * rebuilds trade packages when the model returned none, and copies missing
 * summary totals. Returns the number of recovered fields plus audit warnings.
 */
export function applyMinedBackfill(
  estimate: EstimateResult,
  mined: MinedEstimate
): { filled: number; warnings: string[] } {
  const warnings: string[] = [];
  let filled = 0;
  let tradeWarnings = 0;

  const consumedCodes = new Set<string>();
  const consumedDivisions = new Set<string>();

  const codeDivision = (code: string): string =>
    matchDivision({ category_codes_included: [code] }).division;

  // The code pass can drain a whole division's money; block the division
  // fallback from re-allocating the same dollars to sibling trades.
  const divisionDrainedByCodes = (division: string): boolean => {
    const codes = Object.keys(mined.codes_totals).filter(
      (code) => isLiveAmount(mined.codes_totals[code]) && codeDivision(code) === division
    );
    return codes.length > 0 && codes.every((code) => consumedCodes.has(code));
  };

  const warnTrade = (taskId: string, amount: number): void => {
    if (tradeWarnings >= TRADE_WARNING_CAP) return;
    tradeWarnings++;
    warnings.push(
      `${taskId}: recovered $${amount.toFixed(2)} from the raw estimate text (model returned no subtotal).`
    );
  };

  // 1) Trade subtotals: code match first, then division match (each bucket
  //    is single-use so two trades can never consume the same dollars twice).
  for (const trade of estimate.trade_sections) {
    if (isLiveAmount(trade.direct_subtotal)) continue; // never overwrite positive model values

    const codes = (trade.category_codes_included || [])
      .map((code) => String(code).toUpperCase().trim())
      .filter(Boolean);
    const matched = codes.filter(
      (code) => !consumedCodes.has(code) && isLiveAmount(mined.codes_totals[code])
    );
    if (matched.length > 0) {
      for (const code of matched) consumedCodes.add(code);
      const recovered = round2(matched.reduce((sum, code) => sum + mined.codes_totals[code], 0));
      if (isLiveAmount(recovered)) {
        trade.direct_subtotal = recovered;
        filled++;
        warnTrade(trade.task_id, recovered);
      }
      continue;
    }

    const division = matchDivision(trade).division;
    if (consumedDivisions.has(division) || divisionDrainedByCodes(division)) continue;
    const divisionTotal = mined.division_totals[division];
    if (!isLiveAmount(divisionTotal)) continue;

    // Split the single-use division bucket across its still-unfunded trades.
    const peers = estimate.trade_sections.filter(
      (candidate) =>
        !isLiveAmount(candidate.direct_subtotal) && matchDivision(candidate).division === division
    );
    if (peers.length === 0) continue;
    consumedDivisions.add(division);
    const share = round2(divisionTotal / peers.length);
    for (const peer of peers) {
      peer.direct_subtotal = share;
      filled++;
      warnTrade(peer.task_id, share);
    }
  }

  // 2) Empty-trades rescue: rebuild packages deterministically from mined lines
  //    (the budget engine + scheduler fill division, execution type and deps).
  if (estimate.trade_sections.length === 0) {
    const rebuilt: TradeSection[] = [];
    for (const profile of DIVISION_PROFILES) {
      const divisionTotal = mined.division_totals[profile.division];
      if (!isLiveAmount(divisionTotal)) continue;
      rebuilt.push({
        task_id: `T-${rebuilt.length + 1}`,
        trade_name: profile.division,
        category_codes_included: Object.keys(mined.codes_totals).filter(
          (code) => isLiveAmount(mined.codes_totals[code]) && codeDivision(code) === profile.division
        ),
        billable_revenue: 0,
        suggested_duration_days: minedDefaultDuration(profile.division),
        predecessors: '',
        scope_summary: '',
        direct_subtotal: round2(divisionTotal),
      });
    }
    if (rebuilt.length > 0) {
      estimate.trade_sections.push(...rebuilt);
      filled += rebuilt.length;
      warnings.push(`Rebuilt ${rebuilt.length} trade packages from raw line items (model returned none).`);
    }
  }

  // 3) Summary totals backfill (only for missing/zero values).
  const metaFields = [
    'base_subtotal',
    'material_tax',
    'overhead_and_profit',
    'op_total',
    'total_rcv',
    'deductible',
    'net_claim',
  ] as const;
  let summaryRecovered = false;
  for (const field of metaFields) {
    if (isLiveAmount(estimate.project_meta[field])) continue;
    const recovered = mined.summary[field];
    if (!isLiveAmount(recovered)) continue;
    estimate.project_meta[field] = round2(recovered);
    summaryRecovered = true;
    filled++;
  }
  if (summaryRecovered) {
    warnings.push('Recovered estimate summary totals from raw text (model returned partial/zero values).');
  }

  // 4) Zero-visibility warnings for UI transparency (always evaluated).
  if (mined.amount_tokens === 0) {
    warnings.push('No dollar amounts were found in the source text - the budget cannot be populated from this file.');
  } else if (estimate.trade_sections.every((trade) => !isLiveAmount(trade.direct_subtotal))) {
    warnings.push('Dollar amounts exist in the source text but could not be mapped to trade packages.');
  }

  return { filled, warnings };
}

export interface ProcessEstimateResult extends EstimateResult {}

/** Full pipeline: LLM extraction -> normalization -> deterministic budget engine. */
export async function processEstimate(
  estimateText: string,
  opts: { userPrompt?: string } = {}
): Promise<ProcessEstimateResult> {
  const startedAt = Date.now();
  const userPrompt =
    opts.userPrompt ||
    'Process this Xactimate estimate into subcontractor trade packages, the master budget inputs and Gantt dependency schedule.';

  // Serverless hosts (Vercel) terminate the request at the configured
  // maxDuration (60s in vercel.json) with a bare 504 gateway timeout. Bound
  // the AI phase so the pipeline instead stops cleanly and returns an
  // actionable error while keeping every result it already computed. Local
  // dev has no such limit, so the budget only applies where it matters.
  const configuredBudget = Number(process.env.PROCESS_TIME_BUDGET_MS);
  const timeBudgetMs =
    Number.isFinite(configuredBudget) && configuredBudget > 0
      ? configuredBudget
      : process.env.VERCEL
        ? 50_000
        : 0;
  const deadline = timeBudgetMs > 0 ? startedAt + timeBudgetMs : undefined;

  // Speculative standalone selection pass: it needs nothing from the budget
  // pass, so it runs in PARALLEL and the dedicated AI read adds accuracy
  // without adding serial wall-clock time to the serverless request. The
  // result is consumed only when the budget pass omits the selection list or
  // drops a source-visible product; otherwise the in-flight call is aborted.
  const selectionRerunAbort = new AbortController();
  const speculativeSelectionRerun = runCustomerSelectionRerun({
    sourceText: estimateText,
    existing: [],
    coverageGaps: [],
    selectionSchemaJson: SELECTION_SCHEMA_JSON,
    deadline,
    signal: selectionRerunAbort.signal,
  }).catch(() => null);

  const mainResponse = await deepseekJsonWithMeta<unknown>({
    system: `${ESTIMATE_SYSTEM_PROMPT}\n\n### RESPONSE JSON SCHEMA (STRICT)\n${JSON.stringify(
      ESTIMATE_RESPONSE_SCHEMA,
      null,
      2
    )}\n\nReturn ONLY a single valid JSON object matching this schema. No markdown fences, no commentary.`,
    user: `${userPrompt}\n\nSOURCE DOCUMENTS (full Xactimate estimate and/or component breakdown report, each introduced by a ===== header):\n\n${estimateText}`,
    temperature: 0.1,
    label: 'estimate',
    attempts: 3,
    requireComplete: true,
    deadline,
  }).catch((err) => {
    selectionRerunAbort.abort();
    throw err;
  });
  const { data, usage, model, repaired, truncated, attempts } = mainResponse;

  if (!data || typeof data !== 'object') {
    selectionRerunAbort.abort();
    throw new Error('AI did not return the required estimate object. Reprocess the estimate.');
  }
  const rawData = data as Record<string, unknown>;

  // Standard estimate tables provide authoritative finish scope even when the
  // model omits paint choices or substitutes a room's floor area. Their REPLACE
  // column is an installed rate, so it cannot verify a material-only allowance.
  // Leave component reports and unfamiliar layouts on the existing AI path.
  const hasMaterialPricing = /COMPONENT BREAKDOWN REPORT|component\s+breakdown|actual\s+cost\s+qty|material\s+(?:total|unit\s+(?:cost|price))|\b(?:description|qty|quantity).*\b(?:material|mat)\b/i.test(estimateText);
  const sourceSelections = hasMaterialPricing ? null : extractXactimateSelectionSource(estimateText);
  if (sourceSelections !== null) {
    rawData.customer_selections = sourceSelections;
    if (Array.isArray(rawData.material_allowances)) {
      rawData.material_allowances = rawData.material_allowances.filter((raw) => {
        const row = raw as Record<string, unknown> | null;
        return !row || !classifySelectionCategory(str(row.trade), str(row.description));
      });
    }
  }

  // The standalone selection pass ran in PARALLEL with the budget pass (see
  // above). Consume it when the budget pass omitted the list or dropped a
  // source-visible product; otherwise abort the speculative work so a
  // complete extraction is not followed by a second full AI read.
  let selectionRerunTokens = 0;
  let selectionRerunReason = '';
  const mainHasSelections = Array.isArray(rawData.customer_selections);
  const mainGaps = mainHasSelections
    ? findCustomerSelectionCoverageGaps(estimateText, normalizeEstimate(rawData).estimate.customer_selection_source || [])
    : [];
  if (!mainHasSelections || mainGaps.length) {
    const rerun = await speculativeSelectionRerun;
    if (!rerun || !Array.isArray(rerun.rows)) {
      selectionRerunAbort.abort();
      throw new Error(
        mainHasSelections
          ? 'The customer selection rerun did not return a complete list. Reprocess the estimate.'
          : 'AI did not return the required customer selection list. Reprocess the estimate to extract all finish choices.'
      );
    }
    selectionRerunTokens += rerun.tokens;
    selectionRerunReason = mainHasSelections ? 'coverage-gaps' : 'missing-list';
    rawData.customer_selections = rerun.rows;
  } else {
    // Bounded cost: cancel the unused speculative pass instead of paying for
    // a redundant full-document read.
    selectionRerunAbort.abort();
  }

  const { estimate, warnings } = normalizeEstimate(rawData);
  if (sourceSelections !== null) warnings.push(`Verified ${sourceSelections.length} customer finish choice(s) directly against the numbered PDF estimate rows. REPLACE rates are used as installed allowances including labor; source sales tax is retained separately.`);
  if (selectionRerunReason === 'missing-list') {
    warnings.push(`Budget extraction omitted the customer selection list; the standalone rerun over the uploaded document(s) recovered ${estimate.customer_selection_source?.length || 0} choice(s).`);
  }

  const coverageGaps = findCustomerSelectionCoverageGaps(estimateText, estimate.customer_selection_source || []);
  if (coverageGaps.length) {
    // Residual gaps after the parallel pass: run ONE targeted sequential rerun
    // that names the missing products — but only while the time budget allows,
    // so a slow model can never push the serverless request into a 504.
    if (deadline !== undefined && deadline - Date.now() < 20_000) {
      throw new Error(`AI could not verify the customer selections for: ${coverageGaps.join(', ')}. Review the source scope and reprocess; a partial selection sheet was not issued.`);
    }
    // A dedicated selection-only rerun re-reads EITHER uploaded document, so
    // a choice visible in the full estimate or the component report can never
    // be hidden by the trade-budget taxonomy (for example, appliances without
    // a canonical division).
    const rerun = await runCustomerSelectionRerun({
      sourceText: estimateText,
      existing: estimate.customer_selection_source || [],
      coverageGaps,
      selectionSchemaJson: SELECTION_SCHEMA_JSON,
      deadline,
    });
    selectionRerunTokens += rerun.tokens;
    if (!Array.isArray(rerun.rows)) {
      throw new Error('The customer selection rerun did not return a complete list. Reprocess the estimate.');
    }
    if (!selectionRerunReason.includes('coverage-gaps')) {
      selectionRerunReason = selectionRerunReason ? `${selectionRerunReason}+coverage-gaps` : 'coverage-gaps';
    }
    const corrected = normalizeEstimate({ ...rawData, customer_selections: rerun.rows });
    const remaining = findCustomerSelectionCoverageGaps(estimateText, corrected.estimate.customer_selection_source || []);
    if (remaining.length) {
      throw new Error(`AI could not verify the customer selections for: ${remaining.join(', ')}. Review the source scope and reprocess; a partial selection sheet was not issued.`);
    }
    estimate.customer_selection_source = corrected.estimate.customer_selection_source;
    warnings.push(...corrected.warnings.filter((warning) => warning.startsWith('Customer selection')));
  }
  // Preserve source material prices before turnkey filtering and procurement
  // budget scaling. Customer allowances are independent of internal buyout budgets.
  estimate.customer_selection_source = (estimate.customer_selection_source || []).map((input) => {
    if (input.allowance_per_unit !== null || input.installed_unit_cost !== undefined) return input;
    const matched = buildCustomerSelections(estimate.material_allowances, [input])[0];
    return matched?.allowance_status === 'confirmed' ? { ...input, allowance_per_unit: matched.allowance_per_unit } : input;
  });
  const pricingReviewNeeded = sourceSelections === null && estimate.customer_selection_source.some((item) => item.allowance_per_unit === null);
  if (pricingReviewNeeded) {
    // Pricing recovery is a second serial AI pass; only start it while enough
    // of the request budget remains, and degrade to the unpriced-selection
    // warning instead of failing the whole request at the budget edge.
    if (deadline !== undefined && deadline - Date.now() < 8_000) {
      warnings.push('Material price recovery was skipped to respect the server time budget; confirm the remaining allowances manually before issuing the sheet.');
    } else {
      try {
        const pricing = await recoverCustomerSelectionPrices(estimateText, estimate.customer_selection_source, { deadline });
        estimate.customer_selection_source = pricing.selections;
        selectionRerunTokens += pricing.tokens;
      } catch (err) {
        if (!(err instanceof DeepSeekDeadlineError)) throw err;
        warnings.push('Material price recovery was stopped by the server time budget; confirm the remaining allowances manually before issuing the sheet.');
      }
    }
  }
  const mined = mineEstimateDollars(estimateText);
  warnings.push(...applyMinedBackfill(estimate, mined).warnings);
  const withBudget = applyBudgetEngine(estimate);

  // Include independently extracted turnkey choices, using audited procurement
  // rates where available and keeping source quantities free of added waste.
  withBudget.customer_selections = buildCustomerSelections(
    withBudget.material_allowances, withBudget.customer_selection_source
  );
  const unpriced = withBudget.customer_selections.filter((item) => item.allowance_status === 'needs_review');
  if (unpriced.length) warnings.push(`Material pricing confirmed for all other selections; source pricing review could not verify material-only amounts for: ${unpriced.map((item) => item.description).join(', ')}. Supply a component breakdown or confirm those allowances before issuing the sheet.`);

  const processWarnings = [...warnings, ...(withBudget.processing?.warnings || [])];
  if (truncated) processWarnings.push('Model response was truncated; JSON recovered via the repair pass.');
  if (repaired) processWarnings.push('Model returned invalid JSON; a repair pass corrected the response.');

  withBudget.processing = {
    model,
    engine: `${ESTIMATE_ENGINE_VERSION} (attempts=${attempts}, tokens=${usage?.total_tokens === undefined ? 'n/a' : usage.total_tokens + selectionRerunTokens}, selection_rerun=${selectionRerunReason || 'none'}, pricing_review=${pricingReviewNeeded})`,
    warnings: processWarnings,
    processed_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
  };
  return withBudget;
}

export { resolveModel };
