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

async function fetchHtmlContent(url: string): Promise<{ text?: string; candidates: FigureCandidate[] }> {
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
    const text = stripHtml(raw.slice(0, HTML_FETCH_MAX_BYTES * 3)).slice(0, HTML_FETCH_MAX_BYTES); // strip first, then truncate
    return { text, candidates };
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
      if (!isPdfUrl(url)) {
        process.stdout.write(`  Fetching ${url} …`);
        const fetched = await fetchHtmlContent(url);
        htmlContent = fetched.text;
        figureCandidates = fetched.candidates.length > 0 ? fetched.candidates : undefined;
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
