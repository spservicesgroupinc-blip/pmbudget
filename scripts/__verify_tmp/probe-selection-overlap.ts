// Detects overlapping text runs inside a generated PDF using pdfjs text
// positions (no canvas needed). Run:
//   npx tsx scripts/__verify_tmp/probe-selection-overlap.ts <path-to-pdf>
import { readFileSync } from 'node:fs';

interface TextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

async function main() {
  const file = process.argv[2] || 'scripts/__verify_tmp/out-selections-water_damage.pdf';
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes = new Uint8Array(readFileSync(file));
  const doc = await getDocument({ data: bytes, useSystemFonts: true }).promise;

  let totalCollisions = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const raw of content.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>) {
      const str = (raw.str || '').trim();
      if (!str || !raw.transform) continue;
      const t = raw.transform;
      items.push({ str, x: t[4], y: t[5], w: raw.width || 0, h: raw.height || 8 });
    }
    const collisions: string[] = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (overlapX > 6 && overlapY > 6) {
          collisions.push(`"${a.str}" @(${a.x.toFixed(0)},${a.y.toFixed(0)}) vs "${b.str}" @(${b.x.toFixed(0)},${b.y.toFixed(0)}) [x${overlapX.toFixed(0)} y${overlapY.toFixed(0)}]`);
        }
      }
    }
    console.log(`--- page ${p}: ${collisions.length} overlapping text pair(s) ---`);
    for (const c of collisions.slice(0, 40)) console.log('  ' + c);
    totalCollisions += collisions.length;
  }
  console.log(`\nTOTAL collisions: ${totalCollisions}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
