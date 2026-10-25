// Contract test for stage-cards/33-claude-api-adapter.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/33-claude-api-adapter.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const SOURCE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-33-'));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/33-claude-api-adapter.md
globalThis.fetch = (async () => {
  throw new Error('network access is forbidden in contract test 33');
}) as typeof fetch;

const MODULE = path.join(REPO_ROOT, 'src', 'providers', 'claude-api.ts');
const PDF_BYTES = Buffer.from('%PDF-1.4\n% contract-33 fixture, never parsed\n%%EOF\n');
fs.mkdirSync(path.join(SOURCE_ROOT, 'input'), { recursive: true });
fs.writeFileSync(path.join(SOURCE_ROOT, 'input', 'paper.pdf'), PDF_BYTES);
const SCHEMA = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'contract', 'generated', 'model-output.claude.json'), 'utf8'));
const SCHEMA_REF = { id: 'explainer-model-output', version: 2, digest: 'sha256:fixture' };
const SYSTEM = 'SYSTEM PROMPT FOR CONTRACT 33';

function load(): Record<string, any> {
  assert.ok(fs.existsSync(MODULE), 'src/providers/claude-api.ts must exist');
  return require('../../src/providers/claude-api') as Record<string, any>;
}

function contract(): Record<string, any> {
  return require('../../src/llm-contract') as Record<string, any>;
}

function binding(overrides: Record<string, unknown> = {}): { value: any; reads: () => number } {
  let reads = 0;
  const value = {
    provider: 'claude', route: 'batch-api', surface: 'anthropic-api-sdk',
    credentialKind: 'anthropic-api-key',
    credential: () => { reads += 1; return 'sk-ant-fixture-not-a-key'; },
    ...overrides,
  };
  return { value, reads: () => reads };
}

const PLAN = {
  version: 1, provider: 'claude', route: 'batch-api', strategy: 'single-pass',
  tiers: {
    synthesis: { provider: 'claude', route: 'batch-api', model: 'claude-opus-4-8', maxOutputTokens: 16384 },
    repair: { provider: 'claude', route: 'sync-api', model: 'claude-sonnet-5-5', maxOutputTokens: 8192 },
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

interface Fake {
  client: any;
  calls: Array<{ op: string; args: unknown[] }>;
}

function fakeClient(script: {
  message?: unknown; error?: unknown; batch?: Record<string, unknown>; retrieve?: Record<string, unknown>;
  rows?: unknown[];
} = {}): Fake {
  const calls: Fake['calls'] = [];
  const client = {
    messages: {
      stream(params: unknown, options?: unknown) {
        calls.push({ op: 'stream', args: [params, options] });
        return {
          async finalMessage() {
            if (script.error) throw script.error;
            return script.message;
          },
        };
      },
      create(...args: unknown[]) {
        calls.push({ op: 'create', args });
        throw new Error('messages.create must not be used; stream instead');
      },
      batches: {
        async create(body: unknown, options?: unknown) {
          calls.push({ op: 'batches.create', args: [body, options] });
          return script.batch;
        },
        async retrieve(id: unknown, options?: unknown) {
          calls.push({ op: 'batches.retrieve', args: [id, options] });
          return script.retrieve;
        },
        async results(id: unknown, options?: unknown) {
          calls.push({ op: 'batches.results', args: [id, options] });
          const rows = script.rows ?? [];
          return (async function* () { for (const row of rows) yield row; })();
        },
      },
    },
  };
  return { client, calls };
}

function provider(fake: Fake, b = binding().value): any {
  return load().createClaudeApiProvider({
    binding: b, client: fake.client, schemaFor: () => SCHEMA, systemPrompt: () => SYSTEM,
    sourceRoot: SOURCE_ROOT,
  });
}

const CTX = { signal: new AbortController().signal, deadline: '2026-10-21T12:00:00.000Z' };

function message(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'msg_fixture01', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5',
    content: [{ type: 'text', text: '{"title":"ok"}' }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 50, cache_creation_input_tokens: 15,
      cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 5 } },
    ...overrides,
  };
}

async function syncResult(fake: Fake): Promise<any> {
  const p = provider(fake);
  const req = await p.buildRequest('repair', item('s'), PLAN);
  return p.complete(req, CTX);
}

function expectValid(result: any, label: string): void {
  assert.deepEqual(contract().checkResult(result), result, `${label}: result must already satisfy checkResult`);
}

async function expectCode(run: () => unknown, code: string, label: string): Promise<void> {
  let thrown: any;
  try { await run(); } catch (error) { thrown = error; }
  assert.ok(thrown, `${label}: expected ${code}, nothing was thrown`);
  assert.equal(thrown.code, code, `${label}: expected ${code}, got ${thrown && thrown.code} (${thrown && thrown.message})`);
}

test('the factory requires an Anthropic API binding and never reads an OAuth credential', async () => {
  const oauth = binding({ route: 'subscription-cli', surface: 'claude-agent-sdk', credentialKind: 'claude-oauth-token' });
  await expectCode(() => load().createClaudeApiProvider({
    binding: oauth.value, client: fakeClient().client, schemaFor: () => SCHEMA, systemPrompt: () => SYSTEM, sourceRoot: SOURCE_ROOT,
  }), 'CLAUDE_OAUTH_WRONG_SURFACE', 'OAuth binding');
  assert.equal(oauth.reads(), 0, 'the OAuth credential must never be read');
  const other = binding({ provider: 'openai', surface: 'openai-api', credentialKind: 'openai-api-key' });
  await expectCode(() => load().createClaudeApiProvider({
    binding: other.value, client: fakeClient().client, schemaFor: () => SCHEMA, systemPrompt: () => SYSTEM, sourceRoot: SOURCE_ROOT,
  }), 'MISSING_ROUTE_CREDENTIAL', 'OpenAI binding');
  const ok = binding();
  provider(fakeClient(), ok.value);
  assert.equal(ok.reads(), 0, 'an injected client means the key is not read');
});

test('identity and capabilities satisfy the shared contract', () => {
  const p = provider(fakeClient());
  assert.equal(p.id, 'claude');
  assert.deepEqual([...p.routes].sort(), ['batch-api', 'sync-api']);
  contract().assertProviderCapabilities(p);
  const batch = p.capabilities.byRoute['batch-api'];
  const sync = p.capabilities.byRoute['sync-api'];
  assert.equal(batch.structured, 'tool');
  assert.equal(sync.structured, 'tool');
  assert.equal(batch.outputTokenLimit, 'enforced');
  assert.equal(batch.pdfNative, true);
  assert.equal(batch.vision, true);
  assert.ok(Number.isInteger(batch.maxBatchRequests) && batch.maxBatchRequests > 0 && batch.maxBatchRequests <= 10000,
    `batch-api maxBatchRequests must be a positive integer at most 10000, got ${batch.maxBatchRequests}`);
  assert.ok(Number.isInteger(batch.maxBatchBytes) && batch.maxBatchBytes > 0 && batch.maxBatchBytes <= 100000000,
    `batch-api maxBatchBytes must be a positive integer at most 100000000, got ${batch.maxBatchBytes}`);
  assert.equal(batch.completionWindowMs, 86400000);
});

test('buildRequest forces the emission tool on an allowlisted model and pins the wire payload', async () => {
  const p = provider(fakeClient());
  const req = await p.buildRequest('synthesis', item('a'), PLAN);
  assert.equal(req.provider, 'claude');
  assert.equal(req.route, 'batch-api');
  assert.equal(req.stage, 'synthesis');
  assert.equal(req.model, 'claude-opus-4-8');
  assert.equal(req.customId, 'cid_a');
  assert.equal(req.attemptId, 'cid_a.1');
  assert.deepEqual(req.schema, SCHEMA_REF);
  const payload = req.payload as any;
  assert.equal(payload.model, 'claude-opus-4-8');
  assert.equal(payload.max_tokens, 16384);
  assert.ok(Array.isArray(payload.system) && payload.system.length === 1, 'system is one text block');
  assert.equal(payload.system[0].type, 'text');
  assert.ok(payload.system[0].text.startsWith(SYSTEM), 'system text starts with the stage system prompt');
  assert.deepEqual(payload.system[0].cache_control, { type: 'ephemeral' });
  assert.equal(payload.tools.length, 1);
  assert.equal(payload.tools[0].name, 'emit_explainer');
  assert.deepEqual(payload.tools[0].input_schema, SCHEMA, 'input_schema is the injected dialect, unmodified');
  assert.deepEqual(payload.tool_choice, { type: 'tool', name: 'emit_explainer' });
  assert.equal(payload.messages.length, 1);
  assert.equal(payload.messages[0].role, 'user');
  const content = payload.messages[0].content;
  assert.deepEqual(content[0], {
    type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: PDF_BYTES.toString('base64') },
  });
  assert.deepEqual(content[content.length - 1], { type: 'text', text: 'Write the explainer for item a.' });
  const envelope = JSON.stringify({ custom_id: 'cid_a', params: payload });
  assert.equal(req.wireBytes, Buffer.byteLength(envelope), 'batch wireBytes counts the {custom_id, params} envelope');
});

test('buildRequest uses auto tool choice plus an instruction for a model outside the allowlist', async () => {
  const p = provider(fakeClient());
  const req = await p.buildRequest('repair', item('b', false), PLAN);
  const payload = req.payload as any;
  assert.equal(req.route, 'sync-api');
  assert.equal(payload.model, 'claude-sonnet-5-5');
  assert.equal(payload.max_tokens, 8192);
  assert.deepEqual(payload.tool_choice, { type: 'auto' });
  assert.ok(payload.system[0].text.startsWith(SYSTEM));
  assert.ok(payload.system[0].text.length > SYSTEM.length && payload.system[0].text.includes('emit_explainer'),
    'the system text names the emission tool when it cannot be forced');
  const content = payload.messages[0].content;
  assert.ok(!content.some((block: any) => block.type === 'document'), 'a text source sends no document block');
  assert.ok(content.some((block: any) => block.type === 'text' && block.text === 'Plain source text for b.'),
    'a text source is sent as a text block');
  assert.equal(req.wireBytes, Buffer.byteLength(JSON.stringify(payload)), 'sync wireBytes counts the request body');
});

test('buildRequest refuses a stage whose binding this adapter does not serve', async () => {
  const p = provider(fakeClient());
  await expectCode(() => p.buildRequest('vision', item('v'), PLAN), 'ROUTE_UNSUPPORTED', 'disabled vision tier');
  const foreign = { ...PLAN, tiers: { ...PLAN.tiers, repair: { provider: 'openai', route: 'sync-api', model: 'gpt-5.6-luna', maxOutputTokens: 8192 } } };
  await expectCode(() => p.buildRequest('repair', item('f'), foreign), 'ROUTE_UNSUPPORTED', 'another provider\'s tier');
  const sub = { ...PLAN, tiers: { ...PLAN.tiers, repair: { provider: 'claude', route: 'subscription-cli', model: 'claude-sonnet-5-5', maxOutputTokens: 8192 } } };
  await expectCode(() => p.buildRequest('repair', item('g'), sub), 'ROUTE_UNSUPPORTED', 'subscription tier');
});

test('sync completion maps stop reasons, the emission tool and usage', async () => {
  const stop = await syncResult(fakeClient({ message: message({}) }));
  expectValid(stop, 'end_turn');
  assert.equal(stop.finishReason, 'stop');
  assert.equal(stop.text, '{"title":"ok"}');
  assert.equal(stop.provider, 'claude');
  assert.equal(stop.route, 'sync-api');
  assert.equal(stop.stage, 'repair');
  assert.equal(stop.model, 'claude-sonnet-5-5');
  assert.equal(stop.customId, 'cid_s');
  assert.equal(stop.attemptId, 'cid_s.1');
  assert.equal(stop.providerRequestId, 'msg_fixture01');
  assert.equal(stop.rawFinishReason, 'end_turn');
  assert.deepEqual(stop.usage, { in: 1000, out: 200, cacheRead: 50, cacheWrite5m: 10, cacheWrite1h: 5, source: 'reported' });

  const flat = await syncResult(fakeClient({ message: message({
    usage: { input_tokens: 9, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 7 },
  }) }));
  assert.deepEqual(flat.usage, { in: 9, out: 3, cacheRead: 0, cacheWrite5m: 7, cacheWrite1h: null, source: 'reported' },
    'without a TTL breakdown, cache_creation_input_tokens counts as 5-minute writes');

  const tool = await syncResult(fakeClient({ message: message({
    stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_explainer', input: { title: 'tool' } }],
  }) }));
  expectValid(tool, 'tool_use');
  assert.equal(tool.finishReason, 'stop');
  assert.equal(tool.text, JSON.stringify({ title: 'tool' }));

  const sequence = await syncResult(fakeClient({ message: message({ stop_reason: 'stop_sequence', stop_sequence: '###' }) }));
  assert.equal(sequence.finishReason, 'stop');

  for (const [label, content] of [
    ['wrong tool', [{ type: 'tool_use', id: 'toolu_2', name: 'web_search', input: {} }]],
    ['two emissions', [
      { type: 'tool_use', id: 'toolu_3', name: 'emit_explainer', input: { a: 1 } },
      { type: 'tool_use', id: 'toolu_4', name: 'emit_explainer', input: { a: 2 } },
    ]],
  ] as const) {
    const r = await syncResult(fakeClient({ message: message({ stop_reason: 'tool_use', content }) }));
    expectValid(r, label);
    assert.equal(r.finishReason, 'error', label);
    assert.equal(r.error.code, 'UNEXPECTED_TOOL', label);
  }

  for (const reason of ['max_tokens', 'model_context_window_exceeded']) {
    const r = await syncResult(fakeClient({ message: message({ stop_reason: reason }) }));
    expectValid(r, reason);
    assert.equal(r.finishReason, 'length', reason);
    assert.equal(r.error.code, 'OUTPUT_LIMIT', reason);
    assert.equal(r.rawFinishReason, reason, reason);
    assert.equal(r.usage.out, 200, `${reason}: usage survives a truncated response`);
  }

  const refusal = await syncResult(fakeClient({ message: message({ stop_reason: 'refusal', content: [] }) }));
  assert.equal(refusal.finishReason, 'error');
  assert.equal(refusal.error.code, 'REFUSAL');
  for (const reason of ['pause_turn', null, 'brand_new_reason']) {
    const r = await syncResult(fakeClient({ message: message({ stop_reason: reason }) }));
    expectValid(r, String(reason));
    assert.equal(r.finishReason, 'error', String(reason));
    assert.equal(r.error.code, 'UNEXPECTED_FINISH', String(reason));
  }

  const empty = await syncResult(fakeClient({ message: message({ content: [{ type: 'text', text: '   ' }] }) }));
  assert.equal(empty.finishReason, 'error');
  assert.equal(empty.error.code, 'EMPTY_OUTPUT');
});

test('sync completion streams, passes the abort signal and turns HTTP failures into results', async () => {
  const fake = fakeClient({ message: message({}) });
  await syncResult(fake);
  assert.deepEqual(fake.calls.map(c => c.op), ['stream'], 'one streamed call, never messages.create');
  const options = fake.calls[0].args[1] as any;
  assert.equal(options && options.signal, CTX.signal, 'the call context signal is passed to the client');

  for (const [status, retryable] of [[429, true], [529, true], [408, true], [400, false], [401, false]] as const) {
    const error = Object.assign(new Error(`fixture HTTP ${status}`), { status });
    const r = await syncResult(fakeClient({ error }));
    expectValid(r, `HTTP ${status}`);
    assert.equal(r.finishReason, 'error', `HTTP ${status}`);
    assert.equal(r.error.code, 'HTTP_ERROR', `HTTP ${status}`);
    assert.equal(r.error.httpStatus, status, `HTTP ${status}`);
    assert.equal(r.error.retryable, retryable, `HTTP ${status} retryable`);
    assert.equal(r.usage.source, 'unavailable', `HTTP ${status} usage`);
  }
  const network = await syncResult(fakeClient({ error: new Error('socket hang up') }));
  assert.equal(network.finishReason, 'error');
  assert.equal(network.error.code, 'PROVIDER_ERROR');
});

test('route-mismatched calls are refused before any client call', async () => {
  const fake = fakeClient({ message: message({}) });
  const p = provider(fake);
  const batchReq = await p.buildRequest('synthesis', item('m'), PLAN);
  await expectCode(() => p.complete(batchReq, CTX), 'ROUTE_UNSUPPORTED', 'complete on a batch request');
  const syncReq = await p.buildRequest('repair', item('n'), PLAN);
  await expectCode(() => p.submitBatch([syncReq], CTX), 'ROUTE_UNSUPPORTED', 'submitBatch with a sync request');
  await expectCode(() => p.complete({ ...syncReq, route: 'subscription-cli' }, CTX), 'ROUTE_UNSUPPORTED', 'subscription request');
  assert.equal(fake.calls.length, 0, 'no client call was made');
});

test('batches are submitted, polled and collected by custom ID', async () => {
  const fake = fakeClient({
    batch: { id: 'msgbatch_01', type: 'message_batch', processing_status: 'in_progress',
      created_at: '2026-10-21T09:00:00.000Z', expires_at: '2026-10-22T09:00:00.000Z',
      request_counts: { processing: 5, succeeded: 0, errored: 0, canceled: 0, expired: 0 } },
    rows: [
      { custom_id: 'cid_ghost', result: { type: 'succeeded', message: message({}) } },
      { custom_id: 'cid_d', result: { type: 'canceled' } },
      { custom_id: 'cid_a', result: { type: 'succeeded', message: message({ model: 'claude-opus-4-8' }) } },
      { custom_id: 'cid_c', result: { type: 'expired' } },
      { custom_id: 'cid_b', result: { type: 'errored', error: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } } },
    ],
  });
  const p = provider(fake);
  const reqs = [];
  for (const id of ['a', 'b', 'c', 'd', 'e']) reqs.push(await p.buildRequest('synthesis', item(id), PLAN));
  const handle = await p.submitBatch(reqs, CTX);
  const create = fake.calls.find(c => c.op === 'batches.create')!;
  const body = create.args[0] as any;
  assert.deepEqual(body.requests.map((r: any) => r.custom_id), ['cid_a', 'cid_b', 'cid_c', 'cid_d', 'cid_e']);
  assert.deepEqual(body.requests[0].params, reqs[0].payload, 'each batch row carries the built payload as params');
  assert.equal((create.args[1] as any)?.signal, CTX.signal);
  assert.equal(handle.provider, 'claude');
  assert.equal(handle.remoteId, 'msgbatch_01');
  assert.equal(handle.submittedAt, '2026-10-21T09:00:00.000Z');
  assert.equal(handle.expiresAt, '2026-10-22T09:00:00.000Z');
  assert.deepEqual(handle.requests[1], { customId: 'cid_b', attemptId: 'cid_b.1', stage: 'synthesis', model: 'claude-opus-4-8' });

  const results: any[] = [];
  for await (const r of p.results(handle, CTX)) results.push(r);
  assert.equal(results.length, 5, 'one result per expected request; the unknown custom ID is skipped');
  const byId = new Map(results.map(r => [r.customId, r]));
  for (const r of results) {
    expectValid(r, r.customId);
    assert.equal(r.route, 'batch-api');
    assert.equal(r.stage, 'synthesis');
    assert.equal(r.model, 'claude-opus-4-8');
  }
  assert.equal(byId.get('cid_a').finishReason, 'stop');
  assert.equal(byId.get('cid_a').attemptId, 'cid_a.1');
  assert.equal(byId.get('cid_b').error.code, 'PROVIDER_ERROR');
  assert.equal(byId.get('cid_b').error.providerCode, 'overloaded_error');
  assert.equal(byId.get('cid_c').error.code, 'BATCH_EXPIRED');
  assert.equal(byId.get('cid_d').error.code, 'CANCELLED');
  assert.equal(byId.get('cid_e').error.code, 'MISSING_RESULT');
  assert.equal(byId.get('cid_e').usage.source, 'unavailable');
});

test('batch status maps processing states and counts', async () => {
  const handle = { provider: 'claude', remoteId: 'msgbatch_02', submittedAt: 'x', expiresAt: 'y', requests: [] };
  const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
    [{ processing_status: 'in_progress', request_counts: { processing: 2, succeeded: 1, errored: 0, canceled: 0, expired: 0 } },
      { status: 'running', counts: { pending: 2, succeeded: 1, failed: 0 } }],
    [{ processing_status: 'canceling', request_counts: { processing: 1, succeeded: 0, errored: 0, canceled: 1, expired: 0 } },
      { status: 'running', counts: { pending: 1, succeeded: 0, failed: 1 } }],
    [{ processing_status: 'ended', request_counts: { processing: 0, succeeded: 1, errored: 1, canceled: 1, expired: 1 } },
      { status: 'completed', counts: { pending: 0, succeeded: 1, failed: 3 } }],
  ];
  for (const [retrieve, expected] of cases) {
    const fake = fakeClient({ retrieve: { id: 'msgbatch_02', ...retrieve } });
    const snapshot = await provider(fake).getBatch(handle, CTX);
    assert.equal(snapshot.status, expected.status, String(retrieve.processing_status));
    assert.deepEqual(snapshot.counts, expected.counts, String(retrieve.processing_status));
    assert.equal(fake.calls[0].args[0], 'msgbatch_02');
  }
});

test('the adapter stays a transport: no saving, repair or orchestration imports', () => {
  const source = fs.readFileSync(MODULE, 'utf8');
  const specifiers = [...source.matchAll(/(?:from\s+|require\()\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  assert.ok(specifiers.length > 0, 'the module has imports');
  for (const banned of ['../output', '../batch', '../repair', '../quality', '../state', '../state-v2', '../index']) {
    assert.ok(!specifiers.includes(banned), `src/providers/claude-api.ts must not import ${banned}`);
  }
  assert.ok(!/process\.env/.test(source), 'the adapter reads no environment variables');
  assert.ok(!specifiers.includes('@anthropic-ai/claude-agent-sdk'), 'the raw API adapter never loads the Agent SDK');
});
// AUTOMETTA-CONTRACT-END

test.after(() => {
  fs.rmSync(SOURCE_ROOT, { recursive: true, force: true });
});
