import { EstimateResult, ScheduledTask } from '../types/estimate';
import { gappsFetch } from './gappsAuth';

export interface WorkspaceExportResult {
  type: 'sheets' | 'docs' | 'calendar' | 'drive';
  title: string;
  url: string;
  id?: string;
  count?: number;
}

interface SheetsBudgetData {
  id: string;
  url: string;
  title: string;
}

interface DocsData {
  id: string;
  url: string;
  title: string;
}

interface CalendarData {
  count: number;
  calendarName: string;
  calendarUrl: string;
}

interface DriveData {
  id: string;
  url: string;
  filename: string;
}

/** Encodes bytes as base64 for the Apps Script PDF upload action. */
const bytesToBase64 = (bytes: Uint8Array): string => {
  const copy = Uint8Array.from(bytes);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < copy.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(copy.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
};

/**
 * Creates a comprehensive Subcontractor Buyout Budget & Trade Roll-up
 * spreadsheet in Google Sheets (written via the Apps Script backend).
 */
export async function createSheetsBudget(
  estimate: EstimateResult,
  targetBuyoutPct: number = 60,
  subBids: Record<string, { name: string; amount: number }> = {}
): Promise<WorkspaceExportResult> {
  const meta = estimate.project_meta;
  const title = `${meta.client_name} - Claim #${meta.claim_number} - Sub Buyout Budget`;

  const headers = [
    'Task ID',
    'Trade Package Name',
    'Xactimate Codes',
    'Billable Revenue (RCV)',
    `Target Sub Buyout (${targetBuyoutPct}%)`,
    'Subcontractor Assigned',
    'Actual Sub Bid ($)',
    'Buyout Variance ($)',
    'Gross Margin (%)',
    'Duration (Days)',
    'Predecessors',
    'Scope of Work Summary',
  ];

  const rows: Array<Array<string | number>> = [];
  let totalRcv = 0;
  let totalTargetBuyout = 0;
  let totalActualSub = 0;

  estimate.trade_sections.forEach((t) => {
    const rcv = Number(t.billable_revenue) || 0;
    const targetBuyout = Math.round(rcv * (targetBuyoutPct / 100));
    const sub = subBids[t.task_id] || {
      name: t.subcontractor_name || 'TBD / Bidding',
      amount: t.subcontractor_bid || targetBuyout,
    };
    const actualSub = Number(sub.amount) || targetBuyout;
    const variance = targetBuyout - actualSub;
    const margin = rcv > 0 ? ((rcv - actualSub) / rcv) * 100 : 0;

    totalRcv += rcv;
    totalTargetBuyout += targetBuyout;
    totalActualSub += actualSub;

    rows.push([
      t.task_id,
      t.trade_name,
      t.category_codes_included.join(', '),
      rcv,
      targetBuyout,
      sub.name,
      actualSub,
      variance,
      `${margin.toFixed(1)}%`,
      t.suggested_duration_days,
      t.predecessors || 'Start',
      t.scope_summary,
    ]);
  });

  const overallMargin =
    totalRcv > 0 ? (((totalRcv - totalActualSub) / totalRcv) * 100).toFixed(1) : '0.0';
  rows.push([
    'TOTALS',
    'All Trade Packages',
    '',
    totalRcv,
    totalTargetBuyout,
    '',
    totalActualSub,
    totalTargetBuyout - totalActualSub,
    `${overallMargin}%`,
    '',
    '',
    'Estimate Reconciled',
  ]);

  const data = await gappsFetch<SheetsBudgetData>('createSheetsBudget', { title, headers, rows });
  return { type: 'sheets', title, url: data.url, id: data.id };
}

/**
 * Creates a Subcontractor Work Package Agreement & Trade Scope Document in
 * Google Docs (written via the Apps Script backend).
 */
export async function createDocsScopeAgreement(
  estimate: EstimateResult,
  targetStartDate: string = ''
): Promise<WorkspaceExportResult> {
  const meta = estimate.project_meta;
  const title = `${meta.client_name} - Subcontractor Work Package Scope Agreement`;

  let bodyText = `SUBCONTRACTOR TRADE WORK PACKAGE AGREEMENT & SCOPE OF WORK\n`;
  bodyText += `Restoration Reconstruction Operational Standards\n\n`;
  bodyText += `================================================================================\n`;
  bodyText += `PROJECT RECORD & CLAIM OVERVIEW\n`;
  bodyText += `Insured / Client:   ${meta.client_name}\n`;
  bodyText += `Claim Number:       ${meta.claim_number}\n`;
  bodyText += `Insurance Carrier:  ${meta.carrier}\n`;
  if (meta.policy_number) bodyText += `Policy Number:      ${meta.policy_number}\n`;
  bodyText += `Project Start Date: ${targetStartDate || 'Scheduled upon buyout sign-off'}\n`;
  bodyText += `Total Estimate RCV: $${meta.total_rcv.toLocaleString()}\n`;
  bodyText += `================================================================================\n\n`;

  bodyText += `CONSOLIDATED TRADE WORK PACKAGES & SEQUENCING\n\n`;

  estimate.trade_sections.forEach((t) => {
    bodyText += `--------------------------------------------------------------------------------\n`;
    bodyText += `TRADE PACKAGE [${t.task_id}]: ${t.trade_name.toUpperCase()}\n`;
    bodyText += `Xactimate Category Codes:  ${t.category_codes_included.join(', ')}\n`;
    bodyText += `Billable Revenue (RCV):    $${t.billable_revenue.toLocaleString()}\n`;
    bodyText += `Suggested Duration:        ${t.suggested_duration_days} business workday(s)\n`;
    bodyText += `Finish-to-Start Predecessors: ${t.predecessors || 'None (Initial Trade Milestone)'}\n`;
    bodyText += `Scope of Work Summary:\n${t.scope_summary}\n\n`;
  });

  bodyText += `================================================================================\n`;
  bodyText += `STANDARD GENERAL RESTORATION CONDITIONS\n`;
  bodyText += `1. Workmanship: All work must comply with local building codes, IICRC standards, and manufacturer specifications.\n`;
  bodyText += `2. Job Site Cleanliness: Subcontractor shall leave site broom-clean daily and haul away debris per trade package code.\n`;
  bodyText += `3. Sequencing & Schedule: Subcontractor must mobilize within 24 hours of predecessor trade completion notice.\n`;
  bodyText += `4. Change Orders: Any deviations from the authorized Xactimate scope must be approved in writing prior to work execution.\n\n`;
  bodyText += `SIGNATURE APPROVALS\n\n`;
  bodyText += `General Contractor Representative: _______________________   Date: _____________\n\n`;
  bodyText += `Subcontractor Authorized Agent:    _______________________   Date: _____________\n`;

  const data = await gappsFetch<DocsData>('createDocsScopeAgreement', { title, body: bodyText });
  return { type: 'docs', title, url: data.url, id: data.id };
}

/**
 * Creates Calendar events on the default Google Calendar for each trade task
 * milestone (written via the Apps Script backend).
 */
export async function syncCalendarEvents(
  estimate: EstimateResult,
  tasks: ScheduledTask[]
): Promise<WorkspaceExportResult> {
  const meta = estimate.project_meta;

  const events = tasks.map((task) => ({
    summary: `[${task.task_id}] ${task.trade_name} - ${meta.client_name}`,
    description:
      `Xactimate Trade Work Package: ${task.trade_name}\n` +
      `Claim #: ${meta.claim_number} (${meta.carrier})\n` +
      `Duration: ${task.suggested_duration_days} business day(s)\n` +
      `Predecessors: ${task.predecessors || 'None'}\n` +
      `Approved RCV: $${task.billable_revenue.toLocaleString()}\n` +
      `Scope: ${task.scope_summary}`,
    startDate: task.startDate,
    endDate: task.endDate,
  }));

  const data = await gappsFetch<CalendarData>('syncCalendarEvents', { events });

  return {
    type: 'calendar',
    title: `${tasks.length} Trade Milestones`,
    url: data.calendarUrl || 'https://calendar.google.com/calendar/r',
    count: data.count,
  };
}

/**
 * Saves the JSON package directly to Google Drive via the Apps Script backend.
 */
export async function savePackageToDrive(
  estimate: EstimateResult
): Promise<WorkspaceExportResult> {
  const meta = estimate.project_meta;
  const fileName = `${meta.client_name.replace(/\s+/g, '_')}_Claim_${meta.claim_number}_Trade_Packages.json`;

  const data = await gappsFetch<DriveData>('savePackageToDrive', {
    filename: fileName,
    json: JSON.stringify(estimate, null, 2),
  });

  return { type: 'drive', title: fileName, url: data.url, id: data.id };
}

/**
 * Uploads the generated work-order PDF to Google Drive via the Apps Script
 * backend.
 */
export async function uploadWorkOrderPdf(
  estimate: EstimateResult,
  pdfBytes: Uint8Array,
  fileNameOverride?: string
): Promise<WorkspaceExportResult> {
  const meta = estimate.project_meta;
  const fileName =
    fileNameOverride ||
    `${meta.client_name.replace(/\s+/g, '_')}_Claim_${meta.claim_number}_WorkOrders.pdf`;

  const data = await gappsFetch<DriveData>('uploadWorkOrderPdf', {
    filename: fileName,
    pdfBase64: bytesToBase64(pdfBytes),
  });

  return { type: 'drive', title: fileName, url: data.url, id: data.id };
}

/** One saved customer record in the Apps Script database (customer profiles). */
export interface CustomerProfileSummary {
  customer_id: string;
  client_name: string;
  claim_number: string;
  carrier?: string;
  property_address?: string;
  total_rcv?: number;
  drive_folder_id?: string;
  estimate_json_url?: string;
  created_at?: string;
  updated_at?: string;
  created_by?: string;
}

/**
 * Creates or updates the customer profile for the given estimate in the
 * Apps Script database. The full estimate JSON is stored in a Drive file
 * inside the customer's folder so the record can be reopened and edited
 * on a future login. Idempotent: the profile key is derived from the
 * client name + claim number.
 */
export async function saveCustomerProfile(
  estimate: EstimateResult
): Promise<CustomerProfileSummary> {
  const meta = estimate.project_meta;
  const data = await gappsFetch<CustomerProfileSummary>('saveCustomerProfile', {
    profile: {
      client_name: meta.client_name,
      claim_number: meta.claim_number,
      carrier: meta.carrier || '',
      property_address: meta.property_address || '',
      total_rcv: Number(meta.total_rcv) || 0,
    },
    estimate_json: JSON.stringify(estimate),
  });
  if (!data || !data.customer_id) {
    throw new Error('Workspace backend returned an invalid customer profile.');
  }
  return data;
}

/** Lists all saved customer profiles (newest updates first). */
export async function listCustomerProfiles(): Promise<CustomerProfileSummary[]> {
  const data = await gappsFetch<{ profiles: CustomerProfileSummary[] }>('listCustomerProfiles', {});
  return Array.isArray(data?.profiles) ? data.profiles : [];
}

/**
 * Loads a customer profile and its full estimate JSON so the record can be
 * reopened for editing.
 */
export async function getCustomerProfile(
  customerId: string
): Promise<{ profile: CustomerProfileSummary; estimate: EstimateResult }> {
  const data = await gappsFetch<{ profile: CustomerProfileSummary; estimate_json: string }>(
    'getCustomerProfile',
    { customer_id: customerId }
  );
  if (!data || !data.profile || typeof data.estimate_json !== 'string') {
    throw new Error('Workspace backend returned an invalid customer profile.');
  }
  let estimate: EstimateResult;
  try {
    estimate = JSON.parse(data.estimate_json) as EstimateResult;
  } catch {
    throw new Error('The stored customer profile contains invalid JSON.');
  }
  return { profile: data.profile, estimate };
}

/** Removes a customer profile row from the Apps Script database. */
export async function deleteCustomerProfile(customerId: string): Promise<void> {
  await gappsFetch<{ ok: boolean }>('deleteCustomerProfile', { customer_id: customerId });
}

/**
 * Uploads a generated PDF into the customer's Drive folder via the Apps
 * Script backend so every generated document is stored with the profile.
 */
export async function uploadCustomerPdf(
  customerId: string,
  filename: string,
  pdfBytes: Uint8Array
): Promise<WorkspaceExportResult> {
  const data = await gappsFetch<DriveData>('uploadCustomerPdf', {
    customer_id: customerId,
    filename,
    pdfBase64: bytesToBase64(pdfBytes),
  });
  return { type: 'drive', title: filename, url: data.url, id: data.id };
}
