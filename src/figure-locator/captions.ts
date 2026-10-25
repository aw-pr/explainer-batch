import { spawnSync } from 'node:child_process';
import { formatLabel, labelsEqual, matchCaption, type LabelKey } from './label';

export interface CaptionEntry {
  key: LabelKey;
  label: string;
  page: number;
  box: { xMin: number; yMin: number; xMax: number; yMax: number };
  text: string;
  continued: boolean;
}

export type CaptionSelection =
  | { ok: true; entry: CaptionEntry; notes: string[] }
  | { ok: false; reason: 'label-not-found'; labels: string[] };

const TOKEN_RE = /<page\b|<block\b([^>]*)>|<\/block>|<word\b[^>]*>([^<]*)<\/word>/g;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-z]+));/g, (whole, dec, hex, name) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return ENTITIES[name] ?? whole;
  });
}

function attr(attrs: string, name: string): number {
  const m = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return m ? Number(m[1]) : NaN;
}

export function parseCaptionIndex(bboxXml: string, firstPage = 1): CaptionEntry[] {
  const entries: CaptionEntry[] = [];
  let page = firstPage - 1;
  let block: { attrs: string; words: string[] } | null = null;

  const flush = () => {
    if (!block) return;
    const text = block.words.join(' ');
    const match = matchCaption(text);
    if (match) {
      entries.push({
        key: match.key,
        label: formatLabel(match.key),
        page,
        box: {
          xMin: attr(block.attrs, 'xMin'),
          yMin: attr(block.attrs, 'yMin'),
          xMax: attr(block.attrs, 'xMax'),
          yMax: attr(block.attrs, 'yMax'),
        },
        text,
        continued: match.continued,
      });
    }
    block = null;
  };

  for (const m of bboxXml.matchAll(TOKEN_RE)) {
    if (m[0].startsWith('<page')) {
      flush();
      page += 1;
    } else if (m[0].startsWith('<block')) {
      flush();
      block = { attrs: m[1] ?? '', words: [] };
    } else if (m[0] === '</block>') {
      flush();
    } else if (block) {
      block.words.push(decodeEntities(m[2]));
    }
  }
  flush();
  return entries;
}

export function buildCaptionIndex(pdfPath: string): CaptionEntry[] {
  const run = spawnSync('pdftotext', ['-bbox-layout', pdfPath, '-'], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  if (run.error || run.status !== 0) {
    const why = run.error?.message ?? run.stderr.trim() ?? `exit ${run.status}`;
    throw new Error(`pdftotext failed on ${pdfPath}: ${why}`);
  }
  return parseCaptionIndex(run.stdout);
}

export function selectCaption(index: CaptionEntry[], want: LabelKey, pageHint?: number): CaptionSelection {
  const equal = index.filter(e => labelsEqual(e.key, want));
  const firsts = equal.filter(e => !e.continued);
  const candidates = firsts.length > 0 ? firsts : equal;
  if (candidates.length === 0) {
    return { ok: false, reason: 'label-not-found', labels: [...new Set(index.map(e => e.label))] };
  }
  const notes: string[] = [];
  let entry = candidates[0];
  if (pageHint !== undefined) {
    const hinted = candidates.find(e => e.page === pageHint);
    if (hinted) entry = hinted;
    else notes.push('page-hint-ignored');
  }
  return { ok: true, entry, notes };
}
