/**
 * Source-document markers and prompt guidance shared between the upload
 * pipeline (`serverRoutines.ts`) and every server-side extraction prompt.
 *
 * Intake accepts TWO documents: the full Xactimate estimate and the optional
 * Xactimate Component Breakdown Report. Each document is written beneath a
 * `=====` marker header before the texts are merged, so every AI pass can
 * attribute line items — and especially customer finish selections — to the
 * document they came from. Either document alone is valid input.
 */

export const ESTIMATE_DOCUMENT_TITLE = 'XACTIMATE ESTIMATE';
export const COMPONENT_DOCUMENT_TITLE = 'COMPONENT BREAKDOWN REPORT';

/** Marker header written above the primary uploaded estimate text. */
export function estimateDocumentHeader(label: string): string {
  return `===== ${ESTIMATE_DOCUMENT_TITLE} (${label}) =====`;
}

/** Marker header written above the optional component breakdown report text. */
export function componentDocumentHeader(label: string): string {
  return `===== ${COMPONENT_DOCUMENT_TITLE} (${label}) =====`;
}

/**
 * Prompt paragraph embedded in every extraction prompt that reads the merged
 * source. Kept in one place so the marker names can never drift from the
 * headers written by the upload pipeline.
 */
export const SOURCE_DOCUMENTS_GUIDE =
  `SOURCE DOCUMENTS: the source text contains ONE OR TWO documents, each introduced by a line of ` +
  `"=====" characters naming it — the ${ESTIMATE_DOCUMENT_TITLE} and/or the ${COMPONENT_DOCUMENT_TITLE}. ` +
  `Either document alone is valid input; when no marker line is present, treat the whole text as a ` +
  `single document. Customer selection data can appear in EITHER or BOTH documents: the full estimate ` +
  `carries the finish choices as room-by-room line items (flooring, carpet, tile, cabinets, countertops, ` +
  `paint, trim/doors, fixtures, lighting, hardware, appliances), while the component report carries ` +
  `exact material quantities and material-only pricing for the same products. Search BOTH documents ` +
  `whenever both are present, join matching products into one row, and never omit a choice because it ` +
  `appears in only one of them.`;
