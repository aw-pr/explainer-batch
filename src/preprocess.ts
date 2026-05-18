import fs from 'fs';
import path from 'path';

const INPUT_DIR = path.join(__dirname, '..', 'input');
const URLS_FILE = path.join(INPUT_DIR, 'urls.txt');

const HTML_FETCH_MAX_BYTES = 200_000;

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
}

export interface ImageOverride {
  source_figure: string;
  caption?: string;
  alt_text?: string;
}

function parseFocusDirectives(raw: string): { focusHint?: string; imageOverride?: ImageOverride } {
  const lines = raw.split('\n');
  const remaining: string[] = [];
  let sourceFigure: string | undefined;
  let caption: string | undefined;
  let altText: string | undefined;

  const figDirective = /^\s*image\s*:\s*((?:figure|fig\.?)\s*\d+(?:\.\d+)?[a-z]?)\s*$/i;
  const captionDirective = /^\s*image[_-]caption\s*:\s*(.+?)\s*$/i;
  const altDirective = /^\s*image[_-]alt\s*:\s*(.+?)\s*$/i;

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
    remaining.push(line);
  }

  const focusHint = remaining.join('\n').trim() || undefined;
  const imageOverride = sourceFigure
    ? { source_figure: sourceFigure, caption, alt_text: altText }
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

function isPdfUrl(url: string): boolean {
  const lower = url.toLowerCase().split('?')[0];
  return lower.endsWith('.pdf') || /arxiv\.org\/pdf\//i.test(lower);
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function fetchHtmlContent(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; explainer-batch/1.0)' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.warn(`  ⚠ URL fetch failed (${res.status}): ${url}`);
      return undefined;
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/pdf')) return undefined; // let document block handle it
    const raw = await res.text();
    const text = stripHtml(raw.slice(0, HTML_FETCH_MAX_BYTES * 3)); // strip first, then truncate
    return text.slice(0, HTML_FETCH_MAX_BYTES);
  } catch (err) {
    console.warn(`  ⚠ URL fetch error: ${url} — ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/**
 * Scans input/ for PDFs and optionally input/urls.txt for remote URLs.
 * Reads local PDFs into base64 for inline batch embedding.
 * HTML web URLs are fetched and stripped to text; PDF URLs pass through as document blocks.
 */
export async function preprocessInputs(): Promise<InputItem[]> {
  const items: InputItem[] = [];

  // ── Local PDFs ──────────────────────────────────────────────────────────────
  const pdfs = fs.readdirSync(INPUT_DIR)
    .filter(f => f.toLowerCase().endsWith('.pdf'));

  for (const filename of pdfs) {
    const customId = ('explainer-' + filename.replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9_-]/g, '-')).slice(0, 64);
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
      const customId = 'explainer-url-' + slug;

      let htmlContent: string | undefined;
      if (!isPdfUrl(url)) {
        process.stdout.write(`  Fetching ${url} …`);
        htmlContent = await fetchHtmlContent(url);
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
