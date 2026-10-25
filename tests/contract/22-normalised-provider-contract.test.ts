// Contract test for stage-cards/22-normalised-provider-contract.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/22-normalised-provider-contract.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/22-normalised-provider-contract.md
globalThis.fetch = (async () => {
  throw new Error('network access is forbidden in contract test 22');
}) as typeof fetch;

function load(): Record<string, any> {
  const file = path.join(REPO_ROOT, 'src', 'llm-contract.ts');
  assert.ok(fs.existsSync(file), 'src/llm-contract.ts must exist');
  return require('../../src/llm-contract') as Record<string, any>;
}

const NAMED_CODES = [
  'ROUTE_UNSUPPORTED', 'PROVIDER_ERROR', 'BATCH_EXPIRED', 'CANCELLED', 'MISSING_RESULT',
  'UNEXPECTED_TOOL', 'OUTPUT_LIMIT', 'REFUSAL', 'UNEXPECTED_FINISH', 'HTTP_ERROR',
  'MALFORMED_RESULT', 'CONTENT_FILTER', 'INCOMPLETE_RESPONSE', 'SDK_EXECUTION', 'TURN_LIMIT',
  'BUDGET_LIMIT', 'STRUCTURED_OUTPUT_RETRIES', 'CLI_EXIT', 'TIMEOUT', 'CLI_FAILURE',
  'MISSING_OUTPUT', 'EMPTY_OUTPUT', 'RESULT_CONFLICT', 'CUSTOM_ID_COLLISION', 'INVALID_CAPABILITIES',
  'INVALID_ROUTE_PREFERENCE', 'UNKNOWN_PROVIDER', 'PROVIDER_DISABLED', 'CLAUDE_OAUTH_WRONG_SURFACE',
  'MIXED_BILLING_CREDENTIALS', 'CODEX_AUTH_NOT_SUBSCRIPTION', 'MISSING_ROUTE_CREDENTIAL',
  'NO_USABLE_ROUTE', 'MODEL_ROUTE_UNSUPPORTED', 'MODEL_PROVIDER_MISMATCH', 'UNKNOWN_MODEL',
  'CONFLICTING_ROUTE_FLAGS', 'CONFLICTING_MODEL_OVERRIDE', 'RUN_PROVIDER_MISMATCH',
  'LOCAL_RUN_REQUIRES_RESUME', 'REGISTRY_INVALID', 'REGISTRY_NOT_FOUND', 'REGISTRY_UNAVAILABLE',
  'PRICE_REVIEW_DUE', 'STATE_CORRUPT', 'STATE_VERSION_UNSUPPORTED', 'STATE_BUSY', 'OUTPUT_COLLISION',
];

const USAGE = { in: 1200, out: 340, cacheRead: 0, cacheWrite5m: null, cacheWrite1h: null, source: 'reported' };

function base(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    provider: 'claude', route: 'batch-api', stage: 'synthesis', model: 'claude-opus-4-8',
    customId: 'k_abc', attemptId: 'k_abc.1', usage: { ...USAGE }, ...extra,
  };
}

function expectCode(fn: () => unknown, code: string, label: string): void {
  let thrown: any;
  try { fn(); } catch (error) { thrown = error; }
  assert.ok(thrown, `${label}: expected an error with code ${code}, nothing was thrown`);
  assert.equal(thrown.code, code, `${label}: expected code ${code}, got ${thrown && thrown.code} (${thrown && thrown.message})`);
}

test('every error code the provider design names is exported once, with a typed error class', () => {
  const mod = load();
  assert.ok(Array.isArray(mod.ERROR_CODES) || typeof mod.ERROR_CODES === 'object', 'ERROR_CODES must be exported');
  const codes: string[] = Array.isArray(mod.ERROR_CODES) ? mod.ERROR_CODES : Object.values(mod.ERROR_CODES);
  for (const code of NAMED_CODES) assert.ok(codes.includes(code), `ERROR_CODES lacks ${code}`);
  assert.equal(new Set(codes).size, codes.length, 'ERROR_CODES has duplicates');
  assert.equal(typeof mod.LlmContractError, 'function', 'LlmContractError must be exported');
  const err = new mod.LlmContractError('ROUTE_UNSUPPORTED', 'no batch here');
  assert.ok(err instanceof Error);
  assert.equal(err.code, 'ROUTE_UNSUPPORTED');
  assert.match(err.message, /no batch here/);
});

test('a complete stop result passes through unchanged, usage and identity intact', () => {
  const { checkResult } = load();
  const input = base({ finishReason: 'stop', text: '{"ok":true}', providerRequestId: 'req_1', rawFinishReason: 'end_turn' });
  const out = checkResult(input);
  assert.equal(out.finishReason, 'stop');
  assert.equal(out.text, '{"ok":true}');
  assert.equal(out.error, undefined);
  assert.deepEqual(out.usage, USAGE);
  assert.equal(out.providerRequestId, 'req_1');
  assert.equal(out.rawFinishReason, 'end_turn');
  for (const key of ['provider', 'route', 'stage', 'model', 'customId', 'attemptId']) {
    assert.equal(out[key], input[key], `${key} must be preserved`);
  }
});

test('stop with missing, empty or whitespace text becomes EMPTY_OUTPUT and keeps its usage', () => {
  const { checkResult } = load();
  for (const text of [undefined, '', '  \n ']) {
    const input = base({ finishReason: 'stop' });
    if (text !== undefined) input.text = text;
    const out = checkResult(input);
    assert.equal(out.finishReason, 'error', `text ${JSON.stringify(text)} must not stay stop`);
    assert.equal(out.error.code, 'EMPTY_OUTPUT');
    assert.equal(out.error.retryable, false);
    assert.deepEqual(out.usage, USAGE, 'failed-call usage must be preserved');
  }
});

test('stop that also carries an error is contradictory and becomes MALFORMED_RESULT, text kept', () => {
  const { checkResult } = load();
  const out = checkResult(base({
    finishReason: 'stop', text: 'partial',
    error: { code: 'PROVIDER_ERROR', message: 'x', retryable: true },
  }));
  assert.equal(out.finishReason, 'error');
  assert.equal(out.error.code, 'MALFORMED_RESULT');
  assert.equal(out.text, 'partial');
  assert.deepEqual(out.usage, USAGE);
});

test('length and error results keep a valid error, text and usage; a missing or unknown-code error becomes MALFORMED_RESULT', () => {
  const { checkResult } = load();
  const truncated = checkResult(base({
    finishReason: 'length', text: '{"half":',
    error: { code: 'OUTPUT_LIMIT', message: 'max_tokens', retryable: false },
  }));
  assert.equal(truncated.finishReason, 'length');
  assert.equal(truncated.error.code, 'OUTPUT_LIMIT');
  assert.equal(truncated.text, '{"half":');
  assert.deepEqual(truncated.usage, USAGE);

  const failed = checkResult(base({
    finishReason: 'error', error: { code: 'HTTP_ERROR', message: '500', retryable: true, httpStatus: 500 },
  }));
  assert.equal(failed.finishReason, 'error');
  assert.equal(failed.error.code, 'HTTP_ERROR');
  assert.equal(failed.error.httpStatus, 500);
  assert.equal(failed.error.retryable, true);

  for (const [label, error] of [
    ['missing error', undefined],
    ['unknown code', { code: 'SOMETHING_NEW', message: 'x', retryable: false }],
    ['non-boolean retryable', { code: 'PROVIDER_ERROR', message: 'x', retryable: 'yes' }],
  ] as const) {
    for (const finishReason of ['length', 'error']) {
      const input = base({ finishReason });
      if (error !== undefined) input.error = error;
      const out = checkResult(input);
      assert.equal(out.finishReason, finishReason, `${label}/${finishReason}: finish reason kept`);
      assert.equal(out.error.code, 'MALFORMED_RESULT', `${label}/${finishReason}`);
      assert.equal(out.error.retryable, false);
      assert.deepEqual(out.usage, USAGE);
    }
  }
});

test('an unknown or missing finish reason fails closed as UNEXPECTED_FINISH, recording the raw value', () => {
  const { checkResult } = load();
  const out = checkResult(base({ finishReason: 'pause_turn', text: 'hello' }));
  assert.equal(out.finishReason, 'error');
  assert.equal(out.error.code, 'UNEXPECTED_FINISH');
  assert.equal(out.rawFinishReason, 'pause_turn');
  assert.equal(out.text, 'hello');
  assert.deepEqual(out.usage, USAGE);

  const kept = checkResult(base({ finishReason: 'succeeded', rawFinishReason: 'vendor_ok' }));
  assert.equal(kept.error.code, 'UNEXPECTED_FINISH');
  assert.equal(kept.rawFinishReason, 'vendor_ok', 'an existing rawFinishReason is not overwritten');

  const missing = checkResult(base({ text: 'no reason' }));
  assert.equal(missing.finishReason, 'error');
  assert.equal(missing.error.code, 'UNEXPECTED_FINISH');
});

test('invalid usage is replaced by an all-null unavailable record, never dropped or zeroed', () => {
  const { checkResult } = load();
  for (const usage of [undefined, { in: -1, out: 2 }, { in: 1.5, out: 2, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, source: 'reported' }, { ...USAGE, source: 'guessed' }]) {
    const input = base({ finishReason: 'stop', text: 'ok' });
    if (usage === undefined) delete input.usage; else input.usage = usage;
    const out = checkResult(input);
    assert.deepEqual(out.usage, { in: null, out: null, cacheRead: null, cacheWrite5m: null, cacheWrite1h: null, source: 'unavailable' });
    assert.equal(out.finishReason, 'stop', 'bad usage alone does not fail the result');
  }
  const partial = { in: 10, out: null, cacheRead: null, cacheWrite5m: null, cacheWrite1h: null, source: 'partial' };
  assert.deepEqual(checkResult(base({ finishReason: 'stop', text: 'ok', usage: partial })).usage, partial);
});

test('a result with missing or invalid identity is rejected with MALFORMED_RESULT', () => {
  const { checkResult } = load();
  const good = base({ finishReason: 'stop', text: 'ok' });
  assert.doesNotThrow(() => checkResult(good));
  const cases: Array<[string, Record<string, unknown>]> = [
    ['provider', { provider: 'mistral' }],
    ['route', { route: 'lane' }],
    ['stage', { stage: 'lane' }],
    ['model', { model: '' }],
    ['customId', { customId: undefined }],
    ['attemptId', { attemptId: 7 }],
  ];
  for (const [label, patch] of cases) {
    expectCode(() => checkResult({ ...good, ...patch }), 'MALFORMED_RESULT', `bad ${label}`);
  }
  expectCode(() => checkResult(null), 'MALFORMED_RESULT', 'null');
  expectCode(() => checkResult('text'), 'MALFORMED_RESULT', 'string');
});

test('checkResult never mutates its input', () => {
  const { checkResult } = load();
  const input = base({ finishReason: 'stop', text: '' });
  const before = JSON.stringify(input);
  checkResult(input);
  assert.equal(JSON.stringify(input), before);
});

test('provider capabilities must declare exactly the routes they support, with consistent flags', () => {
  const { assertProviderCapabilities, assertRouteSupported } = load();
  const route = (extra: Record<string, unknown> = {}) => ({
    structured: 'strict', schemaEvidence: 'fixture', vision: true, pdfNative: true,
    batch: false, subscription: false, outputTokenLimit: 'enforced', ...extra,
  });
  const good = {
    id: 'openai', routes: ['batch-api', 'sync-api', 'subscription-cli'],
    capabilities: { byRoute: {
      'batch-api': route({ batch: true, maxBatchRequests: 10000 }),
      'sync-api': route(),
      'subscription-cli': route({ subscription: true, structured: 'tool', schemaEvidence: 'unverified', outputTokenLimit: 'advisory' }),
    } },
  };
  assert.doesNotThrow(() => assertProviderCapabilities(good));
  const broken: Array<[string, any]> = [
    ['route listed without capabilities', { ...good, capabilities: { byRoute: { 'batch-api': good.capabilities.byRoute['batch-api'] } } }],
    ['capabilities for an unlisted route', { ...good, routes: ['batch-api', 'sync-api'] }],
    ['batch route without batch flag', { ...good, capabilities: { byRoute: { ...good.capabilities.byRoute, 'batch-api': route() } } }],
    ['subscription route without subscription flag', { ...good, capabilities: { byRoute: { ...good.capabilities.byRoute, 'subscription-cli': route() } } }],
    ['unknown structured value', { ...good, capabilities: { byRoute: { ...good.capabilities.byRoute, 'sync-api': route({ structured: 'json' }) } } }],
    ['unknown route name', { ...good, routes: [...good.routes, 'lane'], capabilities: { byRoute: { ...good.capabilities.byRoute, lane: route() } } }],
    ['unknown provider', { ...good, id: 'mistral' }],
  ];
  for (const [label, provider] of broken) {
    expectCode(() => assertProviderCapabilities(provider), 'INVALID_CAPABILITIES', label);
  }
  assert.doesNotThrow(() => assertRouteSupported(good, 'sync-api'));
  expectCode(() => assertRouteSupported({ ...good, routes: ['sync-api'] }, 'batch-api'), 'ROUTE_UNSUPPORTED', 'unsupported route');
});

test('the logical request key, attempt ids and custom ids follow the manifest identity rules', () => {
  const { requestKey, attemptIdFor, customIdFor } = load();
  const parts = { runId: 'run-1', sourceDigest: 'sha256:aa', planDigest: 'sha256:bb', schemaDigest: 'sha256:cc', stage: 'synthesis' };
  const key = requestKey(parts);
  assert.equal(typeof key, 'string');
  assert.ok(key.length > 0);
  assert.equal(requestKey({ ...parts }), key, 'deterministic');
  for (const field of Object.keys(parts)) {
    const changed = { ...parts, [field]: field === 'stage' ? 'repair' : 'other' };
    assert.notEqual(requestKey(changed), key, `${field} must be part of the key`);
  }
  assert.notEqual(requestKey({ ...parts, runId: 'run-1|x', sourceDigest: 'y' }), requestKey({ ...parts, runId: 'run-1', sourceDigest: 'x|y' }), 'field boundaries must not alias');

  const a1 = attemptIdFor(key, 1);
  const a2 = attemptIdFor(key, 2);
  assert.equal(typeof a1, 'string');
  assert.notEqual(a1, a2);
  assert.equal(attemptIdFor(key, 1), a1, 'deterministic');
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => attemptIdFor(key, bad), `attempt number ${bad} must be rejected`);
  }

  const ids = new Set<string>();
  for (let i = 0; i < 500; i += 1) {
    const id = customIdFor(requestKey({ ...parts, runId: `run-${i}` }));
    assert.match(id, /^[A-Za-z0-9_-]{1,64}$/, `custom id ${id} must fit both providers' custom_id rules`);
    ids.add(id);
  }
  assert.equal(ids.size, 500, 'distinct keys give distinct custom ids');
  assert.equal(customIdFor(key), customIdFor(key), 'deterministic');
});

test('custom ids are checked for collisions against the persisted manifest', () => {
  const { requestKey, customIdFor, assertNoCustomIdCollision } = load();
  const key = requestKey({ runId: 'r', sourceDigest: 's', planDigest: 'p', schemaDigest: 'c', stage: 'repair' });
  const id = customIdFor(key);
  assert.doesNotThrow(() => assertNoCustomIdCollision({}, id, key));
  assert.doesNotThrow(() => assertNoCustomIdCollision({ [id]: key }, id, key), 'the same key again is not a collision');
  expectCode(() => assertNoCustomIdCollision({ [id]: 'some-other-key' }, id, key), 'CUSTOM_ID_COLLISION', 'collision');
});

test('re-collection is idempotent on (runId, customId, attemptId) plus the receipt digest', () => {
  const { checkResult, resultDigest, reconcileResult } = load();
  const r1 = checkResult(base({ finishReason: 'stop', text: '{"a":1}' }));
  const same = checkResult(base({ finishReason: 'stop', text: '{"a":1}' }));
  const other = checkResult(base({ finishReason: 'stop', text: '{"a":2}' }));
  const nextAttempt = checkResult(base({ finishReason: 'stop', text: '{"a":2}', attemptId: 'k_abc.2' }));
  assert.match(String(resultDigest(r1)), /\S{16,}/);
  assert.equal(resultDigest(r1), resultDigest(same));
  assert.notEqual(resultDigest(r1), resultDigest(other));
  assert.equal(reconcileResult('run-1', undefined, r1), 'new');
  assert.equal(reconcileResult('run-1', { runId: 'run-1', customId: r1.customId, attemptId: r1.attemptId, digest: resultDigest(r1) }, same), 'duplicate');
  expectCode(
    () => reconcileResult('run-1', { runId: 'run-1', customId: r1.customId, attemptId: r1.attemptId, digest: resultDigest(r1) }, other),
    'RESULT_CONFLICT',
    'contradictory duplicate',
  );
  assert.equal(reconcileResult('run-1', { runId: 'run-1', customId: r1.customId, attemptId: r1.attemptId, digest: resultDigest(r1) }, nextAttempt), 'new', 'a new attempt is not a duplicate');
  assert.equal(reconcileResult('run-2', { runId: 'run-1', customId: r1.customId, attemptId: r1.attemptId, digest: resultDigest(r1) }, other), 'new', 'another run is not a duplicate');
});

test('the contract module stays transport-free: no SDK, network, process or filesystem imports', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'src', 'llm-contract.ts'), 'utf8');
  const specifiers = [...source.matchAll(/(?:\bfrom\s*|\brequire\(\s*|\bimport\(\s*)['"]([^'"]+)['"]/g)].map(m => m[1]);
  for (const spec of specifiers) {
    assert.ok(['crypto', 'node:crypto'].includes(spec), `src/llm-contract.ts may import only crypto, found ${spec}`);
  }
  assert.ok(!source.includes('process.env'), 'src/llm-contract.ts must not read process.env');
  for (const typeName of ['ProviderId', 'Route', 'ImmediateRoute', 'Stage', 'SchemaRef', 'RouteCapabilities', 'ProviderCapabilities', 'SourceSnapshot', 'PreparedItem', 'ProviderRequest', 'CallContext', 'BatchHandle', 'BatchSnapshot', 'TokenUsage', 'NormalizedError', 'NormalizedResult', 'LlmProvider', 'StageBinding', 'RunPlan']) {
    assert.match(source, new RegExp(`export (type|interface) ${typeName}\\b`), `${typeName} must be exported`);
  }
});
// AUTOMETTA-CONTRACT-END
