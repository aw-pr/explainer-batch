import type { ExplainerJson } from './types/explainer-json';

export interface JsonValidation {
  ok: boolean;
  issues: string[];
}

interface ValidationOptions {
  expectedDate: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasRequiredExternalAnchor(html: string): boolean {
  return /<a\s[^>]*href=["']https?:\/\/[^"']+["'][^>]*target=["']_blank["'][^>]*rel=["'][^"']*noopener[^"']*noreferrer[^"']*["'][^>]*>/i.test(html)
    || /<a\s[^>]*href=["']https?:\/\/[^"']+["'][^>]*rel=["'][^"']*noopener[^"']*noreferrer[^"']*["'][^>]*target=["']_blank["'][^>]*>/i.test(html);
}

function containsBareUrlOutsideAnchor(html: string): boolean {
  const withoutAnchors = html.replace(/<a\b[\s\S]*?<\/a>/gi, '');
  return /https?:\/\/[^\s<>"']+/i.test(withoutAnchors);
}

function chartEntries(root: Record<string, unknown>): Record<string, unknown>[] {
  const charts = Array.isArray(root['charts'])
    ? root['charts'].filter((chart): chart is Record<string, unknown> => isRecord(chart))
    : [];

  if (charts.length > 0) return charts;
  return isRecord(root['chart']) ? [root['chart']] : [];
}

/**
 * Validates a parsed ExplainerJson object. This is a safety-net check —
 * it enforces structural requirements the renderer relies on, not
 * content-quality judgements (pill wording, chart type choice, etc.)
 * which are left to the model.
 */
function chartDatasetNumbers(chart: Record<string, unknown>): number[][] {
  const config = isRecord(chart['config_json']) ? chart['config_json'] : undefined;
  const data = config && isRecord(config['data']) ? config['data'] : undefined;
  const datasets = data && Array.isArray(data['datasets']) ? data['datasets'] : [];
  const out: number[][] = [];
  for (const ds of datasets) {
    if (!isRecord(ds) || !Array.isArray(ds['data'])) continue;
    const nums = (ds['data'] as unknown[]).filter((v): v is number => typeof v === 'number');
    if (nums.length > 0) out.push(nums);
  }
  return out;
}

// Reject the two failure modes seen in practice: ordinal rank encoded as bar
// height ([0,1,2,3] / [1,2,3,4,5]) and two-value share-of-whole rendered as a
// 2-bar chart. Both are pills or prose, not charts.
function chartDataIssues(chart: Record<string, unknown>, i: number): string[] {
  const issues: string[] = [];
  const datasets = chartDatasetNumbers(chart);
  if (datasets.length === 0) return issues;

  for (let d = 0; d < datasets.length; d++) {
    const data = datasets[d];

    if (data.length >= 3) {
      const ascending = data.every((v, k) => k === 0 || v === data[k - 1] + 1);
      const descending = data.every((v, k) => k === 0 || v === data[k - 1] - 1);
      const startsAtRankZero = data[0] === 0 || data[0] === 1 || data[data.length - 1] === 0 || data[data.length - 1] === 1;
      if ((ascending || descending) && startsAtRankZero) {
        issues.push(
          `charts[${i}].datasets[${d}].data is an ordinal sequence (${JSON.stringify(data)}) - bar height is encoding rank order, not magnitude. Move to a numbered list or prose, or replace with measured values.`,
        );
      }
    }

    if (data.length === 2) {
      const sum = data[0] + data[1];
      const isPercentSplit = sum >= 95 && sum <= 105;
      const isFractionSplit = sum >= 0.95 && sum <= 1.05;
      if (isPercentSplit || isFractionSplit) {
        issues.push(
          `charts[${i}].datasets[${d}].data is a two-value share-of-whole (${JSON.stringify(data)} sums to ~${sum.toFixed(2)}). Move to top_block.pills - a proportion is not a chart.`,
        );
      }
    }
  }
  return issues;
}

export function validateJsonOutput(json: unknown, options: ValidationOptions): JsonValidation {
  const issues: string[] = [];

  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, issues: ['Output is not a JSON object.'] };
  }

  const j = json as Record<string, unknown>;

  if (j['version'] !== 1) issues.push('Missing or incorrect version field (expected 1).');

  const meta = j['metadata'] as Record<string, unknown> | undefined;
  if (!meta) {
    issues.push('Missing metadata object.');
  } else {
    if (!meta['title']) issues.push('Missing metadata.title.');
    if (!meta['filename_slug']) issues.push('Missing metadata.filename_slug.');
    if (!meta['date_created']) issues.push('Missing metadata.date_created.');
    if (typeof meta['date_created'] === 'string' && meta['date_created'] !== options.expectedDate) {
      issues.push(`metadata.date_created must equal ${options.expectedDate}.`);
    }
    if (typeof meta['filename_slug'] === 'string') {
      const slug = meta['filename_slug'];
      if (!new RegExp(`^${options.expectedDate}_[a-z0-9]+_[a-z0-9-]+_explainer$`).test(slug)) {
        issues.push(`metadata.filename_slug must match ${options.expectedDate}_authorsurname_short-title_explainer.`);
      }
    }
  }

  const hero = j['hero'] as Record<string, unknown> | undefined;
  if (!hero) {
    issues.push('Missing hero object.');
  } else {
    if (!hero['headline']) issues.push('Missing hero.headline.');
    if (!hero['headline_html']) issues.push('Missing hero.headline_html.');
    if (!hero['subtitle']) issues.push('Missing hero.subtitle.');
    if (!hero['publication_date']) {
      issues.push('Missing hero.publication_date.');
    } else if (typeof hero['publication_date'] !== 'string' || !/^Published [A-Z][a-z]+ \d{4}$/.test(hero['publication_date'])) {
      issues.push('hero.publication_date must use the format "Published Month Year".');
    }
  }

  if (!j['top_block']) {
    issues.push('Missing top_block.');
  } else {
    const tb = j['top_block'] as Record<string, unknown>;
    if (tb['kind'] === 'pills') {
      const pills = tb['pills'] as unknown[];
      if (!Array.isArray(pills) || pills.length === 0) {
        issues.push('top_block.pills is empty or missing.');
      } else {
        if (pills.length < 2 || pills.length > 6) issues.push('top_block.pills must contain between 2 and 6 pills.');
        pills.forEach((pill, i) => {
          if (!isRecord(pill)) {
            issues.push(`top_block.pills[${i}] is not an object.`);
            return;
          }
          if (!isNonEmptyString(pill['number'])) {
            issues.push(`top_block.pills[${i}].number is empty.`);
          }
          if (!isNonEmptyString(pill['description'])) {
            issues.push(`top_block.pills[${i}].description is empty.`);
          }
          if (!pill['accent_color']) issues.push(`top_block.pills[${i}].accent_color is empty.`);
        });
      }
    } else if (tb['kind'] === 'takeaway') {
      if (!tb['body']) issues.push('top_block.body is empty (takeaway).');
    } else {
      issues.push('top_block.kind must be "pills" or "takeaway".');
    }
  }

  const sections = j['sections'];
  if (!Array.isArray(sections) || sections.length === 0) {
    issues.push('Missing or empty sections array.');
  } else {
    sections.forEach((s: unknown, i: number) => {
      if (!isRecord(s)) {
        issues.push(`sections[${i}] is not an object.`);
        return;
      }
      const sec = s as Record<string, unknown>;
      if (!sec['label']) issues.push(`sections[${i}] missing label.`);

      const paragraphs = Array.isArray(sec['paragraphs']) ? sec['paragraphs'] : [];
      const hasParagraphs = paragraphs.length > 0;
      const list = isRecord(sec['list']) ? sec['list'] : null;
      const hasList = Boolean(list);

      if (!hasParagraphs && !hasList) {
        issues.push(`sections[${i}] must include paragraphs or a structured list.`);
      }

      if (hasParagraphs && paragraphs.some((p) => !isNonEmptyString(p))) {
        issues.push(`sections[${i}] contains empty paragraph entries.`);
      }

      if (Array.isArray(sec['paragraphs_html'])) {
        const rich = sec['paragraphs_html'] as unknown[];
        if (hasParagraphs && rich.length !== paragraphs.length) {
          issues.push(`sections[${i}].paragraphs_html must align with paragraphs length.`);
        }
      }

      if (list) {
        if (typeof list['ordered'] !== 'boolean') {
          issues.push(`sections[${i}].list.ordered must be boolean.`);
        }
        if (!Array.isArray(list['items']) || list['items'].length === 0) {
          issues.push(`sections[${i}].list.items must contain at least 1 item.`);
        } else {
          (list['items'] as unknown[]).forEach((item, j) => {
            if (!isRecord(item)) {
              issues.push(`sections[${i}].list.items[${j}] is not an object.`);
              return;
            }
            if (!isNonEmptyString(item['body'])) {
              issues.push(`sections[${i}].list.items[${j}].body is empty.`);
            }
          });
        }
      }
    });
  }

  const endTakeaway = j['end_takeaway'];
  const topBlock = j['top_block'] as Record<string, unknown> | undefined;
  if (isRecord(topBlock) && topBlock['kind'] === 'takeaway' && endTakeaway) {
    issues.push('end_takeaway must be omitted when top_block.kind is "takeaway".');
  }
  if (isRecord(topBlock) && topBlock['kind'] === 'pills' && (!isRecord(endTakeaway) || !endTakeaway['body'])) {
    issues.push('end_takeaway must be present when top_block.kind is "pills".');
  }

  if (j['charts'] !== undefined && !Array.isArray(j['charts'])) {
    issues.push('charts must be an array when present.');
  }
  const charts = chartEntries(j);
  if (Array.isArray(j['charts']) && j['charts'].length > 4) {
    issues.push('charts must not contain more than 4 entries.');
  }
  charts.forEach((chart, i) => {
    if (!isNonEmptyString(chart['title'])) issues.push(`charts[${i}].title is empty.`);
    if (!isNonEmptyString(chart['caption'])) issues.push(`charts[${i}].caption is empty.`);
    if (!('config_json' in chart) && !isNonEmptyString(chart['config_raw'])) {
      issues.push(`charts[${i}] must include config_json or config_raw.`);
    }
    for (const issue of chartDataIssues(chart, i)) issues.push(issue);
  });
  if (j['chart'] !== undefined && !isRecord(j['chart'])) {
    issues.push('chart must be an object when present.');
  }

  if (j['image'] !== undefined) {
    if (!isRecord(j['image'])) {
      issues.push('image must be an object when present.');
    } else {
      const img = j['image'];
      if (!isNonEmptyString(img['source_figure'])) issues.push('image.source_figure is empty.');
      if (!isNonEmptyString(img['caption'])) issues.push('image.caption is empty.');
    }
  }

  if (!Array.isArray(j['references'])) {
    issues.push('Missing references array.');
  } else {
    const refs = j['references'] as unknown[];
    if (refs.length === 0) issues.push('references must contain the primary source citation.');
    refs.forEach((ref, i) => {
      if (typeof ref !== 'string' || !ref.trim()) {
        issues.push(`references[${i}] is empty.`);
        return;
      }
      if (!hasRequiredExternalAnchor(ref)) {
        issues.push(`references[${i}] must include a clickable external anchor with target="_blank" and rel="noopener noreferrer".`);
      }
      if (containsBareUrlOutsideAnchor(ref)) {
        issues.push(`references[${i}] contains a bare URL outside an anchor tag.`);
      }
    });
  }

  return { ok: issues.length === 0, issues };
}

export function buildRepairInstruction(issues: string[], expectedDate: string): string {
  return [
    'You are repairing a JSON explainer article.',
    'The JSON you returned violated required schema or formatting rules. Fix the issues below while preserving all existing content.',
    `Use ${expectedDate} as metadata.date_created and as the YYYY-MM-DD prefix in metadata.filename_slug.`,
    'hero.publication_date must use the format "Published Month Year".',
    'Every reference must include the primary source URL as an anchor with target="_blank" and rel="noopener noreferrer".',
    'If top_block.kind is "pills", include 2 to 6 pills; if "takeaway", omit end_takeaway.',
    ...issues.map(issue => `- ${issue}`),
    'Return only a valid JSON object starting with { and ending with }. No preamble, no markdown fences.',
  ].join('\n');
}
