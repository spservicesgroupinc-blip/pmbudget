// Offline end-to-end verification of the subcontractor work-order packet:
// fallback crew templates, packet checksum, PDF rendering (pdf-lib) and text
// extraction (pdfText.ts). Verifies the CONTRACT-AMOUNT policy: each crew
// document carries its approved subcontract contract amount linked to the
// estimate budget lines (task id, trade package, amount), while carrier RCV,
// margins, O&P and unit rates remain stripped. Every dollar token on a page
// must be an allow-listed formatMoney(...) value of that crew's own contract
// (plus the no-Xactimate-code redaction checks).
// Run: npx tsx scripts/verify-work-order-pdf.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { SAMPLE_ESTIMATES } from '../src/services/sampleEstimates.ts';
import { applyBudgetEngine } from '../src/utils/budgetEngine.ts';
import {
  attachWorkOrderContracts,
  buildFallbackWorkOrders,
  computeWorkOrderChecksum,
  formatMoney,
} from '../src/utils/workOrders.ts';
import { buildAllCrewWorkOrderPdfs, buildWorkOrderPdf } from '../src/utils/workOrderPdf.ts';
import { extractPdfText } from '../pdfText.ts';
import type { EstimateResult, WorkOrder } from '../src/types/estimate.ts';

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

/** Dollar tokens exactly as formatMoney renders them: "$3,850.00". */
const moneyTokens = (text: string): string[] => text.match(/\$[\d,]+\.\d{2}/g) || [];

/** Allow-list of every formatMoney value a set of crews' own contracts may show. */
function allowedMoney(crews: WorkOrder[]): Set<string> {
  const allowed = new Set<string>();
  for (const crew of crews) {
    const contract = crew.contract;
    if (!contract) continue;
    allowed.add(formatMoney(contract.contract_amount));
    for (const line of contract.budget_lines || []) allowed.add(formatMoney(line.amount));
  }
  return allowed;
}

/** Dollar tokens in the extracted text that are NOT allow-listed. */
function moneyLeaks(text: string, allowed: Set<string>): string[] {
  return moneyTokens(text).filter((token) => !allowed.has(token));
}

const cents = (n: number) => Math.round(n * 100);
const sumLineAmounts = (crew: WorkOrder) =>
  (crew.contract?.budget_lines || []).reduce((sum, line) => sum + line.amount, 0);

async function main() {
  for (const key of Object.keys(SAMPLE_ESTIMATES)) {
    const sample = SAMPLE_ESTIMATES[key];

    // 1) Budget-engine a deep-cloned sample so buyout math exists, then build
    // the deterministic fallback crews and attach the subcontract contracts
    // (contract amount + its linked budget lines).
    const estimate: EstimateResult = applyBudgetEngine(
      JSON.parse(JSON.stringify(sample)) as EstimateResult
    );
    const crews = attachWorkOrderContracts(buildFallbackWorkOrders(estimate), estimate);
    check(`${key}: crews >= 4`, crews.length >= 4, `${crews.length} crew(s)`);

    // 1b) Contract linkage: at least one crew must quote a positive contract
    // amount, and every quoted contract must equal the exact cents sum of its
    // linked budget lines.
    const contracted = crews.filter((c) => (c.contract?.contract_amount || 0) > 0);
    const mismatched = contracted.filter(
      (c) => cents(c.contract?.contract_amount || 0) !== cents(sumLineAmounts(c))
    );
    check(
      `${key}: at least one crew has a positive contract amount`,
      contracted.length >= 1,
      `${contracted.length} of ${crews.length} crew(s)`
    );
    check(
      `${key}: contract_amount == Σ budget line amounts (exact cents)`,
      mismatched.length === 0,
      mismatched
        .map((c) => `${c.crew_id}: ${c.contract?.contract_amount} vs ${sumLineAmounts(c)}`)
        .join('; ')
    );

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

    // 2) PDF build + page count (engine-applied estimate + contract-attached crews).
    const bytes = await buildWorkOrderPdf(estimate, crews, { generatedAt: '2026-09-29' });
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
    const checksum = computeWorkOrderChecksum(estimate, crews);

    check(
      `${key}: text contains client_name`,
      text.includes(normalize(estimate.project_meta.client_name)),
      estimate.project_meta.client_name
    );
    check(
      `${key}: text contains claim_number`,
      text.includes(normalize(estimate.project_meta.claim_number)),
      estimate.project_meta.claim_number
    );
    const missingCrews = crews
      .map((c) => normalize(c.crew_name))
      .filter((name) => !text.includes(name));
    check(`${key}: text contains every crew_name`, missingCrews.length === 0, missingCrews.join(' | '));
    check(`${key}: text contains packet checksum`, text.includes(checksum), checksum);
    check(
      `${key}: text contains CONTRACT AMOUNT & BUDGET LINE LINKAGE`,
      text.includes('CONTRACT AMOUNT & BUDGET LINE LINKAGE')
    );
    check(
      `${key}: cover shows CONTRACT AMOUNT INCLUDED — CARRIER PRICING EXCLUDED`,
      text.includes('CONTRACT AMOUNT INCLUDED') && text.includes('CARRIER PRICING EXCLUDED')
    );
    check(`${key}: text contains TOTAL CONTRACT AMOUNT`, text.includes('TOTAL CONTRACT AMOUNT'));
    check(
      `${key}: old ZERO FINANCIAL VISIBILITY notice is gone`,
      !text.includes('ZERO FINANCIAL VISIBILITY')
    );
    check(
      `${key}: text contains DO NOT PERFORM / SCOPE EXCLUSIONS`,
      text.includes('DO NOT PERFORM / SCOPE EXCLUSIONS')
    );

    // 4) Contract-amount allow-list + hard redaction checks: every dollar token
    // drawn in the packet must be the formatMoney(...) value of one of the crew
    // contracts it quotes (carrier RCV / margins / O&P are never rendered).
    const packetTokens = moneyTokens(text);
    const packetLeaks = moneyLeaks(text, allowedMoney(crews));
    check(
      `${key}: packet renders at least one contract amount`,
      packetTokens.length >= 1,
      `${packetTokens.length} dollar token(s)`
    );
    check(
      `${key}: every dollar token is an allow-listed crew contract amount`,
      packetLeaks.length === 0,
      packetLeaks.slice(0, 5).join(', ')
    );
    const codeHits = text.match(CODE_LEAK_RX_G) || [];
    check(`${key}: no Xactimate code leak`, codeHits.length === 0, codeHits.join(', '));

    // 5) Standalone per-subcontractor documents: one PDF per crew, each with
    // only its own scope, ready to send directly.
    const documents = await buildAllCrewWorkOrderPdfs(estimate, crews, {
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
      if (!crewText.includes(normalize(estimate.project_meta.client_name))) {
        documentProblems.push(`${crewId}: missing client name`);
      }
      if (!crewText.includes(normalize(estimate.project_meta.claim_number))) {
        documentProblems.push(`${crewId}: missing claim number`);
      }
      if (!crewText.includes('SCOPE SUMMARY') || !crewText.includes('SIGN-OFF & ACCEPTANCE')) {
        documentProblems.push(`${crewId}: missing scope or sign-off block`);
      }
      const missingContractLiterals = [
        'CONTRACT AMOUNT & BUDGET LINE LINKAGE',
        'TOTAL CONTRACT AMOUNT',
      ].filter((literal) => !crewText.includes(literal));
      if (missingContractLiterals.length > 0) {
        documentProblems.push(`${crewId}: missing ${missingContractLiterals.join(' / ')}`);
      }
      const own = crews.find((c) => c.crew_id === crewId);
      const ownContract = own?.contract;
      if (ownContract && ownContract.contract_amount > 0) {
        const expected = formatMoney(ownContract.contract_amount);
        if (!moneyTokens(crewText).includes(expected)) {
          documentProblems.push(`${crewId}: contract amount ${expected} not rendered`);
        }
      }
      const foreignCrews = crews
        .filter((other) => other.crew_id !== crewId)
        .map((other) => normalize(other.crew_name))
        .filter((name) => crewText.includes(name));
      if (foreignCrews.length > 0) {
        documentProblems.push(`${crewId}: contains other crew(s): ${foreignCrews.join(' | ')}`);
      }
      const docLeaks = moneyLeaks(crewText, allowedMoney(own ? [own] : []));
      if (docLeaks.length > 0) {
        documentProblems.push(`${crewId}: non-contract money token(s): ${docLeaks.slice(0, 5).join(', ')}`);
      }
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
