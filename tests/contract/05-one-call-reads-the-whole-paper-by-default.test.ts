// Contract test for stage-cards/05-one-call-reads-the-whole-paper-by-default.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/05-one-call-reads-the-whole-paper-by-default.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-05-'));
for (const dir of ['input', 'output', 'jobs']) fs.mkdirSync(path.join(TMP, dir));
const OUT_DIR = path.join(TMP, 'output');

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/05-one-call-reads-the-whole-paper-by-default.md
// Every path and credential is pinned before src/ is loaded, so the fill-only
// .env loader cannot redirect output or reach a real account.
Object.assign(process.env, {
  EXPLAINER_STATE_FILE: path.join(TMP, 'state.json'),
  EXPLAINER_INPUT_DIR: path.join(TMP, 'input'),
  EXPLAINER_OUTPUT_DIR: OUT_DIR,
  EXPLAINER_OBSIDIAN_DIR: '',
  EXPLAINER_JOBS_DIR: path.join(TMP, 'jobs'),
  WEBSITE_REPO: '',
  ANTHROPIC_API_KEY: '',
  CLAUDE_CODE_OAUTH_TOKEN: '',
  OPENAI_API_KEY: 'contract-test-not-a-key',
  FIGURE_RECREATE: '0',
});
for (const key of ['OPENAI_USE_LANES', 'MODEL', 'MODEL_BATCH', 'MODEL_LANE', 'MODEL_SYNTHESIS', 'MODEL_REPAIR', 'PROVIDER', 'FIGURE_VLM_PROVIDER', 'FIGURE_VLM_MODEL']) {
  delete process.env[key];
}

globalThis.fetch = (async () => {
  throw new Error('network access is forbidden in contract test 05');
}) as typeof fetch;

const batch = require('../../src/batch') as typeof import('../../src/batch');
const providers = require('../../src/providers') as typeof import('../../src/providers');
const stateMod = require('../../src/state') as typeof import('../../src/state');
const prompt = require('../../src/prompt') as typeof import('../../src/prompt');
const modelConfig = require('../../src/model-config') as typeof import('../../src/model-config');

const SYSTEM_PROMPT = prompt.buildSystemPrompt();
const PAGE_TEXT = 'FULL-PAPER-TEXT-MARKER the whole paper body.';

// customIds avoid the explainer-url- prefix and no PDF exists in the input
// dir, so figure extraction finds no source and makes no call.
function makeItem(customId: string) {
  return {
    customId,
    input: `https://example.org/${customId}`,
    source: { kind: 'url' as const, url: `https://example.org/${customId}` },
    isUrl: true,
    htmlContent: PAGE_TEXT,
  };
}

function fixtureText(shortTitle: string): string {
  return JSON.stringify({
    version: 1,
    metadata: { title: 'A paper', filename_slug: `2026-10-19_tester_${shortTitle}_explainer`, eyebrow: 'Research Explainer · Tester', date_created: '2026-10-19' },
    hero: { headline: 'H', standfirst: 'S', publication_date: 'Published January 2024' },
    sections: [{ title: 'One', paragraphs: ['Body.'] }],
  });
}

interface Call { instructions: string; content: string }

const LANE_INSTRUCTION = /Focus lane:/;

function stubOpenAI(mode: 'api_key' | 'codex_cli', opts: { text: string; failLane?: string }) {
  const proto = providers.OpenAIProvider.prototype as any;
  const calls: Call[] = [];
  const uploads: string[][] = [];
  const linesByFile = new Map<string, string[]>();
  const fileByBatch = new Map<string, string>();
  proto.authMode = () => mode;
  proto.requireBatchAuth = () => undefined;
  proto.fileExists = async () => true;
  proto.uploadFile = async () => 'file-contract05-pdf';
  proto.uploadJsonl = async (lines: string) => {
    const rows = lines.split('\n').filter(Boolean);
    uploads.push(rows);
    const id = `file-contract05-${uploads.length}`;
    linesByFile.set(id, rows);
    return id;
  };
  proto.createBatch = async (fileId: string) => {
    const id = `batch_contract05_${fileId}`;
    fileByBatch.set(id, fileId);
    return { id, status: 'validating' };
  };
  proto.retrieveBatch = async () => ({ status: 'ended', counts: { processing: 0, succeeded: 1, errored: 0 } });
  proto.iterateBatchResults = async function* (batchId: string) {
    for (const line of linesByFile.get(fileByBatch.get(batchId) ?? '') ?? []) {
      const row = JSON.parse(line) as { custom_id: string; body: { instructions: string } };
      const isLane = LANE_INSTRUCTION.test(row.body.instructions);
      if (isLane && opts.failLane && row.body.instructions.includes(`Focus lane: ${opts.failLane}`) && row.custom_id.includes('broken')) {
        yield { customId: row.custom_id, type: 'errored', error: 'lane request failed upstream' };
        continue;
      }
      yield { customId: row.custom_id, type: 'succeeded', text: isLane ? '- a lane bullet' : opts.text, inputTokens: 10, outputTokens: 10 };
    }
  };
  proto.createMessage = async (_model: string, _max: number, instructions: string, input: unknown) => {
    calls.push({ instructions, content: JSON.stringify(input) });
    if (opts.failLane && instructions.includes(`Focus lane: ${opts.failLane}`)) throw new Error('lane call failed');
    return { text: LANE_INSTRUCTION.test(instructions) ? '- a lane bullet' : opts.text, inputTokens: 1, outputTokens: 1 };
  };
  proto.createVisionViaCodex = async () => { throw new Error('vision must not run in contract test 05'); };
  return { calls, uploads };
}

function requestsOf(batchId: string) {
  const b = stateMod.getBatchById(stateMod.readState(), batchId);
  assert.ok(b, `batch ${batchId} missing from state`);
  return b.requests;
}

test('default sync run: one call per paper, carrying the whole paper', async () => {
  delete process.env.OPENAI_USE_LANES;
  const spy = stubOpenAI('api_key', { text: fixtureText('default-sync') });
  const id = await batch.runSync('openai', [makeItem('explainer-c05-default') as any]);
  assert.equal(spy.calls.filter(c => LANE_INSTRUCTION.test(c.instructions)).length, 0, 'lane calls made with OPENAI_USE_LANES unset');
  const writes = spy.calls.filter(c => c.instructions === SYSTEM_PROMPT);
  assert.equal(writes.length, 1, `expected exactly one explainer-writing call, got ${writes.length}`);
  assert.match(writes[0].content, /FULL-PAPER-TEXT-MARKER/, 'the explainer-writing call does not carry the paper');
  const lanes = Object.values(requestsOf(id)).filter(r => r.type === 'lane');
  assert.equal(lanes.length, 0, 'lane requests recorded in state with OPENAI_USE_LANES unset');
  assert.ok(fs.existsSync(path.join(OUT_DIR, '2026-10-19_tester_default-sync_explainer.json')), 'default sync run saved no explainer');
});

test('default batch submit: one request per paper, the writer reading the whole paper', async () => {
  delete process.env.OPENAI_USE_LANES;
  const spy = stubOpenAI('api_key', { text: fixtureText('default-batch') });
  await batch.submitBatch('openai', [makeItem('explainer-c05-batch') as any]);
  assert.equal(spy.uploads.length, 1, 'expected one JSONL upload');
  const rows = spy.uploads[0].map(l => JSON.parse(l));
  assert.deepEqual(rows.map(r => r.custom_id), ['explainer-c05-batch'], 'default batch should hold exactly one request for the paper');
  assert.equal(rows[0].body.instructions, SYSTEM_PROMPT, 'default batch request is not the explainer writer');
  assert.match(JSON.stringify(rows[0].body.input), /FULL-PAPER-TEXT-MARKER/, 'default batch request does not carry the paper');
});

test('lanes opted in, sync: a failed lane fails the paper and nothing is written from "(missing)"', async () => {
  process.env.OPENAI_USE_LANES = '1';
  const spy = stubOpenAI('api_key', { text: fixtureText('lanes-sync'), failLane: 'results' });
  const id = await batch.runSync('openai', [makeItem('explainer-c05-broken-sync') as any]);
  assert.ok(spy.calls.some(c => LANE_INSTRUCTION.test(c.instructions)), 'OPENAI_USE_LANES=1 no longer runs lanes');
  assert.equal(spy.calls.filter(c => c.instructions === SYSTEM_PROMPT).length, 0, 'synthesis ran although a lane failed');
  assert.ok(!spy.calls.some(c => c.content.includes('(missing)')), 'a "(missing)" lane was sent to a model');
  const req = requestsOf(id)['explainer-c05-broken-sync'];
  assert.equal(req.result, 'errored', 'paper with a failed lane is not marked errored');
  assert.match(String(req.error), /lane/i, 'paper error does not mention the lane');
  assert.match(String(req.error), /results/, 'paper error does not name the failed lane');
  assert.ok(!fs.existsSync(path.join(OUT_DIR, '2026-10-19_tester_lanes-sync_explainer.json')), 'an explainer was saved from incomplete lanes');
});

test('lanes opted in, batch collect: only the paper with a failed lane is dropped from synthesis', async () => {
  process.env.OPENAI_USE_LANES = '1';
  const spy = stubOpenAI('api_key', { text: fixtureText('lanes-batch'), failLane: 'results' });
  const id = await batch.submitBatch('openai', [makeItem('explainer-c05-broken-batch') as any, makeItem('explainer-c05-whole-batch') as any]);
  await batch.pollAndRetrieve('openai', id);
  assert.equal(spy.uploads.length, 2, 'expected a lane upload and a synthesis upload');
  const synthRows = spy.uploads[1].map(l => JSON.parse(l));
  assert.deepEqual(synthRows.map(r => r.custom_id), ['explainer-c05-whole-batch'], 'synthesis batch should hold only the paper whose lanes all succeeded');
  assert.ok(!spy.uploads[1].some(l => l.includes('(missing)')), 'a "(missing)" lane was sent to synthesis');
  const req = requestsOf(id)['explainer-c05-broken-batch'];
  assert.equal(req.result, 'errored', 'paper with a failed lane is not marked errored');
  assert.match(String(req.error), /results/, 'paper error does not name the failed lane');
  assert.equal(requestsOf(id)['explainer-c05-whole-batch'].result, 'succeeded', 'the healthy paper did not complete');
});

test('lanes opted in, codex local batch: a failed lane fails the paper', async () => {
  process.env.OPENAI_USE_LANES = '1';
  const spy = stubOpenAI('codex_cli', { text: fixtureText('lanes-local'), failLane: 'results' });
  const id = await batch.submitBatch('openai', [makeItem('explainer-c05-broken-local') as any]);
  await batch.pollAndRetrieve('openai', id);
  assert.equal(spy.calls.filter(c => c.instructions === SYSTEM_PROMPT).length, 0, 'local synthesis ran although a lane failed');
  assert.ok(!spy.calls.some(c => c.content.includes('(missing)')), 'a "(missing)" lane was sent to a model');
  const req = requestsOf(id)['explainer-c05-broken-local'];
  assert.equal(req.result, 'errored', 'paper with a failed lane is not marked errored');
  assert.match(String(req.error), /results/, 'paper error does not name the failed lane');
});

test('model defaults are unchanged', () => {
  delete process.env.OPENAI_USE_LANES;
  const claude = modelConfig.getModelConfig('claude');
  const openai = modelConfig.getModelConfig('openai');
  assert.deepEqual(
    [claude.batchModel, claude.laneModel, claude.synthesisModel, claude.repairModel],
    ['claude-opus-4-8', 'claude-opus-4-8', 'claude-opus-4-8', 'claude-sonnet-5-5'],
  );
  assert.deepEqual(
    [openai.batchModel, openai.laneModel, openai.synthesisModel, openai.repairModel],
    ['gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-luna'],
  );
});

test('docs state the real defaults and the lane opt-in', () => {
  const claudeMd = fs.readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
  const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
  assert.doesNotMatch(claudeMd, /claude-sonnet-5(?![-.\d])/, 'CLAUDE.md still names claude-sonnet-5 as a default');
  assert.match(claudeMd, /claude-sonnet-5-5/, 'CLAUDE.md does not name the repair default claude-sonnet-5-5');
  for (const id of ['claude-opus-4-8', 'claude-sonnet-5-5', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
    assert.ok(readme.includes(id), `README.md does not name the default ${id}`);
  }
  assert.match(readme, /OPENAI_USE_LANES/, 'README.md does not document OPENAI_USE_LANES');
  assert.doesNotMatch(readme, /semantic-lane extraction \+ synthesis/, 'README.md still describes OpenAI batch as lanes by default');
  assert.doesNotMatch(readme, /OpenAI runs\s+semantic lane extraction/, 'README.md still says OpenAI runs lane extraction by default');
});
// AUTOMETTA-CONTRACT-END

test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});
