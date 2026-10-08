const fs = require('fs');
const path = require('path');
const ASAR = 'C:/Users/russe/AppData/Local/Programs/DeepSeek Harness/resources/app.asar';
const NM = path.join(ASAR, 'dsh', 'node_modules', '@deepseek-ai');
const OUT = 'C:/ghannt/asar-dump';

const PKGS = [
  'dsh', 'dsh-plugin-manager', 'dsh-package-manifest', 'dsh-host-plugin-inventory',
  'dsh-plugin-package-inventory-deepseek', 'dsh-desktop-host', 'dsh-session-log-export',
  'dsh-host-webserver', 'dsh-client-modules', 'dsh-client-hmr', 'dsh-hmr',
  'dsh-cordis-host-runner', 'dsh-cordis-client-runner', 'dsh-tools', 'dsh-subprocess',
  'dsh-settings', 'dsh-config-editor', 'dsh-sdk-app', 'dsh-sdk-protocol',
  'dsh-sdk-jsonrpc-server', 'dsh-sdk-minimal', 'dsh-web', 'dsh-web-app', 'dsh-web-frontend',
  'dsh-http-proxy', 'dsh-client-ui-plugin-manager', 'dsh-client-ui-settings-plugins',
  'dsh-headless', 'dsh-app-boot', 'dsh-base', 'dsh-scope', 'dsh-webhook', 'dsh-commands',
  'dsh-session-log-deepseek', 'dsh-tool-cordis', 'dsh-host-frontend-static', 'dsh-api-gateway',
  'dsh-workflow', 'dsh-shell', 'dsh-storage', 'dsh-fs', 'dsh-client-store',
  'dsh-client-ui-settings-plugin-inventory', 'dsh-acp-app', 'dsh-agent-preset-registry',
  'dsh-hook-protocol', 'dsh-experimental-schedule-bundle', 'dsh-experimental-voice-input-bundle',
];

function copyDir(src, dst, filter) {
  fs.mkdirSync(dst, { recursive: true });
  let ents;
  try { ents = fs.readdirSync(src, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    if (filter && !filter(e, src)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d, filter);
    else { try { fs.copyFileSync(s, d); } catch (err) {} }
  }
}

// include lib, package.json, READMEs, cordis.patch.yml, presets; skip node_modules and dist (too big)
const filter = (e, src) => {
  const name = e.name;
  if (name === 'node_modules') return false;
  if (name === 'dist' && !src.includes('dsh-web-frontend')) return false;
  return true;
};

for (const p of PKGS) {
  const src = path.join(NM, p);
  const dst = path.join(OUT, p);
  try { copyDir(src, dst, filter); } catch (e) { console.log('FAIL ' + p + ': ' + e.message); }
}
console.log('copy done');
