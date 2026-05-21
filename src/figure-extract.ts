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
  /** Override page detection — when set, skip caption scan and use this page. */
  pageHint?: number;
}

const MIN_EMBEDDED_WIDTH = 600;
const MIN_EMBEDDED_HEIGHT = 300;
const MAX_IMAGE_DIMENSION = 1600;
const JPEG_QUALITY = 85;
const CAPTION_MARGIN_PTS = 8;

export interface FigureCropResult {
  /** 1-indexed page number. */
  page: number;
  pageWidthPts: number;
  pageHeightPts: number;
  /** Crop rectangle in user-space points, top-left origin (matches pdftotext -bbox-layout). */
  cropPts: { xMin: number; yMin: number; xMax: number; yMax: number };
  column: ColumnBounds | null;
  /** 'embedded' when pdfimages tier-1 would succeed; 'vector' for rasterised crop. */
  tier: 'embedded' | 'vector' | null;
}

export function extractFigureAsDataUrl(
  pdfPath: string,
  figureLabel: string,
  opts: ExtractOptions = {},
): string | null {
  if (!fs.existsSync(pdfPath)) return null;

  const derived = deriveFigureCrop(pdfPath, figureLabel, opts);
  if (derived === null) return null;
  const { page } = derived;

  // Skip the code-heavy guard when the caller pinned the page via directive -
  // the user has explicitly named the figure and the post-extraction text-
  // density gate (output.ts) will still catch a genuinely bad crop. The guard
  // is for the legacy unguided path where the model picked the figure label
  // and we want a cheap rejection before cropping.
  if (opts.pageHint === undefined && isPageCodeHeavy(pdfPath, page)) {
    console.warn(`  ⚠ ${figureLabel} p.${page}: page looks code/text-heavy — dropping image block.`);
    return null;
  }

  if (derived.tier === 'embedded') {
    const embedded = extractEmbeddedImage(pdfPath, page);
    if (embedded) return embedded;
  }

  const dpi = opts.dpi ?? 150;
  const cropArgs = buildCropArgs(derived, dpi);
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
function hasEmbeddedImage(pdfPath: string, page: number): boolean {
  const list = spawnSync('pdfimages', ['-list', pdfPath], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (list.error || list.status !== 0) return false;

  return list.stdout
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
}

function extractEmbeddedImage(pdfPath: string, page: number): string | null {
  if (!hasEmbeddedImage(pdfPath, page)) return null;

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
 *
 * Two independent guards:
 *   1. Code density  — >25% of lines match code-pattern heuristics.
 *   2. Prose density — page has many lines AND most are long running-text
 *      sentences (avg word count per line > threshold). Academic body-text
 *      pages typically have 35+ lines averaging 8+ words each; figure pages
 *      have far fewer or much shorter lines.
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

  // Guard 1: code patterns
  const codePatterns = [
    /^#\s+\S/,                    // comment lines
    /^\w[\w.]*\s*=\s*\S/,         // assignments
    /^\s{4,}\S/,                  // deeply indented lines
    /\bdef\s+\w+\s*\(/,           // function defs
    /\bimport\s+\w+/,             // imports
    /^[a-z_]\w*\(.*\)\s*[{;]?$/,  // function calls
  ];
  const codeLines = lines.filter(l => codePatterns.some(p => p.test(l))).length;
  if (codeLines / lines.length > 0.25) return true;

  // Guard 2: prose density — many lines of long running text
  const PROSE_LINE_THRESHOLD = 30;
  const PROSE_AVG_WORDS_THRESHOLD = 7;
  if (lines.length >= PROSE_LINE_THRESHOLD) {
    const totalWords = lines.reduce((sum, l) => sum + l.split(/\s+/).filter(Boolean).length, 0);
    const avgWords = totalWords / lines.length;
    if (avgWords >= PROSE_AVG_WORDS_THRESHOLD) return true;
  }

  return false;
}

function locateFigurePage(pdfPath: string, figureToken: string, pageHint?: number): number | null {
  const text = runPdftotext(pdfPath);
  if (text === null) return null;

  const pages = text.split('\f');

  if (pageHint !== undefined) {
    if (Number.isInteger(pageHint) && pageHint > 0 && pageHint <= pages.length) {
      return pageHint;
    }
    console.warn(`  ⚠ pageHint ${pageHint} out of range (PDF has ${pages.length} pages) — skipping figure.`);
    return null;
  }

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

function pageWidthPoints(pdfPath: string): number | null {
  const result = spawnSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  const match = result.stdout.match(/Page size:\s*([\d.]+)\s+x\s+([\d.]+)\s+pts/i);
  if (!match) return null;
  const w = Number.parseFloat(match[1]);
  return Number.isFinite(w) && w > 0 ? w : null;
}

interface FigureCrop {
  /** y-coordinate (PDF points, top-down) of the caption row */
  captionY: number;
  /** Estimated top edge of the figure region (pts), or null if no clear gap detected above */
  figureTopY: number | null;
  /** Estimated bottom edge of the figure region (pts), or null if no clear gap detected below */
  figureBottomY: number | null;
  /** Horizontal column the caption sits in, or null if page is single-column. */
  column: ColumnBounds | null;
}

/** Minimum vertical gap (pts) adjacent to caption to count as a figure region. */
const MIN_FIGURE_GAP_PTS = 25;
/** Assumed line height when projecting figure top below the last text row. */
const LINE_HEIGHT_PTS = 12;

interface Word {
  xMin: number;
  xMax: number;
  yMin: number;
  text: string;
}

function readBboxWords(pdfPath: string, page: number): Word[] | null {
  const bbox = spawnSync(
    'pdftotext',
    ['-bbox', '-f', String(page), '-l', String(page), pdfPath, '-'],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  );
  if (!bbox.error && bbox.status === 0) {
    const wordPattern = /<word\s+([^>]+)>([^<]+)<\/word>/g;
    const words: Word[] = [];
    let m: RegExpExecArray | null;
    while ((m = wordPattern.exec(bbox.stdout)) !== null) {
      const attrs = m[1];
      const xMinM = attrs.match(/xMin="([\d.]+)"/);
      const xMaxM = attrs.match(/xMax="([\d.]+)"/);
      const yMinM = attrs.match(/yMin="([\d.]+)"/);
      if (!yMinM) continue;
      words.push({
        xMin: xMinM ? parseFloat(xMinM[1]) : 0,
        xMax: xMaxM ? parseFloat(xMaxM[1]) : 0,
        yMin: parseFloat(yMinM[1]),
        text: m[2].trim(),
      });
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
    .map(cols => {
      const xMin = Number.parseFloat(cols[6]);
      const width = Number.parseFloat(cols[8]);
      return {
        xMin,
        xMax: Number.isFinite(xMin) && Number.isFinite(width) ? xMin + width : 0,
        yMin: Number.parseFloat(cols[7]),
        text: cols.slice(11).join('\t').trim(),
      };
    })
    .filter(word => Number.isFinite(word.yMin) && word.text.length > 0);
}

function locateCaptionWord(words: Word[], figureToken: string): Word | null {
  const escaped = figureToken.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const tokenPattern = new RegExp(String.raw`^${escaped}(?:[.:,]|$)`, 'i');
  for (let i = 0; i < words.length - 1; i++) {
    if (/^(Figure|Fig\.?)$/i.test(words[i].text) && tokenPattern.test(words[i + 1].text)) {
      return words[i];
    }
  }
  return null;
}

export interface ColumnBounds {
  left: number;
  right: number;
}

/**
 * Detect two-column layout by binning word x-centres and looking for a
 * low-density gutter near the page midline. Single-column or ambiguous → null
 * so the caller falls back to full-width crop.
 */
function findColumnBounds(words: Word[], pageWidthPts: number): { left: ColumnBounds; right: ColumnBounds } | null {
  if (!Number.isFinite(pageWidthPts) || pageWidthPts <= 0 || words.length < 40) return null;

  const BIN_PTS = 6;
  const binCount = Math.ceil(pageWidthPts / BIN_PTS);
  const bins = new Array<number>(binCount).fill(0);
  for (const w of words) {
    const centre = (w.xMin + w.xMax) / 2;
    if (!Number.isFinite(centre) || centre < 0 || centre >= pageWidthPts) continue;
    bins[Math.floor(centre / BIN_PTS)] += 1;
  }
  const total = bins.reduce((s, n) => s + n, 0);
  if (total === 0) return null;

  const mid = pageWidthPts / 2;
  const midBin = Math.floor(mid / BIN_PTS);
  const searchRadius = Math.ceil(80 / BIN_PTS);
  const lowThreshold = Math.max(1, (total / binCount) * 0.2);

  let gutterStart = -1;
  let gutterEnd = -1;
  let bestGutterWidth = 0;
  for (let i = Math.max(0, midBin - searchRadius); i < Math.min(binCount, midBin + searchRadius); i++) {
    if (bins[i] <= lowThreshold) {
      let j = i;
      while (j < Math.min(binCount, midBin + searchRadius) && bins[j] <= lowThreshold) j++;
      const width = (j - i) * BIN_PTS;
      if (width > bestGutterWidth) {
        bestGutterWidth = width;
        gutterStart = i * BIN_PTS;
        gutterEnd = j * BIN_PTS;
      }
      i = j;
    }
  }
  if (bestGutterWidth < 30) return null;

  const leftWords = words.filter(w => (w.xMin + w.xMax) / 2 < gutterStart);
  const rightWords = words.filter(w => (w.xMin + w.xMax) / 2 > gutterEnd);
  if (leftWords.length < 20 || rightWords.length < 20) return null;

  const leftXs = leftWords.flatMap(w => [w.xMin, w.xMax]);
  const rightXs = rightWords.flatMap(w => [w.xMin, w.xMax]);
  const left: ColumnBounds = { left: Math.min(...leftXs), right: Math.max(...leftXs) };
  const right: ColumnBounds = { left: Math.min(...rightXs), right: Math.max(...rightXs) };
  if (!Number.isFinite(left.left) || !Number.isFinite(right.right)) return null;
  return { left, right };
}

function captionColumn(
  captionWord: Word,
  columns: { left: ColumnBounds; right: ColumnBounds },
): ColumnBounds {
  const centre = (captionWord.xMin + captionWord.xMax) / 2;
  const distLeft = Math.abs(centre - (columns.left.left + columns.left.right) / 2);
  const distRight = Math.abs(centre - (columns.right.left + columns.right.right) / 2);
  return distLeft <= distRight ? columns.left : columns.right;
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

  const captionWord = locateCaptionWord(words, figureToken);
  if (captionWord === null) return null;
  const captionY = captionWord.yMin;

  const pageWidthPts = pageWidthPoints(pdfPath);
  const columns = pageWidthPts !== null ? findColumnBounds(words, pageWidthPts) : null;
  const column = columns ? captionColumn(captionWord, columns) : null;

  const figureTopY = findGapAbove(words, captionY);
  const figureBottomY = findGapBelow(words, captionY, pageHeightPoints(pdfPath));

  return { captionY, figureTopY, figureBottomY, column };
}

/**
 * Single source of truth for the figure crop rectangle. Both the rasteriser
 * and the text-density gate consume this so they evaluate the same region.
 */
export function deriveFigureCrop(
  pdfPath: string,
  figureLabel: string,
  opts: { pageHint?: number } = {},
): FigureCropResult | null {
  if (!fs.existsSync(pdfPath)) return null;
  const figureToken = parseFigureToken(figureLabel);
  if (figureToken === null) return null;

  const page = locateFigurePage(pdfPath, figureToken, opts.pageHint);
  if (page === null) return null;

  const pageWidthPts = pageWidthPoints(pdfPath);
  const pageHeightPts = pageHeightPoints(pdfPath);
  if (pageWidthPts === null || pageHeightPts === null) return null;

  const tier: 'embedded' | 'vector' = hasEmbeddedImage(pdfPath, page) ? 'embedded' : 'vector';

  const crop = findFigureCropPoints(pdfPath, page, figureToken);
  if (!crop) return null;

  // Directive path: the user has named the figure and pinned the page, so we
  // trust that and use a simple "figure is above the caption" rule. The gap-
  // finder is brittle when the figure has lots of internal text (architecture
  // diagrams with layer labels) - it cannot tell intra-figure text from
  // figure/caption boundary text. Cropping page-top to just-above-caption is
  // robust for the ~all-academic-papers case where the figure sits above its
  // caption. Skips the page header strip via HEADER_SKIP_PTS.
  const HEADER_SKIP_PTS = 60;
  const CAPTION_GAP_PTS = 4;
  let topPts: number;
  let bottomPts: number;
  if (opts.pageHint !== undefined) {
    topPts = HEADER_SKIP_PTS;
    bottomPts = Math.max(topPts + 1, crop.captionY - CAPTION_GAP_PTS);
  } else {
    topPts = crop.figureTopY !== null
      ? crop.figureTopY
      : Math.max(0, crop.captionY - CAPTION_MARGIN_PTS);
    bottomPts = crop.figureBottomY !== null
      ? crop.figureBottomY
      : Math.min(pageHeightPts, crop.captionY + CAPTION_MARGIN_PTS);
  }
  if (!(bottomPts > topPts)) return null;

  let xMin = 0;
  let xMax = pageWidthPts;
  if (crop.column) {
    const COLUMN_BLEED_PTS = 6;
    xMin = Math.max(0, crop.column.left - COLUMN_BLEED_PTS);
    xMax = Math.min(pageWidthPts, crop.column.right + COLUMN_BLEED_PTS);
    if (!(xMax > xMin)) { xMin = 0; xMax = pageWidthPts; }
  }

  return {
    page,
    pageWidthPts,
    pageHeightPts,
    cropPts: { xMin, yMin: topPts, xMax, yMax: bottomPts },
    column: crop.column,
    tier,
  };
}

function findGapAbove(words: Array<{ yMin: number }>, captionY: number): number | null {
  const above = words.filter(w => w.yMin < captionY - CAPTION_MARGIN_PTS);
  if (above.length === 0) return 0;

  const rowYs = bucketRows(above.map(w => w.yMin));

  // Only count inter-row gaps — do NOT initialise with rowYs[0] (the top
  // margin gap) because that just measures empty header space, not a figure region.
  let bestGap = 0;
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

// After this many content rows we start looking for a closing gap.
// Prevents the headGap (space between a title-above caption and the chart body)
// from being mistaken for the figure bottom.
const MIN_CONTENT_ROWS_BEFORE_BOTTOM = 5;

function findGapBelow(words: Array<{ yMin: number }>, captionY: number, pageHeight: number | null): number | null {
  const below = words.filter(w => w.yMin > captionY + CAPTION_MARGIN_PTS);
  if (below.length === 0) return pageHeight;

  const rowYs = bucketRows(below.map(w => w.yMin));

  // Return the FIRST significant gap that appears after at least
  // MIN_CONTENT_ROWS_BEFORE_BOTTOM content rows have been seen.  Using the
  // first (not the largest) gap prevents page-number whitespace at the foot of
  // the page from swamping the real chart→notes boundary.
  for (let i = MIN_CONTENT_ROWS_BEFORE_BOTTOM - 1; i < rowYs.length - 1; i++) {
    const g = rowYs[i + 1] - rowYs[i];
    if (g >= MIN_FIGURE_GAP_PTS) {
      return Math.max(captionY, rowYs[i + 1] - LINE_HEIGHT_PTS);
    }
  }
  return null;
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

function buildCropArgs(derived: FigureCropResult, dpi: number): string[] | undefined {
  const ptsToPx = dpi / 72;
  const fullWidthPx = Math.ceil(derived.pageWidthPts * ptsToPx);
  const { xMin, yMin, xMax, yMax } = derived.cropPts;

  const xPx = Math.max(0, Math.floor(xMin * ptsToPx));
  const yPx = Math.max(0, Math.floor(yMin * ptsToPx));
  const widthPx = Math.min(fullWidthPx - xPx, Math.ceil((xMax - xMin) * ptsToPx));
  const heightPx = Math.ceil((yMax - yMin) * ptsToPx);
  if (widthPx <= 0 || heightPx <= 0) return undefined;

  return ['-x', String(xPx), '-y', String(yPx), '-W', String(widthPx), '-H', String(heightPx)];
}

function cleanupDir(dir: string): void {
  try {
    for (const f of fs.readdirSync(dir)) {
      try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
    }
    fs.rmdirSync(dir);
  } catch { /* ignore */ }
}
