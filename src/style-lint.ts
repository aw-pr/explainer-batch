export type StyleCheck = 'dash' | 'spelling' | 'banned-phrase' | 'number-not-in-body';

export interface StyleIssue {
  check: StyleCheck;
  path: string;
  message: string;
}

type Obj = Record<string, unknown>;

interface ProseField {
  path: string;
  text: string;
}

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function collectProseFields(j: Obj): ProseField[] {
  const fields: ProseField[] = [];
  const add = (path: string, value: unknown): void => {
    if (typeof value === 'string' && value) fields.push({ path, text: value });
  };
  const addAll = (path: string, values: unknown): void => {
    asArray(values).forEach((v, n) => add(`${path}[${n}]`, v));
  };

  const hero = isObj(j['hero']) ? j['hero'] : {};
  add('hero.title', hero['title']);
  add('hero.headline', hero['headline']);
  add('hero.subtitle', hero['subtitle']);

  const top = isObj(j['top_block']) ? j['top_block'] : {};
  asArray(top['pills']).forEach((pill, i) => {
    if (!isObj(pill)) return;
    add(`top_block.pills[${i}].lead`, pill['lead']);
    add(`top_block.pills[${i}].text`, pill['text']);
  });
  add('top_block.label', top['label']);
  add('top_block.body', top['body']);

  asArray(j['sections']).forEach((section, i) => {
    if (!isObj(section)) return;
    const at = `sections[${i}]`;
    add(`${at}.label`, section['label']);
    addAll(`${at}.paragraphs`, section['paragraphs']);
    if (isObj(section['list'])) {
      const list = section['list'];
      add(`${at}.list.intro`, list['intro']);
      asArray(list['items']).forEach((item, n) => {
        if (!isObj(item)) return;
        add(`${at}.list.items[${n}].label`, item['label']);
        add(`${at}.list.items[${n}].body`, item['body']);
      });
    }
    if (isObj(section['table'])) {
      add(`${at}.table.caption`, section['table']['caption']);
      addAll(`${at}.table.columns`, section['table']['columns']);
      asArray(section['table']['rows']).forEach((row, n) => addAll(`${at}.table.rows[${n}]`, row));
    }
  });

  const charts = asArray(j['charts']);
  if (charts.length > 0) {
    charts.forEach((chart, i) => {
      if (!isObj(chart)) return;
      add(`charts[${i}].title`, chart['title']);
      add(`charts[${i}].caption`, chart['caption']);
    });
  }

  const end = isObj(j['end_takeaway']) ? j['end_takeaway'] : {};
  add('end_takeaway.label', end['label']);
  add('end_takeaway.body', end['body']);

  return fields;
}

const stripTags = (s: string): string => s.replace(/<[^>]*>/g, ' ');

/** Text with tags, code, backticked spans and quoted spans blanked out, for word-level checks. */
function maskedWords(s: string): string {
  return stripTags(s.replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, ' '))
    .replace(/`[^`]*`/g, ' ')
    .replace(/"[^"]*"/g, ' ')
    .replace(/“[^”]*”/g, ' ');
}

function dashProblem(s: string): string | null {
  const text = stripTags(s);
  if (/—|―|&mdash;|&#8212;|&#x2014;/i.test(text)) return 'an em dash';
  if (/ -{1,2} /.test(text)) return 'a spaced hyphen';
  if (/(?<!\d)–|–(?!\d)/.test(text)) return 'an en dash outside a numeric range';
  return null;
}

const BRITISH_MAP: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^behavior(s|al|ally)?$/, (m) => `behaviour${m[1] ?? ''}`],
  [/^color(s|ed|ing|ful|less)?$/, (m) => `colour${m[1] ?? ''}`],
  [/^labor(s|ed|ing|er|ers)?$/, (m) => `labour${m[1] ?? ''}`],
  [/^favor(s|ed|ing|ite|ites|able|ably)?$/, (m) => `favour${m[1] ?? ''}`],
  [/^center(s)?$/, (m) => `centre${m[1] ?? ''}`],
  [/^centered$/, () => 'centred'],
  [/^centering$/, () => 'centring'],
  [/^modeling$/, () => 'modelling'],
  [/^modeled$/, () => 'modelled'],
  [/^labeled$/, () => 'labelled'],
  [/^labeling$/, () => 'labelling'],
  [/^defense(s)?$/, (m) => `defence${m[1] ?? ''}`],
  [/^catalog(s)?$/, (m) => `catalogue${m[1] ?? ''}`],
  [/^fulfill(s|ment)?$/, (m) => `fulfil${m[1] ?? ''}`],
  [/^(analy|paraly|cataly)z(e|es|ed|er|ers|ing)$/, (m) => `${m[1]}s${m[2]}`],
];

const IZE_EXCLUDED = /(?:size|sized|sizes|sizing)$|^seiz|^(?:prize|maize|baize)/;
const IZE_PATTERN = /^([a-z]{2,})iz(e|ed|es|ing|ation|ations)$/;

function britishFor(word: string): string | null {
  for (const [pattern, fix] of BRITISH_MAP) {
    const m = word.match(pattern);
    if (m) return fix(m);
  }
  if (IZE_EXCLUDED.test(word)) return null;
  const m = word.match(IZE_PATTERN);
  return m ? `${m[1]}is${m[2]}` : null;
}

function spellingProblems(s: string): string[] {
  const found: string[] = [];
  for (const m of maskedWords(s).matchAll(/(?<![A-Za-z])[a-z]+(?![A-Za-z])/g)) {
    const fix = britishFor(m[0]);
    if (fix) found.push(`${m[0]} (use ${fix})`);
  }
  return found;
}

const BANNED: RegExp[] = [
  /\bleverag(?:e|es|ed|ing)\b/gi,
  /\bseamless(?:ly)?\b/gi,
  /\bpain points?\b/gi,
  /\bsynerg(?:y|ies)\b/gi,
  /\bcircle back\b/gi,
  /\bdelv(?:e|es|ed|ing)\b/gi,
  /\bit(?:'|’)s worth noting\b/gi,
  /\bin conclusion\b/gi,
  /\bin summary\b/gi,
  /\bfascinating\b/gi,
  /\bcertainly\b/gi,
  /\bunlock(?:s|ed|ing)?\b/gi,
  /\bgame[- ]changers?\b/gi,
  /\bcutting-edge\b/gi,
  /\bnavigate the complexities\b/gi,
  /\btestament to\b/gi,
  /\btapestry\b/gi,
  /\bnot even close\b/gi,
  /\brobust(?:ly)?\b(?!\s+to\b)/gi,
];

const BANDWIDTH_AFTER_TECHNICAL = /(?:memory|hbm\d*|dram|network|bus|interconnect|link|pcie(?:[\s-]*\d+(?:\.\d+)?)?|nvlink|i\/o)[\s-]*$/i;
const BANDWIDTH_BEFORE_RATE = /^\s*(?:\(?[\d.,]+\s*)?[kmgtp]i?b\/s/i;

function bannedPhrases(s: string): string[] {
  const text = maskedWords(s);
  const found: string[] = [];
  for (const pattern of BANNED) {
    for (const m of text.matchAll(pattern)) found.push(m[0].toLowerCase());
  }
  for (const m of text.matchAll(/\bbandwidth\b/gi)) {
    const before = text.slice(0, m.index);
    const after = text.slice((m.index ?? 0) + m[0].length);
    if (BANDWIDTH_AFTER_TECHNICAL.test(before) || BANDWIDTH_BEFORE_RATE.test(after)) continue;
    found.push('bandwidth');
  }
  return [...new Set(found)];
}

function numbersIn(s: string): string[] {
  const text = stripTags(s).replace(/&#?\w+;/g, ' ');
  return (text.match(/\d+(?:,\d{3})*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ''));
}

function bodyNumbers(j: Obj): Set<string> {
  const numbers = new Set<string>();
  const take = (value: unknown): void => {
    if (typeof value === 'string') numbersIn(value).forEach((n) => numbers.add(n));
  };
  asArray(j['sections']).forEach((section) => {
    if (!isObj(section)) return;
    take(section['label']);
    asArray(section['paragraphs']).forEach(take);
    if (isObj(section['list'])) {
      take(section['list']['intro']);
      asArray(section['list']['items']).forEach((item) => {
        if (!isObj(item)) return;
        take(item['label']);
        take(item['body']);
      });
    }
    if (isObj(section['table'])) {
      const table = section['table'];
      take(table['caption']);
      asArray(table['columns']).forEach(take);
      asArray(table['rows']).forEach((row) => asArray(row).forEach(take));
    }
  });
  return numbers;
}

function numberIssues(j: Obj): StyleIssue[] {
  const claims: Array<[string, unknown]> = [];
  const hero = isObj(j['hero']) ? j['hero'] : {};
  claims.push(['hero.headline', hero['headline']]);
  const top = isObj(j['top_block']) ? j['top_block'] : {};
  asArray(top['pills']).forEach((pill, i) => {
    if (isObj(pill)) claims.push([`top_block.pills[${i}].lead`, pill['lead']]);
  });

  const body = bodyNumbers(j);
  const issues: StyleIssue[] = [];
  for (const [path, value] of claims) {
    if (typeof value !== 'string') continue;
    const missing = [...new Set(numbersIn(value))].filter((n) => !body.has(n));
    if (missing.length === 0) continue;
    issues.push({
      check: 'number-not-in-body',
      path,
      message: `${missing.join(', ')} does not appear in the body or its tables. Change this text to a number the body already states; do not add a number to the body.`,
    });
  }
  return issues;
}

export function lintStyle(json: unknown): StyleIssue[] {
  if (!isObj(json)) return [];
  const issues: StyleIssue[] = [];

  for (const { path, text } of collectProseFields(json)) {
    const dash = dashProblem(text);
    if (dash) {
      issues.push({
        check: 'dash',
        path,
        message: `Contains ${dash}. Use a comma, parentheses or a rewrite instead.`,
      });
    }
    const spelling = spellingProblems(text);
    if (spelling.length > 0) {
      issues.push({
        check: 'spelling',
        path,
        message: `American spelling: ${spelling.join(', ')}. Use British English.`,
      });
    }

    const banned = bannedPhrases(text);
    if (banned.length > 0) {
      issues.push({
        check: 'banned-phrase',
        path,
        message: `Banned wording: ${banned.join(', ')}. Rewrite in plain words.`,
      });
    }
  }

  issues.push(...numberIssues(json));
  return issues;
}
