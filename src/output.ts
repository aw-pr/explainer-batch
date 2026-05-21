import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import type { ExplainerChart, ExplainerJson } from './types/explainer-json';
import { extractFigureAsDataUrl, deriveFigureCrop } from './figure-extract';
import { readState } from './state';

const ROOT_DIR = path.join(__dirname, '..');

/**
 * Where source PDFs / urls.txt / focus sidecars are read from. Defaults to
 * `<repo>/input`; override with EXPLAINER_INPUT_DIR (e.g. an Obsidian/Dropbox
 * folder) to keep inputs and outputs together outside the repo.
 */
export const INPUT_DIR = process.env.EXPLAINER_INPUT_DIR
  ? path.resolve(process.env.EXPLAINER_INPUT_DIR)
  : path.join(ROOT_DIR, 'input');

/**
 * Where generated explainers are written. Defaults to `<repo>/output`;
 * override with EXPLAINER_OUTPUT_DIR for any other environment.
 */
export const OUTPUT_DIR = process.env.EXPLAINER_OUTPUT_DIR
  ? path.resolve(process.env.EXPLAINER_OUTPUT_DIR)
  : path.join(ROOT_DIR, 'output');

/**
 * Optional integration with the consuming website repo. Only active when
 * WEBSITE_REPO points at a checkout of that repo; otherwise null and all
 * staging / website-HTML steps are skipped. The core pipeline never requires it.
 */
export const WEBSITE_REPO_ROOT: string | null = process.env.WEBSITE_REPO
  ? path.resolve(process.env.WEBSITE_REPO)
  : null;
export const WEBSITE_STAGING_DIR: string | null = WEBSITE_REPO_ROOT
  ? path.join(WEBSITE_REPO_ROOT, 'explainers-new')
  : null;

export interface SaveResult {
  jsonFile: string;
  jsonPath: string;
  /** null when WEBSITE_REPO is not configured (staging skipped). */
  stagedJsonPath: string | null;
}

/**
 * Extracts a JSON object from raw model output.
 * Handles:
 *   1. Clean JSON object starting with `{`             — ideal
 *   2. ```json\n{...}\n```                             — strip fences
 *   3. Preamble text before the first `{`             — slice from first `{`
 */
export function extractJson(raw: string): unknown {
  // Strip code fences if present
  const fenceMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/i);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1]);
  }

  // Find the first `{` and last `}` — handles preamble text
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return JSON.parse(raw.slice(start, end + 1));
  }

  // Last resort — attempt to parse the whole string
  return JSON.parse(raw.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeChartEntry(chart: ExplainerChart | Record<string, unknown>): ExplainerChart {
  const normalized = chart as ExplainerChart;
  if (normalized.config_json && !normalized.config_raw) {
    normalized.config_raw = JSON.stringify(normalized.config_json);
  }
  return normalized;
}

/**
 * Reverses preprocess.ts's customId derivation to find the source PDF.
 * Returns null for URL-sourced explainers or when no matching PDF exists
 * (e.g. the input file was removed after the batch was submitted).
 */
function resolveSourcePdf(customId: string): string | null {
  if (customId.startsWith('explainer-url-')) return null;
  const target = customId.replace(/^explainer-/, '');
  if (!fs.existsSync(INPUT_DIR)) return null;

  const candidates = fs.readdirSync(INPUT_DIR).filter(f => f.toLowerCase().endsWith('.pdf'));
  for (const filename of candidates) {
    const stem = filename.replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64 - 'explainer-'.length);
    if (stem === target) return path.join(INPUT_DIR, filename);
  }
  return null;
}

function lookupImageOverride(customId: string): { source_figure: string; caption?: string; alt_text?: string; pageHint?: number } | undefined {
  try {
    const state = readState();
    for (const batch of state.batches) {
      const req = batch.requests[customId];
      if (req?.imageOverride) return req.imageOverride;
    }
  } catch { /* ignore */ }
  return undefined;
}

interface CropRect { xMin: number; yMin: number; xMax: number; yMax: number; }
interface BboxWord { xMin: number; yMin: number; xMax: number; yMax: number; text: string; }
interface PageBbox { width: number; height: number; words: BboxWord[]; }

function parseBboxLayout(pdfPath: string, page: number): PageBbox | null {
  const result = spawnSync(
    'pdftotext',
    ['-bbox-layout', '-f', String(page), '-l', String(page), pdfPath, '-'],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0) return null;
  const pageMatch = result.stdout.match(/<page[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/);
  if (!pageMatch) return null;
  const width = parseFloat(pageMatch[1]);
  const height = parseFloat(pageMatch[2]);
  if (!(width > 0) || !(height > 0)) return null;

  const wordPattern = /<word[^>]*xMin="([\d.]+)"[^>]*yMin="([\d.]+)"[^>]*xMax="([\d.]+)"[^>]*yMax="([\d.]+)"[^>]*>([^<]*)<\/word>/g;
  const words: BboxWord[] = [];
  let m: RegExpExecArray | null;
  while ((m = wordPattern.exec(result.stdout)) !== null) {
    words.push({
      xMin: parseFloat(m[1]),
      yMin: parseFloat(m[2]),
      xMax: parseFloat(m[3]),
      yMax: parseFloat(m[4]),
      text: m[5].trim(),
    });
  }
  return { width, height, words };
}

function textDensityInCrop(bbox: PageBbox, crop: CropRect): number {
  const cropArea = (crop.xMax - crop.xMin) * (crop.yMax - crop.yMin);
  if (!(cropArea > 0)) return 0;
  let textArea = 0;
  for (const w of bbox.words) {
    const ix0 = Math.max(crop.xMin, w.xMin);
    const iy0 = Math.max(crop.yMin, w.yMin);
    const ix1 = Math.min(crop.xMax, w.xMax);
    const iy1 = Math.min(crop.yMax, w.yMax);
    if (ix1 > ix0 && iy1 > iy0) textArea += (ix1 - ix0) * (iy1 - iy0);
  }
  return textArea / cropArea;
}

// 0.30 is permissive; audit suggested 0.25. Tune downward if text-prose crops slip through.
const FIGURE_TEXT_DENSITY_THRESHOLD = 0.30;

/**
 * Returns true if the crop is mostly text (likely body prose, not a figure)
 * and the caller should drop `json.image`. Returns false when the gate cannot
 * be evaluated (no PDF, tier 1 embedded raster, or no derivable crop bbox).
 *
 * Both gate and extraction consume `deriveFigureCrop` so they evaluate the
 * same {page, cropPts} — no split-brain geometry.
 */
function cropIsMostlyText(pdfPath: string, figureLabel: string, customId: string, pageHint?: number): boolean {
  const derived = deriveFigureCrop(pdfPath, figureLabel, { pageHint });
  if (!derived) return false;
  if (derived.tier === 'embedded') return false;

  const bbox = parseBboxLayout(pdfPath, derived.page);
  if (!bbox) return false;

  const ratio = textDensityInCrop(bbox, derived.cropPts);
  if (ratio > FIGURE_TEXT_DENSITY_THRESHOLD) {
    console.warn(
      `  ⚠ ${customId} p.${derived.page} ${figureLabel}: text density ${ratio.toFixed(2)} > ${FIGURE_TEXT_DENSITY_THRESHOLD.toFixed(2)} — dropping image block.`,
    );
    return true;
  }
  return false;
}

function attachFigureImage(json: ExplainerJson, customId: string): void {
  const override = lookupImageOverride(customId);

  // Directive-only: the image block is supplied externally via .focus.md, never
  // by the model. Empirically the model cannot reliably pick a figure from a
  // PDF document block, so we drop anything it emits and only attach when a
  // sidecar override exists.
  if (!override) {
    if (json.image) delete json.image;
    return;
  }

  const existing = json.image;
  json.image = {
    ...(existing ?? {}),
    source_figure: override.source_figure,
    caption: override.caption ?? existing?.caption ?? `${override.source_figure} from the source paper.`,
    alt_text: override.alt_text ?? existing?.alt_text ?? `${override.source_figure} from the source paper.`,
  };

  const image = json.image;
  if (!image.source_figure) return;
  if (image.src) return; // already populated

  const pdfPath = resolveSourcePdf(customId);
  if (!pdfPath) {
    console.warn(`  ⚠ ${customId}: no local PDF found for figure extraction — dropping image block.`);
    delete json.image;
    return;
  }

  const dataUrl = extractFigureAsDataUrl(pdfPath, image.source_figure, { pageHint: override?.pageHint });
  if (!dataUrl) {
    console.warn(`  ⚠ ${customId}: could not locate ${image.source_figure} in PDF — dropping image block.`);
    delete json.image;
    return;
  }

  // Text-density gate: drop the image if the crop is mostly body prose.
  // Bypassed when the user supplied an explicit override (we trust them) or
  // when no crop bbox is derivable (tier-1 embedded raster, unclear layout).
  // Gate measures the same region extraction will crop (via deriveFigureCrop).
  if (!override && cropIsMostlyText(pdfPath, image.source_figure, customId)) {
    delete json.image;
    return;
  }

  image.src = dataUrl;
}

/** Strip HTML tags + decode common entities. Used to derive plain-text fields from *_html variants. */
function htmlToPlain(s: string): string {
  return String(s ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Conform model output to the canonical schema. Opus consistently emits
 * `paragraphs_html` without `paragraphs`, and `end_takeaway.heading/body_html`
 * instead of `label/body`. We derive the missing fields rather than fail
 * validation or render blank blocks.
 */
export function normalizeSchemaDrift(json: ExplainerJson): void {
  if (Array.isArray(json.sections)) {
    for (const section of json.sections) {
      const s = section as unknown as Record<string, unknown>;
      if (!Array.isArray(s.paragraphs) && Array.isArray(s.paragraphs_html)) {
        s.paragraphs = (s.paragraphs_html as string[]).map(htmlToPlain);
      }
    }
  }

  const et = json.end_takeaway as unknown as Record<string, unknown> | undefined;
  if (et) {
    if (typeof et.label !== 'string' && typeof et.heading === 'string') {
      et.label = et.heading;
      delete et.heading;
    }
    if (typeof et.body !== 'string' && typeof et.body_html === 'string') {
      et.body = htmlToPlain(et.body_html as string);
    }
    // Opus sometimes emits paragraphs_html on end_takeaway instead of body_html
    if (typeof et.body !== 'string' && Array.isArray(et.paragraphs_html)) {
      et.body = (et.paragraphs_html as string[]).map(htmlToPlain).join(' ');
    }
  }
}

function normalizeExplainerJson(json: ExplainerJson): ExplainerJson {
  normalizeSchemaDrift(json);
  const legacyChart = isRecord(json.chart) ? normalizeChartEntry(json.chart) : undefined;
  const charts = Array.isArray(json.charts)
    ? json.charts
        .filter((entry) => isRecord(entry))
        .map((entry) => normalizeChartEntry(entry))
    : [];

  const normalizedCharts = charts.length > 0
    ? charts.slice(0, 3)
    : legacyChart
      ? [legacyChart]
      : [];

  json.charts = normalizedCharts.length > 0 ? normalizedCharts : undefined;
  json.chart = normalizedCharts[0] ?? legacyChart;

  return json;
}

/**
 * Derives the output filename from the JSON metadata,
 * falling back to the custom_id slug if unavailable.
 */
function deriveFilename(customId: string, json: ExplainerJson | null): string {
  const today = new Date().toISOString().slice(0, 10);

  if (json?.metadata?.filename_slug) {
    const slug = json.metadata.filename_slug.replace(/\.json$/, '');
    return `${slug}.json`;
  }

  // Fallback: use the custom_id slug
  const slug = customId.replace(/^explainer-(?:url-)?/, '').slice(0, 50);
  return `${today}_${slug}_explainer.json`;
}

export async function saveResult(customId: string, rawText: string): Promise<SaveResult> {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let json: ExplainerJson | null = null;
  try {
    const parsed = extractJson(rawText);
    json = normalizeExplainerJson(parsed as ExplainerJson);
    attachFigureImage(json, customId);
  } catch {
    // Non-parseable output — save the raw text as a .txt for inspection
    const slug = customId.replace(/^explainer-(?:url-)?/, '').slice(0, 50);
    const errFile = path.join(OUTPUT_DIR, `${new Date().toISOString().slice(0, 10)}_${slug}_error.txt`);
    fs.writeFileSync(errFile, rawText, 'utf8');
    throw new Error(`JSON parse failed — raw output saved to ${path.basename(errFile)}`);
  }

  const filename = deriveFilename(customId, json);
  const outPath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(outPath, JSON.stringify(json, null, 2), 'utf8');

  // Stage into the consuming website repo only when it is configured.
  let stagedPath: string | null = null;
  if (WEBSITE_STAGING_DIR) {
    fs.mkdirSync(WEBSITE_STAGING_DIR, { recursive: true });
    stagedPath = path.join(WEBSITE_STAGING_DIR, filename);
    fs.copyFileSync(outPath, stagedPath);
  }

  return {
    jsonFile: filename,
    jsonPath: outPath,
    stagedJsonPath: stagedPath,
  };
}
