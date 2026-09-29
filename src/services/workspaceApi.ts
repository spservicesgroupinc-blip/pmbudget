import { EstimateResult, ScheduledTask } from '../types/estimate';
import { mapWithConcurrency } from '../utils/concurrency';

export interface WorkspaceExportResult {
  type: 'sheets' | 'docs' | 'calendar' | 'drive';
  title: string;
  url: string;
  id?: string;
  count?: number;
}

/**
 * Creates a comprehensive Subcontractor Buyout Budget & Trade Roll-up spreadsheet in Google Sheets
 */
export async function createSheetsBudget(
  accessToken: string,
  estimate: EstimateResult,
  targetBuyoutPct: number = 60,
  subBids: Record<string, { name: string; amount: number }> = {}
): Promise<WorkspaceExportResult> {
  const meta = estimate.project_meta;
  const title = `${meta.client_name} - Claim #${meta.claim_number} - Sub Buyout Budget`;

  // 1. Create Spreadsheet
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        title,
      },
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Google Sheets API Error (${createRes.status}): ${errText}`);
  }

  const sheetData = await createRes.json();
  const spreadsheetId = sheetData.spreadsheetId;
  const spreadsheetUrl =
    sheetData.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  // 2. Prepare tabular values
  const rows: any[][] = [];

  // Header metadata block
  rows.push(['XACTIMATE SUBCONTRACTOR TRADE BUYOUT BUDGET & GANTT RECONCILIATION']);
  rows.push(['Hays & Sons Standard Restoration Workflow']);
  rows.push([]);
  rows.push(['Project / Insured Name:', meta.client_name, '', 'Total Estimate RCV:', meta.total_rcv]);
  rows.push(['Claim Number:', meta.claim_number, '', 'Net Claim Amount:', meta.net_claim || meta.total_rcv]);
  rows.push(['Insurance Carrier:', meta.carrier, '', 'Overhead & Profit (O&P):', meta.overhead_and_profit || 0]);
  rows.push(['Policy Number:', meta.policy_number || 'N/A', '', 'Target Buyout Rate:', `${targetBuyoutPct}%`]);
  rows.push([]);

  // Table header
  rows.push([
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
  ]);

  let totalRcv = 0;
  let totalTargetBuyout = 0;
  let totalActualSub = 0;

  estimate.trade_sections.forEach((t) => {
    const rcv = Number(t.billable_revenue) || 0;
    const targetBuyout = Math.round(rcv * (targetBuyoutPct / 100));
    const sub = subBids[t.task_id] || { name: t.subcontractor_name || 'TBD / Bidding', amount: t.subcontractor_bid || targetBuyout };
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

  // Totals row
  const overallMargin = totalRcv > 0 ? (((totalRcv - totalActualSub) / totalRcv) * 100).toFixed(1) : '0.0';
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

  // Update sheet values
  const valueUpdateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1:L${rows.length}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        range: `A1:L${rows.length}`,
        majorDimension: 'ROWS',
        values: rows,
      }),
    }
  );

  if (!valueUpdateRes.ok) {
    const errText = await valueUpdateRes.text();
    console.warn('Sheets value write error:', errText);
  }

  return {
    type: 'sheets',
    title,
    url: spreadsheetUrl,
    id: spreadsheetId,
  };
}

/**
 * Creates a Subcontractor Work Package Agreement & Trade Scope Document in Google Docs
 */
export async function createDocsScopeAgreement(
  accessToken: string,
  estimate: EstimateResult,
  targetStartDate: string = ''
): Promise<WorkspaceExportResult> {
  const meta = estimate.project_meta;
  const title = `${meta.client_name} - Subcontractor Work Package Scope Agreement`;

  // 1. Create Document
  const createRes = await fetch('https://docs.googleapis.com/v1/documents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title,
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Google Docs API Error (${createRes.status}): ${errText}`);
  }

  const docData = await createRes.json();
  const documentId = docData.documentId;
  const documentUrl = `https://docs.google.com/document/d/${documentId}/edit`;

  // 2. Prepare text content to insert
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

  // Insert text into doc
  const updateRes = await fetch(
    `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text: bodyText,
            },
          },
        ],
      }),
    }
  );

  if (!updateRes.ok) {
    const errText = await updateRes.text();
    console.warn('Docs batchUpdate error:', errText);
  }

  return {
    type: 'docs',
    title,
    url: documentUrl,
    id: documentId,
  };
}

/**
 * Creates Calendar events on Primary Google Calendar for each trade task milestone
 */
export async function syncCalendarEvents(
  accessToken: string,
  estimate: EstimateResult,
  tasks: ScheduledTask[]
): Promise<WorkspaceExportResult> {
  const meta = estimate.project_meta;

  // Independent calendar writes — run up to 3 at once (results keep task order).
  const created = await mapWithConcurrency(tasks, 3, async (task) => {
    // End date in Google Calendar for all-day events is exclusive, so add 1 day
    const endDateObj = new Date(task.endDate);
    endDateObj.setDate(endDateObj.getDate() + 1);
    const exclusiveEndDate = endDateObj.toISOString().split('T')[0];

    const event = {
      summary: `[${task.task_id}] ${task.trade_name} - ${meta.client_name}`,
      description: `Xactimate Trade Work Package: ${task.trade_name}\n` +
        `Claim #: ${meta.claim_number} (${meta.carrier})\n` +
        `Duration: ${task.suggested_duration_days} business day(s)\n` +
        `Predecessors: ${task.predecessors || 'None'}\n` +
        `Approved RCV: $${task.billable_revenue.toLocaleString()}\n` +
        `Scope: ${task.scope_summary}`,
      start: { date: task.startDate },
      end: { date: exclusiveEndDate },
      colorId: '11', // Red/bold accent in Google Calendar
    };

    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      }
    );

    if (res.ok) return true;

    const errText = await res.text();
    console.warn(`Failed to create calendar event for ${task.task_id}:`, errText);
    return false;
  });

  return {
    type: 'calendar',
    title: `${tasks.length} Trade Milestones`,
    url: 'https://calendar.google.com/calendar/r',
    count: created.filter(Boolean).length,
  };
}

/**
 * Saves the JSON package directly to Google Drive
 */
export async function savePackageToDrive(
  accessToken: string,
  estimate: EstimateResult
): Promise<WorkspaceExportResult> {
  const meta = estimate.project_meta;
  const fileName = `${meta.client_name.replace(/\s+/g, '_')}_Claim_${meta.claim_number}_Trade_Packages.json`;

  const metadata = {
    name: fileName,
    mimeType: 'application/json',
  };

  const fileContent = JSON.stringify(estimate, null, 2);

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', new Blob([fileContent], { type: 'application/json' }));

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: form,
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive API Error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const fileUrl = `https://drive.google.com/file/d/${data.id}/view`;

  return {
    type: 'drive',
    title: fileName,
    url: fileUrl,
    id: data.id,
  };
}

/**
 * Uploads the generated subcontractor work-order PDF to Google Drive
 * (uses the existing drive.file OAuth scope).
 */
export async function uploadWorkOrderPdf(
  accessToken: string,
  estimate: EstimateResult,
  pdfBytes: Uint8Array,
  fileNameOverride?: string
): Promise<WorkspaceExportResult> {
  const meta = estimate.project_meta;
  const fileName =
    fileNameOverride ||
    `${meta.client_name.replace(/\s+/g, '_')}_Claim_${meta.claim_number}_WorkOrders.pdf`;

  const metadata = {
    name: fileName,
    mimeType: 'application/pdf',
  };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  // Copy into a fresh ArrayBuffer-backed view for TS 7 BlobPart compat.
  form.append(
    'file',
    new Blob([Uint8Array.from(pdfBytes).buffer], { type: 'application/pdf' })
  );

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: form,
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive API Error (${res.status}): ${errText}`);
  }

  const data = await res.json();

  return {
    type: 'drive',
    title: fileName,
    url: `https://drive.google.com/file/d/${data.id}/view`,
    id: data.id,
  };
}
