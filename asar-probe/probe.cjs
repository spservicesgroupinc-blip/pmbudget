const fs = require('fs');
const path = require('path');
const OUT = 'C:/ghannt/asar-probe';
const ASAR = 'C:/Users/russe/AppData/Local/Programs/DeepSeek Harness/resources/app.asar';
try {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'ping.txt'), 'pong-' + Date.now());
  console.log('WRITE_OK');
} catch (e) { console.log('WRITE_FAIL ' + e.message); }
try {
  console.log('LS ' + JSON.stringify(fs.readdirSync(OUT)));
} catch (e) { console.log('LS_FAIL ' + e.message); }
// read asar root
try { console.log('ASAR_ROOT ' + JSON.stringify(fs.readdirSync(ASAR))); } catch (e) { console.log('ASAR_FAIL ' + e.message); }
// dsh top
try { console.log('DSH_TOP ' + JSON.stringify(fs.readdirSync(path.join(ASAR, 'dsh')))); } catch (e) { console.log('DSH_FAIL ' + e.message); }
