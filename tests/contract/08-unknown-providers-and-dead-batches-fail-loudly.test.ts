// Contract test for stage-cards/08-unknown-providers-and-dead-batches-fail-loudly.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/08-unknown-providers-and-dead-batches-fail-loudly.test.ts
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-08-'));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/08-unknown-providers-and-dead-batches-fail-loudly.md
Object.assign(process.env, {
  EXPLAINER_STATE_FILE: path.join(TMP, 'state.json'),
  EXPLAINER_INPUT_DIR: path.join(TMP, 'input'),
  EXPLAINER_OUTPUT_DIR: path.join(TMP, 'output'),
  EXPLAINER_OBSIDIAN_DIR: '',
  EXPLAINER_JOBS_DIR: path.join(TMP, 'jobs'),
  WEBSITE_REPO: '',
  OPENAI_API_KEY: 'contract-test-not-a-key',
});
delete process.env.PROVIDER;

let fetchStatus = 404;
globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: 'stub' } }), { status: fetchStatus })) as typeof fetch;

const providers = require('../../src/providers') as Record<string, any>;
const state = require('../../src/state') as typeof import('../../src/state');
const batch = require('../../src/batch') as Record<string, any>;

function withEnvProvider<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.PROVIDER;
  if (value === undefined) delete process.env.PROVIDER;
  else process.env.PROVIDER = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.PROVIDER;
    else process.env.PROVIDER = prev;
  }
}

test('the known providers are listed once', () => {
  assert.deepEqual([...providers.PROVIDER_NAMES], ['claude', 'openai']);
});

test('an unknown --provider throws and names the value', () => {
  withEnvProvider(undefined, () => {
    assert.throws(() => providers.getProviderFromArgs(['--provider', 'gemini']), /gemini/);
    assert.throws(() => providers.getProviderFromArgs(['--provider', 'claud']), /claud/);
  });
});

test('an unknown PROVIDER env value throws', () => {
  withEnvProvider('gemini', () => {
    assert.throws(() => providers.getProviderFromArgs([]), /gemini/);
  });
});

test('known providers still resolve, case-insensitively, with claude as the default', () => {
  withEnvProvider(undefined, () => {
    assert.equal(providers.getProviderFromArgs(['--provider', 'openai']), 'openai');
    assert.equal(providers.getProviderFromArgs(['--provider', 'OpenAI']), 'openai');
    assert.equal(providers.getProviderFromArgs(['--provider', 'claude']), 'claude');
    assert.equal(providers.getProviderFromArgs([]), 'claude');
  });
});

function batchState(id: string, provider: 'claude' | 'openai', status: 'processing' | 'ended') {
  return { id, provider, model: 'm', submitted_at: '2026-10-19T00:00:00.000Z', status, requests: {} };
}

test('the pending lookup skips local sync_* runs', () => {
  const s = {
    batches: [
      batchState('msgbatch_api', 'claude', 'processing'),
      batchState('sync_claude_1760000000000', 'claude', 'processing'),
      batchState('batch_openai_api', 'openai', 'processing'),
      batchState('sync_openai_1760000000001', 'openai', 'processing'),
    ],
  };
  assert.equal(state.getLatestPendingBatchByProvider(s as never, 'claude')?.id, 'msgbatch_api');
  assert.equal(state.getLatestPendingBatchByProvider(s as never, 'openai')?.id, 'batch_openai_api');
  const onlySync = { batches: [batchState('sync_claude_1760000000002', 'claude', 'processing')] };
  assert.equal(state.getLatestPendingBatchByProvider(onlySync as never, 'claude'), undefined);
});

function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

test('isFatalHttpError: 4xx except 408 and 429 is fatal; 5xx, 408, 429 and network errors are not', () => {
  assert.equal(typeof providers.isFatalHttpError, 'function', 'src/providers.ts must export isFatalHttpError');
  for (const s of [400, 401, 403, 404]) assert.equal(providers.isFatalHttpError(httpError(s)), true, `status ${s}`);
  for (const s of [408, 429, 500, 502, 503]) assert.equal(providers.isFatalHttpError(httpError(s)), false, `status ${s}`);
  assert.equal(providers.isFatalHttpError(new Error('ECONNRESET')), false);
});

test('isFatalHttpError recognises an OpenAIProvider 404 and not its 503', async () => {
  const p = new providers.OpenAIProvider();
  fetchStatus = 404;
  const notFound = await p.retrieveBatch('batch_gone').then(() => null, (e: unknown) => e);
  assert.ok(notFound instanceof Error, 'retrieveBatch did not reject on 404');
  assert.equal(providers.isFatalHttpError(notFound), true);
  fetchStatus = 503;
  const unavailable = await p.retrieveBatch('batch_busy').then(() => null, (e: unknown) => e);
  assert.ok(unavailable instanceof Error, 'retrieveBatch did not reject on 503');
  assert.equal(providers.isFatalHttpError(unavailable), false);
});

test('pollUntilEnded stops at once on a 404', async () => {
  assert.equal(typeof batch.pollUntilEnded, 'function', 'src/batch.ts must export pollUntilEnded');
  let calls = 0;
  let settled: { error: unknown } | null = null;
  // Mocked timers: a retry backoff never fires and never holds the process open.
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const poll: Promise<unknown> = batch.pollUntilEnded('batch', 0, async () => {
      calls += 1;
      throw httpError(404);
    });
    poll.then(() => { settled = { error: null }; }, (error: unknown) => { settled = { error }; });
    for (let i = 0; i < 50 && !settled; i += 1) await new Promise((r) => setImmediate(r));
  } finally {
    mock.timers.reset();
  }
  assert.ok(settled, 'pollUntilEnded kept retrying a 404');
  assert.ok((settled as { error: unknown }).error instanceof Error, 'pollUntilEnded resolved on a 404');
  assert.match(String(((settled as { error: unknown }).error as Error).message), /404/);
  assert.equal(calls, 1);
});
// AUTOMETTA-CONTRACT-END
