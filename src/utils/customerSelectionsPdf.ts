/**
 * Customer Selections & Material Allowance Sheet (pdf-lib, environment-neutral).
 *
 * Customer-facing money document: allowance amounts are drawn deliberately
 * (the same sanctioned exception as subcontract contract amounts). Carrier
 * RCV, O&P, margins and carrier unit rates are never printed; dynamic text
 * still passes through the redaction choke point so no Xactimate category
 * codes or pricing language can leak. Runs in the browser and in Node
 * verification scripts.
 */
import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import type { CustomerSelectionItem, EstimateResult } from '../types/estimate';
import { formatMoney, redactFinancials } from './workOrders';
import { PDF_PALETTE, sanitize } from './workOrderPdf';
import {
  computeCustomerSelectionsChecksum,
  computeSelectionTotals,
  customerSelectionsPdfFilename,
  groupSelectionsByCategory,
} from './customerSelections';

export { customerSelectionsPdfFilename };

export interface CustomerSelectionsPdfOptions {
  generatedAt?: Date | string;
}

const PAGE_W = 612; // Letter
const PAGE_H = 792;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_TOP = 46;

const {
  RED,
  RED_DARK,
  INK,
  SLATE_900,
  SLATE_700,
  SLATE_600,
  SLATE_500,
  SLATE_400,
  LINE,
  SOFT,
  WHITE,
} = PDF_PALETTE;

// Table geometry (right edge = MARGIN + CONTENT_W = 564).
const COL_DESC_X = MARGIN;
const COL_DESC_W = 196;
const COL_QTY_X = 258;
const COL_QTY_W = 50;
const COL_UOM_X = 308;
const COL_UOM_W = 40;
const COL_UNIT_X = 348;
const COL_UNIT_W = 70;
const COL_TOTAL_X = 418;
const COL_TOTAL_W = 70;
const COL_VENDOR_X = 500; // 12pt gutter after the total column (right edge 488)
const COL_VENDOR_W = 64;
const MONEY_RIGHT = COL_TOTAL_X + COL_TOTAL_W;

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const formatQty = (n: number): string => {
  const v = Number.isFinite(n) ? round2(n) : 0;
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
};

class SelectionsPacket {
  private doc: PDFDocument;
  private reg: PDFFont;
  private bold: PDFFont;
  private italic: PDFFont;
  private page!: PDFPage;
  private pages: PDFPage[] = [];
  private y = 0;
  private headerLeft: string;
  private checksum: string;
  private generatedLabel: string;
  private extraCodes: string[];

  constructor(
    doc: PDFDocument,
    reg: PDFFont,
    bold: PDFFont,
    italic: PDFFont,
    headerLeft: string,
    checksum: string,
    generatedLabel: string,
    extraCodes: string[] = []
  ) {
    this.doc = doc;
    this.reg = reg;
    this.bold = bold;
    this.italic = italic;
    this.headerLeft = headerLeft;
    this.checksum = checksum;
    this.generatedLabel = generatedLabel;
    this.extraCodes = extraCodes;
    this.page = doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = PAGE_H - 64;
  }

  /** Redaction choke point for estimate-derived dynamic text (no carrier leakage). */
  private clean(raw: string): string {
    return sanitize(redactFinancials(String(raw ?? ''), this.extraCodes));
  }

  private wrapToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const words = String(text ?? '').split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (!current || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  private wrapClean(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    return this.wrapToWidth(this.clean(text), font, size, maxWidth);
  }

  /** Static, office-controlled copy: sanitize only, never redaction. */
  private wrapStatic(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    return this.wrapToWidth(sanitize(text), font, size, maxWidth);
  }

  /** Caps a wrapped block at two lines with a trailing ellipsis when longer. */
  private capTwo(lines: string[], font: PDFFont, size: number, maxWidth: number): string[] {
    if (lines.length <= 2) return lines;
    const words = lines.join(' ').split(/\s+/).filter(Boolean);
    const out: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (!current || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        out.push(current);
        current = word;
        if (out.length === 2) break;
      }
    }
    if (out.length < 2 && current) out.push(current);
    if (out.length >= 2) {
      let last = out[1];
      while (
        last.length > 1 &&
        font.widthOfTextAtSize(`${last} ...`, size) > maxWidth
      ) {
        last = last.replace(/\s+\S*$/, '');
      }
      out[1] = `${last} ...`;
    }
    return out;
  }

  private ensure(needed: number) {
    if (this.y - needed < FOOTER_TOP) this.newPage();
  }

  private newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.drawRunningHeader();
  }

  /** Hays+Sons "H+" mark, scaled from the 65x42 brand canvas (matches app header). */
  private drawBrandMark(page: PDFPage, x: number, yBottom: number, markHeight: number) {
    const s = markHeight / 42;
    page.drawRectangle({ x, y: yBottom, width: 14 * s, height: 42 * s, color: RED });
    page.drawRectangle({ x: x + 36 * s, y: yBottom, width: 14 * s, height: 42 * s, color: INK });
    page.drawRectangle({
      x: x + 14 * s,
      y: yBottom + 14 * s,
      width: 51 * s,
      height: 14 * s,
      color: INK,
    });
  }

  private drawRunningHeader() {
    this.drawBrandMark(this.page, MARGIN, PAGE_H - 42, 10);
    this.page.drawText(this.clean(this.headerLeft), {
      x: MARGIN + 65 * (10 / 42) + 6,
      y: PAGE_H - 40,
      font: this.reg,
      size: 8,
      color: SLATE_400,
    });
    const right = 'CUSTOMER SELECTIONS & ALLOWANCES';
    const w = this.bold.widthOfTextAtSize(right, 8);
    this.page.drawText(right, {
      x: PAGE_W - MARGIN - w,
      y: PAGE_H - 40,
      font: this.bold,
      size: 8,
      color: SLATE_400,
    });
    this.page.drawLine({
      start: { x: MARGIN, y: PAGE_H - 48 },
      end: { x: PAGE_W - MARGIN, y: PAGE_H - 48 },
      thickness: 0.75,
      color: LINE,
    });
    this.y = PAGE_H - 64;
  }

  /**
   * Money bypass: draws a pre-formatted allowance figure RIGHT-ALIGNED to the
   * given column edge, with sanitize() only, never redactFinancials — the
   * sanctioned exception for this customer-facing money document.
   */
  private moneyRight(
    xRight: number,
    y: number,
    str: string,
    size: number,
    font: PDFFont = this.reg,
    color: ReturnType<typeof rgb> = INK
  ) {
    const text = sanitize(str);
    const w = font.widthOfTextAtSize(text, size);
    this.page.drawText(text, { x: xRight - w, y, font, size, color });
  }

  private staticLines(
    text: string,
    font: PDFFont,
    size: number,
    color: ReturnType<typeof rgb>,
    x: number,
    maxWidth: number,
    lineHeight: number
  ) {
    for (const line of this.wrapStatic(text, font, size, maxWidth)) {
      this.ensure(lineHeight + 2);
      this.y -= lineHeight;
      this.page.drawText(line, { x, y: this.y, font, size, color });
    }
  }

  /** Right-aligns a string so its right edge lands on xRight. */
  private drawRightAligned(
    str: string,
    font: PDFFont,
    size: number,
    color: ReturnType<typeof rgb>,
    xRight: number,
    y: number
  ) {
    const text = sanitize(str);
    const w = font.widthOfTextAtSize(text, size);
    this.page.drawText(text, { x: xRight - w, y, font, size, color });
  }

  drawHeader(estimate: EstimateResult, selectionCount: number) {
    const markY = PAGE_H - 92;
    this.drawBrandMark(this.page, MARGIN, markY, 22);
    const textX = MARGIN + 65 * (22 / 42) + 8;
    this.page.drawText('Hays+Sons', {
      x: textX,
      y: markY + 22 * 0.72,
      font: this.bold,
      size: 22 * 0.44,
      color: INK,
    });
    this.page.drawText('Restoration Document Suite', {
      x: textX,
      y: markY + 22 * 0.26,
      font: this.reg,
      size: 22 * 0.31,
      color: SLATE_500,
    });
    this.y = markY - 46;

    this.page.drawText(sanitize('Customer Selections & Material Allowance Sheet'), {
      x: MARGIN,
      y: this.y,
      font: this.bold,
      size: 18,
      color: SLATE_900,
    });
    this.y -= 22;
    this.page.drawText(
      sanitize(`Customer finish selections — ${selectionCount} allowance item${selectionCount === 1 ? '' : 's'}`),
      {
        x: MARGIN,
        y: this.y,
        font: this.reg,
        size: 10.5,
        color: SLATE_500,
      }
    );
    this.y -= 16;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 1.5,
      color: RED,
    });
    this.y -= 20;

    const meta = estimate.project_meta || ({} as EstimateResult['project_meta']);
    const rows: Array<[string, string]> = [
      ['CLIENT', String(meta.client_name || '')],
      ['CLAIM NUMBER', String(meta.claim_number || '')],
      ['CARRIER', String(meta.carrier || '')],
      ['POLICY NUMBER', String(meta.policy_number || '')],
      ['PROPERTY ADDRESS', String(meta.property_address || '')],
      ['INSURED PHONE', String(meta.insured_phone || '')],
    ].map(([label, value]) => [label, value.trim() ? value : '-']);

    const labelX2 = MARGIN + 262;
    const valueX2 = labelX2 + 92;
    const valueMaxW = 150;
    rows.forEach(([label, value], i) => {
      const leftColumn = i < 3;
      const labelX = leftColumn ? MARGIN : labelX2;
      const valueX = leftColumn ? MARGIN + 92 : valueX2;
      const y = this.y - i % 3 * 16;
      this.page.drawText(label, { x: labelX, y, font: this.bold, size: 8, color: SLATE_400 });
      const lines = this.capTwo(
        this.wrapClean(value, this.reg, 9.5, valueMaxW),
        this.reg,
        9.5,
        valueMaxW
      );
      lines.forEach((line, li) => {
        this.page.drawText(line, { x: valueX, y: y - li * 11.5, font: this.reg, size: 9.5, color: SLATE_700 });
      });
    });
    this.y -= 3 * 16 + 14;

    this.staticLines(
      'The allowances below are the budgeted maximum amounts available for each customer material selection. Quantities, allowance rates and suggested vendors are listed for review. Any selection exceeding its allowance requires written change-order approval before purchase. Unused allowance balances are not paid out in cash.',
      this.reg,
      9.5,
      SLATE_600,
      MARGIN,
      CONTENT_W,
      13
    );
    this.y -= 10;
  }

  drawCategory(index: number, category: string, items: CustomerSelectionItem[]) {
    const categoryTotal = round2(
      items.reduce(
        (sum, item) => sum + (Number.isFinite(item.allowance_total) ? item.allowance_total : 0),
        0
      )
    );
    this.ensure(54);
    this.y -= 12;
    const boxH = 18;
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - boxH + 3,
      width: 18,
      height: boxH,
      color: RED,
    });
    this.page.drawText(String(index), {
      x: MARGIN + 6,
      y: this.y - boxH + 8,
      font: this.bold,
      size: 10,
      color: WHITE,
    });
    this.page.drawText(this.clean(category), {
      x: MARGIN + 26,
      y: this.y - boxH + 8,
      font: this.bold,
      size: 12,
      color: SLATE_900,
    });
    this.drawRightAligned('Category allowance', this.bold, 8.5, SLATE_500, MONEY_RIGHT - 128, this.y - boxH + 8);
    this.moneyRight(MONEY_RIGHT, this.y - boxH + 8, formatMoney(categoryTotal), 10.5, this.bold, RED_DARK);
    this.y -= boxH + 8;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 0.75,
      color: LINE,
    });
    this.y -= 4;

    // Column header band.
    const headerY = this.y - 9;
    this.page.drawText(sanitize('ITEM'), { x: COL_DESC_X, y: headerY, font: this.bold, size: 8, color: SLATE_500 });
    this.drawRightAligned('QTY', this.bold, 8, SLATE_500, COL_QTY_X + COL_QTY_W, headerY);
    this.page.drawText(sanitize('UNIT'), { x: COL_UOM_X, y: headerY, font: this.bold, size: 8, color: SLATE_500 });
    this.drawRightAligned('ALLOWANCE / UNIT', this.bold, 8, SLATE_500, COL_UNIT_X + COL_UNIT_W, headerY);
    this.drawRightAligned('TOTAL', this.bold, 8, SLATE_500, COL_TOTAL_X + COL_TOTAL_W, headerY);
    this.page.drawText(sanitize('VENDOR'), { x: COL_VENDOR_X, y: headerY, font: this.bold, size: 8, color: SLATE_500 });
    this.y -= 18;

    items.forEach((item, rowIndex) => {
      const descLines = this.capTwo(
        this.wrapClean(item.description, this.reg, 9.5, COL_DESC_W - 8),
        this.reg,
        9.5,
        COL_DESC_W - 8
      );
      const vendorLines = this.capTwo(
        this.wrapClean(item.vendor || '-', this.reg, 8, COL_VENDOR_W - 4),
        this.reg,
        8,
        COL_VENDOR_W - 4
      );
      const noteLines = item.notes
        ? this.capTwo(this.wrapClean(item.notes, this.italic, 8, COL_DESC_W - 8), this.italic, 8, COL_DESC_W - 8)
        : [];
      const bodyLines = Math.max(descLines.length, vendorLines.length);
      const rowH = 6 + bodyLines * 11.5 + (noteLines.length > 0 ? noteLines.length * 10 + 3 : 0) + 5;
      this.ensure(rowH + 2);
      const topY = this.y - 4;

      if (rowIndex % 2 === 1) {
        this.page.drawRectangle({
          x: MARGIN - 4,
          y: topY - rowH + 2,
          width: CONTENT_W + 8,
          height: rowH,
          color: SOFT,
        });
      }

      let lineY = topY - 11.5;
      for (const line of descLines) {
        this.page.drawText(line, { x: COL_DESC_X, y: lineY, font: this.reg, size: 9.5, color: SLATE_700 });
        lineY -= 11.5;
      }
      lineY = topY - 11.5;
      for (const line of vendorLines) {
        this.page.drawText(line, { x: COL_VENDOR_X, y: lineY, font: this.reg, size: 8, color: SLATE_600 });
        lineY -= 11.5;
      }
      this.drawRightAligned(formatQty(item.qty), this.bold, 9.5, INK, COL_QTY_X + COL_QTY_W, topY - 11.5);
      this.page.drawText(sanitize(String(item.uom || 'EA')), {
        x: COL_UOM_X,
        y: topY - 11.5,
        font: this.reg,
        size: 9,
        color: SLATE_600,
      });
      this.moneyRight(COL_UNIT_X + COL_UNIT_W, topY - 11.5, formatMoney(item.allowance_per_unit), 9.5, this.reg, SLATE_700);
      this.moneyRight(COL_TOTAL_X + COL_TOTAL_W, topY - 11.5, formatMoney(item.allowance_total), 9.5, this.bold, INK);

      if (noteLines.length > 0) {
        let noteY = topY - 4 - bodyLines * 11.5 - 3;
        for (const line of noteLines) {
          this.page.drawText(line, {
            x: COL_DESC_X + 4,
            y: noteY,
            font: this.italic,
            size: 8,
            color: SLATE_500,
          });
          noteY -= 10;
        }
      }

      this.page.drawLine({
        start: { x: MARGIN, y: topY - rowH + 1 },
        end: { x: PAGE_W - MARGIN, y: topY - rowH + 1 },
        thickness: 0.5,
        color: LINE,
      });
      this.y = topY - rowH - 4;
    });

    // Category subtotal.
    this.ensure(22);
    this.y -= 14;
    const subtotalLabel = 'Category subtotal';
    const labelW = this.bold.widthOfTextAtSize(subtotalLabel, 9);
    this.page.drawText(subtotalLabel, {
      x: MONEY_RIGHT - 132 - labelW,
      y: this.y,
      font: this.bold,
      size: 9,
      color: SLATE_700,
    });
    this.moneyRight(MONEY_RIGHT, this.y, formatMoney(categoryTotal), 9.5, this.bold, RED_DARK);
    this.y -= 16;
  }

  drawTotals(items: CustomerSelectionItem[]) {
    const totals = computeSelectionTotals(items);
    this.ensure(96);
    this.y -= 10;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 1.5,
      color: RED,
    });
    this.y -= 18;

    const rows: Array<[string, string, number, ReturnType<typeof rgb>, boolean]> = [
      ['Selection allowance subtotal', formatMoney(totals.subtotal), 10, INK, false],
      ['Indiana material sales tax (7.00%)', formatMoney(totals.tax), 10, INK, false],
      ['TOTAL CUSTOMER SELECTION ALLOWANCE', formatMoney(totals.total), 12, RED_DARK, true],
    ];
    for (const [label, amount, size, color, isTotal] of rows) {
      this.y -= 18;
      this.page.drawText(sanitize(label), {
        x: MARGIN,
        y: this.y,
        font: isTotal ? this.bold : this.reg,
        size: isTotal ? 11 : 10,
        color: isTotal ? SLATE_900 : SLATE_600,
      });
      this.moneyRight(MONEY_RIGHT, this.y, amount, size, this.bold, color);
    }
    this.y -= 16;
  }

  drawSignOff() {
    this.ensure(120);
    this.y -= 12;
    this.page.drawText('SELECTION ACKNOWLEDGEMENT', {
      x: MARGIN,
      y: this.y,
      font: this.bold,
      size: 10,
      color: SLATE_900,
    });
    this.y -= 18;
    this.staticLines(
      'The allowances listed are the budgeted maximum amounts available for the customer finish selections shown. Any selection exceeding its allowance requires written change-order approval before purchase. Unused allowance balances are not paid out in cash.',
      this.reg,
      8.5,
      SLATE_500,
      MARGIN,
      CONTENT_W,
      12
    );
    this.y -= 14;

    const fields: Array<[string, number, number]> = [
      ['Customer Signature', MARGIN, 200],
      ['Date', MARGIN + 226, 120],
      ['Hays + Sons Representative', MARGIN + 362, 154],
    ];
    for (const [label, x, width] of fields) {
      this.page.drawLine({
        start: { x, y: this.y },
        end: { x: x + width, y: this.y },
        thickness: 0.75,
        color: SLATE_400,
      });
      this.page.drawText(label, {
        x,
        y: this.y - 11,
        font: this.reg,
        size: 8,
        color: SLATE_400,
      });
    }
    this.y -= 26;
  }

  async finish(estimate: EstimateResult): Promise<Uint8Array> {
    const client = sanitize(estimate.project_meta?.client_name || 'Project');
    this.doc.setTitle(`Customer Selections & Material Allowance Sheet — ${client}`);
    this.doc.setAuthor('Hays + Sons Complete Restoration');
    this.doc.setSubject('Customer material selection allowances');
    this.doc.setProducer('Hays + Sons — Restoration Document Suite');
    this.doc.setKeywords(['customer selections', 'material allowance', 'restoration', this.checksum]);
    this.doc.setCreationDate(this.generatedLabel ? new Date(this.generatedLabel) : new Date());

    this.pages.forEach((page, i) => {
      page.drawLine({
        start: { x: MARGIN, y: FOOTER_TOP },
        end: { x: PAGE_W - MARGIN, y: FOOTER_TOP },
        thickness: 0.5,
        color: LINE,
      });
      page.drawText(this.checksum, {
        x: MARGIN,
        y: FOOTER_TOP - 12,
        font: this.reg,
        size: 7.5,
        color: SLATE_400,
      });
      page.drawText(`Generated ${this.generatedLabel}`, {
        x: MARGIN,
        y: FOOTER_TOP - 22,
        font: this.reg,
        size: 7.5,
        color: SLATE_400,
      });
      const label = `Page ${i + 1} of ${this.pages.length}`;
      const w = this.reg.widthOfTextAtSize(label, 7.5);
      page.drawText(label, {
        x: PAGE_W - MARGIN - w,
        y: FOOTER_TOP - 12,
        font: this.reg,
        size: 7.5,
        color: SLATE_400,
      });
    });
    return this.doc.save();
  }
}

/**
 * Builds the customer-facing material selection allowance sheet from the
 * estimate's `customer_selections` rows. Throws when no selections exist —
 * callers should gate on that before invoking.
 */
export async function buildCustomerSelectionsPdf(
  estimate: EstimateResult,
  options: CustomerSelectionsPdfOptions = {}
): Promise<Uint8Array> {
  const items = estimate.customer_selections || [];
  if (items.length === 0) {
    throw new Error(
      'No customer selections to render — process an estimate (optionally with its Component Breakdown PDF) first.'
    );
  }
  const checksum = computeCustomerSelectionsChecksum(estimate, items);
  const extraCodes = Array.from(
    new Set(
      (estimate.trade_sections || []).flatMap((t) =>
        (t.category_codes_included || []).map((c) => String(c).toUpperCase())
      )
    )
  );
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const generated = options.generatedAt ? new Date(options.generatedAt) : new Date();
  const generatedLabel = Number.isNaN(generated.getTime())
    ? new Date().toISOString().slice(0, 10)
    : generated.toISOString().slice(0, 10);
  const headerLeft = `${sanitize(estimate.project_meta?.client_name || 'Project')}  •  Claim ${sanitize(
    estimate.project_meta?.claim_number || 'n/a'
  )}`;

  const packet = new SelectionsPacket(doc, reg, bold, italic, headerLeft, checksum, generatedLabel, extraCodes);
  packet.drawHeader(estimate, items.length);
  const groups = groupSelectionsByCategory(items);
  groups.forEach((group, i) => packet.drawCategory(i + 1, group.category, group.items));
  packet.drawTotals(items);
  packet.drawSignOff();
  return packet.finish(estimate);
}
