import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { INPUT_DIR } from './output';
import { stripHtml } from './text';
import type { DetectedCitation, FigureCandidate, RecreateDirective } from './state';
import { toPlain } from '../contract/inline';
import { isPdfUrl } from './figure-vlm';
import { formatLabel } from './figure-locator/label';
import { decodeHtmlEntities, isWrapperClass, labelFromHints, resolveSources, RawSource } from './figure-locator/dom-figures';

const URLS_FILE = path.join(INPUT_DIR, 'urls.txt');

const HTML_FETCH_MAX_BYTES = 200_000;

// Bounds how many DOM figure candidates get persisted per paper (state.json
// is fully re-serialised on every op; a stray page with dozens of inline
// images should not bloat it unbounded).
const MAX_FIGURE_CANDIDATES = 20;

export interface InputItem {
  /** Stable identifier used as batch custom_id */
  customId: string;
  /** Original reference: filename (PDFs) or full URL */
  input: string;
  source: InputSource;
  isUrl: boolean;
  /** Local file path for local PDFs */
  filePath?: string;
  /** Base64-encoded PDF data for local files */
  base64Data?: string;
  /** Stripped text content for HTML URLs (non-PDF web pages) */
  htmlContent?: string;
  /** Per-paper emphasis hint from a sidecar file or urls.txt suffix */
  focusHint?: string;
  /** Explicit lead-figure override from focus directives (image:/image_caption:/image_alt:) */
  imageOverride?: ImageOverride;
  /** DOM figure candidates parsed from the raw HTML (URL sources only), persisted so collect-time figure extraction can fetch the asset directly instead of re-rendering the live page. */
  figureCandidates?: FigureCandidate[];
  /** Figure-recreation directive from focus directives (recreate:/recreate_x:/recreate_y:/data:) */
  recreate?: RecreateDirective;
  detectedCitation?: DetectedCitation;
  publishedOn?: string;
}

export interface ImageOverride {
  source_figure?: string;
  caption?: string;
  alt_text?: string;
  /** Optional 1-based page hint that short-circuits caption search in figure-extract. */
  pageHint?: number;
  forceRegionCrop?: boolean;
}

interface FocusDirectives {
  focusHint?: string;
  imageOverride?: ImageOverride;
  recreate?: RecreateDirective;
}

/** Normalise "fig 3" / "Fig. 3a" / "figure 3" to "Figure 3" / "Figure 3a". */
function normalizeFigureLabel(raw: string): string {
  const trimmed = raw.trim();
  return /^fig\b\.?$/i.test(trimmed.split(/\s+/)[0])
    ? trimmed.replace(/^fig\.?/i, 'Figure').replace(/\s+/g, ' ').trim()
    : trimmed.replace(/^figure/i, 'Figure');
}

export function parseFocusDirectives(raw: string): FocusDirectives {
  const lines = raw.split('\n');
  const remaining: string[] = [];
  let sourceFigure: string | undefined;
  let caption: string | undefined;
  let altText: string | undefined;
  let pageHint: number | undefined;
  let forceRegionCrop: boolean | undefined;
  let recreateRaw: string | undefined;
  let recreateX: string | undefined;
  let recreateY: string | undefined;
  let dataFile: string | undefined;
  let sawImageKey = false;

  const figDirective = /^\s*image\s*:\s*((?:figure|fig\.?)\s*\d+(?:\.\d+)?[a-z]?)\s*$/i;
  const captionDirective = /^\s*image[_-]caption\s*:\s*(.+?)\s*$/i;
  const altDirective = /^\s*image[_-]alt\s*:\s*(.+?)\s*$/i;
  const pageHintDirective = /^\s*image[_-]page[_-]hint\s*:\s*(.+?)\s*$/i;
  const rasterDirective = /^\s*image[_-]raster\s*:\s*(.*?)\s*$/i;
  const recreateDirective = /^\s*recreate\s*:\s*(.+?)\s*$/i;
  const recreateXDirective = /^\s*recreate[_-]x\s*:\s*(.+?)\s*$/i;
  const recreateYDirective = /^\s*recreate[_-]y\s*:\s*(.+?)\s*$/i;
  const dataDirective = /^\s*data\s*:\s*(\S+\.(?:csv|json))\s*$/i;

  for (const line of lines) {
    let m = line.match(figDirective);
    if (m) {
      sourceFigure = normalizeFigureLabel(m[1]);
      sawImageKey = true;
      continue;
    }
    m = line.match(captionDirective);
    if (m) { caption = m[1]; sawImageKey = true; continue; }
    m = line.match(altDirective);
    if (m) { altText = m[1]; sawImageKey = true; continue; }
    m = line.match(pageHintDirective);
    if (m) {
      const n = Number.parseInt(m[1].trim(), 10);
      if (Number.isFinite(n) && n > 0) pageHint = n;
      sawImageKey = true;
      continue;
    }
    m = line.match(rasterDirective);
    if (m) { forceRegionCrop = /^(true|yes|1|on)$/i.test(m[1]); sawImageKey = true; continue; }
    m = line.match(recreateDirective);
    if (m) { recreateRaw = m[1]; continue; }
    m = line.match(recreateXDirective);
    if (m) { recreateX = m[1]; continue; }
    m = line.match(recreateYDirective);
    if (m) { recreateY = m[1]; continue; }
    m = line.match(dataDirective);
    if (m) { dataFile = m[1]; continue; }
    const unknownImageKey = line.match(/^\s*(image_[^:\s]*)\s*:/i);
    if (unknownImageKey) {
      console.warn(`  ⚠ unrecognised image directive: ${unknownImageKey[1]}`);
      continue;
    }
    remaining.push(line);
  }

  const focusHint = remaining.join('\n').trim() || undefined;
  const imageOverride = sawImageKey
    ? { source_figure: sourceFigure, caption, alt_text: altText, pageHint, ...(forceRegionCrop !== undefined && { forceRegionCrop }) }
    : undefined;

  // recreate: yes|no|Figure N. Any recreate_x/recreate_y/data directive
  // implies enabled, so a sidecar can carry just axis hints or a data file.
  let recreate: RecreateDirective | undefined;
  if (recreateRaw !== undefined || recreateX || recreateY || dataFile) {
    const rawVal = (recreateRaw ?? '').trim();
    const enabled = !/^(no|off|false|0)$/i.test(rawVal);
    const target = /^(?:figure|fig\.?)\s*\d/i.test(rawVal) ? normalizeFigureLabel(rawVal) : undefined;
    recreate = { enabled, target, xHint: recreateX, yHint: recreateY, dataFile };
  }

  return { focusHint, imageOverride, recreate };
}

export interface InputSource {
  kind: 'url' | 'local_pdf';
  url?: string;
  filename?: string;
  filePath?: string;
  cachedPdfPath?: string;
}

function readPdfFocus(filename: string): FocusDirectives {
  const base = filename.replace(/\.pdf$/i, '');
  const sidecar = path.join(INPUT_DIR, base + '.focus.md');
  if (!fs.existsSync(sidecar)) return {};
  const text = fs.readFileSync(sidecar, 'utf8').trim();
  if (!text) return {};
  return parseFocusDirectives(text);
}

function splitUrlAndFocus(line: string): FocusDirectives & { url: string } {
  const m = line.match(/^(\S+)\s+#\s*focus\s*:\s*(.+)$/i);
  if (!m) return { url: line };
  const parsed = parseFocusDirectives(m[2].trim());
  return { url: m[1], ...parsed };
}

function imageOverrideLog(override: ImageOverride): string {
  if (override.source_figure) return `image override: ${override.source_figure}`;
  if (override.pageHint) return `image override: page hint ${override.pageHint}`;
  if (override.caption || override.alt_text) return 'image override: caption or alt text';
  return 'image override';
}

// Sanitising + truncating filenames/URLs can collapse distinct inputs onto
// the same customId, which would silently overwrite one request with the
// other. Suffix deterministically (-2, -3, ...) within the length budget.
function dedupeCustomId(base: string, used: Set<string>, maxLen: number): string {
  let id = base;
  for (let n = 2; used.has(id); n += 1) {
    const suffix = `-${n}`;
    id = base.slice(0, maxLen - suffix.length) + suffix;
  }
  used.add(id);
  return id;
}

function extractTagAttr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i')) ?? tag.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i'));
  return m?.[1];
}

function resolveImgSrc(imgTag: string, pageUrl: string): string | undefined {
  const src = extractTagAttr(imgTag, 'src') ?? extractTagAttr(imgTag, 'data-src') ?? extractTagAttr(imgTag, 'data-original');
  if (!src) return undefined;
  try {
    return new URL(src, pageUrl).toString();
  } catch {
    return undefined;
  }
}

// Mirrors the "Figure N" normalisation in parseFocusDirectives's figDirective
// handling ("Fig." / "figure" both fold to "Figure N"), applied here to a
// figcaption's leading label instead of a whole focus-directive line.
const FIGCAPTION_LABEL_RE = /^\s*(fig\.?|figure)\s*(\d+(?:\.\d+)?[a-z]?)\b\.?:?/i;

function parseSourceFigureLabel(figcaption: string): string | undefined {
  const m = figcaption.match(FIGCAPTION_LABEL_RE);
  return m ? `Figure ${m[2]}` : undefined;
}

/** Word-bounded attribute read, so `src` never matches inside `data-src` or `srcset`. */
function tagAttr(tag: string, name: string): string | undefined {
  const m = new RegExp(`[\\s"'/]${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  return m ? m[1] ?? m[2] ?? m[3] : undefined;
}

function imgRawSources(imgTag: string): RawSource[] {
  const src = ['src', 'data-src', 'data-original'].map(name => tagAttr(imgTag, name)).find(v => v && !/^data:/i.test(v));
  const srcset = tagAttr(imgTag, 'srcset');
  return [...(src ? [{ url: src }] : []), ...(srcset ? [{ srcset }] : [])];
}

/** Each `<img>` (src, then its largest srcset entry), then each `<picture><source srcset>`, then each `<object data>`. */
function figureRawSources(block: string): RawSource[] {
  const raw: RawSource[] = [];
  for (const img of block.match(/<img\b[^>]*>/gi) ?? []) raw.push(...imgRawSources(img));
  for (const picture of block.match(/<picture\b[^>]*>[\s\S]*?<\/picture>/gi) ?? []) {
    for (const source of picture.match(/<source\b[^>]*>/gi) ?? []) {
      const srcset = tagAttr(source, 'srcset');
      if (srcset) raw.push({ srcset });
    }
  }
  for (const object of block.match(/<object\b[^>]*>/gi) ?? []) {
    const data = tagAttr(object, 'data');
    if (data) raw.push({ url: data });
  }
  return raw;
}

function snapshotLabel(openTag: string, figcaption: string | undefined, captionOpenTag: string | undefined): string | undefined {
  const decoded = (name: string) => {
    const value = tagAttr(openTag, name);
    return value === undefined ? undefined : decodeHtmlEntities(value);
  };
  const key = labelFromHints({
    captionText: figcaption,
    figureStyle: tagAttr(openTag, 'style'),
    captionStyle: captionOpenTag ? tagAttr(captionOpenTag, 'style') : undefined,
    ariaLabel: decoded('aria-label'),
    id: decoded('id'),
    dataLabel: decoded('data-label'),
  });
  return key ? formatLabel(key) : undefined;
}

/**
 * Regex-based DOM figure-candidate scan (Node has no DOM). Every `<figure>`
 * with an asset is a candidate; only on a page with no `<figure>` does a bare
 * `<img>` in a whole-token `chart`/`figure`/`graph`/`plot` class wrapper count.
 * `imgSrc`, `figcaption`, `alt` and `sourceFigure` keep the values the legacy
 * snapshot path reads; `label` and `sources` carry the richer extraction.
 * Runs on the FULL raw HTML, before the strip+truncate below, so a late
 * figure is never lost to the size cap.
 */
export function parseFigureCandidates(raw: string, pageUrl: string): FigureCandidate[] {
  const candidates: FigureCandidate[] = [];
  const seen = new Set<string>();
  const record = (candidate: FigureCandidate): void => {
    const key = candidate.imgSrc || candidate.sources?.[0];
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  const captionRe = /<figcaption\b([^>]*)>([\s\S]*?)<\/figcaption>/i;
  const figureRe = /<figure\b([^>]*)>([\s\S]*?)<\/figure>/gi;
  let m: RegExpExecArray | null;
  while ((m = figureRe.exec(raw)) && candidates.length < MAX_FIGURE_CANDIDATES) {
    const block = m[2];
    const imgMatch = block.match(/<img\b[^>]*>/i);
    const imgSrc = (imgMatch && resolveImgSrc(imgMatch[0], pageUrl)) || '';
    const sources = resolveSources(figureRawSources(block), pageUrl);
    const alt = imgMatch ? extractTagAttr(imgMatch[0], 'alt') : undefined;
    const capMatch = block.match(captionRe);
    const figcaption = capMatch ? stripHtml(capMatch[2]) || undefined : undefined;
    const sourceFigure = figcaption ? parseSourceFigureLabel(figcaption) : undefined;
    const label = snapshotLabel(m[0], figcaption, capMatch ? capMatch[0] : undefined);
    record({ imgSrc, figcaption, alt, sourceFigure, ...(label && { label }), sources });
  }
  if (/<figure\b/i.test(raw)) return candidates;

  // Wrapper pass, for pages with no <figure>: scans a bounded window after the
  // wrapper's opening tag rather than trying to balance nested tags with regex.
  const WRAPPER_WINDOW = 2000;
  const wrapperRe = /<(?:div|span|section)\b[^>]*>/gi;
  while ((m = wrapperRe.exec(raw)) && candidates.length < MAX_FIGURE_CANDIDATES) {
    const className = tagAttr(m[0], 'class');
    if (!className || !isWrapperClass(className)) continue;
    const windowText = raw.slice(m.index, m.index + WRAPPER_WINDOW);
    const imgMatch = windowText.match(/<img\b[^>]*>/i);
    if (!imgMatch) continue;
    const imgSrc = resolveImgSrc(imgMatch[0], pageUrl) ?? '';
    const sources = resolveSources(imgRawSources(imgMatch[0]), pageUrl);

    const alt = extractTagAttr(imgMatch[0], 'alt');
    const capMatch = windowText.match(captionRe);
    const figcaption = capMatch ? stripHtml(capMatch[2]) || undefined : undefined;
    const sourceFigure = figcaption ? parseSourceFigureLabel(figcaption) : undefined;
    const label = snapshotLabel(m[0], figcaption, capMatch ? capMatch[0] : undefined);
    record({ imgSrc, figcaption, alt, sourceFigure, ...(label && { label }), sources });
  }

  return candidates;
}

function collectMetaAuthors(raw: string): string[] {
  const out: string[] = [];
  const metaRe = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(raw))) {
    const key = (extractTagAttr(m[0], 'name') ?? extractTagAttr(m[0], 'property') ?? '').toLowerCase();
    if (key === 'citation_author' || key === 'author' || key === 'dc.creator') {
      const content = extractTagAttr(m[0], 'content');
      if (content) out.push(content);
    }
  }
  return out;
}

// arXiv/LaTeXML fulltext marks each author with a `ltx_personname` span; the
// name is the text node immediately inside it, before the affiliation spans.
function collectLtxAuthors(raw: string): string[] {
  const out: string[] = [];
  const re = /class\s*=\s*["'][^"']*ltx_personname[^"']*["'][^>]*>([^<]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const name = stripHtml(m[1]).trim();
    if (name) out.push(name);
  }
  return out;
}

function joinAuthorNames(names: string[]): string | undefined {
  const cleaned = names.map(n => n.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const seen = new Set<string>();
  const uniq = cleaned.filter(n => {
    const k = n.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return uniq.length ? uniq.slice(0, 8).join(', ') : undefined;
}

/**
 * Ordered author list from a fetched HTML document. Prefers citation/meta author
 * tags, falls back to arXiv `ltx_personname` spans. Deterministic so the model
 * is handed the byline rather than fishing it out of page chrome (the arXiv HTML
 * nav bar sits above the author line in the stripped text). Used as the fallback
 * when the arXiv `/abs/` lookup is unavailable (non-arXiv pages, or an
 * abstract-page fetch failure).
 */
export function extractAuthorList(raw: string): string[] {
  const head = raw.slice(0, 400_000); // authors sit near the top; bound the scan
  const found = collectMetaAuthors(head);
  return found.length ? found : collectLtxAuthors(head);
}

export function extractAuthors(raw: string): string | undefined {
  return joinAuthorNames(extractAuthorList(raw));
}

/** First author's surname from either "Surname, First" or "First Last" form. */
export function surnameOf(name: string): string {
  const n = name.trim();
  if (n.includes(',')) return n.split(',')[0].trim();
  const parts = n.split(/\s+/);
  return parts[parts.length - 1] || n;
}

function arxivAbsUrl(htmlUrl: string): string | null {
  const m = htmlUrl.match(/^(https?:\/\/arxiv\.org)\/html\/([^\s#?]+)/i);
  return m ? `${m[1]}/abs/${m[2]}` : null;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Reads a `<meta name|property="…" content="…">` value by name, order-agnostic. */
function metaByName(raw: string, name: string): string | undefined {
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  const target = name.toLowerCase();
  while ((m = re.exec(raw))) {
    const key = (extractTagAttr(m[0], 'name') ?? extractTagAttr(m[0], 'property') ?? '').toLowerCase();
    if (key === target) {
      const content = extractTagAttr(m[0], 'content');
      if (content) return content;
    }
  }
  return undefined;
}

interface CitationMeta {
  authors: string[];
  title?: string;
  date?: string;
  doi?: string;
  journal?: string;
}

/**
 * Highwire/Google-Scholar `citation_*` meta tags, emitted by arXiv `/abs/`, Nature,
 * and virtually every academic publisher. This is the reliable, deterministic
 * source for the byline, date, and reference — independent of the page's body
 * markup (which varies) and the model (which fabricates).
 */
function extractCitationMeta(raw: string): CitationMeta {
  return {
    authors: collectMetaAuthors(raw),
    title: metaByName(raw, 'citation_title'),
    date: metaByName(raw, 'citation_date')
      ?? metaByName(raw, 'citation_publication_date')
      ?? metaByName(raw, 'citation_online_date'),
    doi: metaByName(raw, 'citation_doi'),
    journal: metaByName(raw, 'citation_journal_title'),
  };
}

export function buildCitation(meta: CitationMeta, sourceUrl: string): DetectedCitation | undefined {
  const title = toPlain(meta.title ?? '').trim();
  const names = meta.authors.map(name => toPlain(name).trim()).filter(Boolean);
  if (!title || names.length === 0) return undefined;
  const authors = names.map(name => {
    const family = surnameOf(name);
    const givenNames = name.includes(',')
      ? name.split(',').slice(1).join(' ').trim()
      : name.split(/\s+/).slice(0, -1).join(' ');
    const given = givenNames.split(/\s+/).filter(Boolean)
      .map(part => `${part[0].toUpperCase()}.`).join(' ');
    return { family: toPlain(family), ...(given ? { given: toPlain(given) } : {}) };
  });
  const year = toPlain(meta.date ?? '').match(/\d{4}/)?.[0];
  const doi = toPlain(meta.doi ?? '').trim();
  const journal = toPlain(meta.journal ?? '').trim();
  const source = toPlain(sourceUrl);
  const absUrl = arxivAbsUrl(source);
  const venue = doi ? journal : absUrl
    ? `arXiv preprint arXiv:${absUrl.split('/abs/')[1].replace(/v\d+$/i, '')}`
    : journal;
  const url = doi ? `https://doi.org/${doi.replace(/^doi:/i, '')}` : absUrl ?? source;
  return {
    authors,
    ...(year ? { year: Number(year) } : {}),
    title,
    ...(venue ? { venue: toPlain(venue) } : {}),
    url: toPlain(url),
  };
}

export function publishedOnFrom(date?: string): string | undefined {
  const match = date?.match(/^(\d{4})[/-](\d{1,2})(?=$|[/-]\d{1,2}(?:$|[T\s]))/);
  if (!match) return undefined;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? `${match[1]}-${String(month).padStart(2, '0')}` : undefined;
}

/**
 * Fetch citation metadata from an arXiv paper's `/abs/` page. arXiv HTML fulltext
 * omits the `citation_*` meta (and some converters emit no author marker at all),
 * but the abstract page always carries it. Best-effort: null on non-arXiv or fetch
 * failure. Non-arXiv pages carry their own inline `citation_*` meta, read directly.
 */
async function fetchArxivAbsCitation(url: string): Promise<CitationMeta | null> {
  const absUrl = arxivAbsUrl(url);
  if (!absUrl) return null;
  try {
    const res = await fetch(absUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; explainer-batch/1.0)' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return extractCitationMeta(await res.text());
  } catch {
    return null;
  }
}

interface FetchedHtml {
  text?: string;
  candidates: FigureCandidate[];
  detectedCitation?: DetectedCitation;
  publishedOn?: string;
}

async function fetchHtmlContent(url: string): Promise<FetchedHtml> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; explainer-batch/1.0)' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.warn(`  ⚠ URL fetch failed (${res.status}): ${url}`);
      return { candidates: [] };
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/pdf')) return { candidates: [] }; // let document block handle it
    const raw = await res.text();
    const candidates = parseFigureCandidates(raw, url);
    let text = stripHtml(raw.slice(0, HTML_FETCH_MAX_BYTES * 3)).slice(0, HTML_FETCH_MAX_BYTES); // strip first, then truncate

    // Prefer the page's own citation_* meta (Nature and most journals emit it
    // inline). arXiv HTML fulltext omits it, so fall back to the /abs/ page.
    let meta = extractCitationMeta(raw);
    if (meta.authors.length === 0) {
      const abs = await fetchArxivAbsCitation(url);
      if (abs && abs.authors.length > 0) meta = abs;
    }
    // Last resort for pages with no citation meta at all: body author markup.
    const authorList = meta.authors.length > 0 ? meta.authors : extractAuthorList(raw);
    const authors = joinAuthorNames(authorList);
    const detectedCitation = buildCitation({ ...meta, authors: authorList }, url);
    const publishedOn = publishedOnFrom(meta.date);
    const publicationDate = publishedOn
      ? `Published ${MONTHS[Number(publishedOn.slice(5)) - 1]} ${publishedOn.slice(0, 4)}`
      : undefined;
    if (text && (authors || publicationDate)) {
      const lines: string[] = [];
      if (authors) lines.push(`Detected paper author(s): ${authors}`);
      if (publicationDate) lines.push(`Detected publication date: ${publicationDate}`);
      lines.push('Use these for the byline and publication date unless the paper text clearly contradicts them.');
      text = `${lines.join('\n')}\n\n${text}`;
    }
    return { text, candidates, detectedCitation, publishedOn };
  } catch (err) {
    console.warn(`  ⚠ URL fetch error: ${url} — ${err instanceof Error ? err.message : String(err)}`);
    return { candidates: [] };
  }
}

async function cachePdfUrl(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new Error('response does not start with %PDF-');
    }
    const cacheDir = path.resolve(process.env.PDF_CACHE_DIR || path.join(INPUT_DIR, '_cache', 'pdf'));
    const hash = createHash('sha256').update(bytes).digest('hex');
    const cachedPath = path.join(cacheDir, `${hash}.pdf`);
    fs.mkdirSync(cacheDir, { recursive: true });
    try {
      fs.writeFileSync(cachedPath, bytes, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    return cachedPath;
  } catch (error) {
    console.warn(`  ⚠ PDF download failed: ${url}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/**
 * Scans input/ for PDFs and optionally input/urls.txt for remote URLs.
 * Reads local PDFs into base64 for inline batch embedding.
 * HTML web URLs are fetched and stripped to text; PDF URLs are cached locally and sent as URL document blocks.
 */
export async function preprocessInputs(): Promise<InputItem[]> {
  const items: InputItem[] = [];
  const usedCustomIds = new Set<string>();

  // ── Local PDFs ──────────────────────────────────────────────────────────────
  const pdfs = fs.readdirSync(INPUT_DIR)
    .filter(f => f.toLowerCase().endsWith('.pdf'));

  for (const filename of pdfs) {
    const customId = dedupeCustomId(
      ('explainer-' + filename.replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9_-]/g, '-')).slice(0, 64),
      usedCustomIds,
      64,
    );
    const filePath = path.join(INPUT_DIR, filename);
    const sizeKb   = Math.round(fs.statSync(filePath).size / 1024);
    const base64Data = fs.readFileSync(filePath).toString('base64');
    const { focusHint, imageOverride, recreate } = readPdfFocus(filename);
    items.push({
      customId,
      input: filename,
      source: { kind: 'local_pdf', filename, filePath },
      isUrl: false,
      filePath,
      base64Data,
      focusHint,
      imageOverride,
      recreate,
    });
    const flags = [
      focusHint ? 'focus hint loaded' : null,
      imageOverride ? imageOverrideLog(imageOverride) : null,
      recreate?.enabled ? `recreate: ${recreate.target ?? 'auto'}${recreate.dataFile ? ` (data: ${recreate.dataFile})` : ''}` : null,
    ].filter(Boolean).join('; ');
    console.log(`  ✓ ${filename} (${sizeKb} KB)${flags ? `  [${flags}]` : ''}`);
  }

  // ── Remote URLs (input/urls.txt) ─────────────────────────────────────────
  if (fs.existsSync(URLS_FILE)) {
    const lines = fs.readFileSync(URLS_FILE, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));

    for (const line of lines) {
      const { url, focusHint, imageOverride, recreate } = splitUrlAndFocus(line);
      const slug = url
        .replace(/^https?:\/\//, '')
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .slice(0, 80);
      const customId = dedupeCustomId('explainer-url-' + slug, usedCustomIds, 'explainer-url-'.length + 80);

      let htmlContent: string | undefined;
      let figureCandidates: FigureCandidate[] | undefined;
      let detectedCitation: DetectedCitation | undefined;
      let publishedOn: string | undefined;
      let cachedPdfPath: string | undefined;
      if (isPdfUrl(url)) {
        cachedPdfPath = await cachePdfUrl(url);
      } else {
        process.stdout.write(`  Fetching ${url} …`);
        const fetched = await fetchHtmlContent(url);
        htmlContent = fetched.text;
        figureCandidates = fetched.candidates.length > 0 ? fetched.candidates : undefined;
        detectedCitation = fetched.detectedCitation;
        publishedOn = fetched.publishedOn;
        console.log(htmlContent ? ` ${Math.round(htmlContent.length / 1024)}KB` : ' (fetch failed, will use URL reference)');
      }

      items.push({
        customId,
        input: url,
        source: { kind: 'url', url, cachedPdfPath },
        isUrl: true,
        htmlContent,
        focusHint,
        imageOverride,
        recreate,
        figureCandidates,
        detectedCitation,
        publishedOn,
      });
      const flags = [
        focusHint ? 'focus hint loaded' : null,
        imageOverride ? imageOverrideLog(imageOverride) : null,
        recreate?.enabled ? `recreate: ${recreate.target ?? 'auto'}${recreate.dataFile ? ` (data: ${recreate.dataFile})` : ''}` : null,
      ].filter(Boolean).join('; ');
      console.log(`  ✓ URL queued → ${url}${flags ? `  [${flags}]` : ''}`);
    }
  }

  if (items.length === 0) {
    console.log('  No PDFs found in input/ and no urls.txt entries.');
  }

  return items;
}
