import fs from 'fs';
import path from 'path';
import type { ExplainerChart, ExplainerJson } from './types/explainer-json';
import { extractFigureAsDataUrl } from './figure-extract';
import { readState } from './state';

const ROOT_DIR = path.join(__dirname, '..');
const INPUT_DIR = path.join(ROOT_DIR, 'input');

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

function lookupImageOverride(customId: string): { source_figure: string; caption?: string; alt_text?: string } | undefined {
  try {
    const state = readState();
    for (const batch of state.batches) {
      const req = batch.requests[customId];
      if (req?.imageOverride) return req.imageOverride;
    }
  } catch { /* ignore */ }
  return undefined;
}

function attachFigureImage(json: ExplainerJson, customId: string): void {
  const override = lookupImageOverride(customId);
  if (override) {
    const existing = json.image;
    json.image = {
      ...(existing ?? {}),
      source_figure: override.source_figure,
      caption: override.caption ?? existing?.caption ?? `${override.source_figure} from the source paper.`,
      alt_text: override.alt_text ?? existing?.alt_text ?? `${override.source_figure} from the source paper.`,
    };
  }

  const image = json.image;
  if (!image || !image.source_figure) return;
  if (image.src) return; // already populated

  const pdfPath = resolveSourcePdf(customId);
  if (!pdfPath) {
    console.warn(`  ⚠ ${customId}: no local PDF found for figure extraction — dropping image block.`);
    delete json.image;
    return;
  }

  const dataUrl = extractFigureAsDataUrl(pdfPath, image.source_figure);
  if (!dataUrl) {
    console.warn(`  ⚠ ${customId}: could not locate ${image.source_figure} in PDF — dropping image block.`);
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
function normalizeSchemaDrift(json: ExplainerJson): void {
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
