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
import { deepseekJsonWithMeta, resolveModel } from './deepseek.js';
import { applyBudgetEngine, DIVISION_PROFILES, matchDivision } from './src/utils/budgetEngine.js';
import { buildCustomerSelections, classifySelectionCategory } from './src/utils/customerSelections.js';
import { findCustomerSelectionCoverageGaps } from './src/utils/customerSelectionCoverage.js';
import { mineEstimateDollars } from './estimateTextMiner.js';
import type { MinedEstimate } from './estimateTextMiner.js';
import type {
  EstimateResult,
  CustomerSelectionInput,
  MaterialAllowanceItem,
  TradeSection,
} from './src/types/estimate.js';

export const ESTIMATE_ENGINE_VERSION = 'budget-engine-v3-selections';

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
Read EVERY room and line item, including customer choices supplied by turnkey subcontractors.
Extract ALL new/replacement finishes the customer must choose: flooring/carpet, tile and grout
color, cabinets, countertops, paint/wallcovering, trim/doors, plumbing fixtures, decorative
lighting, windows/exterior finishes, hardware and appliances. Never omit a finish because its
trade is turnkey or its material price is absent. Do not impose a row limit.
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
  NEVER use a combined supply/install rate, labor, tax or O&P as a material allowance.
  Use null when material-only pricing is unavailable; an explicit zero is allowed only if stated.
- trade matches the owning trade_name; suggested vendor may be omitted if unknown.
- Before returning, check every source room/category against this list for omitted choices.
  Return [] only when the source contains no customer-selectable replacement finishes.

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
    .map((item) => {
      const a = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const qty = num(a.qty);
      const unit = num(a.unit_cost);
      return {
        trade: str(a.trade),
        component_code: str(a.component_code) || undefined,
        description: str(a.description),
        qty,
        uom: str(a.uom).toUpperCase() || 'EA',
        unit_cost: unit,
        extended_cost: Math.round(qty * unit * 100) / 100,
        vendor: str(a.vendor) || undefined,
      };
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
    const rawUnit = input.allowance_per_unit;
    const unit = typeof rawUnit === 'number' ? rawUnit :
      typeof rawUnit === 'string' && /^\s*\$?\s*\d[\d,]*(?:\.\d+)?\s*$/.test(rawUnit) ? num(rawUnit) : null;
    customer_selection_source.push({
      trade, description, qty,
      component_code: str(input.component_code) || undefined,
      uom: str(input.uom).toUpperCase() || 'EA',
      allowance_per_unit: unit !== null && Number.isFinite(unit) && unit >= 0 ? unit : null,
      vendor: str(input.vendor) || undefined,
      notes: str(input.notes) || undefined,
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

  const { data, usage, model, repaired, truncated, attempts } = await deepseekJsonWithMeta<unknown>({
    system: `${ESTIMATE_SYSTEM_PROMPT}\n\n### RESPONSE JSON SCHEMA (STRICT)\n${JSON.stringify(
      ESTIMATE_RESPONSE_SCHEMA,
      null,
      2
    )}\n\nReturn ONLY a single valid JSON object matching this schema. No markdown fences, no commentary.`,
    user: `${userPrompt}\n\nXACTIMATE ESTIMATE TEXT:\n\n${estimateText}`,
    temperature: 0.1,
    label: 'estimate',
    attempts: 3,
    requireComplete: true,
  });

  if (!data || typeof data !== 'object' || !Array.isArray((data as Record<string, unknown>).customer_selections)) {
    throw new Error('AI did not return the required customer selection list. Reprocess the estimate to extract all finish choices.');
  }

  const { estimate, warnings } = normalizeEstimate(data);
  const coverageGaps = findCustomerSelectionCoverageGaps(estimateText, estimate.customer_selection_source || []);
  let selectionReviewTokens = 0;
  if (coverageGaps.length) {
    // A separate selection-only pass prevents the trade-budget taxonomy from
    // hiding products (for example, appliances without a canonical division).
    const review = await deepseekJsonWithMeta<unknown>({
      system: `You extract customer finish choices from restoration estimates.
Return ONLY a JSON object with customer_selections, using this schema:
${JSON.stringify(ESTIMATE_RESPONSE_SCHEMA.properties.customer_selections)}
Read every room and include all replacement finishes and appliances, even when
subcontractors supply them or no budget trade division exists for that product.
Each item needs trade, description, qty, uom and allowance_per_unit; optional
component_code, vendor and notes. Use a plain-language owning trade if needed.
Preserve the descriptions of the existing choices where they identify the same
product. Return the COMPLETE corrected list, not only the missing products.
Exclude removal-only, detach/reset, credited, omitted, cleaning and labor-only work.
Include replacement material even if its line also includes installation labor.
Use exact component quantities when available, otherwise installed quantities;
add no waste. Never count both an estimate line and its component-report equivalent.
Keep different products, sizes, grades and finishes separate; aggregate identical
products across rooms and retain their room names and choices in notes.
Only explicitly supported MATERIAL-ONLY, pre-tax pricing may be allowance_per_unit.
Never copy a combined installation/labor rate or total RCV. Use null when unknown.
Never fabricate products or quantities. Check the highlighted coverage gaps against
the source before returning the complete list.`,
      user: `Coverage gaps: ${coverageGaps.join(', ')}\nExisting choices:\n${JSON.stringify(estimate.customer_selection_source)}\n\nSOURCE ESTIMATE AND COMPONENT REPORT:\n${estimateText}`,
      temperature: 0,
      label: 'customer-selection-review',
      attempts: 3,
      requireComplete: true,
    });
    const reviewed = review.data as Record<string, unknown> | null;
    if (!reviewed || !Array.isArray(reviewed.customer_selections)) {
      throw new Error('The customer selection coverage review did not return a complete list. Reprocess the estimate.');
    }
    const corrected = normalizeEstimate({ ...(data as Record<string, unknown>), customer_selections: reviewed.customer_selections });
    const remaining = findCustomerSelectionCoverageGaps(estimateText, corrected.estimate.customer_selection_source || []);
    if (remaining.length) {
      throw new Error(`AI could not verify the customer selections for: ${remaining.join(', ')}. Review the source scope and reprocess; a partial selection sheet was not issued.`);
    }
    estimate.customer_selection_source = corrected.estimate.customer_selection_source;
    warnings.push(...corrected.warnings.filter((warning) => warning.startsWith('Customer selection')));
    selectionReviewTokens = review.usage?.total_tokens || 0;
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
  if (unpriced.length) warnings.push(`${unpriced.length} customer selection(s) need material allowance pricing confirmed before issuing the sheet.`);

  const processWarnings = [...warnings, ...(withBudget.processing?.warnings || [])];
  if (truncated) processWarnings.push('Model response was truncated; JSON recovered via the repair pass.');
  if (repaired) processWarnings.push('Model returned invalid JSON; a repair pass corrected the response.');

  withBudget.processing = {
    model,
    engine: `${ESTIMATE_ENGINE_VERSION} (attempts=${attempts}, tokens=${usage?.total_tokens === undefined ? 'n/a' : usage.total_tokens + selectionReviewTokens}, selection_review=${coverageGaps.length > 0})`,
    warnings: processWarnings,
    processed_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
  };
  return withBudget;
}

export { resolveModel };
