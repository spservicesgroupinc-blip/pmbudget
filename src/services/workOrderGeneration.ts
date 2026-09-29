/**
 * Final work-order generation service.
 *
 * The mandated app flow is: extract -> ADJUST the buyout budget -> generate
 * final work orders. The adjusted buyout drives every contract amount, so
 * generation is gated on `EstimateResult.budget_adjusted_at` (see
 * `isBudgetAdjusted`) and runs only on an explicit user action.
 *
 * The server call is optional infrastructure: on ANY AI/service failure this
 * module resolves with deterministic field templates instead of rejecting.
 */
import type {
  EstimateResult,
  WorkOrder,
  WorkOrderSiteLogistics,
} from '../types/estimate';
import {
  buildFallbackWorkOrders,
  buildSiteLogistics,
  estimateForWorkOrderRequest,
  redactWorkOrders,
} from '../utils/workOrders';

export interface FinalWorkOrderGenerationResult {
  /** Redacted crew packets ready to store on the estimate. */
  workOrders: WorkOrder[];
  siteLogistics?: WorkOrderSiteLogistics;
  /** ISO timestamp for estimate.work_orders_generated_at. */
  generatedAt: string;
  /** 'AI generation' | 'AI + field templates' | 'deterministic field templates' */
  sourceLabel: string;
  usedFallback: boolean;
  errorMessage?: string;
}

/** True when the buyout budget has been explicitly adjusted for this estimate. */
export function isBudgetAdjusted(estimate: EstimateResult | null | undefined): boolean {
  return Boolean(estimate?.budget_adjusted_at);
}

/**
 * Generates final work orders from the adjusted budget. Falls back to
 * deterministic field templates on ANY AI/service failure — never rejects
 * for service errors.
 */
export async function generateFinalWorkOrders(
  estimate: EstimateResult
): Promise<FinalWorkOrderGenerationResult> {
  const buildFallback = (errorMessage?: string): FinalWorkOrderGenerationResult => ({
    workOrders: redactWorkOrders(buildFallbackWorkOrders(estimate), estimate),
    siteLogistics: buildSiteLogistics(estimate),
    generatedAt: new Date().toISOString(),
    sourceLabel: 'deterministic field templates',
    usedFallback: true,
    errorMessage,
  });

  try {
    const res = await fetch('/api/generate-work-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estimate: estimateForWorkOrderRequest(estimate) }),
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(
        (errorData as { error?: string }).error || `Server responded with status ${res.status}`
      );
    }

    const payload = (await res.json()) as {
      work_orders?: WorkOrder[];
      site_logistics?: WorkOrderSiteLogistics;
      generated_at?: string;
      meta?: { source?: string };
    };
    const applied: WorkOrder[] = Array.isArray(payload.work_orders) ? payload.work_orders : [];
    if (applied.length === 0) throw new Error('No crews were generated for this estimate.');

    const source = payload.meta?.source;
    const sourceLabel =
      source === 'ai'
        ? 'AI generation'
        : source === 'mixed'
          ? 'AI + field templates'
          : 'deterministic field templates';

    return {
      workOrders: redactWorkOrders(applied, estimate),
      siteLogistics: payload.site_logistics,
      generatedAt: payload.generated_at || new Date().toISOString(),
      sourceLabel,
      usedFallback: false,
    };
  } catch (err: any) {
    return buildFallback(err?.message || 'request failed');
  }
}
