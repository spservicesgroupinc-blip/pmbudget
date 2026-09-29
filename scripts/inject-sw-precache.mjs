// Post-build step: inject the hashed Vite build assets into dist/sw.js so the
// very first visit precaches everything needed for a fully offline launch.
// Runs after `vite build` (see package.json "build"). Safe to re-run, and a
// no-op (exit 0) when the dist output or marker is missing.
import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve(process.cwd(), 'dist');
const swPath = path.join(distDir, 'sw.js');
const assetsDir = path.join(distDir, 'assets');
const MARKER = 'const BUILD_ASSETS = [];';

if (!fs.existsSync(swPath)) {
  console.warn('[sw-precache] dist/sw.js not found — skipping injection.');
  process.exit(0);
}

let assets = [];
if (fs.existsSync(assetsDir)) {
  assets = fs
    .readdirSync(assetsDir)
    .filter((name) => /\.(js|css|woff2?|png|svg|jpg|jpeg|webp|ico)$/i.test(name))
    .sort()
    .map((name) => `/assets/${name}`);
}

const source = fs.readFileSync(swPath, 'utf8');
if (!source.includes(MARKER)) {
  console.warn('[sw-precache] marker not found in dist/sw.js — skipping injection.');
  process.exit(0);
}

const injected = source.replace(MARKER, `const BUILD_ASSETS = ${JSON.stringify(assets)};`);
fs.writeFileSync(swPath, injected);
console.log(`[sw-precache] injected ${assets.length} build asset(s) into dist/sw.js`);
