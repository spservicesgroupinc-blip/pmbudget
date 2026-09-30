/**
 * Framework-free server routines shared by the local dev server (server.ts)
 * and the Vercel serverless functions (api/*.ts).
 *
 * No framework or config imports here: each routine returns an
 * HTTP-shaped `{ status, body }` result and keeps all logging inside so both
 * callers behave identically.
 */
import { extractPdfText } from './pdfText.js';
import { hasApiKey, resolveModel } from './deepseek.js';
import { ESTIMATE_ENGINE_VERSION, processEstimate } from './xactEngine.js';
import { WORK_ORDER_ENGINE_VERSION, generateWorkOrderPackage } from './workOrderEngine.js';
import type { EstimateResult } from './src/types/estimate.js';

export interface RoutineResult {
  status: number;
  body: unknown;
}

export function healthPayload() {
  return {
    status: 'ok',
    provider: 'deepseek',
    hasApiKey: hasApiKey(),
    model: resolveModel(),
    capabilities: [
      'budget-engine-v2',
      'material-allowance',
      'customer-selections',
      'deterministic-audit',
      'json-repair-retries',
      'field-work-orders',
    ],
    engines: {
      estimate: ESTIMATE_ENGINE_VERSION,
      workOrders: WORK_ORDER_ENGINE_VERSION,
    },
  };
}

const MAX_TEXT_CHARS = 250_000;

function isEstimateWithTradeSections(value: unknown): value is EstimateResult {
  if (!value || typeof value !== 'object') return false;
  const tradeSections = (value as { trade_sections?: unknown }).trade_sections;
  return Array.isArray(tradeSections) && tradeSections.length > 0;
}

export async function runProcessEstimate(payload: {
  pdfBase64?: unknown;
  componentsPdfBase64?: unknown;
  textContent?: unknown;
  prompt?: unknown;
  filename?: unknown;
  componentsFilename?: unknown;
}): Promise<RoutineResult> {
  try {
    const {
      pdfBase64,
      componentsPdfBase64,
      textContent,
      prompt,
      filename,
      componentsFilename,
    } = payload || {};
    const apiKey = process.env.DEEPSEEK_API_KEY;

    if (!apiKey) {
      return {
        status: 500,
        body: {
          error: 'DEEPSEEK_API_KEY is not configured in server environment.',
        },
      };
    }

    // Legacy inline extraction prompt removed — the budget engine prompt
    // now lives in xactEngine.ts (14-division taxonomy, allocation math,
    // material allowance rules, work-order-ready scope summaries).

    // (legacy inline response schema removed — superseded by the strict
    // ESTIMATE_RESPONSE_SCHEMA in xactEngine.ts)

    let sourceText = '';
    let sourceLabel = 'pasted estimate text';

    if (typeof pdfBase64 === 'string' && pdfBase64) {
      // DeepSeek is text-only, so the PDF is converted to plain text first.
      const extractedText = await extractPdfText(pdfBase64);
      if (!extractedText.trim()) {
        return {
          status: 422,
          body: {
            error:
              'Could not extract readable text from this PDF (it may be a scanned image). Please use the "Paste Text" option instead.',
          },
        };
      }
      sourceText = extractedText;
      sourceLabel = typeof filename === 'string' && filename ? filename : 'uploaded PDF';
    } else if (typeof textContent === 'string' && textContent.trim()) {
      sourceText = textContent;
    } else {
      return {
        status: 400,
        body: { error: 'Please provide either a PDF file or text content.' },
      };
    }

    // Optional second upload: the Xactimate Component Breakdown Report. Its
    // text is merged into the SAME extraction pass beneath a marker header,
    // so the engine's "Case A" rule (exact component quantities, no added
    // waste factors) applies to the material allowance roll-up — one AI call,
    // one reconciled estimate.
    if (typeof componentsPdfBase64 === 'string' && componentsPdfBase64) {
      const componentText = await extractPdfText(componentsPdfBase64);
      if (componentText.trim()) {
        const componentLabel =
          typeof componentsFilename === 'string' && componentsFilename
            ? componentsFilename
            : 'component breakdown report';
        sourceText = `${sourceText}\n\n===== COMPONENT BREAKDOWN REPORT (${componentLabel}) =====\n\n${componentText}`;
      }
    }

    const clippedText =
      sourceText.length > MAX_TEXT_CHARS
        ? `${sourceText.slice(0, MAX_TEXT_CHARS)}\n\n[...estimate text truncated for length...]`
        : sourceText;

    // Budget-engine v2: LLM extraction + normalization + deterministic
    // reconciliation (model arithmetic is never trusted), with retries,
    // truncation detection and JSON repair passes.
    const estimate = await processEstimate(clippedText, {
      userPrompt: typeof prompt === 'string' && prompt.trim() ? prompt : undefined,
    });
    estimate.source_filename = estimate.source_filename || sourceLabel;
    return { status: 200, body: estimate };
  } catch (err) {
    console.error('Error in /api/process-estimate:', err);
    const name = err instanceof Error ? err.name : '';
    const message = err instanceof Error ? err.message : '';
    return {
      status: 500,
      body: {
        error:
          name === 'AbortError'
            ? 'DeepSeek request timed out after 300 seconds.'
            : message || 'Failed to process Xactimate estimate.',
      },
    };
  }
}

export async function runGenerateWorkOrders(
  payload: { estimate?: unknown }
): Promise<RoutineResult> {
  try {
    const estimate = payload?.estimate;
    if (!isEstimateWithTradeSections(estimate)) {
      return {
        status: 400,
        body: { error: 'Provide an estimate with at least one trade section.' },
      };
    }

    const result = await generateWorkOrderPackage(estimate);
    console.log(
      `[work-orders] generated ${result.meta.crews} crew packet(s) via ${result.meta.source} in ${result.meta.duration_ms}ms`
    );
    return {
      status: 200,
      body: {
        work_orders: result.work_orders,
        site_logistics: result.site_logistics,
        generated_at: new Date().toISOString(),
        meta: result.meta,
      },
    };
  } catch (err) {
    console.error('Error in /api/generate-work-orders:', err);
    const message = err instanceof Error && err.message ? err.message : '';
    return {
      status: 500,
      body: { error: message || 'Failed to generate field work orders.' },
    };
  }
}
