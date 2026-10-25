export type LabelNoun = 'Figure' | 'Table' | 'Scheme' | 'Exhibit';

export interface LabelKey {
  noun: LabelNoun;
  number: string;
  panel?: string;
}

const NUMBER = '([A-Z]?\\d+|S\\d+|[IVXL]+)';
const PANEL_SUB = '(?:\\s*\\(?([a-z])\\)?)?(?:\\.(\\d+))?';

const CAPTION_RE = new RegExp(
  `^(Figure|Fig\\.?|FIGURE|Table|Tab\\.?|TABLE|Scheme|Exhibit)\\s*${NUMBER}${PANEL_SUB}\\s*(?:[:.]|(?=\\s+[A-Z(]))`,
);
const LABEL_RE = new RegExp(`^([A-Za-z]+\\.?)\\s*${NUMBER}${PANEL_SUB}(?![A-Za-z0-9])`);

const NOUNS: Record<string, LabelNoun> = {
  figure: 'Figure',
  fig: 'Figure',
  'fig.': 'Figure',
  table: 'Table',
  tab: 'Table',
  'tab.': 'Table',
  scheme: 'Scheme',
  exhibit: 'Exhibit',
};

function toKey(noun: LabelNoun, number: string, panel: string | undefined, sub: string | undefined): LabelKey {
  const key: LabelKey = { noun, number: sub ? `${number}.${sub}` : number };
  if (panel) key.panel = panel.toLowerCase();
  return key;
}

export function parseLabel(text: string): LabelKey | null {
  const m = LABEL_RE.exec(text.trim());
  if (!m) return null;
  const noun = NOUNS[m[1].toLowerCase()];
  return noun ? toKey(noun, m[2], m[3], m[4]) : null;
}

export function matchCaption(text: string): { key: LabelKey; continued: boolean } | null {
  const m = CAPTION_RE.exec(text);
  if (!m) return null;
  const noun = NOUNS[m[1].toLowerCase()];
  if (!noun) return null;
  const continued = /continued|cont\./i.test(text.slice(0, 40));
  return { key: toKey(noun, m[2], m[3], m[4]), continued };
}

export function labelsEqual(a: LabelKey, b: LabelKey): boolean {
  return a.noun === b.noun && a.number === b.number;
}

export function formatLabel(key: LabelKey): string {
  return `${key.noun} ${key.number}${key.panel ?? ''}`;
}
