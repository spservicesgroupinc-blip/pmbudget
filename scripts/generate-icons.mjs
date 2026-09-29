#!/usr/bin/env node
// Brand PWA icons with zero dependencies: hand-rolled PNG encoder + rasterizer.
// Encodes 8-bit RGBA PNGs (CRC32 + IHDR/IDAT/IEND chunks, zlib deflate) and
// draws the Hays + Sons "H+" mark at 4x supersampling, box-downsampled to the
// target size for anti-aliased edges. Output is fully opaque (white background).
//
// Run: node scripts/generate-icons.mjs

import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// Brand palette.
const WHITE = [0xff, 0xff, 0xff];
const RED = [0xdc, 0x26, 0x26];
const INK = [0x1a, 0x1a, 0x1a];

// Mark geometry on its native 65x42 unit canvas (see public/logo.svg).
const MARK_W = 65;
const MARK_H = 42;
const MARK_RECTS = [
  [0, 0, 14, 42, RED], // left bar
  [36, 0, 14, 42, INK], // right stem
  [14, 14, 51, 14, INK], // crossbar (flush at x=14, full width to x=65)
];

const SS = 4; // supersample factor: render at 4x, box-downsample 4x4

const ICONS = [
  { file: 'icon-192.png', size: 192, markWidthRatio: 0.62 },
  { file: 'icon-512.png', size: 512, markWidthRatio: 0.62 },
  { file: 'maskable-512.png', size: 512, markWidthRatio: 0.55, safeCircle: true },
  { file: 'apple-touch-icon.png', size: 180, markWidthRatio: 0.62 },
];

// --- PNG encoder -------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// CRC32, polynomial 0xEDB88320 (reflected), standard table.
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// Standard check values.
if (crc32(Buffer.from('123456789')) !== 0xcbf43926) throw new Error('CRC32 self-test failed');
if (crc32(Buffer.from('IEND')) !== 0xae426082) throw new Error('CRC32 IEND self-test failed');

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  typeBytes.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace: none

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter byte: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Rasterizer ---------------------------------------------------------------

function fillRect(buf, canvasW, canvasH, x0, y0, x1, y1, color) {
  const left = Math.max(0, x0);
  const top = Math.max(0, y0);
  const right = Math.min(canvasW, x1);
  const bottom = Math.min(canvasH, y1);
  for (let y = top; y < bottom; y++) {
    let o = (y * canvasW + left) * 4;
    for (let x = left; x < right; x++) {
      buf[o] = color[0];
      buf[o + 1] = color[1];
      buf[o + 2] = color[2];
      buf[o + 3] = 255;
      o += 4;
    }
  }
}

function minAlphaOf(buf) {
  let min = 255;
  for (let i = 3; i < buf.length; i += 4) {
    if (buf[i] < min) min = buf[i];
  }
  return min;
}

function renderIcon(size, markWidthRatio) {
  const big = size * SS;

  // Full-bleed opaque white background.
  const canvas = Buffer.alloc(big * big * 4);
  for (let i = 0; i < big * big; i++) {
    const o = i * 4;
    canvas[o] = WHITE[0];
    canvas[o + 1] = WHITE[1];
    canvas[o + 2] = WHITE[2];
    canvas[o + 3] = 255;
  }

  // Centred mark, scaled from the 65x42 unit canvas.
  const markW = Math.round(big * markWidthRatio);
  const markH = Math.round((markW * MARK_H) / MARK_W);
  const originX = Math.round((big - markW) / 2);
  const originY = Math.round((big - markH) / 2);
  const scale = markW / MARK_W;

  for (const [rx, ry, rw, rh, color] of MARK_RECTS) {
    fillRect(
      canvas,
      big,
      big,
      originX + Math.round(rx * scale),
      originY + Math.round(ry * scale),
      originX + Math.round((rx + rw) * scale),
      originY + Math.round((ry + rh) * scale),
      color
    );
  }

  // Box-downsample 4x4 blocks to the final size (anti-aliased edges).
  const out = Buffer.alloc(size * size * 4);
  const n = SS * SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < SS; dy++) {
        let o = ((y * SS + dy) * big + x * SS) * 4;
        for (let dx = 0; dx < SS; dx++) {
          r += canvas[o];
          g += canvas[o + 1];
          b += canvas[o + 2];
          a += canvas[o + 3];
          o += 4;
        }
      }
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }

  return {
    rgba: out,
    minAlpha: Math.min(minAlphaOf(canvas), minAlphaOf(out)),
    markW: markW / SS,
    markH: markH / SS,
  };
}

// --- Generate -----------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
console.log(`Generating brand PWA icons in ${OUT_DIR}`);

for (const icon of ICONS) {
  const { rgba, minAlpha, markW, markH } = renderIcon(icon.size, icon.markWidthRatio);

  if (minAlpha !== 255) {
    throw new Error(`${icon.file}: rendered alpha ${minAlpha} (must be fully opaque, 255)`);
  }

  if (icon.safeCircle) {
    const radius = Math.hypot(markW / 2, markH / 2);
    const safe = icon.size * 0.4;
    if (radius > safe) {
      throw new Error(
        `${icon.file}: mark corner radius ${radius.toFixed(1)}px exceeds 80% safe circle ${safe.toFixed(1)}px`
      );
    }
  }

  const filePath = join(OUT_DIR, icon.file);
  const bytes = encodePng(icon.size, icon.size, rgba);
  writeFileSync(filePath, bytes);

  // Read back and assert signature + IHDR dimensions.
  const readBack = readFileSync(filePath);
  if (!readBack.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${filePath}: file does not start with the PNG signature`);
  }
  if (readBack.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`${filePath}: first chunk is not IHDR`);
  }
  const width = readBack.readUInt32BE(16);
  const height = readBack.readUInt32BE(20);
  if (width !== icon.size || height !== icon.size) {
    throw new Error(`${filePath}: IHDR is ${width}x${height}, expected ${icon.size}x${icon.size}`);
  }

  const markPct = ((markW / icon.size) * 100).toFixed(2);
  const safeNote = icon.safeCircle
    ? `  safeCircle=ok (r=${Math.hypot(markW / 2, markH / 2).toFixed(1)}px <= ${(icon.size * 0.4).toFixed(1)}px)`
    : '';
  console.log(
    `${filePath}  ${width}x${height}  ${bytes.length} bytes  minAlpha=${minAlpha}  IHDR ok  mark=${markPct}%${safeNote}`
  );
}

console.log('Done.');
