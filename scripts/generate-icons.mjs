#!/usr/bin/env node
/** 生成 GavinHub 扩展 / 侧边栏 / favicon 图标（毛玻璃圆角 + G 字标） */
import { deflateSync } from 'zlib';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const root = new URL('..', import.meta.url).pathname;
const outDir = join(root, 'icons');
const SIZES = [16, 32, 48, 96, 128];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** 圆角矩形 SDF（负值 = 内部） */
function roundRectSdf(x, y, cx, cy, hw, hh, r) {
  const px = Math.abs(x - cx) - hw + r;
  const py = Math.abs(y - cy) - hh + r;
  return Math.min(Math.max(px, py), 0) + Math.hypot(Math.max(px, 0), Math.max(py, 0)) - r;
}

/** G 字标：圆环 + 右侧开口 + 横杠 */
function gMarkSdf(x, y, cx, cy, scale) {
  const dx = (x - cx) / scale;
  const dy = (y - cy) / scale;
  const dist = Math.hypot(dx, dy);
  const ring = Math.abs(dist - 1) - 0.22;
  const angle = Math.atan2(dy, dx);
  const gap = angle > -0.45 && angle < 0.85;
  const maskedRing = gap ? 1 : ring;
  const barY = Math.abs(dy - 0.05) - 0.16;
  const barX = dx - 0.05;
  const bar = barX > 0 && barX < 0.95 && barY < 0 ? barY : 1;
  return Math.min(maskedRing, bar);
}

function renderIcon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const pad = size * 0.08;
  const cx = size / 2;
  const cy = size / 2;
  const hw = size / 2 - pad;
  const hh = size / 2 - pad;
  const corner = size * 0.24;
  const markScale = size * 0.19;

  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const i = row + 1 + x * 4;
      const body = roundRectSdf(x + 0.5, y + 0.5, cx, cy, hw, hh, corner);
      if (body > 0.5) {
        raw[i + 3] = 0;
        continue;
      }

      const edge = clamp(1 - body / 0.8, 0, 1);
      const u = (x - pad) / (size - pad * 2);
      const v = (y - pad) / (size - pad * 2);
      let r = lerp(46, 78, u * 0.55 + v * 0.45);
      let g = lerp(38, 62, u * 0.55 + v * 0.45);
      let b = lerp(58, 96, u * 0.55 + v * 0.45);

      const gloss = clamp(1 - v * 1.4, 0, 1) * 0.18;
      r += 255 * gloss;
      g += 255 * gloss;
      b += 255 * gloss;

      const rim = clamp(1 - Math.abs(body) / 1.2, 0, 1) * 0.12;
      r += 255 * rim;
      g += 255 * rim;
      b += 255 * rim;

      const mark = gMarkSdf(x, y, cx, cy + size * 0.01, markScale);
      if (mark < 0.35) {
        const t = clamp(1 - mark / 0.35, 0, 1);
        r = lerp(r, 255, t);
        g = lerp(g, 255, t);
        b = lerp(b, 255, t);
      }

      raw[i] = clamp(Math.round(r), 0, 255);
      raw[i + 1] = clamp(Math.round(g), 0, 255);
      raw[i + 2] = clamp(Math.round(b), 0, 255);
      raw[i + 3] = clamp(Math.round(lerp(0, 255, edge)), 0, 255);
    }
  }
  return raw;
}

function writePng(filePath, size) {
  const raw = renderIcon(size);
  const compressed = deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type);
    const crcBuf = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcBuf), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }

  const png = Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(filePath, png);
}

mkdirSync(outDir, { recursive: true });
for (const size of SIZES) {
  const path = join(outDir, `icon-${size}.png`);
  writePng(path, size);
  console.log(`wrote ${path}`);
}
