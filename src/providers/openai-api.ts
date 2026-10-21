import { readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { assertProviderCapabilities, checkResult, LlmContractError } from '../llm-contract';
import type {
  BatchSnapshot, ErrorCode, JsonObject, LlmProvider, NormalizedError,
  NormalizedResult, ProviderId, ProviderRequest, SchemaRef, Stage,
} from '../llm-contract';
import type { CredentialBinding } from '../routes';
import type { FileCacheEntry } from '../state-v2';
import { openAIJsonSchemaFormat } from '../providers';

type Reply = { status: number; body: unknown };
export interface OpenAiTransport {
  request(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Reply>;
  text(path: string, signal?: AbortSignal): Promise<{ status: number; body: string }>;
  upload(purpose: string, filename: string, bytes: Buffer, signal?: AbortSignal): Promise<Reply>;
}

export interface OpenAiFileCache {
  get(provider: ProviderId, accountScope: string, purpose: string, sha256: string):
    FileCacheEntry | undefined | Promise<FileCacheEntry | undefined>;
  put(provider: ProviderId, accountScope: string, purpose: string, sha256: string,
    entry: FileCacheEntry): void | Promise<void>;
  invalidate(provider: ProviderId, accountScope: string, purpose: string, sha256: string): void | Promise<void>;
}

export interface OpenAiApiOptions {
  binding: CredentialBinding;
  fileCache: OpenAiFileCache;
  accountScope: string | null;
  schemaFor(ref: SchemaRef): JsonObject;
  systemPrompt(stage: Stage): string;
  sourceRoot: string;
  transport?: OpenAiTransport;
  now?: () => Date;
}

function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function defaultTransport(binding: CredentialBinding): OpenAiTransport {
  const headers = () => ({ Authorization: `Bearer ${binding.credential()}` });
  const url = (path: string) => `https://api.openai.com/v1${path}`;
  const json = async (response: Response): Promise<Reply> => ({
    status: response.status, body: await response.json().catch(() => null),
  });
  return {
    async request(method, path, body, signal) {
      return json(await fetch(url(path), {
        method, headers: { ...headers(), 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal,
      }));
    },
    async text(path, signal) {
      const response = await fetch(url(path), { headers: headers(), signal });
      return { status: response.status, body: await response.text() };
    },
    async upload(purpose, filename, bytes, signal) {
      const form = new FormData();
      form.append('purpose', purpose);
      form.append('file', new Blob([new Uint8Array(bytes)], {
        type: purpose === 'batch' ? 'application/jsonl' : 'application/pdf',
      }), filename);
      return json(await fetch(url('/files'), { method: 'POST', headers: headers(), body: form, signal }));
    },
  };
}

const success = (status: number) => status >= 200 && status < 300;
function requireSuccess(reply: Reply): JsonObject {
  if (!success(reply.status)) throw new LlmContractError('HTTP_ERROR', `OpenAI HTTP ${reply.status}.`);
  return object(reply.body);
}

async function transportCall<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) {
    throw new LlmContractError('HTTP_ERROR', error instanceof Error ? error.message : String(error));
  }
}

type Identity = Pick<ProviderRequest, 'route' | 'stage' | 'model' | 'customId' | 'attemptId'>;
function failure(identity: Identity, code: ErrorCode, message: string,
  extra: Partial<NormalizedError> = {}): NormalizedResult {
  return checkResult({
    ...identity, provider: 'openai', finishReason: 'error',
    usage: { in: null, out: null, cacheRead: null, cacheWrite5m: null, cacheWrite1h: null, source: 'unavailable' },
    error: { code, message, retryable: false, ...extra },
  });
}

function responseResult(identity: Identity, status: number, value: unknown): NormalizedResult {
  const body = object(value);
  const usage = object(body.usage);
  const input = typeof usage.input_tokens === 'number' ? usage.input_tokens : null;
  const output = typeof usage.output_tokens === 'number' ? usage.output_tokens : null;
  const cached = object(usage.input_tokens_details).cached_tokens;
  const parts = (Array.isArray(body.output) ? body.output : [])
    .filter(item => object(item).type === 'message')
    .flatMap(item => Array.isArray(object(item).content) ? object(item).content as unknown[] : []);
  const text = parts.filter(part => object(part).type === 'output_text' && typeof object(part).text === 'string')
    .map(part => object(part).text).join('\n');
  let finishReason: 'stop' | 'length' | 'error' = 'error';
  let code: ErrorCode = 'UNEXPECTED_FINISH';
  let raw = typeof body.status === 'string' ? body.status : undefined;
  let extra: Partial<NormalizedError> = {};
  if (!success(status)) {
    code = 'HTTP_ERROR';
    extra = { httpStatus: status, retryable: status === 408 || status === 429 || status >= 500 && status < 600 };
  } else if (body.status === 'completed') {
    if (parts.some(part => object(part).type === 'refusal')) code = 'REFUSAL';
    else finishReason = 'stop';
  } else if (body.status === 'incomplete') {
    const reason = object(body.incomplete_details).reason;
    raw = `incomplete:${reason}`;
    code = reason === 'max_output_tokens' ? 'OUTPUT_LIMIT'
      : reason === 'content_filter' ? 'CONTENT_FILTER' : 'INCOMPLETE_RESPONSE';
    if (code === 'OUTPUT_LIMIT') finishReason = 'length';
  } else if (body.status === 'failed') {
    code = 'PROVIDER_ERROR';
    const providerCode = object(body.error).code;
    if (typeof providerCode === 'string') extra.providerCode = providerCode;
  } else if (body.status === 'cancelled') code = 'CANCELLED';
  return checkResult({
    ...identity, provider: 'openai', finishReason, text,
    ...(typeof body.id === 'string' ? { providerRequestId: body.id } : {}),
    ...(raw !== undefined ? { rawFinishReason: raw } : {}),
    usage: {
      in: input, out: output, cacheRead: typeof cached === 'number' ? cached : null,
      cacheWrite5m: null, cacheWrite1h: null,
      source: input !== null && output !== null ? 'reported'
        : input !== null || output !== null || typeof cached === 'number' ? 'partial' : 'unavailable',
    },
    ...(finishReason === 'stop' ? {} : { error: { code, message: `OpenAI response: ${code}.`, retryable: false, ...extra } }),
  });
}

function batchLine(req: ProviderRequest): string {
  return JSON.stringify({ custom_id: req.customId, method: 'POST', url: '/v1/responses', body: req.payload });
}

function requireRoute(provider: string, route: string, expected: string): void {
  if (provider !== 'openai' || route !== expected) {
    throw new LlmContractError('ROUTE_UNSUPPORTED', `OpenAI requires ${expected}.`);
  }
}

export function createOpenAiApiProvider(opts: OpenAiApiOptions): LlmProvider {
  if (opts.binding.provider !== 'openai' || opts.binding.surface !== 'openai-api'
    || opts.binding.credentialKind !== 'openai-api-key') {
    throw new LlmContractError('MISSING_ROUTE_CREDENTIAL', 'A direct OpenAI API binding is required.');
  }
  const transport = opts.transport ?? defaultTransport(opts.binding);
  const now = opts.now ?? (() => new Date());
  const common = {
    structured: 'strict' as const, schemaEvidence: 'fixture' as const, vision: true,
    pdfNative: true, outputTokenLimit: 'enforced' as const, subscription: false,
  };
  const provider: LlmProvider = {
    id: 'openai', routes: ['batch-api', 'sync-api'],
    capabilities: { byRoute: {
      'batch-api': { ...common, batch: true, maxBatchRequests: 10000, maxBatchBytes: 100000000, completionWindowMs: 86400000 },
      'sync-api': { ...common, batch: false },
    } },
    async buildRequest(stage, item, plan) {
      const tier = plan.tiers[stage];
      if (!tier || tier.provider !== 'openai' || !['batch-api', 'sync-api'].includes(tier.route)) {
        throw new LlmContractError('ROUTE_UNSUPPORTED', 'The stage requires an OpenAI API route.');
      }
      const content: JsonObject[] = [];
      if (item.source.pdf) {
        const pdf = item.source.pdf;
        const scope = opts.accountScope;
        const key = ['openai', scope!, 'user_data', pdf.sha256] as const;
        let entry = scope !== null ? await opts.fileCache.get(...key) : undefined;
        if (entry) {
          const window = tier.route === 'batch-api' ? 86400000 : plan.callTimeoutMs[stage];
          if (entry.expiresAt !== undefined && !(Date.parse(entry.expiresAt) >= now().getTime() + window + 300000)) {
            await opts.fileCache.invalidate(...key);
            entry = undefined;
          } else {
            const reply = await transport.request('GET', `/files/${entry.fileId}`);
            if (reply.status === 404) {
              await opts.fileCache.invalidate(...key);
              entry = undefined;
            } else requireSuccess(reply);
          }
        }
        if (!entry) {
          const bytes = await readFile(resolve(opts.sourceRoot, pdf.relativePath));
          const file = requireSuccess(await transport.upload('user_data', basename(pdf.relativePath), bytes));
          if (typeof file.id !== 'string') throw new LlmContractError('MALFORMED_RESULT', 'Uploaded file has no ID.');
          entry = { fileId: file.id, sizeBytes: bytes.length, uploadedAt: now().toISOString(),
            ...(typeof file.expires_at === 'number' ? { expiresAt: new Date(file.expires_at * 1000).toISOString() } : {}) };
          if (scope !== null) await opts.fileCache.put(...key, entry);
        }
        content.push({ type: 'input_file', file_id: entry.fileId });
      } else content.push({ type: 'input_text', text: item.source.text });
      for (const image of item.source.images) {
        const bytes = await readFile(resolve(opts.sourceRoot, image.relativePath));
        const extension = extname(image.relativePath).slice(1).toLowerCase();
        const type = extension === 'jpg' ? 'jpeg' : extension;
        content.push({ type: 'input_text', text: image.label },
          { type: 'input_image', image_url: `data:image/${type};base64,${bytes.toString('base64')}` });
      }
      content.push({ type: 'input_text', text: item.instruction });
      const payload = { model: tier.model, max_output_tokens: tier.maxOutputTokens,
        instructions: opts.systemPrompt(stage), input: [{ role: 'user', content }],
        text: { format: openAIJsonSchemaFormat(opts.schemaFor(item.schema)) } };
      const req: ProviderRequest = { provider: 'openai', route: tier.route, stage,
        model: tier.model, customId: item.customId, attemptId: item.attemptId, schema: item.schema, payload, wireBytes: 0 };
      req.wireBytes = tier.route === 'batch-api' ? Buffer.byteLength(batchLine(req)) + 1 : Buffer.byteLength(JSON.stringify(payload));
      return req;
    },
    async complete(req, ctx) {
      requireRoute(req.provider, req.route, 'sync-api');
      try {
        const reply = await transport.request('POST', '/responses', req.payload, ctx.signal);
        return responseResult(req, reply.status, reply.body);
      } catch (error) {
        return failure(req, 'PROVIDER_ERROR', error instanceof Error ? error.message : String(error));
      }
    },
    async submitBatch(reqs, ctx) {
      for (const req of reqs) requireRoute(req.provider, req.route, 'batch-api');
      const bytes = Buffer.from(`${reqs.map(batchLine).join('\n')}\n`);
      const file = requireSuccess(await transportCall(() => transport.upload('batch', 'batch-input.jsonl', bytes, ctx.signal)));
      const batch = requireSuccess(await transportCall(() => transport.request('POST', '/batches', {
        input_file_id: file.id, endpoint: '/v1/responses', completion_window: '24h',
      }, ctx.signal)));
      return { provider: 'openai', remoteId: String(batch.id),
        submittedAt: new Date(Number(batch.created_at) * 1000).toISOString(),
        expiresAt: new Date(Number(batch.expires_at) * 1000).toISOString(),
        requests: reqs.map(({ customId, attemptId, stage, model }) => ({ customId, attemptId, stage, model })) };
    },
    async getBatch(handle, ctx) {
      const batch = requireSuccess(await transportCall(() => transport.request('GET', `/batches/${handle.remoteId}`, undefined, ctx.signal)));
      const statuses: Record<string, BatchSnapshot['status']> = {
        validating: 'queued', in_progress: 'running', finalizing: 'running', cancelling: 'running',
        completed: 'completed', failed: 'failed', cancelled: 'cancelled', expired: 'expired',
      };
      const status = typeof batch.status === 'string' ? statuses[batch.status] : undefined;
      if (!status) throw new LlmContractError('UNEXPECTED_FINISH', 'Unknown OpenAI batch status.');
      const counts = object(batch.request_counts);
      const succeeded = Number(counts.completed ?? 0);
      const failed = Number(counts.failed ?? 0);
      return { status, counts: { succeeded, failed, pending: Math.max(0, Number(counts.total ?? 0) - succeeded - failed) } };
    },
    async *results(handle, ctx) {
      const batch = requireSuccess(await transportCall(() => transport.request('GET', `/batches/${handle.remoteId}`, undefined, ctx.signal)));
      const rows = new Map<string, JsonObject[]>();
      for (const id of [batch.output_file_id, batch.error_file_id]) {
        if (typeof id !== 'string') continue;
        const reply = await transportCall(() => transport.text(`/files/${id}/content`, ctx.signal));
        requireSuccess(reply);
        for (const line of reply.body.split('\n').filter(line => line.trim())) {
          let row: JsonObject;
          try { row = object(JSON.parse(line)); } catch { continue; }
          if (typeof row.custom_id !== 'string') continue;
          const matches = rows.get(row.custom_id) ?? [];
          if (!matches.some(existing => isDeepStrictEqual(existing, row))) matches.push(row);
          rows.set(row.custom_id, matches);
        }
      }
      for (const req of handle.requests) {
        const identity = { ...req, route: 'batch-api' as const };
        const matches = rows.get(req.customId) ?? [];
        if (matches.length === 0) { yield failure(identity, 'MISSING_RESULT', 'No batch row for request.'); continue; }
        if (matches.length > 1) { yield failure(identity, 'RESULT_CONFLICT', 'Contradictory batch rows.'); continue; }
        const row = matches[0];
        if (row.error != null) {
          const code = object(row.error).code;
          yield failure(identity, 'PROVIDER_ERROR', String(object(row.error).message ?? 'Batch row failed.'),
            typeof code === 'string' ? { providerCode: code } : {});
          continue;
        }
        const response = object(row.response);
        if (typeof response.status_code !== 'number' || (success(response.status_code)
          && (response.body === null || typeof response.body !== 'object' || Array.isArray(response.body)))) {
          yield failure(identity, 'MALFORMED_RESULT', 'Batch row lacks response status or body.');
        } else yield responseResult(identity, response.status_code, response.body);
      }
    },
  };
  assertProviderCapabilities(provider);
  return provider;
}
