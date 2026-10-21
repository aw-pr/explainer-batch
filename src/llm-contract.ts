import { createHash } from 'node:crypto';

export type ProviderId = 'claude' | 'openai' | 'gemini';
export type Route = 'batch-api' | 'sync-api' | 'subscription-cli';
export type ImmediateRoute = Exclude<Route, 'batch-api'>;
export type Stage = 'synthesis' | 'repair' | 'vision';
export type SchemaRef = { id: string; version: number; digest: string };
export type JsonObject = Record<string, unknown>;

export interface RouteCapabilities {
  structured: 'strict' | 'tool' | 'none';
  schemaEvidence: 'fixture' | 'subscription-probe' | 'unverified';
  vision: boolean;
  pdfNative: boolean;
  batch: boolean;
  subscription: boolean;
  outputTokenLimit: 'enforced' | 'advisory';
  maxBatchRequests?: number;
  maxBatchBytes?: number;
  completionWindowMs?: number;
}

export interface ProviderCapabilities {
  byRoute: Partial<Record<Route, RouteCapabilities>>;
}

export interface SourceSnapshot {
  digest: string;
  text: string;
  pdf?: { relativePath: string; sha256: string };
  images: ReadonlyArray<{ relativePath: string; label: string; sha256: string }>;
}

export interface PreparedItem {
  itemId: string;
  customId: string;
  attemptId: string;
  instruction: string;
  source: SourceSnapshot;
  schema: SchemaRef;
}

export interface ProviderRequest {
  provider: ProviderId;
  route: Route;
  stage: Stage;
  model: string;
  customId: string;
  attemptId: string;
  schema: SchemaRef;
  payload: unknown;
  wireBytes: number;
}

export interface CallContext {
  signal: AbortSignal;
  deadline: string;
}

export interface BatchHandle {
  provider: ProviderId;
  remoteId: string;
  submittedAt: string;
  expiresAt: string;
  requests: ReadonlyArray<
    Pick<ProviderRequest, 'customId' | 'attemptId' | 'stage' | 'model'>
  >;
}

export interface BatchSnapshot {
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired';
  counts: { pending: number; succeeded: number; failed: number };
  error?: NormalizedError;
}

export interface TokenUsage {
  in: number | null;
  out: number | null;
  cacheRead: number | null;
  cacheWrite5m: number | null;
  cacheWrite1h: number | null;
  source: 'reported' | 'partial' | 'unavailable';
}

export interface NormalizedError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  httpStatus?: number;
  providerCode?: string;
}

export type NormalizedResult = {
  provider: ProviderId;
  route: Route;
  stage: Stage;
  model: string;
  customId: string;
  attemptId: string;
  providerRequestId?: string;
  usage: TokenUsage;
  rawFinishReason?: string;
} & (
  | { finishReason: 'stop'; text: string; error?: never }
  | { finishReason: 'length' | 'error'; text?: string; error: NormalizedError }
);

export interface LlmProvider {
  readonly id: ProviderId;
  readonly routes: readonly Route[];
  readonly capabilities: ProviderCapabilities;
  buildRequest(stage: Stage, item: PreparedItem, plan: RunPlan): Promise<ProviderRequest>;
  submitBatch(reqs: readonly ProviderRequest[], ctx: CallContext): Promise<BatchHandle>;
  getBatch(handle: BatchHandle, ctx: CallContext): Promise<BatchSnapshot>;
  results(handle: BatchHandle, ctx: CallContext): AsyncIterable<NormalizedResult>;
  complete(req: ProviderRequest & { route: ImmediateRoute }, ctx: CallContext):
    Promise<NormalizedResult>;
}

export interface StageBinding {
  provider: ProviderId;
  route: Route;
  model: string;
  maxOutputTokens: number;
}

export interface RunPlan {
  version: 1;
  provider: ProviderId;
  route: Route;
  strategy: 'single-pass';
  tiers: {
    synthesis: StageBinding;
    repair: StageBinding & { route: ImmediateRoute };
    vision: StageBinding | null;
  };
  visionDisabledReason?: string;
  schema: SchemaRef;
  registryDigest: string;
  policyDigest: string;
  maxRepairAttempts: number;
  concurrency: number;
  callTimeoutMs: { synthesis: number; repair: number; vision: number };
  activeWallClockLimitMs: number;
}

export const ERROR_CODES = [
  'ROUTE_UNSUPPORTED', 'PROVIDER_ERROR', 'BATCH_EXPIRED', 'CANCELLED', 'MISSING_RESULT',
  'UNEXPECTED_TOOL', 'OUTPUT_LIMIT', 'REFUSAL', 'UNEXPECTED_FINISH', 'HTTP_ERROR',
  'MALFORMED_RESULT', 'CONTENT_FILTER', 'INCOMPLETE_RESPONSE', 'SDK_EXECUTION', 'TURN_LIMIT',
  'BUDGET_LIMIT', 'STRUCTURED_OUTPUT_RETRIES', 'CLI_EXIT', 'TIMEOUT', 'CLI_FAILURE',
  'MISSING_OUTPUT', 'EMPTY_OUTPUT', 'RESULT_CONFLICT', 'CUSTOM_ID_COLLISION', 'INVALID_CAPABILITIES',
  'INVALID_ROUTE_PREFERENCE', 'UNKNOWN_PROVIDER', 'PROVIDER_DISABLED', 'CLAUDE_OAUTH_WRONG_SURFACE',
  'MIXED_BILLING_CREDENTIALS', 'CODEX_AUTH_NOT_SUBSCRIPTION', 'MISSING_ROUTE_CREDENTIAL',
  'NO_USABLE_ROUTE', 'MODEL_ROUTE_UNSUPPORTED', 'MODEL_PROVIDER_MISMATCH', 'UNKNOWN_MODEL',
  'CONFLICTING_ROUTE_FLAGS', 'CONFLICTING_MODEL_OVERRIDE', 'RUN_PROVIDER_MISMATCH',
  'LOCAL_RUN_REQUIRES_RESUME', 'REGISTRY_INVALID', 'REGISTRY_NOT_FOUND', 'REGISTRY_UNAVAILABLE',
  'PRICE_REVIEW_DUE', 'STATE_CORRUPT', 'STATE_VERSION_UNSUPPORTED', 'STATE_BUSY', 'OUTPUT_COLLISION',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class LlmContractError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'LlmContractError';
  }
}

const PROVIDERS: readonly ProviderId[] = ['claude', 'openai', 'gemini'];
const ROUTES: readonly Route[] = ['batch-api', 'sync-api', 'subscription-cli'];
const STAGES: readonly Stage[] = ['synthesis', 'repair', 'vision'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMember<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTokenCount(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0);
}

function checkedUsage(value: unknown): TokenUsage {
  if (isRecord(value) && isTokenCount(value.in) && isTokenCount(value.out)
    && isTokenCount(value.cacheRead) && isTokenCount(value.cacheWrite5m)
    && isTokenCount(value.cacheWrite1h)
    && isMember(['reported', 'partial', 'unavailable'] as const, value.source)) {
    return {
      in: value.in, out: value.out, cacheRead: value.cacheRead,
      cacheWrite5m: value.cacheWrite5m, cacheWrite1h: value.cacheWrite1h, source: value.source,
    };
  }
  return {
    in: null, out: null, cacheRead: null, cacheWrite5m: null, cacheWrite1h: null,
    source: 'unavailable',
  };
}

function resultError(code: ErrorCode, message: string): NormalizedError {
  return { code, message, retryable: false };
}

function checkedError(value: unknown): NormalizedError {
  if (!isRecord(value) || !isMember(ERROR_CODES, value.code)
    || typeof value.message !== 'string' || typeof value.retryable !== 'boolean') {
    return resultError('MALFORMED_RESULT', 'A failed result requires a recognised error code, message and retryable flag.');
  }
  return {
    code: value.code, message: value.message, retryable: value.retryable,
    ...(typeof value.httpStatus === 'number' ? { httpStatus: value.httpStatus } : {}),
    ...(typeof value.providerCode === 'string' ? { providerCode: value.providerCode } : {}),
  };
}

export function checkResult(candidate: unknown): NormalizedResult {
  if (!isRecord(candidate) || !isMember(PROVIDERS, candidate.provider)
    || !isMember(ROUTES, candidate.route) || !isMember(STAGES, candidate.stage)
    || !isNonEmptyString(candidate.model) || !isNonEmptyString(candidate.customId)
    || !isNonEmptyString(candidate.attemptId)) {
    throw new LlmContractError('MALFORMED_RESULT', 'Result identity is missing or invalid.');
  }

  const common = {
    provider: candidate.provider, route: candidate.route, stage: candidate.stage,
    model: candidate.model, customId: candidate.customId, attemptId: candidate.attemptId,
    usage: checkedUsage(candidate.usage),
    ...(typeof candidate.text === 'string' ? { text: candidate.text } : {}),
    ...(typeof candidate.providerRequestId === 'string' ? { providerRequestId: candidate.providerRequestId } : {}),
    ...(typeof candidate.rawFinishReason === 'string' ? { rawFinishReason: candidate.rawFinishReason } : {}),
  };

  if (candidate.finishReason === 'stop') {
    if (candidate.error !== undefined) {
      return { ...common, finishReason: 'error', error: resultError('MALFORMED_RESULT', 'A stop result also carries an error.') };
    }
    if (!isNonEmptyString(candidate.text)) {
      return { ...common, finishReason: 'error', error: resultError('EMPTY_OUTPUT', 'A stop result requires non-empty text.') };
    }
    return { ...common, finishReason: 'stop', text: candidate.text };
  }
  if (candidate.finishReason === 'length' || candidate.finishReason === 'error') {
    return { ...common, finishReason: candidate.finishReason, error: checkedError(candidate.error) };
  }
  return {
    ...common,
    ...(common.rawFinishReason === undefined && typeof candidate.finishReason === 'string'
      ? { rawFinishReason: candidate.finishReason } : {}),
    finishReason: 'error',
    error: resultError('UNEXPECTED_FINISH', 'Result finish reason is missing or unrecognised.'),
  };
}

export function assertProviderCapabilities(p: {
  id: unknown; routes: unknown; capabilities: unknown;
}): void {
  const invalid = () => {
    throw new LlmContractError('INVALID_CAPABILITIES', 'Provider routes and capabilities must agree and use valid values.');
  };
  if (!isRecord(p) || !isMember(PROVIDERS, p.id) || !Array.isArray(p.routes)
    || !isRecord(p.capabilities) || !isRecord(p.capabilities.byRoute)) {
    return invalid();
  }
  const routes = p.routes;
  const byRoute = p.capabilities.byRoute;
  const keys = Object.keys(byRoute);
  if (new Set(routes).size !== routes.length || routes.length !== keys.length
    || !routes.every(route => isMember(ROUTES, route) && Object.hasOwn(byRoute, route))) {
    return invalid();
  }
  for (const key of keys) {
    const cap = byRoute[key];
    if (!isMember(ROUTES, key) || !isRecord(cap)
      || !isMember(['strict', 'tool', 'none'] as const, cap.structured)
      || !isMember(['fixture', 'subscription-probe', 'unverified'] as const, cap.schemaEvidence)
      || !isMember(['enforced', 'advisory'] as const, cap.outputTokenLimit)
      || typeof cap.vision !== 'boolean' || typeof cap.pdfNative !== 'boolean'
      || cap.batch !== (key === 'batch-api') || cap.subscription !== (key === 'subscription-cli')) {
      return invalid();
    }
  }
}

export function assertRouteSupported(p: Pick<LlmProvider, 'id' | 'routes'>, route: Route): void {
  if (!p.routes.includes(route)) {
    throw new LlmContractError('ROUTE_UNSUPPORTED', `${p.id} does not support route ${route}.`);
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function requestKey(parts: {
  runId: string; sourceDigest: string; planDigest: string; schemaDigest: string; stage: Stage;
}): string {
  return digest(JSON.stringify([
    parts.runId, parts.sourceDigest, parts.planDigest, parts.schemaDigest, parts.stage,
  ]));
}

export function attemptIdFor(key: string, attempt: number): string {
  if (!Number.isSafeInteger(attempt) || attempt <= 0) {
    throw new LlmContractError('MALFORMED_RESULT', 'Attempt number must be a positive safe integer.');
  }
  return `${key}.${attempt}`;
}

export function customIdFor(key: string): string {
  return digest(key);
}

export function assertNoCustomIdCollision(
  manifest: Record<string, string>, customId: string, key: string,
): void {
  if (Object.hasOwn(manifest, customId) && manifest[customId] !== key) {
    throw new LlmContractError('CUSTOM_ID_COLLISION', `Custom ID ${customId} already identifies another request.`);
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).filter(key => value[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function resultDigest(result: NormalizedResult): string {
  return digest(canonicalJson(result));
}

export function reconcileResult(
  runId: string,
  existing: { runId: string; customId: string; attemptId: string; digest: string } | undefined,
  incoming: NormalizedResult,
): 'new' | 'duplicate' {
  if (!existing || existing.runId !== runId || existing.customId !== incoming.customId
    || existing.attemptId !== incoming.attemptId) return 'new';
  if (existing.digest === resultDigest(incoming)) return 'duplicate';
  throw new LlmContractError('RESULT_CONFLICT', 'Repeated result identity has a conflicting receipt digest.');
}
