import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenAiApiProvider } from '../../src/providers/openai-api';
import type { OpenAiTransport, OpenAiFileCache, OpenAiApiOptions } from '../../src/providers/openai-api';
import { checkResult } from '../../src/llm-contract';
import type { PreparedItem, RunPlan } from '../../src/llm-contract';
import type { FileCacheEntry } from '../../src/state-v2';

const schema = { type: 'object', properties: {}, additionalProperties: false, required: [] };
const ref = { id: 'fixture', version: 1, digest: 'fixture' };
const tier = { provider: 'openai' as const, model: 'fixture-model', maxOutputTokens: 512 };
const plan: RunPlan = {
  version: 1, provider: 'openai', route: 'batch-api', strategy: 'single-pass',
  tiers: { synthesis: { ...tier, route: 'batch-api' }, repair: { ...tier, route: 'sync-api' }, vision: null },
  schema: ref, registryDigest: 'fixture', policyDigest: 'fixture', maxRepairAttempts: 1,
  concurrency: 1, callTimeoutMs: { synthesis: 1000, repair: 1000, vision: 1000 }, activeWallClockLimitMs: 10000,
};
const ctx = { signal: new AbortController().signal, deadline: '2026-10-22T00:00:00Z' };
const item = (id = 'a'): PreparedItem => ({
  itemId: id, customId: id, attemptId: `${id}.1`, instruction: 'Write an explainer.',
  schema: ref, source: { digest: 'source', text: 'Full source text.', images: [] },
});
const completed = (text: string) => ({
  id: 'response-fixture', status: 'completed',
  output: [{ type: 'reasoning', content: [{ type: 'output_text', text: 'ignored' }] },
    { type: 'message', content: [{ type: 'output_text', text }] }],
  usage: { input_tokens: 20, output_tokens: 5, input_tokens_details: { cached_tokens: 3 } },
});
const unexpected = async (): Promise<never> => { throw new Error('Unexpected transport call'); };
function fake(overrides: Partial<OpenAiTransport> = {}): OpenAiTransport {
  return { request: unexpected, text: unexpected, upload: unexpected, ...overrides };
}
function cache(): OpenAiFileCache {
  return { get: () => undefined, put: () => {}, invalidate: () => {} };
}
function options(transport: OpenAiTransport): OpenAiApiOptions {
  return {
    binding: { provider: 'openai', route: 'batch-api', surface: 'openai-api', credentialKind: 'openai-api-key',
      credential: () => { throw new Error('Injected transport must not read credentials'); } },
    transport, fileCache: cache(), accountScope: 'fixture', sourceRoot: '.',
    schemaFor: () => schema, systemPrompt: stage => `System ${stage}`,
    now: () => new Date('2026-10-21T00:00:00Z'),
  };
}

test('OpenAI strict request preserves source, image labels and byte accounting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openai-images-'));
  try {
    await writeFile(join(root, 'first.png'), Buffer.from([1, 2]));
    await writeFile(join(root, 'second.jpg'), Buffer.from([3, 4]));
    const p = createOpenAiApiProvider({ ...options(fake()), sourceRoot: root });
    const input = item();
    input.source.images = [
      { relativePath: 'first.png', label: 'First figure', sha256: 'one' },
      { relativePath: 'second.jpg', label: 'Second figure', sha256: 'two' },
    ];
    const req = await p.buildRequest('synthesis', input, plan);
    assert.deepEqual(req.payload, {
      model: tier.model, max_output_tokens: 512, instructions: 'System synthesis',
      input: [{ role: 'user', content: [
        { type: 'input_text', text: 'Full source text.' },
        { type: 'input_text', text: 'First figure' },
        { type: 'input_image', image_url: 'data:image/png;base64,AQI=' },
        { type: 'input_text', text: 'Second figure' },
        { type: 'input_image', image_url: 'data:image/jpeg;base64,AwQ=' },
        { type: 'input_text', text: input.instruction },
      ] }], text: { format: { type: 'json_schema', name: 'explainer', strict: true, schema } },
    });
    assert.equal(req.wireBytes, Buffer.byteLength(JSON.stringify({
      custom_id: 'a', method: 'POST', url: '/v1/responses', body: req.payload,
    })) + 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('OpenAI collects shuffled rows from both files and ignores invalid JSON', async () => {
  const row = (id: string) => ({ custom_id: id, response: { status_code: 200, body: completed(id) }, error: null });
  const p = createOpenAiApiProvider(options(fake({
    request: async () => ({ status: 200, body: { output_file_id: 'out', error_file_id: 'err' } }),
    text: async path => ({ status: 200, body: path.includes('/out/')
      ? `${JSON.stringify(row('b'))}\ninvalid JSON\n${JSON.stringify({ response: {} })}\n`
      : `${JSON.stringify(row('a'))}\n` }),
  })));
  const requests = await Promise.all(['a', 'b'].map(id => p.buildRequest('synthesis', item(id), plan)));
  const results = [];
  for await (const result of p.results({ provider: 'openai', remoteId: 'batch', submittedAt: '', expiresAt: '', requests }, ctx)) {
    assert.deepEqual(checkResult(result), result);
    results.push(result);
  }
  assert.deepEqual(results.map(result => [result.customId, result.text]), [['a', 'a'], ['b', 'b']]);
});

test('OpenAI HTTP 429 overrides a completed body and retains usage', async () => {
  const p = createOpenAiApiProvider(options(fake({ request: async () => ({ status: 429, body: completed('text') }) })));
  const req = await p.buildRequest('repair', item(), plan);
  const result = await p.complete({ ...req, route: 'sync-api' }, ctx);
  assert.equal(result.finishReason, 'error');
  assert.equal(result.error?.code, 'HTTP_ERROR');
  assert.equal(result.error?.httpStatus, 429);
  assert.equal(result.error?.retryable, true);
  assert.equal(result.usage.in, 20);
  assert.deepEqual(checkResult(result), result);
});

test('OpenAI incomplete response preserves all message text and output usage', async () => {
  const body = { ...completed('first'), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } };
  body.output.push({ type: 'message', content: [{ type: 'output_text', text: 'second' }] });
  const p = createOpenAiApiProvider(options(fake({ request: async () => ({ status: 200, body }) })));
  const req = await p.buildRequest('repair', item(), plan);
  const result = await p.complete({ ...req, route: 'sync-api' }, ctx);
  assert.equal(result.finishReason, 'length');
  assert.equal(result.error?.code, 'OUTPUT_LIMIT');
  assert.equal(result.rawFinishReason, 'incomplete:max_output_tokens');
  assert.equal(result.text, 'first\nsecond');
  assert.equal(result.usage.out, 5);
  assert.deepEqual(checkResult(result), result);
});

test('OpenAI 404 invalidates the scoped PDF cache before uploading replacement bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openai-cache-'));
  try {
    const bytes = Buffer.from('%PDF fixture');
    await writeFile(join(root, 'source.pdf'), bytes);
    const events: string[] = [];
    let stored: FileCacheEntry | undefined;
    const fileCache: OpenAiFileCache = {
      get: (...key) => { assert.deepEqual(key, ['openai', 'fixture', 'user_data', 'pdf-hash']);
        events.push('get'); return { fileId: 'old', sizeBytes: 1, uploadedAt: '2026-01-01' }; },
      invalidate: () => { events.push('invalidate'); },
      put: (_provider, _scope, _purpose, _sha, entry) => { events.push('put'); stored = entry; },
    };
    const p = createOpenAiApiProvider({ ...options(fake({
      request: async (method, path) => { assert.equal(method, 'GET'); assert.equal(path, '/files/old');
        events.push('verify'); return { status: 404, body: null }; },
      upload: async (purpose, filename, uploaded) => {
        assert.equal(purpose, 'user_data'); assert.equal(filename, 'source.pdf'); assert.deepEqual(uploaded, bytes);
        events.push('upload'); return { status: 200, body: { id: 'new' } };
      },
    })), sourceRoot: root, fileCache });
    const input = item();
    input.source.pdf = { relativePath: 'source.pdf', sha256: 'pdf-hash' };
    await p.buildRequest('synthesis', input, plan);
    assert.deepEqual(events, ['get', 'verify', 'invalidate', 'upload', 'put']);
    assert.deepEqual(stored, { fileId: 'new', sizeBytes: bytes.length, uploadedAt: '2026-10-21T00:00:00.000Z' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('OpenAI default transport reads the bound credential and passes the call signal', async () => {
  const original = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = (async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer fixture-only');
    assert.equal(init?.signal, ctx.signal);
    return { status: 200, json: async () => completed('ok') } as Response;
  }) as typeof fetch;
  try {
    const opts = options(fake());
    delete opts.transport;
    opts.binding = { ...opts.binding, credential: () => { reads++; return 'fixture-only'; } };
    const p = createOpenAiApiProvider(opts);
    const req = await p.buildRequest('repair', item(), plan);
    assert.equal(reads, 0);
    assert.equal((await p.complete({ ...req, route: 'sync-api' }, ctx)).finishReason, 'stop');
    assert.equal(reads, 1);
  } finally { globalThis.fetch = original; }
});

test('OpenAI batch transport exceptions throw HTTP_ERROR for the polling policy', async () => {
  const p = createOpenAiApiProvider(options(fake({
    request: async () => { throw new Error('socket closed'); },
    upload: async () => { throw new Error('upload disconnected'); },
  })));
  const handle = { provider: 'openai' as const, remoteId: 'batch', submittedAt: '', expiresAt: '', requests: [] };
  await assert.rejects(p.getBatch(handle, ctx), { code: 'HTTP_ERROR' });
  await assert.rejects(p.results(handle, ctx)[Symbol.asyncIterator]().next(), { code: 'HTTP_ERROR' });
  const req = await p.buildRequest('synthesis', item(), plan);
  await assert.rejects(p.submitBatch([req], ctx), { code: 'HTTP_ERROR' });
});
