import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'node:crypto';
import type { Chart, ExplainerV2, ModelOutputV2 } from '../contract/explainer-v2';
import type { FigureAsset } from './finalize';
import { extractFigureViaVlm } from './figure-vlm';
import { locateEmbeddedFigure } from './figure-locator/pdf-embedded';
import { buildFigureRequest } from './figure-locator/request';
import { formatLabel } from './figure-locator/label';
import { readState, type FigureCandidate } from './state';
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

function lookupImageOverride(customId: string): { source_figure?: string; caption?: string; alt_text?: string; pageHint?: number; forceRegionCrop?: boolean } | undefined {
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
 * The operator's image pin wins over the model's figure request. Return bytes
 * to the seam so extraction never changes the stored article directly.
 */
export async function locateLeadFigure(wire: ModelOutputV2, customId: string): Promise<FigureAsset | null> {
  if (!wire.figure_request) return null;
  const override = lookupImageOverride(customId);
  const pdfPath = resolveSourcePdf(customId);
  const url = pdfPath ? null : resolveSourceUrl(customId);
  if (!pdfPath && !url) return null;
  const snapshotCandidates = url ? resolveFigureCandidates(customId) : undefined;
  const native = locateEmbeddedFigure(buildFigureRequest({
    output: wire, override, source: { ...(pdfPath && { pdfPath }) },
  }));
  if (native) {
    console.log(`  ✓ ${customId}: figure via pdf-embedded (p.${native.page})`);
    return {
      label: formatLabel(native.label),
      caption: override?.caption ?? native.captionText!,
      alt_text: override?.alt_text ?? native.captionText!,
      bytes: native.bytes, page: native.page, provenance: native.provenance,
    };
  }
  const result = await extractFigureViaVlm({
    pdfPath, url, snapshotCandidates,
    override: { ...override, source_figure: override?.source_figure ?? wire.figure_request.label },
    context: {
      headline: wire.hero.headline, subtitle: wire.hero.subtitle,
      sectionLabels: wire.sections.map(section => section.label),
      chartTitles: wire.charts.map(chart => chart.title),
    },
  });
  if (!result) return null;
  const data = /^data:image\/[^;,]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(result.src);
  if (!data) throw new Error('unrecognised image bytes');
  console.log(`  ✓ ${customId}: figure via ${result.provider}/${result.route}${result.page ? ` (p.${result.page})` : ''}`);
  return {
    label: override?.source_figure ?? result.source_figure,
    caption: override?.caption ?? result.caption,
    alt_text: override?.alt_text ?? result.alt_text,
    bytes: Buffer.from(data[1], 'base64'), page: result.page, provenance: 'vlm-crop',
  };
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
  { itemKey, kind, figureBytes }: { itemKey: string; kind: 'success' | 'review'; figureBytes?: Buffer },
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
  const writeSidecar = async (destination: string): Promise<void> => {
    if (!article.lead_figure) return;
    if (!figureBytes) throw new Error('Lead figure bytes are required to persist its sidecar');
    const file = path.join(destination, article.lead_figure.asset);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
    try {
      await fs.promises.writeFile(temporary, figureBytes, { flag: 'wx' });
      await fs.promises.rename(temporary, file);
    } finally {
      await fs.promises.rm(temporary, { force: true });
    }
  };
  await fs.promises.mkdir(directory, { recursive: true });
  try {
    await writeSidecar(directory);
    await fs.promises.writeFile(temporaryPath, JSON.stringify(article, null, 2), { encoding: 'utf8', flag: 'wx' });
    await fs.promises.rename(temporaryPath, jsonPath);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true });
  }

  const copy = async (destination: string | null): Promise<'written' | 'skipped' | 'failed'> => {
    if (kind === 'review' || !destination) return 'skipped';
    try {
      await fs.promises.mkdir(destination, { recursive: true });
      await writeSidecar(destination);
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
