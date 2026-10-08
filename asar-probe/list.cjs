const fs = require('fs');
const path = require('path');

const ASAR = 'C:/Users/russe/AppData/Local/Programs/DeepSeek Harness/resources/app.asar';
const OUT = 'C:/ghannt/asar-probe';
fs.mkdirSync(OUT, { recursive: true });

// 1. root listing of app.asar
fs.writeFileSync(path.join(OUT, 'asar-root.json'), JSON.stringify(fs.readdirSync(ASAR), null, 2));

// 2. dsh checkout top level
const DSH = path.join(ASAR, 'dsh');
fs.writeFileSync(path.join(OUT, 'dsh-top.json'), JSON.stringify(fs.readdirSync(DSH), null, 2));

// 3. dsh package.json
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(DSH, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(OUT, 'dsh-package.json'), JSON.stringify(pkg, null, 2));
} catch (e) { fs.writeFileSync(path.join(OUT, 'dsh-package.err'), String(e)); }

// 4. bundled plugin package.jsons
for (const p of ['@deepseek-ai/dsh-desktop-host', '@deepseek-ai/dsh-session-log-export']) {
  const dir = path.join(DSH, 'node_modules', p);
  try {
    fs.writeFileSync(path.join(OUT, p.replace(/[\/@]/g, '_') + '-listing.json'), JSON.stringify(fs.readdirSync(dir), null, 2));
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    fs.writeFileSync(path.join(OUT, p.replace(/[\/@]/g, '_') + '-package.json'), JSON.stringify(pkg, null, 2));
  } catch (e) {
    fs.writeFileSync(path.join(OUT, p.replace(/[\/@]/g, '_') + '.err'), String(e));
  }
}

// 5. search dsh for plugin-related dirs
function walk(dir, depth, out) {
  if (depth < 0) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'dist' || ent.name === 'build') continue;
    const full = path.join(dir, ent.name);
    const rel = path.relative(DSH, full);
    if (ent.isDirectory()) {
      if (/plugin|bundle|preset|extension/i.test(ent.name)) out.push('DIR ' + rel);
      walk(full, depth - 1, out);
    } else if (/plugin|bundle|preset/i.test(ent.name)) {
      out.push('FILE ' + rel);
    }
  }
}
const hits = [];
walk(DSH, 4, hits);
fs.writeFileSync(path.join(OUT, 'plugin-hits.txt'), hits.join('\n'));
console.log('done');
