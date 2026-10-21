import { createHash } from 'node:crypto';
import { Chart, CONTRACT_REVISION, ExplainerV2 } from './explainer-v2';
import { sanitiseInline, toPlain } from './inline';

export type MigrateIo = { listing: readonly string[]; bytes: (relPath: string) => Uint8Array | undefined };
export type MigrateAsset = { path: string; bytes: Uint8Array };
export type MigrateResult =
  | { ok: true; explainer: ExplainerV2; assets: MigrateAsset[] }
  | { ok: false; reason: string };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const text = (v: unknown): string => typeof v === 'string' ? v : '';
const plain = (v: unknown): string => toPlain(text(v));
const chartSchema = ExplainerV2.shape.charts.element;

function captionSource(value: unknown): { caption: string; source?: { ref: string; page: number } } {
  const caption = plain(value);
  const tag = caption.match(/\s*\((Table\s+\d+[a-z]?),\s*p\.\s*(\d+)\)\s*$/i);
  return tag
    ? { caption: caption.slice(0, tag.index).trimEnd(), source: { ref: tag[1], page: Number(tag[2]) } }
    : { caption };
}

function rasterSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const b = Buffer.from(bytes);
  if (b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && b.toString('ascii', 12, 16) === 'IHDR') {
    const width = b.readUInt32BE(16), height = b.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : undefined;
  }
  if (b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 3 < b.length) {
    if (b[offset++] !== 0xff) return undefined;
    while (b[offset] === 0xff) offset++;
    const marker = b[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > b.length) break;
    const length = b.readUInt16BE(offset);
    if (length < 2 || offset + length > b.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
      const height = b.readUInt16BE(offset + 3), width = b.readUInt16BE(offset + 5);
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    offset += length;
  }
  return undefined;
}

function reference(value: unknown, slug: string, issues: string[]): Obj {
  const raw = text(value), content = plain(value);
  const anchor = raw.match(/<a\b[^>]*\bhref\s*=\s*(?:"(https?:\/\/[^"\s]+)"|'(https?:\/\/[^'\s]+)')/i);
  const url = anchor ? plain(anchor[1] ?? anchor[2]) : undefined;
  const match = content.match(/^(.+?)\s*\((\d{4})\)\.\s+(.+?)\.\s*(.*)$/s);
  const authors = match ? Array.from(match[1].matchAll(/(?:^|,\s*|&\s*)([^,&]+),\s*([^,]+?)(?=,\s*[^,]+,|,?\s*&|$)/g), m => ({ family: m[1].trim(), given: m[2].trim() })) : [];
  if (!match || authors.length === 0) {
    issues.push('references[0]: partial APA parse');
    const family = slug.split('_')[1] || 'Unknown';
    return { authors: [{ family: plain(family.charAt(0).toUpperCase() + family.slice(1)) }], title: content, ...(url ? { url } : {}), origin: 'legacy' };
  }
  const venue = match[4].replace(/https?:\/\/\S+/g, '').trim().replace(/[.\s]+$/, '');
  return { authors, year: Number(match[2]), title: match[3], ...(venue ? { venue } : {}), ...(url ? { url } : {}), origin: 'legacy' };
}

export function migrateV1(raw: unknown, io: MigrateIo): MigrateResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'Expected a v1 object' };
  const doc = obj(raw);
  if (doc.version !== undefined && doc.version !== 1) return { ok: false, reason: 'Expected version 1 or an absent version' };
  if (!Array.isArray(doc.sections) || doc.sections.length === 0) return { ok: false, reason: 'No sections' };
  if (!Array.isArray(doc.references) || doc.references.length === 0) return { ok: false, reason: 'No reference' };
  try {
    const meta = obj(doc.metadata), hero = obj(doc.hero), top = obj(doc.top_block);
    const issues = arr(obj(meta.quality).issues).filter((v): v is string => typeof v === 'string');
    const dropped: string[] = [], assets: MigrateAsset[] = [], charts: Chart[] = [];
    const inline = (value: unknown, path: string): string => {
      const s = text(value);
      if (/<\/?(?!em\b|strong\b|code\b|sub\b|sup\b|a\b)[a-z][^>]*>/i.test(s)) dropped.push(`${path}: removed inline tags`);
      return sanitiseInline(s);
    };
    const twin = (o: Obj, key: string, path: string): string => inline(o[`${key}_html`] ?? o[key], path);
    const takeaway = (v: unknown, path: string): Obj => ({ label: plain(obj(v).label), body: twin(obj(v), 'body', path) });
    const bound = (path: string, length: number, min: number, max: number): void => {
      if (length < min || length > max) issues.push(`${path}: outside editorial bound ${min} to ${max}`);
    };
    const slug = text(meta.filename_slug), model = text(meta.model) || 'unknown';
    const headline = plain(hero.headline), title = plain(meta.title).replace(/:\s*[^:]+\s+\(\d{4}\)\s*$/, '');
    const emphasis = plain(text(hero.headline_html).match(/<span\b[^>]*>([\s\S]*?)<\/span>/i)?.[1]);
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const published = plain(hero.publication_date).match(/^Published\s+([A-Za-z]+)\s+(\d{4})$/);
    const month = published ? months.findIndex(m => m.toLowerCase() === published[1].toLowerCase()) + 1 : 0;
    bound('hero.title', title.length, 1, 80);
    bound('hero.headline', headline.length, 1, 160);
    bound('hero.subtitle', plain(hero.subtitle).length, 1, 320);
    bound('sections', doc.sections.length, 2, 5);
    const topBlock = top.kind === 'pills' ? {
      kind: 'pills', pills: arr(top.pills).map((p, i) => {
        const pill = { lead: plain(obj(p).number), text: plain(obj(p).description) };
        bound(`top_block.pills[${i}].lead`, pill.lead.length, 1, 24);
        bound(`top_block.pills[${i}].text`, pill.text.length, 1, 160);
        return pill;
      }),
    } : { kind: top.kind, ...takeaway(top, 'top_block.body') };
    if (top.kind === 'pills') {
      bound('top_block.pills', arr(top.pills).length, 2, 6);
      if (doc.end_takeaway == null) issues.push('end_takeaway: missing with pills');
    }
    const sections = doc.sections.map((value, i) => {
      const s = obj(value), list = obj(s.list), table = obj(s.table);
      return {
        label: plain(s.label),
        paragraphs: arr(s.paragraphs).map((p, j) => inline(arr(s.paragraphs_html)[j] ?? p, `sections[${i}].paragraphs[${j}]`)),
        ...(s.list == null ? {} : { list: {
          ordered: list.ordered,
          ...(list.intro == null && list.intro_html == null ? {} : { intro: twin(list, 'intro', `sections[${i}].list.intro`) }),
          items: arr(list.items).map(v => ({ ...(obj(v).label == null ? {} : { label: plain(obj(v).label) }), body: twin(obj(v), 'body', `sections[${i}].list.items.body`) })),
        } }),
        ...(s.table == null ? {} : { table: {
          ...(table.caption == null ? {} : captionSource(table.caption)),
          columns: arr(table.columns).map(plain), rows: arr(table.rows).map(row => arr(row).map(plain)),
        } }),
      };
    });
    const addChart = (candidate: unknown, name: string): void => {
      const parsed = chartSchema.safeParse(candidate);
      if (!parsed.success) dropped.push(`${name}: invalid or unsupported chart`);
      else if (charts.length >= 3) dropped.push(`${name}: exceeds three charts`);
      else charts.push(parsed.data);
    };
    const originals = arr(doc.charts);
    const legacyCharts = originals.length ? originals : doc.chart == null ? [] : [doc.chart];
    legacyCharts.forEach((value, i) => {
      const ch = obj(value), config = obj(ch.config_json), data = obj(config.data), scales = obj(obj(config.options).scales);
      const x = obj(scales.x), y = obj(scales.y), cap = captionSource(ch.caption);
      const name = plain(ch.title) || `v1 charts[${i}]`;
      if (!['bar', 'line', 'scatter'].includes(text(config.type))) { dropped.push(`${name}: code-only or unsupported chart`); return; }
      addChart({
        kind: config.type === 'bar' && (x.stacked === true || y.stacked === true) ? 'stacked_bar' : config.type,
        title: plain(ch.title), caption: cap.caption,
        x: { label: plain(obj(x.title).text) || 'Category', type: x.type === 'logarithmic' ? 'log' : x.type === 'linear' || config.type === 'scatter' ? 'linear' : 'category', values: arr(data.labels).map(v => typeof v === 'number' ? v : plain(v)) },
        y: { label: plain(obj(y.title).text) || 'Value', scale: y.type === 'logarithmic' ? 'log' : 'linear' },
        series: arr(data.datasets).map(v => ({
          name: plain(obj(v).label),
          ...(config.type === 'scatter' ? { points: arr(obj(v).data).map(p => ({ x: obj(p).x, y: obj(p).y })) } : { values: obj(v).data }),
          source: { kind: 'legacy', ref: cap.source?.ref ?? `v1 charts[${i}]`, ...(cap.source ? { page: cap.source.page } : {}) },
        })),
      }, name);
    });
    if (originals.length && doc.chart != null && JSON.stringify(doc.chart) !== JSON.stringify(originals[0])) dropped.push(`chart: differing legacy duplicate ${plain(obj(doc.chart).title)}`);
    if (doc.recreated_figure != null) {
      const f = obj(doc.recreated_figure), x = obj(f.x), y = obj(f.y), name = plain(f.title) || 'recreated_figure';
      if (f.data_provenance === 'figure_estimated' || arr(f.series).some(s => obj(s).provenance === 'estimated')) dropped.push(`${name}: estimated recreated_figure`);
      else addChart({
        kind: f.chart_type === 'grouped_bar' ? 'bar' : f.chart_type, title: plain(f.title), caption: captionSource(f.caption).caption,
        x: { label: plain(x.label) || 'Category', ...(x.unit == null ? {} : { unit: plain(x.unit) }), type: f.chart_type === 'scatter' ? 'linear' : 'category', values: arr(x.values).map(v => typeof v === 'number' ? v : plain(v)) },
        y: { label: plain(y.label) || 'Value', ...(y.unit == null ? {} : { unit: plain(y.unit) }), scale: y.scale === 'log' ? 'log' : 'linear' },
        series: arr(f.series).map(v => {
          const s = obj(v), source = plain(s.source), table = source.match(/\bTable\s+\d+[a-z]?\b/i), page = source.match(/\b(?:page|p\.)\s*(\d+)/i);
          return { name: plain(s.name), ...(f.chart_type === 'scatter' ? { points: arr(s.points).map(p => ({ x: arr(p)[0], y: arr(p)[1] })) } : { values: s.values }), source: {
            kind: f.data_provenance === 'supplied' ? 'supplied' : s.provenance === 'exact' && table ? 'table' : 'text',
            ref: f.data_provenance !== 'supplied' && s.provenance === 'exact' && table ? table[0] : source || plain(f.source_figure),
            ...(page ? { page: Number(page[1]) } : {}),
          } };
        }),
      }, name);
    }
    let leadFigure: Obj | undefined;
    if (doc.image != null) {
      const image = obj(doc.image), src = text(image.src), label = plain(image.source_figure);
      const base64 = src.match(/^data:image\/(png|jpe?g|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$/i);
      const extension = base64?.[1].toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      const number = label.match(/\d+/)?.[0];
      const path = base64 ? `${slug}/figure${number ? `-${number}` : ''}.${extension}` : src.replace(/^\/explainer-html\/[^/]+\/(media\/[^/]+)$/, '$1');
      const bytes = base64 ? new Uint8Array(Buffer.from(base64[2], 'base64')) : io.listing.includes(path) ? io.bytes(path) : undefined;
      if (!bytes) dropped.push(`image ${label}: missing or unreadable asset`);
      else {
        const size = /\.svg$/i.test(path) ? undefined : rasterSize(bytes);
        if (!size && !/\.svg$/i.test(path)) issues.push(`image ${label}: raster header gives no size`);
        leadFigure = { label, caption: plain(image.caption), alt_text: plain(image.alt_text ?? image.caption), asset: path, sha256: createHash('sha256').update(bytes).digest('hex'), ...size, provenance: 'legacy' };
        if (base64) assets.push({ path, bytes });
      }
    }
    const known = new Set(['version', 'metadata', 'hero', 'top_block', 'sections', 'charts', 'chart', 'recreated_figure', 'image', 'end_takeaway', 'references']);
    for (const key of Object.keys(doc)) if (!known.has(key)) dropped.push(`${key}: undeclared top-level key`);
    doc.references.slice(1).forEach((_, i) => dropped.push(`references[${i + 1}]: extra reference`));
    const references = [reference(doc.references[0], slug, issues)];
    const candidate = {
      version: 2,
      metadata: { slug, date_created: meta.date_created, model, provider: model.startsWith('gpt-') ? 'openai' : model.startsWith('claude-') ? 'claude' : 'unknown', route: meta.run_mode ?? 'unknown', contract_revision: CONTRACT_REVISION, migrated_from: 1, quality: { issues, dropped } },
      hero: { title, headline, subtitle: plain(hero.subtitle), ...(emphasis && headline.includes(emphasis) ? { emphasis } : {}), ...(published && month ? { publication_date: `${published[2]}-${String(month).padStart(2, '0')}` } : {}) },
      top_block: topBlock, sections, charts, ...(leadFigure ? { lead_figure: leadFigure } : {}),
      ...(doc.end_takeaway == null ? {} : { end_takeaway: takeaway(doc.end_takeaway, 'end_takeaway.body') }), references,
    };
    const result = ExplainerV2.safeParse(candidate);
    return result.success ? { ok: true, explainer: result.data, assets } : { ok: false, reason: result.error.message };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message || 'Migration failed' : 'Migration failed' };
  }
}
