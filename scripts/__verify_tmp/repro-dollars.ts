/**
 * Repro: feed a realistic Xactimate-style estimate through the live server
 * (PDF -> pdfText -> DeepSeek -> normalize -> budget engine) and dump every
 * money field so we can see where the dollars vanish.
 *
 * Run with: npx tsx scripts/__verify_tmp/repro-dollars.ts
 * Requires the dev server on http://localhost:3000 with DEEPSEEK_API_KEY.
 */

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildMinimalPdf(lines: string[]): Buffer {
  const escaped = lines.map(escapePdfText);
  const content =
    'BT /F1 11 Tf 56 740 Td 14 TL\n' +
    escaped.map((l, i) => (i === 0 ? `(${l}) Tj\n` : `T* (${l}) Tj\n`)).join('') +
    'ET';

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

const ESTIMATE_LINES = [
  'Xactimate Professional Estimate',
  'Claim Number: 92-8419-X21    Policy Number: HO-3 44-99201-7',
  'Insured: Michael and Sarah Jenkins',
  'Property: 4821 Maple Ridge Drive, Fort Wayne, IN 46815',
  'Home Phone: (260) 555-0193',
  'Carrier: State Farm Fire and Casualty Company',
  'Type of Loss: Water Damage            Date of Loss: 8/14/2026',
  'Price List: INDIANA 10/2026',
  '',
  'DWE  Great Room & Hallway',
  'WTR  Water extraction - carpet and pad, 2 rooms                     180.00 SY     46.50    8,370.00',
  'WTR  Air mover - 1/2 HP, per day (4 units x 3 days)                  12.00 EA     32.00      384.00',
  'WTR  Dehumidifier - LGR, per day (2 units x 3 days)                   6.00 EA    105.00      630.00',
  'DEM  Remove and dispose carpet and pad - flooded                    180.00 SY      3.25      585.00',
  'DEM  Remove baseboard - 5-1/4" MDF                                   98.00 LF      1.85      181.30',
  'DRY  1/2" Drywall - hung, taped, floated, ready for paint           640.00 SF      2.14    1,369.60',
  'DRY  R&R Insulation - batts, R-13, kraft faced                       640.00 SF      1.41      902.40',
  'PNT  Paint - interior walls, two coats                              640.00 SF      0.96      614.40',
  'PNT  Paint - ceiling, two coats                                     420.00 SF      1.02      428.40',
  'FCV  Luxury Vinyl Plank - floating floor installed                  312.00 SF      4.85    1,513.20',
  'FNC  Baseboard - MDF 5-1/4", R&R                                   312.00 LF      3.95    1,232.40',
  'ELE  R&R Outlet - receptacle, ground fault                         4.00 EA      48.50      194.00',
  'ELE  R&R Switch - single pole                                     2.00 EA      42.00       84.00',
  '',
  'DWE  Kitchen',
  'DEM  Remove and dispose - cabinetry, lower 8 LF                       8.00 LF     12.50      100.00',
  'CAB  Cabinets - base, semi custom, R&R                                8.00 LF    185.00    1,480.00',
  'CTR  Countertop - laminate, fabricated and installed                 18.00 SF     42.00      756.00',
  'PLM  R&R Supply line - 1/2" PEX per LF                               24.00 LF      6.25      150.00',
  'PLM  R&R Sink - kitchen, stainless, single bowl                       1.00 EA    265.00      265.00',
  'FCV  Tile - ceramic, floor, R&R                                     110.00 SF     11.50    1,265.00',
  'DRY  1/2" Drywall - hung, taped, floated, ready for paint           180.00 SF      2.14      385.20',
  'PNT  Paint - interior walls, two coats                              180.00 SF      0.96      172.80',
  '',
  'DWE  Bedroom 2',
  'FCC  Carpet - R&R, medium grade                                     144.00 SY     18.75    2,700.00',
  'FCC  Pad - rebond 6 lb, R&R                                         144.00 SY      4.25      612.00',
  'CLN  Cleaning - construction debris sweep                           186.00 SF      0.55      102.30',
  'HAZ  Containment - plastic sheeting, 6 mil                           200.00 SF      0.95      190.00',
  '',
  'Line Item Total                                                                11,971.20',
  'Material Sales Tax 7.000%                                                         218.00',
  'Subtotal                                                                       12,189.20',
  'Overhead & Profit 10/10                                                         1,218.92',
  'Replacement Cost Value                                                          13,408.12',
  'Deductible                                                                      1,000.00',
  'Net Claim                                                                      12,408.12',
];

const dump = (label: string, json: any) => {
  console.log(`\n===== ${label} =====`);
  const meta = json.project_meta || {};
  console.log('meta.total_rcv      =', meta.total_rcv);
  console.log('meta.base_subtotal  =', meta.base_subtotal);
  console.log('meta.material_tax   =', meta.material_tax);
  console.log('meta.op_total       =', meta.op_total, ' overhead_and_profit =', meta.overhead_and_profit);
  const audit = json.budget_audit || {};
  console.log('audit.basis         =', audit.basis);
  console.log('audit.carrier_total_rcv =', audit.carrier_total_rcv, ' delta_rcv =', audit.delta_rcv);
  console.log('warnings            =', JSON.stringify(json.processing?.warnings || []));
  console.log('processing.engine   =', json.processing?.engine);
  console.log('--- trades ---');
  for (const t of json.trade_sections || []) {
    console.log(
      [
        t.task_id,
        (t.trade_name || '').padEnd(26).slice(0, 26),
        'sub=' + t.direct_subtotal,
        'rcv=' + t.billable_revenue,
        'mat=' + t.direct_material,
        'lab=' + t.direct_labor,
        'gp=' + t.gross_profit,
        'gm=' + t.gross_margin_pct,
      ].join('  ')
    );
  }
  const sumRcv = (json.trade_sections || []).reduce((a: number, t: any) => a + (t.billable_revenue || 0), 0);
  console.log('SUM trade rcv       =', sumRcv.toFixed(2));
};

async function main() {
  const mode = process.argv[2] || 'pdf';
  const body: Record<string, unknown> =
    mode === 'text'
      ? { textContent: ESTIMATE_LINES.join('\n') }
      : { pdfBase64: buildMinimalPdf(ESTIMATE_LINES).toString('base64'), filename: 'repro-IN-claim.pdf' };

  const res = await fetch('http://localhost:3000/api/process-estimate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  console.log(`mode=${mode} HTTP status:`, res.status);
  const json: any = await res.json();
  if (!res.ok) {
    console.log('ERROR BODY:', JSON.stringify(json));
    process.exit(1);
  }
  dump(`result (${mode})`, json);
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
