import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { LlmContractError, assertProviderCapabilities, checkResult } from '../llm-contract';
import type {
  BatchHandle, BatchSnapshot, CallContext, ImmediateRoute, JsonObject, LlmProvider,
  NormalizedError, NormalizedResult, PreparedItem, ProviderRequest, RouteCapabilities,
  RunPlan, SchemaRef, Stage, TokenUsage,
} from '../llm-contract';
import type { CredentialBinding } from '../routes';
import { acceptsForcedToolChoice } from '../providers';

const TOOL_NAME = 'emit_explainer';
const EMIT_INSTRUCTION = `\n\nReturn the explainer by calling the ${TOOL_NAME} tool exactly once, with the full explainer as its input. Do not reply in plain text.`;

interface CallOptions { signal?: AbortSignal }

export interface ClaudeApiClient {
  messages: {
    stream(params: any, options?: CallOptions): { finalMessage(): Promise<any> };
    batches: {
      create(body: any, options?: CallOptions): Promise<any>;
      retrieve(id: string, options?: CallOptions): Promise<any>;
      results(id: string, options?: CallOptions): Promise<AsyncIterable<any>>;
    };
  };
}

export interface ClaudeApiOptions {
  binding: CredentialBinding;
  schemaFor(ref: SchemaRef): JsonObject;
  systemPrompt(stage: Stage): string;
  sourceRoot: string;
  client?: ClaudeApiClient;
}

type MessageIdentity = Pick<ProviderRequest, 'route' | 'stage' | 'model' | 'customId' | 'attemptId'>;

const BASE_CAPABILITIES: RouteCapabilities = {
  structured: 'tool', schemaEvidence: 'fixture', vision: true, pdfNative: true,
  batch: false, subscription: false, outputTokenLimit: 'enforced',
};

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
};

const unavailableUsage = (): TokenUsage => ({
  in: null, out: null, cacheRead: null, cacheWrite5m: null, cacheWrite1h: null, source: 'unavailable',
});

function count(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function mapUsage(usage: any): TokenUsage {
  if (typeof usage !== 'object' || usage === null) return unavailableUsage();
  const breakdown = typeof usage.cache_creation === 'object' && usage.cache_creation !== null
    ? usage.cache_creation : null;
  const input = count(usage.input_tokens);
  const output = count(usage.output_tokens);
  return {
    in: input,
    out: output,
    cacheRead: count(usage.cache_read_input_tokens),
    cacheWrite5m: breakdown
      ? count(breakdown.ephemeral_5m_input_tokens) : count(usage.cache_creation_input_tokens),
    cacheWrite1h: breakdown ? count(breakdown.ephemeral_1h_input_tokens) : null,
    source: input !== null && output !== null ? 'reported' : 'partial',
  };
}

function failure(code: NormalizedError['code'], message: string, extra: Partial<NormalizedError> = {}): NormalizedError {
  return { code, message, retryable: false, ...extra };
}

function emittedText(message: any): { text: string } | { error: NormalizedError } {
  const content: any[] = Array.isArray(message.content) ? message.content : [];
  const toolBlocks = content.filter(block => block?.type === 'tool_use');
  if (toolBlocks.length === 0 && message.stop_reason !== 'tool_use') {
    return {
      text: content.filter(block => block?.type === 'text').map(block => block.text ?? '').join('\n'),
    };
  }
  const serialised = toolBlocks.length === 1 && toolBlocks[0].name === TOOL_NAME
    ? safeStringify(toolBlocks[0].input) : undefined;
  if (serialised === undefined) {
    return { error: failure('UNEXPECTED_TOOL', `Expected exactly one ${TOOL_NAME} tool call with serialisable input.`) };
  }
  return { text: serialised };
}

function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function mapMessage(message: any, identity: MessageIdentity): NormalizedResult {
  const reason = message?.stop_reason;
  const base = {
    provider: 'claude' as const, ...identity,
    usage: mapUsage(message?.usage),
    ...(typeof message?.id === 'string' ? { providerRequestId: message.id } : {}),
    ...(typeof reason === 'string' ? { rawFinishReason: reason } : {}),
  };
  const emitted = emittedText(message ?? {});
  if ('error' in emitted) return checkResult({ ...base, finishReason: 'error', error: emitted.error });
  const { text } = emitted;
  if (reason === 'end_turn' || reason === 'stop_sequence' || reason === 'tool_use') {
    return checkResult({ ...base, finishReason: 'stop', text });
  }
  if (reason === 'max_tokens' || reason === 'model_context_window_exceeded') {
    return checkResult({
      ...base, finishReason: 'length', text,
      error: failure('OUTPUT_LIMIT', 'The response stopped at the output limit.'),
    });
  }
  if (reason === 'refusal') {
    return checkResult({ ...base, finishReason: 'error', error: failure('REFUSAL', 'The model refused the request.') });
  }
  return checkResult({
    ...base, finishReason: 'error',
    error: failure('UNEXPECTED_FINISH', `Unexpected stop reason: ${String(reason)}.`),
  });
}

function failedResult(identity: MessageIdentity, error: NormalizedError): NormalizedResult {
  return checkResult({
    provider: 'claude', ...identity, usage: unavailableUsage(), finishReason: 'error', error,
  });
}

function thrownResult(identity: MessageIdentity, thrown: unknown): NormalizedResult {
  const status = (thrown as { status?: unknown } | null)?.status;
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  if (typeof status === 'number') {
    return failedResult(identity, failure('HTTP_ERROR', message, {
      httpStatus: status, retryable: status === 408 || status === 429 || status >= 500,
    }));
  }
  return failedResult(identity, failure('PROVIDER_ERROR', message));
}

function checkBinding(binding: CredentialBinding): void {
  if (binding.credentialKind === 'claude-oauth-token' || binding.surface === 'claude-agent-sdk') {
    throw new LlmContractError('CLAUDE_OAUTH_WRONG_SURFACE', 'Claude OAuth cannot be used with the Anthropic API SDK.');
  }
  if (binding.provider !== 'claude' || binding.surface !== 'anthropic-api-sdk'
    || binding.credentialKind !== 'anthropic-api-key') {
    throw new LlmContractError('MISSING_ROUTE_CREDENTIAL', 'The Claude API adapter requires an Anthropic API key binding.');
  }
}

function assertServed(req: Pick<ProviderRequest, 'provider' | 'route'>, route: 'batch-api' | 'sync-api'): void {
  if (req.provider !== 'claude' || req.route !== route) {
    throw new LlmContractError('ROUTE_UNSUPPORTED', `The Claude API adapter cannot serve ${req.provider} ${req.route} here.`);
  }
}

function sourceBlocks(item: PreparedItem, sourceRoot: string): unknown[] {
  const { source } = item;
  const blocks: unknown[] = [];
  if (source.pdf) {
    const data = fs.readFileSync(path.join(sourceRoot, source.pdf.relativePath)).toString('base64');
    blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
  } else {
    blocks.push({ type: 'text', text: source.text });
  }
  for (const image of source.images) {
    const mediaType = IMAGE_MEDIA_TYPES[path.extname(image.relativePath).toLowerCase()] ?? 'image/jpeg';
    const data = fs.readFileSync(path.join(sourceRoot, image.relativePath)).toString('base64');
    blocks.push({ type: 'text', text: image.label });
    blocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } });
  }
  blocks.push({ type: 'text', text: item.instruction });
  return blocks;
}

export function createClaudeApiProvider(opts: ClaudeApiOptions): LlmProvider {
  checkBinding(opts.binding);
  let client = opts.client;
  const api = (): ClaudeApiClient => {
    client ??= new Anthropic({ apiKey: opts.binding.credential(), maxRetries: 0 }) as unknown as ClaudeApiClient;
    return client;
  };

  const capabilities = {
    byRoute: {
      'batch-api': {
        ...BASE_CAPABILITIES, batch: true,
        maxBatchRequests: 10000, maxBatchBytes: 100000000, completionWindowMs: 86400000,
      },
      'sync-api': { ...BASE_CAPABILITIES },
    },
  };
  const provider: LlmProvider = {
    id: 'claude',
    routes: ['batch-api', 'sync-api'],
    capabilities,

    async buildRequest(stage: Stage, item: PreparedItem, plan: RunPlan): Promise<ProviderRequest> {
      const tier = plan.tiers[stage];
      if (!tier || tier.provider !== 'claude' || (tier.route !== 'batch-api' && tier.route !== 'sync-api')) {
        throw new LlmContractError('ROUTE_UNSUPPORTED', `The Claude API adapter does not serve the ${stage} tier.`);
      }
      const forced = acceptsForcedToolChoice(tier.model);
      const system = opts.systemPrompt(stage);
      const payload = {
        model: tier.model,
        max_tokens: tier.maxOutputTokens,
        system: [{
          type: 'text', text: forced ? system : system + EMIT_INSTRUCTION,
          cache_control: { type: 'ephemeral' },
        }],
        messages: [{ role: 'user', content: sourceBlocks(item, opts.sourceRoot) }],
        tools: [{
          name: TOOL_NAME, description: 'Emit the explainer as JSON.',
          input_schema: opts.schemaFor(item.schema),
        }],
        tool_choice: forced ? { type: 'tool', name: TOOL_NAME } : { type: 'auto' },
      };
      const wire = tier.route === 'batch-api'
        ? { custom_id: item.customId, params: payload } : payload;
      return {
        provider: 'claude', route: tier.route, stage, model: tier.model,
        customId: item.customId, attemptId: item.attemptId, schema: item.schema,
        payload, wireBytes: Buffer.byteLength(JSON.stringify(wire)),
      };
    },

    async complete(req: ProviderRequest & { route: ImmediateRoute }, ctx: CallContext): Promise<NormalizedResult> {
      assertServed(req, 'sync-api');
      const { route, stage, model, customId, attemptId } = req;
      const identity = { route, stage, model, customId, attemptId };
      try {
        const message = await api().messages.stream(req.payload, { signal: ctx.signal }).finalMessage();
        return mapMessage(message, identity);
      } catch (thrown) {
        if (thrown instanceof LlmContractError) throw thrown;
        return thrownResult(identity, thrown);
      }
    },

    async submitBatch(reqs: readonly ProviderRequest[], ctx: CallContext): Promise<BatchHandle> {
      for (const req of reqs) assertServed(req, 'batch-api');
      const batch = await api().messages.batches.create({
        requests: reqs.map(req => ({ custom_id: req.customId, params: req.payload })),
      }, { signal: ctx.signal });
      return {
        provider: 'claude',
        remoteId: batch.id,
        submittedAt: batch.created_at,
        expiresAt: batch.expires_at,
        requests: reqs.map(({ customId, attemptId, stage, model }) => ({ customId, attemptId, stage, model })),
      };
    },

    async getBatch(handle: BatchHandle, ctx: CallContext): Promise<BatchSnapshot> {
      const batch = await api().messages.batches.retrieve(handle.remoteId, { signal: ctx.signal });
      const counts = batch.request_counts ?? {};
      return {
        status: batch.processing_status === 'ended' ? 'completed' : 'running',
        counts: {
          pending: counts.processing ?? 0,
          succeeded: counts.succeeded ?? 0,
          failed: (counts.errored ?? 0) + (counts.canceled ?? 0) + (counts.expired ?? 0),
        },
      };
    },

    async *results(handle: BatchHandle, ctx: CallContext): AsyncIterable<NormalizedResult> {
      const expected = new Map(handle.requests.map(entry => [entry.customId, entry]));
      const seen = new Set<string>();
      const stream = await api().messages.batches.results(handle.remoteId, { signal: ctx.signal });
      for await (const row of stream) {
        const entry = expected.get(row?.custom_id);
        if (!entry || seen.has(entry.customId)) continue;
        seen.add(entry.customId);
        const identity: MessageIdentity = { route: 'batch-api', ...entry };
        const outcome = row.result ?? {};
        if (outcome.type === 'succeeded') {
          yield mapMessage(outcome.message, identity);
        } else if (outcome.type === 'errored') {
          const providerCode = outcome.error?.error?.type;
          yield failedResult(identity, failure('PROVIDER_ERROR', outcome.error?.error?.message ?? 'The batch request errored.',
            typeof providerCode === 'string' ? { providerCode } : {}));
        } else if (outcome.type === 'expired') {
          yield failedResult(identity, failure('BATCH_EXPIRED', 'The batch request expired before it ran.'));
        } else if (outcome.type === 'canceled') {
          yield failedResult(identity, failure('CANCELLED', 'The batch request was cancelled.'));
        } else {
          yield failedResult(identity, failure('MALFORMED_RESULT', 'The batch row has an unrecognised result type.'));
        }
      }
      for (const entry of handle.requests) {
        if (seen.has(entry.customId)) continue;
        yield failedResult({ route: 'batch-api', ...entry }, failure('MISSING_RESULT', 'The batch ended without a result for this request.'));
      }
    },
  };
  assertProviderCapabilities(provider);
  return provider;
}
