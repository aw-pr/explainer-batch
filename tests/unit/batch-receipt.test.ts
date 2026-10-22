import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResultReceipt } from '../../src/batch';

const cases = [
  ['Claude batch', 'claude', 'batch-api', 'batch-api'],
  ['OpenAI single-stage batch', 'openai', 'batch-api', 'batch-api'],
  ['OpenAI lane synthesis batch', 'openai', 'batch-api', 'batch-api'],
  ['Codex local batch', 'openai', 'codex_cli', 'subscription-cli'],
  ['Claude sync', 'claude', 'claude_cli', 'subscription-cli'],
  ['OpenAI API sync', 'openai', 'api_key', 'sync-api'],
  ['OpenAI Codex sync', 'openai', 'codex_cli', 'subscription-cli'],
] as const;

for (const [name, provider, mode, route] of cases) {
  test(`${name} receipt preserves synthesis identity, usage and route`, () => {
    const response = { text: 'Original synthesis text', inputTokens: 17, outputTokens: 29 };
    const receipt = buildResultReceipt(provider, mode, 'synthesis-batch', 'paper-id', 'synthesis-model', response);
    assert.deepEqual(receipt, {
      provider, route, stage: 'synthesis', model: 'synthesis-model',
      customId: 'paper-id', attemptId: 'synthesis-batch:paper-id',
      finishReason: 'stop', text: response.text,
      usage: { in: 17, out: 29, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, source: 'reported' },
    });
    assert.deepEqual(response, { text: 'Original synthesis text', inputTokens: 17, outputTokens: 29 });
  });
}
