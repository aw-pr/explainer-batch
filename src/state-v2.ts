import { randomBytes } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { setTimeout as delay } from 'timers/promises';
import { LlmContractError, type ProviderId, type Route, type RunPlan, type Stage } from './llm-contract';
import type { BatchState, RequestState, TokenUsage as LegacyTokenUsage } from './state';

export const ITEM_STATES = [
  'queued', 'running', 'received', 'finalising', 'succeeded', 'needs_review', 'errored', 'outcome_unknown',
] as const;
export type ItemState = (typeof ITEM_STATES)[number];

const PROVIDERS: readonly ProviderId[] = ['claude', 'openai', 'gemini'];
const ROUTES: readonly Route[] = ['batch-api', 'sync-api', 'subscription-cli'];
const STAGES: readonly Stage[] = ['synthesis', 'repair', 'vision'];
const KINDS = ['remote', 'local'] as const;

export interface LegacyInference {
  rule: string;
  detail: string;
}

export interface RequestV2 extends RequestState {
  state: ItemState;
  /** Set by migration when the source must be recovered before the item can run again. */
  needs_source_recovery?: boolean;
}

export interface BatchV2 {
  id: string;
  provider: ProviderId;
  route: Route;
  kind: (typeof KINDS)[number];
  status: string;
  remoteId?: string;
  legacy_inference?: LegacyInference;
  model?: string;
  synthesis_model?: string;
  submitted_at?: string;
  requests: Record<string, RequestV2>;
}

export interface Receipt {
  runId: string;
  batchId: string;
  itemId: string;
  customId: string;
  attemptId: string;
  stage: Stage;
  digest: string;
}

export interface FileCacheEntry {
  fileId: string;
  sizeBytes: number;
  uploadedAt: string;
  verifiedAt?: string;
  expiresAt?: string;
}

export type FileCache = Partial<Record<ProviderId, Record<string, Record<string, Record<string, FileCacheEntry>>>>>;

export type LegacyMigrationStatus = 'needs_route_evidence' | 'conflicting_evidence' | 'lane_history' | 'duplicate_id';

/** A v1 batch kept read-only: every v1 field, plus why it cannot execute. */
export type LegacyBatchRecord = BatchState & {
  route: Route | null;
  migration_status: LegacyMigrationStatus;
  archive_reason: string;
};

export interface LegacyFileCacheEntry {
  file_id: string;
  sha256: string;
  size_bytes: number;
  updated_at: string;
}

export interface LegacyUsage {
  route: Route | null;
  /** v1 recorded no attempts or repairs per call, so these figures never compare with v2 cost. */
  comparable: false;
  requests: Record<string, LegacyTokenUsage>;
}

export interface StateV2 {
  version: 2;
  revision: number;
  batches: Record<string, BatchV2>;
  plans: Record<string, RunPlan>;
  receipts: Record<string, Receipt>;
  file_cache: FileCache;
  legacy?: {
    batches: Record<string, LegacyBatchRecord>;
    file_cache?: Record<string, LegacyFileCacheEntry>;
  };
  legacy_usage?: Record<string, LegacyUsage>;
}

export interface LockOptions {
  lockWaitMs?: number;
}

export const DEFAULT_LOCK_WAIT_MS = 5000;
export const MIGRATION_SCRIPT = 'scripts/migrate-state-v2.ts';

export function emptyStateV2(): StateV2 {
  return { version: 2, revision: 0, batches: {}, plans: {}, receipts: {}, file_cache: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMember<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function corrupt(label: string, detail: string): LlmContractError {
  return new LlmContractError('STATE_CORRUPT', `${label}: invalid version-2 state (${detail}); refusing to read or write it.`);
}

function shapeProblem(value: Record<string, unknown>): string | null {
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0) return 'revision';
  for (const key of ['batches', 'plans', 'receipts', 'file_cache']) {
    if (!isRecord(value[key])) return key;
  }
  for (const [id, batch] of Object.entries(value.batches as Record<string, unknown>)) {
    if (!isRecord(batch) || batch.id !== id || !isMember(PROVIDERS, batch.provider)
      || !isMember(ROUTES, batch.route) || !isMember(KINDS, batch.kind)
      || typeof batch.status !== 'string' || !isRecord(batch.requests)) return `batches.${id}`;
    for (const [requestId, request] of Object.entries(batch.requests)) {
      if (!isRecord(request) || !isMember(ITEM_STATES, request.state)) return `batches.${id}.requests.${requestId}`;
    }
  }
  for (const [runId, plan] of Object.entries(value.plans as Record<string, unknown>)) {
    if (!isRecord(plan)) return `plans.${runId}`;
  }
  for (const [key, receipt] of Object.entries(value.receipts as Record<string, unknown>)) {
    if (!isRecord(receipt) || !isMember(STAGES, receipt.stage)
      || !['runId', 'batchId', 'itemId', 'customId', 'attemptId', 'digest'].every(f => isNonEmptyString(receipt[f]))
      || receiptKey(receipt as unknown as Receipt) !== key) return `receipts.${key}`;
  }
  for (const [provider, scopes] of Object.entries(value.file_cache as Record<string, unknown>)) {
    if (!isMember(PROVIDERS, provider) || !isRecord(scopes)) return `file_cache.${provider}`;
    for (const [scope, purposes] of Object.entries(scopes)) {
      if (!isRecord(purposes)) return `file_cache.${provider}.${scope}`;
      for (const [purpose, entries] of Object.entries(purposes)) {
        if (!isRecord(entries)) return `file_cache.${provider}.${scope}.${purpose}`;
        for (const [sha, entry] of Object.entries(entries)) {
          if (!isRecord(entry) || !isNonEmptyString(entry.fileId) || typeof entry.sizeBytes !== 'number'
            || typeof entry.uploadedAt !== 'string') return `file_cache.${provider}.${scope}.${purpose}.${sha}`;
        }
      }
    }
  }
  if (value.legacy !== undefined) {
    if (!isRecord(value.legacy) || !isRecord(value.legacy.batches)) return 'legacy';
    if (value.legacy.file_cache !== undefined && !isRecord(value.legacy.file_cache)) return 'legacy.file_cache';
  }
  if (value.legacy_usage !== undefined && !isRecord(value.legacy_usage)) return 'legacy_usage';
  return null;
}

/** Checks a parsed value is a supported version-2 state; `label` names it in errors. */
export function validateStateV2(value: unknown, label = 'state'): StateV2 {
  if (!isRecord(value)) throw corrupt(label, 'not a JSON object');
  if (!('version' in value)) {
    throw new LlmContractError('STATE_VERSION_UNSUPPORTED',
      `${label} is a version-1 state; migrate it first with ${MIGRATION_SCRIPT} (preview, then --apply).`);
  }
  if (value.version !== 2) {
    throw new LlmContractError('STATE_VERSION_UNSUPPORTED',
      `${label} has state version ${JSON.stringify(value.version)}; this build reads only version 2.`);
  }
  const problem = shapeProblem(value);
  if (problem) throw corrupt(label, `bad ${problem}`);
  return value as unknown as StateV2;
}

/** Reads the state without modifying the file. Only an absent file is an empty state. */
export function loadStateV2(file: string): StateV2 {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyStateV2();
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw corrupt(file, error instanceof Error ? error.message : String(error));
  }
  return validateStateV2(parsed, file);
}

function fsyncDirectory(dir: string): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch (error) {
    // Some platforms refuse fsync on a directory descriptor; the rename itself has still happened.
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EINVAL' && code !== 'EISDIR' && code !== 'EPERM' && code !== 'EBADF') throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function uniqueSuffix(): string {
  return `${process.pid}-${Date.now()}-${randomBytes(6).toString('hex')}`;
}

/** Writes a new file that must not already exist, and fsyncs it. */
export function writeNewFileDurably(file: string, contents: string | Buffer): void {
  const fd = fs.openSync(file, 'wx');
  try {
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Replaces `file` atomically: a uniquely named sibling temp file is written and
 * fsynced, renamed over the target, then the directory is fsynced. A crash at
 * any point leaves either the old or the new file; a stray temp file is never read.
 */
export function replaceFileAtomically(file: string, contents: string): void {
  const tmp = `${file}.tmp-${uniqueSuffix()}`;
  try {
    writeNewFileDurably(tmp, contents);
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
  fsyncDirectory(path.dirname(file));
}

export function serialiseStateV2(state: StateV2): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Locks: a directory holding owner.json, renamed into place so it is never
// visible without an owner, and renamed away before removal so a concurrent
// acquirer can never land inside a half-deleted lock.

export interface LockOwner {
  nonce: string;
  hostname: string;
  pid: number;
  /** When the owning process started, so a reader can tell a reused pid apart. */
  startedAt: string;
  acquiredAt: string;
}

interface HeldLock {
  dir: string;
  nonce: string;
}

const PROCESS_STARTED_AT = new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString();

function readOwner(lockDir: string): LockOwner | null {
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'));
    return isRecord(owner) ? owner as unknown as LockOwner : null;
  } catch {
    return null;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function provablyDead(owner: LockOwner | null): owner is LockOwner {
  return owner !== null && owner.hostname === os.hostname()
    && Number.isSafeInteger(owner.pid) && owner.pid > 0 && owner.pid !== process.pid
    && !processIsAlive(owner.pid);
}

function discardLockDir(lockDir: string, tag: string): boolean {
  const graveyard = `${lockDir}.${tag}-${uniqueSuffix()}`;
  try {
    fs.renameSync(lockDir, graveyard);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  fs.rmSync(graveyard, { recursive: true, force: true });
  return true;
}

function tryCreateLock(lockDir: string): HeldLock | null {
  // rename() would silently replace an empty directory, which this protocol never
  // leaves behind; treat any existing entry, empty or not, as a held lock.
  if (fs.existsSync(lockDir)) return null;
  const nonce = randomBytes(16).toString('hex');
  const staging = `${lockDir}.new-${uniqueSuffix()}`;
  fs.mkdirSync(staging);
  try {
    const owner: LockOwner = {
      nonce, hostname: os.hostname(), pid: process.pid,
      startedAt: PROCESS_STARTED_AT, acquiredAt: new Date().toISOString(),
    };
    writeNewFileDurably(path.join(staging, 'owner.json'), JSON.stringify(owner, null, 2));
    fs.renameSync(staging, lockDir);
    return { dir: lockDir, nonce };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOTEMPTY' || code === 'EEXIST') return null;
    throw error;
  }
}

/**
 * Removes a lock whose same-host owner has died. A short reclaim guard
 * serialises reclaimers, so one that read a stale owner can never remove a
 * lock another process has freshly taken.
 */
function tryReclaim(lockDir: string): boolean {
  if (!provablyDead(readOwner(lockDir))) return false;
  const guard = tryCreateLock(`${lockDir}.reclaim`);
  if (!guard) {
    if (provablyDead(readOwner(`${lockDir}.reclaim`))) discardLockDir(`${lockDir}.reclaim`, 'stale');
    return false;
  }
  try {
    const owner = readOwner(lockDir);
    return provablyDead(owner) && discardLockDir(lockDir, 'stale');
  } finally {
    releaseLock(guard);
  }
}

function busy(lockDir: string, waitMs: number): LlmContractError {
  const owner = readOwner(lockDir);
  const who = owner
    ? `held by pid ${owner.pid} on ${owner.hostname} since ${owner.acquiredAt ?? owner.startedAt}`
    : 'held by an owner that could not be read';
  return new LlmContractError('STATE_BUSY',
    `${lockDir} is ${who}; gave up after ${waitMs} ms. A live or foreign owner is never evicted: `
    + 'stop that process, or remove the lock directory by hand only once you are sure it is gone.');
}

function attempt(lockDir: string): HeldLock | null {
  const held = tryCreateLock(lockDir);
  if (held) return held;
  return tryReclaim(lockDir) ? tryCreateLock(lockDir) : null;
}

const sleeper = new Int32Array(new SharedArrayBuffer(4));

function acquireLockSync(lockDir: string, waitMs: number): HeldLock {
  const deadline = Date.now() + waitMs;
  let pause = 5;
  for (;;) {
    const held = attempt(lockDir);
    if (held) return held;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw busy(lockDir, waitMs);
    Atomics.wait(sleeper, 0, 0, Math.min(remaining, pause + Math.random() * pause));
    pause = Math.min(pause * 1.5, 100);
  }
}

async function acquireLockAsync(lockDir: string, waitMs: number): Promise<HeldLock> {
  const deadline = Date.now() + waitMs;
  let pause = 5;
  for (;;) {
    const held = attempt(lockDir);
    if (held) return held;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw busy(lockDir, waitMs);
    await delay(Math.min(remaining, pause + Math.random() * pause));
    pause = Math.min(pause * 1.5, 250);
  }
}

function releaseLock(lock: HeldLock): void {
  // Only ever remove our own lock; if it was taken from us, leave the new owner alone.
  if (readOwner(lock.dir)?.nonce === lock.nonce) discardLockDir(lock.dir, 'released');
}

export function stateLockPath(file: string): string {
  return `${file}.lock`;
}

export function batchLockPath(file: string, batchId: string): string {
  return `${file}.batch-${batchId.replace(/[^A-Za-z0-9._-]/g, '_')}.lock`;
}

/** Runs `fn` while holding the state lock. Synchronous: never make network calls inside it. */
export function withStateLock<T>(file: string, fn: () => T, opts: LockOptions = {}): T {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = acquireLockSync(stateLockPath(file), opts.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS);
  try {
    return fn();
  } finally {
    releaseLock(lock);
  }
}

/**
 * Applies `fn` to a freshly read state under the state lock and persists it
 * with the revision advanced by one. If `fn` throws, nothing is written.
 */
export function transactState(file: string, fn: (state: StateV2) => void, opts: LockOptions = {}): StateV2 {
  return withStateLock(file, () => {
    const state = loadStateV2(file);
    const revision = state.revision;
    const returned: unknown = fn(state);
    if (returned instanceof Promise) {
      throw new TypeError('transactState callbacks must be synchronous; hold a batch lock across long calls instead.');
    }
    state.revision = revision + 1;
    const contents = serialiseStateV2(state);
    validateStateV2(JSON.parse(contents), `${file} (after transaction)`);
    replaceFileAtomically(file, contents);
    return state;
  }, opts);
}

/** Holds the batch execution lock across `fn`, releasing it however `fn` ends. */
export async function withBatchLock<T>(
  file: string, batchId: string, fn: () => Promise<T>, opts: LockOptions = {},
): Promise<T> {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = await acquireLockAsync(batchLockPath(file, batchId), opts.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS);
  try {
    return await fn();
  } finally {
    releaseLock(lock);
  }
}

// ---------------------------------------------------------------------------
// Receipts and file cache.

function receiptKey(receipt: Pick<Receipt, 'runId' | 'customId' | 'attemptId'>): string {
  return JSON.stringify([receipt.runId, receipt.customId, receipt.attemptId]);
}

/** Records a receipt once per (runId, customId, attemptId); a different digest under that key is RESULT_CONFLICT. */
export function recordReceipt(state: StateV2, receipt: Receipt): 'recorded' | 'duplicate' {
  for (const field of ['runId', 'batchId', 'itemId', 'customId', 'attemptId', 'digest'] as const) {
    if (!isNonEmptyString(receipt[field])) throw new TypeError(`Receipt ${field} must be a non-empty string.`);
  }
  if (!isMember(STAGES, receipt.stage)) throw new TypeError(`Receipt stage ${String(receipt.stage)} is not a stage.`);
  const key = receiptKey(receipt);
  const existing = state.receipts[key];
  if (existing) {
    if (existing.digest === receipt.digest) return 'duplicate';
    throw new LlmContractError('RESULT_CONFLICT',
      `Receipt ${key} is already recorded with digest ${existing.digest}, not ${receipt.digest}.`);
  }
  const { runId, batchId, itemId, customId, attemptId, stage, digest } = receipt;
  state.receipts[key] = { runId, batchId, itemId, customId, attemptId, stage, digest };
  return 'recorded';
}

export function listReceipts(state: StateV2): Receipt[] {
  return Object.values(state.receipts);
}

function assertCacheKey(provider: ProviderId, accountScope: string, purpose: string, sha256: string): void {
  if (!isMember(PROVIDERS, provider)) throw new TypeError(`Unknown provider ${String(provider)}.`);
  for (const [name, value] of [['accountScope', accountScope], ['purpose', purpose], ['sha256', sha256]]) {
    if (!isNonEmptyString(value)) throw new TypeError(`File cache ${name} must be a non-empty string.`);
  }
}

export function fileCachePut(
  state: StateV2, provider: ProviderId, accountScope: string, purpose: string, sha256: string, entry: FileCacheEntry,
): void {
  assertCacheKey(provider, accountScope, purpose, sha256);
  const scopes = state.file_cache[provider] ??= {};
  const purposes = scopes[accountScope] ??= {};
  const entries = purposes[purpose] ??= {};
  entries[sha256] = { ...entry };
}

export function fileCacheGet(
  state: StateV2, provider: ProviderId, accountScope: string, purpose: string, sha256: string,
): FileCacheEntry | undefined {
  return state.file_cache[provider]?.[accountScope]?.[purpose]?.[sha256];
}
