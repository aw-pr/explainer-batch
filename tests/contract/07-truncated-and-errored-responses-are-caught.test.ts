// Contract test for stage-cards/07-truncated-and-errored-responses-are-caught.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/07-truncated-and-errored-responses-are-caught.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/07-truncated-and-errored-responses-are-caught.md
Object.assign(process.env, {
  OPENAI_API_KEY: 'contract-test-not-a-key',
  ANTHROPIC_API_KEY: 'contract-test-not-a-key',
});
delete process.env.STRUCTURED_OUTPUT;

type Route = (method: string, url: string, body: unknown) => { status: number; json: unknown } | { status: number; text: string };
let route: Route = () => {
  throw new Error('no route stubbed');
};
const requests: Array<{ method: string; url: string; body: unknown }> = [];
globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
  requests.push({ method, url, body });
  const r = route(method, url, body);
  const payload = 'json' in r ? JSON.stringify(r.json) : r.text;
  return new Response(payload, { status: r.status, headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;

const providers = require('../../src/providers') as typeof import('../../src/providers');

const USAGE_CLAUDE = { input_tokens: 10, output_tokens: 20 };
const SCHEMA = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };

function claudeWithClient(client: unknown) {
  const p = new providers.ClaudeProvider('contract-test-not-a-key');
  (p as any).client = client;
  return p;
}

function streamReturning(message: unknown) {
  return { messages: { stream: () => ({ finalMessage: async () => message }) } };
}

test('Claude sync: stop_reason max_tokens rejects', async () => {
  const p = claudeWithClient(streamReturning({
    content: [{ type: 'tool_use', name: 'emit_explainer', input: { version: 1 } }],
    stop_reason: 'max_tokens',
    usage: USAGE_CLAUDE,
  }));
  await assert.rejects(p.createMessageWithContent('claude-opus-5-5', 100, 'system', 'hi', SCHEMA), /max_tokens/);
});

test('Claude sync: end_turn and tool_use replies still resolve', async () => {
  for (const stop of ['end_turn', 'tool_use']) {
    const p = claudeWithClient(streamReturning({
      content: [{ type: 'text', text: '{"a":"b"}' }],
      stop_reason: stop,
      usage: USAGE_CLAUDE,
    }));
    const res = await p.createMessageWithContent('claude-opus-5-5', 100, 'system', 'hi');
    assert.equal(res.text, '{"a":"b"}');
    assert.equal(res.outputTokens, 20);
  }
});

test('Claude batch: a max_tokens result is errored, a complete one succeeds', async () => {
  const items = [
    { custom_id: 'cut', result: { type: 'succeeded', message: { content: [{ type: 'text', text: '{"a":' }], stop_reason: 'max_tokens', usage: USAGE_CLAUDE } } },
    { custom_id: 'whole', result: { type: 'succeeded', message: { content: [{ type: 'text', text: '{"a":"b"}' }], stop_reason: 'end_turn', usage: USAGE_CLAUDE } } },
  ];
  const p = claudeWithClient({
    messages: { batches: { results: async () => (async function* () { yield* items; })() } },
  });
  const out: any[] = [];
  for await (const r of p.iterateBatchResults('msgbatch_contract')) out.push(r);
  const cut = out.find((r) => r.customId === 'cut');
  const whole = out.find((r) => r.customId === 'whole');
  assert.equal(cut?.type, 'errored');
  assert.match(String(cut?.error), /max_tokens/);
  assert.equal(whole?.type, 'succeeded');
  assert.equal(whole?.text, '{"a":"b"}');
});

test('OpenAI sync: status incomplete rejects, and the request asks for strict json_schema', async () => {
  requests.length = 0;
  route = () => ({
    status: 200,
    json: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output_text: '{"a":', usage: { input_tokens: 5, output_tokens: 8 } },
  });
  const p = new providers.OpenAIProvider();
  await assert.rejects(
    p.createMessage('gpt-5.6-terra', 100, 'instructions', [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }], false, SCHEMA),
    /incomplete|max_output_tokens/,
  );
  const sent = requests.find((r) => r.url.endsWith('/responses'));
  assert.ok(sent, 'no /responses request was sent');
  const format = (sent!.body as any)?.text?.format;
  assert.equal(format?.type, 'json_schema');
  assert.equal(format?.strict, true);
  assert.deepEqual(format?.schema, SCHEMA);
});

test('OpenAI sync: a completed response still resolves', async () => {
  route = () => ({ status: 200, json: { status: 'completed', output_text: '{"a":"b"}', usage: { input_tokens: 5, output_tokens: 8 } } });
  const p = new providers.OpenAIProvider();
  const res = await p.createMessage('gpt-5.6-terra', 100, 'instructions', [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }], false, SCHEMA);
  assert.equal(res.text, '{"a":"b"}');
  assert.equal(res.outputTokens, 8);
});

test('OpenAI batch: non-2xx rows and incomplete bodies are errored, complete rows succeed', async () => {
  const rows = [
    { id: 'r1', custom_id: 'rate-limited', response: { status_code: 429, request_id: 'q1', body: { error: { message: 'Rate limit reached', type: 'rate_limit' } } }, error: null },
    { id: 'r2', custom_id: 'cut', response: { status_code: 200, request_id: 'q2', body: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output_text: '{"a":', usage: { input_tokens: 1, output_tokens: 2 } } }, error: null },
    { id: 'r3', custom_id: 'whole', response: { status_code: 200, request_id: 'q3', body: { status: 'completed', output_text: '{"a":"b"}', usage: { input_tokens: 1, output_tokens: 2 } } }, error: null },
  ];
  route = (_method, url) => {
    if (url.endsWith('/batches/batch_contract')) {
      return { status: 200, json: { id: 'batch_contract', status: 'completed', output_file_id: 'file_out', request_counts: { total: 3, completed: 3, failed: 0 } } };
    }
    if (url.endsWith('/files/file_out/content')) return { status: 200, text: rows.map((r) => JSON.stringify(r)).join('\n') };
    throw new Error(`unexpected request ${url}`);
  };
  const p = new providers.OpenAIProvider();
  const out: any[] = [];
  for await (const r of p.iterateBatchResults('batch_contract')) out.push(r);
  const byId = Object.fromEntries(out.map((r) => [r.customId, r]));
  assert.equal(byId['rate-limited']?.type, 'errored');
  assert.match(String(byId['rate-limited']?.error), /429/);
  assert.equal(byId['cut']?.type, 'errored');
  assert.match(String(byId['cut']?.error), /incomplete|max_output_tokens/);
  assert.equal(byId['whole']?.type, 'succeeded');
  assert.equal(byId['whole']?.text, '{"a":"b"}');
});

test('the OpenAI json_schema format is built in exactly one place', () => {
  const srcDir = path.join(REPO_ROOT, 'src');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.ts')) files.push(full);
    }
  };
  walk(srcDir);
  let count = 0;
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8').split('\n').filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line)).join('\n');
    count += (code.match(/type:\s*['"]json_schema['"]/g) ?? []).length;
  }
  assert.equal(count, 1, `found ${count} json_schema format literals under src/`);
});
// AUTOMETTA-CONTRACT-END
