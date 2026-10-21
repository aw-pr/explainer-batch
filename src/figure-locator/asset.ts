import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { LabelKey } from './label';

export type AssetExt = 'jpg' | 'png' | 'webp' | 'gif' | 'svg';
export interface PixelSize { width: number; height: number }
export interface AssetRecord {
  file: string; asset: string; sha256: string; width?: number; height?: number;
  page?: number; provenance: string; label?: string;
}

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const SVG_PROLOGUE = /^(?:\s|<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>)*<svg[\s>/]/i;

const isWebp = (buf: Buffer) => buf.length >= 16 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';

export function sniffImageType(buf: Buffer): AssetExt | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString('ascii', 0, 6))) return 'gif';
  if (isWebp(buf)) return 'webp';
  return SVG_PROLOGUE.test(buf.toString('utf8', 0, Math.min(buf.length, 4096)).replace(/^﻿/, '')) ? 'svg' : null;
}

function jpegSize(buf: Buffer): PixelSize | null {
  let pos = 2;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) return null;
    const marker = buf[pos + 1];
    if (marker === 0xff) { pos++; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { pos += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = buf.readUInt16BE(pos + 2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (pos + 9 > buf.length) return null;
      return { width: buf.readUInt16BE(pos + 7), height: buf.readUInt16BE(pos + 5) };
    }
    pos += 2 + length;
  }
  return null;
}

function webpSize(buf: Buffer): PixelSize | null {
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X' && buf.length >= 30) {
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  if (chunk === 'VP8L' && buf.length >= 25 && buf[20] === 0x2f) {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ' && buf.length >= 30 && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

export function imageSize(buf: Buffer): PixelSize | null {
  let size: PixelSize | null = null;
  switch (sniffImageType(buf)) {
    case 'png':
      if (buf.length >= 24 && buf.toString('ascii', 12, 16) === 'IHDR') size = { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
      break;
    case 'jpg': size = jpegSize(buf); break;
    case 'gif': if (buf.length >= 10) size = { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }; break;
    case 'webp': size = webpSize(buf); break;
  }
  return size && size.width > 0 && size.height > 0 ? size : null;
}

export function pngSizePx(file: string): { w: number; h: number } | null {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(24);
    try { fs.readSync(fd, buf, 0, 24, 0); } finally { fs.closeSync(fd); }
    const size = sniffImageType(buf) === 'png' ? imageSize(buf) : null;
    return size ? { w: size.width, h: size.height } : null;
  } catch {
    return null;
  }
}

export function assetFileName(label: LabelKey | null, ext: AssetExt): string {
  if (!label?.number) return `figure.${ext}`;
  return `${label.noun}-${label.number}${label.panel ?? ''}`.toLowerCase() + `.${ext}`;
}

export function writeAsset(
  dir: string, label: LabelKey | null, bytes: Buffer,
  meta: { page?: number; provenance: string; label?: string },
): AssetRecord {
  const ext = sniffImageType(bytes);
  if (!ext) throw new Error('Unrecognised image bytes');
  fs.mkdirSync(dir, { recursive: true });
  const asset = assetFileName(label, ext);
  const file = path.join(dir, asset);
  fs.writeFileSync(file, bytes);
  const size = imageSize(bytes);
  return {
    file, asset, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    ...(size && { width: size.width, height: size.height }),
    ...(meta.page !== undefined && { page: meta.page }),
    provenance: meta.provenance,
    ...(meta.label !== undefined && { label: meta.label }),
  };
}
