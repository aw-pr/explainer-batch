import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { runVision, resolveVisionProvider, visionAuthAvailable, cleanupTmp, downscaleLongEdge, type VisionResult } from './vision';
import { getModelConfig } from './model-config';
import type { ExplainerJson } from './types/explainer-json';
import type { FigureCandidate } from './state';

/**
 * Subset of the focus-sidecar image override consumed here (structural
 * superset of preprocess.ImageOverride: source_figure is optional so a bare
 * page hint or caption override does not pin a figure name).
 */
export interface ImageOverride {
  source_figure?: string;
  caption?: string;
  alt_text?: string;
  pageHint?: number;
}

/**
 * What the explainer already says, threaded into the selection prompt so the
 * model picks a figure that complements the article instead of duplicating
 * the charts it already contains.
 */
export interface FigureContext {
  headline?: string;
  subtitle?: string;
  sectionLabels: string[];
  chartTitles: string[];
}

export function contextFromExplainer(json: ExplainerJson): FigureContext {
  const charts = Array.isArray(json.charts) ? json.charts : (json.chart ? [json.chart] : []);
  return {
    headline: json.hero?.headline,
    subtitle: json.hero?.subtitle,
    sectionLabels: (json.sections ?? [])
      .map(s => s?.label)
      .filter((l): l is string => typeof l === 'string' && l.length > 0),
    chartTitles: charts
      .map(c => (c as { title?: unknown })?.title)
      .filter((t): t is string => typeof t === 'string' && t.length > 0),
  };
}

/** A failed prior selection, fed back so a retry can avoid it (stateful retry). */
interface PreviousAttempt {
  page?: number;
  candidate?: number;
  source_figure?: string;
  bbox?: [number, number, number, number];
  reason: string;
}

/**
 * Vision-driven figure extraction. Replaces the deterministic
 * caption/gap-finder: render the whole document to page images, let a
 * vision model choose the single most useful figure and return its
 * bounding box, then crop sharply from the source render.
 *
 * Two input modes:
 *   - PDF  → `pdftoppm` thumbnails for selection, high-DPI crop for output.
 *   - URL  → Playwright element screenshots of figure-like DOM candidates;
 *            the model picks one by number and the crop is a fresh element
 *            screenshot (lazy import; Chromium only loaded for URLs). Pages
 *            with no candidates fall back to tiled full-page bbox selection.
 */

export interface VlmFigureResult {
  /** `data:image/jpeg;base64,...` ready for the renderer. */
  src: string;
  source_figure: string;
  caption: string;
  alt_text: string;
  /** Diagnostics. `'dom'` marks the snapshot-candidate path (no vision call at all). */
  route: VisionResult['route'] | 'dom';
  provider: VisionResult['provider'] | 'dom';
  page?: number;
  /**
   * Full-resolution PNG of the crop (base64, before the sips downscale that
   * produces `src`). Present only when the caller asked for it via
   * `keepCropPng` — the figure-data recreation pass reads numbers off this,
   * and the downscaled JPEG in `src` is too soft for that.
   */
  cropPngBase64?: string;
}

interface FigureSelection {
  found: boolean;
  page: number;
  bbox: [number, number, number, number];
  source_figure?: string;
  caption?: string;
  alt_text?: string;
  confidence?: number;
}

const MAX_PAGES = Number.parseInt(process.env.FIGURE_VLM_MAX_PAGES ?? '24', 10);
const THUMB_WIDTH_PX = 820;
const MIN_CONFIDENCE = 0.35;
const SELECTION_MAX_TOKENS = 700;

function envNum(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Output resolution / size knobs. CROP_DPI drives PDF crop sharpness; MAX_IMAGE_PX
// caps the longest side (sips -Z) so inlined base64 stays bounded; JPEG_QUALITY
// trades size for fidelity. Larger = sharper but heavier in the JSON: the
// 300dpi/2200px/q90 defaults roughly triple the inlined base64 weight versus
// the old 150/1600/85, in exchange for axis labels that survive the crop.
const CROP_DPI = envNum('FIGURE_VLM_DPI', 300);
const MAX_IMAGE_PX = envNum('FIGURE_VLM_MAX_PX', 2200);
const JPEG_QUALITY = envNum('FIGURE_VLM_JPEG_QUALITY', 90);
// Fractional padding added around the model bbox so a slightly-tight box doesn't
// clip the figure's outer labels. Small by default: the PDF path refines the
// box on a high-resolution render of the chosen page, so it is trustworthy and
// generous padding only drags in neighbouring body text.
const CROP_PAD = envNum('FIGURE_VLM_PAD', 0.005);
// Escalating margins for the re-crop-before-reselect loop: a verification
// failure is far more often a shaved axis label than a wrong figure.
const CROP_PAD_STEPS = [CROP_PAD, 0.02, 0.045];
// Width of the single-page render used by the PDF refine pass. Close to the
// final crop resolution so the refined bbox lands where the crop will be cut.
const REFINE_WIDTH_PX = envNum('FIGURE_VLM_REFINE_PX', 2200);

const SELECTION_SYSTEM =
  'You are a figure-selection assistant for a research-explainer pipeline. You ' +
  'are shown page images of a single source document, one image per page, in ' +
  'order. Identify the single most useful figure to illustrate a lay-audience ' +
  'explainer: a diagram, chart, schematic, or visual abstract that conveys the ' +
  "paper's core idea or headline result. Avoid pages that are pure prose, " +
  'reference lists, equations, or dense tables. Reply with ONLY a JSON object.';

/** Options shared by the selection prompt builders. */
interface SelectionOpts {
  named?: string;
  context?: FigureContext;
  pageHint?: number;
  prev?: PreviousAttempt;
}

function contextBlock(context?: FigureContext): string[] {
  if (!context) return [];
  const lines: string[] = ['Explainer context (what the article already covers):'];
  if (context.headline) lines.push(`- Headline: ${context.headline}`);
  if (context.subtitle) lines.push(`- Subtitle: ${context.subtitle}`);
  if (context.sectionLabels.length > 0) lines.push(`- Sections: ${context.sectionLabels.join('; ')}`);
  if (context.chartTitles.length > 0) {
    lines.push(`- The explainer ALREADY recreates these results as its own charts: ${context.chartTitles.join('; ')}.`);
    lines.push('  Prefer a complementary CONCEPTUAL figure (architecture, pipeline, schematic, visual abstract) over a results plot those charts duplicate.');
  }
  lines.push('');
  return lines;
}

function previousBlock(prev?: PreviousAttempt): string[] {
  if (!prev) return [];
  const what = [
    prev.candidate !== undefined ? `candidate ${prev.candidate}` : '',
    prev.page !== undefined ? `page ${prev.page}` : '',
    prev.source_figure ? `"${prev.source_figure}"` : '',
    prev.bbox ? `bbox [${prev.bbox.map(n => n.toFixed(2)).join(', ')}]` : '',
  ].filter(Boolean).join(', ');
  return [
    `A previous attempt selected ${what || 'a figure'} and it failed: ${prev.reason}.`,
    'Pick a DIFFERENT figure this time. Choose one that is clearly rendered with visible ' +
    'content; avoid interactive or animated charts that may not have painted, and avoid empty regions.',
    '',
  ];
}

function pageHintLine(pageHint?: number): string[] {
  if (!pageHint || !Number.isInteger(pageHint) || pageHint < 1) return [];
  return [`The user suggests the figure is on page ${pageHint}. Check that page first, but choose a better figure elsewhere if that page has none.`, ''];
}

function selectionPrompt(opts: SelectionOpts): string {
  const target = opts.named
    ? `The explainer requires a specific figure: "${opts.named}". Locate exactly that figure.`
    : 'No specific figure was requested, so choose the one figure that best illustrates the work.';
  return [
    target,
    '',
    ...contextBlock(opts.context),
    ...pageHintLine(opts.pageHint),
    ...previousBlock(opts.prev),
    'Each page image is preceded by its label ("Page N of M"); use those labels for the "page" field.',
    '',
    'Return ONLY this JSON (no prose, no code fence):',
    '{',
    '  "found": <true|false>,',
    '  "page": <1-based page number, as given by the image labels>,',
    '  "bbox": [x0, y0, x1, y1],   // normalized 0..1 within that page image; tight around the figure BODY, excluding its caption text',
    '  "source_figure": "<e.g. Figure 3, or a short label if unnumbered>",',
    '  "caption": "<plain caption for a glancing reader: if the figure uses a statistical construct (CCDF, tail parameter, log axis, error bands), first say in plain words what a point on it means, then the takeaway>",',
    '  "alt_text": "<concise alt text>",',
    '  "confidence": <0..1>',
    '}',
    'If no suitable figure exists, return {"found": false}.',
  ].join('\n');
}

function parseSelection(raw: string): FigureSelection | null {
  try {
    const fence = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    const slice = fence ? fence[1] : (start !== -1 && end > start ? raw.slice(start, end + 1) : raw);
    const obj = JSON.parse(slice) as Partial<FigureSelection>;
    if (!obj || obj.found === false) return { found: false } as FigureSelection;
    if (!Array.isArray(obj.bbox) || obj.bbox.length !== 4) return null;
    const bbox = obj.bbox.map(Number) as [number, number, number, number];
    if (bbox.some(n => !Number.isFinite(n))) return null;
    const page = Number(obj.page);
    if (!Number.isInteger(page) || page < 1) return null;
    return {
      found: true,
      page,
      bbox,
      source_figure: typeof obj.source_figure === 'string' ? obj.source_figure : undefined,
      caption: typeof obj.caption === 'string' ? obj.caption : undefined,
      alt_text: typeof obj.alt_text === 'string' ? obj.alt_text : undefined,
      confidence: typeof obj.confidence === 'number' ? obj.confidence : undefined,
    };
  } catch {
    return null;
  }
}

const FIGURE_ATTEMPTS = Math.max(1, Number.parseInt(process.env.FIGURE_VLM_ATTEMPTS ?? '2', 10));

function visionModel(provider: ReturnType<typeof resolveVisionProvider>): string {
  return process.env.FIGURE_VLM_MODEL ?? getModelConfig(provider).batchModel;
}

/**
 * One figure-selection vision call. The caller owns the retry loop so a retry
 * can be triggered by a transport failure, an unparseable reply, OR a blank/
 * uncroppable result. When `opts.prev` carries a failed prior selection the
 * prompt names it explicitly, so "pick a different figure" is actionable.
 */
async function selectFigureOnce(
  provider: ReturnType<typeof resolveVisionProvider>,
  imagePaths: string[],
  labels: string[],
  opts: SelectionOpts,
): Promise<{ sel: FigureSelection; vision: VisionResult } | null> {
  try {
    const vision = await runVision({
      provider,
      model: visionModel(provider),
      maxTokens: SELECTION_MAX_TOKENS,
      system: SELECTION_SYSTEM,
      prompt: selectionPrompt(opts),
      imagePaths,
      labels,
    });
    const sel = parseSelection(vision.text);
    if (sel) return { sel, vision };
    console.warn('  ⚠ figure-vlm: unparseable selection.');
  } catch (err) {
    console.warn(`  ⚠ figure-vlm: vision call failed — ${err instanceof Error ? err.message : String(err)}`);
  }
  return null;
}

/**
 * Blank-crop guard. A blank/near-uniform PNG compresses to almost nothing, so
 * bytes-per-pixel is a cheap, dependency-free proxy for "this crop has no
 * content" — catches interactive charts that screenshot blank and empty snaps.
 *
 * The threshold sits at 0.006: flat fills compress to roughly 0.001-0.003
 * bytes/px while sparse line diagrams on white can dip to ~0.01, so the old
 * 0.02 threshold false-rejected legitimate minimal diagrams. The semantic
 * verification pass now catches junk crops this cruder guard lets through.
 * Crops under 48px on either side are rejected outright; nothing that small
 * is a readable figure.
 */
const BLANK_BYTES_PER_PIXEL = 0.006;
const MIN_CROP_DIM_PX = 48;
function looksBlank(pngPath: string): boolean {
  try {
    const px = pngSizePx(pngPath);
    if (!px || px.w * px.h === 0) return false;
    if (px.w < MIN_CROP_DIM_PX || px.h < MIN_CROP_DIM_PX) {
      console.warn(`  ⚠ figure-vlm: crop too small (${px.w}x${px.h}px); rejecting.`);
      return true;
    }
    const bpp = fs.statSync(pngPath).size / (px.w * px.h);
    if (bpp < BLANK_BYTES_PER_PIXEL) {
      console.warn(`  ⚠ figure-vlm: crop looks blank (${bpp.toFixed(4)} bytes/px) — rejecting.`);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Semantic crop verification: one cheap vision call confirming the crop is a
 * single complete figure without surrounding body text. Fails open (returns
 * ok) on transport or parse errors so a flaky check can never discard a good
 * crop; a strict `ok: false` feeds its reason into the retry prompt.
 * FIGURE_VLM_VERIFY=0 disables; FIGURE_VLM_VERIFY_MODEL overrides the model.
 */
/** Reads a crop PNG as base64 when the caller asked to keep it; never throws. */
function cropBase64(pngPath: string, keep: boolean): string | undefined {
  if (!keep) return undefined;
  try {
    return fs.readFileSync(pngPath).toString('base64');
  } catch {
    return undefined;
  }
}

async function verifyCrop(
  provider: ReturnType<typeof resolveVisionProvider>,
  cropPath: string,
): Promise<{ ok: boolean; reason: string }> {
  if (process.env.FIGURE_VLM_VERIFY === '0') return { ok: true, reason: 'verification disabled' };
  const model = process.env.FIGURE_VLM_VERIFY_MODEL ?? visionModel(provider);
  const prompt = [
    'Does this image show a single complete figure (diagram, chart, schematic, or visual abstract) with no surrounding body text?',
    'A visible axis label, legend, or in-figure annotation is fine; paragraphs of article text, or a figure cut off at an edge, are not.',
    'Also fail the check if the figure is too blurry or low-resolution to read: axis labels, tick values, and legend text must be legible.',
    'Reply with ONLY strict JSON: {"ok": <true|false>, "reason": "<short reason>"}',
  ].join('\n');
  try {
    const vision = await runVision({
      provider,
      model,
      maxTokens: 150,
      system: 'You are a strict image QA checker for cropped figures. Reply with ONLY a JSON object.',
      prompt,
      imagePaths: [cropPath],
    });
    const raw = vision.text;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) return { ok: true, reason: 'unparseable verification reply' };
    const obj = JSON.parse(raw.slice(start, end + 1)) as { ok?: unknown; reason?: unknown };
    if (obj.ok === false) {
      return { ok: false, reason: typeof obj.reason === 'string' ? obj.reason : 'verifier rejected the crop' };
    }
    return { ok: true, reason: typeof obj.reason === 'string' ? obj.reason : 'ok' };
  } catch (err) {
    console.warn(`  ⚠ figure-vlm: verification call failed (${err instanceof Error ? err.message : String(err)}); accepting crop.`);
    return { ok: true, reason: 'verification unavailable' };
  }
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

interface Rect { x: number; y: number; w: number; h: number; }
interface Dims { w: number; h: number; }

function bboxToRect(bbox: [number, number, number, number], dims: Dims): Rect {
  const x0 = clamp01(Math.min(bbox[0], bbox[2]));
  const y0 = clamp01(Math.min(bbox[1], bbox[3]));
  const x1 = clamp01(Math.max(bbox[0], bbox[2]));
  const y1 = clamp01(Math.max(bbox[1], bbox[3]));
  return { x: x0 * dims.w, y: y0 * dims.h, w: (x1 - x0) * dims.w, h: (y1 - y0) * dims.h };
}

function padRect(r: Rect, dims: Dims): Rect {
  const px = dims.w * CROP_PAD;
  const py = dims.h * CROP_PAD;
  return { x: r.x - px, y: r.y - py, w: r.w + px * 2, h: r.h + py * 2 };
}

function clampClip(r: Rect, dims: Dims, maxDim: number): { x: number; y: number; width: number; height: number } {
  const maxH = Math.min(dims.h, maxDim);
  const x = Math.max(0, Math.min(r.x, dims.w - 8));
  const y = Math.max(0, Math.min(r.y, maxH - 8));
  return {
    x, y,
    width: Math.max(8, Math.min(r.w, dims.w - x)),
    height: Math.max(8, Math.min(r.h, maxH - y)),
  };
}

function intersectionOverUnion(a: Rect, b: Rect): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

interface DomRect { x: number; y: number; w: number; h: number; }

/**
 * Snaps the (imprecise) VLM bounding box to a real figure element so the crop
 * clips to actual element bounds instead of swallowing neighbouring body text.
 * Requires a minimum genuine overlap (IoU) before an element is eligible at
 * all, then prefers the SMALLEST eligible element: a tight inner img/svg beats
 * the page-wide wrapper that also happens to overlap. Returns null when
 * nothing fits (caller falls back to the padded VLM box).
 */
const MIN_SNAP_IOU = 0.1;
async function snapToFigureElement(page: import('playwright').Page, vlmRect: Rect): Promise<Rect | null> {
  const cands: DomRect[] = await page.evaluate(() => {
    const doc = (globalThis as { document?: any }).document;
    const win = globalThis as { scrollX?: number; scrollY?: number };
    if (!doc) return [];
    const selector = 'figure,picture,svg,canvas,img,[class*="chart" i],[class*="figure" i],[class*="graph" i]';
    const out: DomRect[] = [];
    doc.querySelectorAll(selector).forEach((el: any) => {
      const r = el.getBoundingClientRect();
      if (r.width < 60 || r.height < 60) return;
      out.push({
        x: r.left + (win.scrollX || 0),
        y: r.top + (win.scrollY || 0),
        w: r.width,
        h: r.height,
      });
    });
    return out;
  });

  if (!cands || cands.length === 0) return null;
  let best: DomRect | null = null;
  let bestArea = Infinity;
  for (const c of cands) {
    if (intersectionOverUnion(vlmRect, c) < MIN_SNAP_IOU) continue;
    const area = c.w * c.h;
    if (area < bestArea) { bestArea = area; best = c; }
  }
  if (!best) return null;
  return { x: best.x - 6, y: best.y - 6, w: best.w + 12, h: best.h + 12 };
}

/** Pad a normalized bbox slightly and clamp into [0,1]. */
function padBbox([x0, y0, x1, y1]: [number, number, number, number], pad = CROP_PAD): [number, number, number, number] {
  const ax0 = clamp01(Math.min(x0, x1) - pad);
  const ay0 = clamp01(Math.min(y0, y1) - pad);
  const ax1 = clamp01(Math.max(x0, x1) + pad);
  const ay1 = clamp01(Math.max(y0, y1) + pad);
  return [ax0, ay0, ax1, ay1];
}

/** Reads pixel width/height from a PNG's IHDR chunk (bytes 16..24), no decode. */
function pngSizePx(pngPath: string): { w: number; h: number } | null {
  try {
    const fd = fs.openSync(pngPath, 'r');
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    fs.closeSync(fd);
    if (buf.toString('ascii', 1, 4) !== 'PNG') return null;
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    return w > 0 && h > 0 ? { w, h } : null;
  } catch {
    return null;
  }
}

function pageSizePts(pdfPath: string): { w: number; h: number } | null {
  const result = spawnSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  const m = result.stdout.match(/Page size:\s*([\d.]+)\s+x\s+([\d.]+)\s+pts/i);
  if (!m) return null;
  const w = Number.parseFloat(m[1]);
  const h = Number.parseFloat(m[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}

function pageCount(pdfPath: string): number | null {
  const result = spawnSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  const m = result.stdout.match(/Pages:\s*(\d+)/i);
  return m ? Number.parseInt(m[1], 10) : null;
}

/** Render a single page at the given width. Returns the PNG path or null. Shared with figure-data.ts. */
export function renderPdfPage(pdfPath: string, page: number, widthPx: number, outDir: string): string | null {
  const prefix = path.join(outDir, `refine-${page}`);
  const result = spawnSync(
    'pdftoppm',
    ['-png', '-scale-to-x', String(widthPx), '-scale-to-y', '-1', '-f', String(page), '-l', String(page), pdfPath, prefix],
    { encoding: 'utf8' },
  );
  if (result.error || result.status !== 0) return null;
  const png = fs.readdirSync(outDir).filter(f => f.startsWith(`refine-${page}`) && f.endsWith('.png'))[0];
  return png ? path.join(outDir, png) : null;
}

/**
 * Pass 2 of the PDF flow: with the page known, ask for a tight bbox on a
 * high-resolution render of just that page. The pass-1 thumbnails are too
 * small for precise coordinates; this render is sharp enough to trust.
 */
async function refineBboxOnPage(
  provider: ReturnType<typeof resolveVisionProvider>,
  pagePng: string,
  pageNum: number,
  figureLabel: string | undefined,
): Promise<[number, number, number, number] | null> {
  const target = figureLabel ? `the figure "${figureLabel}"` : 'the previously chosen figure';
  const prompt = [
    `This is page ${pageNum} of the document, rendered at higher resolution. Earlier analysis chose ${target} on this page.`,
    'Return a tight bounding box around that figure\'s BODY only, excluding its caption text, any surrounding body text or column content, and the page\'s running header or footer line (figures flush with the page edge often sit directly under one).',
    '',
    'Return ONLY this JSON (no prose, no code fence):',
    '{"found": <true|false>, "bbox": [x0, y0, x1, y1]}   // normalised 0..1 within this page image',
    'If the figure is not actually on this page, return {"found": false}.',
  ].join('\n');
  try {
    const vision = await runVision({
      provider,
      model: visionModel(provider),
      maxTokens: 200,
      system: SELECTION_SYSTEM,
      prompt,
      imagePaths: [pagePng],
    });
    const raw = vision.text;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    const obj = JSON.parse(raw.slice(start, end + 1)) as { found?: boolean; bbox?: number[] };
    if (obj.found === false || !Array.isArray(obj.bbox) || obj.bbox.length !== 4) return null;
    const bbox = obj.bbox.map(Number) as [number, number, number, number];
    if (bbox.some(n => !Number.isFinite(n))) return null;
    return bbox;
  } catch (err) {
    console.warn(`  ⚠ figure-vlm: refine pass failed (${err instanceof Error ? err.message : String(err)}); using pass-1 bbox.`);
    return null;
  }
}

/** Render pages 1..N as width-normalized PNG thumbnails for the selection call. */
function renderPdfThumbnails(pdfPath: string, tmpDir: string, lastPage: number): string[] {
  const prefix = path.join(tmpDir, 'page');
  const result = spawnSync(
    'pdftoppm',
    ['-png', '-scale-to-x', String(THUMB_WIDTH_PX), '-scale-to-y', '-1', '-f', '1', '-l', String(lastPage), pdfPath, prefix],
    { encoding: 'utf8' },
  );
  if (result.error || result.status !== 0) return [];
  return fs.readdirSync(tmpDir)
    .filter(f => f.endsWith('.png'))
    .map(f => path.join(tmpDir, f))
    .sort();
}

function encodeJpegDataUrl(pngPath: string): string | null {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-vlm-jpeg-'));
  const jpegPath = path.join(tmpDir, 'out.jpg');
  try {
    const result = spawnSync(
      'sips',
      ['-Z', String(MAX_IMAGE_PX), '--out', jpegPath, pngPath, '-s', 'format', 'jpeg', '-s', 'formatOptions', String(JPEG_QUALITY)],
      { encoding: 'utf8' },
    );
    if (result.error || result.status !== 0 || !fs.existsSync(jpegPath)) {
      return `data:image/png;base64,${fs.readFileSync(pngPath).toString('base64')}`;
    }
    return `data:image/jpeg;base64,${fs.readFileSync(jpegPath).toString('base64')}`;
  } catch {
    return null;
  } finally {
    cleanupTmp(tmpDir);
  }
}

/**
 * Crop the chosen PDF page to the (normalized) bbox at high DPI. Returns the
 * crop's PNG path inside `outDir` (so the caller can verify it before
 * encoding), or null when the crop fails or looks blank.
 */
function cropPdfBboxPng(pdfPath: string, page: number, bbox: [number, number, number, number], outDir: string, pad = CROP_PAD): string | null {
  const size = pageSizePts(pdfPath);
  if (!size) return null;
  const [x0, y0, x1, y1] = padBbox(bbox, pad);
  const ptsToPx = CROP_DPI / 72;
  const xPx = Math.max(0, Math.floor(x0 * size.w * ptsToPx));
  const yPx = Math.max(0, Math.floor(y0 * size.h * ptsToPx));
  const wPx = Math.ceil((x1 - x0) * size.w * ptsToPx);
  const hPx = Math.ceil((y1 - y0) * size.h * ptsToPx);
  if (wPx <= 4 || hPx <= 4) return null;

  const stamp = `pdfcrop-${page}-${Date.now()}`;
  const prefix = path.join(outDir, stamp);
  const result = spawnSync(
    'pdftoppm',
    ['-png', '-r', String(CROP_DPI), '-f', String(page), '-l', String(page),
      '-x', String(xPx), '-y', String(yPx), '-W', String(wPx), '-H', String(hPx), pdfPath, prefix],
    { encoding: 'utf8' },
  );
  if (result.error || result.status !== 0) return null;
  const png = fs.readdirSync(outDir).filter(f => f.startsWith(stamp) && f.endsWith('.png')).map(f => path.join(outDir, f))[0];
  if (!png || looksBlank(png)) return null;
  return png;
}

async function extractFromPdf(pdfPath: string, provider: ReturnType<typeof resolveVisionProvider>, baseOpts: SelectionOpts, keepCrop: boolean): Promise<VlmFigureResult | null> {
  const total = pageCount(pdfPath);
  const lastPage = Math.min(total ?? MAX_PAGES, MAX_PAGES);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-vlm-pages-'));
  try {
    const thumbs = renderPdfThumbnails(pdfPath, tmpDir, lastPage);
    if (thumbs.length === 0) {
      console.warn('  ⚠ figure-vlm: page render produced no images.');
      return null;
    }
    const labels = thumbs.map((_, i) => `Page ${i + 1} of ${thumbs.length}`);

    let prev: PreviousAttempt | undefined;
    for (let attempt = 1; attempt <= FIGURE_ATTEMPTS; attempt++) {
      const selected = await selectFigureOnce(provider, thumbs, labels, { ...baseOpts, prev });
      if (!selected) continue;
      const { sel, vision } = selected;
      if (!sel.found) {
        console.warn('  ⚠ figure-vlm: model found no suitable figure.');
        return null;
      }
      if (typeof sel.confidence === 'number' && sel.confidence < MIN_CONFIDENCE) {
        console.warn(`  ⚠ figure-vlm: low confidence ${sel.confidence.toFixed(2)}; dropping figure.`);
        return null;
      }
      // A pinned figure means "this figure or nothing": a retry is allowed to
      // re-crop it, but not to swap in a different figure under the pin's
      // label (the clip must stay the honest fallback for the recreation).
      const pinnedKey = baseOpts.named ? figureLabelKey(baseOpts.named) : null;
      if (pinnedKey && sel.source_figure && figureLabelKey(sel.source_figure) !== pinnedKey) {
        console.warn(`  ⚠ figure-vlm: selection drifted to ${sel.source_figure} but ${baseOpts.named} is pinned; retrying.`);
        prev = { page: sel.page, source_figure: sel.source_figure, bbox: sel.bbox, reason: `you selected ${sel.source_figure}, but only ${baseOpts.named} is acceptable` };
        continue;
      }
      const page = Math.min(Math.max(sel.page, 1), thumbs.length);

      // Two-pass zoom-refine: pass 1 picked the page from small thumbnails;
      // pass 2 re-reads only that page at high resolution for a tight bbox.
      let bbox = sel.bbox;
      const refinePng = renderPdfPage(pdfPath, page, REFINE_WIDTH_PX, tmpDir);
      if (refinePng) {
        const refined = await refineBboxOnPage(provider, refinePng, page, sel.source_figure ?? baseOpts.named);
        if (refined) bbox = refined;
      }

      // A verification failure usually means the bbox shaved an axis or
      // legend, not that the wrong figure was picked — so before burning a
      // whole reselection attempt, re-crop the same bbox with widening
      // margins and let the verifier judge each.
      let cropPng: string | null = null;
      let verdict: { ok: boolean; reason: string } | null = null;
      // Last step: full page width over the bbox's vertical span — rotated
      // axis labels sit far outside the plot area the refine pass returns,
      // and no symmetric pad reliably reaches them.
      const cropBoxes: Array<{ box: [number, number, number, number]; pad: number; note: string }> = [
        ...CROP_PAD_STEPS.map(pad => ({ box: bbox, pad, note: `pad ${pad}` })),
        { box: [0, bbox[1], 1, bbox[3]] as [number, number, number, number], pad: 0.02, note: 'full page width' },
      ];
      for (const { box, pad, note } of cropBoxes) {
        const attemptPng = cropPdfBboxPng(pdfPath, page, box, tmpDir, pad);
        if (!attemptPng) continue;
        cropPng = attemptPng;
        verdict = await verifyCrop(provider, attemptPng);
        if (verdict.ok) break;
        console.warn(`  ⚠ figure-vlm: crop failed verification at ${note} (${verdict.reason}).`);
      }
      if (!cropPng) {
        console.warn(`  ⚠ figure-vlm: crop failed/blank (attempt ${attempt}/${FIGURE_ATTEMPTS}).`);
        prev = { page, source_figure: sel.source_figure, bbox, reason: 'the crop rendered blank or could not be produced' };
        continue;
      }
      if (!verdict?.ok) {
        console.warn('  ⚠ figure-vlm: crop failed verification at every pad; retrying selection.');
        prev = { page, source_figure: sel.source_figure, bbox, reason: `the crop failed verification: ${verdict?.reason ?? 'unknown'}` };
        continue;
      }
      const src = encodeJpegDataUrl(cropPng);
      if (!src) continue;
      const label = baseOpts.named ?? sel.source_figure ?? 'Figure';
      return {
        src,
        source_figure: label,
        caption: sel.caption ?? `${label} from the source paper.`,
        alt_text: sel.alt_text ?? sel.caption ?? `${label} from the source paper.`,
        route: vision.route,
        provider: vision.provider,
        page,
        cropPngBase64: cropBase64(cropPng, keepCrop),
      };
    }
    console.warn('  ⚠ figure-vlm: no usable figure after retries.');
    return null;
  } finally {
    cleanupTmp(tmpDir);
  }
}

/** Lazy Playwright import keeps Chromium optional for the PDF-only path. */
async function loadPlaywright(): Promise<typeof import('playwright') | null> {
  try {
    const dynImport = new Function('m', 'return import(m)') as (m: string) => Promise<typeof import('playwright')>;
    return await dynImport('playwright');
  } catch {
    console.warn('  ⚠ figure-vlm: playwright not installed — run `npm i playwright && npx playwright install chromium` to enable URL figures.');
    return null;
  }
}

/**
 * Triggers lazy-loaded content and chart animations before the figure
 * screenshot: scrolls through the whole page so IntersectionObserver-gated
 * images and client-side (canvas/SVG) charts actually paint, then settles.
 * Without this, interactive charts screenshot blank.
 */
async function renderReady(page: import('playwright').Page): Promise<void> {
  try {
    await page.evaluate(async () => {
      const w = globalThis as { innerHeight?: number; scrollTo?: (x: number, y: number) => void; document?: any };
      const doc = w.document;
      const max = Math.max(doc?.body?.scrollHeight ?? 0, doc?.documentElement?.scrollHeight ?? 0);
      const step = Math.max(400, w.innerHeight ?? 800);
      for (let y = 0; y <= max; y += step) {
        w.scrollTo?.(0, y);
        await new Promise(r => setTimeout(r, 120));
      }
      w.scrollTo?.(0, 0);
    });
    await page.waitForTimeout(800);
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
  } catch {
    /* best-effort: render hints only */
  }
}

// URL candidate flow: element screenshots are downscaled to this long edge for
// the selection call (the final crop is re-shot at full quality).
const CANDIDATE_SEND_PX = 1568;
const MAX_CANDIDATES = 12;
const MIN_CANDIDATE_W = 160;
const MIN_CANDIDATE_H = 120;

interface DomCandidate { id: number; x: number; y: number; w: number; h: number; tag: string; }

/**
 * Finds figure-like elements, tags each with a data-vlm-cand attribute (so a
 * Playwright locator can re-find it later), and returns their geometry.
 * Near-identical overlaps collapse to the tighter element: the inner img wins
 * over the <figure> that also wraps the caption. Capped at MAX_CANDIDATES by
 * area, returned in document (top-to-bottom) order.
 */
async function markFigureCandidates(page: import('playwright').Page): Promise<DomCandidate[]> {
  return page.evaluate(({ maxCandidates, minW, minH }) => {
    const doc = (globalThis as { document?: any }).document;
    const win = globalThis as { scrollX?: number; scrollY?: number };
    if (!doc) return [] as DomCandidate[];
    const selector = 'figure,picture,svg,canvas,img,[class*="chart" i],[class*="figure" i],[class*="graph" i]';
    doc.querySelectorAll('[data-vlm-cand]').forEach((el: any) => el.removeAttribute('data-vlm-cand'));
    const cands: Array<{ el: any; x: number; y: number; w: number; h: number }> = [];
    doc.querySelectorAll(selector).forEach((el: any) => {
      const r = el.getBoundingClientRect();
      if (r.width < minW || r.height < minH) return;
      cands.push({ el, x: r.left + (win.scrollX || 0), y: r.top + (win.scrollY || 0), w: r.width, h: r.height });
    });
    cands.sort((a, b) => a.w * a.h - b.w * b.h);
    const kept: typeof cands = [];
    for (const c of cands) {
      const dup = kept.some(k => {
        const ix = Math.max(0, Math.min(c.x + c.w, k.x + k.w) - Math.max(c.x, k.x));
        const iy = Math.max(0, Math.min(c.y + c.h, k.y + k.h) - Math.max(c.y, k.y));
        return (ix * iy) / Math.min(c.w * c.h, k.w * k.h) >= 0.85;
      });
      if (!dup) kept.push(c);
    }
    kept.sort((a, b) => b.w * b.h - a.w * a.h);
    const top = kept.slice(0, maxCandidates);
    top.sort((a, b) => a.y - b.y || a.x - b.x);
    return top.map((c, i) => {
      c.el.setAttribute('data-vlm-cand', String(i + 1));
      return { id: i + 1, x: c.x, y: c.y, w: c.w, h: c.h, tag: String(c.el.tagName || '').toLowerCase() };
    });
  }, { maxCandidates: MAX_CANDIDATES, minW: MIN_CANDIDATE_W, minH: MIN_CANDIDATE_H });
}

const CANDIDATE_SYSTEM =
  'You are a figure-selection assistant for a research-explainer pipeline. You ' +
  'are shown candidate images cropped from a single web page, each labelled with ' +
  'its candidate number, in page order. Choose the single most useful figure to ' +
  'illustrate a lay-audience explainer: a diagram, chart, schematic, or visual ' +
  "abstract that conveys the page's core idea or headline result. Avoid logos, " +
  'author photos, decorative banners, and navigation imagery. Reply with ONLY a ' +
  'JSON object.';

interface CandidateSelection {
  found: boolean;
  candidate: number;
  source_figure?: string;
  caption?: string;
  alt_text?: string;
  confidence?: number;
}

function candidatePrompt(opts: SelectionOpts, count: number): string {
  const target = opts.named
    ? `The explainer requires a specific figure: "${opts.named}". Choose the candidate showing exactly that figure.`
    : 'No specific figure was requested, so choose the candidate that best illustrates the work.';
  return [
    target,
    '',
    ...contextBlock(opts.context),
    ...previousBlock(opts.prev),
    `You are shown ${count} candidate images, labelled "Candidate 1" to "Candidate ${count}".`,
    '',
    'Return ONLY this JSON (no prose, no code fence):',
    '{',
    '  "found": <true|false>,',
    '  "candidate": <1-based candidate number, as given by the image labels>,',
    '  "source_figure": "<e.g. Figure 3, or a short label if unnumbered>",',
    '  "caption": "<plain caption for a glancing reader: if the figure uses a statistical construct (CCDF, tail parameter, log axis, error bands), first say in plain words what a point on it means, then the takeaway>",',
    '  "alt_text": "<concise alt text>",',
    '  "confidence": <0..1>',
    '}',
    'If no candidate is a suitable figure, return {"found": false}.',
  ].join('\n');
}

function parseCandidateSelection(raw: string): CandidateSelection | null {
  try {
    const fence = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    const slice = fence ? fence[1] : (start !== -1 && end > start ? raw.slice(start, end + 1) : raw);
    const obj = JSON.parse(slice) as Partial<CandidateSelection>;
    if (!obj || obj.found === false) return { found: false, candidate: 0 };
    const candidate = Number(obj.candidate);
    if (!Number.isInteger(candidate) || candidate < 1) return null;
    return {
      found: true,
      candidate,
      source_figure: typeof obj.source_figure === 'string' ? obj.source_figure : undefined,
      caption: typeof obj.caption === 'string' ? obj.caption : undefined,
      alt_text: typeof obj.alt_text === 'string' ? obj.alt_text : undefined,
      confidence: typeof obj.confidence === 'number' ? obj.confidence : undefined,
    };
  } catch {
    return null;
  }
}

async function chooseCandidateOnce(
  provider: ReturnType<typeof resolveVisionProvider>,
  sendPaths: string[],
  opts: SelectionOpts,
): Promise<{ sel: CandidateSelection; vision: VisionResult } | null> {
  try {
    const vision = await runVision({
      provider,
      model: visionModel(provider),
      maxTokens: SELECTION_MAX_TOKENS,
      system: CANDIDATE_SYSTEM,
      prompt: candidatePrompt(opts, sendPaths.length),
      imagePaths: sendPaths,
      labels: sendPaths.map((_, i) => `Candidate ${i + 1}`),
    });
    const sel = parseCandidateSelection(vision.text);
    if (sel) return { sel, vision };
    console.warn('  ⚠ figure-vlm: unparseable candidate selection.');
  } catch (err) {
    console.warn(`  ⚠ figure-vlm: vision call failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return null;
}

// Timeout for fetching a single DOM candidate asset. Generous relative to the
// 30s preprocess.ts page-fetch timeout since these are typically small images.
const SNAPSHOT_FETCH_TIMEOUT_MS = 15_000;

/** Extracts the leading digits/decimal/letter run so "Figure 4" and "Fig. 4a" compare equal. */
function figureLabelKey(label: string): string | null {
  const m = label.match(/(\d+(?:\.\d+)?[a-z]?)/i);
  return m ? m[1].toLowerCase() : null;
}

function matchesNamedFigure(named: string, cand: FigureCandidate): boolean {
  const wanted = figureLabelKey(named);
  if (!wanted || !cand.sourceFigure) return false;
  // Match only the caption's parsed "Figure N" label (anchored at the caption
  // start), never a stray digit elsewhere in the text: otherwise pinning
  // "Figure 4" could latch onto a "Table 4" image or a caption that merely
  // mentions figure 4.
  return figureLabelKey(cand.sourceFigure) === wanted;
}

/**
 * DOM-native snapshot path: fetches each candidate's real `<img>` asset (no
 * Playwright, no rendered page) and either matches a pinned figure directly or
 * lets the vision model choose among the fetched assets. The asset is the
 * genuine caption-free image the page ships, so unlike the live paths this
 * skips `verifyCrop` and the confidence gate entirely — there is no crop to
 * verify. Returns null on any miss (fetch failure, no match, blank asset) so
 * the caller falls through to the live Playwright path.
 */
async function extractFromSnapshot(
  candidates: FigureCandidate[],
  provider: ReturnType<typeof resolveVisionProvider>,
  baseOpts: SelectionOpts,
  keepCrop: boolean,
): Promise<VlmFigureResult | null> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-vlm-snap-'));
  try {
    const fetched: Array<{ cand: FigureCandidate; sendPath: string; rawPath: string }> = [];
    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      try {
        const res = await fetch(cand.imgSrc, { signal: AbortSignal.timeout(SNAPSHOT_FETCH_TIMEOUT_MS) });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        const ext = path.extname(new URL(cand.imgSrc).pathname) || '.img';
        const rawPath = path.join(tmpDir, `snap-${i}${ext}`);
        fs.writeFileSync(rawPath, buf);
        if (looksBlank(rawPath)) continue;
        const sendPath = downscaleLongEdge(rawPath, CANDIDATE_SEND_PX, path.join(tmpDir, `snap-${i}-send.png`)) ?? rawPath;
        fetched.push({ cand, sendPath, rawPath });
      } catch {
        // 404s, timeouts, and non-image assets simply drop out of the candidate set.
      }
    }
    if (fetched.length === 0) return null;

    if (baseOpts.named) {
      const pinned = fetched.find(f => matchesNamedFigure(baseOpts.named!, f.cand));
      if (!pinned) return null;
      const src = encodeJpegDataUrl(pinned.sendPath);
      if (!src) return null;
      const label = baseOpts.named;
      return {
        src,
        source_figure: label,
        caption: pinned.cand.figcaption ?? `${label} from the source.`,
        alt_text: pinned.cand.alt ?? pinned.cand.figcaption ?? `${label} from the source.`,
        route: 'dom',
        provider: 'dom',
        cropPngBase64: cropBase64(pinned.rawPath, keepCrop),
      };
    }

    const chosen = await chooseCandidateOnce(provider, fetched.map(f => f.sendPath), baseOpts);
    if (!chosen || !chosen.sel.found) return null;
    const picked = fetched[chosen.sel.candidate - 1];
    if (!picked) return null;
    const src = encodeJpegDataUrl(picked.sendPath);
    if (!src) return null;
    const label = picked.cand.sourceFigure ?? chosen.sel.source_figure ?? 'Figure';
    return {
      src,
      source_figure: label,
      caption: picked.cand.figcaption ?? chosen.sel.caption ?? `${label} from the source.`,
      alt_text: picked.cand.alt ?? chosen.sel.alt_text ?? chosen.sel.caption ?? `${label} from the source.`,
      route: chosen.vision.route,
      provider: chosen.vision.provider,
      cropPngBase64: cropBase64(picked.rawPath, keepCrop),
    };
  } finally {
    cleanupTmp(tmpDir);
  }
}

async function extractFromUrl(url: string, provider: ReturnType<typeof resolveVisionProvider>, baseOpts: SelectionOpts, keepCrop: boolean): Promise<VlmFigureResult | null> {
  const pw = await loadPlaywright();
  if (!pw) return null;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-vlm-url-'));
  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1600 }, deviceScaleFactor: 2 });
    // Chromium occasionally aborts a navigation with ERR_NETWORK_IO_SUSPENDED
    // (transient OS network suspension). Retry a few times before giving up,
    // and fall back from networkidle to load on the final attempt.
    let navOk = false;
    for (let attempt = 1; attempt <= 3 && !navOk; attempt++) {
      try {
        await page.goto(url, { waitUntil: attempt < 3 ? 'networkidle' : 'load', timeout: 45_000 });
        navOk = true;
      } catch (err) {
        if (attempt === 3) throw err;
        await page.waitForTimeout(1500 * attempt);
      }
    }

    await renderReady(page);

    // Candidate-choose flow: screenshot each figure-like element and let the
    // model pick one by number. Element screenshots carry exact DOM bounds, so
    // there is no bounding-box regression at all on this path.
    const candidates = await markFigureCandidates(page).catch(() => [] as DomCandidate[]);
    const shots: Array<{ id: number; sendPath: string }> = [];
    for (const cand of candidates) {
      const shotPath = path.join(tmpDir, `cand-${cand.id}.png`);
      try {
        await page.locator(`[data-vlm-cand="${cand.id}"]`).first().screenshot({ path: shotPath, timeout: 10_000 });
        if (looksBlank(shotPath)) continue;
        const sendPath = downscaleLongEdge(shotPath, CANDIDATE_SEND_PX, path.join(tmpDir, `cand-${cand.id}-send.png`)) ?? shotPath;
        shots.push({ id: cand.id, sendPath });
      } catch {
        // Hidden or detached elements simply drop out of the candidate set.
      }
    }

    if (shots.length === 0) {
      console.warn('  ⚠ figure-vlm: no DOM figure candidates found; falling back to full-page selection.');
      return await extractFromFullPage(page, tmpDir, provider, baseOpts, keepCrop);
    }
    console.log(`  · figure-vlm: ${shots.length} figure candidate(s) on page.`);

    let prev: PreviousAttempt | undefined;
    for (let attempt = 1; attempt <= FIGURE_ATTEMPTS; attempt++) {
      const selected = await chooseCandidateOnce(provider, shots.map(s => s.sendPath), { ...baseOpts, prev });
      if (!selected) continue;
      const { sel, vision } = selected;
      if (!sel.found) {
        console.warn('  ⚠ figure-vlm: model found no suitable figure among candidates.');
        return null;
      }
      if (typeof sel.confidence === 'number' && sel.confidence < MIN_CONFIDENCE) {
        console.warn(`  ⚠ figure-vlm: low confidence ${sel.confidence.toFixed(2)}; dropping figure.`);
        return null;
      }
      // The model numbers candidates from its labels (1-based positions in the
      // sent set), so map position back to the element id.
      const chosen = shots[sel.candidate - 1];
      if (!chosen) {
        prev = { candidate: sel.candidate, source_figure: sel.source_figure, reason: 'that candidate number does not exist' };
        continue;
      }

      const cropPath = path.join(tmpDir, `crop-${attempt}.png`);
      await page.locator(`[data-vlm-cand="${chosen.id}"]`).first().screenshot({ path: cropPath, timeout: 15_000 });
      if (looksBlank(cropPath)) {
        console.warn(`  ⚠ figure-vlm: blank crop (attempt ${attempt}/${FIGURE_ATTEMPTS}).`);
        prev = { candidate: sel.candidate, source_figure: sel.source_figure, reason: 'the crop rendered blank' };
        continue;
      }
      const verdict = await verifyCrop(provider, cropPath);
      if (!verdict.ok) {
        console.warn(`  ⚠ figure-vlm: crop failed verification (${verdict.reason}); retrying selection.`);
        prev = { candidate: sel.candidate, source_figure: sel.source_figure, reason: `the crop failed verification: ${verdict.reason}` };
        continue;
      }
      const src = encodeJpegDataUrl(cropPath);
      if (!src) continue;
      console.log(`  · figure-vlm: candidate ${sel.candidate} chosen, cropped to element bounds.`);
      const label = baseOpts.named ?? sel.source_figure ?? 'Figure';
      return {
        src,
        source_figure: label,
        caption: sel.caption ?? `${label} from the source.`,
        alt_text: sel.alt_text ?? sel.caption ?? `${label} from the source.`,
        route: vision.route,
        provider: vision.provider,
        cropPngBase64: cropBase64(cropPath, keepCrop),
      };
    }
    console.warn('  ⚠ figure-vlm: no usable figure after retries.');
    return null;
  } catch (err) {
    console.warn(`  ⚠ figure-vlm: URL render failed — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    await browser.close().catch(() => undefined);
    cleanupTmp(tmpDir);
  }
}

// Fallback tiling: page segments stay under the vision size cap so the model
// sees them at full width instead of a provider-side shrink of the whole page.
// 1150 CSS px at deviceScaleFactor 2 is ~2300 device px, inside the 2500 cap.
const TILE_HEIGHT_CSS = 1150;
const MAX_TILES = 10;

/**
 * Fallback for pages with no figure-like DOM elements: tile the page into
 * viewport-width segments, ask for a page/bbox selection over the labelled
 * tiles, and map the bbox back through the tile offset before cropping.
 */
async function extractFromFullPage(
  page: import('playwright').Page,
  tmpDir: string,
  provider: ReturnType<typeof resolveVisionProvider>,
  baseOpts: SelectionOpts,
  keepCrop: boolean,
): Promise<VlmFigureResult | null> {
  const fullPath = path.join(tmpDir, 'full.png');
  await page.screenshot({ path: fullPath, fullPage: true });
  // Full-page screenshot pixel size divided by deviceScaleFactor gives CSS px.
  const px = pngSizePx(fullPath);
  if (!px) {
    console.warn('  ⚠ figure-vlm: could not read screenshot dimensions.');
    return null;
  }
  const dims = { w: px.w / 2, h: px.h / 2 };

  // Grow the viewport to the full content height (capped at Chromium's max
  // texture size) so any clip on the page is reachable, then clamp to bounds.
  const MAX_DIM = 16384;
  const vw = Math.min(Math.max(Math.ceil(dims.w), 320), MAX_DIM);
  const vh = Math.min(Math.max(Math.ceil(dims.h), 320), MAX_DIM);
  await page.setViewportSize({ width: vw, height: vh });

  const tiles: Array<{ path: string; top: number; h: number }> = [];
  for (let top = 0, i = 0; top < dims.h && i < MAX_TILES; top += TILE_HEIGHT_CSS, i++) {
    const h = Math.min(TILE_HEIGHT_CSS, dims.h - top);
    if (h < 40) break;
    const tilePath = path.join(tmpDir, `tile-${i + 1}.png`);
    await page.screenshot({ path: tilePath, clip: { x: 0, y: top, width: dims.w, height: h } });
    tiles.push({ path: tilePath, top, h });
  }
  if (tiles.length === 0) return null;
  if (dims.h > MAX_TILES * TILE_HEIGHT_CSS) {
    console.warn(`  ⚠ figure-vlm: page taller than ${MAX_TILES} tiles; ignoring content below ${MAX_TILES * TILE_HEIGHT_CSS}px.`);
  }
  const labels = tiles.map((_, i) => `Page ${i + 1} of ${tiles.length}`);

  let prev: PreviousAttempt | undefined;
  for (let attempt = 1; attempt <= FIGURE_ATTEMPTS; attempt++) {
    const selected = await selectFigureOnce(provider, tiles.map(t => t.path), labels, { ...baseOpts, prev });
    if (!selected) continue;
    const { sel, vision } = selected;
    if (!sel.found) {
      console.warn('  ⚠ figure-vlm: model found no suitable figure on page.');
      return null;
    }
    if (typeof sel.confidence === 'number' && sel.confidence < MIN_CONFIDENCE) {
      console.warn(`  ⚠ figure-vlm: low confidence ${sel.confidence.toFixed(2)}; dropping figure.`);
      return null;
    }

    const tile = tiles[Math.min(Math.max(sel.page, 1), tiles.length) - 1];
    const tileRect = bboxToRect(sel.bbox, { w: dims.w, h: tile.h });
    const vlmRect = { ...tileRect, y: tileRect.y + tile.top };
    // Snap the imprecise VLM bbox to the nearest real figure element so the
    // crop clips to actual element bounds; fall back to the padded VLM box.
    const snapped = await snapToFigureElement(page, vlmRect).catch(() => null);
    const targetRect = snapped ?? padRect(vlmRect, dims);
    const clip = clampClip(targetRect, dims, MAX_DIM);
    const cropPath = path.join(tmpDir, `crop-${attempt}.png`);
    await page.screenshot({ path: cropPath, clip });

    if (looksBlank(cropPath)) {
      console.warn(`  ⚠ figure-vlm: blank crop (attempt ${attempt}/${FIGURE_ATTEMPTS}).`);
      prev = { page: sel.page, source_figure: sel.source_figure, bbox: sel.bbox, reason: 'the crop rendered blank' };
      continue;
    }
    const verdict = await verifyCrop(provider, cropPath);
    if (!verdict.ok) {
      console.warn(`  ⚠ figure-vlm: crop failed verification (${verdict.reason}); retrying selection.`);
      prev = { page: sel.page, source_figure: sel.source_figure, bbox: sel.bbox, reason: `the crop failed verification: ${verdict.reason}` };
      continue;
    }
    const src = encodeJpegDataUrl(cropPath);
    if (!src) continue;
    console.log(`  · figure-vlm: crop ${snapped ? 'snapped to DOM element' : 'used model bbox (no element match)'}`);
    const label = baseOpts.named ?? sel.source_figure ?? 'Figure';
    return {
      src,
      source_figure: label,
      caption: sel.caption ?? `${label} from the source.`,
      alt_text: sel.alt_text ?? sel.caption ?? `${label} from the source.`,
      route: vision.route,
      provider: vision.provider,
      cropPngBase64: cropBase64(cropPath, keepCrop),
    };
  }
  console.warn('  ⚠ figure-vlm: no usable figure after retries.');
  return null;
}

export interface VlmFigureInput {
  pdfPath?: string | null;
  url?: string | null;
  override?: ImageOverride;
  context?: FigureContext;
  /** Persisted DOM figure candidates from preprocess, enabling the no-Playwright snapshot path. */
  snapshotCandidates?: FigureCandidate[];
  /** Include the full-resolution crop PNG in the result (for the figure-data recreation pass). */
  keepCropPng?: boolean;
}

/**
 * Top-level entry. Returns a populated figure (src + metadata) or null when no
 * usable figure is found / vision is unconfigured. Never throws — callers treat
 * null as "drop the image block".
 */
export async function extractFigureViaVlm(input: VlmFigureInput): Promise<VlmFigureResult | null> {
  if (!visionAuthAvailable()) {
    console.warn('  ⚠ figure-vlm: no vision auth configured — skipping figure extraction.');
    return null;
  }
  const provider = resolveVisionProvider();
  const opts: SelectionOpts = {
    named: input.override?.source_figure,
    context: input.context,
    pageHint: input.override?.pageHint,
  };
  const keepCrop = Boolean(input.keepCropPng);
  try {
    if (input.pdfPath && fs.existsSync(input.pdfPath)) {
      return await extractFromPdf(input.pdfPath, provider, opts, keepCrop);
    }
    if (input.url) {
      if (input.snapshotCandidates?.length) {
        const snapshot = await extractFromSnapshot(input.snapshotCandidates, provider, opts, keepCrop);
        if (snapshot) return snapshot;
      }
      return await extractFromUrl(input.url, provider, opts, keepCrop);
    }
  } catch (err) {
    console.warn(`  ⚠ figure-vlm: extraction failed — ${err instanceof Error ? err.message : String(err)}`);
  }
  return null;
}
