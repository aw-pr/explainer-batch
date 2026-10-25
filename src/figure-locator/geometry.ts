import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Rect { x0: number; y0: number; x1: number; y1: number }
export interface GreyMap { width: number; height: number; data: Uint8Array }

function temporary<T>(run: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'figure-geometry-'));
  try { return run(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

export function pageSizePts(pdfPath: string, page: number): { w: number; h: number } | null {
  const run = spawnSync('pdfinfo', ['-f', String(page), '-l', String(page), pdfPath], { encoding: 'utf8' });
  if (run.error || run.status !== 0) return null;
  const size = run.stdout.match(/(?:Page\s+\d+\s+)?size:\s*([\d.]+)\s+x\s+([\d.]+)\s+pts/i);
  if (!size) return null;
  const w = Number(size[1]), h = Number(size[2]);
  const rotation = Number(run.stdout.match(/(?:Page\s+\d+\s+)?rot:\s*(-?\d+)/i)?.[1] ?? 0);
  const rotated = ((rotation % 360) + 360) % 360;
  return w > 0 && h > 0 ? (rotated === 90 || rotated === 270 ? { w: h, h: w } : { w, h }) : null;
}

export function pageCount(pdfPath: string): number | null {
  const run = spawnSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  if (run.error || run.status !== 0) return null;
  const count = Number(run.stdout.match(/Pages:\s*(\d+)/i)?.[1]);
  return count > 0 ? count : null;
}

export function renderPdfPage(pdfPath: string, page: number, widthPx: number, outDir: string): string | null {
  const prefix = path.join(outDir, `refine-${page}`);
  const run = spawnSync('pdftoppm', [
    '-png', '-scale-to-x', String(widthPx), '-scale-to-y', '-1',
    '-f', String(page), '-l', String(page), pdfPath, prefix,
  ], { encoding: 'utf8' });
  if (run.error || run.status !== 0) return null;
  const file = fs.readdirSync(outDir).find(f => f.startsWith(`refine-${page}-`) && f.endsWith('.png'));
  return file ? path.join(outDir, file) : null;
}

export function parsePgm(buf: Buffer): GreyMap {
  let pos = 0;
  const whitespace = (n: number) => n === 32 || (n >= 9 && n <= 13);
  const token = (): string => {
    while (pos < buf.length) {
      if (whitespace(buf[pos])) pos++;
      else if (buf[pos] === 35) {
        while (pos < buf.length && buf[pos] !== 10 && buf[pos] !== 13) pos++;
      } else break;
    }
    const start = pos;
    while (pos < buf.length && !whitespace(buf[pos]) && buf[pos] !== 35) pos++;
    return buf.toString('ascii', start, pos);
  };
  const magic = token(), width = Number(token()), height = Number(token()), max = Number(token());
  if (magic !== 'P5' || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
      !Number.isInteger(max) || max < 1 || max > 255 || !Number.isSafeInteger(width * height)) {
    throw new Error('Invalid 8-bit P5 header');
  }
  // The raster length disambiguates header whitespace from whitespace-valued pixels.
  const start = buf.length - width * height;
  if (start <= pos || !buf.subarray(pos, start).every(whitespace)) throw new Error('Invalid P5 raster length');
  const data = Uint8Array.from(buf.subarray(start));
  if (max !== 255) data.forEach((v, i) => { data[i] = Math.round(v * 255 / max); });
  return { width, height, data };
}

export function renderGrey(pdfPath: string, page: number, dpi = 50): GreyMap {
  return temporary(dir => {
    const run = spawnSync('pdftoppm', [
      '-gray', '-r', String(dpi), '-f', String(page), '-l', String(page), pdfPath, path.join(dir, 'page'),
    ], { encoding: 'utf8' });
    if (run.error || run.status !== 0) throw new Error(`pdftoppm failed: ${run.error?.message ?? run.stderr.trim()}`);
    const file = fs.readdirSync(dir).find(f => f.endsWith('.pgm'));
    if (!file) throw new Error('pdftoppm returned no PGM');
    return parsePgm(fs.readFileSync(path.join(dir, file)));
  });
}

export function imageBoxes(pdfPath: string, page: number): Rect[] {
  return temporary(dir => {
    const prefix = path.join(dir, 'out');
    const run = spawnSync('pdftohtml', [
      '-xml', '-zoom', '1', '-f', String(page), '-l', String(page), pdfPath, prefix,
    ], { encoding: 'utf8' });
    if (run.error || run.status !== 0) throw new Error(`pdftohtml failed: ${run.error?.message ?? run.stderr.trim()}`);
    const xml = fs.readFileSync(`${prefix}.xml`, 'utf8');
    if (!/<page\b/.test(xml)) throw new Error('pdftohtml returned no page');
    return [...xml.matchAll(/<image\b([^>]*)\/?\s*>/g)].map(m => {
      const attr = (name: string) => Number(new RegExp(`\\b${name}="([^"]+)"`).exec(m[1])?.[1]);
      const x0 = attr('left'), y0 = attr('top'), w = attr('width'), h = attr('height');
      if (![x0, y0, w, h].every(Number.isFinite) || w <= 0 || h <= 0) throw new Error('Invalid image box');
      return { x0, y0, x1: x0 + w, y1: y0 + h };
    });
  });
}
