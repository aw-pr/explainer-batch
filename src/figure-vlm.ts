import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { runVision, resolveVisionProvider, visionAuthAvailable, cleanupTmp, type VisionResult } from './vision';
import { getModelConfig } from './model-config';

/** Subset of the focus-sidecar image override consumed here (mirrors preprocess.ImageOverride). */
export interface ImageOverride {
  source_figure: string;
  caption?: string;
  alt_text?: string;
  pageHint?: number;
}

/**
 * Vision-driven figure extraction. Replaces the deterministic
 * caption/gap-finder: render the whole document to page images, let a
 * vision model choose the single most useful figure and return its
 * bounding box, then crop sharply from the source render.
 *
 * Two input modes:
 *   - PDF  → `pdftoppm` thumbnails for selection, high-DPI crop for output.
 *   - URL  → Playwright full-page screenshot for selection, clipped
 *            re-screenshot for output (lazy import; only loaded for URLs).
 */

export interface VlmFigureResult {
  /** `data:image/jpeg;base64,...` ready for the renderer. */
  src: string;
  source_figure: string;
  caption: string;
  alt_text: string;
  /** Diagnostics. */
  route: VisionResult['route'];
  provider: VisionResult['provider'];
  page?: number;
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
// trades size for fidelity. Larger = sharper but heavier in the JSON.
const CROP_DPI = envNum('FIGURE_VLM_DPI', 150);
const MAX_IMAGE_PX = envNum('FIGURE_VLM_MAX_PX', 1600);
const JPEG_QUALITY = envNum('FIGURE_VLM_JPEG_QUALITY', 85);
// Fractional padding added around the model bbox so a slightly-tight box doesn't
// clip the figure's outer labels (raised from 0.012 after a clipped diagram).
const CROP_PAD = envNum('FIGURE_VLM_PAD', 0.022);

const SELECTION_SYSTEM =
  'You are a figure-selection assistant for a research-explainer pipeline. You ' +
  'are shown page images of a single source document, one image per page, in ' +
  'order. Identify the single most useful figure to illustrate a lay-audience ' +
  'explainer: a diagram, chart, schematic, or visual abstract that conveys the ' +
  "paper's core idea or headline result. Avoid pages that are pure prose, " +
  'reference lists, equations, or dense tables. Reply with ONLY a JSON object.';

function selectionPrompt(named?: string): string {
  const target = named
    ? `The explainer requires a specific figure: "${named}". Locate exactly that figure.`
    : 'No specific figure was requested — choose the one figure that best illustrates the work.';
  return [
    target,
    '',
    'Return ONLY this JSON (no prose, no code fence):',
    '{',
    '  "found": <true|false>,',
    '  "page": <1-based index of the page image containing the figure>,',
    '  "bbox": [x0, y0, x1, y1],   // normalized 0..1 within that page image; tight around the figure BODY, excluding its caption text',
    '  "source_figure": "<e.g. Figure 3, or a short label if unnumbered>",',
    '  "caption": "<one-sentence plain caption>",',
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

/**
 * One figure-selection vision call. The caller owns the retry loop so a retry
 * can be triggered by a transport failure, an unparseable reply, OR a blank/
 * uncroppable result. When `avoidPrevious` is set the prompt steers the model
 * to a different, clearly-rendered figure than the one that just failed.
 */
async function selectFigureOnce(
  provider: ReturnType<typeof resolveVisionProvider>,
  imagePaths: string[],
  named: string | undefined,
  avoidPrevious: boolean,
): Promise<{ sel: FigureSelection; vision: VisionResult } | null> {
  const model = process.env.FIGURE_VLM_MODEL ?? getModelConfig(provider).batchModel;
  let prompt = selectionPrompt(named);
  if (avoidPrevious) {
    prompt += '\n\nThe figure chosen previously rendered blank or could not be cropped. ' +
      'Pick a DIFFERENT figure that is clearly rendered with visible content; avoid ' +
      'interactive/animated charts that may not have painted, and avoid empty regions.';
  }
  try {
    const vision = await runVision({
      provider, model, maxTokens: SELECTION_MAX_TOKENS, system: SELECTION_SYSTEM, prompt, imagePaths,
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
 */
const BLANK_BYTES_PER_PIXEL = 0.02;
function looksBlank(pngPath: string): boolean {
  try {
    const px = pngSizePx(pngPath);
    if (!px || px.w * px.h === 0) return false;
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

interface DomRect { x: number; y: number; w: number; h: number; container: boolean; }

/**
 * Snaps the (imprecise) VLM bounding box to a real figure element so the crop
 * clips to actual element bounds instead of swallowing neighbouring body text.
 * Scores candidates by overlap with the VLM box, with a bonus for figure-like
 * containers and for containing the box centre. Returns null when nothing fits
 * (caller falls back to the padded VLM box).
 */
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
      const cls = (el.getAttribute('class') || '').toLowerCase();
      const tag = el.tagName.toLowerCase();
      out.push({
        x: r.left + (win.scrollX || 0),
        y: r.top + (win.scrollY || 0),
        w: r.width,
        h: r.height,
        container: tag === 'figure' || tag === 'picture' || /chart|figure|graph|card/.test(cls),
      });
    });
    return out;
  });

  if (!cands || cands.length === 0) return null;
  const cx = vlmRect.x + vlmRect.w / 2;
  const cy = vlmRect.y + vlmRect.h / 2;
  let best: DomRect | null = null;
  let bestScore = 0;
  for (const c of cands) {
    const holds = cx >= c.x && cx <= c.x + c.w && cy >= c.y && cy <= c.y + c.h;
    const score = intersectionOverUnion(vlmRect, c) + (c.container ? 0.15 : 0) + (holds ? 0.1 : 0);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (!best || bestScore < 0.2) return null;
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

/** Crop the chosen PDF page to the (normalized) bbox at high DPI and return a JPEG data URL. */
function cropPdfBbox(pdfPath: string, page: number, bbox: [number, number, number, number]): string | null {
  const size = pageSizePts(pdfPath);
  if (!size) return null;
  const [x0, y0, x1, y1] = padBbox(bbox);
  const ptsToPx = CROP_DPI / 72;
  const xPx = Math.max(0, Math.floor(x0 * size.w * ptsToPx));
  const yPx = Math.max(0, Math.floor(y0 * size.h * ptsToPx));
  const wPx = Math.ceil((x1 - x0) * size.w * ptsToPx);
  const hPx = Math.ceil((y1 - y0) * size.h * ptsToPx);
  if (wPx <= 4 || hPx <= 4) return null;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-vlm-crop-'));
  const prefix = path.join(tmpDir, 'crop');
  try {
    const result = spawnSync(
      'pdftoppm',
      ['-png', '-r', String(CROP_DPI), '-f', String(page), '-l', String(page),
        '-x', String(xPx), '-y', String(yPx), '-W', String(wPx), '-H', String(hPx), pdfPath, prefix],
      { encoding: 'utf8' },
    );
    if (result.error || result.status !== 0) return null;
    const png = fs.readdirSync(tmpDir).filter(f => f.endsWith('.png')).map(f => path.join(tmpDir, f))[0];
    if (!png || looksBlank(png)) return null;
    return encodeJpegDataUrl(png);
  } finally {
    cleanupTmp(tmpDir);
  }
}

async function extractFromPdf(pdfPath: string, named: string | undefined, provider: ReturnType<typeof resolveVisionProvider>): Promise<VlmFigureResult | null> {
  const total = pageCount(pdfPath);
  const lastPage = Math.min(total ?? MAX_PAGES, MAX_PAGES);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-vlm-pages-'));
  try {
    const thumbs = renderPdfThumbnails(pdfPath, tmpDir, lastPage);
    if (thumbs.length === 0) {
      console.warn('  ⚠ figure-vlm: page render produced no images.');
      return null;
    }

    for (let attempt = 1; attempt <= FIGURE_ATTEMPTS; attempt++) {
      const selected = await selectFigureOnce(provider, thumbs, named, attempt > 1);
      if (!selected) continue;
      const { sel, vision } = selected;
      if (!sel.found) {
        console.warn('  ⚠ figure-vlm: model found no suitable figure.');
        return null;
      }
      if (typeof sel.confidence === 'number' && sel.confidence < MIN_CONFIDENCE) {
        console.warn(`  ⚠ figure-vlm: low confidence ${sel.confidence.toFixed(2)} — dropping figure.`);
        return null;
      }
      const page = Math.min(Math.max(sel.page, 1), thumbs.length);
      const src = cropPdfBbox(pdfPath, page, sel.bbox);
      if (!src) {
        console.warn(`  ⚠ figure-vlm: crop failed/blank (attempt ${attempt}/${FIGURE_ATTEMPTS}).`);
        continue;
      }
      const label = named ?? sel.source_figure ?? 'Figure';
      return {
        src,
        source_figure: label,
        caption: sel.caption ?? `${label} from the source paper.`,
        alt_text: sel.alt_text ?? sel.caption ?? `${label} from the source paper.`,
        route: vision.route,
        provider: vision.provider,
        page,
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

async function extractFromUrl(url: string, named: string | undefined, provider: ReturnType<typeof resolveVisionProvider>): Promise<VlmFigureResult | null> {
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

    const fullPath = path.join(tmpDir, 'full.png');
    await page.screenshot({ path: fullPath, fullPage: true });
    // Full-page screenshot pixel size ÷ deviceScaleFactor → CSS px for the clip.
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

    for (let attempt = 1; attempt <= FIGURE_ATTEMPTS; attempt++) {
      const selected = await selectFigureOnce(provider, [fullPath], named, attempt > 1);
      if (!selected) continue;
      const { sel, vision } = selected;
      if (!sel.found) {
        console.warn('  ⚠ figure-vlm: model found no suitable figure on page.');
        return null;
      }
      if (typeof sel.confidence === 'number' && sel.confidence < MIN_CONFIDENCE) {
        console.warn(`  ⚠ figure-vlm: low confidence ${sel.confidence.toFixed(2)} — dropping figure.`);
        return null;
      }

      // Snap the imprecise VLM bbox to the nearest real figure element so the
      // crop clips to actual element bounds; fall back to the padded VLM box.
      const vlmRect = bboxToRect(sel.bbox, dims);
      const snapped = await snapToFigureElement(page, vlmRect).catch(() => null);
      const targetRect = snapped ?? padRect(vlmRect, dims);
      const clip = clampClip(targetRect, dims, MAX_DIM);
      const cropPath = path.join(tmpDir, `crop-${attempt}.png`);
      await page.screenshot({ path: cropPath, clip });

      if (looksBlank(cropPath)) {
        console.warn(`  ⚠ figure-vlm: blank crop (attempt ${attempt}/${FIGURE_ATTEMPTS}).`);
        continue;
      }
      const src = encodeJpegDataUrl(cropPath);
      if (!src) continue;
      console.log(`  · figure-vlm: crop ${snapped ? 'snapped to DOM element' : 'used model bbox (no element match)'}`);
      const label = named ?? sel.source_figure ?? 'Figure';
      return {
        src,
        source_figure: label,
        caption: sel.caption ?? `${label} from the source.`,
        alt_text: sel.alt_text ?? sel.caption ?? `${label} from the source.`,
        route: vision.route,
        provider: vision.provider,
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

export interface VlmFigureInput {
  pdfPath?: string | null;
  url?: string | null;
  override?: ImageOverride;
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
  const named = input.override?.source_figure;
  try {
    if (input.pdfPath && fs.existsSync(input.pdfPath)) {
      return await extractFromPdf(input.pdfPath, named, provider);
    }
    if (input.url) {
      return await extractFromUrl(input.url, named, provider);
    }
  } catch (err) {
    console.warn(`  ⚠ figure-vlm: extraction failed — ${err instanceof Error ? err.message : String(err)}`);
  }
  return null;
}
