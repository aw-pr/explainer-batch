import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkResult, resultDigest,
  type NormalizedResult, type TokenUsage,
} from '../../src/llm-contract';

const usage: TokenUsage = {
  in: 1200, out: 340, cacheRead: 0, cacheWrite5m: null, cacheWrite1h: null,
  source: 'reported',
};

function candidate(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: 'claude', route: 'batch-api', stage: 'synthesis', model: 'test-model',
    customId: 'request_1', attemptId: 'request_1.1', usage: { ...usage },
    finishReason: 'stop', text: '{"ok":true}', ...patch,
  };
}

const terminalFixtures: Array<{
  name: string;
  patch: Record<string, unknown>;
  finishReason: NormalizedResult['finishReason'];
  errorCode?: string;
  expectedUsage?: TokenUsage;
}> = [
  { name: 'stop', patch: { rawFinishReason: 'end_turn' }, finishReason: 'stop' },
  { name: 'empty stop', patch: { text: ' \n ' }, finishReason: 'error', errorCode: 'EMPTY_OUTPUT' },
  {
    name: 'length',
    patch: { finishReason: 'length', text: '{"half":', error: { code: 'OUTPUT_LIMIT', message: 'max_tokens', retryable: false } },
    finishReason: 'length', errorCode: 'OUTPUT_LIMIT',
  },
  {
    name: 'error',
    patch: { finishReason: 'error', error: { code: 'HTTP_ERROR', message: 'unavailable', retryable: true, httpStatus: 503, providerCode: 'overloaded' } },
    finishReason: 'error', errorCode: 'HTTP_ERROR',
  },
  { name: 'unknown reason', patch: { finishReason: 'pause_turn' }, finishReason: 'error', errorCode: 'UNEXPECTED_FINISH' },
  {
    name: 'invalid usage', patch: { usage: { ...usage, out: -1 } }, finishReason: 'stop',
    expectedUsage: { in: null, out: null, cacheRead: null, cacheWrite5m: null, cacheWrite1h: null, source: 'unavailable' },
  },
];

for (const fixture of terminalFixtures) {
  test(`provider terminal fixture: ${fixture.name}`, () => {
    const input = candidate(fixture.patch);
    const before = structuredClone(input);
    const result = checkResult(input);
    assert.equal(result.finishReason, fixture.finishReason);
    assert.equal(result.error?.code, fixture.errorCode);
    assert.equal(result.text, input.text);
    assert.deepEqual(result.usage, fixture.expectedUsage ?? usage);
    assert.deepEqual(input, before);
    if (fixture.name === 'stop') assert.equal(result.rawFinishReason, 'end_turn');
    if (fixture.name === 'unknown reason') assert.equal(result.rawFinishReason, 'pause_turn');
    if (fixture.name === 'error') {
      assert.equal(result.error?.providerCode, 'overloaded');
      assert.equal(result.error?.httpStatus, 503);
      assert.equal(result.error?.retryable, true);
    }
  });
}

test('malformed errors fail closed and every synthesised error has a message', () => {
  const malformed = { code: 'HTTP_ERROR', message: 503, retryable: true };
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ finishReason: 'stop', error: malformed }, 'MALFORMED_RESULT'],
    [{ text: undefined }, 'EMPTY_OUTPUT'],
    [{ finishReason: 'length', error: malformed }, 'MALFORMED_RESULT'],
    [{ finishReason: 'error', error: malformed }, 'MALFORMED_RESULT'],
    [{ finishReason: undefined }, 'UNEXPECTED_FINISH'],
  ];
  for (const [patch, code] of cases) {
    const result = checkResult(candidate(patch));
    assert.ok(result.error);
    assert.equal(result.error.retryable, false);
    assert.ok(result.error.message.trim().length > 0);
    assert.equal(result.error.code, code);
  }
});

test('receipt digests ignore nested key insertion order and cover each result field', () => {
  const result = checkResult(candidate({
    finishReason: 'error', providerRequestId: 'remote_1', rawFinishReason: 'failed',
    error: { code: 'HTTP_ERROR', message: 'unavailable', retryable: true, httpStatus: 503, providerCode: 'overloaded' },
  }));
  const reversed = Object.fromEntries(Object.entries(result).reverse());
  reversed.usage = Object.fromEntries(Object.entries(result.usage).reverse());
  reversed.error = Object.fromEntries(Object.entries(result.error!).reverse());
  assert.equal(resultDigest(result), resultDigest(reversed as NormalizedResult));

  const changes = {
    provider: 'openai', route: 'sync-api', stage: 'repair', model: 'other-model',
    customId: 'request_2', attemptId: 'request_1.2', providerRequestId: 'remote_2',
    rawFinishReason: 'other', text: 'different', finishReason: 'length',
    usage: { ...result.usage, in: 1201 },
    error: { ...result.error, providerCode: 'other' },
  };
  for (const [field, value] of Object.entries(changes)) {
    assert.notEqual(resultDigest(result), resultDigest(checkResult({ ...result, [field]: value })), field);
  }
});
