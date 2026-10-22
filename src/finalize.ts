import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CONTRACT_REVISION, ExplainerV2, type Chart, type ModelOutputV2, modelOutputValidator } from '../contract/explainer-v2';
import { sanitiseInline, toPlain } from '../contract/inline';
import { checkResult, type ErrorCode, type NormalizedResult } from './llm-contract';
import { dropThinCharts, extractJson, persistArtefact } from './output';
import { buildWireRepairInstruction, chartIssues, isChartIssue } from './quality';
import { MAX_REPAIR_ATTEMPTS } from './repair';
import { lintStyle } from './style-lint';
import { assetFileName, imageSize, sniffImageType } from './figure-locator/asset';
import { parseLabel } from './figure-locator/label';

export interface FigureAsset {
  label: string;
  caption: string;
  alt_text: string;
  bytes: Buffer;
  page?: number;
  provenance: 'arxiv-source' | 'pdf-embedded' | 'pdf-vector-crop' | 'dom-asset' | 'vlm-crop';
}

export interface StampContext {
  expectedDate: string;
  detectedReference?: NonNullable<ModelOutputV2['citation']>;
  publishedOn?: string;
  source?: { kind: 'pdf' | 'url'; ref: string };
}

export interface FinalizeContext {
  stamp: StampContext;
  checkpoints: {
    get(key: string): unknown | Promise<unknown>;
    put(key: string, value: unknown): void | Promise<void>;
  };
  repair?: (instruction: string, payload: string) => Promise<NormalizedResult>;
  figure?: (wire: ModelOutputV2, itemKey: string) => Promise<FigureAsset | null>;
  persist?: typeof persistArtefact;
}

interface OutcomeBase {
  itemKey: string;
  issues: string[];
  warnings: string[];
  receipts: NormalizedResult[];
  repairAttempts: number;
}

export type FinalizeOutcome = OutcomeBase & (
  | ({ status: 'succeeded' | 'needs_review'; article: ExplainerV2; artefactDigest: string; chartDigest: string }
    & Awaited<ReturnType<typeof persistArtefact>>)
  | { status: 'errored'; code: ErrorCode | 'INVALID_JSON' | 'INVALID_ARTICLE'; message: string }
);

type Obj = Record<string, unknown>;
type Quality = ExplainerV2['metadata']['quality'];
type WireContext = { citationKnown: boolean };
type Shape = 'plain' | 'inline' | 'value' | { [key: string]: Shape } | readonly [Shape];

const sourceShape: Shape = { ref: 'plain', page: 'value' };
const takeawayShape: Shape = { label: 'plain', body: 'inline' };
const wireShape: Record<string, Shape> = {
  hero: { title: 'plain', headline: 'plain', emphasis: 'plain', subtitle: 'plain' },
  top_block: {},
  sections: [{
    label: 'plain', paragraphs: ['inline'],
    list: { ordered: 'value', intro: 'inline', items: [{ label: 'plain', body: 'inline' }] },
    table: { caption: 'plain', columns: ['plain'], rows: [['plain']], source: sourceShape },
  }],
  charts: [{
    kind: 'value', title: 'plain', caption: 'plain',
    x: { label: 'plain', unit: 'plain', type: 'value', values: ['plain'] },
    y: { label: 'plain', unit: 'plain', scale: 'value' },
    series: [{
      name: 'plain', values: ['value'], points: [{ x: 'value', y: 'value' }],
      source: { kind: 'value', ref: 'plain', page: 'value' },
    }],
  }],
  figure_request: { label: 'plain', why: 'plain' },
  end_takeaway: takeawayShape,
  citation: {
    authors: [{ family: 'plain', given: 'plain' }], year: 'value', title: 'plain', venue: 'plain', url: 'value',
  },
};

function isObject(value: unknown): value is Obj {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function copy<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

export function canonicaliseWire(raw: unknown, ctx: WireContext): { wire: unknown; dropped: string[] } {
  const dropped: string[] = [];
  const walk = (value: unknown, shape: Shape, at: string): unknown => {
    if (value === null || value === undefined) return value;
    if (shape === 'plain' || shape === 'inline') {
      if (typeof value !== 'string') return value;
      const text = shape === 'plain' ? toPlain(value) : sanitiseInline(value);
      if (text !== value) dropped.push(`${at}: text canonicalised`);
      return text;
    }
    if (shape === 'value') return value;
    if (Array.isArray(shape)) {
      return Array.isArray(value) ? value.map((entry, i) => walk(entry, shape[0], `${at}[${i}]`)) : value;
    }
    if (!isObject(value)) return value;
    const fields = shape as Record<string, Shape>;
    return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
      const path = at ? `${at}.${key}` : key;
      if (!Object.hasOwn(fields, key)) {
        dropped.push(`${path}: unknown key removed`);
        return [];
      }
      if (at === '' && key === 'citation' && ctx.citationKnown && entry !== null) {
        dropped.push('citation: unused model citation removed');
        return [[key, null]];
      }
      return [[key, walk(entry, fields[key], path)]];
    }));
  };
  const top = isObject(raw) && isObject(raw.top_block) ? raw.top_block : {};
  const topShape: Shape = top.kind === 'pills'
    ? { kind: 'value', pills: [{ lead: 'plain', text: 'plain' }] }
    : { kind: 'value', ...takeawayShape as Record<string, Shape> };
  return { wire: walk(raw, { ...wireShape, top_block: topShape }, ''), dropped };
}

function issuePath(parts: PropertyKey[]): string {
  return parts.reduce<string>((path, part) => typeof part === 'number'
    ? `${path}[${part}]` : `${path}${path ? '.' : ''}${String(part)}`, '') || 'article';
}

export function wireIssues(wire: unknown, ctx: WireContext): string[] {
  const validation = modelOutputValidator(ctx).safeParse(wire);
  const issues = validation.success ? [] : validation.error.issues.map(i => `${issuePath(i.path)}: ${i.message}`);
  if (isObject(wire) && Array.isArray(wire.charts)) {
    wire.charts.forEach((chart, index) => issues.push(...chartIssues(chart as Chart, index)));
  }
  issues.push(...lintStyle(wire).map(i => `style (${i.check}) at ${i.path}: ${i.message}`));
  return issues;
}

function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, entry]) => entry !== null && entry !== undefined)
    .map(([key, entry]) => [key, stripNulls(entry)]));
}

export function slugFor(date: string, family: string, title: string): string {
  const segment = (text: string, limit: number): string => {
    let slug = text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (slug.length > limit) {
      const boundary = slug.lastIndexOf('-', limit);
      slug = boundary > 0 ? slug.slice(0, boundary) : slug.slice(0, limit);
    }
    return slug || 'paper';
  };
  return `${date}_${segment(family, 20)}_${segment(title, 40)}_explainer`;
}

export function stampArtefact(
  wire: ModelOutputV2, receipt: NormalizedResult, stamp: StampContext, quality: Quality,
): ExplainerV2 {
  const { citation, ...content } = wire;
  const reference = stamp.detectedReference ?? citation!;
  return ExplainerV2.parse(stripNulls({
    ...content,
    version: 2,
    metadata: {
      date_created: stamp.expectedDate,
      slug: slugFor(stamp.expectedDate, reference.authors[0].family, wire.hero.title),
      model: receipt.model, provider: receipt.provider,
      route: receipt.route === 'batch-api' ? 'batch' : 'sync',
      source: stamp.source, contract_revision: CONTRACT_REVISION, quality,
    },
    hero: { ...wire.hero, publication_date: stamp.publishedOn },
    references: [{ ...reference, origin: stamp.detectedReference ? 'detected' : 'model' }],
  }));
}

// Classify structural failures with the stored bounds but the wire's nulls.
// Keep refinements intact and leave actual null removal to the stamp step.
function withWireNulls(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodOptional) return withWireNulls(schema.unwrap() as z.ZodType).optional().nullable();
  if (schema instanceof z.ZodObject) {
    return schema.safeExtend(Object.fromEntries(Object.entries(schema.shape)
      .map(([key, field]) => [key, withWireNulls(field as z.ZodType)])));
  }
  if (schema instanceof z.ZodArray) {
    return schema.clone({ ...schema.def, element: withWireNulls(schema.element as z.ZodType) });
  }
  return schema;
}

const storedContent = withWireNulls(ExplainerV2.safeExtend({ version: z.any(), metadata: z.any(), references: z.any() }));
const storedCitation = withWireNulls(ExplainerV2.shape.references.element.omit({ origin: true }));

function structuralIssues(wire: unknown, ctx: WireContext): string[] {
  if (!isObject(wire)) return ['article: a wire object is required'];
  const { citation, ...content } = wire;
  const checks: z.ZodSafeParseResult<unknown>[] = [storedContent.safeParse(content)];
  if (!ctx.citationKnown) checks.push(storedCitation.safeParse(citation));
  return checks.flatMap(check => check.success ? [] : check.error.issues.map(i => `${issuePath(i.path)}: ${i.message}`));
}

interface Progress {
  wire: unknown;
  dropped: string[];
  receipts: NormalizedResult[];
  repairAttempts: number;
}

interface FinalProgress extends Omit<Progress, 'wire' | 'dropped'> {
  article: ExplainerV2;
  figureBytes?: string;
  issues: string[];
  artefactDigest: string;
  chartDigest: string;
}

interface FigureProgress {
  asset: (Omit<FigureAsset, 'bytes'> & { bytes: string }) | null;
  dropped?: string;
}

function parseWire(text: string): unknown {
  try { return extractJson(text); } catch { return undefined; }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).filter(key => value[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${sortedJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function finalizeResult(
  itemKey: string, result: NormalizedResult, context: FinalizeContext,
): Promise<FinalizeOutcome> {
  const receipt = checkResult(result);
  const base: OutcomeBase = { itemKey, issues: [], warnings: [], receipts: [receipt], repairAttempts: 0 };
  if (receipt.finishReason !== 'stop') {
    return { ...base, status: 'errored', code: receipt.error.code, message: receipt.error.message || 'Synthesis failed.' };
  }
  const ctx = { citationKnown: context.stamp.detectedReference !== undefined };
  const key = `finalize:${JSON.stringify([itemKey, receipt.attemptId])}`;
  const checkpoints = context.checkpoints;
  let final = await checkpoints.get(`${key}:final`) as FinalProgress | undefined;
  if (!final) {
    let progress = await checkpoints.get(`${key}:repair`) as Progress | undefined;
    if (!progress) {
      const parsed = parseWire(receipt.text);
      if (parsed === undefined) {
        return { ...base, status: 'errored', code: 'INVALID_JSON', message: 'Output is not parseable JSON.' };
      }
      let { wire, dropped } = canonicaliseWire(parsed, ctx);
      let issues = wireIssues(wire, ctx);
      const originalCharts = copy(isObject(wire) ? wire.charts : undefined);
      const receipts: NormalizedResult[] = [receipt];
      let repairAttempts = 0;
      while (context.repair && repairAttempts < MAX_REPAIR_ATTEMPTS && issues.some(issue => !isChartIssue(issue))) {
        const payload = { ...(isObject(wire) ? wire : {}), charts: [] };
        const reply = checkResult(await context.repair(
          buildWireRepairInstruction(issues.filter(issue => !isChartIssue(issue)), ctx), JSON.stringify(payload, null, 2),
        ));
        repairAttempts++;
        receipts.push(reply);
        if (reply.finishReason !== 'stop') continue;
        const parsedReply = parseWire(reply.text);
        if (!isObject(parsedReply)) continue;
        // Discard reply charts before canonicalising so even their text cannot enter the record.
        const candidate = canonicaliseWire({ ...parsedReply, charts: copy(originalCharts) }, ctx);
        const nextIssues = wireIssues(candidate.wire, ctx);
        if (nextIssues.length < issues.length) {
          wire = candidate.wire;
          dropped = [...dropped, ...candidate.dropped];
          issues = nextIssues;
        }
      }
      progress = { wire, dropped, receipts, repairAttempts };
      await checkpoints.put(`${key}:repair`, copy(progress));
    }
    progress = copy(progress);
    const wire = progress.wire;
    let issues = wireIssues(wire, ctx);
    if (isObject(wire)) {
      if (Array.isArray(wire.charts)) {
        const thin = dropThinCharts(wire.charts as Chart[]);
        wire.charts = wire.charts.filter((chart, index) => {
          const at = `charts[${index}]`;
          const invalid = issues.some(issue => issue.startsWith(`${at}:`) || issue.startsWith(`${at}.`)
            || (isChartIssue(issue) && issue.includes(`${at}.`)));
          if (invalid) {
            progress.dropped.push(`${at}: invalid chart removed`);
            return false;
          }
          if (!thin.kept.includes(chart)) {
            progress.dropped.push(...thin.dropped.filter(message => message.startsWith(`${at}:`)));
            return false;
          }
          return true;
        });
      }
      if (isObject(wire.hero) && issues.some(i => i.startsWith('hero.emphasis:') || i.startsWith('style (') && i.includes(' at hero.emphasis:'))) {
        wire.hero.emphasis = null;
        progress.dropped.push('hero.emphasis: invalid emphasis removed');
      }
      if (issues.some(i => i.startsWith('figure_request:') || i.startsWith('figure_request.')
        || i.startsWith('style (') && i.includes(' at figure_request'))) {
        wire.figure_request = null;
        progress.dropped.push('figure_request: invalid request removed');
      }
      issues = wireIssues(wire, ctx);
    }
    const structural = structuralIssues(wire, ctx);
    if (structural.length) {
      return {
        ...base, receipts: progress.receipts, repairAttempts: progress.repairAttempts,
        issues, status: 'errored', code: 'INVALID_ARTICLE', message: structural.join('\n'),
      };
    }
    let figure: FigureProgress | undefined;
    if ((wire as ModelOutputV2).figure_request && context.figure) {
      figure = await checkpoints.get(`${key}:figure`) as FigureProgress | undefined;
      if (!figure) {
        try {
          const asset = await context.figure(copy(wire) as ModelOutputV2, itemKey);
          if (!asset) {
            figure = { asset: null, dropped: 'figure_request: no figure located' };
          } else if (!sniffImageType(asset.bytes)) {
            figure = { asset: null, dropped: 'figure_request: unrecognised image bytes' };
          } else {
            figure = { asset: { ...asset, bytes: asset.bytes.toString('base64') } };
          }
        } catch (error) {
          figure = { asset: null, dropped: `figure_request: ${error instanceof Error ? error.message : String(error)}` };
        }
        await checkpoints.put(`${key}:figure`, copy(figure));
      }
      if (figure.dropped) progress.dropped.push(figure.dropped);
    }
    let article = stampArtefact(wire as ModelOutputV2, receipt, context.stamp, { issues, dropped: progress.dropped });
    if (figure?.asset) {
      const { bytes: encoded, ...metadata } = figure.asset;
      const bytes = Buffer.from(encoded, 'base64');
      const file = assetFileName(parseLabel(metadata.label), sniffImageType(bytes)!);
      article = ExplainerV2.parse({
        ...article,
        lead_figure: {
          ...metadata, asset: `${article.metadata.slug}/${file}`,
          sha256: createHash('sha256').update(bytes).digest('hex'), ...imageSize(bytes),
        },
      });
    }
    final = {
      article, issues, receipts: progress.receipts, repairAttempts: progress.repairAttempts,
      figureBytes: figure?.asset?.bytes,
      artefactDigest: sha256(JSON.stringify(article, null, 2)), chartDigest: sha256(sortedJson(article.charts)),
    };
    await checkpoints.put(`${key}:final`, copy(final));
  }
  const saved = await (context.persist ?? persistArtefact)(copy(final.article), {
    itemKey, kind: final.issues.length === 0 ? 'success' : 'review',
    figureBytes: final.figureBytes === undefined ? undefined : Buffer.from(final.figureBytes, 'base64'),
  });
  return {
    itemKey, status: final.issues.length === 0 ? 'succeeded' : 'needs_review',
    article: final.article, issues: final.issues, warnings: [],
    receipts: final.receipts, repairAttempts: final.repairAttempts,
    artefactDigest: final.artefactDigest, chartDigest: final.chartDigest, ...saved,
  };
}
