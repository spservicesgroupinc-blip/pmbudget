/**
 * Subcontractor field work-order domain layer (shared client/server, pure TS).
 *
 * Implements the 7-crew taxonomy from `instructions/work orders` (plus a
 * supplemental exterior crew for roofing/siding scopes), the hard
 * zero-financial-visibility redaction rules, deterministic fallback templates
 * (used when the AI is unavailable) and the packet checksum.
 */
import type {
  EstimateResult,
  MaterialAllowanceItem,
  TradeSection,
  WorkOrder,
  WorkOrderAreaInstruction,
  WorkOrderSiteLogistics,
} from '../types/estimate';
import { DIVISION_PROFILES } from './budgetEngine';

export interface CrewDefinition {
  id: string;
  name: string;
  scope: string;
  codes: string[];
  keywords: string[];
  supplemental?: boolean;
  fallbackSafety: string[];
  fallbackQc: string[];
}

export const WORK_ORDER_CREWS: CrewDefinition[] = [
  {
    id: 'crew-1',
    name: 'Crew 1: Contents Handling, Site Protection & Demolition',
    scope:
      'Dust barriers, contents manipulation, structural tear-out, subfloor prep, concrete grinding, debris staging and final detail clean',
    codes: ['DMO', 'WTR', 'DEM', 'CLN', 'HAZ'],
    keywords: ['demolition', 'demo', 'tear', 'mitigation', 'clean', 'contents', 'debris'],
    fallbackSafety: [
      'Erect 6-mil poly dust barriers with zipper doors at every work boundary; verify seals before starting.',
      'Run HEPA air scrubbers continuously and rotate filters per manufacturer intervals.',
      'Wear N95 respirators, sealed eye protection and cut-rated gloves for all tear-out work.',
      'Photograph and inventory all contents before moving; store in labeled, protected staging.',
      'Locate and isolate water, gas and electrical services before any demolition starts.',
      'Stage debris only in the designated containment area; keep egress paths clear at all times.',
    ],
    fallbackQc: [
      'All debris removed from occupied areas and staged in the approved location.',
      'Containment intact — zero visible dust migration beyond the barrier.',
      'Substrate sound, dry and ready for the next trade; photos uploaded.',
      'Contents inventory reconciled and signed by the homeowner where applicable.',
    ],
  },
  {
    id: 'crew-2',
    name: 'Crew 2: Drywall, Framing & Insulation',
    scope:
      'Insulation (batt, blown, vapor barrier), framing repairs, drywall hang, patch, tape, float and machine textures',
    codes: ['FRM', 'INS', 'DRY', 'PLA'],
    keywords: ['drywall', 'framing', 'insulation', 'plaster', 'taping', 'texture'],
    fallbackSafety: [
      'Verify framing is structurally sound and moisture content is below 16% before enclosing.',
      'Maintain dust containment; use vacuums with HEPA filtration on all cutting tools.',
      'Wear eye protection and dust masks for cutting, sanding and texture spraying.',
      'Protect finished floors and adjacent surfaces before hanging or spraying.',
      'Scaffold or lift equipment must be stable and rated for the working height.',
    ],
    fallbackQc: [
      'Framing plumb, level and square; blocking installed where fixtures require support.',
      'Insulation fitted without gaps, voids or compression; vapor barrier sealed at seams.',
      'Joints taped, floated and sanded to Level 4 finish unless texture exceeds it.',
      'Texture uniform and blended into existing areas with no visible lap lines.',
    ],
  },
  {
    id: 'crew-3',
    name: 'Crew 3: Flooring & Underlayment Installation',
    scope:
      'Sound membrane/underlayment, click-lock LVP, laminate, sheet vinyl, tile, carpet/pad, T-molding and transitions',
    codes: ['FCV', 'FCT', 'FCH', 'FNH', 'WDN', 'FCC', 'TLF'],
    keywords: ['floor', 'carpet', 'tile', 'vinyl', 'laminate', 'hardwood'],
    fallbackSafety: [
      'Test substrate moisture (under 5% wood / per manufacturer spec) and record readings before install.',
      'Acclimate flooring materials in the conditioned space per manufacturer requirements.',
      'Wear knee protection, gloves and cut-rated blades; keep blades fresh to avoid slips.',
      'Keep utility knives sheathed when not in use and sweep fasteners immediately.',
    ],
    fallbackQc: [
      'Substrate clean, flat and within manufacturer tolerance; no hollow spots or lippage.',
      'Expansion gaps maintained at all perimeter pinch points; transitions centered under door slabs.',
      'No peaking seams, telegraphing or pattern repetition where visible.',
      'Floor protected after install; homeowner walkthrough completed.',
    ],
  },
  {
    id: 'crew-4',
    name: 'Crew 4: Finish Carpentry, Cabinetry & Doors',
    scope:
      'Interior/exterior door slabs and pre-hung fittings, casing, baseboard, cabinets, end panels and decorative hardware',
    codes: ['CAB', 'CTR', 'FNC', 'DOR', 'FIN', 'TRM'],
    keywords: ['carpentry', 'cabin', 'door', 'trim', 'counter', 'casing', 'baseboard'],
    fallbackSafety: [
      'Verify walls are painted/cured and floors protected before cabinet or trim install.',
      'Rated shoring or two-person lifts for upper cabinets and door slabs.',
      'Keep power tools guarded; disconnect before changing blades or bits.',
    ],
    fallbackQc: [
      'Cabinet boxes plumb and level; doors and drawers aligned with even reveals.',
      'Trim miters tight, nails set and filled; caulk lines clean and paint-ready.',
      'Door slabs operate smoothly, latch cleanly and clear the finished floor.',
    ],
  },
  {
    id: 'crew-5',
    name: 'Crew 5: Plumbing & Mechanical Trades',
    scope:
      'Appliance disconnects/resets (refrigerator, gas range, dishwasher), sinks, faucets, valves, P-traps, pressure/leak testing and mechanical equipment',
    codes: ['PLM', 'HVC', 'HVA', 'APP'],
    keywords: ['plumb', 'mechanical', 'hvac', 'appliance', 'water heater'],
    fallbackSafety: [
      'Perform lockout/tagout and verify zero energy before disconnecting any appliance or equipment.',
      'Close and tag water shutoffs before breaking any line; have towels and pans staged.',
      'Leak-test all gas connections with approved solution and re-light pilots per manufacturer steps.',
      'Pressure-test supply lines and inspect every joint under full pressure before closing walls.',
    ],
    fallbackQc: [
      'All connections leak-free under full pressure with no weeping at valves or P-traps.',
      'Appliances level, secured and operating; water line and drain verified.',
      'Permits/inspection tags documented where required by code.',
    ],
  },
  {
    id: 'crew-6',
    name: 'Crew 6: Electrical Trade',
    scope:
      'Lockout/tagout, junction box resets, rough-in wiring, switch/outlet replacement and light fixture installation',
    codes: ['ELE', 'LOW'],
    keywords: ['electric'],
    fallbackSafety: [
      'Lock out and tag the source circuit at the panel; test with a known-good meter before touching conductors.',
      'Only licensed electricians perform terminations; keep panels closed when not actively working.',
      'Verify GFCI/AFCI protection and grounding continuity after every repair.',
    ],
    fallbackQc: [
      'All devices and fixtures operate from their intended switches; no reverse polarity.',
      'Junction boxes covered, conductors neatly folded and torqued to spec.',
      'Panel schedule updated and labeled for any new circuits.',
    ],
  },
  {
    id: 'crew-7',
    name: 'Crew 7: Painting & Surface Finishing',
    scope:
      'Masking, caulking, sanding, PVA drywall priming, stain-blocking primer, wall/ceiling finish coats and trim enamel',
    codes: ['PNT', 'WAL'],
    keywords: ['paint', 'seal', 'wallcover', 'finish'],
    fallbackSafety: [
      'Mask floors, trim, cabinets and fixtures with high-tack tape and rosin paper before spraying.',
      'Ventilate continuously and use respirators rated for the coating system being applied.',
      'Keep wet coatings away from electrical devices and heat sources; observe dry times.',
    ],
    fallbackQc: [
      'Surfaces sanded, caulked and dust-free before finish coats; stain-blocking applied where required.',
      'Uniform sheen with no holidays, drips or lap marks under raking light.',
      'Trim lines crisp; no bleed under tape; fixtures and floors free of overspray.',
    ],
  },
  {
    id: 'crew-8',
    name: 'Crew 8 (Supplemental): Roofing, Siding & Exterior Envelope',
    scope:
      'Roofing, gutters, siding, soffit and exterior glazing/windows where exterior scopes are included in the estimate',
    codes: ['RFG', 'GUT', 'SDG', 'SOF', 'WDW', 'WIN', 'GLA'],
    keywords: ['roof', 'gutter', 'siding', 'exterior', 'window', 'glaz', 'soffit'],
    supplemental: true,
    fallbackSafety: [
      'Fall protection required — harness, anchor point and ladder tie-off before roof access.',
      'Check weather window; no roofing work in wind above manufacturer limits or during precipitation.',
      'Stage materials so loads are balanced; never block egress or vented openings.',
    ],
    fallbackQc: [
      'Decking/underlayment installed per code; flashing integrated at all penetrations.',
      'Roof penetrations and transitions water-tested before closing.',
      'Siding courses level, fastened to structure and sealed at openings.',
    ],
  },
];

const MEP_CODES = ['ELE', 'PLM', 'HVC', 'HVA'];

/** Deterministically routes a trade package to its field crew. */
export function matchCrew(trade: TradeSection): CrewDefinition {
  const codes = (trade.category_codes_included || []).map((c) =>
    String(c).toUpperCase().trim()
  );
  const mep = codes.filter((c) => MEP_CODES.includes(c));
  if (mep.length >= 2) {
    return WORK_ORDER_CREWS.find((c) => c.id === 'crew-5') || WORK_ORDER_CREWS[0];
  }
  for (const code of codes) {
    for (const crew of WORK_ORDER_CREWS) {
      if (crew.codes.includes(code)) return crew;
    }
  }
  const name = String(trade.trade_name || '').toLowerCase();
  for (const crew of WORK_ORDER_CREWS) {
    if (crew.keywords.some((k) => name.includes(k))) return crew;
  }
  return WORK_ORDER_CREWS[0];
}

export interface CrewAssignment {
  crew: CrewDefinition;
  trades: TradeSection[];
}

export function assignCrews(trades: TradeSection[]): CrewAssignment[] {
  const map = new Map<string, TradeSection[]>();
  for (const trade of trades) {
    const crew = matchCrew(trade);
    const list = map.get(crew.id) || [];
    list.push(trade);
    map.set(crew.id, list);
  }
  return WORK_ORDER_CREWS.filter((c) => map.has(c.id)).map((c) => ({
    crew: c,
    trades: map.get(c.id) as TradeSection[],
  }));
}

// ---------------------------------------------------------------------------
// Financial redaction (hard privacy rule: crews never see money or codes)
// ---------------------------------------------------------------------------

// Non-canonical tokens that also appear as Xactimate selectors.
const EXTRA_CODE_TOKENS = ['MN', 'B1', 'B2', 'B3', 'GEN', 'EQP', 'TEM', 'SAT', 'ADD', 'LAB', 'MAT'];

export const KNOWN_CODES: string[] = Array.from(
  new Set([
    ...DIVISION_PROFILES.flatMap((p) => p.codes),
    ...WORK_ORDER_CREWS.flatMap((c) => c.codes),
    ...EXTRA_CODE_TOKENS,
  ])
);

const MONEY_RX =
  /\$\s?\.?\d[\d,]*(?:\.\d{1,2})?|\bUSD\s?\.?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s?dollars?\b/gi;
const FINANCIAL_WORDS_RX =
  /\b(O\s?&\s?P|O\s+and\s+P|overhead(?:\s?(?:and|&)\s?profit)?|profit(?:\s?(?:margin|markup))?|gross\s?margin|margins?|markups?|unit\s?rates?|unit\s?prices?|per\s?unit|rate\s?per\s?(?:sf|lf|square\s?foot)|RCV|net\s?claim|deductible|sales\s?tax|replacement\s?cost\s?value|pricing|prices?|contract\s?(?:sum|total|price)s?)\b/gi;
// Margin/markup percentages keep their numbers unless stripped in context.
const PERCENT_CONTEXT_RX =
  /[\d.]+\s?%\s?(?:o\s?&\s?p|overhead|profit|margin|markup)|(?:o\s?&\s?p|overhead|profit|margin|markup)[^.;\n]{0,24}?\d+(?:\.\d+)?\s?%/gi;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let codeRxCache: { key: string; rx: RegExp } | null = null;
function codeRegex(extraCodes: string[]): RegExp {
  const key = extraCodes.join('|');
  if (codeRxCache && codeRxCache.key === key) return codeRxCache.rx;
  const all = Array.from(new Set([...KNOWN_CODES, ...extraCodes].filter(Boolean)));
  const rx = new RegExp(
    `\\b(?:${all.map(escapeRegex).join('|')})(?:\\s?[A-Z]\\d{1,2}|\\d{1,2}(?:/\\d+)?)?\\b`,
    'g'
  );
  codeRxCache = { key, rx };
  return rx;
}

/** Strips money figures, margin language and Xactimate category codes. */
export function redactFinancials(text: string, extraCodes: string[] = []): string {
  if (!text) return '';
  return String(text)
    .replace(MONEY_RX, '')
    .replace(PERCENT_CONTEXT_RX, '')
    .replace(FINANCIAL_WORDS_RX, '')
    .replace(codeRegex(extraCodes), '')
    .replace(/\bper\s+(?:the\s+)?(?:approved\s+)?estimate\b/gi, 'per the approved field scope')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}

export function redactWorkOrders(workOrders: WorkOrder[], estimate: EstimateResult): WorkOrder[] {
  const extra = (estimate.trade_sections || []).flatMap((t) =>
    (t.category_codes_included || []).map((c) => String(c).toUpperCase())
  );
  const clean = (s: string) => redactFinancials(s, extra);
  const cleanList = (list: string[] | undefined) =>
    (list || [])
      .map(clean)
      .map((s) => s.replace(/^[\s\-•*]+/, '').trim())
      .filter(Boolean);

  return workOrders.map((wo) => ({
    ...wo,
    scope_summary: clean(wo.scope_summary),
    crew_scope: clean(wo.crew_scope),
    safety_protocols: cleanList(wo.safety_protocols),
    material_specs: cleanList(wo.material_specs),
    qc_checklist: cleanList(wo.qc_checklist),
    exclusions: cleanList(wo.exclusions),
    instructions: (wo.instructions || [])
      .map((group) => ({
        area: clean(group.area) || 'General Area',
        items: cleanList(group.items),
      }))
      .filter((group) => group.items.length > 0),
  }));
}

// ---------------------------------------------------------------------------
// Deterministic fallback templates (used when the AI is unavailable)
// ---------------------------------------------------------------------------

function fallbackInstructions(
  crew: CrewDefinition,
  trades: TradeSection[],
  allowances: MaterialAllowanceItem[]
): WorkOrderAreaInstruction[] {
  const scope = trades.map(
    (t) =>
      `Complete the ${t.trade_name} scope described in the approved estimate: ${
        t.scope_summary || 'execute per the approved scope of work'
      } (${Math.max(1, Number(t.suggested_duration_days) || 1)} working day(s)).`
  );
  const staged = allowances
    .filter((a) => trades.some((t) => t.trade_name === a.trade))
    .map((a) => `Stage and verify ${a.qty} ${a.uom} of ${a.description} before starting work.`);
  const sequencing = trades
    .filter((t) => (t.predecessors || '').trim())
    .map(
      (t) =>
        `${t.task_id}: mobilize only after predecessor scope (${t.predecessors}) is complete and accepted.`
    );

  const groups: WorkOrderAreaInstruction[] = [
    { area: 'Scope Execution', items: scope },
    {
      area: 'Quantities & Material Staging',
      items: staged.length
        ? staged
        : ['Verify all field quantities against the approved scope before ordering or cutting materials.'],
    },
  ];
  if (sequencing.length) {
    groups.push({ area: `Sequencing (${crew.id.toUpperCase()})`, items: sequencing });
  }
  return groups;
}

export function buildFallbackCrewWorkOrder(
  crew: CrewDefinition,
  trades: TradeSection[],
  allowances: MaterialAllowanceItem[] = []
): WorkOrder {
  const names = trades.map((t) => t.trade_name).join(', ');
  const exclusions = trades.flatMap((t) => t.exclusions || []);
  return {
    crew_id: crew.id,
    crew_name: crew.name,
    crew_scope: crew.scope,
    trade_task_ids: trades.map((t) => t.task_id),
    scope_summary: `Perform ${crew.scope.toLowerCase()} for: ${names}. Work only from the approved field scope; report any variance to the superintendent before proceeding.`,
    safety_protocols: [...crew.fallbackSafety],
    instructions: fallbackInstructions(crew, trades, allowances),
    material_specs: [
      'All materials must match the approved manufacturer specifications and be staged in a dry, protected area.',
      'Fasten per manufacturer requirements; use corrosion-resistant fasteners in wet or exterior areas.',
      'Verify quantities with the superintendent before installing; retain packaging and cut sheets for verification.',
    ],
    qc_checklist: [
      ...crew.fallbackQc,
      'Walk the work area with the superintendent and sign off on this sheet before demobilizing.',
    ],
    exclusions: exclusions.length
      ? exclusions
      : ['Do not perform any credited, omitted or out-of-scope work without a written change order.'],
    source: 'template',
  };
}

export function buildFallbackWorkOrders(estimate: EstimateResult): WorkOrder[] {
  const allowances = estimate.material_allowances || [];
  return assignCrews(estimate.trade_sections || []).map(({ crew, trades }) =>
    buildFallbackCrewWorkOrder(crew, trades, allowances)
  );
}

export function buildSiteLogistics(_estimate: EstimateResult): WorkOrderSiteLogistics {
  return {
    working_hours: 'Monday-Friday, 7:00 AM - 5:00 PM. Weekend work requires superintendent approval 24h in advance.',
    parking_staging: 'Park only in the approved staging area; keep driveways and streets clear for material deliveries.',
    waste_disposal: 'Stage debris in the designated dumpster/containment area. No debris may remain in occupied areas overnight.',
    emergency_protocol: 'Notify the on-site superintendent immediately for any incident; call 911 for gas, electrical or flooding emergencies. Locate the main panel and water shutoff before starting.',
    superintendent: undefined,
  };
}

/** Computes the packet verification token printed on every PDF page. */
export function computeWorkOrderChecksum(estimate: EstimateResult, workOrders: WorkOrder[]): string {
  const basis = JSON.stringify({
    client: estimate.project_meta?.client_name || '',
    claim: estimate.project_meta?.claim_number || '',
    tasks: (estimate.trade_sections || []).map((t) => t.task_id).sort(),
    crews: workOrders.map((c) => [
      c.crew_id,
      c.instructions.reduce((a, g) => a + g.items.length, 0),
      c.qc_checklist.length,
    ]),
  });
  let hash = 5381;
  for (let i = 0; i < basis.length; i++) {
    hash = ((hash << 5) + hash + basis.charCodeAt(i)) | 0;
  }
  return `WO-CHK-${(hash >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

/** Slims the estimate payload for the /api/generate-work-orders request. */
export function estimateForWorkOrderRequest(estimate: EstimateResult): EstimateResult {
  const clone: EstimateResult = JSON.parse(JSON.stringify(estimate));
  delete clone.work_orders;
  delete clone.work_orders_generated_at;
  delete clone.work_order_site;
  return clone;
}

export function workOrderPdfFilename(estimate: EstimateResult): string {
  const client = String(estimate.project_meta?.client_name || 'Client').replace(/[^A-Za-z0-9_-]+/g, '_');
  const claim = String(estimate.project_meta?.claim_number || 'Claim').replace(/[^A-Za-z0-9_-]+/g, '_');
  return `${client}_Claim_${claim}_WorkOrders.pdf`;
}

/** Short, send-ready labels used in per-subcontractor PDF filenames. */
const CREW_FILE_LABELS: Record<string, string> = {
  'crew-1': 'Contents_Demo',
  'crew-2': 'Drywall_Framing',
  'crew-3': 'Flooring',
  'crew-4': 'Carpentry_Cabinets',
  'crew-5': 'Plumbing_Mechanical',
  'crew-6': 'Electrical',
  'crew-7': 'Painting',
  'crew-8': 'Roofing_Exterior',
};

/**
 * Standalone document name for ONE subcontractor crew, e.g.
 * `Michael_Jenkins_Claim_92-8419-X21_Flooring_WO.pdf` — ready to email as-is.
 */
export function crewWorkOrderPdfFilename(estimate: EstimateResult, crew: WorkOrder): string {
  const client = String(estimate.project_meta?.client_name || 'Client').replace(/[^A-Za-z0-9_-]+/g, '_');
  const claim = String(estimate.project_meta?.claim_number || 'Claim').replace(/[^A-Za-z0-9_-]+/g, '_');
  const label =
    CREW_FILE_LABELS[crew.crew_id] || crew.crew_id.replace(/[^A-Za-z0-9_-]+/g, '_');
  return `${client}_Claim_${claim}_${label}_WO.pdf`;
}
