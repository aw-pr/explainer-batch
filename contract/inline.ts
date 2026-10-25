// The two text types of the v2 explainer contract.
//
// PlainText is raw characters: no tag sequence and no HTML entity. The
// renderer escapes it on output.
//
// InlineText is a canonical HTML subset: em, strong, code, sub and sup with
// no attributes, and a with exactly one http(s) href, never nested. Text is
// escaped as &amp; &lt; &gt; &quot; and nothing else. A string is valid
// InlineText when sanitiseInline leaves it unchanged.

const BARE_TAGS = new Set(['em', 'strong', 'code', 'sub', 'sup']);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  ndash: '\u2013',
  mdash: '\u2014',
  hellip: '\u2026',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  laquo: '\u00ab',
  raquo: '\u00bb',
  middot: '\u00b7',
  bull: '\u2022',
  times: '\u00d7',
  divide: '\u00f7',
  minus: '\u2212',
  plusmn: '\u00b1',
  le: '\u2264',
  ge: '\u2265',
  ne: '\u2260',
  asymp: '\u2248',
  deg: '\u00b0',
  micro: '\u00b5',
  sup2: '\u00b2',
  sup3: '\u00b3',
  frac12: '\u00bd',
  frac14: '\u00bc',
  frac34: '\u00be',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  euro: '\u20ac',
  pound: '\u00a3',
  yen: '\u00a5',
  cent: '\u00a2',
  sect: '\u00a7',
  para: '\u00b6',
  larr: '\u2190',
  rarr: '\u2192',
  uarr: '\u2191',
  darr: '\u2193',
  alpha: '\u03b1',
  beta: '\u03b2',
  gamma: '\u03b3',
  delta: '\u03b4',
  epsilon: '\u03b5',
  lambda: '\u03bb',
  mu: '\u03bc',
  pi: '\u03c0',
  sigma: '\u03c3',
  tau: '\u03c4',
  theta: '\u03b8',
  omega: '\u03c9',
  Delta: '\u0394',
  Sigma: '\u03a3',
  Omega: '\u03a9',
  eacute: '\u00e9',
  egrave: '\u00e8',
  aacute: '\u00e1',
  agrave: '\u00e0',
  iacute: '\u00ed',
  oacute: '\u00f3',
  uacute: '\u00fa',
  auml: '\u00e4',
  ouml: '\u00f6',
  uuml: '\u00fc',
  ccedil: '\u00e7',
  ntilde: '\u00f1',
  szlig: '\u00df',
};

const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{0,31}));/g;
const TAG_START = /<\/?[a-zA-Z]/;
const ANY_ENTITY = /&(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{0,31});/;

// A comment, or an open/close tag whose attributes may hold quoted '>'.
const TOKEN = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTRIBUTE = /([^\s"'=<>/`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const HTTP_URL = /^https?:\/\/[^\s<>"]+$/i;

export function decodeEntities(s: string): string {
  return s.replace(ENTITY, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (dec !== undefined || hex !== undefined) {
      const code = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex as string, 16);
      if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\ufffd';
      return String.fromCodePoint(code);
    }
    const decoded = NAMED_ENTITIES[name as string];
    return decoded === undefined ? whole : decoded;
  });
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hrefOf(attributes: string): string | null {
  for (const m of attributes.matchAll(ATTRIBUTE)) {
    if (m[1].toLowerCase() !== 'href') continue;
    const raw = m[2] ?? m[3] ?? m[4] ?? '';
    const url = decodeEntities(raw).trim();
    if (!HTTP_URL.test(url)) return null;
    try {
      new URL(url);
    } catch {
      return null;
    }
    return url;
  }
  return null;
}

/**
 * Canonicalises inline markup: keeps the six allowed tags in their canonical
 * form, drops every other tag (and its attributes) while keeping its inner
 * text, closes anything left open, and re-escapes text so that only
 * &amp; &lt; &gt; &quot; remain. Idempotent.
 */
export function sanitiseInline(s: string): string {
  let out = '';
  const open: string[] = [];
  // One entry per <a> seen and not yet closed: whether it was kept.
  const anchors: boolean[] = [];
  let last = 0;

  const closeThrough = (name: string): void => {
    while (open.length > 0) {
      const top = open.pop() as string;
      out += `</${top}>`;
      if (top === name) return;
    }
  };

  for (const m of s.matchAll(TOKEN)) {
    out += escapeText(decodeEntities(s.slice(last, m.index)));
    last = (m.index as number) + m[0].length;
    if (m[2] === undefined) continue;

    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    if (name === 'a') {
      if (closing) {
        if (anchors.pop() === true && open.includes('a')) closeThrough('a');
        continue;
      }
      const href = open.includes('a') ? null : hrefOf(m[3]);
      anchors.push(href !== null);
      if (href !== null) {
        out += `<a href="${escapeText(href)}">`;
        open.push('a');
      }
      continue;
    }
    if (!BARE_TAGS.has(name)) continue;
    if (closing) {
      if (open.includes(name)) closeThrough(name);
    } else {
      out += `<${name}>`;
      open.push(name);
    }
  }
  out += escapeText(decodeEntities(s.slice(last)));
  while (open.length > 0) out += `</${open.pop()}>`;
  return out;
}

export function isInlineText(s: string): boolean {
  return sanitiseInline(s) === s;
}

/** Plain characters with no tag sequence and no HTML entity; `<70%` is fine. */
export function isPlainText(s: string): boolean {
  return !TAG_START.test(s) && !ANY_ENTITY.test(s);
}

function stripTags(s: string): string {
  return s.replace(TOKEN, '');
}

/** The plain copy of canonical InlineText, for search, cards and alt text. */
export function inlineToPlain(s: string): string {
  return decodeEntities(stripTags(s));
}

/**
 * Turns arbitrary model text into PlainText: strips tags and decodes
 * entities until neither changes, so `&lt;b&gt;` cannot resurface as a tag.
 * A named entity outside NAMED_ENTITIES is left in place and still fails
 * isPlainText.
 */
export function toPlain(s: string): string {
  let current = s;
  for (let i = 0; i < 8; i++) {
    const next = decodeEntities(stripTags(current));
    if (next === current) break;
    current = next;
  }
  return current.replace(/<(?=\/?[a-zA-Z])/g, '< ');
}
