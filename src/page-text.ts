import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';

export interface PageLines {
  page: number;
  lines: string[];
  usable: boolean;
}

const cache = new Map<string, PageLines | null>();

export function pageUsable(text: string): boolean {
  const words = text.match(/[a-zA-Z]{3,}/g) ?? [];
  return words.length >= 40
    && words.filter(word => /[aeiou]/i.test(word)).length / words.length >= 0.7;
}

export function pageText(pdfPath: string, page: number): PageLines | null {
  let hash: string;
  try {
    hash = createHash('sha256').update(fs.readFileSync(pdfPath)).digest('hex');
  } catch {
    return null;
  }
  const key = `${hash}:${page}`;
  if (cache.has(key)) return cache.get(key)!;

  let result: PageLines | null = null;
  try {
    const text = execFileSync(process.env.PDFTOTEXT_BIN || 'pdftotext', [
      '-f', String(page), '-l', String(page), '-layout', pdfPath, '-',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      .replace(/[\u0000-\u0008\u000b-\u001f]/g, '');
    result = { page, lines: text.split('\n'), usable: pageUsable(text) };
  } catch {
    // A failed extraction is evidence of an unavailable text layer for this run.
  }
  cache.set(key, result);
  return result;
}
