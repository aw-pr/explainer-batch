import { createHash } from 'node:crypto';
import { checkResult, type ErrorCode, type NormalizedResult } from './llm-contract';
import { extractJson, normalizeExplainerJson, persistArtefact, stampProvenanceByline, type RunProvenance } from './output';
import { buildRepairInstruction, isChartIssue, validateJsonOutput } from './quality';
import { MAX_REPAIR_ATTEMPTS } from './repair';
import type { ExplainerImage, ExplainerJson } from './types/explainer-json';

export interface FinalizeContext {
  provenance: RunProvenance;
  checkpoints: {
    get(key: string): unknown | Promise<unknown>;
    put(key: string, value: unknown): void | Promise<void>;
  };
  repair?: (instruction: string, payload: string) => Promise<NormalizedResult>;
  figure?: (article: ExplainerJson, itemKey: string) => Promise<ExplainerImage | null>;
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
  | ({ status: 'succeeded' | 'needs_review'; article: ExplainerJson; artefactDigest: string; chartDigest: string }
    & Awaited<ReturnType<typeof persistArtefact>>)
  | { status: 'errored'; code: ErrorCode | 'INVALID_JSON'; message: string }
);

interface Progress {
  article: ExplainerJson;
  expectedDate: string;
  issues: string[];
  warnings: string[];
  receipts: NormalizedResult[];
  repairAttempts: number;
}

interface FinalProgress extends Progress {
  artefactDigest: string;
  chartDigest: string;
}

const CHART_KEYS = ['charts', 'chart', 'recreated_figure'] as const;

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseArticle(text: string): ExplainerJson | null {
  try {
    const parsed = extractJson(text) as ExplainerJson | null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || !parsed.metadata || typeof parsed.metadata !== 'object' || Array.isArray(parsed.metadata)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function prepare(article: ExplainerJson, provenance: RunProvenance, expectedDate: string): ExplainerJson {
  normalizeExplainerJson(article);
  delete article.metadata.quality;
  stampProvenanceByline(article, provenance);
  article.metadata.date_created = expectedDate;
  if (typeof article.metadata.filename_slug === 'string') {
    article.metadata.filename_slug = article.metadata.filename_slug.replace(/^\d{4}-\d{2}-\d{2}_/, `${expectedDate}_`);
  }
  if (provenance.model) article.metadata.model = provenance.model;
  if (provenance.runMode) article.metadata.run_mode = provenance.runMode;
  return article;
}

function issuesFor(article: ExplainerJson, expectedDate: string): string[] {
  const { quality: _quality, ...metadata } = article.metadata;
  return validateJsonOutput({ ...article, metadata }, { expectedDate }).issues;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).filter(key => object[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${sortedJson(object[key])}`).join(',')}}`;
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

  const key = `finalize:${JSON.stringify([itemKey, receipt.attemptId])}`;
  const checkpoints = context.checkpoints;
  let final = await checkpoints.get(`${key}:final`) as FinalProgress | undefined;
  if (!final) {
    let progress = await checkpoints.get(`${key}:figure`) as Progress | undefined;
    if (!progress) {
      progress = await checkpoints.get(`${key}:repair`) as Progress | undefined;
      if (!progress) {
        const parsed = parseArticle(receipt.text);
        if (!parsed) {
          return { ...base, status: 'errored', code: 'INVALID_JSON', message: 'Output is not parseable JSON with a metadata object.' };
        }
        const ownDate = typeof parsed.metadata.date_created === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.metadata.date_created)
          ? parsed.metadata.date_created : undefined;
        const expectedDate = context.provenance.expectedDate ?? ownDate ?? new Date().toISOString().slice(0, 10);
        let article = prepare(parsed, context.provenance, expectedDate);
        let issues = issuesFor(article, expectedDate);
        const originalCharts: Record<string, unknown> = {};
        for (const chartKey of CHART_KEYS) {
          if (article[chartKey] !== undefined) originalCharts[chartKey] = copy(article[chartKey]);
        }
        const receipts: NormalizedResult[] = [receipt];
        let repairAttempts = 0;
        while (context.repair && repairAttempts < MAX_REPAIR_ATTEMPTS && issues.some(issue => !isChartIssue(issue))) {
          const payload = copy(article);
          for (const chartKey of CHART_KEYS) delete payload[chartKey];
          const reply = checkResult(await context.repair(
            buildRepairInstruction(issues.filter(issue => !isChartIssue(issue)), expectedDate), JSON.stringify(payload, null, 2),
          ));
          repairAttempts += 1;
          receipts.push(reply);
          if (reply.finishReason !== 'stop') continue;
          const candidate = parseArticle(reply.text);
          if (!candidate) continue;
          prepare(candidate, context.provenance, expectedDate);
          for (const chartKey of CHART_KEYS) {
            delete candidate[chartKey];
          }
          Object.assign(candidate, copy(originalCharts));
          const nextIssues = issuesFor(candidate, expectedDate);
          if (nextIssues.length < issues.length) {
            article = candidate;
            issues = nextIssues;
          }
        }
        progress = { article, expectedDate, issues, warnings: [], receipts, repairAttempts };
        await checkpoints.put(`${key}:repair`, copy(progress));
      }
      // Work on a copy so a checkpoint store may safely retain object references.
      progress = copy(progress);
      if (context.figure) {
        try {
          const image = await context.figure(copy(progress.article), itemKey);
          if (image === null) delete progress.article.image;
          else progress.article.image = copy(image);
        } catch (error) {
          delete progress.article.image;
          progress.warnings.push(`Optional figure failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        await checkpoints.put(`${key}:figure`, copy(progress));
      }
    }
    progress = copy(progress);
    progress.issues = issuesFor(progress.article, progress.expectedDate);
    progress.article.metadata.quality = { issues: progress.issues, needs_review: progress.issues.length > 0 };
    const chartContent: Record<string, unknown> = {};
    for (const chartKey of CHART_KEYS) chartContent[chartKey] = progress.article[chartKey];
    final = {
      ...progress,
      artefactDigest: sha256(JSON.stringify(progress.article, null, 2)),
      chartDigest: sha256(sortedJson(chartContent)),
    };
    await checkpoints.put(`${key}:final`, copy(final));
  }
  const saved = await (context.persist ?? persistArtefact)(copy(final.article), {
    itemKey, kind: final.issues.length === 0 ? 'success' : 'review',
  });
  return {
    itemKey, status: final.issues.length === 0 ? 'succeeded' : 'needs_review',
    article: final.article, issues: final.issues, warnings: final.warnings,
    receipts: final.receipts, repairAttempts: final.repairAttempts,
    artefactDigest: final.artefactDigest, chartDigest: final.chartDigest, ...saved,
  };
}
