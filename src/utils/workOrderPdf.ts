/**
 * Detailed Subcontractor Field Work Order PDF renderer (pdf-lib, environment-neutral).
 *
 * Output structure follows `instructions/work orders`:
 *  - Cover page: project metadata, site logistics, crew index, contract-amount notice.
 *  - One section per trade crew with the mandatory 5-part sub-block format
 *    (Scope Summary / Safety / Step-by-Step instructions / Material Specs / QC)
 *    plus a DO NOT PERFORM exclusions block and a sign-off panel.
 *
 * Every dynamic string passes through the financial-redaction choke point.
 * Approved subcontract contract amounts are the one deliberate exception:
 * formatMoney() output is drawn through a dedicated money path that skips
 * redactFinancials, while carrier pricing, margins, O&P and unit rates stay
 * hidden. The same function runs in the browser and in Node verification
 * scripts.
 */
import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import type { EstimateResult, WorkOrder, WorkOrderSiteLogistics } from '../types/estimate';
import {
  attachWorkOrderContracts,
  buildFallbackWorkOrders,
  buildSiteLogistics,
  computeWorkOrderChecksum,
  crewWorkOrderPdfFilename,
  formatMoney,
  redactFinancials,
  redactWorkOrders,
  workOrderPdfFilename,
} from './workOrders';

export interface WorkOrderPdfOptions {
  generatedAt?: Date | string;
  includeQcChecklist?: boolean;
}

export { crewWorkOrderPdfFilename, workOrderPdfFilename };

const PAGE_W = 612; // Letter
const PAGE_H = 792;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_TOP = 46;

const RED = rgb(0.863, 0.149, 0.149); // #DC2626
const RED_DARK = rgb(0.725, 0.11, 0.11); // #B91C1C (red-700)
const INK = rgb(0.102, 0.102, 0.102); // #1A1A1A
const ROSE_BG = rgb(0.996, 0.949, 0.949);
const SLATE_900 = rgb(0.059, 0.09, 0.165);
const SLATE_700 = rgb(0.2, 0.255, 0.333);
const SLATE_600 = rgb(0.278, 0.333, 0.412);
const SLATE_500 = rgb(0.392, 0.455, 0.545); // #64748B
const SLATE_400 = rgb(0.58, 0.635, 0.714);
const LINE = rgb(0.886, 0.91, 0.941);
const SOFT = rgb(0.945, 0.961, 0.976);
const WHITE = rgb(1, 1, 1);

/**
 * Shared brand palette for sibling PDF renderers (e.g. the customer
 * selections sheet). pdf-lib colors are document-independent, so these are
 * safe to reuse across PDFDocument instances.
 */
export const PDF_PALETTE = {
  RED,
  RED_DARK,
  INK,
  ROSE_BG,
  SLATE_900,
  SLATE_700,
  SLATE_600,
  SLATE_500,
  SLATE_400,
  LINE,
  SOFT,
  WHITE,
};

/** WinAnsi-safe text for the standard PDF fonts. */
export function sanitize(input: string): string {
  return String(input ?? '')
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/\u2022/g, '-')
    .replace(/\u2192/g, '->')
    .replace(/[^\x20-\x7E\u00A1-\u00FF]/g, '?');
}

/** Static cost-basis tag for a contract budget line ('none' renders no tag). */
function basisTagFor(basis: string): string {
  if (basis === 'sub_bid') return 'Sub bid';
  if (basis === 'budgeted_buyout') return 'Budgeted buyout';
  return '';
}

class Packet {
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
  }

  /**
   * Redaction choke point for every dynamic string this builder draws.
   * Sanctioned exception: approved contract amounts, which are pre-formatted
   * and rendered through money() with sanitize() only.
   */
  private clean(raw: string): string {
    return sanitize(redactFinancials(String(raw ?? ''), this.extraCodes));
  }

  // ------------------------------------------------------------- primitives

  /** Width-based word wrap with no redaction pass (static copy / contract block). */
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

  private wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    return this.wrapToWidth(this.clean(text), font, size, maxWidth);
  }

  private ensure(needed: number) {
    if (this.y - needed < FOOTER_TOP) this.newPage();
  }

  private newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.drawRunningHeader();
  }

  /** Starts a body page (used after the manually drawn cover page). */
  startBody() {
    this.newPage();
  }

  /**
   * Hays+Sons "H+" mark: brand-red bar plus ink plus, scaled from the
   * 65x42 brand canvas so every rendering matches the app header geometry.
   */
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

  /** Full lockup (mark + wordmark + sub-label) for white surfaces. */
  private drawHeaderLogo(page: PDFPage, x: number, yBottom: number, markHeight: number) {
    this.drawBrandMark(page, x, yBottom, markHeight);
    const s = markHeight / 42;
    const textX = x + 65 * s + 8;
    page.drawText('Hays+Sons', {
      x: textX,
      y: yBottom + markHeight * 0.72,
      font: this.bold,
      size: markHeight * 0.44,
      color: INK,
    });
    page.drawText('Restoration Document Suite', {
      x: textX,
      y: yBottom + markHeight * 0.26,
      font: this.reg,
      size: markHeight * 0.31,
      color: SLATE_500,
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
    const right = 'SUBCONTRACTOR FIELD WORK ORDERS';
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

  private text(
    raw: string,
    font: PDFFont,
    size: number,
    color: ReturnType<typeof rgb>,
    x: number,
    maxWidth = CONTENT_W - (x - MARGIN),
    lineHeight = size * 1.4
  ) {
    const lines = this.wrap(raw, font, size, maxWidth);
    for (const line of lines) {
      this.ensure(lineHeight + 2);
      this.y -= lineHeight;
      this.page.drawText(line, { x, y: this.y, font, size, color });
    }
  }

  /**
   * Money bypass: draws a pre-formatted contract amount with sanitize() only,
   * never redactFinancials, which would strip the "$" figures this document
   * now deliberately includes. All other text stays on the clean() path.
   */
  private money(
    x: number,
    y: number,
    str: string,
    size: number,
    font: PDFFont = this.reg,
    color: ReturnType<typeof rgb> = INK
  ) {
    this.page.drawText(sanitize(str), { x, y, font, size, color });
  }

  paragraph(raw: string, indent = 0) {
    this.text(raw, this.reg, 10.5, SLATE_600, MARGIN + indent, CONTENT_W - indent, 15);
  }

  private bullet(raw: string, indent = 14) {
    const clean = this.clean(raw);
    if (!clean) return;
    const lines = this.wrap(clean, this.reg, 10.5, CONTENT_W - indent - 14);
    lines.forEach((line, i) => {
      this.ensure(16);
      this.y -= 14.5;
      if (i === 0) {
        this.page.drawText('•', {
          x: MARGIN + indent,
          y: this.y,
          font: this.bold,
          size: 10.5,
          color: RED,
        });
      }
      this.page.drawText(line, {
        x: MARGIN + indent + 12,
        y: this.y,
        font: this.reg,
        size: 10.5,
        color: SLATE_600,
      });
    });
  }

  bulletList(items: string[], indent = 14) {
    for (const item of items) this.bullet(item, indent);
  }

  private checklist(raw: string, indent = 14) {
    const clean = this.clean(raw);
    if (!clean) return;
    const lines = this.wrap(clean, this.reg, 10.5, CONTENT_W - indent - 34);
    lines.forEach((line, i) => {
      this.ensure(16);
      this.y -= 14.5;
      if (i === 0) {
        this.page.drawText('[  ]', {
          x: MARGIN + indent,
          y: this.y,
          font: this.bold,
          size: 9.5,
          color: SLATE_700,
        });
      }
      this.page.drawText(line, {
        x: MARGIN + indent + 26,
        y: this.y,
        font: this.reg,
        size: 10.5,
        color: SLATE_600,
      });
    });
  }

  checklistList(items: string[], indent = 14) {
    for (const item of items) this.checklist(item, indent);
  }

  blockTitle(number: string, title: string) {
    this.ensure(46);
    this.y -= 12;
    const boxH = 18;
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - boxH + 3,
      width: 18,
      height: boxH,
      color: RED,
    });
    this.page.drawText(number, {
      x: MARGIN + 6,
      y: this.y - boxH + 8,
      font: this.bold,
      size: 10,
      color: WHITE,
    });
    this.page.drawText(this.clean(title), {
      x: MARGIN + 26,
      y: this.y - boxH + 8,
      font: this.bold,
      size: 12,
      color: SLATE_900,
    });
    this.y -= boxH + 6;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 0.75,
      color: LINE,
    });
    this.y -= 4;
  }

  private areaHeader(area: string) {
    const clean = this.clean(area) || 'General Area';
    this.ensure(24);
    this.y -= 19;
    this.page.drawRectangle({
      x: MARGIN + 2,
      y: this.y - 2,
      width: 3,
      height: 12,
      color: RED,
    });
    for (const line of this.wrap(clean, this.bold, 11, CONTENT_W - 20)) {
      this.page.drawText(line, {
        x: MARGIN + 12,
        y: this.y,
        font: this.bold,
        size: 11,
        color: SLATE_900,
      });
      this.y -= 15;
    }
    this.y -= 1;
  }

  private exclusionsBlock(items: string[]) {
    const clean = items.map((s) => this.clean(s)).filter(Boolean);
    if (clean.length === 0) return;
    const wrapped = clean.map((s) => this.wrap(s, this.reg, 10, CONTENT_W - 44));
    const totalLines = wrapped.reduce((a, l) => a + l.length, 0);
    const height = 34 + totalLines * 14;
    this.ensure(height + 14);
    const top = this.y - 6;
    this.page.drawRectangle({
      x: MARGIN,
      y: top - height,
      width: CONTENT_W,
      height,
      color: ROSE_BG,
      borderColor: RED,
      borderWidth: 1,
    });
    this.page.drawText('DO NOT PERFORM / SCOPE EXCLUSIONS', {
      x: MARGIN + 12,
      y: top - 21,
      font: this.bold,
      size: 10,
      color: RED_DARK,
    });
    let ly = top - 38;
    for (const lines of wrapped) {
      for (const line of lines) {
        this.page.drawText(line, {
          x: MARGIN + 26,
          y: ly,
          font: this.reg,
          size: 10,
          color: RED_DARK,
        });
        ly -= 14;
      }
    }
    this.y = top - height - 14;
  }

  private signOff() {
    this.ensure(96);
    this.y -= 16;
    this.page.drawText('SIGN-OFF & ACCEPTANCE', {
      x: MARGIN,
      y: this.y,
      font: this.bold,
      size: 10,
      color: SLATE_900,
    });
    this.y -= 34;
    const fields: Array<[string, number, number]> = [
      ['Crew Lead Signature', MARGIN, 200],
      ['Print Name', MARGIN + 216, 130],
      ['Date', MARGIN + 362, 154],
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
    this.y -= 30;
    this.text(
      'Subcontractor acknowledges the scope, quantities, materials and sequencing above. Any deviation requires a written change order approved by the superintendent before work continues.',
      this.italic,
      8.5,
      SLATE_400,
      MARGIN
    );
  }

  // ---------------------------------------------------------------- cover

  drawCover(estimate: EstimateResult, crews: WorkOrder[]) {
    const meta = estimate.project_meta || ({} as EstimateResult['project_meta']);
    const site: WorkOrderSiteLogistics = estimate.work_order_site || buildSiteLogistics(estimate);
    const client = this.clean(meta.client_name || 'Project');
    const claim = this.clean(meta.claim_number || 'n/a');

    this.page.drawRectangle({ x: 0, y: PAGE_H - 224, width: PAGE_W, height: 160, color: RED });
    this.page.drawLine({
      start: { x: 0, y: PAGE_H - 64 },
      end: { x: PAGE_W, y: PAGE_H - 64 },
      thickness: 0.75,
      color: LINE,
    });
    this.drawHeaderLogo(this.page, MARGIN, PAGE_H - 43, 22);
    let ty = PAGE_H - 124;
    for (const line of this.wrap('SUBCONTRACTOR FIELD WORK ORDER PACKAGE', this.bold, 23, CONTENT_W)) {
      this.page.drawText(line, { x: MARGIN, y: ty, font: this.bold, size: 23, color: WHITE });
      ty -= 27;
    }
    this.page.drawText(client, {
      x: MARGIN,
      y: ty - 4,
      font: this.reg,
      size: 14,
      color: WHITE,
    });
    this.page.drawText(`Claim ${claim}  •  ${crews.length} trade crew work order(s)`, {
      x: MARGIN,
      y: ty - 24,
      font: this.reg,
      size: 10,
      color: WHITE,
    });

    let cy = PAGE_H - 258;

    const coverKeyValue = (label: string, value: string) => {
      this.page.drawText(label.toUpperCase(), {
        x: MARGIN,
        y: cy,
        font: this.bold,
        size: 8,
        color: SLATE_400,
      });
      const lines = this.wrap(value, this.reg, 10.5, CONTENT_W - 10);
      cy -= 15;
      for (const line of lines) {
        this.page.drawText(line, { x: MARGIN, y: cy, font: this.reg, size: 10.5, color: SLATE_700 });
        cy -= 13.5;
      }
      cy -= 9;
    };

    this.page.drawText('PROJECT RECORD', { x: MARGIN, y: cy, font: this.bold, size: 10, color: SLATE_900 });
    cy -= 20;
    coverKeyValue('Insured / Client', client);
    coverKeyValue(
      'Site Address',
      meta.property_address || 'See estimate documents — confirm with the superintendent before mobilization'
    );
    coverKeyValue('Claim Number', `${claim}   |   Carrier: ${sanitize(meta.carrier || 'n/a')}${meta.policy_number ? `   |   Policy: ${sanitize(meta.policy_number)}` : ''}`);
    coverKeyValue('Owner / Site Contact', meta.insured_phone ? sanitize(meta.insured_phone) : 'Confirm with project manager');

    this.page.drawText('SITE LOGISTICS & WORKING RULES', {
      x: MARGIN,
      y: cy,
      font: this.bold,
      size: 10,
      color: SLATE_900,
    });
    cy -= 20;
    coverKeyValue('Working Hours', site.working_hours);
    coverKeyValue('Parking & Staging', site.parking_staging);
    coverKeyValue('Dust & Trash Disposal', site.waste_disposal);
    coverKeyValue('Emergency Protocol', site.emergency_protocol);

    // Contract-amount notice: subcontract amounts are included by design,
    // carrier pricing / margins stay excluded. This static copy is drawn with
    // sanitize() only so words like "pricing" survive the redaction word list.
    const noticeBody =
      "This packet includes each crew's approved subcontract contract amount, linked to the estimate budget lines. Carrier pricing, margins, Overhead & Profit and unit rates are excluded. Contact the office for any cost question.";
    const noticeLines = this.wrapToWidth(sanitize(noticeBody), this.reg, 8.5, CONTENT_W - 24);
    const noticeH = 30 + noticeLines.length * 11;
    this.page.drawRectangle({
      x: MARGIN,
      y: cy - noticeH + 6,
      width: CONTENT_W,
      height: noticeH,
      color: ROSE_BG,
      borderColor: RED,
      borderWidth: 1,
    });
    this.page.drawText(sanitize('CONTRACT AMOUNT INCLUDED — CARRIER PRICING EXCLUDED'), {
      x: MARGIN + 12,
      y: cy - 12,
      font: this.bold,
      size: 10,
      color: RED_DARK,
    });
    let noticeY = cy - 26;
    for (const line of noticeLines) {
      this.page.drawText(line, {
        x: MARGIN + 12,
        y: noticeY,
        font: this.reg,
        size: 8.5,
        color: RED_DARK,
      });
      noticeY -= 11;
    }
    cy -= noticeH + 16;

    this.page.drawText(
      sanitize(`Generated ${this.generatedLabel}  •  Verification token: ${this.checksum}`),
      { x: MARGIN, y: cy, font: this.reg, size: 8.5, color: SLATE_400 }
    );
    this.y = cy;
  }

  drawCrewIndex(crews: WorkOrder[]) {
    this.blockTitle('0', 'CREWS IN THIS PACKAGE');
    this.paragraph(
      'Hand each crew only the pages for its own section. Every crew must review the safety protocol and complete the QC checklist before demobilizing.',
      0
    );
    this.y -= 6;
    for (const wo of crews) {
      this.ensure(40);
      const refs = `Scope ref: ${wo.trade_task_ids.join(', ') || 'n/a'}`;
      const nameLines = this.wrap(wo.crew_name, this.bold, 11.5, CONTENT_W - 12);
      this.y -= 18;
      for (const line of nameLines) {
        this.page.drawText(line, { x: MARGIN, y: this.y, font: this.bold, size: 11.5, color: SLATE_900 });
        this.y -= 15;
      }
      this.page.drawText(this.clean(refs), {
        x: MARGIN,
        y: this.y,
        font: this.reg,
        size: 9.5,
        color: SLATE_600,
      });
      this.y -= 6;
      this.page.drawLine({
        start: { x: MARGIN, y: this.y },
        end: { x: PAGE_W - MARGIN, y: this.y },
        thickness: 0.5,
        color: LINE,
      });
    }
    this.y -= 6;
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - 34,
      width: CONTENT_W,
      height: 34,
      color: SOFT,
    });
    this.page.drawText(
      sanitize(
        'Sequencing: crews mobilize only after predecessor scopes are complete and accepted. Report any field variance to the superintendent before proceeding.'
      ),
      { x: MARGIN + 10, y: this.y - 20, font: this.reg, size: 9, color: SLATE_600 }
    );
    this.y -= 46;
  }

  // ---------------------------------------------------------------- crews

  drawCrew(wo: WorkOrder, index: number, includeQc: boolean) {
    if (index > 0) this.newPage();
    this.drawCrewBand(wo);
    const refs = `Scope ref: ${wo.trade_task_ids.join(', ') || 'n/a'}   •   ${
      wo.source === 'ai' ? 'AI-generated field packet' : 'Field template packet'
    }`;
    this.text(refs, this.reg, 9, SLATE_400, MARGIN);
    this.y -= 6;
    this.drawContractBlock(wo);
    this.drawCrewBody(wo, includeQc);
  }

  private drawCrewBand(wo: WorkOrder) {
    const bandH = 46;
    this.ensure(bandH + 90);
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - bandH,
      width: CONTENT_W,
      height: bandH,
      color: RED_DARK,
    });
    const nameLines = this.wrap(wo.crew_name, this.bold, 12, CONTENT_W - 24).slice(0, 2);
    let by = this.y - 17;
    for (const line of nameLines) {
      this.page.drawText(line, { x: MARGIN + 12, y: by, font: this.bold, size: 12, color: WHITE });
      by -= 15;
    }
    this.y -= bandH + 16;
  }

  /**
   * The subcontract contract amount linked to the estimate budget lines.
   * This is the one financial block field crews receive: money values are
   * pre-formatted with formatMoney() and drawn through the money() bypass,
   * while task/trade labels stay on the clean() redaction path.
   */
  drawContractBlock(order: WorkOrder) {
    const contract = order.contract;
    const budgetLines = contract?.budget_lines || [];
    if (!contract || budgetLines.length === 0) return;

    // Red accent heading in the blockTitle visual language, unnumbered so it
    // cannot be confused with the mandatory 1-5 scope blocks.
    this.ensure(46);
    this.y -= 12;
    const boxH = 18;
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - boxH + 3,
      width: 18,
      height: boxH,
      color: RED,
    });
    this.page.drawText('$', {
      x: MARGIN + 6,
      y: this.y - boxH + 8,
      font: this.bold,
      size: 10,
      color: WHITE,
    });
    this.page.drawText(sanitize('CONTRACT AMOUNT & BUDGET LINE LINKAGE'), {
      x: MARGIN + 26,
      y: this.y - boxH + 8,
      font: this.bold,
      size: 12,
      color: RED_DARK,
    });
    this.y -= boxH + 6;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 0.75,
      color: LINE,
    });
    this.y -= 4;

    // Column geometry: TASK | TRADE PACKAGE (flex) | AMOUNT (right aligned).
    const taskX = MARGIN + 12;
    const tradeX = MARGIN + 74;
    const amountRight = PAGE_W - MARGIN - 12;
    const tradeW = amountRight - 96 - tradeX;

    this.ensure(22);
    this.y -= 10;
    this.page.drawText('TASK', {
      x: taskX,
      y: this.y,
      font: this.bold,
      size: 8,
      color: SLATE_500,
    });
    this.page.drawText('TRADE PACKAGE', {
      x: tradeX,
      y: this.y,
      font: this.bold,
      size: 8,
      color: SLATE_500,
    });
    const amountHeader = 'AMOUNT';
    this.page.drawText(amountHeader, {
      x: amountRight - this.bold.widthOfTextAtSize(amountHeader, 8),
      y: this.y,
      font: this.bold,
      size: 8,
      color: SLATE_500,
    });
    this.y -= 4;
    this.page.drawLine({
      start: { x: taskX, y: this.y },
      end: { x: amountRight, y: this.y },
      thickness: 0.5,
      color: LINE,
    });

    for (const line of budgetLines) {
      const taskLines = this.wrap(line.task_id || 'n/a', this.bold, 9, tradeX - taskX - 10);
      const tradeLines = this.wrap(line.trade_name || 'n/a', this.reg, 9.5, tradeW);
      const tag = basisTagFor(line.basis);
      const rowH = Math.max(taskLines.length, tradeLines.length) * 11.5 + (tag ? 9.5 : 0) + 3;
      this.ensure(rowH + 8);
      const top = this.y;

      let tyTask = top - 11;
      for (const taskLine of taskLines) {
        this.page.drawText(taskLine, {
          x: taskX,
          y: tyTask,
          font: this.bold,
          size: 9,
          color: SLATE_900,
        });
        tyTask -= 11.5;
      }

      let tyTrade = top - 11;
      for (const tradeLine of tradeLines) {
        this.page.drawText(tradeLine, {
          x: tradeX,
          y: tyTrade,
          font: this.reg,
          size: 9.5,
          color: SLATE_700,
        });
        tyTrade -= 11.5;
      }

      if (tag) {
        this.page.drawText(sanitize(tag), {
          x: tradeX,
          y: tyTrade + 1.5,
          font: this.italic,
          size: 7.5,
          color: SLATE_500,
        });
      }

      const amount = formatMoney(line.amount);
      this.money(
        amountRight - this.bold.widthOfTextAtSize(sanitize(amount), 9.5),
        top - 11,
        amount,
        9.5,
        this.bold,
        INK
      );

      this.y = top - rowH;
      this.page.drawLine({
        start: { x: taskX, y: this.y },
        end: { x: amountRight, y: this.y },
        thickness: 0.5,
        color: LINE,
      });
    }

    // Grand-total row for the whole subcontract.
    this.ensure(32);
    this.y -= 14;
    this.page.drawText(sanitize('TOTAL CONTRACT AMOUNT'), {
      x: tradeX,
      y: this.y,
      font: this.bold,
      size: 10,
      color: SLATE_900,
    });
    const total = formatMoney(contract.contract_amount);
    this.money(
      amountRight - this.bold.widthOfTextAtSize(sanitize(total), 10),
      this.y,
      total,
      10,
      this.bold,
      RED_DARK
    );
    this.y -= 6;
    this.page.drawLine({
      start: { x: taskX, y: this.y },
      end: { x: amountRight, y: this.y },
      thickness: 1,
      color: RED,
    });
    this.y -= 10;
  }

  /** The mandatory 5-part crew work order body + exclusions + sign-off. */
  drawCrewBody(wo: WorkOrder, includeQc: boolean) {
    this.blockTitle('1', 'SCOPE SUMMARY');
    if (wo.scope_summary) this.paragraph(wo.scope_summary);

    this.blockTitle('2', 'SAFETY, SITE PROTECTION & CONTAINMENT');
    this.bulletList(wo.safety_protocols);

    this.blockTitle('3', 'STEP-BY-STEP FIELD INSTRUCTIONS');
    for (const group of wo.instructions) {
      this.areaHeader(group.area);
      this.bulletList(group.items);
    }

    this.blockTitle('4', 'MATERIAL SPECIFICATIONS & FASTENERS');
    this.bulletList(wo.material_specs);

    if (includeQc) {
      this.blockTitle('5', 'QUALITY CONTROL & PUNCHLIST STANDARDS');
      this.checklistList(wo.qc_checklist);
    }

    this.exclusionsBlock(wo.exclusions);
    this.signOff();
  }

  /** Compact first-page header for a single-subcontractor document. */
  drawStandaloneCrewHeader(estimate: EstimateResult, wo: WorkOrder) {
    const meta = estimate.project_meta || ({} as EstimateResult['project_meta']);
    const site: WorkOrderSiteLogistics = estimate.work_order_site || buildSiteLogistics(estimate);

    this.page.drawRectangle({ x: 0, y: PAGE_H - 106, width: PAGE_W, height: 54, color: RED });
    this.page.drawLine({
      start: { x: 0, y: PAGE_H - 52 },
      end: { x: PAGE_W, y: PAGE_H - 52 },
      thickness: 0.75,
      color: LINE,
    });
    this.drawHeaderLogo(this.page, MARGIN, PAGE_H - 37, 22);
    this.page.drawText('SUBCONTRACTOR FIELD WORK ORDER', {
      x: MARGIN,
      y: PAGE_H - 72,
      font: this.bold,
      size: 9,
      color: WHITE,
    });
    const nameLines = this.wrap(wo.crew_name, this.bold, 14, CONTENT_W).slice(0, 2);
    let ny = PAGE_H - 89;
    for (const line of nameLines) {
      this.page.drawText(line, { x: MARGIN, y: ny, font: this.bold, size: 14, color: WHITE });
      ny -= 17;
    }

    this.y = PAGE_H - 128;

    const row = (label: string, value: string) => {
      this.page.drawText(label.toUpperCase(), {
        x: MARGIN,
        y: this.y,
        font: this.bold,
        size: 7.5,
        color: SLATE_400,
      });
      this.y -= 12;
      for (const line of this.wrap(value, this.reg, 10, CONTENT_W)) {
        this.page.drawText(line, { x: MARGIN, y: this.y, font: this.reg, size: 10, color: SLATE_700 });
        this.y -= 12.5;
      }
      this.y -= 5;
    };

    row('Insured / Client', meta.client_name || 'Project');
    row(
      'Site Address',
      meta.property_address || 'Confirm with the superintendent before mobilization'
    );
    row(
      'Claim / Carrier',
      `${meta.claim_number || 'n/a'}${meta.carrier ? `  |  ${meta.carrier}` : ''}${
        meta.policy_number ? `  |  Policy ${meta.policy_number}` : ''
      }`
    );
    row('Scope Reference', wo.trade_task_ids.length ? wo.trade_task_ids.join(', ') : 'Per approved scope');

    this.ensure(120);
    this.y -= 4;
    this.page.drawText('SITE RULES', {
      x: MARGIN,
      y: this.y,
      font: this.bold,
      size: 8.5,
      color: SLATE_900,
    });
    this.y -= 14;
    const rules: Array<[string, string]> = [
      ['Hours', site.working_hours],
      ['Parking / Staging', site.parking_staging],
      ['Dust & Debris', site.waste_disposal],
      ['Emergency', site.emergency_protocol],
    ];
    for (const [label, value] of rules) {
      for (const line of this.wrap(`${label}: ${value}`, this.reg, 9, CONTENT_W)) {
        this.ensure(13);
        this.page.drawText(line, { x: MARGIN, y: this.y, font: this.reg, size: 9, color: SLATE_600 });
        this.y -= 11.5;
      }
      this.y -= 2;
    }
    this.y -= 10;
  }

  async finish(estimate: EstimateResult, title?: string): Promise<Uint8Array> {
    const total = this.pages.length;
    this.pages.forEach((page, i) => {
      page.drawLine({
        start: { x: MARGIN, y: 40 },
        end: { x: PAGE_W - MARGIN, y: 40 },
        thickness: 0.75,
        color: LINE,
      });
      page.drawText(
        sanitize(
          `${this.checksum}  •  Generated ${this.generatedLabel}  •  Field copy — contract amounts included, margins excluded`
        ),
        { x: MARGIN, y: 28, font: this.reg, size: 7.5, color: SLATE_400 }
      );
      const label = `Page ${i + 1} of ${total}`;
      const w = this.reg.widthOfTextAtSize(label, 8);
      page.drawText(label, {
        x: PAGE_W - MARGIN - w,
        y: 28,
        font: this.reg,
        size: 8,
        color: SLATE_600,
      });
    });

    this.doc.setTitle(title || `Field Work Order Package — ${estimate.project_meta?.client_name || 'Project'}`);
    this.doc.setAuthor('Hays + Sons Complete Restoration');
    this.doc.setSubject('Subcontractor Field Work Order (contract amount included)');
    this.doc.setProducer('Hays + Sons — Restoration Document Suite');
    this.doc.setKeywords(['work order', 'restoration', 'subcontractor', this.checksum]);
    this.doc.setCreationDate(this.generatedLabel ? new Date(this.generatedLabel) : new Date());
    return this.doc.save();
  }
}

export async function buildWorkOrderPdf(
  estimate: EstimateResult,
  workOrders?: WorkOrder[],
  options: WorkOrderPdfOptions = {}
): Promise<Uint8Array> {
  const crews = workOrders && workOrders.length > 0 ? workOrders : buildFallbackWorkOrders(estimate);
  const checksum = computeWorkOrderChecksum(estimate, crews);
  // Second redaction layer: even internally-built fallback templates are
  // scrubbed before any text reaches a page, and estimate codes are added to
  // the draw-time vocabulary. Contract linkage is backfilled after redaction
  // (idempotent) so old estimates without contracts still render amounts.
  const redactedCrews = attachWorkOrderContracts(redactWorkOrders(crews, estimate), estimate);
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

  const packet = new Packet(doc, reg, bold, italic, headerLeft, checksum, generatedLabel, extraCodes);
  packet.drawCover(estimate, redactedCrews);
  packet.startBody();
  packet.drawCrewIndex(redactedCrews);
  redactedCrews.forEach((wo, i) => packet.drawCrew(wo, i, options.includeQcChecklist !== false));
  return packet.finish(estimate);
}

function collectExtraCodes(estimate: EstimateResult): string[] {
  return Array.from(
    new Set(
      (estimate.trade_sections || []).flatMap((t) =>
        (t.category_codes_included || []).map((c) => String(c).toUpperCase())
      )
    )
  );
}

function resolveGeneratedLabel(options: WorkOrderPdfOptions): string {
  const generated = options.generatedAt ? new Date(options.generatedAt) : new Date();
  return Number.isNaN(generated.getTime())
    ? new Date().toISOString().slice(0, 10)
    : generated.toISOString().slice(0, 10);
}

/**
 * Builds ONE standalone work order document for a single subcontractor crew.
 * The document contains only that crew's scope and is ready to email as-is.
 */
export async function buildCrewWorkOrderPdf(
  estimate: EstimateResult,
  crew: WorkOrder,
  options: WorkOrderPdfOptions = {}
): Promise<Uint8Array> {
  const redactedCrew =
    attachWorkOrderContracts(redactWorkOrders([crew], estimate), estimate)[0] || crew;
  const checksum = computeWorkOrderChecksum(estimate, [crew]);
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const crewTag = redactedCrew.crew_id.replace('crew-', 'Crew ');
  const headerLeft = `${sanitize(estimate.project_meta?.client_name || 'Project')}  •  Claim ${sanitize(
    estimate.project_meta?.claim_number || 'n/a'
  )}  •  ${sanitize(crewTag)}`;

  const packet = new Packet(
    doc,
    reg,
    bold,
    italic,
    headerLeft,
    checksum,
    resolveGeneratedLabel(options),
    collectExtraCodes(estimate)
  );
  packet.drawStandaloneCrewHeader(estimate, redactedCrew);
  packet.drawContractBlock(redactedCrew);
  packet.drawCrewBody(redactedCrew, options.includeQcChecklist !== false);
  return packet.finish(estimate, `${redactedCrew.crew_name} — Field Work Order`);
}

export interface CrewWorkOrderPdfArtifact {
  crew: WorkOrder;
  filename: string;
  bytes: Uint8Array;
}

/**
 * Builds one separate PDF document per field crew, each ready to be sent to
 * its own subcontractor.
 */
export async function buildAllCrewWorkOrderPdfs(
  estimate: EstimateResult,
  workOrders?: WorkOrder[],
  options: WorkOrderPdfOptions = {}
): Promise<CrewWorkOrderPdfArtifact[]> {
  const base = workOrders && workOrders.length > 0 ? workOrders : buildFallbackWorkOrders(estimate);
  const redactedCrews = attachWorkOrderContracts(redactWorkOrders(base, estimate), estimate);
  // Independent documents (each build creates its own PDFDocument): run the
  // per-crew builds in parallel; Promise.all preserves the redactedCrews order.
  return Promise.all(
    redactedCrews.map(async (crew) => {
      const bytes = await buildCrewWorkOrderPdf(estimate, crew, options);
      return { crew, filename: crewWorkOrderPdfFilename(estimate, crew), bytes };
    })
  );
}
