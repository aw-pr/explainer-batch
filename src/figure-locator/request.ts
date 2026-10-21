import { spawnSync } from 'node:child_process';
import type { ImageOverride } from '../preprocess';
import type { FigureCandidate, RecreateDirective } from '../state';
import { labelsEqual, parseLabel, type LabelKey } from './label';

export interface FigureRequest {
  label?: LabelKey;
  pinned: boolean;
  why?: string;
  pageHint?: number;
  captionOverride?: string;
  altOverride?: string;
  forceRegionCrop: boolean;
  source: { pdfPath?: string; url?: string; arxivId?: string; snapshot?: FigureCandidate[] };
}

export function detectArxivId(input: {
  url?: string; referenceUrl?: string; sourceRef?: string; firstPageText?: string;
}): string | null {
  for (const value of [input.url, input.referenceUrl, input.sourceRef]) {
    if (typeof value !== 'string') continue;
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol) || !/^(www\.)?arxiv\.org$/i.test(url.hostname)) continue;
      const match = /^\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5}(?:v\d+)?)(?:\.pdf)?\/?$/.exec(url.pathname);
      if (match) return match[1];
    } catch {
      // Non-URL source references may still have an identifier in the PDF text.
    }
  }
  return /arXiv:(\d{4}\.\d{4,5})(v\d+)?/.exec(input.firstPageText ?? '')?.slice(1).join('') || null;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function labelFrom(value: unknown): LabelKey | null {
  return typeof value === 'string' ? parseLabel(value) : null;
}

export function buildFigureRequest(input: {
  output?: unknown; override?: ImageOverride; recreate?: RecreateDirective; source: FigureRequest['source'];
}): FigureRequest {
  const { override, recreate } = input;
  const output = record(input.output);
  const model = record(output.figure_request);
  const modelLabel = labelFrom(model.label);
  const pin = labelFrom(override?.source_figure) ?? (recreate?.enabled ? labelFrom(recreate.target) : null);
  const label = pin ?? modelLabel;
  const firstReference = Array.isArray(output.references) ? output.references[0] : undefined;
  const referenceUrl = typeof firstReference === 'string'
    ? /\bhref\s*=\s*["']([^"']+)["']/i.exec(firstReference)?.[1]
    : record(firstReference).url;
  const sourceRef = record(record(output.metadata).source).ref;
  const identifiers = {
    url: input.source.url,
    referenceUrl: typeof referenceUrl === 'string' ? referenceUrl : undefined,
    sourceRef: typeof sourceRef === 'string' ? sourceRef : undefined,
  };
  let arxivId = detectArxivId(identifiers);
  if (!arxivId && input.source.pdfPath) {
    const text = spawnSync('pdftotext', ['-f', '1', '-l', '1', input.source.pdfPath, '-'], {
      encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    });
    if (!text.error && text.status === 0) arxivId = detectArxivId({ firstPageText: text.stdout });
  }
  const source = Object.fromEntries(Object.entries(input.source).filter(([, value]) => value !== undefined));
  return {
    ...(label && { label }),
    pinned: pin !== null,
    ...(label && modelLabel && labelsEqual(label, modelLabel) && typeof model.why === 'string' && { why: model.why }),
    ...(override?.pageHint !== undefined && { pageHint: override.pageHint }),
    ...(override?.caption !== undefined && { captionOverride: override.caption }),
    ...(override?.alt_text !== undefined && { altOverride: override.alt_text }),
    forceRegionCrop: override?.forceRegionCrop === true,
    source: { ...source, ...(arxivId && { arxivId }) },
  };
}
