/**
 * Subcontractor field work-order generation engine (server-only).
 *
 * One DeepSeek call per field crew (bounded concurrency) so a single crew can
 * never truncate the whole packet. Every crew falls back to the deterministic
 * field template on failure, and the entire packet is redacted of financial
 * data and Xactimate codes before it leaves this module.
 */
import { deepseekJsonWithMeta, hasApiKey, resolveModel } from './deepseek.js';
import {
  assignCrews,
  buildFallbackCrewWorkOrder,
  buildSiteLogistics,
  computeWorkOrderChecksum,
  redactFinancials,
  redactWorkOrders,
  type CrewDefinition,
} from './src/utils/workOrders.js';
import type {
  EstimateResult,
  TradeSection,
  WorkOrder,
  WorkOrderAreaInstruction,
  WorkOrderSiteLogistics,
} from './src/types/estimate.js';

export const WORK_ORDER_ENGINE_VERSION = 'field-wo-v1';

export interface WorkOrderPackageResult {
  work_orders: WorkOrder[];
  site_logistics: WorkOrderSiteLogistics;
  meta: {
    source: 'ai' | 'mixed' | 'template';
    engine: string;
    model?: string;
    crews: number;
    ai_crews: number;
    template_crews: number;
    duration_ms: number;
    warnings: string[];
    checksum: string;
  };
}

const CREW_SYSTEM_PROMPT = `You are a Construction Superintendent and Field Operations Director for a restoration general contractor.
You write ONE subcontractor field work order for ONE trade crew, using only the approved scope digest provided.

ABSOLUTE RULES
1. ZERO FINANCIAL VISIBILITY: never mention prices, unit rates, totals, margins, overhead, profit, deductibles,
   insurance amounts, "RCV" or any dollar figure. If the digest does not contain a number, you do not invent one.
2. NO INSURANCE SHORTHAND: never output Xactimate category or selector codes (DRY, PNT, WTR, DMO, FNH, MN, ...).
   Translate every abbreviation into plain-language physical work.
3. ACTION VERBS: every instruction item starts with a strong verb (Erect, Remove, Install, Mask, Caulk,
   Torque, Test, Verify, Label, Photograph, Stage, Clean...).
4. PRESERVE ALL QUANTITIES: keep every square footage, linear footage, unit count and dimension exactly.
   Never round or drop a quantity.
5. GROUP BY ROOM/AREA: use the rooms/areas named in the digest. When rooms are not provided, group by work
   phase such as "Before You Start", "General Area", "Final Punch".
6. SAFETY FIRST: populate safety_protocols with the containment, PPE, lockout, moisture-testing or
   pressure-testing steps required before this crew may start.
7. QC: qc_checklist must be physical, inspectable acceptance criteria the crew lead signs before demobilizing.
8. If exclusions are provided, restate them in the exclusions array verbatim; never include excluded work in
   the instructions.
9. FOCUS ON THE EXACT WORK: every instruction item must reference the actual rooms, areas, quantities and
   materials named in the digest. No generic filler or company boilerplate. One sentence per item.
10. Output ONLY the JSON object. No markdown, no commentary.

RESPONSE JSON SHAPE
{
  "scope_summary": string,                       // 2-3 sentences, action-oriented, no money
  "safety_protocols": string[],                  // 4-8 items
  "instructions": [{ "area": string, "items": string[] }],  // 2-6 groups, verb-first items
  "material_specs": string[],                    // grades, sizes, fasteners, manufacturer requirements
  "qc_checklist": string[],                      // 4-8 inspectable acceptance criteria
  "exclusions": string[]                         // DO NOT PERFORM items; [] when none
}`;

interface CrewPayload {
  scope_summary?: unknown;
  safety_protocols?: unknown;
  instructions?: unknown;
  material_specs?: unknown;
  qc_checklist?: unknown;
  exclusions?: unknown;
}

const str = (value: unknown): string =>
  value === undefined || value === null ? '' : String(value).trim();
const strList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((v) => str(v)).filter(Boolean) : [];

function buildCrewDigest(
  estimate: EstimateResult,
  crew: CrewDefinition,
  trades: TradeSection[]
): string {
  const extraCodes = trades.flatMap((t) => t.category_codes_included || []);
  const clean = (value: string) => redactFinancials(value, extraCodes);
  const lines: string[] = [
    `PROJECT: ${estimate.project_meta.client_name} • Claim ${estimate.project_meta.claim_number}${
      estimate.project_meta.carrier ? ` • ${estimate.project_meta.carrier}` : ''
    }`,
  ];
  if (estimate.project_meta.property_address) {
    lines.push(`SITE: ${clean(estimate.project_meta.property_address)}`);
  }
  lines.push(`CREW: ${crew.name}`);
  lines.push(`CREW SCOPE FRAME: ${crew.scope}`);
  lines.push('');

  for (const trade of trades) {
    lines.push(
      `--- ${trade.task_id}: ${clean(trade.trade_name)} (${trade.suggested_duration_days} working day(s); precede: ${
        trade.predecessors || 'project start'
      })`
    );
    if (trade.scope_summary) lines.push(`SCOPE: ${clean(trade.scope_summary)}`);
    if (trade.exclusions && trade.exclusions.length > 0) {
      lines.push(`EXCLUSIONS (do not perform): ${trade.exclusions.map(clean).join(' | ')}`);
    }
  }

  const allowances = (estimate.material_allowances || []).filter((a) =>
    trades.some((t) => t.trade_name === a.trade)
  );
  if (allowances.length > 0) {
    lines.push('');
    lines.push('QUANTITIES AVAILABLE (descriptions and counts only):');
    for (const a of allowances.slice(0, 60)) {
      lines.push(`- ${a.qty} ${a.uom} ${clean(a.description)}`);
    }
  }
  return lines.join('\n');
}

async function generateCrewWorkOrder(
  estimate: EstimateResult,
  crew: CrewDefinition,
  trades: TradeSection[]
): Promise<WorkOrder> {
  const { data } = await deepseekJsonWithMeta<CrewPayload>({
    system: CREW_SYSTEM_PROMPT,
    user: buildCrewDigest(estimate, crew, trades),
    temperature: 0.25,
    maxTokens: 2800,
    attempts: 2,
    timeoutMs: 180_000,
    label: `workorder:${crew.id}`,
  });

  const instructions: WorkOrderAreaInstruction[] = (Array.isArray(data.instructions)
    ? data.instructions
    : []
  )
    .map((group) => {
      const g = (group && typeof group === 'object' ? group : {}) as Record<string, unknown>;
      return {
        area: str(g.area) || 'General Area',
        items: strList(g.items),
      };
    })
    .filter((group) => group.items.length > 0);

  const scopeSummary = str(data.scope_summary);
  if (!scopeSummary || instructions.length === 0) {
    throw new Error('Crew response was missing scope_summary or instructions');
  }

  const digestExclusions = trades.flatMap((t) => t.exclusions || []);

  return {
    crew_id: crew.id,
    crew_name: crew.name,
    crew_scope: crew.scope,
    trade_task_ids: trades.map((t) => t.task_id),
    scope_summary: scopeSummary,
    safety_protocols: strList(data.safety_protocols),
    instructions,
    material_specs: strList(data.material_specs),
    qc_checklist: strList(data.qc_checklist),
    exclusions: Array.from(new Set([...strList(data.exclusions), ...digestExclusions])),
    source: 'ai',
  };
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) || 1 }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function generateWorkOrderPackage(
  estimate: EstimateResult
): Promise<WorkOrderPackageResult> {
  const startedAt = Date.now();
  const warnings: string[] = [];
  const assignments = assignCrews(estimate.trade_sections || []);
  const site_logistics = buildSiteLogistics(estimate);

  if (assignments.length === 0) {
    warnings.push('The estimate contains no trade sections to route to field crews.');
    return {
      work_orders: [],
      site_logistics,
      meta: {
        source: 'template',
        engine: WORK_ORDER_ENGINE_VERSION,
        crews: 0,
        ai_crews: 0,
        template_crews: 0,
        duration_ms: Date.now() - startedAt,
        warnings,
        checksum: '',
      },
    };
  }

  const templateFor = (crew: CrewDefinition, trades: TradeSection[]) =>
    buildFallbackCrewWorkOrder(crew, trades, estimate.material_allowances || []);

  let workOrders: WorkOrder[];
  if (!hasApiKey()) {
    warnings.push('DEEPSEEK_API_KEY is not configured — deterministic field templates were used.');
    workOrders = assignments.map(({ crew, trades }) => templateFor(crew, trades));
  } else {
    workOrders = await mapLimit(assignments, 3, async ({ crew, trades }) => {
      try {
        return await generateCrewWorkOrder(estimate, crew, trades);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`${crew.id}: AI generation failed (${message}); field template used instead.`);
        return templateFor(crew, trades);
      }
    });
  }

  const redacted = redactWorkOrders(workOrders, estimate);
  const aiCrews = redacted.filter((wo) => wo.source === 'ai').length;
  const source: WorkOrderPackageResult['meta']['source'] =
    aiCrews === redacted.length ? 'ai' : aiCrews === 0 ? 'template' : 'mixed';

  return {
    work_orders: redacted,
    site_logistics,
    meta: {
      source,
      engine: WORK_ORDER_ENGINE_VERSION,
      model: hasApiKey() ? resolveModel() : undefined,
      crews: redacted.length,
      ai_crews: aiCrews,
      template_crews: redacted.length - aiCrews,
      duration_ms: Date.now() - startedAt,
      warnings,
      checksum: computeWorkOrderChecksum(estimate, redacted),
    },
  };
}
