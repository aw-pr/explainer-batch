import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { LlmContractError, assertProviderCapabilities, checkResult } from '../llm-contract';
import type {
  BatchHandle, BatchSnapshot, CallContext, ImmediateRoute, JsonObject, LlmProvider,
  NormalizedError, NormalizedResult, PreparedItem, ProviderRequest, RouteCapabilities,
  RunPlan, SchemaRef, Stage, TokenUsage,
} from '../llm-contract';
import { childEnvironment } from '../routes';
import type { CredentialBinding } from '../routes';

export type AgentQuery = (args: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => AsyncIterable<SDKMessage>;

export interface ClaudeSubscriptionOptions {
  binding: CredentialBinding;
  schemaFor(ref: SchemaRef): JsonObject;
  systemPrompt(stage: Stage): string;
  sourceRoot: string;
  parentEnv: Readonly<Record<string, string | undefined>>;
  query?: AgentQuery;
  tmpRoot?: string;
}

interface SubscriptionPayload {
  systemPrompt: string;
  content: unknown[];
  schema: JsonObject;
}

type MessageIdentity = Pick<ProviderRequest, 'route' | 'stage' | 'model' | 'customId' | 'attemptId'>;

// ESM-only package in a CommonJS repo: an opaque import keeps the TS emitter from rewriting it
const agentSdkImport = new Function('m', 'return import(m)') as (m: string) => Promise<{ query: AgentQuery }>;

// Kept apart from the literal so the OpenAI format stays the only one spelled inline under src/
const SDK_JSON_SCHEMA = 'json_schema' as const;
const MAX_TURNS = 3;
const MAX_TIMER_MS = 2_147_483_647;
const ABORTED = Symbol('aborted');

const CAPABILITIES: RouteCapabilities = {
  structured: 'strict', schemaEvidence: 'unverified', vision: true, pdfNative: true,
  batch: false, subscription: true, outputTokenLimit: 'advisory',
};

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
};

const COMPLETE_STOP_REASONS = new Set(['end_turn', 'stop_sequence', 'tool_use']);
const EXHAUSTED_STOP_REASONS = new Set(['max_tokens', 'model_context_window_exceeded']);
const ERROR_SUBTYPES: Record<string, NormalizedError['code']> = {
  error_during_execution: 'SDK_EXECUTION',
  error_max_turns: 'TURN_LIMIT',
  error_max_budget_usd: 'BUDGET_LIMIT',
  error_max_structured_output_retries: 'STRUCTURED_OUTPUT_RETRIES',
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

function failure(code: NormalizedError['code'], message: string): NormalizedError {
  return { code, message, retryable: false };
}

function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function failedResult(identity: MessageIdentity, error: NormalizedError): NormalizedResult {
  return checkResult({
    provider: 'claude', ...identity, usage: unavailableUsage(), finishReason: 'error', error,
  });
}

function mapResult(result: any, identity: MessageIdentity): NormalizedResult {
  const subtype: unknown = result.subtype;
  const reason: unknown = result.stop_reason;
  const raw = typeof reason === 'string' ? reason : typeof subtype === 'string' ? subtype : undefined;
  const base = {
    provider: 'claude' as const, ...identity,
    usage: mapUsage(result.usage),
    ...(typeof result.session_id === 'string' ? { providerRequestId: result.session_id } : {}),
    ...(raw !== undefined ? { rawFinishReason: raw } : {}),
  };
  const fail = (code: NormalizedError['code'], message: string, text?: string) => checkResult({
    ...base, finishReason: 'error', error: failure(code, message),
    ...(text ? { text } : {}),
  });

  if (subtype !== 'success') {
    const code = typeof subtype === 'string' && Object.hasOwn(ERROR_SUBTYPES, subtype)
      ? ERROR_SUBTYPES[subtype] : undefined;
    if (!code) return fail('UNEXPECTED_FINISH', `Unexpected Agent SDK result subtype: ${String(subtype)}.`);
    const detail = Array.isArray(result.errors) && result.errors.length > 0 ? `: ${result.errors.join('; ')}` : '';
    return fail(code, `The Agent SDK ended with ${subtype}${detail}.`);
  }
  if (result.is_error !== false) {
    return fail('UNEXPECTED_FINISH', 'The Agent SDK reported success with an error flag.');
  }
  if (typeof reason === 'string' && EXHAUSTED_STOP_REASONS.has(reason)) {
    return checkResult({
      ...base, finishReason: 'length', error: failure('OUTPUT_LIMIT', 'The response stopped at the output or context limit.'),
    });
  }
  if (typeof reason === 'string' && !COMPLETE_STOP_REASONS.has(reason)) {
    return fail('UNEXPECTED_FINISH', `Unexpected stop reason: ${reason}.`);
  }
  if (result.structured_output === undefined || result.structured_output === null) {
    return fail('MISSING_OUTPUT', 'The Agent SDK returned no structured output.',
      typeof result.result === 'string' ? result.result : undefined);
  }
  const text = safeStringify(result.structured_output);
  if (text === undefined) return fail('MALFORMED_RESULT', 'The structured output could not be serialised.');
  return checkResult({ ...base, finishReason: 'stop', text });
}

function checkBinding(binding: CredentialBinding): void {
  if (binding.provider !== 'claude' || binding.route !== 'subscription-cli'
    || binding.surface !== 'claude-agent-sdk' || binding.credentialKind !== 'claude-oauth-token') {
    throw new LlmContractError('MISSING_ROUTE_CREDENTIAL', 'The Claude subscription adapter requires a Claude OAuth Agent SDK binding.');
  }
}

function unsupported(what: string): never {
  throw new LlmContractError('ROUTE_UNSUPPORTED', `The Claude subscription adapter does not support ${what}.`);
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

async function* userTurn(content: unknown[]): AsyncIterable<SDKUserMessage> {
  yield {
    type: 'user',
    message: { role: 'user', content: content as SDKUserMessage['message']['content'] },
    parent_tool_use_id: null,
  };
}

export function createClaudeSubscriptionProvider(opts: ClaudeSubscriptionOptions): LlmProvider {
  checkBinding(opts.binding);
  const tmpRoot = opts.tmpRoot ?? os.tmpdir();
  let query = opts.query;
  const agentQuery = async (): Promise<AgentQuery> => {
    query ??= (await agentSdkImport('@anthropic-ai/claude-agent-sdk')).query;
    return query;
  };

  const provider: LlmProvider = {
    id: 'claude',
    routes: ['subscription-cli'],
    capabilities: { byRoute: { 'subscription-cli': { ...CAPABILITIES } } },

    async buildRequest(stage: Stage, item: PreparedItem, plan: RunPlan): Promise<ProviderRequest> {
      const tier = plan.tiers[stage];
      if (!tier || tier.provider !== 'claude' || tier.route !== 'subscription-cli') {
        return unsupported(`the ${stage} tier of this plan`);
      }
      const payload: SubscriptionPayload = {
        systemPrompt: opts.systemPrompt(stage),
        content: sourceBlocks(item, opts.sourceRoot),
        schema: opts.schemaFor(item.schema),
      };
      return {
        provider: 'claude', route: 'subscription-cli', stage, model: tier.model,
        customId: item.customId, attemptId: item.attemptId, schema: item.schema,
        payload, wireBytes: Buffer.byteLength(JSON.stringify(payload)),
      };
    },

    async complete(req: ProviderRequest & { route: ImmediateRoute }, ctx: CallContext): Promise<NormalizedResult> {
      if (req.provider !== 'claude' || req.route !== 'subscription-cli') {
        return unsupported(`${req.provider} ${req.route} requests`);
      }
      const { route, stage, model, customId, attemptId } = req;
      const identity: MessageIdentity = { route, stage, model, customId, attemptId };
      const payload = req.payload as SubscriptionPayload;
      const env = childEnvironment(opts.binding, opts.parentEnv);

      const controller = new AbortController();
      let cause: 'deadline' | 'caller' | undefined;
      const abort = (by: 'deadline' | 'caller') => {
        cause ??= by;
        controller.abort();
      };
      const onCallerAbort = () => abort('caller');
      const aborted = new Promise<typeof ABORTED>(resolve => {
        controller.signal.addEventListener('abort', () => resolve(ABORTED), { once: true });
      });
      const remaining = Date.parse(ctx.deadline) - Date.now();
      const timer = setTimeout(() => abort('deadline'),
        Number.isFinite(remaining) ? Math.min(Math.max(remaining, 0), MAX_TIMER_MS) : 0);
      ctx.signal.addEventListener('abort', onCallerAbort, { once: true });
      if (ctx.signal.aborted) abort('caller');

      const abortedResult = () => cause === 'deadline'
        ? failedResult(identity, failure('TIMEOUT', 'The Agent SDK call passed its deadline.'))
        : failedResult(identity, failure('CANCELLED', 'The caller cancelled the Agent SDK call.'));

      const cwd = await fs.promises.mkdtemp(path.join(tmpRoot, 'claude-subscription-'));
      let stream: AsyncIterator<SDKMessage> | undefined;
      try {
        const options: Options = {
          model,
          systemPrompt: payload.systemPrompt,
          cwd,
          settingSources: [],
          tools: [],
          permissionMode: 'dontAsk',
          maxTurns: MAX_TURNS,
          outputFormat: { type: SDK_JSON_SCHEMA, schema: payload.schema },
          abortController: controller,
          env,
        };
        const run = await Promise.race([agentQuery(), aborted]);
        if (run === ABORTED) return abortedResult();
        stream = run({ prompt: userTurn(payload.content), options })[Symbol.asyncIterator]();
        for (;;) {
          const next = await Promise.race([stream.next(), aborted]);
          if (next === ABORTED) return abortedResult();
          if (next.done) {
            return cause ? abortedResult()
              : failedResult(identity, failure('MISSING_RESULT', 'The Agent SDK stream ended without a result message.'));
          }
          if (next.value.type === 'result') return mapResult(next.value, identity);
        }
      } catch (thrown) {
        if (cause) return abortedResult();
        const message = thrown instanceof Error ? thrown.message : String(thrown);
        return failedResult(identity, failure('SDK_EXECUTION', message));
      } finally {
        clearTimeout(timer);
        ctx.signal.removeEventListener('abort', onCallerAbort);
        const open = stream;
        if (open?.return) void Promise.resolve().then(() => open.return?.()).catch(() => undefined);
        await fs.promises.rm(cwd, { recursive: true, force: true });
      }
    },

    async submitBatch(_reqs: readonly ProviderRequest[], _ctx: CallContext): Promise<BatchHandle> {
      return unsupported('batch submission');
    },

    async getBatch(_handle: BatchHandle, _ctx: CallContext): Promise<BatchSnapshot> {
      return unsupported('batch polling');
    },

    async *results(_handle: BatchHandle, _ctx: CallContext): AsyncIterable<NormalizedResult> {
      unsupported('batch results');
    },
  };
  assertProviderCapabilities(provider);
  return provider;
}
