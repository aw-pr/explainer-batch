import type { Chart } from '../contract/explainer-v2';

export function isChartIssue(issue: string): boolean {
  return /^(?:charts?|recreated_figure)\b/.test(issue)
    || /^style \([^)]+\) at (?:charts?|recreated_figure)\b/.test(issue);
}

export function chartIssues(chart: Chart, index: number): string[] {
  const issues: string[] = [];
  if (!Array.isArray(chart?.series)) return issues;
  chart.series.forEach((series, i) => {
    const data = chart.kind === 'scatter'
      ? (Array.isArray(series?.points) ? series.points.map(p => p?.y).filter((v): v is number => typeof v === 'number') : [])
      : (Array.isArray(series?.values) ? series.values.filter((v): v is number => typeof v === 'number') : []);
    const at = `charts[${index}].series[${i}]`;
    if (data.length === 1) issues.push(`${at}: a single point is better expressed in prose or a pill.`);
    if (data.length > 1 && data.every(v => v === data[0])) {
      issues.push(`${at}: uniform values carry no comparison; use prose or a table.`);
    }
    if (data.length >= 3) {
      const ascending = data.every((v, n) => n === 0 || v === data[n - 1] + 1);
      const descending = data.every((v, n) => n === 0 || v === data[n - 1] - 1);
      const rank = [data[0], data[data.length - 1]].some(v => v === 0 || v === 1);
      if ((ascending || descending) && rank) issues.push(`${at}: an ordinal sequence encodes rank rather than measured magnitude.`);
    }
    if (data.length === 2) {
      const sum = data[0] + data[1];
      if ((sum >= 95 && sum <= 105) || (sum >= 0.95 && sum <= 1.05)) {
        issues.push(`${at}: a two-value share-of-whole belongs in prose or pills.`);
      }
    }
  });
  return issues;
}

export function buildWireRepairInstruction(issues: string[], ctx: { citationKnown: boolean }): string {
  const modelIssues = issues.filter(issue => !isChartIssue(issue))
    .map(issue => issue.replace(/date_created|filename_slug|slug|metadata|publication_date|references/gi, 'code-owned field'));
  return [
    'Repair the supplied wire JSON article, preserving its existing content and nullable keys.',
    ctx.citationKnown ? 'Keep citation null: the source citation is already known.' : 'Supply citation from the paper when it is missing.',
    'Fix only these issues:',
    ...modelIssues.map(issue => `- ${issue}`),
    'Return only a JSON object, without a preamble or markdown fences.',
  ].join('\n');
}
