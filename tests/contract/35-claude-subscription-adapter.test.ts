// Contract test for stage-cards/35-claude-subscription-adapter.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/35-claude-subscription-adapter.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const SOURCE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-35-src-'));
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-35-tmp-'));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/35-claude-subscription-adapter.md
globalThis.fetch = (async () => {
  throw new Error('network access is forbidden in contract test 35');
}) as typeof fetch;

const MODULE = path.join(REPO_ROOT, 'src', 'providers', 'claude-subscription.ts');
const PDF_BYTES = Buffer.from('%PDF-1.4\n% contract-35 fixture, never parsed\n%%EOF\n');
fs.mkdirSync(path.join(SOURCE_ROOT, 'input'), { recursive: true });
fs.writeFileSync(path.join(SOURCE_ROOT, 'input', 'paper.pdf'), PDF_BYTES);
const SCHEMA = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'contract', 'generated', 'model-output.claude.json'), 'utf8'));
const SCHEMA_REF = { id: 'explainer-model-output', version: 2, digest: 'sha256:fixture' };
const SYSTEM = 'SYSTEM PROMPT FOR CONTRACT 35';
const TOKEN = 'oauth-fixture-not-a-token';
const PARENT_ENV = {
  PATH: '/usr/bin:/bin', HOME: '/home/fixture', LANG: 'en_GB.UTF-8',
  ANTHROPIC_API_KEY: 'sk-ant-must-not-leak', OPENAI_API_KEY: 'sk-must-not-leak',
  ANTHROPIC_BASE_URL: 'https://proxy.invalid', HTTPS_PROXY: 'http://proxy.invalid:8080',
  OP_SERVICE_ACCOUNT_TOKEN: 'ops-must-not-leak', CLAUDE_CODE_OAUTH_TOKEN: 'parent-token-must-not-be-used',
};
const ALLOWED_ENV = new Set(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ', 'CLAUDE_CODE_OAUTH_TOKEN']);

function load(): Record<string, any> {
  assert.ok(fs.existsSync(MODULE), 'src/providers/claude-subscription.ts must exist');
  return require('../../src/providers/claude-subscription') as Record<string, any>;
}

function contract(): Record<string, any> {
  return require('../../src/llm-contract') as Record<string, any>;
}

function binding(overrides: Record<string, unknown> = {}): any {
  return {
    provider: 'claude', route: 'subscription-cli', surface: 'claude-agent-sdk', credentialKind: 'claude-oauth-token',
    credential: () => TOKEN, ...overrides,
  };
}

const PLAN = {
  version: 1, provider: 'claude', route: 'subscription-cli', strategy: 'single-pass',
  tiers: {
    synthesis: { provider: 'claude', route: 'subscription-cli', model: 'claude-opus-4-8', maxOutputTokens: 16384 },
    repair: { provider: 'claude', route: 'subscription-cli', model: 'claude-sonnet-5-5', maxOutputTokens: 8192 },
    vision: null,
  },
  visionDisabledReason: 'fixture',
  schema: SCHEMA_REF, registryDigest: 'r', policyDigest: 'p', maxRepairAttempts: 2, concurrency: 1,
  callTimeoutMs: { synthesis: 600000, repair: 300000, vision: 180000 }, activeWallClockLimitMs: 7200000,
};

function item(id: string, withPdf = true): Record<string, unknown> {
  return {
    itemId: `item-${id}`, customId: `cid_${id}`, attemptId: `cid_${id}.1`,
    instruction: `Write the explainer for item ${id}.`,
    source: withPdf
      ? { digest: `d-${id}`, text: '', pdf: { relativePath: 'input/paper.pdf', sha256: 'fixture' }, images: [] }
      : { digest: `d-${id}`, text: `Plain source text for ${id}.`, images: [] },
    schema: SCHEMA_REF,
  };
}

const USAGE = {
  input_tokens: 3000, output_tokens: 600, cache_read_input_tokens: 100, cache_creation_input_tokens: 20,
  cache_creation: { ephemeral_5m_input_tokens: 20, ephemeral_1h_input_tokens: 0 },
  server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 }, service_tier: 'standard',
};

function resultMessage(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'result', subtype: 'success', duration_ms: 1200, duration_api_ms: 1100, is_error: false, num_turns: 2,
    result: '', stop_reason: 'end_turn', total_cost_usd: 0.12, usage: USAGE, modelUsage: {}, permission_denials: [],
    structured_output: { title: 'ok' }, uuid: '00000000-0000-4000-8000-000000000001', session_id: 'sess_fixture',
    ...overrides,
  };
}

const INIT = { type: 'system', subtype: 'init', session_id: 'sess_fixture', uuid: '00000000-0000-4000-8000-000000000000' };
const ASSISTANT = { type: 'assistant', parent_tool_use_id: null, session_id: 'sess_fixture', uuid: '00000000-0000-4000-8000-000000000002',
  message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'Working.' }],
    stop_reason: null, stop_sequence: null, usage: USAGE } };

interface Seen { options: any; prompt: any[]; cwdExisted: boolean; cwdEntries: string[] }

function fakeQuery(script: (options: any) => AsyncIterable<unknown>): { query: any; seen: Seen[] } {
  const seen: Seen[] = [];
  const query = (args: { prompt: AsyncIterable<unknown> | string; options: any }) => {
    const record: Seen = { options: args.options, prompt: [], cwdExisted: false, cwdEntries: [] };
    seen.push(record);
    return (async function* () {
      const cwd = args.options?.cwd;
      record.cwdExisted = typeof cwd === 'string' && fs.existsSync(cwd);
      record.cwdEntries = record.cwdExisted ? fs.readdirSync(cwd) : [];
      if (typeof args.prompt === 'string') record.prompt.push(args.prompt);
      else for await (const message of args.prompt) record.prompt.push(message);
      yield* script(args.options);
    })();
  };
  return { query, seen };
}

function scripted(...messages: unknown[]) {
  return fakeQuery(async function* () { for (const m of messages) yield m; });
}

function provider(fake: { query: any }, extra: Record<string, unknown> = {}): any {
  return load().createClaudeSubscriptionProvider({
    binding: binding(), query: fake.query, parentEnv: PARENT_ENV, tmpRoot: TMP_ROOT,
    schemaFor: () => SCHEMA, systemPrompt: () => SYSTEM, sourceRoot: SOURCE_ROOT, ...extra,
  });
}

function ctx(deadlineMs = 60000, signal = new AbortController().signal) {
  return { signal, deadline: new Date(Date.now() + deadlineMs).toISOString() };
}

async function run(fake: { query: any }, stage = 'repair', withPdf = false, c = ctx()): Promise<any> {
  const p = provider(fake);
  const req = await p.buildRequest(stage, item('s', withPdf), PLAN);
  return p.complete(req, c);
}

function expectValid(result: any, label: string): void {
  assert.deepEqual(contract().checkResult(result), result, `${label}: result must already satisfy checkResult`);
}

async function expectCode(fn: () => unknown, code: string, label: string): Promise<void> {
  let thrown: any;
  try { await fn(); } catch (error) { thrown = error; }
  assert.ok(thrown, `${label}: expected ${code}, nothing was thrown`);
  assert.equal(thrown.code, code, `${label}: expected ${code}, got ${thrown && thrown.code} (${thrown && thrown.message})`);
}

test('the factory requires the subscription binding', async () => {
  let reads = 0;
  const api = binding({ route: 'sync-api', surface: 'anthropic-api-sdk', credentialKind: 'anthropic-api-key',
    credential: () => { reads += 1; return 'sk-ant-fixture'; } });
  await expectCode(() => load().createClaudeSubscriptionProvider({
    binding: api, query: scripted().query, parentEnv: PARENT_ENV, tmpRoot: TMP_ROOT,
    schemaFor: () => SCHEMA, systemPrompt: () => SYSTEM, sourceRoot: SOURCE_ROOT,
  }), 'MISSING_ROUTE_CREDENTIAL', 'API-key binding');
  assert.equal(reads, 0, 'an API key binding is never read');
});

test('identity and capabilities are honest about subscription schema evidence', () => {
  const p = provider(scripted());
  assert.equal(p.id, 'claude');
  assert.deepEqual([...p.routes], ['subscription-cli']);
  contract().assertProviderCapabilities(p);
  const cap = p.capabilities.byRoute['subscription-cli'];
  assert.equal(cap.schemaEvidence, 'unverified');
  assert.equal(cap.outputTokenLimit, 'advisory');
  assert.equal(cap.subscription, true);
  assert.equal(cap.batch, false);
});

test('buildRequest carries the system prompt, inline source content and the dialect', async () => {
  const p = provider(scripted());
  const req = await p.buildRequest('synthesis', item('a'), PLAN);
  assert.equal(req.provider, 'claude');
  assert.equal(req.route, 'subscription-cli');
  assert.equal(req.stage, 'synthesis');
  assert.equal(req.model, 'claude-opus-4-8');
  assert.equal(req.customId, 'cid_a');
  assert.equal(req.attemptId, 'cid_a.1');
  assert.equal(req.wireBytes, Buffer.byteLength(JSON.stringify(req.payload)));
  await expectCode(() => p.buildRequest('vision', item('v'), PLAN), 'ROUTE_UNSUPPORTED', 'disabled vision tier');
  const api = { ...PLAN, tiers: { ...PLAN.tiers, repair: { provider: 'claude', route: 'sync-api', model: 'claude-sonnet-5-5', maxOutputTokens: 8192 } } };
  await expectCode(() => p.buildRequest('repair', item('r'), api), 'ROUTE_UNSUPPORTED', 'an API repair tier');
});

test('complete calls the Agent SDK with the isolated, tool-free, bounded options', async () => {
  const fake = scripted(INIT, ASSISTANT, resultMessage({}));
  const result = await run(fake, 'synthesis', true);
  assert.equal(fake.seen.length, 1, 'one query call');
  const { options, prompt } = fake.seen[0];
  assert.equal(options.model, 'claude-opus-4-8');
  assert.equal(options.systemPrompt, SYSTEM);
  assert.deepEqual(options.tools, [], 'tools: [] disables built-in tools');
  assert.deepEqual(options.settingSources, [], 'no settings or project instructions are loaded');
  assert.equal(options.permissionMode, 'dontAsk');
  assert.equal(options.maxTurns, 3);
  assert.equal(options.maxBudgetUsd, undefined, 'no API-equivalent budget cap is set');
  assert.deepEqual(options.outputFormat, { type: 'json_schema', schema: SCHEMA });
  assert.ok(options.abortController instanceof AbortController, 'an abort controller bounds the call');
  assert.ok(typeof options.cwd === 'string' && path.resolve(options.cwd).startsWith(path.resolve(TMP_ROOT) + path.sep),
    'cwd is a fresh directory under the temp root');
  assert.ok(fake.seen[0].cwdExisted, 'the cwd exists during the call');
  assert.deepEqual(fake.seen[0].cwdEntries, [], 'the cwd is empty');
  assert.ok(!fs.existsSync(options.cwd), 'the cwd is removed after the call');

  const env = options.env as Record<string, string>;
  assert.ok(env && typeof env === 'object', 'an explicit env is always passed');
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, TOKEN, 'the binding credential, not the parent variable');
  assert.equal(env.PATH, PARENT_ENV.PATH);
  for (const key of Object.keys(env)) assert.ok(ALLOWED_ENV.has(key), `child env must not carry ${key}`);

  assert.equal(prompt.length, 1, 'one user message');
  const message = prompt[0] as any;
  assert.equal(message.type, 'user');
  assert.equal(message.message.role, 'user');
  const content = message.message.content;
  assert.deepEqual(content[0], { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: PDF_BYTES.toString('base64') } });
  assert.deepEqual(content[content.length - 1], { type: 'text', text: 'Write the explainer for item s.' });

  expectValid(result, 'success');
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.text, JSON.stringify({ title: 'ok' }));
  assert.equal(result.provider, 'claude');
  assert.equal(result.route, 'subscription-cli');
  assert.equal(result.stage, 'synthesis');
  assert.equal(result.customId, 'cid_s');
  assert.equal(result.providerRequestId, 'sess_fixture');
  assert.equal(result.rawFinishReason, 'end_turn');
  assert.deepEqual(result.usage, { in: 3000, out: 600, cacheRead: 100, cacheWrite5m: 20, cacheWrite1h: 0, source: 'reported' });
});

test('every installed result subtype maps to a named result with usage kept', async () => {
  const cases: Array<[string, Record<string, unknown>, string, string | null, string]> = [
    ['max turns', { subtype: 'error_max_turns', is_error: true, stop_reason: null, errors: ['max turns'], structured_output: undefined }, 'error', 'TURN_LIMIT', 'error_max_turns'],
    ['execution', { subtype: 'error_during_execution', is_error: true, stop_reason: null, errors: ['boom'], structured_output: undefined }, 'error', 'SDK_EXECUTION', 'error_during_execution'],
    ['budget', { subtype: 'error_max_budget_usd', is_error: true, stop_reason: null, errors: [], structured_output: undefined }, 'error', 'BUDGET_LIMIT', 'error_max_budget_usd'],
    ['schema retries', { subtype: 'error_max_structured_output_retries', is_error: true, stop_reason: null, errors: [], structured_output: undefined }, 'error', 'STRUCTURED_OUTPUT_RETRIES', 'error_max_structured_output_retries'],
    ['max turns despite token stop', { subtype: 'error_max_turns', is_error: true, stop_reason: 'max_tokens', errors: [], structured_output: undefined }, 'error', 'TURN_LIMIT', 'max_tokens'],
    ['token exhaustion', { stop_reason: 'max_tokens' }, 'length', 'OUTPUT_LIMIT', 'max_tokens'],
    ['context exhaustion', { stop_reason: 'model_context_window_exceeded', structured_output: undefined }, 'length', 'OUTPUT_LIMIT', 'model_context_window_exceeded'],
    ['missing structured output', { structured_output: undefined, result: 'plain text reply' }, 'error', 'MISSING_OUTPUT', 'end_turn'],
    ['contradictory success', { is_error: true }, 'error', 'UNEXPECTED_FINISH', 'end_turn'],
    ['unknown subtype', { subtype: 'error_brand_new', is_error: true, stop_reason: null }, 'error', 'UNEXPECTED_FINISH', 'error_brand_new'],
  ];
  for (const [label, overrides, finish, code, raw] of cases) {
    const message = resultMessage(overrides);
    if (overrides.structured_output === undefined && 'structured_output' in overrides) delete message.structured_output;
    const r = await run(scripted(INIT, message));
    expectValid(r, label);
    assert.equal(r.finishReason, finish, label);
    assert.equal(r.error.code, code, label);
    assert.equal(r.rawFinishReason, raw, label);
    assert.equal(r.usage.in, 3000, `${label}: usage is kept`);
    assert.equal(r.usage.source, 'reported', label);
  }
  const missing = await run(scripted(INIT, ASSISTANT));
  expectValid(missing, 'no terminal result');
  assert.equal(missing.finishReason, 'error');
  assert.equal(missing.error.code, 'MISSING_RESULT');
  assert.equal(missing.usage.source, 'unavailable');

  const thrown = await run(fakeQuery(async function* () { yield INIT; throw new Error('Claude Code process exited with code 1'); }));
  expectValid(thrown, 'SDK throws');
  assert.equal(thrown.error.code, 'SDK_EXECUTION');
});

test('the deadline aborts the call as TIMEOUT and the caller signal as CANCELLED, cleaning up either way', async () => {
  const hang = () => fakeQuery(async function* (options: any) {
    yield INIT;
    await new Promise<void>((resolve) => {
      if (options.abortController.signal.aborted) resolve();
      options.abortController.signal.addEventListener('abort', () => resolve());
    });
    throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
  });
  const slow = hang();
  const timedOut = await run(slow, 'repair', false, ctx(300));
  expectValid(timedOut, 'deadline');
  assert.equal(timedOut.finishReason, 'error');
  assert.equal(timedOut.error.code, 'TIMEOUT');
  assert.deepEqual(fs.readdirSync(TMP_ROOT), [], 'no temporary cwd survives a timeout');

  const controller = new AbortController();
  const cancelled = hang();
  setTimeout(() => controller.abort(), 40);
  const r = await run(cancelled, 'repair', false, ctx(60000, controller.signal));
  assert.equal(r.error.code, 'CANCELLED');
  assert.deepEqual(fs.readdirSync(TMP_ROOT), [], 'no temporary cwd survives a cancellation');
});

test('batch methods are refused before any query', async () => {
  const fake = scripted(resultMessage({}));
  const p = provider(fake);
  const req = await p.buildRequest('repair', item('b', false), PLAN);
  const c = ctx();
  await expectCode(() => p.submitBatch([req], c), 'ROUTE_UNSUPPORTED', 'submitBatch');
  const handle = { provider: 'claude', remoteId: 'x', submittedAt: 'x', expiresAt: 'x', requests: [] };
  await expectCode(() => p.getBatch(handle, c), 'ROUTE_UNSUPPORTED', 'getBatch');
  await expectCode(async () => { for await (const _ of p.results(handle, c)) { /* drain */ } }, 'ROUTE_UNSUPPORTED', 'results');
  assert.equal(fake.seen.length, 0);
});

test('the adapter never reaches the raw API client and loads the Agent SDK only lazily', () => {
  const source = fs.readFileSync(MODULE, 'utf8');
  assert.ok(!/['"]@anthropic-ai\/sdk['"]/.test(source), 'the raw API SDK is never imported');
  assert.ok(!/^\s*import\s+(?!type\b)[^;]*['"]@anthropic-ai\/claude-agent-sdk['"]/m.test(source),
    'the Agent SDK is not imported at module load (type-only imports are fine)');
  assert.ok(!/require\(\s*['"]@anthropic-ai\/claude-agent-sdk['"]\s*\)/.test(source), 'no eager require of the Agent SDK');
  for (const banned of ['../output', '../batch', '../repair', '../quality', '../state']) {
    assert.ok(!new RegExp(`['"]${banned.replace(/[.]/g, '\\.')}['"]`).test(source), `must not import ${banned}`);
  }
});
// AUTOMETTA-CONTRACT-END

test.after(() => {
  fs.rmSync(SOURCE_ROOT, { recursive: true, force: true });
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});
