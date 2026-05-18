import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

/**
 * Extracts a figure from a PDF by name (e.g. "Figure 1") and returns a
 * `data:image/png;base64,...` URL the renderer can drop into `<img src>`.
 *
 * Two-tier strategy:
 *   1. Locate the page containing the figure caption via `pdftotext`.
 *   2. Try `pdfimages` — if the page holds a single dominant embedded
 *      raster (common for designed visual abstracts), extract it
 *      directly. This yields the figure with none of the surrounding
 *      page text.
 *   3. Fall back to whole-page rasterisation via `pdftoppm` — used
 *      when the figure is drawn from vector primitives or composed of
 *      many small images (typical of matplotlib-style charts).
 *
 * Returns null on any failure. The caller should treat null as "drop
 * the image block" — never fatal.
 */
export interface ExtractOptions {
  dpi?: number;
}

const MIN_EMBEDDED_WIDTH = 600;
const MIN_EMBEDDED_HEIGHT = 300;
const MAX_IMAGE_DIMENSION = 1600;
const JPEG_QUALITY = 85;
const CAPTION_MARGIN_PTS = 8;

export function extractFigureAsDataUrl(
  pdfPath: string,
  figureLabel: string,
  opts: ExtractOptions = {},
): string | null {
  if (!fs.existsSync(pdfPath)) return null;

  const figureToken = parseFigureToken(figureLabel);
  if (figureToken === null) return null;

  const page = locateFigurePage(pdfPath, figureToken);
  if (page === null) return null;

  if (isPageCodeHeavy(pdfPath, page)) {
    console.warn(`  ⚠ ${figureLabel} p.${page}: page looks code/text-heavy — dropping image block.`);
    return null;
  }

  const embedded = extractEmbeddedImage(pdfPath, page);
  if (embedded) return embedded;

  const dpi = opts.dpi ?? 150;
  const cropPts = findFigureCropPoints(pdfPath, page, figureToken);
  const cropArgs = cropPts ? buildCropArgs(cropPts, dpi, pdfPath) : undefined;
  const raster = rasterisePage(pdfPath, page, dpi, cropArgs);
  if (!raster) return null;

  try {
    return encodeAsJpegDataUrl(raster) ?? `data:image/png;base64,${fs.readFileSync(raster).toString('base64')}`;
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(raster); } catch { /* ignore */ }
  }
}

/**
 * Downscales + re-encodes the given PNG to JPEG via macOS `sips`, returning
 * a `data:image/jpeg;base64,...` URL. Returns null if sips is unavailable or
 * the conversion fails — callers should fall back to the original PNG.
 */
function encodeAsJpegDataUrl(pngPath: string): string | null {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-jpeg-'));
  const jpegPath = path.join(tmpDir, 'out.jpg');
  try {
    const result = spawnSync(
      'sips',
      [
        '-Z', String(MAX_IMAGE_DIMENSION),
        '--out', jpegPath,
        pngPath,
        '-s', 'format', 'jpeg',
        '-s', 'formatOptions', String(JPEG_QUALITY),
      ],
      { encoding: 'utf8' },
    );
    if (result.error || result.status !== 0) return null;
    if (!fs.existsSync(jpegPath)) return null;
    return `data:image/jpeg;base64,${fs.readFileSync(jpegPath).toString('base64')}`;
  } catch {
    return null;
  } finally {
    cleanupDir(tmpDir);
  }
}

/**
 * Pulls the largest embedded raster image from the given page via
 * `pdfimages`. Returns a data URL, or null if no suitably large image
 * is present (in which case the caller should fall back to page raster).
 */
function extractEmbeddedImage(pdfPath: string, page: number): string | null {
  const list = spawnSync('pdfimages', ['-list', pdfPath], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (list.error || list.status !== 0) return null;

  const hasQualifyingImage = list.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .some(line => {
      const cols = line.split(/\s+/);
      if (cols.length < 5) return false;
      if (Number.parseInt(cols[0], 10) !== page) return false;
      if (cols[2] !== 'image') return false;
      const width = Number.parseInt(cols[3], 10);
      const height = Number.parseInt(cols[4], 10);
      return width >= MIN_EMBEDDED_WIDTH && height >= MIN_EMBEDDED_HEIGHT;
    });

  if (!hasQualifyingImage) return null;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-embed-'));
  const prefix = path.join(tmpDir, 'img');
  const extract = spawnSync(
    'pdfimages',
    ['-png', '-f', String(page), '-l', String(page), pdfPath, prefix],
    { encoding: 'utf8' },
  );
  if (extract.error || extract.status !== 0) {
    cleanupDir(tmpDir);
    return null;
  }

  const pngs = fs.readdirSync(tmpDir)
    .filter(f => f.endsWith('.png'))
    .map(f => ({ path: path.join(tmpDir, f), size: fs.statSync(path.join(tmpDir, f)).size }))
    .sort((a, b) => b.size - a.size);

  if (pngs.length === 0) {
    cleanupDir(tmpDir);
    return null;
  }

  try {
    return encodeAsJpegDataUrl(pngs[0].path)
      ?? `data:image/png;base64,${fs.readFileSync(pngs[0].path).toString('base64')}`;
  } catch {
    return null;
  } finally {
    cleanupDir(tmpDir);
  }
}

/**
 * "Figure 1" → "1", "Figure 2a" → "2a", "Fig. 3" → "3",
 * "Figure 3.0" → "3.0". Returns null if no digit can be found.
 */
function parseFigureToken(label: string): string | null {
  const match = label.match(/(\d+(?:\.\d+)?[a-z]?)/i);
  return match ? match[1] : null;
}

/**
 * Regex-escape a figure token and add a negative lookahead so "3" doesn't
 * match inside "30". Decimal tokens like "3.0" already disambiguate.
 */
function tokenAfterPattern(token: string): string {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  // Disallow following digit OR dot-then-digit only when token has no decimal.
  const trailer = /\./.test(token) ? String.raw`(?!\d)` : String.raw`(?![\d.]\d)`;
  return escaped + trailer;
}

/**
 * Returns true if the page is dominated by code blocks or dense running text
 * rather than a standalone figure. Drops the image block before extraction
 * to avoid shipping a screenshot of prose or code listings.
 */
function isPageCodeHeavy(pdfPath: string, page: number): boolean {
  const result = spawnSync(
    'pdftotext',
    ['-layout', '-f', String(page), '-l', String(page), pdfPath, '-'],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0) return false;

  const lines = result.stdout.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 8) return false; // sparse page — likely fine

  const codePatterns = [
    /^#\s+\S/,                    // comment lines
    /^\w[\w.]*\s*=\s*\S/,         // assignments
    /^\s{4,}\S/,                  // deeply indented lines
    /\bdef\s+\w+\s*\(/,           // function defs
    /\bimport\s+\w+/,             // imports
    /^[a-z_]\w*\(.*\)\s*[{;]?$/,  // function calls
  ];

  const codeLines = lines.filter(l => codePatterns.some(p => p.test(l))).length;
  return codeLines / lines.length > 0.25;
}

function locateFigurePage(pdfPath: string, figureToken: string): number | null {
  const text = runPdftotext(pdfPath);
  if (text === null) return null;

  const pages = text.split('\f');
  const trailing = tokenAfterPattern(figureToken);

  // Prefer caption-style: "Figure N." or "Figure N:" at/near line start — this
  // is the page where the figure actually lives, not an inline reference.
  const captionPattern = new RegExp(
    String.raw`(?:^|\n)\s*(?:Figure|Fig\.?)\s+${trailing}\s*[.:]`,
    'im',
  );

  // Fallback: any occurrence (inline reference — less reliable).
  const anyPattern = new RegExp(
    String.raw`(?:^|\s)(?:Figure|Fig\.?)\s+${trailing}`,
    'i',
  );

  for (let i = 0; i < pages.length; i++) {
    if (captionPattern.test(pages[i])) return i + 1;
  }
  for (let i = 0; i < pages.length; i++) {
    if (anyPattern.test(pages[i])) return i + 1;
  }
  return null;
}

function runPdftotext(pdfPath: string): string | null {
  const result = spawnSync('pdftotext', ['-layout', pdfPath, '-'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout;
}

function rasterisePage(pdfPath: string, page: number, dpi: number, cropArgs?: string[]): string | null {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-fig-'));
  const prefix = path.join(tmpDir, 'page');
  const result = spawnSync(
    'pdftoppm',
    ['-png', '-r', String(dpi), '-f', String(page), '-l', String(page), ...(cropArgs ?? []), pdfPath, prefix],
    { encoding: 'utf8' },
  );
  if (result.error || result.status !== 0) {
    cleanupDir(tmpDir);
    return null;
  }

  // pdftoppm output naming: `<prefix>-<page>.png` (or `-<page-padded>.png` for many-page docs).
  const candidates = fs.readdirSync(tmpDir)
    .filter(f => f.endsWith('.png'))
    .map(f => path.join(tmpDir, f));

  if (candidates.length === 0) {
    cleanupDir(tmpDir);
    return null;
  }
  return candidates[0];
}

function pageWidthPixels(pdfPath: string, dpi: number): number | null {
  const result = spawnSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  const match = result.stdout.match(/Page size:\s*([\d.]+)\s+x\s+([\d.]+)\s+pts/i);
  if (!match) return null;
  const widthPts = Number.parseFloat(match[1]);
  return Number.isFinite(widthPts) && widthPts > 0
    ? Math.ceil(widthPts * (dpi / 72))
    : null;
}

interface FigureCrop {
  /** y-coordinate (PDF points, top-down) of the caption row */
  captionY: number;
  /** Estimated top edge of the figure region (pts), or null if no clear gap detected above */
  figureTopY: number | null;
  /** Estimated bottom edge of the figure region (pts), or null if no clear gap detected below */
  figureBottomY: number | null;
}

/** Minimum vertical gap (pts) above caption to count as a figure region. */
const MIN_FIGURE_GAP_PTS = 50;
/** Assumed line height when projecting figure top below the last text row. */
const LINE_HEIGHT_PTS = 12;

function readBboxWords(pdfPath: string, page: number): Array<{ yMin: number; text: string }> | null {
  const bbox = spawnSync(
    'pdftotext',
    ['-bbox', '-f', String(page), '-l', String(page), pdfPath, '-'],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  );
  if (!bbox.error && bbox.status === 0) {
    const wordPattern = /<word[^>]+yMin="([\d.]+)"[^>]*>([^<]+)<\/word>/g;
    const words: Array<{ yMin: number; text: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = wordPattern.exec(bbox.stdout)) !== null) {
      words.push({ yMin: parseFloat(m[1]), text: m[2].trim() });
    }
    if (words.length > 0) return words;
  }

  const tsv = spawnSync(
    'pdftotext',
    ['-tsv', '-f', String(page), '-l', String(page), pdfPath, '-'],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  );
  if (tsv.error || tsv.status !== 0) return null;

  return tsv.stdout
    .split('\n')
    .slice(1)
    .map(line => line.split('\t'))
    .filter(cols => cols.length >= 12 && cols[0] === '5')
    .map(cols => ({
      yMin: Number.parseFloat(cols[7]),
      text: cols.slice(11).join('\t').trim(),
    }))
    .filter(word => Number.isFinite(word.yMin) && word.text.length > 0);
}

function locateCaptionY(words: Array<{ yMin: number; text: string }>, figureToken: string): number | null {
  const escaped = figureToken.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const tokenPattern = new RegExp(String.raw`^${escaped}(?:[.:,]|$)`, 'i');
  for (let i = 0; i < words.length - 1; i++) {
    if (/^(Figure|Fig\.?)$/i.test(words[i].text) && tokenPattern.test(words[i + 1].text)) {
      return words[i].yMin;
    }
  }
  return null;
}

/**
 * Returns the figure's bounding box on the page in PDF points.
 *
 * The figure region is detected by finding the largest text-free vertical gap
 * adjacent to the caption row. Two layouts are common:
 *   - Academic: "Figure N." caption sits BELOW the figure → gap is above caption.
 *   - Report/infographic: "Figure N.X:" title sits ABOVE the chart → gap is below caption.
 *
 * We probe both sides and return whichever gap is present. Whichever side has
 * no clear gap returns null and the caller falls back to the page edge there.
 */
function findFigureCropPoints(pdfPath: string, page: number, figureToken: string): FigureCrop | null {
  const words = readBboxWords(pdfPath, page);
  if (!words || words.length === 0) return null;

  const captionY = locateCaptionY(words, figureToken);
  if (captionY === null) return null;

  const figureTopY = findGapAbove(words, captionY);
  const figureBottomY = findGapBelow(words, captionY, pageHeightPoints(pdfPath));

  return { captionY, figureTopY, figureBottomY };
}

function findGapAbove(words: Array<{ yMin: number }>, captionY: number): number | null {
  const above = words.filter(w => w.yMin < captionY - CAPTION_MARGIN_PTS);
  if (above.length === 0) return 0;

  const rowYs = bucketRows(above.map(w => w.yMin));

  let bestGap = rowYs[0];
  let bestIdx = -1;
  for (let i = 0; i < rowYs.length - 1; i++) {
    const g = rowYs[i + 1] - rowYs[i];
    if (g > bestGap) { bestGap = g; bestIdx = i; }
  }
  // Also: gap between last row and caption.
  const tailGap = (captionY - CAPTION_MARGIN_PTS) - rowYs[rowYs.length - 1];
  if (tailGap > bestGap) {
    // Caption is directly preceded by a gap → figure sits in this gap.
    return Math.max(0, rowYs[rowYs.length - 1] + LINE_HEIGHT_PTS);
  }

  if (bestGap < MIN_FIGURE_GAP_PTS) return null;
  return bestIdx === -1
    ? 0
    : Math.min(captionY, rowYs[bestIdx] + LINE_HEIGHT_PTS);
}

function findGapBelow(words: Array<{ yMin: number }>, captionY: number, pageHeight: number | null): number | null {
  const below = words.filter(w => w.yMin > captionY + CAPTION_MARGIN_PTS);
  if (below.length === 0) return pageHeight;

  const rowYs = bucketRows(below.map(w => w.yMin));

  let bestGap = 0;
  let bestRowAfter = -1;
  // Gap between caption and first row below it.
  const headGap = rowYs[0] - (captionY + CAPTION_MARGIN_PTS);
  if (headGap > bestGap) { bestGap = headGap; bestRowAfter = 0; }
  for (let i = 0; i < rowYs.length - 1; i++) {
    const g = rowYs[i + 1] - rowYs[i];
    if (g > bestGap) { bestGap = g; bestRowAfter = i + 1; }
  }
  if (bestGap < MIN_FIGURE_GAP_PTS) return null;
  return Math.max(captionY, rowYs[bestRowAfter] - LINE_HEIGHT_PTS);
}

function bucketRows(yMins: number[]): number[] {
  const sorted = [...yMins].sort((a, b) => a - b);
  const rows: number[] = [];
  for (const y of sorted) {
    if (rows.length === 0 || y - rows[rows.length - 1] > 3) rows.push(y);
  }
  return rows;
}

function pageHeightPoints(pdfPath: string): number | null {
  const result = spawnSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  const match = result.stdout.match(/Page size:\s*([\d.]+)\s+x\s+([\d.]+)\s+pts/i);
  if (!match) return null;
  const h = Number.parseFloat(match[2]);
  return Number.isFinite(h) && h > 0 ? h : null;
}

function buildCropArgs(crop: FigureCrop, dpi: number, pdfPath: string): string[] | undefined {
  // Don't crop unless we found a gap on at least one side. A confident bottom
  // implies the figure is below the caption (report style); a confident top
  // implies above (academic style). Both → crop the union including caption.
  if (crop.figureTopY === null && crop.figureBottomY === null) return undefined;

  const widthPx = pageWidthPixels(pdfPath, dpi);
  if (widthPx === null) return undefined;

  const ptsToPx = dpi / 72;

  const topPts = crop.figureTopY !== null
    ? crop.figureTopY
    : crop.captionY - CAPTION_MARGIN_PTS;
  const bottomPts = crop.figureBottomY !== null
    ? crop.figureBottomY
    : crop.captionY + CAPTION_MARGIN_PTS;

  const yPx = Math.max(0, Math.round(topPts * ptsToPx));
  const heightPx = Math.round((bottomPts - topPts) * ptsToPx);
  if (heightPx <= 0) return undefined;
  return ['-x', '0', '-y', String(yPx), '-W', String(widthPx), '-H', String(heightPx)];
}

function cleanupDir(dir: string): void {
  try {
    for (const f of fs.readdirSync(dir)) {
      try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
    }
    fs.rmdirSync(dir);
  } catch { /* ignore */ }
}
