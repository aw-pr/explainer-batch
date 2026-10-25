import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClaudeSubscriptionProvider } from '../../src/providers/claude-subscription';
import type { AgentQuery } from '../../src/providers/claude-subscription';
import type { PreparedItem, RunPlan } from '../../src/llm-contract';
import type { CredentialBinding } from '../../src/routes';

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-subscription-unit-'));
const SCHEMA_REF = { id: 'explainer-model-output', version: 2, digest: 'sha256:fixture' };
const SCHEMA = { type: 'object', properties: { title: { type: 'string' } } };

const binding: CredentialBinding = {
  provider: 'claude', route: 'subscription-cli', surface: 'claude-agent-sdk',
  credentialKind: 'claude-oauth-token', credential: () => 'oauth-fixture-not-a-token',
};

const plan = {
  tiers: {
    synthesis: { provider: 'claude', route: 'subscription-cli', model: 'claude-opus-4-8', maxOutputTokens: 4096 },
    repair: { provider: 'claude', route: 'subscription-cli', model: 'claude-sonnet-5-5', maxOutputTokens: 2048 },
    vision: null,
  },
} as unknown as RunPlan;

const item: PreparedItem = {
  itemId: 'i', customId: 'cid_1', attemptId: 'cid_1.1', instruction: 'Explain.',
  source: { digest: 'd', text: 'Source text.', images: [] }, schema: SCHEMA_REF,
};

const USAGE = {
  input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2, cache_creation_input_tokens: 3,
};

const result = (overrides: Record<string, unknown>) => ({
  type: 'result', subtype: 'success', duration_ms: 10, duration_api_ms: 9, is_error: false, num_turns: 1,
  result: '', stop_reason: 'end_turn', total_cost_usd: 0, usage: USAGE, modelUsage: {}, permission_denials: [],
  structured_output: { title: 'ok' }, uuid: '00000000-0000-4000-8000-000000000001', session_id: 'sess_unit',
  ...overrides,
});

function stream(messages: unknown[]): { query: AgentQuery; calls: any[] } {
  const calls: any[] = [];
  const query = ((args: { options: unknown }) => {
    calls.push(args.options);
    return (async function* () { for (const m of messages) yield m; })();
  }) as unknown as AgentQuery;
  return { query, calls };
}

async function complete(query: AgentQuery, deadlineMs = 60000) {
  const provider = createClaudeSubscriptionProvider({
    binding, query, parentEnv: { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-ant-must-not-leak' },
    tmpRoot: TMP_ROOT, schemaFor: () => SCHEMA, systemPrompt: () => 'SYSTEM', sourceRoot: '.',
  });
  const req = await provider.buildRequest('repair', item, plan);
  const ctx = { signal: new AbortController().signal, deadline: new Date(Date.now() + deadlineMs).toISOString() };
  return provider.complete(req as typeof req & { route: 'subscription-cli' }, ctx);
}

test('structured output on a successful result becomes stop text with usage', async () => {
  const fake = stream([{ type: 'system', subtype: 'init' }, result({})]);
  const r = await complete(fake.query);
  assert.equal(r.finishReason, 'stop');
  assert.equal(r.text, '{"title":"ok"}');
  assert.equal(r.providerRequestId, 'sess_unit');
  assert.deepEqual(r.usage, { in: 10, out: 5, cacheRead: 2, cacheWrite5m: 3, cacheWrite1h: null, source: 'reported' });
  const [options] = fake.calls;
  assert.deepEqual(options.tools, []);
  assert.equal(options.maxTurns, 3);
  assert.equal(options.env.ANTHROPIC_API_KEY, undefined);
  assert.deepEqual(Object.keys(options).sort(), [
    'abortController', 'cwd', 'env', 'maxTurns', 'model', 'outputFormat',
    'permissionMode', 'settingSources', 'systemPrompt', 'tools',
  ]);
});

test('error_max_turns is a turn limit, not truncation, and keeps usage', async () => {
  const r = await complete(stream([result({
    subtype: 'error_max_turns', is_error: true, stop_reason: 'max_tokens', errors: [], structured_output: undefined,
  })]).query);
  assert.equal(r.finishReason, 'error');
  assert.equal(r.error?.code, 'TURN_LIMIT');
  assert.equal(r.usage.in, 10);
});

test('a success without structured output is MISSING_OUTPUT and keeps the reply text', async () => {
  const r = await complete(stream([result({ structured_output: undefined, result: 'plain reply' })]).query);
  assert.equal(r.error?.code, 'MISSING_OUTPUT');
  assert.equal(r.text, 'plain reply');
});

test('an unlisted stop reason on success fails closed', async () => {
  const r = await complete(stream([result({ stop_reason: 'pause_turn' })]).query);
  assert.equal(r.error?.code, 'UNEXPECTED_FINISH');
  assert.equal(r.rawFinishReason, 'pause_turn');
});

test('a stream that ignores the abort still times out and removes its cwd', async () => {
  const hang = (() => (async function* () {
    yield { type: 'system', subtype: 'init' };
    await new Promise(() => { /* never settles */ });
  })()) as unknown as AgentQuery;
  const r = await complete(hang, 50);
  assert.equal(r.error?.code, 'TIMEOUT');
  assert.deepEqual(fs.readdirSync(TMP_ROOT), []);
});

test.after(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});
