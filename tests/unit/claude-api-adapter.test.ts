import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeApiProvider } from '../../src/providers/claude-api';
import type { ClaudeApiClient } from '../../src/providers/claude-api';
import type { PreparedItem, RunPlan } from '../../src/llm-contract';
import type { CredentialBinding } from '../../src/routes';

const SCHEMA_REF = { id: 'explainer-model-output', version: 2, digest: 'sha256:fixture' };
const SCHEMA = { type: 'object', properties: { title: { type: 'string' } } };
const CTX = { signal: new AbortController().signal, deadline: '2026-10-21T12:00:00.000Z' };

const binding: CredentialBinding = {
  provider: 'claude', route: 'sync-api', surface: 'anthropic-api-sdk',
  credentialKind: 'anthropic-api-key', credential: () => 'fixture-not-a-key',
};

const plan = {
  tiers: {
    synthesis: { provider: 'claude', route: 'batch-api', model: 'claude-opus-4-8', maxOutputTokens: 4096 },
    repair: { provider: 'claude', route: 'sync-api', model: 'claude-sonnet-5-5', maxOutputTokens: 2048 },
    vision: null,
  },
} as unknown as RunPlan;

const item: PreparedItem = {
  itemId: 'i', customId: 'cid_1', attemptId: 'cid_1.1', instruction: 'Explain.',
  source: { digest: 'd', text: 'Source text.', images: [] }, schema: SCHEMA_REF,
};

function adapter(finalMessage: () => Promise<unknown>) {
  const client = {
    messages: {
      stream: () => ({ finalMessage }),
      batches: {
        create: async () => ({}), retrieve: async () => ({}),
        results: async () => (async function* () { /* no rows */ })(),
      },
    },
  } as ClaudeApiClient;
  return createClaudeApiProvider({
    binding, client, schemaFor: () => SCHEMA, systemPrompt: () => 'SYSTEM', sourceRoot: '.',
  });
}

async function complete(finalMessage: () => Promise<unknown>) {
  const provider = adapter(finalMessage);
  const req = await provider.buildRequest('repair', item, plan);
  return provider.complete(req as typeof req & { route: 'sync-api' }, CTX);
}

const message = (overrides: Record<string, unknown>) => async () => ({
  id: 'msg_1', content: [{ type: 'text', text: '{"title":"ok"}' }], stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 5 }, ...overrides,
});

test('tool choice is forced on an allowlisted model and auto otherwise', async () => {
  const provider = adapter(message({}));
  const forced = await provider.buildRequest('synthesis', item, plan);
  const auto = await provider.buildRequest('repair', item, plan);
  assert.deepEqual((forced.payload as any).tool_choice, { type: 'tool', name: 'emit_explainer' });
  assert.deepEqual((auto.payload as any).tool_choice, { type: 'auto' });
  assert.ok((auto.payload as any).system[0].text.includes('emit_explainer'));
});

test('finish reasons map to stop, length and error results', async () => {
  const stop = await complete(message({}));
  assert.equal(stop.finishReason, 'stop');
  assert.equal(stop.usage.source, 'reported');
  const length = await complete(message({ stop_reason: 'max_tokens' }));
  assert.equal(length.finishReason, 'length');
  assert.equal(length.error?.code, 'OUTPUT_LIMIT');
  const refusal = await complete(message({ stop_reason: 'refusal', content: [] }));
  assert.equal(refusal.error?.code, 'REFUSAL');
  const paused = await complete(message({ stop_reason: 'pause_turn' }));
  assert.equal(paused.error?.code, 'UNEXPECTED_FINISH');
});

test('HTTP failures become results with the right retry flag', async () => {
  for (const [status, retryable] of [[429, true], [400, false]] as const) {
    const result = await complete(async () => { throw Object.assign(new Error('fixture'), { status }); });
    assert.equal(result.error?.code, 'HTTP_ERROR');
    assert.equal(result.error?.httpStatus, status);
    assert.equal(result.error?.retryable, retryable);
    assert.equal(result.usage.source, 'unavailable');
  }
});

test('batch-api declares the application batch limits', () => {
  const batch = adapter(message({})).capabilities.byRoute['batch-api']!;
  assert.ok(batch.maxBatchRequests! <= 10000);
  assert.ok(batch.maxBatchBytes! <= 100000000);
  assert.equal(batch.completionWindowMs, 86400000);
});
