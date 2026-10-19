// Contract test for stage-cards/06-batch-results-carry-their-provenance.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/06-batch-results-carry-their-provenance.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-06-'));
for (const dir of ['input', 'output', 'jobs']) fs.mkdirSync(path.join(TMP, dir));
const OUT_DIR = path.join(TMP, 'output');

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/06-batch-results-carry-their-provenance.md
// Every path and credential is pinned before src/ is loaded, so the fill-only
// .env loader cannot redirect output or reach a real account.
Object.assign(process.env, {
  EXPLAINER_STATE_FILE: path.join(TMP, 'state.json'),
  EXPLAINER_INPUT_DIR: path.join(TMP, 'input'),
  EXPLAINER_OUTPUT_DIR: OUT_DIR,
  EXPLAINER_OBSIDIAN_DIR: '',
  EXPLAINER_JOBS_DIR: path.join(TMP, 'jobs'),
  WEBSITE_REPO: '',
  ANTHROPIC_API_KEY: 'contract-test-not-a-key',
  CLAUDE_CODE_OAUTH_TOKEN: '',
  OPENAI_API_KEY: 'contract-test-not-a-key',
  OPENAI_USE_LANES: '0',
  FIGURE_RECREATE: '0',
});
for (const key of ['MODEL', 'MODEL_BATCH', 'MODEL_SYNTHESIS', 'MODEL_LANE', 'MODEL_REPAIR', 'PROVIDER', 'FIGURE_VLM_PROVIDER', 'FIGURE_VLM_MODEL']) {
  delete process.env[key];
}

globalThis.fetch = (async () => {
  throw new Error('network access is forbidden in contract test 06');
}) as typeof fetch;

const batch = require('../../src/batch') as typeof import('../../src/batch');
const providers = require('../../src/providers') as typeof import('../../src/providers');
const stateMod = require('../../src/state') as typeof import('../../src/state');

const SURNAME = 'Lovelace';
const PUBLISHED = 'Published March 2024';
const REFERENCE = 'Lovelace, A. (2024). <a href="https://example.org/paper" target="_blank" rel="noopener noreferrer">Notes on the Engine</a>.';

// customIds deliberately avoid the explainer-url- prefix and no PDF exists in
// the input dir, so figure extraction finds no source and makes no call.
function makeItem(customId: string) {
  return {
    customId,
    input: `https://example.org/${customId}`,
    source: { kind: 'url' as const, url: `https://example.org/${customId}` },
    isUrl: true,
    htmlContent: 'Page text standing in for the paper.',
    detectedSurname: SURNAME,
    detectedPublished: PUBLISHED,
    detectedReference: REFERENCE,
  };
}

function fixtureText(shortTitle: string): string {
  return JSON.stringify({
    version: 1,
    metadata: {
      title: 'What Unknown found about engines',
      filename_slug: `2026-10-19_unknown_${shortTitle}_explainer`,
      eyebrow: 'Research Explainer · Unknown',
      date_created: '2026-10-19',
    },
    hero: { headline: 'Engines', standfirst: 'A test paper.', publication_date: 'Published January 1999' },
    sections: [{ title: 'One', paragraphs: ['Body text.'] }],
    references: ['Model-written reference that must be replaced.'],
  });
}

function readOutput(shortTitle: string): Record<string, any> {
  const file = path.join(OUT_DIR, `2026-10-19_lovelace_${shortTitle}_explainer.json`);
  assert.ok(fs.existsSync(file), `expected output ${path.basename(file)}; found ${fs.readdirSync(OUT_DIR).join(', ') || 'nothing'}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assertStamped(json: Record<string, any>, route: 'batch' | 'sync', label: string): void {
  assert.equal(json.hero?.publication_date, PUBLISHED, `${label}: hero.publication_date not stamped from detectedPublished`);
  assert.deepEqual(json.references, [REFERENCE], `${label}: references not stamped from detectedReference`);
  assert.match(String(json.metadata?.eyebrow ?? ''), /Lovelace/, `${label}: eyebrow does not name the detected author`);
  assert.doesNotMatch(String(json.metadata?.title ?? ''), /Unknown/, `${label}: placeholder author left in the title`);
  assert.equal(json.metadata?.run_mode, route, `${label}: route tag`);
}

function stubClaude(text: string): void {
  const proto = providers.ClaudeProvider.prototype as any;
  proto.createBatch = async () => ({ id: 'msgbatch_contract06', status: 'in_progress' });
  proto.retrieveBatch = async () => ({ status: 'ended', counts: { processing: 0, succeeded: 1, errored: 0 } });
  proto.iterateBatchResults = async function* () {
    yield { customId: 'explainer-c06-claude', type: 'succeeded', text, inputTokens: 10, outputTokens: 10 };
  };
  proto.createMessage = async () => ({ text, inputTokens: 1, outputTokens: 1 });
  proto.createMessageWithContent = proto.createMessage;
  proto.createMessageViaCli = proto.createMessage;
}

function stubOpenAI(mode: 'api_key' | 'codex_cli', text: string): void {
  const proto = providers.OpenAIProvider.prototype as any;
  const linesByFile = new Map<string, string[]>();
  const fileByBatch = new Map<string, string>();
  let n = 0;
  proto.authMode = () => mode;
  proto.requireBatchAuth = () => undefined;
  proto.fileExists = async () => true;
  proto.uploadFile = async () => 'file-contract06-pdf';
  proto.uploadJsonl = async (lines: string) => {
    n += 1;
    const id = `file-contract06-${n}`;
    linesByFile.set(id, lines.split('\n').filter(Boolean));
    return id;
  };
  proto.createBatch = async (fileId: string) => {
    const id = `batch_contract06_${fileId}`;
    fileByBatch.set(id, fileId);
    return { id, status: 'validating' };
  };
  proto.retrieveBatch = async () => ({ status: 'ended', counts: { processing: 0, succeeded: 1, errored: 0 } });
  proto.iterateBatchResults = async function* (batchId: string) {
    for (const line of linesByFile.get(fileByBatch.get(batchId) ?? '') ?? []) {
      const row = JSON.parse(line) as { custom_id: string };
      const isLane = row.custom_id.includes('lane');
      yield { customId: row.custom_id, type: 'succeeded', text: isLane ? '- a lane bullet' : text, inputTokens: 10, outputTokens: 10 };
    }
  };
  proto.createMessage = async () => ({ text, inputTokens: 1, outputTokens: 1 });
  proto.createVisionViaCodex = async () => { throw new Error('vision must not run in contract test 06'); };
}

test('Claude batch: submit persists the detected provenance on the request', async () => {
  stubClaude(fixtureText('claude-batch'));
  const id = await batch.submitBatch('claude', [makeItem('explainer-c06-claude') as any]);
  const req = stateMod.getBatchById(stateMod.readState(), id)?.requests['explainer-c06-claude'] as Record<string, unknown> | undefined;
  assert.ok(req, 'request missing from state after submit');
  assert.equal(req.detectedSurname, SURNAME, 'RequestState.detectedSurname not persisted at submit');
  assert.equal(req.detectedPublished, PUBLISHED, 'RequestState.detectedPublished not persisted at submit');
  assert.equal(req.detectedReference, REFERENCE, 'RequestState.detectedReference not persisted at submit');

  await batch.pollAndRetrieve('claude', id);
  assertStamped(readOutput('claude-batch'), 'batch', 'Claude batch collect');
});

const openaiOutputs: Record<string, Record<string, any>> = {};

test('OpenAI batch, single stage: collect stamps the provenance', async () => {
  process.env.OPENAI_USE_LANES = '0';
  stubOpenAI('api_key', fixtureText('openai-route'));
  const id = await batch.submitBatch('openai', [makeItem('explainer-c06-openai') as any]);
  await batch.pollAndRetrieve('openai', id);
  openaiOutputs.batch = readOutput('openai-route');
  assertStamped(openaiOutputs.batch, 'batch', 'OpenAI batch collect');
});

test('OpenAI sync of the same paper: identical output apart from the route tag', async () => {
  process.env.OPENAI_USE_LANES = '0';
  stubOpenAI('api_key', fixtureText('openai-route'));
  await batch.runSync('openai', [makeItem('explainer-c06-openai') as any]);
  openaiOutputs.sync = readOutput('openai-route');
  assertStamped(openaiOutputs.sync, 'sync', 'OpenAI sync');
  assert.ok(openaiOutputs.batch, 'batch output from the previous test is missing');
  const strip = (j: Record<string, any>) => {
    const copy = JSON.parse(JSON.stringify(j));
    delete copy.metadata.run_mode;
    return copy;
  };
  assert.deepEqual(strip(openaiOutputs.batch), strip(openaiOutputs.sync), 'batch and sync output differ beyond metadata.run_mode');
});

test('OpenAI batch with lanes opted in: synthesis collect stamps the provenance', async () => {
  process.env.OPENAI_USE_LANES = '1';
  stubOpenAI('api_key', fixtureText('openai-lanes'));
  const id = await batch.submitBatch('openai', [makeItem('explainer-c06-split') as any]);
  await batch.pollAndRetrieve('openai', id);
  process.env.OPENAI_USE_LANES = '0';
  assertStamped(readOutput('openai-lanes'), 'batch', 'OpenAI lane synthesis collect');
});

test('Codex local batch: collect re-reads the provenance from state and stamps it', async () => {
  process.env.OPENAI_USE_LANES = '0';
  stubOpenAI('codex_cli', fixtureText('codex-local'));
  const id = await batch.submitBatch('openai', [makeItem('explainer-c06-codex') as any]);
  assert.match(id, /^codexbatch_/, 'codex auth should create a local batch');
  await batch.pollAndRetrieve('openai', id);
  const json = readOutput('codex-local');
  assert.equal(json.hero?.publication_date, PUBLISHED, 'Codex local batch: hero.publication_date not stamped');
  assert.deepEqual(json.references, [REFERENCE], 'Codex local batch: references not stamped');
  assert.match(String(json.metadata?.eyebrow ?? ''), /Lovelace/, 'Codex local batch: eyebrow does not name the detected author');
});

test('every save goes through one finalizing call site', () => {
  const srcDir = path.join(REPO_ROOT, 'src');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) files.push(full);
    }
  };
  walk(srcDir);
  const callSites: string[] = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/\bsaveResult\s*\(/.test(line) && !/function\s+saveResult\s*\(/.test(line)) {
        callSites.push(`${path.relative(REPO_ROOT, file)}:${i + 1}`);
      }
    });
  }
  assert.equal(callSites.length, 1, `expected exactly one saveResult call site (inside finalizeResult), found ${callSites.length}: ${callSites.join(', ')}`);
  const finalizeDefined = files.some(f => /function\s+finalizeResult\s*\(/.test(fs.readFileSync(f, 'utf8')));
  assert.ok(finalizeDefined, 'no finalizeResult function defined under src/');
});
// AUTOMETTA-CONTRACT-END

test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});
