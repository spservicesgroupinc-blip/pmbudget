/**
 * One-off end-to-end check: generate a small PDF, POST it as base64 to the
 * running local server, and verify the DeepSeek round-trip returns the
 * project_meta / trade_sections schema.
 *
 * Requires the dev server to be running on http://localhost:3000
 * Run with: npx tsx scripts/__verify_tmp/e2e-pdf.ts
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

async function main() {
  const lines = [
    'Xactimate Estimate - Claim 92-8419-X21',
    'Insured: Michael and Sarah Jenkins',
    'DRY Drywall hang tape float texture 1240 SF 4960.00',
    'PNT Paint interior walls and ceilings 1240 SF 2480.00',
    'FCT Tile flooring kitchen and baths 180 SF 3150.00',
    'Total RCV 10590.00',
  ];

  const pdfBuffer = buildMinimalPdf(lines);

  const res = await fetch('http://localhost:3000/api/process-estimate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pdfBase64: pdfBuffer.toString('base64'),
      filename: 'verify-e2e.pdf',
    }),
  });

  console.log('HTTP status:', res.status);
  const json: any = await res.json();
  console.log(JSON.stringify(json, null, 2).slice(0, 1500));

  if (!res.ok) {
    console.error('FAIL: request was not successful');
    process.exit(1);
  }
  if (!json.project_meta || !Array.isArray(json.trade_sections)) {
    console.error('FAIL: response does not match the expected schema');
    process.exit(1);
  }

  console.log(
    `PASS: DeepSeek round-trip via PDF upload -> ${json.trade_sections.length} trade package(s).`
  );
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
