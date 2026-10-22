import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'node:crypto';
import type { ExplainerJson } from './types/explainer-json';
import type { Chart, ExplainerV2 } from '../contract/explainer-v2';
import { extractFigureViaVlm, contextFromExplainer } from './figure-vlm';
import { recreateFigureData } from './figure-data';
import { readState, type FigureCandidate, type RecreateDirective } from './state';
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

/**
 * Reverses preprocess.ts's customId derivation to find the source PDF.
 * Uses the newest recorded cache path for URL-sourced explainers.
 * Returns null when no matching PDF exists
 * (e.g. the input file was removed after the batch was submitted).
 */
export function resolveSourcePdf(customId: string): string | null {
  if (customId.startsWith('explainer-url-')) {
    const state = readState();
    for (let i = state.batches.length - 1; i >= 0; i--) {
      const cachedPath = state.batches[i].requests[customId]?.source?.cachedPdfPath;
      if (cachedPath !== undefined) return fs.existsSync(cachedPath) ? cachedPath : null;
    }
    return null;
  }
  const target = customId.replace(/^explainer-/, '');
  if (!fs.existsSync(INPUT_DIR)) return null;

  const candidates = fs.readdirSync(INPUT_DIR).filter(f => f.toLowerCase().endsWith('.pdf'));
  for (const filename of candidates) {
    const stem = filename.replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64 - 'explainer-'.length);
    if (stem === target) return path.join(INPUT_DIR, filename);
  }
  return null;
}

function lookupImageOverride(customId: string): { source_figure?: string; caption?: string; alt_text?: string; pageHint?: number } | undefined {
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

function lookupRecreate(customId: string): RecreateDirective | undefined {
  try {
    const state = readState();
    for (let i = state.batches.length - 1; i >= 0; i--) {
      const req = state.batches[i].requests[customId];
      if (req?.recreate) return req.recreate;
    }
  } catch { /* ignore */ }
  return undefined;
}

/**
 * Whether the figure-recreation pass should run for this paper. A sidecar
 * directive always wins (including an explicit `recreate: no`); otherwise the
 * FIGURE_RECREATE=1 env switch enables it globally.
 */
function recreationRequested(directive?: RecreateDirective): boolean {
  if (directive) return directive.enabled;
  return process.env.FIGURE_RECREATE === '1';
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
  const directive = lookupRecreate(customId);
  const recreate = recreationRequested(directive);
  const pdfPath = resolveSourcePdf(customId);
  const url = pdfPath ? null : resolveSourceUrl(customId);

  // Tier-0 recreation (user-supplied data sidecar) needs no crop or source
  // document, so it runs even when figure extraction is impossible.
  if (recreate && directive?.dataFile) {
    const fig = await recreateFigureData({
      directive,
      inputDir: INPUT_DIR,
      sourceFigure: directive.target ?? override?.source_figure,
    });
    if (fig) json.recreated_figure = fig;
  }

  if (json.image?.src) return; // already populated

  if (!pdfPath && !url) {
    if (json.image) delete json.image;
    return;
  }

  const snapshotCandidates = url ? resolveFigureCandidates(customId) : undefined;

  // A recreation target pins the figure pick too (recreate and clip must be
  // the same figure so the clip is the honest fallback), unless an explicit
  // image: override already pins one.
  const effOverride = recreate && directive?.target && !override?.source_figure
    ? { ...(override ?? {}), source_figure: directive.target }
    : override;
  const wantCrop = recreate && !json.recreated_figure;

  // Explainer context orients selection; the picker still asks for the
  // paper's key results figure.
  const result = await extractFigureViaVlm({ pdfPath, url, override: effOverride, context: contextFromExplainer(json), snapshotCandidates, keepCropPng: wantCrop });
  if (!result) {
    if (json.image) delete json.image;
    return;
  }

  // Caption/alt sidecar overrides win over model-generated text. An existing
  // caption/alt only survives when the model re-picked the SAME figure;
  // carrying it onto a different figure would mislabel the image.
  const existing = json.image;
  const pickedFigure = effOverride?.source_figure ?? result.source_figure;
  const samePick = Boolean(existing?.source_figure && pickedFigure && existing.source_figure === pickedFigure);
  json.image = {
    ...(existing ?? {}),
    source_figure: pickedFigure,
    caption: effOverride?.caption ?? (samePick ? existing?.caption : undefined) ?? result.caption ?? existing?.caption,
    alt_text: effOverride?.alt_text ?? (samePick ? existing?.alt_text : undefined) ?? result.alt_text ?? existing?.alt_text,
    src: result.src,
  };
  console.log(`  ✓ ${customId}: figure via ${result.provider}/${result.route}${result.page ? ` (p.${result.page})` : ''}`);

  // Tiers 1-2: extract the data behind the crop; on any honest failure the
  // clip above simply stands.
  if (wantCrop && result.cropPngBase64) {
    const fig = await recreateFigureData({
      cropPngBase64: result.cropPngBase64,
      pdfPath,
      page: result.page,
      sourceFigure: pickedFigure,
      directive,
      inputDir: INPUT_DIR,
    });
    if (fig) json.recreated_figure = fig;
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

export { MIN_CHART_POINTS };

export function dropThinCharts(charts: Chart[]): { kept: Chart[]; dropped: string[] } {
  const dropped: string[] = [];
  const kept = charts.filter((chart, index) => {
    const series = Array.isArray(chart?.series) ? chart.series : [];
    const len = Math.max(0, ...series.map(series => {
      const values = chart?.kind === 'scatter' ? series?.points : series?.values;
      return Array.isArray(values) ? values.length : 0;
    }));
    if (len < MIN_CHART_POINTS) {
      dropped.push(`charts[${index}]: "${chart?.title ?? '(untitled)'}" dropped, fewer than ${MIN_CHART_POINTS} points`);
      return false;
    }
    return true;
  });
  return { kept, dropped };
}

export async function persistArtefact(
  article: ExplainerV2,
  { itemKey, kind }: { itemKey: string; kind: 'success' | 'review' },
): Promise<{
  jsonPath: string;
  destinations: {
    output: 'written';
    staging: 'written' | 'skipped' | 'failed';
    mirror: 'written' | 'skipped' | 'failed';
  };
}> {
  const directory = kind === 'review' ? path.join(OUTPUT_DIR, 'review') : OUTPUT_DIR;
  const filename = `${article.metadata.slug}.json`;
  const jsonPath = path.join(directory, filename);
  const temporaryPath = path.join(directory, `.${filename}.${randomUUID()}.tmp`);
  await fs.promises.mkdir(directory, { recursive: true });
  try {
    await fs.promises.writeFile(temporaryPath, JSON.stringify(article, null, 2), { encoding: 'utf8', flag: 'wx' });
    await fs.promises.rename(temporaryPath, jsonPath);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true });
  }

  const copy = async (destination: string | null): Promise<'written' | 'skipped' | 'failed'> => {
    if (kind === 'review' || !destination) return 'skipped';
    try {
      await fs.promises.mkdir(destination, { recursive: true });
      await fs.promises.copyFile(jsonPath, path.join(destination, filename));
      return 'written';
    } catch {
      return 'failed';
    }
  };
  const staging = await copy(WEBSITE_STAGING_DIR);
  const mirror = await copy(OBSIDIAN_MIRROR_DIR);
  return { jsonPath, destinations: { output: 'written', staging, mirror } };
}

export function saveRawOutput(customId: string, text: string): string {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const slug = customId.replace(/^explainer-(?:url-)?/, '').slice(0, 50);
  const errFile = path.join(OUTPUT_DIR, `${new Date().toISOString().slice(0, 10)}_${slug}_error.txt`);
  fs.writeFileSync(errFile, text, 'utf8');
  return path.basename(errFile);
}
