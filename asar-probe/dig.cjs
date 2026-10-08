const fs = require('fs');
const path = require('path');
const OUT = 'C:/ghannt/asar-probe';
const ASAR = 'C:/Users/russe/AppData/Local/Programs/DeepSeek Harness/resources/app.asar';
const DSH = path.join(ASAR, 'dsh');
const NM = path.join(DSH, 'node_modules');

function dump(name, data) {
  fs.writeFileSync(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

// desktop-runtime.json — likely the active plugin profile
dump('desktop-runtime.json', fs.readFileSync(path.join(DSH, 'desktop-runtime.json'), 'utf8'));

// asar root package.json
dump('app-package.json', fs.readFileSync(path.join(ASAR, 'package.json'), 'utf8'));

// asar root structure
dump('asar-lib.json', walk(path.join(ASAR, 'lib'), 2));
dump('asar-renderer.json', walk(path.join(ASAR, 'renderer'), 3));

function walk(dir, depth) {
  if (depth < 0) return [];
  const out = [];
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return []; }
  for (const e of ents) {
    if (e.name === 'node_modules') continue;
    const rel = path.relative(ASAR, path.join(dir, e.name));
    if (e.isDirectory()) {
      out.push(rel + '/');
      out.push(...walk(path.join(dir, e.name), depth - 1).map(x => x));
    } else {
      out.push(rel);
    }
  }
  return out;
}

// sizes of key packages
const KEY = [
  'dsh', 'dsh-plugin-manager', 'dsh-package-manifest', 'dsh-host-plugin-inventory',
  'dsh-plugin-package-inventory-deepseek', 'dsh-desktop-host', 'dsh-session-log-export',
  'dsh-host-webserver', 'dsh-client-modules', 'dsh-client-hmr', 'dsh-hmr',
  'dsh-cordis-host-runner', 'dsh-cordis-client-runner', 'dsh-tools', 'dsh-tool-cordis',
  'dsh-subprocess', 'dsh-settings', 'dsh-config-editor', 'dsh-sdk-app', 'dsh-sdk-protocol',
  'dsh-sdk-jsonrpc-server', 'dsh-sdk-minimal', 'dsh-web', 'dsh-web-app', 'dsh-web-frontend',
  'dsh-http-proxy', 'dsh-client-ui-plugin-manager', 'dsh-client-ui-settings-plugins',
  'dsh-headless', 'dsh-app-boot', 'dsh-base', 'dsh-scope', 'dsh-workflow-ptc',
];
const sizes = {};
for (const p of KEY) {
  const dir = path.join(NM, '@deepseek-ai', p);
  try {
    const st = fs.statSync(dir);
    if (st.isDirectory()) sizes[p] = { bytes: dirSize(dir), entries: fs.readdirSync(dir) };
  } catch (e) { sizes[p] = { error: String(e) }; }
}
function dirSize(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += dirSize(p);
    else { try { total += fs.statSync(p).size; } catch {} }
  }
  return total;
}
dump('key-sizes.json', sizes);

// dsh-session-log-export package.json + dist listing (example plugin)
const sle = path.join(NM, '@deepseek-ai', 'dsh-session-log-export');
dump('sle-package.json', fs.readFileSync(path.join(sle, 'package.json'), 'utf8'));
try { dump('sle-dist.json', walk(path.join(sle, 'dist'), 3).map(p => p)); } catch (e) { dump('sle-dist.err', String(e)); }
try { dump('sle-root.json', fs.readdirSync(sle)); } catch (e) {}

// dsh-plugin-manager package.json
const pm = path.join(NM, '@deepseek-ai', 'dsh-plugin-manager');
dump('pm-package.json', fs.readFileSync(path.join(pm, 'package.json'), 'utf8'));
dump('pm-root.json', fs.readdirSync(pm));

// dsh-package-manifest package.json
const pkgman = path.join(NM, '@deepseek-ai', 'dsh-package-manifest');
dump('pkgman-package.json', fs.readFileSync(path.join(pkgman, 'package.json'), 'utf8'));
dump('pkgman-root.json', fs.readdirSync(pkgman));

// dsh-host-plugin-inventory
const hpi = path.join(NM, '@deepseek-ai', 'dsh-host-plugin-inventory');
dump('hpi-package.json', fs.readFileSync(path.join(hpi, 'package.json'), 'utf8'));
dump('hpi-root.json', fs.readdirSync(hpi));

// dsh core package.json
const dsh = path.join(NM, '@deepseek-ai', 'dsh');
dump('dsh-package.json', fs.readFileSync(path.join(dsh, 'package.json'), 'utf8'));
dump('dsh-root.json', fs.readdirSync(dsh));

console.log('done2');
