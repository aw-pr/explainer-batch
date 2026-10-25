import { NumberToken, tokenisePage, valueMatchesToken } from './numbers';

export interface PageText {
  page: number;
  lines: string[];
  tokens: NumberToken[];
  usable: boolean;
}

export interface ChartInput {
  x: { values: (string | number)[]; label?: string; unit?: string; type?: string };
  y?: { label?: string; unit?: string; scale?: string };
  caption?: string;
}

export interface SeriesInput {
  name: string;
  values?: (number | null)[];
  points?: { x: number; y: number }[];
  source: { kind: string; ref: string; page?: number };
}

export interface SeriesMatch {
  pass: boolean;
  tier?: 'A' | 'B';
  page?: number;
  reason?: string;
  unmatched: number[];
}

export function pageTextFromLines(page: number, lines: string[], usable: boolean): PageText {
  return { page, lines, tokens: tokenisePage(lines), usable };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function labelMatches(line: string, label: string | number | undefined): boolean {
  if (label === undefined) return false;
  const name = String(label).trim();
  if (!name) return false;
  const words = name.match(/[\p{L}]{4,}/gu) ?? [];
  const alternatives = words.length > 0 ? words : [name];
  return alternatives.some(word => new RegExp(
    `(?<![\\p{L}\\p{N}_])${escapeRegExp(word).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}_])`,
    'iu',
  ).test(line));
}

function isYear(value: string | number): boolean {
  return /^(19|20)\d{2}$/.test(String(value));
}

function eligibleTokens(chart: ChartInput, page: PageText): NumberToken[] {
  const years = chart.x.values.length > 0 && chart.x.values.every(isYear);
  return page.tokens.filter(token => {
    if (token.decimals === 0 && Number.isInteger(token.value)) {
      if (page.lines[token.line]?.trim() === token.text && /^[+−–-]?[\d,]+$/.test(token.text)) return false;
      if (!years && token.value >= 1900 && token.value <= 2099) return false;
    }
    return true;
  });
}

function captionId(ref: string, kind: 'table' | 'figure'): string | undefined {
  const pattern = kind === 'table' ? /\bTable\s+([A-Za-z]*\d+[A-Za-z]*)\b/i
    : /\b(?:Figure|Fig\.)\s+([A-Za-z]*\d+[A-Za-z]*)\b/i;
  return ref.match(pattern)?.[1];
}

function captionPattern(kind: 'table' | 'figure', id: string): RegExp {
  const prefix = kind === 'table' ? 'Table' : '(?:Figure|Fig\\.)';
  return new RegExp(`^\\s*${prefix}\\s+${escapeRegExp(id)}\\b`, 'i');
}

function tableRegion(page: PageText, caption: number, tokens: NumberToken[]): Set<number> {
  const boundary = /^\s*(?:Table|Figure|Fig\.)\s+\S+/i;
  const numericLines = new Set(tokens.map(token => token.line));
  const scan = (direction: number): { lines: number[]; numeric: boolean } => {
    const lines = [caption];
    let numeric = false;
    let blanks = 0;
    for (let i = caption + direction; i >= 0 && i < page.lines.length; i += direction) {
      if (boundary.test(page.lines[i])) break;
      blanks = page.lines[i].trim() === '' ? blanks + 1 : 0;
      if (numeric && blanks === 2) break;
      lines.push(i);
      if (numericLines.has(i)) numeric = true;
    }
    return { lines, numeric };
  };
  const down = scan(1);
  return new Set(down.numeric ? down.lines : scan(-1).lines);
}

function normaliseText(text: string): string {
  return text.replace(/(\p{L})-[\t ]*\r?\n[\t ]*(?=\p{L})/gu, '$1').replace(/\s+/g, ' ').trim();
}

export function matchSeries(
  chart: ChartInput,
  series: SeriesInput,
  pageText: (page: number) => PageText | null,
): SeriesMatch {
  const entries = (series.values ?? series.points?.map(point => point.y) ?? [])
    .map((value, index) => ({ value, index }))
    .filter((entry): entry is { value: number; index: number } =>
      typeof entry.value === 'number' && Number.isFinite(entry.value));
  const values = entries.map(entry => entry.value);
  const fail = (reason: string, unmatched = values): SeriesMatch => ({ pass: false, reason, unmatched });
  const { kind, ref, page: cited } = series.source;
  if (!['table', 'text', 'value_labels'].includes(kind)) return fail(`Unsupported source kind: ${kind}`);
  if (values.length === 0) return fail('Series has no numeric values');
  if (cited === undefined) return fail(`${kind} source has no cited page`);

  const percentAxis = [chart.y?.unit, chart.y?.label, series.name].some(text => text?.includes('%'));
  const matches = (value: number, token: NumberToken): boolean => valueMatchesToken(value, token, { percentAxis });
  const absent = (tokens: NumberToken[]): number[] => values.filter(value => !tokens.some(token => matches(value, token)));
  const tableId = captionId(ref, 'table');
  const figureId = captionId(ref, 'figure');
  let firstFailure: SeriesMatch | undefined;
  let foundTable = false;

  for (const pageNumber of [cited, cited - 1, cited + 1]) {
    const page = pageText(pageNumber);
    if (!page) continue;
    const tokens = eligibleTokens(chart, page);
    let verdict: SeriesMatch;

    if (kind === 'table') {
      const caption = tableId === undefined ? -1 : page.lines.findIndex(line => captionPattern('table', tableId).test(line));
      if (caption < 0) {
        verdict = fail(`Table ${tableId ?? ref} not found`);
      } else {
        foundTable = true;
        const region = tableRegion(page, caption, tokens);
        const unit = tokens.filter(token => region.has(token.line));
        const unmatched = absent(unit);
        const row = [...region].some(line => labelMatches(page.lines[line], series.name)
          && values.every(value => unit.some(token => token.line === line && matches(value, token))));
        const columns = entries.map(({ value, index }) => unit.filter(token =>
          matches(value, token) && labelMatches(page.lines[token.line], chart.x.values[index])));
        // A shared band must admit one candidate for every value, including repeated values.
        const column = columns.every(candidates => candidates.length > 0)
          && columns.flat().some(start => columns.every(candidates => candidates.some(token =>
            token.column >= start.column && token.column <= start.column + 12)));
        if (row || column) verdict = { pass: true, tier: 'A', unmatched: [] };
        else if (values.length >= 3 && values.every(value => unit.some(token => token.sig >= 3 && matches(value, token)))) {
          verdict = { pass: true, tier: 'B', unmatched: [] };
        } else verdict = fail('Values do not satisfy table layout or tier B precision', unmatched);
      }
    } else if (kind === 'text') {
      const fragment = normaliseText(ref);
      const raw = page.lines.join('\n');
      const text = normaliseText(raw);
      const fragmentTokens = tokenisePage([fragment]);
      if (fragment.length < 20 || fragment.length > 160 || (fragment.match(/\p{L}+/gu)?.length ?? 0) < 3) {
        verdict = fail('Text fragment needs 20 to 160 characters and at least three alphabetic words', absent(fragmentTokens));
      } else {
        const lineOffsets: number[] = [];
        let offset = 0;
        for (const line of page.lines) {
          lineOffsets.push(offset);
          offset += line.length + 1;
        }
        const positions = tokens.map(token => ({
          token,
          // The sentinel preserves collapsed whitespace immediately before a token.
          offset: normaliseText(raw.slice(0, lineOffsets[token.line] + token.column) + '#').length - 1,
        }));
        let best: number[] | undefined;
        for (let start = text.indexOf(fragment); start >= 0; start = text.indexOf(fragment, start + 1)) {
          const unit = positions.filter(item => item.offset >= start
            && item.offset + normaliseText(item.token.text).length <= start + fragment.length).map(item => item.token);
          const unmatched = absent(unit);
          if (best === undefined || unmatched.length < best.length) best = unmatched;
          if (unmatched.length === 0) break;
        }
        verdict = best?.length === 0 ? { pass: true, unmatched: [] }
          : fail(best === undefined ? 'Text fragment not found on page' : 'Values not found in text fragment', best ?? values);
      }
    } else {
      const caption = figureId !== undefined && page.lines.some(line => captionPattern('figure', figureId).test(line));
      if (!caption && !page.usable) verdict = fail('No figure caption or usable page text');
      else {
        const precise = tokens.filter(token => token.sig >= 3 || token.decimals >= 2);
        const placed = entries.every(({ value, index }) => precise.some(token => matches(value, token)
          && (values.length >= 3 || labelMatches(page.lines[token.line], series.name)
            || labelMatches(page.lines[token.line], chart.x.values[index]))));
        verdict = placed ? { pass: true, unmatched: [] }
          : fail('Value labels need printed precision and, for short series, labels on their lines', absent(tokens));
      }
    }
    verdict.page = page.page;
    if (verdict.pass) return verdict;
    firstFailure ??= verdict;
  }

  if (kind === 'table' && !foundTable) {
    return { ...fail(`Table ${tableId ?? ref} not found on page ${cited} (searched ${cited - 1} to ${cited + 1})`),
      ...(firstFailure ? { page: firstFailure.page } : {}) };
  }
  return firstFailure ?? fail(`No page text found on page ${cited} (searched ${cited - 1} to ${cited + 1})`);
}
