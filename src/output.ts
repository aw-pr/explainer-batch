import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ExplainerChart, ExplainerJson } from './types/explainer-json';
import { extractFigureViaVlm, contextFromExplainer } from './figure-vlm';
import { readState, type FigureCandidate } from './state';
import { htmlToPlain } from './text';
import { loadDotEnv } from './env';

// Fill-only .env load must run before the path consts below read process.env.
// These are evaluated at import time, and every entry point (index.ts and the
// standalone scripts) imports this module — so loading here guarantees
// .env.local values (WEBSITE_REPO, EXPLAINER_*_DIR) are present regardless of
// import order. Without this, a .env.local-only WEBSITE_REPO is read too late
// and silently disables website staging + HTML sidecar export.
loadDotEnv();

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

/**
 * Always-on mirror for generated explainers into a local knowledge base (an
 * Obsidian vault by default). Independent of OUTPUT_DIR and the optional
 * WEBSITE_REPO staging copy, so a saved explainer lands in every configured
 * destination at once. Defaults to `~/obsidian/explainers`; override the
 * location with EXPLAINER_OBSIDIAN_DIR, or set it to an empty string to turn
 * the mirror off.
 */
export const OBSIDIAN_MIRROR_DIR: string | null = (() => {
  const raw = process.env.EXPLAINER_OBSIDIAN_DIR;
  if (raw === '') return null;
  if (raw) return path.resolve(raw);
  return path.join(os.homedir(), 'obsidian', 'explainers');
})();

export interface SaveResult {
  jsonFile: string;
  jsonPath: string;
  /** null when WEBSITE_REPO is not configured (staging skipped). */
  stagedJsonPath: string | null;
  /** null when the Obsidian mirror is disabled (EXPLAINER_OBSIDIAN_DIR=""). */
  mirroredJsonPath: string | null;
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

/**
 * OpenAI's strict structured-output subset requires config_json to be a
 * string (a stringified Chart.js config); parse it back to an object here so
 * the saved artifact matches the website's `config_json: unknown | null`
 * contract regardless of which route produced it. Parse failures are left
 * as-is (still a string) so the validator/repair path can catch them.
 */
function parseStringifiedConfigJson(chart: Record<string, unknown>): void {
  if (typeof chart.config_json === 'string') {
    try {
      chart.config_json = JSON.parse(chart.config_json);
    } catch {
      // leave as-is; malformed config_json falls through to validation/repair
    }
  }
}

function normalizeChartEntry(chart: ExplainerChart | Record<string, unknown>): ExplainerChart {
  const normalized = chart as ExplainerChart;
  parseStringifiedConfigJson(normalized as unknown as Record<string, unknown>);
  if (normalized.config_json && !normalized.config_raw) {
    normalized.config_raw = JSON.stringify(normalized.config_json);
  }
  return normalized;
}

/**
 * Deletes explicit `null` values recursively so a schema-enforced route's
 * nullable-optional fields (e.g. `image: null`, `end_takeaway: null`,
 * `paragraphs_html: null`) come out looking like an absent field, matching
 * what non-enforced routes have always produced. `config_json` is left
 * untouched — a Chart.js config may legitimately contain nulls (and the type
 * itself allows `config_json: unknown | null` to signal "see config_raw
 * instead"), so recursion does not descend into it.
 */
function stripSchemaNulls(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) stripSchemaNulls(entry);
    return;
  }
  if (!isRecord(value)) return;

  for (const key of Object.keys(value)) {
    if (key === 'config_json') continue;
    if (value[key] === null) {
      delete value[key];
    } else {
      stripSchemaNulls(value[key]);
    }
  }
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
    // Iterate newest-first: when a paper is re-run, the most recent batch's
    // override wins. Oldest-first would resurrect a stale figure directive
    // from a superseded run.
    for (let i = state.batches.length - 1; i >= 0; i--) {
      const req = state.batches[i].requests[customId];
      if (req?.imageOverride) return req.imageOverride;
    }
  } catch { /* ignore */ }
  return undefined;
}

/**
 * Recovers the original source URL for a URL-sourced explainer from state, so
 * the vision figure extractor can re-render the live page. Returns null for
 * local PDFs or when the request is not in state.
 */
function resolveSourceUrl(customId: string): string | null {
  if (!customId.startsWith('explainer-url-')) return null;
  try {
    const state = readState();
    for (let i = state.batches.length - 1; i >= 0; i--) {
      const req = state.batches[i].requests[customId];
      if (req?.source?.url) return req.source.url;
      if (req?.input && /^https?:\/\//i.test(req.input)) return req.input;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Recovers the preprocess-captured DOM figure candidates for a URL-sourced
 * explainer from state, so collect can extract a figure from the persisted
 * asset URLs with no live page render. Returns undefined for local PDFs, when
 * the request predates this feature, or when the request is not in state.
 */
function resolveFigureCandidates(customId: string): FigureCandidate[] | undefined {
  try {
    const state = readState();
    for (let i = state.batches.length - 1; i >= 0; i--) {
      const req = state.batches[i].requests[customId];
      if (req?.figureCandidates) return req.figureCandidates;
    }
  } catch { /* ignore */ }
  return undefined;
}

/**
 * Vision-driven figure attachment. The deterministic caption/gap-finder has
 * been retired: a vision model now looks at the rendered document (PDF pages
 * or a live web page) and picks the single most useful figure, returning a
 * bounding box we crop from the source render.
 *
 * A `.focus.md` image override is no longer required — when present it pins a
 * specific figure and supplies caption/alt overrides; when absent the model
 * selects autonomously. Always async (the vision call is remote); never throws.
 */
async function attachFigureImage(json: ExplainerJson, customId: string): Promise<void> {
  const override = lookupImageOverride(customId);
  if (json.image?.src) return; // already populated

  const pdfPath = resolveSourcePdf(customId);
  const url = pdfPath ? null : resolveSourceUrl(customId);
  if (!pdfPath && !url) {
    if (json.image) delete json.image;
    return;
  }

  const snapshotCandidates = url ? resolveFigureCandidates(customId) : undefined;

  // Explainer context steers selection towards a figure that complements the
  // article (the charts already recreate the headline results).
  const result = await extractFigureViaVlm({ pdfPath, url, override, context: contextFromExplainer(json), snapshotCandidates });
  if (!result) {
    if (json.image) delete json.image;
    return;
  }

  // Caption/alt sidecar overrides win over model-generated text. An existing
  // caption/alt only survives when the model re-picked the SAME figure;
  // carrying it onto a different figure would mislabel the image.
  const existing = json.image;
  const pickedFigure = override?.source_figure ?? result.source_figure;
  const samePick = Boolean(existing?.source_figure && pickedFigure && existing.source_figure === pickedFigure);
  json.image = {
    ...(existing ?? {}),
    source_figure: pickedFigure,
    caption: override?.caption ?? (samePick ? existing?.caption : undefined) ?? result.caption ?? existing?.caption,
    alt_text: override?.alt_text ?? (samePick ? existing?.alt_text : undefined) ?? result.alt_text ?? existing?.alt_text,
    src: result.src,
  };
  console.log(`  ✓ ${customId}: figure via ${result.provider}/${result.route}${result.page ? ` (p.${result.page})` : ''}`);
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

// A chart whose richest data series has fewer than this many points carries
// almost no information (a 2-point line, a 3-bar comparison) and reads better as
// pills/table/prose. We drop them in post so a thin chart never ships even when
// the model ignores the same rule in skill.md. Override with MIN_CHART_POINTS.
const MIN_CHART_POINTS = (() => {
  const n = Number(process.env.MIN_CHART_POINTS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 6;
})();

/** Longest `data` array across a chart's datasets (Chart.js config), or 0. */
function chartLongestSeries(chart: ExplainerChart | Record<string, unknown>): number {
  const cfg = (chart as Record<string, unknown>).config_json as
    | { data?: { datasets?: Array<{ data?: unknown[] }> } }
    | undefined;
  const datasets = cfg?.data?.datasets;
  if (!Array.isArray(datasets)) return 0;
  let max = 0;
  for (const d of datasets) {
    if (Array.isArray(d?.data)) max = Math.max(max, d.data.length);
  }
  return max;
}

function normalizeExplainerJson(json: ExplainerJson): ExplainerJson {
  stripSchemaNulls(json);
  normalizeSchemaDrift(json);
  const legacyChart = isRecord(json.chart) ? normalizeChartEntry(json.chart) : undefined;
  const charts = Array.isArray(json.charts)
    ? json.charts
        .filter((entry) => isRecord(entry))
        .map((entry) => normalizeChartEntry(entry))
    : [];

  const candidates = charts.length > 0 ? charts : legacyChart ? [legacyChart] : [];

  // Drop information-poor charts (longest series < MIN_CHART_POINTS).
  const kept = candidates.filter((c) => {
    const len = chartLongestSeries(c);
    if (len < MIN_CHART_POINTS) {
      console.warn(`  ⚠ chart "${(c as ExplainerChart).title ?? '(untitled)'}" dropped — longest series ${len} < ${MIN_CHART_POINTS} points.`);
      return false;
    }
    return true;
  });
  const normalizedCharts = kept.slice(0, 3);

  json.charts = normalizedCharts.length > 0 ? normalizedCharts : undefined;
  json.chart = normalizedCharts[0] ?? undefined;

  return json;
}

/**
 * Derives the output filename from the JSON metadata,
 * falling back to the custom_id slug if unavailable.
 */
function deriveFilename(customId: string, json: ExplainerJson | null): string {
  const today = new Date().toISOString().slice(0, 10);

  if (json?.metadata?.filename_slug) {
    // Model-supplied value goes into path.join: strip separators and dot
    // sequences so it can only ever name a file inside OUTPUT_DIR.
    const slug = json.metadata.filename_slug
      .replace(/\.json$/, '')
      .replace(/[/\\\0]/g, '-')
      .replace(/\.{2,}/g, '.')
      .replace(/^\.+/, '');
    if (slug.length > 0) return `${slug}.json`;
  }

  // Fallback: use the custom_id slug
  const slug = customId.replace(/^explainer-(?:url-)?/, '').slice(0, 50);
  return `${today}_${slug}_explainer.json`;
}

export async function saveResult(customId: string, rawText: string): Promise<SaveResult> {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let json: ExplainerJson;
  try {
    const parsed = extractJson(rawText);
    json = normalizeExplainerJson(parsed as ExplainerJson);
  } catch {
    // Non-parseable output — save the raw text as a .txt for inspection
    const slug = customId.replace(/^explainer-(?:url-)?/, '').slice(0, 50);
    const errFile = path.join(OUTPUT_DIR, `${new Date().toISOString().slice(0, 10)}_${slug}_error.txt`);
    fs.writeFileSync(errFile, rawText, 'utf8');
    throw new Error(`JSON parse failed; raw output saved to ${path.basename(errFile)}`);
  }

  // A figure failure must not discard a valid explainer: warn and save it
  // without an image instead of routing to the parse-error path.
  try {
    await attachFigureImage(json, customId);
  } catch (err) {
    console.warn(`  ⚠ ${customId}: figure attachment failed, saving without an image (${err instanceof Error ? err.message : String(err)})`);
    if (json.image) delete json.image;
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

  // Mirror into the local knowledge base (Obsidian vault) unless disabled.
  let mirroredPath: string | null = null;
  if (OBSIDIAN_MIRROR_DIR) {
    fs.mkdirSync(OBSIDIAN_MIRROR_DIR, { recursive: true });
    mirroredPath = path.join(OBSIDIAN_MIRROR_DIR, filename);
    fs.copyFileSync(outPath, mirroredPath);
  }

  return {
    jsonFile: filename,
    jsonPath: outPath,
    stagedJsonPath: stagedPath,
    mirroredJsonPath: mirroredPath,
  };
}
