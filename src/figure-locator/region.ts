import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { buildCaptionIndex, selectCaption, type CaptionEntry } from './captions';
import { formatLabel, matchCaption, parseLabel, type LabelKey } from './label';
import { imageBoxes, pageSizePts, renderGrey, type GreyMap, type Rect } from './geometry';

export interface PageBlock { box: Rect; lineCount: number; wordCount: number; text: string }
export type RegionResult = {
  ok: true; label: string; page: number; captionBox: Rect; region: Rect; cropBox: Rect;
  contentBox: Rect; coverage: number; provenance: 'pdf-embedded' | 'pdf-vector-crop';
  candidates: Rect[]; ambiguous: boolean; notes: string[];
} | {
  ok: false; reason: 'label-not-found' | 'region-too-small' | 'source-unavailable'; labels?: string[]; notes: string[];
};

export function pageBlocks(pdfPath: string, page: number): PageBlock[] {
  const run = spawnSync('pdftotext', ['-bbox-layout', '-f', String(page), '-l', String(page), pdfPath, '-'], {
    encoding: 'utf8', maxBuffer: 512 * 1024 * 1024,
  });
  if (run.error || run.status !== 0) throw new Error(`pdftotext failed: ${run.error?.message ?? run.stderr.trim()}`);
  if (!/<page\b/.test(run.stdout)) throw new Error('pdftotext returned no page');
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return [...run.stdout.matchAll(/<block\b([^>]*)>([\s\S]*?)<\/block>/g)].map(m => {
    const attr = (name: string) => Number(new RegExp(`\\b${name}="([^"]+)"`).exec(m[1])?.[1]);
    const box = { x0: attr('xMin'), y0: attr('yMin'), x1: attr('xMax'), y1: attr('yMax') };
    if (!Object.values(box).every(Number.isFinite)) throw new Error('Invalid text block');
    const words = [...m[2].matchAll(/<word\b[^>]*>([^<]*)<\/word>/g)].map(w => w[1].replace(
      /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,
      (all, dec, hex, name) => dec ? String.fromCodePoint(Number(dec)) :
        hex ? String.fromCodePoint(parseInt(hex, 16)) : entities[name] ?? all,
    ));
    return { box, lineCount: [...m[2].matchAll(/<line\b/g)].length, wordCount: words.length, text: words.join(' ') };
  });
}

const width = (r: Rect) => r.x1 - r.x0;
const height = (r: Rect) => r.y1 - r.y0;
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const union = (boxes: Rect[]): Rect => ({
  x0: Math.min(...boxes.map(b => b.x0)), y0: Math.min(...boxes.map(b => b.y0)),
  x1: Math.max(...boxes.map(b => b.x1)), y1: Math.max(...boxes.map(b => b.y1)),
});

export function regionOnPage(
  size: { w: number; h: number }, blocks: PageBlock[], grey: GreyMap, images: Rect[], caption: CaptionEntry,
  opts: { forceRegionCrop?: boolean; notes?: string[] } = {},
): RegionResult {
  const notes = [...(opts.notes ?? [])];
  const small = (): RegionResult => ({ ok: false, reason: 'region-too-small', notes });
  const captionBox = { x0: caption.box.xMin, y0: caption.box.yMin, x1: caption.box.xMax, y1: caption.box.yMax };
  const prose = (b: PageBlock) => b.lineCount >= 3 || (b.lineCount >= 2 && b.wordCount >= 12);
  const columns: Array<{ x0: number; x1: number }> = [];
  for (const b of blocks.filter(b => !matchCaption(b.text) && prose(b) && width(b.box) >= size.w * 0.25)
    .sort((a, b) => a.box.x0 - b.box.x0)) {
    const last = columns[columns.length - 1];
    if (last && b.box.x0 < last.x1) last.x1 = Math.max(last.x1, b.box.x1);
    else columns.push({ x0: b.box.x0, x1: b.box.x1 });
  }
  if (!columns.length) columns.push({ x0: 0, x1: size.w });
  const columnAt = (x: number) => columns.find(c => x >= c.x0 && x <= c.x1) ??
    columns.reduce((a, b) => Math.abs(x - (a.x0 + a.x1) / 2) < Math.abs(x - (b.x0 + b.x1) / 2) ? a : b);
  const text = { x0: columns[0].x0, x1: columns[columns.length - 1].x1 };
  const range = width(captionBox) > 0.6 * (text.x1 - text.x0) ? text : columnAt((captionBox.x0 + captionBox.x1) / 2);
  const stoppers = blocks.filter(b => {
    if (Object.keys(captionBox).every(k => Math.abs(b.box[k as keyof Rect] - captionBox[k as keyof Rect]) < 0.1)) return false;
    const col = columnAt((b.box.x0 + b.box.x1) / 2);
    return matchCaption(b.text) || (b.lineCount === 1 && (b.box.y0 < size.h * 0.08 || b.box.y1 > size.h * 0.92)) ||
      (prose(b) && width(b.box) >= 0.6 * (col.x1 - col.x0));
  }).map(b => ({ ...b.box, y0: b.box.y0 - 3, y1: b.box.y1 + 3 }));

  const sx = size.w / grey.width, sy = size.h / grey.height;
  const left = Math.max(0, Math.floor(range.x0 / sx)), right = Math.min(grey.width - 1, Math.ceil(range.x1 / sx) - 1);
  if (right < left) return small();
  const rows = Array.from({ length: grey.height }, (_, y) => {
    let min = Infinity, max = -Infinity, count = 0;
    for (let x = left; x <= right; x++) if (grey.data[y * grey.width + x] < 200) {
      min = Math.min(min, x); max = x; count++;
    }
    return { min, max, count };
  });
  const rules = new Set<number>(), frames = new Set<number>();
  const rowWidth = right - left + 1;
  const ink = (x: number, y: number) => y >= 0 && y < grey.height && x >= left && x <= right && grey.data[y * grey.width + x] < 200;
  for (let y = 0; y < rows.length; y++) {
    if (rows[y].count < rowWidth * 0.8) continue;
    const first = y;
    while (y + 1 < rows.length && rows[y + 1].count >= rowWidth * 0.8) y++;
    if ((y - first + 1) * sy > 2 || (rows[first - 1]?.count ?? 0) >= rowWidth * 0.2 ||
        (rows[y + 1]?.count ?? 0) >= rowWidth * 0.2) continue;
    const ends = [rows[first].min, rows[first].max];
    const frame = [first - 1, y + 1].some(adjacent => ends.every(x =>
      [-1, 0, 1].some(dx => ink(x + dx, adjacent))));
    for (let r = first; r <= y; r++) (frame ? frames : rules).add(r);
  }
  interface Band { y0: number; y1: number }
  const scan = (direction: -1 | 1): Band[] => {
    const bands: Band[] = [];
    let band: Band | undefined, gap = 0;
    const edge = direction === -1 ? captionBox.y0 - 3 : captionBox.y1 + 3;
    for (let y = direction === -1 ? Math.floor(edge / sy) - 1 : Math.ceil(edge / sy); y >= 0 && y < grey.height; y += direction) {
      if (rules.has(y) || stoppers.some(b => overlap(range.x0, range.x1, b.x0, b.x1) > 0 &&
        overlap(y * sy, (y + 1) * sy, b.y0, b.y1) > 0)) break;
      if (rows[y].count) {
        if (!band || gap * sy > 12) {
          band = { y0: y, y1: y };
          bands.push(band);
        } else {
          band.y0 = Math.min(band.y0, y); band.y1 = Math.max(band.y1, y);
        }
        gap = 0;
      } else if (++gap * sy >= 40) break;
    }
    return bands;
  };
  let bands = scan(-1);
  if (!bands.length) bands = scan(1);
  if (!bands.length) return small();
  const bounds = (band: Band, inset = 0): Rect | null => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const outerX0 = Math.min(...rows.slice(band.y0, band.y1 + 1).map(r => r.min));
    const outerX1 = Math.max(...rows.slice(band.y0, band.y1 + 1).map(r => r.max));
    for (let y = band.y0 + inset; y <= band.y1 - inset; y++) {
      for (let x = outerX0 + inset; x <= outerX1 - inset; x++) if (ink(x, y)) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
    return Number.isFinite(x0) ? {
      x0: Math.max(range.x0, x0 * sx), y0: y0 * sy,
      x1: Math.min(range.x1, (x1 + 1) * sx), y1: (y1 + 1) * sy,
    } : null;
  };
  const inSpan = (image: Rect, band: Band) => image.x0 >= range.x0 && image.x1 <= range.x1 &&
    overlap(image.y0, image.y1, band.y0 * sy, (band.y1 + 1) * sy) >= height(image) * 0.5;
  const pad = (b: Rect): Rect => ({
    x0: Math.max(0, b.x0 - 4), y0: Math.max(0, b.y0 - 4),
    x1: Math.min(size.w, b.x1 + 4), y1: Math.min(size.h, b.y1 + 4),
  });
  const span = { y0: Math.min(...bands.map(b => b.y0)), y1: Math.max(...bands.map(b => b.y1)) };
  const spanImages = images.filter(image => inSpan(image, span));
  const raw = bounds(span)!;
  const region = pad(union([raw, ...spanImages]));
  if (width(region) < 60 || height(region) < 40) return small();
  const framed = [...frames].some(y => y >= span.y0 && y <= span.y1);
  const contentBox = (framed ? bounds(span, 2) : raw) ?? raw;
  const coverage = spanImages.reduce((best, image) => Math.max(best,
    overlap(image.x0, image.x1, contentBox.x0, contentBox.x1) * overlap(image.y0, image.y1, contentBox.y0, contentBox.y1) /
      (width(contentBox) * height(contentBox))), 0);
  const embedded = spanImages.length === 1 && coverage >= 0.9 && !opts.forceRegionCrop;
  const ambiguous = bands.length > 1;
  bands = bands.slice(0, 5).sort((a, b) => a.y0 - b.y0);
  const candidates = ambiguous ? [...bands.map(b => pad(union([bounds(b)!, ...images.filter(image => inSpan(image, b))]))), region] : [region];
  return {
    ok: true, label: formatLabel(caption.key), page: caption.page, captionBox, region,
    cropBox: embedded ? spanImages[0] : region, contentBox, coverage,
    provenance: embedded ? 'pdf-embedded' : 'pdf-vector-crop', candidates, ambiguous, notes,
  };
}

export function locateRegion(
  pdfPath: string, label: string | LabelKey,
  opts: { pageHint?: number; forceRegionCrop?: boolean; index?: CaptionEntry[] } = {},
): RegionResult {
  let notes: string[] = [];
  try {
    if (!fs.existsSync(pdfPath)) throw new Error('PDF is missing');
    const key = typeof label === 'string' ? parseLabel(label) : label;
    const index = opts.index ?? buildCaptionIndex(pdfPath);
    const selected = key ? selectCaption(index, key, opts.pageHint) :
      { ok: false as const, reason: 'label-not-found' as const, labels: [...new Set(index.map(e => e.label))] };
    const page = selected.ok ? selected.entry.page : 1;
    if (selected.ok) notes = selected.notes;
    // A failed extraction must not be reported as an absent label, even with a supplied index.
    const size = pageSizePts(pdfPath, page);
    if (!size) throw new Error('pdfinfo returned no page size');
    const blocks = pageBlocks(pdfPath, page);
    if (!selected.ok) return { ...selected, notes };
    return regionOnPage(size, blocks, renderGrey(pdfPath, selected.entry.page),
      imageBoxes(pdfPath, selected.entry.page), selected.entry, { forceRegionCrop: opts.forceRegionCrop, notes });
  } catch (error) {
    return { ok: false, reason: 'source-unavailable', notes: [...notes, error instanceof Error ? error.message : String(error)] };
  }
}
