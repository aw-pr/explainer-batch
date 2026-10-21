// Contract test for stage-cards/34-openai-api-adapter.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/34-openai-api-adapter.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const SOURCE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-34-'));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/34-openai-api-adapter.md
globalThis.fetch = (async () => {
  throw new Error('network access is forbidden in contract test 34');
}) as typeof fetch;

const MODULE = path.join(REPO_ROOT, 'src', 'providers', 'openai-api.ts');
const PDF_BYTES = Buffer.from('%PDF-1.4\n% contract-34 fixture, never parsed\n%%EOF\n');
fs.mkdirSync(path.join(SOURCE_ROOT, 'input'), { recursive: true });
fs.writeFileSync(path.join(SOURCE_ROOT, 'input', 'paper.pdf'), PDF_BYTES);
const SCHEMA = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'contract', 'generated', 'model-output.openai.json'), 'utf8'));
const SCHEMA_REF = { id: 'explainer-model-output', version: 2, digest: 'sha256:fixture' };
const SYSTEM = 'SYSTEM PROMPT FOR CONTRACT 34';
const NOW = new Date('2026-10-21T09:00:00.000Z');
const HOUR = 3600000;

function load(): Record<string, any> {
  assert.ok(fs.existsSync(MODULE), 'src/providers/openai-api.ts must exist');
  return require('../../src/providers/openai-api') as Record<string, any>;
}

function contract(): Record<string, any> {
  return require('../../src/llm-contract') as Record<string, any>;
}

function binding(overrides: Record<string, unknown> = {}): { value: any; reads: () => number } {
  let reads = 0;
  const value = {
    provider: 'openai', route: 'batch-api', surface: 'openai-api', credentialKind: 'openai-api-key',
    credential: () => { reads += 1; return 'sk-fixture-not-a-key'; },
    ...overrides,
  };
  return { value, reads: () => reads };
}

const PLAN = {
  version: 1, provider: 'openai', route: 'batch-api', strategy: 'single-pass',
  tiers: {
    synthesis: { provider: 'openai', route: 'batch-api', model: 'gpt-5.6-terra', maxOutputTokens: 8192 },
    repair: { provider: 'openai', route: 'sync-api', model: 'gpt-5.6-luna', maxOutputTokens: 4096 },
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
      ? { digest: `d-${id}`, text: '', pdf: { relativePath: 'input/paper.pdf', sha256: `sha-${id}` }, images: [] }
      : { digest: `d-${id}`, text: `Plain source text for ${id}.`, images: [] },
    schema: SCHEMA_REF,
  };
}

type Reply = { status: number; body: unknown };
interface Fake {
  transport: any;
  calls: Array<{ op: string; path?: string; args: unknown[] }>;
}

function fakeTransport(routes: Record<string, Reply | ((...args: any[]) => Reply)>): Fake {
  const calls: Fake['calls'] = [];
  const answer = (key: string, args: unknown[]): Reply => {
    const route = routes[key];
    if (!route) throw new Error(`unexpected transport call ${key}`);
    return typeof route === 'function' ? route(...args) : route;
  };
  const transport = {
    async request(method: string, p: string, body?: unknown, signal?: unknown) {
      calls.push({ op: method, path: p, args: [body, signal] });
      return answer(`${method} ${p}`, [body, signal]);
    },
    async text(p: string, signal?: unknown) {
      calls.push({ op: 'TEXT', path: p, args: [signal] });
      return answer(`TEXT ${p}`, [signal]);
    },
    async upload(purpose: string, filename: string, bytes: Buffer, signal?: unknown) {
      calls.push({ op: 'UPLOAD', path: purpose, args: [filename, bytes, signal] });
      return answer(`UPLOAD ${purpose}`, [filename, bytes, signal]);
    },
  };
  return { transport, calls };
}

interface Cache {
  service: any;
  entries: Map<string, any>;
  log: string[];
}

function fakeCache(seed: Record<string, any> = {}): Cache {
  const entries = new Map(Object.entries(seed));
  const log: string[] = [];
  const key = (provider: string, scope: string, purpose: string, sha: string) => `${provider}|${scope}|${purpose}|${sha}`;
  return {
    entries, log,
    service: {
      get(provider: string, scope: string, purpose: string, sha: string) {
        log.push(`get ${key(provider, scope, purpose, sha)}`);
        return entries.get(key(provider, scope, purpose, sha));
      },
      put(provider: string, scope: string, purpose: string, sha: string, entry: unknown) {
        log.push(`put ${key(provider, scope, purpose, sha)}`);
        entries.set(key(provider, scope, purpose, sha), entry);
      },
      invalidate(provider: string, scope: string, purpose: string, sha: string) {
        log.push(`invalidate ${key(provider, scope, purpose, sha)}`);
        entries.delete(key(provider, scope, purpose, sha));
      },
    },
  };
}

const FILE_NEW = { id: 'file-new', object: 'file', bytes: PDF_BYTES.length, created_at: 1761037200, expires_at: null,
  filename: 'paper.pdf', purpose: 'user_data', status: 'processed' };

function provider(fake: Fake, cache: Cache = fakeCache(), extra: Record<string, unknown> = {}): any {
  return load().createOpenAiApiProvider({
    binding: binding().value, transport: fake.transport, fileCache: cache.service, accountScope: 'acct-fixture',
    schemaFor: () => SCHEMA, systemPrompt: () => SYSTEM, sourceRoot: SOURCE_ROOT, now: () => NOW, ...extra,
  });
}

const CTX = { signal: new AbortController().signal, deadline: '2026-10-21T12:00:00.000Z' };

function responseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'resp_fixture01', object: 'response', status: 'completed', model: 'gpt-5.6-luna', error: null,
    incomplete_details: null,
    output: [
      { type: 'reasoning', id: 'rs_1', summary: [] },
      { type: 'message', id: 'msg_1', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: '{"title":"ok"}', annotations: [] }] },
    ],
    usage: { input_tokens: 1500, input_tokens_details: { cached_tokens: 400 }, output_tokens: 250,
      output_tokens_details: { reasoning_tokens: 100 }, total_tokens: 1750 },
    ...overrides,
  };
}

async function syncResult(reply: Reply | (() => Reply)): Promise<any> {
  const fake = fakeTransport({ 'POST /responses': reply });
  const p = provider(fake);
  const req = await p.buildRequest('repair', item('s', false), PLAN);
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

test('the factory requires a direct OpenAI API binding', async () => {
  const codex = binding({ route: 'subscription-cli', surface: 'codex-cli', credentialKind: 'codex-chatgpt-login' });
  await expectCode(() => load().createOpenAiApiProvider({
    binding: codex.value, transport: fakeTransport({}).transport, fileCache: fakeCache().service, accountScope: 'a',
    schemaFor: () => SCHEMA, systemPrompt: () => SYSTEM, sourceRoot: SOURCE_ROOT,
  }), 'MISSING_ROUTE_CREDENTIAL', 'Codex binding');
  assert.equal(codex.reads(), 0, 'a refused binding is never read');
  const ok = binding();
  load().createOpenAiApiProvider({
    binding: ok.value, transport: fakeTransport({}).transport, fileCache: fakeCache().service, accountScope: 'a',
    schemaFor: () => SCHEMA, systemPrompt: () => SYSTEM, sourceRoot: SOURCE_ROOT,
  });
  assert.equal(ok.reads(), 0, 'an injected transport means the key is not read');
});

test('identity and capabilities satisfy the shared contract', () => {
  const p = provider(fakeTransport({}));
  assert.equal(p.id, 'openai');
  assert.deepEqual([...p.routes].sort(), ['batch-api', 'sync-api']);
  contract().assertProviderCapabilities(p);
  for (const route of ['batch-api', 'sync-api']) {
    const cap = p.capabilities.byRoute[route];
    assert.equal(cap.structured, 'strict', route);
    assert.equal(cap.outputTokenLimit, 'enforced', route);
    assert.equal(cap.pdfNative, true, route);
  }
  const batch = p.capabilities.byRoute['batch-api'];
  assert.ok(Number.isInteger(batch.maxBatchRequests) && batch.maxBatchRequests > 0 && batch.maxBatchRequests <= 10000);
  assert.ok(Number.isInteger(batch.maxBatchBytes) && batch.maxBatchBytes > 0 && batch.maxBatchBytes <= 100000000);
  assert.equal(batch.completionWindowMs, 86400000);
});

test('buildRequest uploads a new PDF once, records it and pins the strict-schema payload', async () => {
  const fake = fakeTransport({ 'UPLOAD user_data': { status: 200, body: FILE_NEW } });
  const cache = fakeCache();
  const p = provider(fake, cache);
  const req = await p.buildRequest('synthesis', item('a'), PLAN);
  const uploads = fake.calls.filter(c => c.op === 'UPLOAD');
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].args[0], 'paper.pdf');
  assert.ok(Buffer.from(uploads[0].args[1] as Buffer).equals(PDF_BYTES), 'the uploaded bytes are the PDF');
  assert.deepEqual(cache.entries.get('openai|acct-fixture|user_data|sha-a'),
    { fileId: 'file-new', sizeBytes: PDF_BYTES.length, uploadedAt: NOW.toISOString() });
  assert.equal(req.provider, 'openai');
  assert.equal(req.route, 'batch-api');
  assert.equal(req.model, 'gpt-5.6-terra');
  assert.equal(req.customId, 'cid_a');
  assert.equal(req.attemptId, 'cid_a.1');
  const body = req.payload as any;
  assert.equal(body.model, 'gpt-5.6-terra');
  assert.equal(body.max_output_tokens, 8192);
  assert.equal(body.instructions, SYSTEM);
  assert.deepEqual(body.text, { format: { type: 'json_schema', name: 'explainer', strict: true, schema: SCHEMA } });
  assert.equal(body.input.length, 1);
  assert.equal(body.input[0].role, 'user');
  const content = body.input[0].content;
  assert.deepEqual(content[0], { type: 'input_file', file_id: 'file-new' });
  assert.deepEqual(content[content.length - 1], { type: 'input_text', text: 'Write the explainer for item a.' });
  const line = JSON.stringify({ custom_id: 'cid_a', method: 'POST', url: '/v1/responses', body });
  assert.equal(req.wireBytes, Buffer.byteLength(line) + 1, 'batch wireBytes counts the JSONL line and its newline');
});

test('a text source sends input_text and a sync request counts its body bytes', async () => {
  const fake = fakeTransport({});
  const req = await provider(fake).buildRequest('repair', item('t', false), PLAN);
  const body = req.payload as any;
  assert.equal(req.route, 'sync-api');
  assert.equal(body.model, 'gpt-5.6-luna');
  assert.equal(body.max_output_tokens, 4096);
  assert.deepEqual(body.input[0].content[0], { type: 'input_text', text: 'Plain source text for t.' });
  assert.equal(req.wireBytes, Buffer.byteLength(JSON.stringify(body)));
  assert.equal(fake.calls.length, 0, 'no upload for a text source');
});

test('the file cache is reused, revalidated and invalidated by the stated rules', async () => {
  const cached = (extra: Record<string, unknown> = {}) => ({
    'openai|acct-fixture|user_data|sha-a': { fileId: 'file-old', sizeBytes: 10, uploadedAt: '2026-10-01T00:00:00.000Z', ...extra },
  });

  const live = fakeTransport({ 'GET /files/file-old': { status: 200, body: { id: 'file-old', object: 'file' } } });
  const reused = await provider(live, fakeCache(cached())).buildRequest('synthesis', item('a'), PLAN);
  assert.deepEqual((reused.payload as any).input[0].content[0], { type: 'input_file', file_id: 'file-old' });
  assert.equal(live.calls.filter(c => c.op === 'UPLOAD').length, 0, 'a live cached file is not re-uploaded');

  const gone = fakeTransport({
    'GET /files/file-old': { status: 404, body: { error: { message: 'No such File object', type: 'invalid_request_error' } } },
    'UPLOAD user_data': { status: 200, body: FILE_NEW },
  });
  const goneCache = fakeCache(cached());
  const fresh = await provider(gone, goneCache).buildRequest('synthesis', item('a'), PLAN);
  assert.deepEqual((fresh.payload as any).input[0].content[0], { type: 'input_file', file_id: 'file-new' });
  assert.ok(goneCache.log.includes('invalidate openai|acct-fixture|user_data|sha-a'), 'a 404 invalidates the entry');
  assert.equal(goneCache.entries.get('openai|acct-fixture|user_data|sha-a').fileId, 'file-new');

  const soon = new Date(NOW.getTime() + HOUR).toISOString();
  const expiring = fakeTransport({
    'GET /files/file-old': { status: 200, body: { id: 'file-old' } },
    'UPLOAD user_data': { status: 200, body: { ...FILE_NEW, expires_at: 1761123600 } },
  });
  const expiringCache = fakeCache(cached({ expiresAt: soon }));
  const batchReq = await provider(expiring, expiringCache).buildRequest('synthesis', item('a'), PLAN);
  assert.deepEqual((batchReq.payload as any).input[0].content[0], { type: 'input_file', file_id: 'file-new' },
    'a file expiring before the 24-hour window plus 5 minutes is replaced for a batch');
  assert.equal(expiringCache.entries.get('openai|acct-fixture|user_data|sha-a').expiresAt, new Date(1761123600 * 1000).toISOString());

  const shortCall = fakeTransport({ 'GET /files/file-old': { status: 200, body: { id: 'file-old' } } });
  const syncReq = await provider(shortCall, fakeCache(cached({ expiresAt: soon }))).buildRequest('repair', item('a'), PLAN);
  assert.deepEqual((syncReq.payload as any).input[0].content[0], { type: 'input_file', file_id: 'file-old' },
    'the same file still covers a sync call whose timeout plus 5 minutes ends before it expires');

  const denied = fakeTransport({ 'GET /files/file-old': { status: 401, body: { error: { message: 'Incorrect API key' } } } });
  await expectCode(() => provider(denied, fakeCache(cached())).buildRequest('synthesis', item('a'), PLAN),
    'HTTP_ERROR', 'an auth failure on revalidation');
  assert.equal(denied.calls.filter(c => c.op === 'UPLOAD').length, 0, 'an auth failure never triggers a re-upload');

  const unscoped = fakeTransport({ 'UPLOAD user_data': { status: 200, body: FILE_NEW } });
  const unscopedCache = fakeCache(cached());
  await provider(unscoped, unscopedCache, { accountScope: null }).buildRequest('synthesis', item('a'), PLAN);
  assert.equal(unscopedCache.log.length, 0, 'with no account scope the cache is neither read nor written');
  assert.equal(unscoped.calls.filter(c => c.op === 'UPLOAD').length, 1);
});

test('sync responses map status, refusal, incompleteness and usage', async () => {
  const stop = await syncResult({ status: 200, body: responseBody() });
  expectValid(stop, 'completed');
  assert.equal(stop.finishReason, 'stop');
  assert.equal(stop.text, '{"title":"ok"}');
  assert.equal(stop.provider, 'openai');
  assert.equal(stop.route, 'sync-api');
  assert.equal(stop.stage, 'repair');
  assert.equal(stop.model, 'gpt-5.6-luna');
  assert.equal(stop.customId, 'cid_s');
  assert.equal(stop.providerRequestId, 'resp_fixture01');
  assert.equal(stop.rawFinishReason, 'completed');
  assert.deepEqual(stop.usage, { in: 1500, out: 250, cacheRead: 400, cacheWrite5m: null, cacheWrite1h: null, source: 'reported' });

  const cases: Array<[string, Record<string, unknown>, string, string, string]> = [
    ['max output', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, 'length', 'OUTPUT_LIMIT', 'incomplete:max_output_tokens'],
    ['content filter', { status: 'incomplete', incomplete_details: { reason: 'content_filter' } }, 'error', 'CONTENT_FILTER', 'incomplete:content_filter'],
    ['other incomplete', { status: 'incomplete', incomplete_details: { reason: 'something_new' } }, 'error', 'INCOMPLETE_RESPONSE', 'incomplete:something_new'],
    ['failed', { status: 'failed', error: { code: 'server_error', message: 'boom' } }, 'error', 'PROVIDER_ERROR', 'failed'],
    ['cancelled', { status: 'cancelled' }, 'error', 'CANCELLED', 'cancelled'],
    ['in progress', { status: 'in_progress' }, 'error', 'UNEXPECTED_FINISH', 'in_progress'],
    ['refusal', { output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'I cannot help.' }] }] }, 'error', 'REFUSAL', 'completed'],
    ['empty', { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '  ', annotations: [] }] }] }, 'error', 'EMPTY_OUTPUT', 'completed'],
  ];
  for (const [label, overrides, finish, code, raw] of cases) {
    const r = await syncResult({ status: 200, body: responseBody(overrides) });
    expectValid(r, label);
    assert.equal(r.finishReason, finish, label);
    assert.equal(r.error.code, code, label);
    assert.equal(r.rawFinishReason, raw, label);
    assert.equal(r.usage.in, 1500, `${label}: usage is kept on failure`);
  }
  const missingStatus = await syncResult({ status: 200, body: responseBody({ status: undefined }) });
  assert.equal(missingStatus.error.code, 'UNEXPECTED_FINISH');
  const failed = await syncResult({ status: 200, body: responseBody({ status: 'failed', error: { code: 'server_error', message: 'boom' } }) });
  assert.equal(failed.error.providerCode, 'server_error');
});

test('HTTP status takes precedence over the response body', async () => {
  for (const [status, retryable] of [[429, true], [500, true], [408, true], [400, false], [403, false]] as const) {
    const r = await syncResult({ status, body: { ...responseBody(), error: { message: `fixture ${status}`, type: 'x', code: null } } });
    expectValid(r, `HTTP ${status}`);
    assert.equal(r.finishReason, 'error', `HTTP ${status}`);
    assert.equal(r.error.code, 'HTTP_ERROR', `HTTP ${status}`);
    assert.equal(r.error.httpStatus, status, `HTTP ${status}`);
    assert.equal(r.error.retryable, retryable, `HTTP ${status} retryable`);
  }
  const network = await syncResult(() => { throw new Error('socket hang up'); });
  assert.equal(network.finishReason, 'error');
  assert.equal(network.error.code, 'PROVIDER_ERROR');
});

test('route-mismatched calls are refused before any transport call', async () => {
  const fake = fakeTransport({ 'UPLOAD user_data': { status: 200, body: FILE_NEW } });
  const p = provider(fake);
  const batchReq = await p.buildRequest('synthesis', item('m'), PLAN);
  const syncReq = await p.buildRequest('repair', item('n', false), PLAN);
  const before = fake.calls.length;
  await expectCode(() => p.complete(batchReq, CTX), 'ROUTE_UNSUPPORTED', 'complete on a batch request');
  await expectCode(() => p.submitBatch([syncReq], CTX), 'ROUTE_UNSUPPORTED', 'submitBatch with a sync request');
  await expectCode(() => p.buildRequest('vision', item('v'), PLAN), 'ROUTE_UNSUPPORTED', 'disabled vision tier');
  assert.equal(fake.calls.length, before, 'no transport call was made');
});

function row(customId: string, statusCode: number | undefined, body: unknown, error: unknown = null): string {
  return JSON.stringify({ id: `batch_req_${customId}`, custom_id: customId,
    response: statusCode === undefined ? null : { status_code: statusCode, request_id: `req_${customId}`, body }, error });
}

test('batches upload JSONL, poll and collect by custom ID in manifest order', async () => {
  const uploaded: string[] = [];
  const output = [
    row('cid_e', 200, responseBody({ id: 'resp_e' })),
    row('cid_a', 200, responseBody({ id: 'resp_a' })),
    row('cid_ghost', 200, responseBody()),
    row('cid_b', 500, responseBody({ id: 'resp_b' })),
    row('cid_f', 200, responseBody({ id: 'resp_f1' })),
    row('cid_f', 200, responseBody({ id: 'resp_f2' })),
    row('cid_g', 200, responseBody({ id: 'resp_g' })),
    row('cid_g', 200, responseBody({ id: 'resp_g' })),
    row('cid_h', undefined, null),
  ].join('\n') + '\n';
  const errors = [
    row('cid_c', 400, { error: { message: 'Invalid schema', type: 'invalid_request_error', param: null, code: null } }),
    row('cid_d', undefined, null, { code: 'batch_expired', message: 'This request could not be executed before the completion window expired.' }),
  ].join('\n') + '\n';
  const fake = fakeTransport({
    'UPLOAD user_data': { status: 200, body: FILE_NEW },
    'UPLOAD batch': (_name: string, bytes: Buffer) => { uploaded.push(Buffer.from(bytes).toString('utf8')); return { status: 200, body: { id: 'file-input', object: 'file', purpose: 'batch' } }; },
    'POST /batches': { status: 200, body: { id: 'batch_01', object: 'batch', endpoint: '/v1/responses', status: 'validating',
      input_file_id: 'file-input', completion_window: '24h', created_at: 1761037200, expires_at: 1761123600,
      request_counts: { total: 8, completed: 0, failed: 0 } } },
    'GET /batches/batch_01': { status: 200, body: { id: 'batch_01', object: 'batch', status: 'completed',
      output_file_id: 'file-out', error_file_id: 'file-err', request_counts: { total: 8, completed: 6, failed: 2 } } },
    'TEXT /files/file-out/content': { status: 200, body: output },
    'TEXT /files/file-err/content': { status: 200, body: errors },
  });
  const p = provider(fake);
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  const reqs = [];
  for (const id of ids) reqs.push(await p.buildRequest('synthesis', item(id), PLAN));
  const handle = await p.submitBatch(reqs, CTX);
  assert.equal(uploaded.length, 1);
  const lines = uploaded[0].split('\n');
  assert.equal(lines.pop(), '', 'the JSONL ends with a newline');
  assert.deepEqual(lines.map(l => JSON.parse(l).custom_id), ids.map(id => `cid_${id}`));
  assert.deepEqual(JSON.parse(lines[0]), { custom_id: 'cid_a', method: 'POST', url: '/v1/responses', body: reqs[0].payload });
  const create = fake.calls.find(c => c.op === 'POST' && c.path === '/batches')!;
  assert.deepEqual(create.args[0], { input_file_id: 'file-input', endpoint: '/v1/responses', completion_window: '24h' });
  assert.equal(handle.provider, 'openai');
  assert.equal(handle.remoteId, 'batch_01');
  assert.equal(handle.submittedAt, new Date(1761037200 * 1000).toISOString());
  assert.equal(handle.expiresAt, new Date(1761123600 * 1000).toISOString());

  const results: any[] = [];
  for await (const r of p.results(handle, CTX)) results.push(r);
  assert.deepEqual(results.map(r => r.customId), ids.map(id => `cid_${id}`), 'one result per request, in manifest order');
  for (const r of results) {
    expectValid(r, r.customId);
    assert.equal(r.route, 'batch-api');
    assert.equal(r.model, 'gpt-5.6-terra');
  }
  const by = Object.fromEntries(results.map(r => [r.customId, r]));
  assert.equal(by.cid_a.finishReason, 'stop');
  assert.equal(by.cid_a.providerRequestId, 'resp_a');
  assert.equal(by.cid_e.finishReason, 'stop');
  assert.equal(by.cid_b.error.code, 'HTTP_ERROR');
  assert.equal(by.cid_b.error.httpStatus, 500);
  assert.equal(by.cid_c.error.code, 'HTTP_ERROR');
  assert.equal(by.cid_c.error.httpStatus, 400);
  assert.equal(by.cid_d.error.code, 'PROVIDER_ERROR');
  assert.equal(by.cid_d.error.providerCode, 'batch_expired');
  assert.equal(by.cid_f.error.code, 'RESULT_CONFLICT', 'contradictory duplicate rows');
  assert.equal(by.cid_g.finishReason, 'stop', 'identical duplicate rows collapse to one result');
  assert.equal(by.cid_h.error.code, 'MALFORMED_RESULT', 'a row with no response and no error');
  assert.equal(by.cid_i.error.code, 'MISSING_RESULT');
  assert.equal(by.cid_i.usage.source, 'unavailable');
});

test('batch status maps lifecycle states and counts; a failed poll throws', async () => {
  const handle = { provider: 'openai', remoteId: 'batch_02', submittedAt: 'x', expiresAt: 'y', requests: [] };
  const cases: Array<[string, string]> = [
    ['validating', 'queued'], ['in_progress', 'running'], ['finalizing', 'running'], ['cancelling', 'running'],
    ['completed', 'completed'], ['failed', 'failed'], ['cancelled', 'cancelled'], ['expired', 'expired'],
  ];
  for (const [status, expected] of cases) {
    const fake = fakeTransport({ 'GET /batches/batch_02': { status: 200, body: { id: 'batch_02', status,
      request_counts: { total: 10, completed: 6, failed: 1 } } } });
    const snapshot = await provider(fake).getBatch(handle, CTX);
    assert.equal(snapshot.status, expected, status);
    assert.deepEqual(snapshot.counts, { pending: 3, succeeded: 6, failed: 1 }, status);
  }
  const broken = fakeTransport({ 'GET /batches/batch_02': { status: 503, body: { error: { message: 'unavailable' } } } });
  await expectCode(() => provider(broken).getBatch(handle, CTX), 'HTTP_ERROR', 'a failed poll');
});

test('no lanes, no auth-file key discovery, no environment reads, no saving', () => {
  const source = fs.readFileSync(MODULE, 'utf8');
  const specifiers = [...source.matchAll(/(?:from\s+|require\()\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  assert.ok(specifiers.length > 0, 'the module has imports');
  for (const banned of ['../output', '../batch', '../repair', '../quality', '../state', '../index']) {
    assert.ok(!specifiers.includes(banned), `src/providers/openai-api.ts must not import ${banned}`);
  }
  assert.ok(!/process\.env/.test(source), 'the adapter reads no environment variables');
  assert.ok(!/\.codex|auth\.json/.test(source), 'the adapter never looks for a Codex auth file');
  assert.ok(!/\blanes?\b/i.test(source), 'the adapter has no lane support');
});
// AUTOMETTA-CONTRACT-END

test.after(() => {
  fs.rmSync(SOURCE_ROOT, { recursive: true, force: true });
});
