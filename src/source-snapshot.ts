import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pageCount } from './figure-locator/geometry';
import { LlmContractError } from './llm-contract';
import type { SourceSnapshot } from './llm-contract';
import { pageText } from './page-text';

export interface SourceInput {
  root: string;
  pdf?: string;
  text?: string;
  images?: ReadonlyArray<{ relativePath: string; label: string }>;
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function buildSourceSnapshot(input: SourceInput, opts: { maxChars: number }): SourceSnapshot {
  const unavailable = () => new LlmContractError('SOURCE_TEXT_UNAVAILABLE', 'Complete source text is unavailable.');
  let text = input.text ?? '';
  let pdf: SourceSnapshot['pdf'];
  if (input.pdf !== undefined) {
    const file = path.resolve(input.root, input.pdf);
    const count = pageCount(file);
    if (count === null) throw unavailable();
    const pages: string[] = [];
    let hasText = false;
    for (let p = 1; p <= count; p++) {
      const extracted = pageText(file, p);
      if (extracted === null) throw unavailable();
      const body = extracted.lines.join('\n').trimEnd();
      if (body.trim()) hasText = true;
      pages.push(`[Page ${p}]\n${body}`);
    }
    if (!hasText) throw unavailable();
    text = pages.join('\n\n');
    pdf = { relativePath: input.pdf, sha256: sha256(fs.readFileSync(file)) };
  }
  if (!text.trim()) throw unavailable();
  if (text.length > opts.maxChars) {
    throw new LlmContractError('SOURCE_TOO_LARGE', 'Complete source text exceeds the configured character limit.');
  }
  const images = (input.images ?? []).map(image => ({
    ...image, sha256: sha256(fs.readFileSync(path.resolve(input.root, image.relativePath))),
  }));
  const digest = sha256(JSON.stringify([text, pdf?.sha256 ?? null, images.map(image => [image.label, image.sha256])]));
  return { digest, text, ...(pdf ? { pdf } : {}), images };
}
