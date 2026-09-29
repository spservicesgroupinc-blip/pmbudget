// Offline end-to-end verification of the subcontractor work-order packet:
// fallback crew templates, packet checksum, PDF rendering (pdf-lib) and text
// extraction (pdfText.ts) — including the hard zero-financial-visibility /
// no-Xactimate-code redaction checks on the rendered pages.
// Run: npx tsx scripts/verify-work-order-pdf.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { SAMPLE_ESTIMATES } from '../src/services/sampleEstimates.ts';
import {
  buildFallbackWorkOrders,
  computeWorkOrderChecksum,
} from '../src/utils/workOrders.ts';
import { buildAllCrewWorkOrderPdfs, buildWorkOrderPdf } from '../src/utils/workOrderPdf.ts';
import { extractPdfText } from '../pdfText.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
};

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

// Category selectors that must never appear on a field copy of the packet.
const CODE_LEAK_SOURCE =
  '\\b(DMO|PNT|WTR|DRY|FCT|FNH|FCC|RFG|SDG|ELE|PLM|HVC|CLN|INS|CAB|FNC|DOR|FRM|FCV|WDN)\\b';
const CODE_LEAK_RX_G = new RegExp(CODE_LEAK_SOURCE, 'g');

async function main() {
  for (const key of Object.keys(SAMPLE_ESTIMATES)) {
    const sample = SAMPLE_ESTIMATES[key];

    // 1) Deterministic fallback crew packets.
    const crews = buildFallbackWorkOrders(sample);
    check(`${key}: crews >= 4`, crews.length >= 4, `${crews.length} crew(s)`);

    const completeness: string[] = [];
    for (const crew of crews) {
      const instructionItems = crew.instructions.reduce((a, g) => a + g.items.length, 0);
      if (crew.safety_protocols.length < 3) {
        completeness.push(`${crew.crew_id} safety=${crew.safety_protocols.length}`);
      }
      if (crew.instructions.length < 1 || instructionItems < 1) {
        completeness.push(`${crew.crew_id} instructions=${crew.instructions.length}/${instructionItems} items`);
      }
      if (crew.material_specs.length < 1) {
        completeness.push(`${crew.crew_id} material_specs=${crew.material_specs.length}`);
      }
      if (crew.qc_checklist.length < 3) {
        completeness.push(`${crew.crew_id} qc=${crew.qc_checklist.length}`);
      }
      if (crew.exclusions.length < 1) {
        completeness.push(`${crew.crew_id} exclusions=${crew.exclusions.length}`);
      }
    }
    check(
      `${key}: every crew has safety / instructions / materials / QC / exclusions`,
      completeness.length === 0,
      completeness.join('; ')
    );

    // 2) PDF build + page count.
    const bytes = await buildWorkOrderPdf(sample, crews, { generatedAt: '2026-09-29' });
    check(
      `${key}: buildWorkOrderPdf -> Uint8Array > 5000 bytes`,
      bytes instanceof Uint8Array && bytes.length > 5000,
      `${bytes.length} bytes`
    );
    const artifact = join('scripts', '__verify_tmp', `out-workorder-${key}.pdf`);
    writeFileSync(artifact, bytes);

    const doc = await PDFDocument.load(bytes);
    const pageCount = doc.getPageCount();
    check(`${key}: PDF page count >= 4`, pageCount >= 4, `${pageCount} page(s)`);

    // 3) Text extraction + content checks (whitespace-normalized on both sides).
    const text = normalize(await extractPdfText(Buffer.from(bytes).toString('base64')));
    const checksum = computeWorkOrderChecksum(sample, crews);

    check(
      `${key}: text contains client_name`,
      text.includes(normalize(sample.project_meta.client_name)),
      sample.project_meta.client_name
    );
    check(
      `${key}: text contains claim_number`,
      text.includes(normalize(sample.project_meta.claim_number)),
      sample.project_meta.claim_number
    );
    const missingCrews = crews
      .map((c) => normalize(c.crew_name))
      .filter((name) => !text.includes(name));
    check(`${key}: text contains every crew_name`, missingCrews.length === 0, missingCrews.join(' | '));
    check(`${key}: text contains packet checksum`, text.includes(checksum), checksum);
    check(`${key}: text contains ZERO FINANCIAL VISIBILITY`, text.includes('ZERO FINANCIAL VISIBILITY'));
    check(
      `${key}: text contains DO NOT PERFORM / SCOPE EXCLUSIONS`,
      text.includes('DO NOT PERFORM / SCOPE EXCLUSIONS')
    );

    // 4) Hard redaction checks.
    const dollarAt = text.indexOf('$');
    check(
      `${key}: no money leak (no "$")`,
      dollarAt === -1,
      dollarAt === -1 ? '' : `…${text.slice(Math.max(0, dollarAt - 40), dollarAt + 40)}…`
    );
    const codeHits = text.match(CODE_LEAK_RX_G) || [];
    check(`${key}: no Xactimate code leak`, codeHits.length === 0, codeHits.join(', '));

    // 5) Standalone per-subcontractor documents: one PDF per crew, each with
    // only its own scope, ready to send directly.
    const documents = await buildAllCrewWorkOrderPdfs(sample, undefined, {
      generatedAt: '2026-09-29',
    });
    check(
      `${key}: one separate document per crew`,
      documents.length === crews.length,
      `${documents.length} document(s)`
    );

    const documentProblems: string[] = [];
    for (const artifactDoc of documents) {
      const crewId = artifactDoc.crew.crew_id;
      const crewDoc = await PDFDocument.load(artifactDoc.bytes);
      const crewText = normalize(
        await extractPdfText(Buffer.from(artifactDoc.bytes).toString('base64'))
      );
      if (crewDoc.getPageCount() < 1) documentProblems.push(`${crewId}: zero pages`);
      if (!crewText.includes(normalize(artifactDoc.crew.crew_name))) {
        documentProblems.push(`${crewId}: missing own crew name`);
      }
      if (!crewText.includes(normalize(sample.project_meta.client_name))) {
        documentProblems.push(`${crewId}: missing client name`);
      }
      if (!crewText.includes(normalize(sample.project_meta.claim_number))) {
        documentProblems.push(`${crewId}: missing claim number`);
      }
      if (!crewText.includes('SCOPE SUMMARY') || !crewText.includes('SIGN-OFF & ACCEPTANCE')) {
        documentProblems.push(`${crewId}: missing scope or sign-off block`);
      }
      const foreignCrews = crews
        .filter((other) => other.crew_id !== crewId)
        .map((other) => normalize(other.crew_name))
        .filter((name) => crewText.includes(name));
      if (foreignCrews.length > 0) {
        documentProblems.push(`${crewId}: contains other crew(s): ${foreignCrews.join(' | ')}`);
      }
      if (crewText.includes('$')) documentProblems.push(`${crewId}: money leak`);
      const crewCodeHits = crewText.match(CODE_LEAK_RX_G) || [];
      if (crewCodeHits.length > 0) {
        documentProblems.push(`${crewId}: code leak: ${crewCodeHits.join(', ')}`);
      }
      writeFileSync(
        join('scripts', '__verify_tmp', `out-wo-${key}-${crewId}.pdf`),
        artifactDoc.bytes
      );
    }
    check(
      `${key}: per-crew documents contain exactly their own scope, no leaks`,
      documentProblems.length === 0,
      documentProblems.slice(0, 5).join('; ')
    );

    console.log(
      `      ${crews.length} crews · ${pageCount} pages · ${bytes.length} bytes · checksum ${checksum} · artifact ${artifact}`
    );
    console.log(
      `      ${documents.length} separate documents: ${documents
        .map((d) => `${d.filename} (${d.bytes.length}b)`)
        .join(', ')}`
    );
  }

  console.log(failures === 0 ? '\nAll work-order PDF checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
