export type RuleId =
  | 'pie-doughnut-radar'
  | 'line-across-categories'
  | 'mixed-projected'
  | 'stacked-on-log'
  | 'ordinal-sequence'
  | 'two-value-split'
  | 'no-variation'
  | 'caption-admission';

export type Flag = 'linear-series' | 'hand-off-gap';

export interface RejectResult {
  hits: RuleId[];
  flags: Flag[];
}

interface RejectSeries {
  name?: string;
  values?: Array<number | null>;
  points?: Array<{ x?: unknown; y?: number | null }>;
}

interface RejectChart {
  kind?: string;
  caption?: string;
  x?: { type?: string; values?: unknown[] };
  y?: { scale?: string };
  series?: RejectSeries[];
}

const BANNED_TYPES = ['pie', 'doughnut', 'polarArea', 'radar'];
const MONTHS = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
const DATE_FORM = new RegExp(`^(?:\\d{4}|\\d{4}-\\d{2}|\\d{4}-\\d{2}-\\d{2}|Q[1-4] \\d{4}|(?:${MONTHS}) \\d{4})$`);
const NUMERIC = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;
const PROJECTED_LABEL = /\b(?:proj(?:ected|ection)?|forecast|predicted|extrapolat\w*|target|scenario)\b|\bproj\.(?=\W|$)/i;
const PROJECTED_CAPTION = /\b(projection|projected|forecast|roadmap|scenario)s?\b/i;
const YEAR = /\b(?:19|20)\d{2}\b/;
const ADMISSION = /\b(approximate(?:ly)?|read[- ]?offs?|traced|illustrative|reconstructed|inferred|eyeballed|digiti[sz]ed|subjective|estimated from)\b/i;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function numericValues(series: RejectSeries): number[] {
  const raw = series.values ?? (series.points ?? []).map(p => p.y);
  return raw.filter((v): v is number => typeof v === 'number');
}

function constantStep(nums: number[]): number | null {
  if (nums.length < 2) return null;
  const step = nums[1] - nums[0];
  const tolerance = 1e-9 * Math.max(1, Math.abs(step));
  return nums.every((v, i) => i === 0 || Math.abs(v - nums[i - 1] - step) <= tolerance) ? step : null;
}

function xLabels(chart: RejectChart): string[] {
  return (chart.x?.values ?? []).map(v => String(v));
}

function isCategorical(chart: RejectChart): boolean {
  if (chart.x?.type === 'category') return true;
  return (chart.x?.values ?? []).some(v => typeof v === 'string' && !NUMERIC.test(v.trim()));
}

function lineAcrossCategories(chart: RejectChart): boolean {
  if (chart.kind !== 'line') return false;
  const labels = xLabels(chart);
  if (chart.x?.type === 'category' && labels.some(l => !DATE_FORM.test(l.trim()))) return true;
  return (chart.x?.values ?? []).some(v => typeof v === 'string' && !NUMERIC.test(v.trim()) && !DATE_FORM.test(v.trim()));
}

function mixedProjected(chart: RejectChart): boolean {
  const labels = [...xLabels(chart), ...(chart.series ?? []).map(s => s.name ?? '')];
  const projected = labels.filter(l => PROJECTED_LABEL.test(l)).length;
  if (projected > 0 && projected < labels.length) return true;
  return PROJECTED_CAPTION.test(chart.caption ?? '') && xLabels(chart).length > 1 && xLabels(chart).some(l => YEAR.test(l));
}

function isOrdinal(nums: number[], categorical: boolean): boolean {
  if (nums.length < 3 || !nums.every(Number.isInteger)) return false;
  const step = constantStep(nums);
  if (step === null) return false;
  const first = nums[0];
  const last = nums[nums.length - 1];
  if (Math.abs(step) === 1 && (first === 0 || first === 1 || last === 0 || last === 1)) return true;
  return step !== 0 && (first === 0 || first === 1) && categorical;
}

function hasHandOffGap(all: Array<Array<number | null | undefined>>): boolean {
  return all.some((historical, i) => {
    const lastIndex = historical.reduce<number>((acc, v, k) => (typeof v === 'number' ? k : acc), -1);
    if (lastIndex < 0 || lastIndex === historical.length - 1) return false;
    return all.some((projection, j) => {
      if (i === j) return false;
      const firstIndex = projection.findIndex(v => typeof v === 'number');
      return firstIndex > 0 && firstIndex <= lastIndex + 1;
    });
  });
}

function v1Config(entry: Record<string, unknown>): Record<string, any> | null {
  const raw = entry.config_json;
  if (isObject(raw)) return raw;
  if (typeof raw !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function v1Hits(entry: Record<string, unknown>): RuleId[] {
  const config = v1Config(entry);
  if (!config) return [];
  const hits: RuleId[] = [];
  if (typeof config.type === 'string' && BANNED_TYPES.includes(config.type)) hits.push('pie-doughnut-radar');
  const scales = Object.values(isObject(config.options) && isObject(config.options.scales) ? config.options.scales : {}).filter(isObject);
  const datasets = Array.isArray(config.data?.datasets) ? config.data.datasets : [];
  const logarithmic = scales.some(s => s.type === 'logarithmic');
  const stacked = scales.some(s => s.stacked === true) || datasets.some((d: unknown) => isObject(d) && Boolean(d.stack));
  if (logarithmic && stacked) hits.push('stacked-on-log');
  return hits;
}

export function rejectRules(chart: unknown): RejectResult {
  if (!isObject(chart)) return { hits: [], flags: [] };
  if ('config_json' in chart) return { hits: v1Hits(chart), flags: [] };

  const c = chart as RejectChart;
  const series = Array.isArray(c.series) ? c.series : [];
  const numbers = series.map(numericValues);
  const categorical = isCategorical(c);
  const hits: RuleId[] = [];

  if (typeof c.kind === 'string' && BANNED_TYPES.includes(c.kind)) hits.push('pie-doughnut-radar');
  if (lineAcrossCategories(c)) hits.push('line-across-categories');
  if (mixedProjected(c)) hits.push('mixed-projected');
  if (c.kind === 'stacked_bar' && c.y?.scale === 'log') hits.push('stacked-on-log');
  if (numbers.some(n => isOrdinal(n, categorical))) hits.push('ordinal-sequence');
  if (series.length === 1 && numbers[0].length === 2 && categorical) hits.push('two-value-split');
  if (series.length > 0 && numbers.every(n => n.length >= 3 && n.every(v => v === n[0]))) hits.push('no-variation');
  if (ADMISSION.test(c.caption ?? '') || series.some(s => ADMISSION.test(s.name ?? ''))) hits.push('caption-admission');

  const flags: Flag[] = [];
  if (numbers.some(n => n.length >= 3 && (constantStep(n) ?? 0) !== 0)) flags.push('linear-series');
  if (hasHandOffGap(series.map(s => s.values ?? (s.points ?? []).map(p => p.y)))) flags.push('hand-off-gap');
  return { hits, flags };
}
