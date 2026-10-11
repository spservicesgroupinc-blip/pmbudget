/**
 * Standalone customer-selection extraction rerun (server-only).
 *
 * The budget extraction call (`xactEngine.processEstimate`) also asks for the
 * customer selections, but its trade-roll-up workload can drop finish choices —
 * or omit the list entirely. When that happens this module reruns a DEDICATED
 * AI pass over the original uploaded document(s): the full Xactimate estimate
 * and/or the component breakdown report, each labeled with a `=====` header.
 *
 * The rerun prompt explicitly tells the model that customer selection data can
 * live in EITHER document (the full estimate carries the choices as room-by-room
 * line items; the component report carries exact quantities and material-only
 * pricing) so the selection sheet is always built from a complete, accurate
 * extraction of both uploaded PDFs.
 */
import { deepseekJsonWithMeta } from './deepseek.js';
import { SOURCE_DOCUMENTS_GUIDE } from './src/utils/sourceDocuments.js';

export interface CustomerSelectionRerunInput {
  /** Merged source text: full estimate and/or component report under `=====` headers. */
  sourceText: string;
  /** Already-extracted choices to preserve and deduplicate (may be empty). */
  existing: unknown[];
  /** Product labels the source coverage check could not find in the current list. */
  coverageGaps: string[];
  /** The customer_selections schema slice (kept in sync with ESTIMATE_RESPONSE_SCHEMA). */
  selectionSchemaJson: string;
  /** Wall-clock deadline (epoch ms), shared with the parallel budget pass. */
  deadline?: number;
  /** External cancellation so an unused speculative pass can be dropped. */
  signal?: AbortSignal;
}

export interface CustomerSelectionRerunResult {
  /** Complete extracted rows, or null when the model omitted the list (caller must fail). */
  rows: unknown[] | null;
  tokens: number;
}

export async function runCustomerSelectionRerun(
  input: CustomerSelectionRerunInput
): Promise<CustomerSelectionRerunResult> {
  const gaps = input.coverageGaps.filter(Boolean);
  const response = await deepseekJsonWithMeta<{ customer_selections?: unknown }>({
    system: `You extract the complete CUSTOMER FINISH SELECTIONS list from Xactimate restoration documents.
${SOURCE_DOCUMENTS_GUIDE}
Return ONLY a JSON object with a single key: {"customer_selections":[...]} matching this schema:
${input.selectionSchemaJson}
The selection list is the authoritative inventory of every finish the customer must choose.
Work through BOTH documents section by section when both are present: every room, every line
item and every component table. Customer-choice signals such as "customer to select", "owner to
choose", "TBD", color, finish, grade, style and material notes are strong evidence of a
selection — capture them even when no price is shown.
Include all replacement finishes and appliances, even when turnkey subcontractors supply them or
no budget trade division exists for that product.
Each item needs trade, description, qty, uom and allowance_per_unit; optional component_code,
vendor and notes. Preserve the descriptions of the existing choices where they identify the same
product, copying their text exactly so duplicates are never created. Return the COMPLETE
corrected list, not only the missing products.
Exclude removal-only, detach/reset/reinstall, credited, omitted, cleaning and labor-only work.
Include replacement material even if its line also includes installation labor.
Paint application rows require a color/finish selection even when no paint gallons are listed.
Keep the exact painted SF/LF scope; never invent gallons. Room measurement summaries (SF Floor,
SY Flooring, LF Perimeter) are geometry, not new finish choices. Install-only baseboard/casing
does not include a new material choice unless supply or replacement material is stated.
In a component report, only MATERIAL COMPONENTS can supply customer material pricing.
EQUIPMENT COMPONENTS and LABOR COMPONENTS use the same column headings but are not materials.
Painter's putty, caulking, sandpaper, carpet pad/tackless strips and seaming tape are preparation supplies.
Join a paint material such as PNTL Latex paint to the paint application scopes; return one paint
product in GL with all painted areas in notes, not duplicate SF/LF paint applications plus gallons.
Do not add rough-in or hidden construction supplies (valves, wiring, drywall, adhesives, ...).
Use exact component quantities when available, otherwise installed quantities; add no waste.
Never count both an estimate line and its component-report equivalent: when the component report
prices a product from the full estimate, return ONE joined row for that product.
Keep different products, sizes, grades and finishes separate; aggregate identical products
across rooms and retain their room names and choices in notes.
Only explicitly supported MATERIAL-ONLY, pre-tax pricing may be allowance_per_unit. Read the
Material/Mat columns and component pricing tables; when only an extended material total is
shown, divide it by the matching material quantity, converting units when necessary
(1 SY = 9 SF). Never copy a combined installation/labor rate, tax, O&P or total RCV.
Use null when material-only pricing is unavailable. Never fabricate products or quantities.
Before returning, re-scan the source documents and cover every highlighted coverage gap.`,
    user: `${gaps.length ? `Coverage gaps to resolve: ${gaps.join(', ')}\n` : ''}Existing choices (keep matching rows, do not duplicate):\n${JSON.stringify(input.existing)}\n\nSOURCE DOCUMENTS (full Xactimate estimate and/or component breakdown report, each introduced by a ===== header):\n\n${input.sourceText}`,
    temperature: 0,
    label: 'customer-selection-rerun',
    attempts: 3,
    requireComplete: true,
    deadline: input.deadline,
    signal: input.signal,
  });
  const rows =
    response.data && typeof response.data === 'object' && Array.isArray(response.data.customer_selections)
      ? response.data.customer_selections
      : null;
  return { rows, tokens: response.usage?.total_tokens || 0 };
}
