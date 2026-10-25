import { formatLabel, labelsEqual, parseLabel, LabelKey } from './label';
import { imageSize, sniffImageType, AssetExt } from './asset';
import type { FigureCandidate } from '../state';

export interface Rect { x: number; y: number; w: number; h: number }

export interface DomBox extends Rect {
  key: string;
  tag: string;
  /** Key of the enclosing figure. */
  parent?: string;
  label?: string;
  caption?: string;
}

/** Raw label evidence for one figure, read from the snapshot HTML or the live DOM. */
export interface LabelHints {
  captionText?: string;
  figureStyle?: string;
  captionStyle?: string;
  ariaLabel?: string;
  id?: string;
  dataLabel?: string;
}

/** One asset reference in source order: a plain URL, or a srcset whose largest entry counts. */
export interface RawSource { url?: string; srcset?: string }

export type DomFailure =
  | { ok: false; reason: 'label-not-found'; labels: string[]; notes: string[] }
  | { ok: false; reason: 'source-unavailable'; notes: string[] };
export type DomResult = {
  ok: true; label: LabelKey; bytes: Buffer; ext: AssetExt; width?: number; height?: number;
  provenance: 'dom-asset'; source: string; captionText?: string; notes: string[];
} | DomFailure;

export interface DomOptions { fetchBytes?: (url: string) => Promise<Buffer> }

const IOU_DUPLICATE = 0.7;
const FETCH_TIMEOUT_MS = 15_000;
const WRAPPER_TOKENS = new Set(['chart', 'figure', 'graph', 'plot']);
const LATEXML_ID_RE = /^[SA][a-z]*\d+(?:\.[A-Za-z]+\d+)*\.([FT])(\d+)$/;

export function intersectionOverUnion(a: Rect, b: Rect): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Wrapper preference first (a multi-panel figure is one candidate; a
 * one-image figure is its image, carrying the figure's label and caption),
 * then true IoU: of a near-duplicate pair the smaller box stays.
 */
export function dedupeDomCandidates<T extends DomBox>(boxes: T[]): T[] {
  const children = new Map<string, T[]>();
  for (const box of boxes) {
    if (box.parent !== undefined) children.set(box.parent, [...(children.get(box.parent) ?? []), box]);
  }
  const dropped = new Set<T>();
  const carried = new Map<T, T>();
  for (const box of boxes) {
    if (box.tag !== 'figure') continue;
    const own = children.get(box.key) ?? [];
    if (own.length >= 2) {
      own.forEach(child => dropped.add(child));
    } else if (own.length === 1) {
      dropped.add(box);
      carried.set(own[0], inherit(own[0], box));
    }
  }
  const remaining = boxes.filter(box => !dropped.has(box)).map(box => carried.get(box) ?? box);
  const kept: T[] = [];
  for (const box of [...remaining].sort((a, b) => a.w * a.h - b.w * b.h)) {
    const twin = kept.findIndex(k => intersectionOverUnion(box, k) >= IOU_DUPLICATE);
    if (twin < 0) kept.push(box);
    else kept[twin] = inherit(kept[twin], box);
  }
  return kept.sort((a, b) => a.y - b.y || a.x - b.x);
}

function inherit<T extends DomBox>(box: T, from: DomBox): T {
  if ((box.label !== undefined || from.label === undefined) && (box.caption !== undefined || from.caption === undefined)) return box;
  return {
    ...box,
    ...(box.label === undefined && from.label !== undefined && { label: from.label }),
    ...(box.caption === undefined && from.caption !== undefined && { caption: from.caption }),
  };
}

export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Whole class tokens, split on whitespace and hyphens, so `typography` and `paragraph` are not `graph`. */
export function isWrapperClass(className: string): boolean {
  return className.toLowerCase().split(/[\s-]+/).some(token => WRAPPER_TOKENS.has(token));
}

function cssFigureLabel(style: string | undefined): LabelKey | null {
  if (!style) return null;
  const m = /--figure-label\s*:\s*(?:"([^"]*)"|'([^']*)'|([^;]*))/i.exec(decodeHtmlEntities(style));
  return m ? parseLabel(m[1] ?? m[2] ?? m[3]) : null;
}

function latexmlIdLabel(id: string | undefined): LabelKey | null {
  const m = id ? LATEXML_ID_RE.exec(id.trim()) : null;
  return m ? parseLabel(`${m[1] === 'T' ? 'Table' : 'Figure'} ${m[2]}`) : null;
}

/** The first label that parses, in the order caption text, `--figure-label`, aria-label, LaTeXML id, data-label. */
export function labelFromHints(hints: LabelHints): LabelKey | null {
  const parse = (text: string | undefined) => (text ? parseLabel(text) : null);
  return parse(hints.captionText)
    ?? cssFigureLabel(hints.figureStyle)
    ?? cssFigureLabel(hints.captionStyle)
    ?? parse(hints.ariaLabel)
    ?? latexmlIdLabel(hints.id)
    ?? parse(hints.dataLabel);
}

/** Largest entry by `w` descriptor, else by `x`; an entry with no descriptor counts as `1x`. */
export function largestSrcsetEntry(srcset: string): string | undefined {
  const entries: Array<{ url: string; w?: number; x: number }> = [];
  let rest = srcset;
  for (;;) {
    rest = rest.replace(/^[\s,]+/, '');
    if (!rest) break;
    let url = /^\S+/.exec(rest)![0];
    rest = rest.slice(url.length);
    let descriptor = '';
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      descriptor = /^[^,]*/.exec(rest)![0];
      rest = rest.slice(descriptor.length);
    }
    const w = /^\s*(\d+)w\s*$/i.exec(descriptor);
    const x = /^\s*(\d*\.?\d+)x\s*$/i.exec(descriptor);
    entries.push({ url, ...(w && { w: Number(w[1]) }), x: x ? Number(x[1]) : 1 });
  }
  const byW = entries.some(e => e.w !== undefined);
  let best: (typeof entries)[number] | undefined;
  for (const e of entries) {
    const score = byW ? e.w ?? -1 : e.x;
    const bestScore = best ? (byW ? best.w ?? -1 : best.x) : -Infinity;
    if (score > bestScore) best = e;
  }
  return best?.url;
}

/** Resolves against the page, decodes entities and unwraps a `/_next/image?url=` wrapper to the inner URL. */
export function resolveAssetUrl(raw: string, pageUrl: string): string | undefined {
  const decoded = decodeHtmlEntities(raw.trim());
  if (!decoded || /^(?:data|blob|javascript):/i.test(decoded)) return undefined;
  try {
    const url = new URL(decoded, pageUrl);
    const inner = url.pathname.endsWith('/_next/image') ? url.searchParams.get('url') : null;
    return inner ? new URL(inner, url).toString() : url.toString();
  } catch {
    return undefined;
  }
}

/** Every asset URL in source order, each recorded once (first occurrence wins). */
export function resolveSources(raw: RawSource[], pageUrl: string): string[] {
  const out: string[] = [];
  for (const item of raw) {
    const ref = item.srcset !== undefined ? largestSrcsetEntry(item.srcset) : item.url;
    const url = ref ? resolveAssetUrl(ref, pageUrl) : undefined;
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

async function defaultFetchBytes(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchFirstImage(
  sources: string[], fetchBytes: (url: string) => Promise<Buffer>, notes: string[],
): Promise<{ bytes: Buffer; ext: AssetExt; source: string } | null> {
  for (const source of sources) {
    try {
      const bytes = await fetchBytes(source);
      const ext = sniffImageType(bytes);
      if (ext) return { bytes, ext, source };
      notes.push(`not an image: ${source}`);
    } catch (err) {
      notes.push(`fetch failed: ${source}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return null;
}

function assetResult(
  label: LabelKey, asset: { bytes: Buffer; ext: AssetExt; source: string }, captionText: string | undefined, notes: string[],
): DomResult {
  const size = asset.ext === 'svg' ? null : imageSize(asset.bytes);
  return {
    ok: true, label, bytes: asset.bytes, ext: asset.ext,
    ...(size && { width: size.width, height: size.height }),
    provenance: 'dom-asset', source: asset.source,
    ...(captionText !== undefined && { captionText }),
    notes,
  };
}

function findLabelled<T extends { label?: string }>(items: T[], want: LabelKey): { item: T; key: LabelKey } | null {
  for (const item of items) {
    const key = item.label ? parseLabel(item.label) : null;
    if (key && labelsEqual(key, want)) return { item, key };
  }
  return null;
}

function labelNotFound(items: Array<{ label?: string }>, want: LabelKey): DomFailure {
  return {
    ok: false, reason: 'label-not-found',
    labels: items.flatMap(item => (item.label ? [item.label] : [])),
    notes: [`${formatLabel(want)} is not among the page's figure labels`],
  };
}

/** A labelled snapshot candidate's own asset, fetched and sniffed; no vision call. */
export async function fromSnapshot(candidates: FigureCandidate[], want: LabelKey, opts: DomOptions = {}): Promise<DomResult> {
  const match = findLabelled(candidates, want);
  if (!match) return labelNotFound(candidates, want);
  const { item, key } = match;
  const sources = item.sources?.length ? item.sources : item.imgSrc ? [item.imgSrc] : [];
  const notes: string[] = [];
  const asset = await fetchFirstImage(sources, opts.fetchBytes ?? defaultFetchBytes, notes);
  if (!asset) return { ok: false, reason: 'source-unavailable', notes: [`no source of ${formatLabel(key)} gave an image`, ...notes] };
  return assetResult(key, asset, item.figcaption, notes);
}

/** Lazy Playwright import keeps Chromium optional for the PDF-only path. */
export async function loadPlaywright(): Promise<typeof import('playwright') | null> {
  try {
    const dynImport = new Function('m', 'return import(m)') as (m: string) => Promise<typeof import('playwright')>;
    return await dynImport('playwright');
  } catch {
    console.warn('  ⚠ dom-figures: playwright not installed; run `npm i playwright && npx playwright install chromium` to enable live page figures.');
    return null;
  }
}

/**
 * Scrolls through the whole page so lazy-loaded images and client-side
 * (canvas or SVG) charts actually paint, then settles. Without this,
 * interactive charts screenshot blank.
 */
export async function renderReady(page: import('playwright').Page): Promise<void> {
  try {
    await page.evaluate(async () => {
      const w = globalThis as { innerHeight?: number; scrollTo?: (x: number, y: number) => void; document?: any };
      const doc = w.document;
      const max = Math.max(doc?.body?.scrollHeight ?? 0, doc?.documentElement?.scrollHeight ?? 0);
      const step = Math.max(400, w.innerHeight ?? 800);
      for (let y = 0; y <= max; y += step) {
        w.scrollTo?.(0, y);
        await new Promise(r => setTimeout(r, 120));
      }
      w.scrollTo?.(0, 0);
    });
    await page.waitForTimeout(800);
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
  } catch {
    /* best-effort: render hints only */
  }
}

interface LiveBox extends DomBox { hints?: LabelHints; rawSources: RawSource[] }
interface LiveCandidate extends DomBox { sources: string[] }

const CAND_ATTR = 'data-dom-figure';

/**
 * Tags each candidate element with CAND_ATTR so a locator can re-find it, and
 * returns its page-space box: every `<figure>` with its image, svg, canvas and
 * object children, or, on a page with no `<figure>`, picture, svg, canvas, img
 * and whole-token class wrappers.
 */
async function extractLiveBoxes(page: import('playwright').Page): Promise<{ baseUri: string; boxes: LiveBox[] }> {
  return page.evaluate(({ attr, tokens }) => {
    const doc = (globalThis as { document?: any }).document;
    const win = globalThis as { scrollX?: number; scrollY?: number };
    const boxes: LiveBox[] = [];
    const keys = new Map<any, string>();
    const text = (el: any) => (el ? String(el.textContent ?? '').replace(/\s+/g, ' ').trim() || undefined : undefined);
    const get = (el: any, name: string) => (el?.getAttribute(name) ?? undefined) as string | undefined;
    const isWrapper = (el: any) => String(el.getAttribute('class') ?? '').toLowerCase().split(/[\s-]+/).some((t: string) => tokens.includes(t));
    const ownCaption = (el: any) => Array.from(el.querySelectorAll('figcaption')).find((c: any) => c.closest('figure') === el) as any;
    const imgSources = (img: any): RawSource[] => {
      const src = ['src', 'data-src', 'data-original'].map(n => get(img, n)).find(v => v && !/^data:/i.test(v));
      const srcset = get(img, 'srcset');
      return [...(src ? [{ url: src }] : []), ...(srcset ? [{ srcset }] : [])];
    };
    const elementSources = (el: any): RawSource[] => {
      const tag = String(el.tagName).toLowerCase();
      if (tag === 'img') return imgSources(el);
      if (tag === 'object') return get(el, 'data') ? [{ url: get(el, 'data')! }] : [];
      const out: RawSource[] = [];
      el.querySelectorAll('img').forEach((img: any) => out.push(...imgSources(img)));
      el.querySelectorAll('picture source[srcset]').forEach((s: any) => out.push({ srcset: get(s, 'srcset')! }));
      el.querySelectorAll('object[data]').forEach((o: any) => out.push({ url: get(o, 'data')! }));
      return out;
    };
    const push = (el: any, parent?: string, hints?: LabelHints, caption?: string) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const key = `c${boxes.length + 1}`;
      keys.set(el, key);
      el.setAttribute(attr, key);
      boxes.push({
        key, tag: String(el.tagName).toLowerCase(),
        x: r.left + (win.scrollX || 0), y: r.top + (win.scrollY || 0), w: r.width, h: r.height,
        ...(parent && { parent }), ...(hints && { hints }), ...(caption && { caption }),
        rawSources: elementSources(el),
      });
    };
    const hintsFor = (el: any, caption: any): LabelHints => ({
      captionText: text(caption), figureStyle: get(el, 'style'), captionStyle: get(caption, 'style'),
      ariaLabel: get(el, 'aria-label'), id: get(el, 'id'), dataLabel: get(el, 'data-label'),
    });

    doc.querySelectorAll(`[${attr}]`).forEach((el: any) => el.removeAttribute(attr));
    const figures = Array.from(doc.querySelectorAll('figure')) as any[];
    if (figures.length) {
      for (const fig of figures) {
        const caption = ownCaption(fig);
        const outer = fig.parentElement?.closest('figure');
        push(fig, outer ? keys.get(outer) : undefined, hintsFor(fig, caption), text(caption));
        const key = keys.get(fig);
        if (!key) continue;
        fig.querySelectorAll('img, svg, canvas, object').forEach((child: any) => {
          if (child.closest('figure') !== fig) return;
          if (String(child.tagName).toLowerCase() === 'svg' && child.parentElement?.closest('svg')) return;
          push(child, key);
        });
      }
    } else {
      doc.querySelectorAll('picture, svg, canvas, img, div, span, section').forEach((el: any) => {
        const tag = String(el.tagName).toLowerCase();
        if (['div', 'span', 'section'].includes(tag) && !isWrapper(el)) return;
        if (tag === 'svg' && el.parentElement?.closest('svg')) return;
        const caption = el.querySelector('figcaption');
        push(el, undefined, hintsFor(el, caption), text(caption));
      });
    }
    return { baseUri: String(doc.baseURI), boxes };
  }, { attr: CAND_ATTR, tokens: [...WRAPPER_TOKENS] });
}

/**
 * The labelled figure on a live page: its own asset when one fetches, else an
 * element screenshot at the viewport the page was measured in. No vision call.
 */
export async function fromLivePage(url: string, want: LabelKey, opts: DomOptions = {}): Promise<DomResult> {
  const unavailable = (note: string): DomResult => ({ ok: false, reason: 'source-unavailable', notes: [note] });
  const pw = await loadPlaywright();
  if (!pw) return unavailable('playwright is not installed');
  let browser: import('playwright').Browser;
  try {
    browser = await pw.chromium.launch();
  } catch (err) {
    return unavailable(`chromium failed to launch: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
  }
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1600 }, deviceScaleFactor: 2 });
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 45_000 });
    } catch (err) {
      return unavailable(`navigation failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    }
    await renderReady(page);
    const { baseUri, boxes } = await extractLiveBoxes(page);
    const labelled: LiveCandidate[] = boxes.map(({ hints, rawSources, ...box }) => {
      const key = hints ? labelFromHints(hints) : null;
      return { ...box, ...(key && { label: formatLabel(key) }), sources: resolveSources(rawSources, baseUri) };
    });
    const kept = dedupeDomCandidates(labelled);
    const match = findLabelled(kept, want);
    if (!match) return labelNotFound(kept, want);
    const { item, key } = match;
    const notes: string[] = [];
    const asset = await fetchFirstImage(item.sources, opts.fetchBytes ?? defaultFetchBytes, notes);
    if (asset) return assetResult(key, asset, item.caption, notes);
    try {
      const shot = await page.locator(`[${CAND_ATTR}="${item.key}"]`).first().screenshot({ timeout: 15_000 });
      notes.push(`no fetchable asset for ${formatLabel(key)}: element screenshot`);
      return assetResult(key, { bytes: shot, ext: 'png', source: 'screenshot' }, item.caption, notes);
    } catch (err) {
      return unavailable(`element screenshot failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    }
  } catch (err) {
    return unavailable(`live page extraction failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
  } finally {
    await browser.close().catch(() => undefined);
  }
}
