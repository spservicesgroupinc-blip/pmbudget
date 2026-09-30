import { readFileSync } from 'node:fs';
async function main() {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(readFileSync('scripts/__verify_tmp/out-selections-water_damage.pdf')), useSystemFonts: true }).promise;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows: string[] = [];
    for (const raw of content.items as any[]) {
      const str = (raw.str || '').trim();
      if (!str) continue;
      const t = raw.transform;
      rows.push(`${str.padEnd(34)} x=${t[4].toFixed(0).padStart(4)} right=${(t[4] + (raw.width||0)).toFixed(0).padStart(4)} y=${t[5].toFixed(0)}`);
    }
    console.log(`=== PAGE ${p} ===`);
    // Only print rows containing money, qty-ish numbers, or vendor text for column audit.
    for (const r of rows) {
      if (/\$|\d{2,}/.test(r) && !/^\d+$/.test(r.split(' ')[0])) console.log('  ' + r);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
