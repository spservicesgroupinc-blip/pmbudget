/**
 * Deterministic Xactimate budget engine (shared client/server, pure TS).
 *
 * This is the math layer behind the AI extraction. The model only extracts and
 * packages scope; all money is recomputed here so checksums always reconcile:
 *
 *  - 14-division trade taxonomy with the buyout/direct-labor benchmarks from
 *    `instructions/read` (72% / 70% / 68% / 65%, turnkey = 68% of trade RCV).
 *  - O&P + material-tax apportionment by line-item share (allocation factor);
 *    rounding drift lands on the largest trade package, while structural
 *    subtotal/summary mismatches are scaled proportionally so the trade
 *    rollout always feet to the carrier RCV (never negative money).
 *  - Material allowance extended-cost + 7% Indiana sales tax roll-up.
 *  - Predecessor graph repair (unknown ids, self-deps, cycles) before scheduling.
 */
import type {
  BudgetAudit,
  EstimateResult,
  MaterialAllowanceItem,
  TradeSection,
} from '../types/estimate.js';

export const MATERIAL_TAX_RATE = 0.07;
export const TURNKEY_BUYOUT_FACTOR = 0.68;
/** Default retail labor/material split when line-item columns are unavailable. */
export const DEFAULT_LABOR_SPLIT = 0.6;
/** Demolition/drying consumables cap (share of trade RCV) for the consumables rule. */
export const CONSUMABLES_CAP = 0.08;

export interface DivisionProfile {
  division: string;
  executionType: string;
  laborFactor: number;
  turnkey: boolean;
  materialRule: 'buyout' | 'consumables' | 'turnkey';
  codes: string[];
  keywords: string[];
  note: string;
}

/**
 * Canonical 14 trade divisions from the Master Budget spec, in match order.
 * (CLN resolves to Cleaning & Final Punch; WTR/DMO resolve to Demolition.)
 */
export const DIVISION_PROFILES: DivisionProfile[] = [
  {
    division: 'Demolition & Hauling',
    executionType: 'In-House Self-Perform',
    laborFactor: 0.72,
    turnkey: false,
    materialRule: 'consumables',
    codes: ['DEM', 'DMO', 'WTR', 'HAZ'],
    keywords: ['demolition', 'demo', 'tear', 'mitigation', 'contents', 'debris'],
    note: 'Direct labor = 72% of retail labor; consumables only.',
  },
  {
    division: 'Framing & Rough Carpentry',
    executionType: 'In-House Self-Perform',
    laborFactor: 0.72,
    turnkey: false,
    materialRule: 'buyout',
    codes: ['FRM'],
    keywords: ['framing', 'structural', 'rough carpentry'],
    note: 'Direct labor = 72% of retail labor.',
  },
  {
    division: 'Finish Trim & Doors',
    executionType: 'In-House Self-Perform',
    laborFactor: 0.72,
    turnkey: false,
    materialRule: 'buyout',
    codes: ['FNC', 'DOR', 'FIN', 'TRM'],
    keywords: ['trim', 'door', 'casing', 'baseboard'],
    note: 'Direct labor = 72% of retail labor.',
  },
  {
    division: 'Drywall & Plaster',
    executionType: 'Subcontract (Labor Only)',
    laborFactor: 0.68,
    turnkey: false,
    materialRule: 'buyout',
    // INS (insulation) is grouped with the drywall/framing wall assembly crews.
    codes: ['DRY', 'PLA', 'INS'],
    keywords: ['drywall', 'plaster', 'insulation', 'taping', 'texture'],
    note: 'Sub labor = 68% of retail labor.',
  },
  {
    division: 'Painting & Wallcovering',
    executionType: 'In-House Self-Perform',
    laborFactor: 0.7,
    turnkey: false,
    materialRule: 'buyout',
    codes: ['PNT', 'WAL'],
    keywords: ['paint', 'wallcover', 'seal', 'priming'],
    note: 'Direct labor = 70% of retail labor.',
  },
  {
    division: 'Flooring (Hard Surfaces)',
    executionType: 'Subcontract (Labor Only)',
    laborFactor: 0.65,
    turnkey: false,
    materialRule: 'buyout',
    codes: ['FCV', 'FCT', 'WDN', 'FCH', 'FNH', 'TLF'],
    keywords: ['floor', 'tile', 'vinyl', 'hardwood', 'laminate', 'plank'],
    note: 'Sub labor = 65% of retail labor.',
  },
  {
    division: 'Flooring (Carpet)',
    executionType: 'Turnkey Subcontract',
    laborFactor: TURNKEY_BUYOUT_FACTOR,
    turnkey: true,
    materialRule: 'turnkey',
    codes: ['FCC'],
    keywords: ['carpet'],
    note: 'Total buyout = 68% of trade RCV; subcontractor furnishes materials.',
  },
  {
    division: 'Cabinets & Countertops',
    executionType: 'Split (Buyout + In-House)',
    laborFactor: 0.72,
    turnkey: false,
    materialRule: 'buyout',
    codes: ['CAB', 'CTR'],
    keywords: ['cabin', 'counter'],
    note: 'Install labor = 72% of retail labor; materials direct buyout.',
  },
  {
    division: 'Roofing & Gutters',
    executionType: 'Turnkey Subcontract',
    laborFactor: TURNKEY_BUYOUT_FACTOR,
    turnkey: true,
    materialRule: 'turnkey',
    codes: ['RFG', 'GUT'],
    keywords: ['roof', 'gutter', 'shingle'],
    note: 'Total buyout = 68% of trade RCV; subcontractor furnishes materials.',
  },
  {
    division: 'Siding & Exterior',
    executionType: 'Turnkey Subcontract',
    laborFactor: TURNKEY_BUYOUT_FACTOR,
    turnkey: true,
    materialRule: 'turnkey',
    codes: ['SDG', 'SOF', 'WDW', 'WIN', 'GLA'],
    keywords: ['siding', 'exterior', 'window', 'glaz', 'stucco', 'soffit'],
    note: 'Total buyout = 68% of trade RCV; subcontractor furnishes materials.',
  },
  {
    division: 'Electrical',
    executionType: 'Turnkey Subcontract',
    laborFactor: TURNKEY_BUYOUT_FACTOR,
    turnkey: true,
    materialRule: 'turnkey',
    codes: ['ELE'],
    keywords: ['electric'],
    note: 'Total buyout = 68% of trade RCV; subcontractor furnishes materials.',
  },
  {
    division: 'Plumbing',
    executionType: 'Turnkey Subcontract',
    laborFactor: TURNKEY_BUYOUT_FACTOR,
    turnkey: true,
    materialRule: 'turnkey',
    codes: ['PLM'],
    keywords: ['plumb'],
    note: 'Total buyout = 68% of trade RCV; subcontractor furnishes materials.',
  },
  {
    division: 'HVAC',
    executionType: 'Turnkey Subcontract',
    laborFactor: TURNKEY_BUYOUT_FACTOR,
    turnkey: true,
    materialRule: 'turnkey',
    codes: ['HVC', 'HVA'],
    keywords: ['hvac', 'heating', 'cooling', 'mechanical', 'furnace'],
    note: 'Total buyout = 68% of trade RCV; subcontractor furnishes materials.',
  },
  {
    division: 'Cleaning & Final Punch',
    executionType: 'In-House Self-Perform',
    laborFactor: 0.72,
    turnkey: false,
    materialRule: 'consumables',
    codes: ['CLN'],
    keywords: ['clean', 'punch', 'detail'],
    note: 'Direct labor = 72% of retail labor; consumables only.',
  },
];

/** Fallback for codes/keywords outside the canonical taxonomy. */
export const GENERAL_PROFILE: DivisionProfile = {
  division: 'General Conditions (Unmapped)',
  executionType: 'In-House Self-Perform',
  laborFactor: 0.72,
  turnkey: false,
  materialRule: 'buyout',
  codes: [],
  keywords: [],
  note: 'Fallback profile — not part of the 14 canonical divisions.',
};

export function matchDivision(trade: {
  trade_name?: string;
  category_codes_included?: string[];
}): DivisionProfile {
  const codes = (trade.category_codes_included || []).map((c) =>
    String(c).toUpperCase().trim()
  );
  const name = String(trade.trade_name || '').toLowerCase();
  for (const p of DIVISION_PROFILES) {
    if (p.codes.some((c) => codes.includes(c))) return p;
  }
  for (const p of DIVISION_PROFILES) {
    if (p.keywords.some((k) => name.includes(k))) return p;
  }
  return GENERAL_PROFILE;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const finite = (n: unknown, fallback = 0) => {
  const v = typeof n === 'string' ? Number(n) : n;
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};

/**
 * Normalizes and repairs the Finish-to-Start predecessor graph:
 * unknown ids, self-dependencies, duplicates and cycles are removed
 * deterministically (array order decides which edge breaks a cycle).
 */
export function repairPredecessorGraph(trades: TradeSection[]): {
  trades: TradeSection[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const ids = trades.map((t) => String(t.task_id || '').trim());
  const idSet = new Set(ids);
  const edges = new Map<string, string[]>();

  for (const t of trades) {
    const id = String(t.task_id || '').trim();
    const raw = String(t.predecessors || '')
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const clean: string[] = [];
    for (const p of raw) {
      if (!idSet.has(p)) {
        warnings.push(`${id}: dropped unknown predecessor "${p}"`);
        continue;
      }
      if (p === id) {
        warnings.push(`${id}: dropped self-dependency`);
        continue;
      }
      if (!clean.includes(p)) clean.push(p);
    }
    edges.set(id, clean);
  }

  // Kahn-style resolution; leftover nodes are in cycles and get pruned.
  const pending = new Set(ids);
  const resolve = () => {
    let progress = true;
    while (progress) {
      progress = false;
      for (const id of [...pending]) {
        const active = (edges.get(id) || []).filter((p) => pending.has(p));
        if (active.length === 0) {
          pending.delete(id);
          progress = true;
        }
      }
    }
  };
  resolve();
  let guard = 0;
  while (pending.size > 0 && guard++ < ids.length * 4) {
    const id = [...pending][0];
    const active = (edges.get(id) || []).filter((p) => pending.has(p));
    if (active.length === 0) {
      pending.delete(id);
      continue;
    }
    const victim = active[0];
    edges.set(
      id,
      (edges.get(id) || []).filter((p) => p !== victim)
    );
    warnings.push(`${id}: removed predecessor "${victim}" to break a dependency cycle`);
    resolve();
  }

  const repaired = trades.map((t) => {
    const id = String(t.task_id || '').trim();
    const finalEdges = edges.get(id) || [];
    const original = String(t.predecessors || '')
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(', ');
    const normalized = finalEdges.join(', ');
    return original === normalized ? t : { ...t, predecessors: normalized };
  });

  return { trades: repaired, warnings };
}

/**
 * Applies the full deterministic budget engine to an estimate and returns a
 * new object. Safe to run on raw samples (derived defaults) or on AI
 * extractions (line-item based); running it twice is idempotent.
 */
export function applyBudgetEngine(input: EstimateResult): EstimateResult {
  const estimate: EstimateResult = JSON.parse(JSON.stringify(input));
  const warnings: string[] = [];
  const assumptions: string[] = [
    `Material sales tax (Indiana) ${(MATERIAL_TAX_RATE * 100).toFixed(2)}% applied to direct materials.`,
    'Turnkey subcontract buyout = 68% of trade RCV (sub furnishes labor + materials).',
    'Trade RCV = line-item subtotal + apportioned material tax + apportioned O&P.',
  ];

  const meta = estimate.project_meta;
  const { trades: repaired, warnings: graphWarnings } = repairPredecessorGraph(
    estimate.trade_sections || []
  );
  warnings.push(...graphWarnings);
  estimate.trade_sections = repaired;

  const modelBasis =
    finite(meta.base_subtotal) > 0 &&
    repaired.some((t) => finite(t.direct_subtotal) > 0);
  const basis: BudgetAudit['basis'] = modelBasis ? 'model_extraction' : 'derived_defaults';
  if (!modelBasis) {
    assumptions.push(
      'Derived defaults used: labor/material split 60/40 of subtotal, O&P estimated at 1/11 of RCV when not itemized.'
    );
  }

  const n = repaired.length || 1;
  const subtotals = repaired.map((t) =>
    modelBasis && finite(t.direct_subtotal) > 0
      ? finite(t.direct_subtotal)
      : finite(t.billable_revenue) > 0
        ? finite(t.billable_revenue)
        : 0
  );
  const sumSubtotals = subtotals.reduce((a, b) => a + b, 0);

  const carrierRcv = finite(meta.total_rcv) || round2(sumSubtotals);
  const taxTotal = modelBasis ? finite(meta.material_tax) : 0;
  const opTotal = modelBasis
    ? finite(meta.op_total) || finite(meta.overhead_and_profit)
    : finite(meta.op_total) || finite(meta.overhead_and_profit) || round2(carrierRcv / 11);

  // 1) Apportion tax + O&P by line-item share (allocation factor).
  const rcvRaw = repaired.map((_, i) => {
    if (basis === 'derived_defaults' && finite(repaired[i].billable_revenue) > 0) {
      return finite(repaired[i].billable_revenue);
    }
    if (sumSubtotals <= 0) {
      // No per-trade line-item basis at all: stay at $0 rather than inventing a
      // derived O&P spread that could never reconcile to the carrier summary.
      return 0;
    }
    const share = subtotals[i] / sumSubtotals;
    return subtotals[i] + taxTotal * share + opTotal * share;
  });

  // 2) Reconcile the rollout against the carrier RCV.
  //
  //    Small gaps (<= max($1.00, 0.05% of RCV)) are genuine rounding drift and
  //    are loaded onto the largest trade package (historic behavior). Bigger
  //    gaps are a STRUCTURAL mismatch: the extracted line items do not sum to
  //    the carrier summary, so the line-item basis is scaled proportionally
  //    (k <= 0 is impossible: C > 0, S > 0, T/O >= 0) and the rollout is
  //    rebuilt from the scaled basis — sums, margins and re-runs stay honest.
  //    Without any basis, trades remain at $0 with an explicit warning.
  const roundingTolerance = Math.max(1.0, carrierRcv * 0.0005);
  const gap = round2(carrierRcv - round2(rcvRaw.reduce((a, b) => a + b, 0)));
  let basisSubtotals = subtotals;
  let scaledBaseSubtotal: number | null = null;
  let auditTax = taxTotal;
  let auditOp = opTotal;
  let scaleFactor: number | null = null;
  // Effective proportional-scale factor for procurement allowances (1 =
  // untouched). Set whenever the structural reconciliation fires below
  // (both the S>0 and the billable-basis branches); 1 on the rounding path.
  let allowanceScale = 1;

  if (rcvRaw.length > 0 && Math.abs(gap) > roundingTolerance) {
    const positiveBillable = repaired.reduce(
      (a, t) => a + Math.max(0, finite(t.billable_revenue)),
      0
    );
    if (sumSubtotals > 0) {
      const k = carrierRcv / (sumSubtotals + taxTotal + opTotal);
      const scaledSub = subtotals.map((s) => round2(s * k));
      const scaledSum = scaledSub.reduce((a, b) => a + b, 0);
      auditTax = round2(taxTotal * k);
      auditOp = round2(opTotal * k);
      scaledBaseSubtotal = round2(sumSubtotals * k);
      scaleFactor = k;
      allowanceScale = k;
      basisSubtotals = scaledSub;
      // Rebuild from the scaled basis with the exact formula the next run
      // will use, so `applyBudgetEngine(result)` is a no-op on money fields.
      for (let i = 0; i < rcvRaw.length; i++) {
        const share = scaledSum > 0 ? scaledSub[i] / scaledSum : 1 / n;
        rcvRaw[i] = scaledSub[i] + auditTax * share + auditOp * share;
      }
      warnings.push(
        `Line-item subtotals ($${round2(sumSubtotals).toFixed(2)}) did not reconcile to carrier RCV ($${round2(carrierRcv).toFixed(2)}); trade revenue scaled proportionally (factor ${k.toFixed(6)}, Δ $${gap.toFixed(2)}).`
      );
    } else if (positiveBillable > 0) {
      // Defensive fallback (unreachable while subtotals mirror positive
      // billable amounts, but kept per spec): scale from billable revenue.
      const k = carrierRcv / positiveBillable;
      scaleFactor = k;
      allowanceScale = k;
      for (let i = 0; i < rcvRaw.length; i++) {
        rcvRaw[i] = round2(Math.max(0, finite(repaired[i].billable_revenue)) * k);
      }
      warnings.push(
        `No line-item subtotals; trade revenue scaled proportionally from extracted billable amounts (factor ${k.toFixed(6)}, Δ $${gap.toFixed(2)}).`
      );
    } else {
      warnings.push(
        'No per-trade line-item basis found; trade rollout left unmatched to the carrier RCV.'
      );
    }
  }

  // 2b) True-up the (possibly rebuilt) rollout against the carrier RCV: absorb
  //     any residual rounding gap on the largest trade, then nail the cent
  //     residue so Σ trade RCV == carrier RCV exactly. Never drives a trade
  //     negative.
  const hasBasis = modelBasis || scaleFactor !== null;
  const delta = round2(carrierRcv - round2(rcvRaw.reduce((a, b) => a + b, 0)));
  if (hasBasis && Math.abs(delta) > 0.01 && rcvRaw.length > 0) {
    let largest = -1;
    for (let i = 0; i < rcvRaw.length; i++) {
      if (rcvRaw[i] + delta < 0) continue; // keep every trade >= $0
      if (largest === -1 || rcvRaw[i] > rcvRaw[largest]) largest = i;
    }
    if (largest >= 0) {
      rcvRaw[largest] = round2(rcvRaw[largest] + delta);
      warnings.push(`Reconciled $${delta.toFixed(2)} rounding variance against the largest trade package.`);
    }
  }
  if (hasBasis && rcvRaw.length > 0) {
    for (let i = 0; i < rcvRaw.length; i++) rcvRaw[i] = round2(rcvRaw[i]);
    const residual = round2(carrierRcv - round2(rcvRaw.reduce((a, b) => a + b, 0)));
    if (residual !== 0) {
      let target = -1;
      for (let i = 0; i < rcvRaw.length; i++) {
        if (rcvRaw[i] + residual < 0) continue;
        if (target === -1 || rcvRaw[i] > rcvRaw[target]) target = i;
      }
      if (target >= 0) rcvRaw[target] = round2(rcvRaw[target] + residual);
    }
  }

  // 3) Per-trade direct cost + margin math. The retail split and direct costs
  //    derive from the SCALED subtotal basis whenever reconciliation rescaled
  //    the rollout, so margins track the reconciled dollars.
  const trades = repaired.map((t, i) => {
    const profile = matchDivision(t);
    const rcv = round2(rcvRaw[i]);
    const subtotal = basisSubtotals[i] > 0 ? basisSubtotals[i] : rcv;

    let retailLabor = finite(t.retail_labor);
    let retailMaterial = finite(t.retail_material);
    if (retailLabor + retailMaterial <= 0) {
      retailLabor = round2(subtotal * DEFAULT_LABOR_SPLIT);
      retailMaterial = round2(Math.max(0, subtotal - retailLabor));
    } else if (retailLabor + retailMaterial > subtotal * 1.05) {
      const scale = subtotal / (retailLabor + retailMaterial);
      retailLabor = round2(retailLabor * scale);
      retailMaterial = round2(retailMaterial * scale);
      warnings.push(`${t.task_id}: retail labor/material scaled down to the extracted subtotal basis.`);
    }

    let directLabor: number;
    let materialPreTax: number;
    if (profile.turnkey) {
      directLabor = round2(rcv * TURNKEY_BUYOUT_FACTOR);
      materialPreTax = 0;
    } else {
      directLabor = round2(retailLabor * profile.laborFactor);
      materialPreTax = round2(retailMaterial);
      if (profile.materialRule === 'consumables') {
        materialPreTax = round2(Math.min(materialPreTax, rcv * CONSUMABLES_CAP));
      }
    }
    const materialTax = round2(materialPreTax * MATERIAL_TAX_RATE);
    const directMaterial = round2(materialPreTax + materialTax); // spec checksum convention (incl. tax)
    const totalDirect = round2(directMaterial + directLabor);
    const grossProfit = round2(rcv - totalDirect);
    const margin = rcv > 0 ? round2((grossProfit / rcv) * 100) : 0;

    return {
      ...t,
      ...(scaledBaseSubtotal !== null ? { direct_subtotal: basisSubtotals[i] } : {}),
      billable_revenue: rcv,
      trade_division: t.trade_division || profile.division,
      execution_type: t.execution_type || profile.executionType,
      retail_labor: retailLabor,
      retail_material: retailMaterial,
      direct_material: directMaterial,
      direct_labor: directLabor,
      equipment_tax: 0,
      total_direct_cost: totalDirect,
      gross_profit: grossProfit,
      gross_margin_pct: margin,
      budget_basis: t.budget_basis || basis,
    };
  });

  // 4) Material allowance roll-up (Output 2), dropping turnkey trades.
  const keptAllowances: MaterialAllowanceItem[] = [];
  const perTradeAllowanceTax = new Map<string, number>();
  const perTradeAllowanceTotal = new Map<string, number>();
  for (const raw of estimate.material_allowances || []) {
    const tradeRef = String(raw.trade || '').trim();
    const owner =
      trades.find((t) => t.trade_name === tradeRef) ||
      trades.find((t) => t.task_id === tradeRef);
    if (!owner) continue;
    if (matchDivision(owner).turnkey) continue; // turnkey subs furnish materials
    const qty = finite(raw.qty);
    const unit = finite(raw.unit_cost);
    // When the rollout is rescaled to reconcile with the carrier summary,
    // procurement allowances minted from the same (mis-extracted) line items
    // are scaled by the same factor so margins stay benchmark-sane and
    // Checksum 2 (Σ direct material == allowance total ± $0.02) still holds.
    // k=1 is an exact no-op for consistent inputs.
    const scaledUnit = allowanceScale === 1 ? round2(unit) : round2(unit * allowanceScale);
    const item: MaterialAllowanceItem = {
      trade: owner.trade_name,
      component_code: raw.component_code ? String(raw.component_code) : undefined,
      description: String(raw.description || '').trim(),
      qty,
      uom: String(raw.uom || 'EA').toUpperCase(),
      unit_cost: scaledUnit,
      extended_cost: round2(qty * scaledUnit),
      vendor: raw.vendor ? String(raw.vendor) : undefined,
    };
    if (!item.description || item.qty <= 0) continue;
    keptAllowances.push(item);
    perTradeAllowanceTax.set(owner.trade_name, (perTradeAllowanceTax.get(owner.trade_name) || 0) + item.extended_cost * MATERIAL_TAX_RATE);
    perTradeAllowanceTotal.set(
      owner.trade_name,
      (perTradeAllowanceTotal.get(owner.trade_name) || 0) + item.extended_cost * (1 + MATERIAL_TAX_RATE)
    );
  }
  estimate.material_allowances = keptAllowances;

  // Always persist the computed per-trade budget fields; itemized trades then
  // override the derived material cost so Output 2 reconciles.
  estimate.trade_sections = trades.map((t) => {
    if (!perTradeAllowanceTotal.has(t.trade_name)) return t;
    const directMaterial = round2(perTradeAllowanceTotal.get(t.trade_name) || 0);
    const totalDirect = round2(directMaterial + (t.direct_labor || 0) + (t.equipment_tax || 0));
    const grossProfit = round2(t.billable_revenue - totalDirect);
    return {
      ...t,
      direct_material: directMaterial,
      total_direct_cost: totalDirect,
      gross_profit: grossProfit,
      gross_margin_pct:
        t.billable_revenue > 0 ? round2((grossProfit / t.billable_revenue) * 100) : 0,
    };
  });

  // 5) Audit block (the spec's reconciliation scratchpad).
  const sumTradeRcv = round2(estimate.trade_sections.reduce((a, t) => a + finite(t.billable_revenue), 0));
  const sumDirectMaterial = round2(estimate.trade_sections.reduce((a, t) => a + finite(t.direct_material), 0));
  const allowanceSubtotal = round2(keptAllowances.reduce((a, item) => a + item.extended_cost, 0));
  const allowanceTax = round2(allowanceSubtotal * MATERIAL_TAX_RATE);
  const allowanceTotal = round2(allowanceSubtotal + allowanceTax);
  const materialVariance = keptAllowances.length > 0 ? round2(sumDirectMaterial - allowanceTotal) : 0;
  const rcvDelta = round2(carrierRcv - sumTradeRcv);
  const itemizedTrades = new Set(keptAllowances.map((a) => a.trade));
  const allNonTurnkeyItemized = estimate.trade_sections
    .filter((t) => !matchDivision(t).turnkey)
    .every((t) => itemizedTrades.has(t.trade_name));

  const audit: BudgetAudit = {
    carrier_total_rcv: round2(carrierRcv),
    base_subtotal:
      scaledBaseSubtotal !== null
        ? scaledBaseSubtotal
        : round2(modelBasis ? finite(meta.base_subtotal) : sumSubtotals),
    material_tax: round2(auditTax),
    op_total: round2(auditOp),
    sum_trade_rcv: sumTradeRcv,
    delta_rcv: rcvDelta,
    sum_direct_material: sumDirectMaterial,
    allowance_subtotal: allowanceSubtotal,
    allowance_tax: allowanceTax,
    allowance_total: allowanceTotal,
    material_variance: materialVariance,
    rcv_reconciled: Math.abs(rcvDelta) <= 0.01,
    material_reconciled:
      keptAllowances.length > 0 && allNonTurnkeyItemized && Math.abs(materialVariance) <= 0.02,
    basis,
    assumptions,
  };

  estimate.project_meta = {
    ...meta,
    base_subtotal: audit.base_subtotal,
    material_tax: audit.material_tax,
    op_total: audit.op_total,
    // Keep the legacy field in sync when the summary was rescaled, so a re-run
    // cannot resurrect raw O&P dollars through the fallback chain.
    ...(scaledBaseSubtotal !== null && meta.overhead_and_profit !== undefined
      ? { overhead_and_profit: audit.op_total }
      : {}),
  };
  estimate.budget_audit = audit;
  if (warnings.length > 0) {
    estimate.processing = {
      ...(estimate.processing || {}),
      warnings: [...(estimate.processing?.warnings || []), ...warnings],
    };
  }
  return estimate;
}
