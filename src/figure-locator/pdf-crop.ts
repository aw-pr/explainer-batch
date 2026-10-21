import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { imageSize } from './asset';
import { pageSizePts, type Rect } from './geometry';

export interface PdfCrop { bytes: Buffer; width: number; height: number; dpi: number }

const DEFAULT_DPI = 300;
const MAX_DPI = 600;
// Points times dpi/72 lands a hair under an integer (114 * 300 / 72 is 474.99999), so round with slack.
const EPSILON = 1e-6;

export function renderDpiFor(provenance: string, imagePpi?: number | null): number {
  if (provenance !== 'pdf-embedded' || !imagePpi || !Number.isFinite(imagePpi)) return DEFAULT_DPI;
  return Math.min(MAX_DPI, Math.max(DEFAULT_DPI, imagePpi));
}

export function embeddedImagePpi(pdfPath: string, page: number): number | null {
  const run = spawnSync('pdfimages', ['-list', '-f', String(page), '-l', String(page), pdfPath], { encoding: 'utf8' });
  if (run.error || run.status !== 0) return null;
  let best: { pixels: number; ppi: number } | null = null;
  for (const line of run.stdout.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols[2] !== 'image' || Number(cols[0]) !== page) continue;
    const pixels = Number(cols[3]) * Number(cols[4]), ppi = Number(cols[12]);
    if (Number.isFinite(pixels) && ppi > 0 && (!best || pixels > best.pixels)) best = { pixels, ppi };
  }
  return best?.ppi ?? null;
}

export function cropPdfRegion(pdfPath: string, page: number, box: Rect, dpi = DEFAULT_DPI): PdfCrop | null {
  const size = pageSizePts(pdfPath, page);
  if (!size) return null;
  const scale = dpi / 72;
  const x = Math.floor(Math.max(0, box.x0) * scale + EPSILON);
  const y = Math.floor(Math.max(0, box.y0) * scale + EPSILON);
  const w = Math.ceil(Math.min(size.w, box.x1) * scale - EPSILON) - x;
  const h = Math.ceil(Math.min(size.h, box.y1) * scale - EPSILON) - y;
  if (w <= 0 || h <= 0) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'figure-crop-'));
  try {
    const run = spawnSync('pdftoppm', [
      '-jpeg', '-jpegopt', 'quality=90', '-r', String(dpi), '-f', String(page), '-l', String(page),
      '-x', String(x), '-y', String(y), '-W', String(w), '-H', String(h), pdfPath, path.join(dir, 'crop'),
    ], { encoding: 'utf8' });
    if (run.error || run.status !== 0) return null;
    const file = fs.readdirSync(dir).find(f => f.endsWith('.jpg'));
    if (!file) return null;
    const bytes = fs.readFileSync(path.join(dir, file));
    const pixels = imageSize(bytes);
    return pixels ? { bytes, ...pixels, dpi } : null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
