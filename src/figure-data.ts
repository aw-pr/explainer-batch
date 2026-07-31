import fs from 'fs';
import os from 'os';
import path from 'path';
import * as echarts from 'echarts';
import { runVision, resolveVisionProvider, visionAuthAvailable, cleanupTmp } from './vision';
import { getModelConfig } from './model-config';
import { renderPdfPage } from './figure-vlm';
import type { ExplainerRecreatedFigure, RecreatedSeries } from './types/explainer-json';
import type { RecreateDirective } from './state';

/**
 * Figure-data recreation pass: turns a results figure into chart DATA rather
 * than a bitmap, so the website can render it natively with ECharts.
 *
 * The core design is a provenance ladder, applied as a deterministic gate over
 * the model's own claims about where each number came from:
 *
 *   supplied         — user data sidecar (`data:` directive). No vision call.
 *   paper_exact      — every series cites exact numbers printed in the paper
 *                      (a results table, value labels on bars, stated in text).
 *   figure_estimated — values read off the axes; only accepted for simple
 *                      discrete figures under MAX_ESTIMATED_POINTS.
 *   (unrecoverable)  — the pass returns null and the pipeline keeps the crop.
 *
 * The model never decides "chart vs clip"; it reports recoverability and
 * provenance, and this module's gate decides. A wrong chart is worse than no
 * chart, so every ambiguous case falls back to the (now sharper) clip.
 */

const EXTRACTION_MAX_TOKENS = envNum('FIGURE_DATA_MAX_TOKENS', 2500);
/** Estimated (read-off-the-axes) data is only trusted for small discrete figures. */
const MAX_ESTIMATED_POINTS = envNum('FIGURE_DATA_MAX_ESTIMATED_POINTS', 12);
const MIN_CONFIDENCE = 0.5;
/** Width of the supplementary page renders shown beside the crop. */
const PAGE_RENDER_PX = 2000;

function envNum(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function dataModel(provider: ReturnType<typeof resolveVisionProvider>): string {
  return process.env.FIGURE_DATA_MODEL ?? process.env.FIGURE_VLM_MODEL ?? getModelConfig(provider).batchModel;
}

export interface RecreateInput {
  /** Full-resolution crop PNG (base64) from figure-vlm's keepCropPng. */
  cropPngBase64?: string;
  /** Source PDF, for supplementary page renders around the figure. */
  pdfPath?: string | null;
  /** 1-based page the figure was found on (PDF path only). */
  page?: number;
  /** Figure label, e.g. "Figure 3". */
  sourceFigure?: string;
  /** Per-paper sidecar directive (target, axis hints, data file). */
  directive?: RecreateDirective;
  /** Where `data:` sidecar files are resolved from (passed in to avoid an output.ts import cycle). */
  inputDir?: string;
}

/* ── Tier 0: user-supplied data ─────────────────────────────────────────── */

interface SuppliedData {
  chart_type?: ExplainerRecreatedFigure['chart_type'];
  title?: string;
  caption?: string;
  x: ExplainerRecreatedFigure['x'];
  y?: ExplainerRecreatedFigure['y'];
  series: Array<Omit<RecreatedSeries, 'provenance'> & { provenance?: RecreatedSeries['provenance'] }>;
}

/**
 * Minimal CSV reader for the `data:` sidecar. Header row: first cell is the
 * x-axis label, remaining cells are series names. First column: x values,
 * remaining columns: numeric series values (blank cells become gaps).
 * Handles double-quoted cells; no embedded newlines.
 */
function parseCsv(text: string): SuppliedData | null {
  const rows = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(splitCsvLine);
  if (rows.length < 2 || rows[0].length < 2) return null;
  const [header, ...body] = rows;
  const xValues: Array<string | number> = [];
  const series: SuppliedData['series'] = header.slice(1).map(name => ({ name, values: [] as Array<number | null> }));
  for (const row of body) {
    const xRaw = row[0] ?? '';
    const xNum = Number(xRaw);
    xValues.push(xRaw !== '' && Number.isFinite(xNum) ? xNum : xRaw);
    for (let i = 0; i < series.length; i++) {
      const cell = row[i + 1] ?? '';
      const n = Number(cell);
      series[i].values!.push(cell !== '' && Number.isFinite(n) ? n : null);
    }
  }
  return { x: { label: header[0] || 'x', values: xValues }, series };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(cur.trim()); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function loadSuppliedData(dataFile: string, inputDir: string): SuppliedData | null {
  const filePath = path.isAbsolute(dataFile) ? dataFile : path.join(inputDir, dataFile);
  if (!fs.existsSync(filePath)) {
    console.warn(`  ⚠ figure-data: data sidecar not found: ${filePath}`);
    return null;
  }
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    if (filePath.toLowerCase().endsWith('.json')) {
      const parsed = JSON.parse(text) as SuppliedData;
      if (!parsed?.x?.values?.length || !Array.isArray(parsed.series) || parsed.series.length === 0) {
        console.warn('  ⚠ figure-data: JSON data sidecar missing x.values or series.');
        return null;
      }
      return parsed;
    }
    return parseCsv(text);
  } catch (err) {
    console.warn(`  ⚠ figure-data: could not read data sidecar (${err instanceof Error ? err.message : String(err)})`);
    return null;
  }
}

/* ── Tiers 1-2: VLM extraction with provenance verdict ──────────────────── */

interface ExtractionReply {
  recoverable: boolean;
  reason?: string;
  chart_type?: ExplainerRecreatedFigure['chart_type'];
  title?: string;
  caption?: string;
  x?: { label?: string; unit?: string; values?: Array<string | number> };
  y?: { label?: string; unit?: string };
  series?: Array<{
    name?: string;
    values?: Array<number | null>;
    points?: Array<[number, number]>;
    provenance?: 'exact' | 'estimated';
    source?: string;
  }>;
  confidence?: number;
}

const EXTRACTION_SYSTEM =
  'You are a chart-data extraction assistant for a research-explainer pipeline. ' +
  'You are shown a cropped figure from a paper, and usually the full page(s) it ' +
  'came from. Your job is to recover the UNDERLYING DATA of the figure so it can ' +
  'be re-plotted natively, and to be scrupulously honest about where every ' +
  'number came from. "Not recoverable" is a correct and common answer; a ' +
  'plausible-but-wrong chart is far worse than no chart. Reply with ONLY a JSON object.';

function extractionPrompt(input: RecreateInput, hasPages: boolean): string {
  const label = input.directive?.target ?? input.sourceFigure;
  const lines: string[] = [
    label
      ? `Recover the data behind ${label} (shown first as a cropped image).`
      : 'Recover the data behind the figure shown first as a cropped image.',
  ];
  if (hasPages) {
    lines.push(
      'The following image(s) show the surrounding page(s) of the paper. Exact numbers often live in a nearby ' +
      'results table or in value labels; prefer those over reading positions off the axes.');
  }
  if (input.directive?.xHint) lines.push(`The user wants the x axis to be: ${input.directive.xHint}`);
  if (input.directive?.yHint) lines.push(`The user wants the y axis to be: ${input.directive.yHint}`);
  lines.push(
    '',
    'Rules, in order:',
    '1. Use EXACT numbers when they are printed anywhere: a results table, value labels on bars/points, or values stated in text. Mark such a series "provenance": "exact" and cite the location in "source" (e.g. "Table 2, row 3" or "value labels printed above bars").',
    '2. Only if a series has no printed numbers may you ESTIMATE values by reading positions against the axes, and only when the figure is a simple discrete chart (bars, a few labelled points) where each value can be read confidently to within ~2% of the axis range. Mark such a series "provenance": "estimated" and describe how you read it in "source".',
    '3. Return "recoverable": false when data cannot be recovered honestly: dense or overlapping line plots, unlabelled log axes, shaded error bands, too many points to read, or a figure that is not a data chart at all. State why in "reason".',
    '4. Never invent, interpolate, or smooth values. Never pad a series to look complete. A partial but honest series set is fine.',
    '',
    'Return ONLY this JSON (no prose, no code fence):',
    '{',
    '  "recoverable": <true|false>,',
    '  "reason": "<short reason, especially when false>",',
    '  "chart_type": "bar" | "grouped_bar" | "stacked_bar" | "line" | "scatter",',
    '  "title": "<short chart title in plain language>",',
    '  "caption": "<one-sentence caption for the recreated chart>",',
    '  "x": {"label": "<axis quantity>", "unit": "<unit or omit>", "values": [<category labels or numeric positions>]},',
    '  "y": {"label": "<axis quantity>", "unit": "<unit or omit>"},',
    '  "series": [{"name": "<legend name>", "values": [<numbers aligned to x.values, null for gaps>], "provenance": "exact"|"estimated", "source": "<where the numbers came from>"}],',
    '  "confidence": <0..1>',
    '}',
    'For "scatter", give each series "points": [[x, y], ...] instead of "values", and x.values may be empty.',
  );
  return lines.join('\n');
}

function parseExtraction(raw: string): ExtractionReply | null {
  try {
    const fence = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    const slice = fence ? fence[1] : (start !== -1 && end > start ? raw.slice(start, end + 1) : raw);
    return JSON.parse(slice) as ExtractionReply;
  } catch {
    return null;
  }
}

/**
 * The deterministic gate over the model's provenance claims. Returns the
 * validated series plus the document-level provenance tier, or a rejection
 * reason. The model reports; this decides.
 */
function applyProvenanceGate(reply: ExtractionReply): { series: RecreatedSeries[]; provenance: 'paper_exact' | 'figure_estimated' } | { rejected: string } {
  if (!reply.recoverable) return { rejected: reply.reason ?? 'model reported the data as unrecoverable' };
  if (typeof reply.confidence === 'number' && reply.confidence < MIN_CONFIDENCE) {
    return { rejected: `low extraction confidence (${reply.confidence.toFixed(2)})` };
  }
  const chartType = reply.chart_type;
  if (!chartType || !['bar', 'grouped_bar', 'stacked_bar', 'line', 'scatter'].includes(chartType)) {
    return { rejected: `unusable chart_type "${String(chartType)}"` };
  }
  if (!Array.isArray(reply.series) || reply.series.length === 0) return { rejected: 'no series returned' };

  const series: RecreatedSeries[] = [];
  let estimatedPoints = 0;
  let anyEstimated = false;
  for (const s of reply.series) {
    if (typeof s.name !== 'string' || !s.name) return { rejected: 'a series is missing its name' };
    if (s.provenance !== 'exact' && s.provenance !== 'estimated') {
      return { rejected: `series "${s.name}" has no provenance claim` };
    }
    const isScatter = chartType === 'scatter';
    const points = isScatter ? s.points : undefined;
    const values = isScatter ? undefined : s.values;
    if (isScatter) {
      if (!Array.isArray(points) || points.length === 0 || points.some(p => !Array.isArray(p) || p.length !== 2 || p.some(n => typeof n !== 'number' || !Number.isFinite(n)))) {
        return { rejected: `scatter series "${s.name}" has no valid [x, y] points` };
      }
    } else {
      if (!Array.isArray(values) || values.length === 0 || values.some(v => v !== null && (typeof v !== 'number' || !Number.isFinite(v)))) {
        return { rejected: `series "${s.name}" has no valid values` };
      }
      const xLen = reply.x?.values?.length ?? 0;
      if (xLen === 0 || values.length !== xLen) {
        return { rejected: `series "${s.name}" length ${values.length} does not match x.values length ${xLen}` };
      }
    }
    const pointCount = (points ?? values ?? []).length;
    if (s.provenance === 'estimated') {
      anyEstimated = true;
      estimatedPoints += pointCount;
      if (chartType === 'line' || chartType === 'stacked_bar') {
        return { rejected: `estimated values are not accepted for ${chartType} figures (series "${s.name}")` };
      }
    }
    series.push({ name: s.name, values, points, provenance: s.provenance, source: s.source });
  }
  if (estimatedPoints > MAX_ESTIMATED_POINTS) {
    return { rejected: `${estimatedPoints} estimated points exceeds the trust cap of ${MAX_ESTIMATED_POINTS}` };
  }
  return { series, provenance: anyEstimated ? 'figure_estimated' : 'paper_exact' };
}

/* ── Neutral shape → ECharts option ─────────────────────────────────────── */

function axisName(axis: { label?: string; unit?: string } | undefined, fallback: string): string {
  const label = axis?.label || fallback;
  return axis?.unit ? `${label} (${axis.unit})` : label;
}

/**
 * Deterministic mapper from the neutral data shape to an Apache ECharts
 * option. Deliberately minimal on style: the website's renderer owns theming;
 * this option must simply be correct and self-describing (named axes, legend).
 */
export function buildEChartsOption(fig: Omit<ExplainerRecreatedFigure, 'echarts_option'>): Record<string, unknown> {
  const isScatter = fig.chart_type === 'scatter';
  const numericX = !isScatter && fig.x.values.every(v => typeof v === 'number');
  const seriesType = fig.chart_type === 'line' ? 'line' : isScatter ? 'scatter' : 'bar';

  const series = fig.series.map(s => {
    const base: Record<string, unknown> = { name: s.name, type: seriesType };
    if (isScatter) {
      base.data = s.points ?? [];
    } else if (numericX) {
      base.data = fig.x.values.map((x, i) => [x, s.values?.[i] ?? null]);
    } else {
      base.data = s.values ?? [];
    }
    if (fig.chart_type === 'stacked_bar') base.stack = 'total';
    return base;
  });

  return {
    tooltip: { trigger: isScatter ? 'item' : 'axis' },
    ...(fig.series.length > 1 ? { legend: { top: 0 } } : {}),
    grid: { left: 48, right: 24, top: fig.series.length > 1 ? 40 : 16, bottom: 40, containLabel: true },
    xAxis: {
      type: isScatter || numericX ? 'value' : 'category',
      name: axisName(fig.x, 'x'),
      nameLocation: 'middle',
      nameGap: 30,
      ...(isScatter || numericX ? {} : { data: fig.x.values }),
    },
    yAxis: {
      type: 'value',
      name: axisName(fig.y, 'y'),
      nameLocation: 'middle',
      nameGap: 44,
    },
    series,
  };
}

/* ── Render-and-compare verification ────────────────────────────────────── */

/**
 * Closes the loop on an extraction: render the recreated chart headlessly
 * (ECharts SSR → SVG → Chromium screenshot) and ask one cheap vision call
 * whether it shows the same data as the original crop. Fails open (undefined)
 * when rendering or the call is unavailable, so verification can never veto a
 * gate-passing extraction by accident; a strict "no" returns false.
 */
async function verifyRecreation(
  provider: ReturnType<typeof resolveVisionProvider>,
  option: Record<string, unknown>,
  cropPath: string,
): Promise<{ verified?: boolean; reason?: string }> {
  if (process.env.FIGURE_RECREATE_VERIFY === '0') return {};
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-figdata-verify-'));
  try {
    const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 900, height: 560 });
    chart.setOption({ animation: false, ...option });
    const svg = chart.renderToSVGString();
    chart.dispose();

    let pw: typeof import('playwright');
    try {
      const dynImport = new Function('m', 'return import(m)') as (m: string) => Promise<typeof import('playwright')>;
      pw = await dynImport('playwright');
    } catch {
      console.warn('  ⚠ figure-data: playwright unavailable; skipping render-and-compare.');
      return {};
    }
    const renderPath = path.join(tmpDir, 'recreated.png');
    const browser = await pw.chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 940, height: 600 } });
      await page.setContent(`<!doctype html><body style="margin:20px;background:#fff">${svg}</body>`);
      await page.locator('svg').first().screenshot({ path: renderPath, timeout: 10_000 });
    } finally {
      await browser.close().catch(() => undefined);
    }

    const vision = await runVision({
      provider,
      model: dataModel(provider),
      maxTokens: 300,
      system: 'You are a strict chart QA checker. Reply with ONLY a JSON object.',
      prompt: [
        'The first image is a figure from a paper. The second is a re-plot of data extracted from it.',
        'Do they show the SAME data? Check: same number of series and points, values in the right rank order and roughly the right magnitudes, axes describing the same quantities.',
        'Styling, colours, orientation, and rounding differences are fine; missing/extra series, wrong rank order, or clearly wrong magnitudes are not.',
        'Reply with ONLY strict JSON: {"match": <true|false>, "reason": "<short reason>"}',
      ].join('\n'),
      imagePaths: [cropPath, renderPath],
      labels: ['Original figure', 'Recreated chart'],
    });
    const raw = vision.text;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) return {};
    const obj = JSON.parse(raw.slice(start, end + 1)) as { match?: unknown; reason?: unknown };
    if (obj.match === false) return { verified: false, reason: typeof obj.reason === 'string' ? obj.reason : 'verifier rejected the recreation' };
    if (obj.match === true) return { verified: true };
    return {};
  } catch (err) {
    console.warn(`  ⚠ figure-data: verification unavailable (${err instanceof Error ? err.message : String(err)}).`);
    return {};
  } finally {
    cleanupTmp(tmpDir);
  }
}

/* ── Entry point ────────────────────────────────────────────────────────── */

const ESTIMATED_NOTICE = 'Values are read from the figure and are approximate.';

function finishFigure(base: Omit<ExplainerRecreatedFigure, 'echarts_option'>): ExplainerRecreatedFigure {
  const caption = base.data_provenance === 'figure_estimated' && !base.caption.includes(ESTIMATED_NOTICE)
    ? `${base.caption.replace(/\s*$/, '')} ${ESTIMATED_NOTICE}`
    : base.caption;
  return { ...base, caption, echarts_option: buildEChartsOption(base) };
}

/**
 * Attempts to recreate a figure as data. Returns the recreated figure, or null
 * when the data is not recoverable at acceptable provenance — the caller keeps
 * the cropped image in that case. Never throws.
 */
export async function recreateFigureData(input: RecreateInput): Promise<ExplainerRecreatedFigure | null> {
  const label = input.directive?.target ?? input.sourceFigure ?? 'Figure';

  // Tier 0: user-supplied data needs no vision at all.
  if (input.directive?.dataFile && input.inputDir) {
    const supplied = loadSuppliedData(input.directive.dataFile, input.inputDir);
    if (!supplied) return null;
    const fig = finishFigure({
      source_figure: label,
      title: supplied.title ?? `${label}, recreated`,
      caption: supplied.caption ?? `${label} from the paper, re-plotted from supplied data.`,
      chart_type: supplied.chart_type ?? 'line',
      x: supplied.x,
      y: supplied.y ?? { label: 'Value' },
      series: supplied.series.map(s => ({ provenance: 'exact', source: `supplied data file ${input.directive!.dataFile}`, ...s } as RecreatedSeries)),
      data_provenance: 'supplied',
    });
    console.log(`  ✓ figure-data: ${label} recreated from supplied data (${input.directive.dataFile}).`);
    return fig;
  }

  if (!input.cropPngBase64) {
    console.log('  · figure-data: no crop available to extract from; keeping the clip.');
    return null;
  }
  if (!visionAuthAvailable()) {
    console.warn('  ⚠ figure-data: no vision auth configured; keeping the clip.');
    return null;
  }

  const provider = resolveVisionProvider();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-figdata-'));
  try {
    const cropPath = path.join(tmpDir, 'crop.png');
    fs.writeFileSync(cropPath, Buffer.from(input.cropPngBase64, 'base64'));

    // Supplementary context: the figure's page and the following one (results
    // tables usually sit beside or after the figure).
    const imagePaths = [cropPath];
    const labels = [`Cropped figure (${label})`];
    if (input.pdfPath && input.page && fs.existsSync(input.pdfPath)) {
      for (const p of [input.page, input.page + 1]) {
        const rendered = renderPdfPage(input.pdfPath, p, PAGE_RENDER_PX, tmpDir);
        if (rendered) {
          imagePaths.push(rendered);
          labels.push(`Paper page ${p}`);
        }
      }
    }

    const vision = await runVision({
      provider,
      model: dataModel(provider),
      maxTokens: EXTRACTION_MAX_TOKENS,
      system: EXTRACTION_SYSTEM,
      prompt: extractionPrompt(input, imagePaths.length > 1),
      imagePaths,
      labels,
    });
    const reply = parseExtraction(vision.text);
    if (!reply) {
      console.warn('  ⚠ figure-data: unparseable extraction reply; keeping the clip.');
      return null;
    }

    const gated = applyProvenanceGate(reply);
    if ('rejected' in gated) {
      console.log(`  · figure-data: keeping the clip for ${label} (${gated.rejected}).`);
      return null;
    }

    const base: Omit<ExplainerRecreatedFigure, 'echarts_option'> = {
      source_figure: label,
      title: reply.title ?? `${label}, recreated`,
      caption: reply.caption ?? `${label} from the paper, re-plotted from extracted data.`,
      chart_type: reply.chart_type!,
      x: {
        label: reply.x?.label ?? 'x',
        unit: reply.x?.unit,
        values: reply.x?.values ?? [],
      },
      y: { label: reply.y?.label ?? 'Value', unit: reply.y?.unit },
      series: gated.series,
      data_provenance: gated.provenance,
      extraction: { provider: String(vision.provider), route: String(vision.route) },
    };

    const option = buildEChartsOption(base);
    const verdict = await verifyRecreation(provider, option, cropPath);
    if (verdict.verified === false) {
      console.log(`  · figure-data: keeping the clip for ${label} (render-and-compare failed: ${verdict.reason}).`);
      return null;
    }
    if (verdict.verified !== undefined) base.extraction!.verified = verdict.verified;

    const fig = finishFigure(base);
    console.log(`  ✓ figure-data: ${label} recreated (${gated.provenance}, ${gated.series.length} series${verdict.verified ? ', verified' : ''}).`);
    return fig;
  } catch (err) {
    console.warn(`  ⚠ figure-data: extraction failed (${err instanceof Error ? err.message : String(err)}); keeping the clip.`);
    return null;
  } finally {
    cleanupTmp(tmpDir);
  }
}
