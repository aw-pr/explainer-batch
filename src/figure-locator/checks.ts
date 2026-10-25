import fs from 'node:fs';

export function looksBlank(file: string, size: { w: number; h: number } | null): boolean {
  try {
    if (!size || size.w * size.h <= 0) return false;
    return size.w < 48 || size.h < 48 || fs.statSync(file).size / (size.w * size.h) < 0.006;
  } catch {
    return false;
  }
}
