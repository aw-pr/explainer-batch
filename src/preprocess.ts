import fs from 'fs';
import path from 'path';
import { INPUT_DIR } from './output';
import { stripHtml } from './text';
import type { FigureCandidate } from './state';

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
  /** First author's surname, detected deterministically (arXiv `/abs/` metadata). Used to stamp the byline when the model drops or placeholders it. */
  detectedSurname?: string;
  /** Publication date ("Published Month Year"), detected from arXiv `/abs/` metadata. Authoritative over the model's guess. */
  detectedPublished?: string;
  /** Canonical single-entry reference (HTML) built deterministically from arXiv `/abs/` metadata. Replaces the model's reference when present. */
  detectedReference?: string;
}

export interface ImageOverride {
  source_figure: string;
  caption?: string;
  alt_text?: string;
  /** Optional 1-based page hint that short-circuits caption search in figure-extract. */
  pageHint?: number;
}

function parseFocusDirectives(raw: string): { focusHint?: string; imageOverride?: ImageOverride } {
  const lines = raw.split('\n');
  const remaining: string[] = [];
  let sourceFigure: string | undefined;
  let caption: string | undefined;
  let altText: string | undefined;
  let pageHint: number | undefined;

  const figDirective = /^\s*image\s*:\s*((?:figure|fig\.?)\s*\d+(?:\.\d+)?[a-z]?)\s*$/i;
  const captionDirective = /^\s*image[_-]caption\s*:\s*(.+?)\s*$/i;
  const altDirective = /^\s*image[_-]alt\s*:\s*(.+?)\s*$/i;
  const pageHintDirective = /^\s*image[_-]page[_-]hint\s*:\s*(.+?)\s*$/i;

  for (const line of lines) {
    let m = line.match(figDirective);
    if (m) {
      const raw = m[1].trim();
      sourceFigure = /^fig\b\.?$/i.test(raw.split(/\s+/)[0])
        ? raw.replace(/^fig\.?/i, 'Figure').replace(/\s+/g, ' ').trim()
        : raw.replace(/^figure/i, 'Figure');
      continue;
    }
    m = line.match(captionDirective);
    if (m) { caption = m[1]; continue; }
    m = line.match(altDirective);
    if (m) { altText = m[1]; continue; }
    m = line.match(pageHintDirective);
    if (m) {
      const n = Number.parseInt(m[1].trim(), 10);
      if (Number.isFinite(n) && n > 0) pageHint = n;
      continue;
    }
    remaining.push(line);
  }

  const focusHint = remaining.join('\n').trim() || undefined;
  const imageOverride = sourceFigure
    ? { source_figure: sourceFigure, caption, alt_text: altText, pageHint }
    : undefined;
  return { focusHint, imageOverride };
}

export interface InputSource {
  kind: 'url' | 'local_pdf';
  url?: string;
  filename?: string;
  filePath?: string;
}

function readPdfFocus(filename: string): { focusHint?: string; imageOverride?: ImageOverride } {
  const base = filename.replace(/\.pdf$/i, '');
  const sidecar = path.join(INPUT_DIR, base + '.focus.md');
  if (!fs.existsSync(sidecar)) return {};
  const text = fs.readFileSync(sidecar, 'utf8').trim();
  if (!text) return {};
  return parseFocusDirectives(text);
}

function splitUrlAndFocus(line: string): { url: string; focusHint?: string; imageOverride?: ImageOverride } {
  const m = line.match(/^(\S+)\s+#\s*focus\s*:\s*(.+)$/i);
  if (!m) return { url: line };
  const parsed = parseFocusDirectives(m[2].trim());
  return { url: m[1], ...parsed };
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

function isPdfUrl(url: string): boolean {
  const lower = url.toLowerCase().split('?')[0];
  return lower.endsWith('.pdf') || /arxiv\.org\/pdf\//i.test(lower);
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

/**
 * Regex-based DOM figure-candidate scan (Node has no DOM). Primary pass reads
 * real `<figure>…</figure>` elements; secondary pass catches a bare `<img>`
 * sitting in a `[class*="figure"]` wrapper (mirrors the live selector in
 * figure-vlm.ts's markFigureCandidates), for pages that don't use `<figure>`.
 * Runs on the FULL raw HTML, before the strip+truncate below, so a late
 * figure is never lost to the size cap.
 */
export function parseFigureCandidates(raw: string, pageUrl: string): FigureCandidate[] {
  const candidates: FigureCandidate[] = [];
  const seenSrc = new Set<string>();

  const figureRe = /<figure\b[^>]*>([\s\S]*?)<\/figure>/gi;
  let m: RegExpExecArray | null;
  while ((m = figureRe.exec(raw)) && candidates.length < MAX_FIGURE_CANDIDATES) {
    const block = m[1];
    const imgMatch = block.match(/<img\b[^>]*>/i);
    if (!imgMatch) continue;
    const imgSrc = resolveImgSrc(imgMatch[0], pageUrl);
    if (!imgSrc || seenSrc.has(imgSrc)) continue;

    const alt = extractTagAttr(imgMatch[0], 'alt');
    const capMatch = block.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i);
    const figcaption = capMatch ? stripHtml(capMatch[1]) || undefined : undefined;
    const sourceFigure = figcaption ? parseSourceFigureLabel(figcaption) : undefined;

    seenSrc.add(imgSrc);
    candidates.push({ imgSrc, figcaption, alt, sourceFigure });
  }

  // Secondary pass: bare <img> inside a [class*="figure"] wrapper that isn't a
  // real <figure> element. Scans a bounded window after the wrapper's opening
  // tag rather than trying to balance nested tags with regex.
  const WRAPPER_WINDOW = 2000;
  const wrapperRe = /<(?:div|span|section)\b[^>]*class\s*=\s*["'][^"']*figure[^"']*["'][^>]*>/gi;
  while ((m = wrapperRe.exec(raw)) && candidates.length < MAX_FIGURE_CANDIDATES) {
    const windowText = raw.slice(m.index, m.index + WRAPPER_WINDOW);
    const imgMatch = windowText.match(/<img\b[^>]*>/i);
    if (!imgMatch) continue;
    const imgSrc = resolveImgSrc(imgMatch[0], pageUrl);
    if (!imgSrc || seenSrc.has(imgSrc)) continue;

    const alt = extractTagAttr(imgMatch[0], 'alt');
    const capMatch = windowText.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i);
    const figcaption = capMatch ? stripHtml(capMatch[1]) || undefined : undefined;
    const sourceFigure = figcaption ? parseSourceFigureLabel(figcaption) : undefined;

    seenSrc.add(imgSrc);
    candidates.push({ imgSrc, figcaption, alt, sourceFigure });
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

function formatCitationDate(raw?: string): string | undefined {
  const m = raw?.match(/(\d{4})[/-](\d{1,2})/);
  if (!m) return undefined;
  const month = MONTHS[Number.parseInt(m[2], 10) - 1];
  return month ? `Published ${month} ${m[1]}` : undefined;
}

function escRefText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** "Acharya, Vivek" -> "Acharya, V."; leaves a bare surname untouched. */
function formatAuthorApa(citation: string): string {
  const parts = citation.split(',').map(s => s.trim());
  const surname = parts[0] ?? citation.trim();
  const given = parts.slice(1).join(' ').trim();
  if (!given) return surname;
  const initials = given.split(/\s+/).filter(Boolean).map(g => `${g[0].toUpperCase()}.`).join(' ');
  return `${surname}, ${initials}`;
}

function formatAuthorsForRef(list: string[]): string {
  const apa = list.map(formatAuthorApa).filter(Boolean);
  if (apa.length === 0) return '';
  if (apa.length > 6) return `${apa[0]}, et al.`;
  if (apa.length === 1) return apa[0];
  return `${apa.slice(0, -1).join(', ')}, & ${apa[apa.length - 1]}`;
}

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

/**
 * Canonical single-entry reference from citation metadata. Prefers a DOI link
 * (Nature and most journals), falls back to the arXiv abstract, then the source
 * URL. Deterministic so attribution is always present, correctly anchored, and
 * consistent, instead of whatever the model invents (fabricated URLs, missing
 * anchors, "Unattributed").
 */
function buildReference(meta: CitationMeta, sourceUrl: string): string | undefined {
  if (!meta.title || meta.authors.length === 0) return undefined;
  const authors = escRefText(formatAuthorsForRef(meta.authors));
  const year = meta.date?.match(/\d{4}/)?.[0];
  const yearPart = year ? ` (${year})` : '';

  let venue = '';
  let link = sourceUrl;
  if (meta.doi) {
    if (meta.journal) venue = ` <em>${escRefText(meta.journal)}</em>.`;
    link = `https://doi.org/${meta.doi.replace(/^doi:/i, '')}`;
  } else {
    const absUrl = arxivAbsUrl(sourceUrl);
    if (absUrl) {
      const idBase = (absUrl.split('/abs/')[1] ?? '').replace(/v\d+$/i, '');
      venue = ` <em>arXiv preprint</em>${idBase ? ` arXiv:${escRefText(idBase)}` : ''}.`;
      link = absUrl;
    } else if (meta.journal) {
      venue = ` <em>${escRefText(meta.journal)}</em>.`;
    }
  }
  return `${authors}${yearPart}. ${escRefText(meta.title)}.${venue} ` +
    `<a href="${escRefText(link)}" target="_blank" rel="noopener noreferrer">${escRefText(link)}</a>`;
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
  /** First author's surname, from arXiv `/abs/` metadata or the page markup. */
  detectedSurname?: string;
  /** Publication date as "Published Month Year", from arXiv `/abs/` metadata. */
  detectedPublished?: string;
  /** Canonical single-entry reference (HTML) built from arXiv `/abs/` metadata. */
  detectedReference?: string;
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
    const firstName = authorList[0];
    const detectedSurname = firstName ? surnameOf(firstName) : undefined;
    const detectedPublished = formatCitationDate(meta.date);
    const detectedReference = buildReference({ ...meta, authors: authorList }, url);
    if (text && (authors || detectedPublished)) {
      const lines: string[] = [];
      if (authors) lines.push(`Detected paper author(s): ${authors}`);
      if (detectedPublished) lines.push(`Detected publication date: ${detectedPublished}`);
      lines.push('Use these for the byline and publication date unless the paper text clearly contradicts them.');
      text = `${lines.join('\n')}\n\n${text}`;
    }
    return { text, candidates, detectedSurname, detectedPublished, detectedReference };
  } catch (err) {
    console.warn(`  ⚠ URL fetch error: ${url} — ${err instanceof Error ? err.message : String(err)}`);
    return { candidates: [] };
  }
}

/**
 * Scans input/ for PDFs and optionally input/urls.txt for remote URLs.
 * Reads local PDFs into base64 for inline batch embedding.
 * HTML web URLs are fetched and stripped to text; PDF URLs pass through as document blocks.
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
    const { focusHint, imageOverride } = readPdfFocus(filename);
    items.push({
      customId,
      input: filename,
      source: { kind: 'local_pdf', filename, filePath },
      isUrl: false,
      filePath,
      base64Data,
      focusHint,
      imageOverride,
    });
    const flags = [
      focusHint ? 'focus hint loaded' : null,
      imageOverride ? `image override: ${imageOverride.source_figure}` : null,
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
      const { url, focusHint, imageOverride } = splitUrlAndFocus(line);
      const slug = url
        .replace(/^https?:\/\//, '')
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .slice(0, 80);
      const customId = dedupeCustomId('explainer-url-' + slug, usedCustomIds, 'explainer-url-'.length + 80);

      let htmlContent: string | undefined;
      let figureCandidates: FigureCandidate[] | undefined;
      let detectedSurname: string | undefined;
      let detectedPublished: string | undefined;
      let detectedReference: string | undefined;
      if (!isPdfUrl(url)) {
        process.stdout.write(`  Fetching ${url} …`);
        const fetched = await fetchHtmlContent(url);
        htmlContent = fetched.text;
        figureCandidates = fetched.candidates.length > 0 ? fetched.candidates : undefined;
        detectedSurname = fetched.detectedSurname;
        detectedPublished = fetched.detectedPublished;
        detectedReference = fetched.detectedReference;
        console.log(htmlContent ? ` ${Math.round(htmlContent.length / 1024)}KB` : ' (fetch failed, will use URL reference)');
      }

      items.push({
        customId,
        input: url,
        source: { kind: 'url', url },
        isUrl: true,
        htmlContent,
        focusHint,
        imageOverride,
        figureCandidates,
        detectedSurname,
        detectedPublished,
        detectedReference,
      });
      const flags = [
        focusHint ? 'focus hint loaded' : null,
        imageOverride ? `image override: ${imageOverride.source_figure}` : null,
      ].filter(Boolean).join('; ');
      console.log(`  ✓ URL queued → ${url}${flags ? `  [${flags}]` : ''}`);
    }
  }

  if (items.length === 0) {
    console.log('  No PDFs found in input/ and no urls.txt entries.');
  }

  return items;
}
