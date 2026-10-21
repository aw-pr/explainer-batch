import { LlmContractError, type ProviderId, type Route } from './llm-contract';
import type { BatchState, RequestState, State as StateV1 } from './state';
import {
  emptyStateV2, fileCachePut,
  type BatchV2, type ItemState, type LegacyBatchRecord, type LegacyMigrationStatus, type LegacyUsage,
  type RequestV2, type StateV2,
} from './state-v2';

export type MigrationDisposition = 'remote' | 'local' | 'archived';

export interface MigrationReportRow {
  id: string;
  disposition: MigrationDisposition;
  provider: ProviderId | null;
  route: Route | null;
  /** Key under `batches` or `legacy.batches`; differs from `id` only for a repeated v1 id. */
  key: string;
  migration_status?: LegacyMigrationStatus;
  reason: string;
  requests: number;
  /** Item states after conversion; absent for an archived batch, whose requests keep their v1 form. */
  items?: Partial<Record<ItemState, number>>;
}

export interface MigrationReport {
  batches: MigrationReportRow[];
  file_cache: { moved: number; retained_as_legacy: number };
}

interface Executable {
  kind: 'remote' | 'local';
  provider: ProviderId;
  route: Route;
  reason: string;
}

interface Quarantined {
  status: LegacyMigrationStatus;
  route: Route | null;
  provider: ProviderId | null;
  reason: string;
}

const SYNC_CLAUDE_INFERENCE = {
  rule: 'sync_claude_ prefix',
  detail: 'v1 Claude sync runs could only use the OAuth subscription CLI, so the route is inferred from the batch id.',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLaneBearing(batch: BatchState): boolean {
  return Boolean(batch.lane_model) || Object.values(batch.requests).some(r => r.type === 'lane');
}

function conflicting(provider: ProviderId | null, route: Route | null, reason: string): Quarantined {
  return { status: 'conflicting_evidence', provider, route, reason };
}

/** Decides a v1 batch's route from its id and provider, never from today's credentials. */
function classify(batch: BatchState): Executable | Quarantined {
  const id = batch.id;
  const provider = (batch.provider ?? null) as string | null;
  if (provider !== null && provider !== 'claude' && provider !== 'openai') {
    return conflicting(null, null, `provider ${JSON.stringify(provider)} is not a v1 provider`);
  }
  if (id.startsWith('sync_claude_')) {
    if (provider === 'openai') return conflicting(null, null, 'sync_claude_ id with provider openai');
    return { kind: 'local', provider: 'claude', route: 'subscription-cli', reason: 'local Claude sync run (route inferred)' };
  }
  if (id.startsWith('sync_openai_')) {
    if (provider === 'claude') return conflicting(null, null, 'sync_openai_ id with provider claude');
    return {
      status: 'needs_route_evidence', provider: 'openai', route: null,
      reason: 'an OpenAI sync run may have used the API or ChatGPT auth; the route is not inferred',
    };
  }
  if (id.startsWith('sync_')) {
    return { status: 'needs_route_evidence', provider: null, route: null, reason: 'unrecognised local sync id' };
  }
  if (id.startsWith('codexbatch_')) {
    if (provider === 'claude') return conflicting(null, null, 'codexbatch_ id with provider claude');
    return { kind: 'local', provider: 'openai', route: 'subscription-cli', reason: 'local codex batch' };
  }
  if (id.startsWith('msgbatch_')) {
    if (provider === 'openai') return conflicting(null, 'batch-api', 'msgbatch_ id with provider openai');
    return {
      kind: 'remote', provider: 'claude', route: 'batch-api',
      reason: provider ? 'remote Claude batch' : 'remote Claude batch (v1 default provider, consistent with id)',
    };
  }
  if (provider === 'claude') return { kind: 'remote', provider: 'claude', route: 'batch-api', reason: 'remote Claude batch' };
  if (provider === 'openai') return { kind: 'remote', provider: 'openai', route: 'batch-api', reason: 'remote OpenAI batch' };
  return {
    status: 'needs_route_evidence', provider: null, route: null,
    reason: 'no provider recorded and the id is not a Claude batch id',
  };
}

function itemState(request: RequestState, local: boolean): ItemState {
  if (request.result === 'succeeded') return 'succeeded';
  if (request.result === 'errored') return 'errored';
  if (request.result === 'pending') return local ? 'outcome_unknown' : 'running';
  return 'outcome_unknown';
}

function countItems(requests: Record<string, { state: ItemState }>): Partial<Record<ItemState, number>> {
  const counts: Partial<Record<ItemState, number>> = {};
  for (const { state } of Object.values(requests)) counts[state] = (counts[state] ?? 0) + 1;
  return counts;
}

function toExecutable(batch: BatchState, decision: Executable): BatchV2 {
  const local = decision.kind === 'local';
  const codex = batch.id.startsWith('codexbatch_');
  const requests: Record<string, RequestV2> = {};
  for (const [requestId, request] of Object.entries(batch.requests)) {
    const state = itemState(request, local);
    requests[requestId] = {
      ...request,
      state,
      ...(codex && state === 'outcome_unknown' ? { needs_source_recovery: true } : {}),
    };
  }
  const { id, model, synthesis_model, submitted_at, status } = batch;
  return {
    id,
    provider: decision.provider,
    route: decision.route,
    kind: decision.kind,
    status,
    ...(local ? {} : { remoteId: id }),
    ...(batch.id.startsWith('sync_claude_') ? { legacy_inference: { ...SYNC_CLAUDE_INFERENCE } } : {}),
    model,
    ...(synthesis_model !== undefined ? { synthesis_model } : {}),
    submitted_at,
    requests,
  };
}

function assertV1(v1: unknown): asserts v1 is StateV1 {
  if (!isRecord(v1)) throw new LlmContractError('STATE_CORRUPT', 'The v1 state is not a JSON object.');
  if ('version' in v1) {
    throw new LlmContractError('STATE_VERSION_UNSUPPORTED',
      `The state already carries version ${JSON.stringify(v1.version)}; only a version-1 state migrates.`);
  }
  if (!Array.isArray(v1.batches)) throw new LlmContractError('STATE_CORRUPT', 'The v1 state has no batches array.');
  v1.batches.forEach((batch, index) => {
    if (!isRecord(batch) || typeof batch.id !== 'string' || batch.id === '' || !isRecord(batch.requests)
      || !Object.values(batch.requests).every(isRecord)) {
      throw new LlmContractError('STATE_CORRUPT', `The v1 batch at index ${index} is malformed.`);
    }
  });
  if (v1.openai_file_cache !== undefined && !isRecord(v1.openai_file_cache)) {
    throw new LlmContractError('STATE_CORRUPT', 'The v1 openai_file_cache is not an object.');
  }
}

/**
 * Converts a v1 state to version 2 without touching its input. Batches whose
 * route is ambiguous, conflicting or lane-bearing move, whole, to a read-only
 * legacy archive; per-request v1 usage is kept under `legacy_usage`.
 */
export function migrateStateV1(
  v1: unknown, opts: { openaiAccountScope?: string } = {},
): { state: StateV2; report: MigrationReport } {
  assertV1(v1);
  const source = structuredClone(v1);
  const state = emptyStateV2();
  const legacyBatches: Record<string, LegacyBatchRecord> = {};
  const legacyUsage: Record<string, LegacyUsage> = {};
  const rows: MigrationReportRow[] = [];
  const usedKeys = new Set<string>();

  source.batches.forEach((batch, index) => {
    let decision = classify(batch);
    if ('kind' in decision && isLaneBearing(batch)) {
      decision = {
        status: 'lane_history', provider: decision.provider, route: decision.route,
        reason: 'lane-bearing history must be drained on the old build or explicitly abandoned',
      };
    }
    let key = batch.id;
    if (usedKeys.has(key)) {
      key = `${batch.id}#${index}`;
      decision = {
        status: 'duplicate_id', provider: null, route: null,
        reason: `batch id repeated in v1 state (entry ${index}); archived to keep both records`,
      };
    }
    usedKeys.add(key);

    let route: Route | null;
    if ('kind' in decision) {
      const converted = toExecutable(batch, decision);
      state.batches[key] = converted;
      route = converted.route;
      rows.push({
        id: batch.id, key, disposition: decision.kind, provider: decision.provider, route,
        reason: decision.reason, requests: Object.keys(batch.requests).length, items: countItems(converted.requests),
      });
    } else {
      route = decision.route;
      legacyBatches[key] = {
        ...batch, route, migration_status: decision.status, archive_reason: decision.reason,
      };
      rows.push({
        id: batch.id, key, disposition: 'archived', provider: decision.provider, route,
        migration_status: decision.status, reason: decision.reason, requests: Object.keys(batch.requests).length,
      });
    }

    const usage: LegacyUsage['requests'] = {};
    for (const [requestId, request] of Object.entries(batch.requests)) {
      if (isRecord(request.usage)) usage[requestId] = { ...request.usage };
    }
    if (Object.keys(usage).length > 0) legacyUsage[key] = { route, comparable: false, requests: usage };
  });

  const legacyFileCache: NonNullable<NonNullable<StateV2['legacy']>['file_cache']> = {};
  let moved = 0;
  for (const [sha, entry] of Object.entries(source.openai_file_cache ?? {})) {
    const movable = opts.openaiAccountScope && isRecord(entry) && typeof entry.file_id === 'string' && entry.file_id
      && (entry.sha256 === undefined || entry.sha256 === sha) && typeof entry.size_bytes === 'number'
      && typeof entry.updated_at === 'string';
    if (movable) {
      fileCachePut(state, 'openai', opts.openaiAccountScope as string, 'pdf', sha, {
        fileId: entry.file_id, sizeBytes: entry.size_bytes, uploadedAt: entry.updated_at,
      });
      moved += 1;
    } else {
      legacyFileCache[sha] = entry;
    }
  }

  const retained = Object.keys(legacyFileCache).length;
  if (Object.keys(legacyBatches).length > 0 || retained > 0) {
    state.legacy = { batches: legacyBatches, ...(retained > 0 ? { file_cache: legacyFileCache } : {}) };
  }
  if (Object.keys(legacyUsage).length > 0) state.legacy_usage = legacyUsage;

  return { state, report: { batches: rows, file_cache: { moved, retained_as_legacy: retained } } };
}
