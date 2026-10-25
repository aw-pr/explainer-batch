// Re-frozen for stage-cards/48-every-route-saves-through-the-v2-seam.md.
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
for (const key of [
  'MODEL', 'MODEL_BATCH', 'MODEL_SYNTHESIS', 'MODEL_LANE',
  'MODEL_REPAIR', 'PROVIDER', 'FIGURE_VLM_PROVIDER', 'FIGURE_VLM_MODEL',
]) {
  delete process.env[key];
}

globalThis.fetch = (async () => {
  throw new Error('network access is forbidden in contract test 06');
}) as typeof fetch;

const batch = require('../../src/batch') as typeof import('../../src/batch');
const providers = require('../../src/providers') as typeof import('../../src/providers');
const stateMod = require('../../src/state') as typeof import('../../src/state');
const contract = require('../../contract/explainer-v2') as
  typeof import('../../contract/explainer-v2');

const PUBLISHED_ON = '2024-03';
const DETECTED_CITATION = {
  authors: [{ family: 'Lovelace', given: 'A.' }],
  year: 2024,
  title: 'Notes on the Engine',
  venue: 'Engine Studies',
  url: 'https://example.org/paper',
};

// No PDF exists and customIds avoid the explainer-url- prefix.
function makeItem(customId: string) {
  return {
    customId,
    input: `https://example.org/${customId}`,
    source: { kind: 'url' as const, url: `https://example.org/${customId}` },
    isUrl: true,
    htmlContent: 'Page text standing in for the paper.',
    detectedCitation: DETECTED_CITATION,
    publishedOn: PUBLISHED_ON,
  };
}

function fixtureText(shortTitle: string): string {
  const wire: import('../../contract/explainer-v2').ModelOutputV2 = {
    hero: {
      title: shortTitle,
      headline: 'Engines follow a stated procedure',
      emphasis: null,
      subtitle: 'The paper describes how the engine works.',
    },
    top_block: {
      kind: 'takeaway',
      label: 'Finding',
      body: 'The procedure follows the supplied instructions.',
    },
    sections: [
      {
        label: 'Method',
        paragraphs: ['The paper describes the procedure.'],
        list: null,
        table: null,
      },
      {
        label: 'Limits',
        paragraphs: ['The account does not establish wider effects.'],
        list: null,
        table: null,
      },
    ],
    charts: [],
    figure_request: null,
    end_takeaway: null,
    citation: {
      authors: [{ family: 'Turing', given: 'A.' }],
      year: 1999,
      title: 'A Different Model Citation',
      venue: 'Computing Studies',
      url: 'https://example.org/model-paper',
    },
  };
  assert.ok(
    contract.ModelOutputV2.safeParse(wire).success,
    '06: fixture is not valid v2 wire output',
  );
  return JSON.stringify(wire);
}

function batchOf(id: string) {
  const b = stateMod.getBatchById(stateMod.readState(), id);
  assert.ok(b, `06: batch ${id} missing from state`);
  assert.match(b.submitted_at, /^\d{4}-\d{2}-\d{2}T/, '06: submit timestamp missing');
  return b;
}

function readOutput(shortTitle: string, batchId: string): Record<string, any> {
  const date = batchOf(batchId).submitted_at.slice(0, 10);
  const file = path.join(OUT_DIR, `${date}_lovelace_${shortTitle}_explainer.json`);
  assert.ok(
    fs.existsSync(file),
    `06: expected output ${path.basename(file)}; found ${
      fs.readdirSync(OUT_DIR).join(', ') || 'nothing'
    }`,
  );
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.trim().length > 0, '06: saved output is empty');
  const json = JSON.parse(text);
  const parsed = contract.ExplainerV2.safeParse(json);
  assert.ok(parsed.success, `06: saved output fails ExplainerV2: ${
    parsed.success ? '' : parsed.error.message
  }`);
  return json;
}

function assertStamped(
  json: Record<string, any>,
  route: 'batch' | 'sync',
  label: string,
): void {
  assert.equal(json.version, 2, `06: ${label}: version`);
  assert.equal(
    json.hero?.publication_date,
    PUBLISHED_ON,
    `06: ${label}: publication date not stamped from publishedOn`,
  );
  assert.deepEqual(
    json.references,
    [{ ...DETECTED_CITATION, origin: 'detected' }],
    `06: ${label}: reference not stamped from detectedCitation`,
  );
  assert.equal(json.metadata?.route, route, `06: ${label}: route tag`);
}

function stubClaude(text: string): void {
  const proto = providers.ClaudeProvider.prototype as any;
  proto.createBatch = async () => ({ id: 'msgbatch_contract06', status: 'in_progress' });
  proto.retrieveBatch = async () => ({
    status: 'ended',
    counts: { processing: 0, succeeded: 1, errored: 0 },
  });
  proto.iterateBatchResults = async function* () {
    yield {
      customId: 'explainer-c06-claude',
      type: 'succeeded',
      text,
      inputTokens: 10,
      outputTokens: 10,
    };
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
  proto.retrieveBatch = async () => ({
    status: 'ended',
    counts: { processing: 0, succeeded: 1, errored: 0 },
  });
  proto.iterateBatchResults = async function* (batchId: string) {
    const fileId = fileByBatch.get(batchId);
    assert.ok(fileId, '06: stub has no input file for the batch');
    const lines = linesByFile.get(fileId);
    assert.ok(lines?.length, '06: stub captured no JSONL requests');

    for (const line of lines) {
      const row = JSON.parse(line) as { custom_id: string };
      const isLane = row.custom_id.includes('::lane::');
      yield {
        customId: row.custom_id,
        type: 'succeeded',
        text: isLane ? '- a lane bullet' : text,
        inputTokens: 10,
        outputTokens: 10,
      };
    }
  };
  proto.createMessage = async () => ({ text, inputTokens: 1, outputTokens: 1 });
  proto.createVisionViaCodex = async () => {
    throw new Error('vision must not run in contract test 06');
  };
}

test('Claude batch: submit persists the detected provenance on the request', async () => {
  stubClaude(fixtureText('claude-batch'));
  const id = await batch.submitBatch('claude', [makeItem('explainer-c06-claude') as any]);
  const req = batchOf(id).requests['explainer-c06-claude'] as any;

  assert.ok(req, '06: request missing from state after submit');
  assert.deepEqual(
    req.detectedCitation,
    DETECTED_CITATION,
    '06: RequestState.detectedCitation not persisted at submit',
  );
  assert.equal(
    req.publishedOn,
    PUBLISHED_ON,
    '06: RequestState.publishedOn not persisted at submit',
  );

  await batch.pollAndRetrieve('claude', id);
  assertStamped(readOutput('claude-batch', id), 'batch', 'Claude batch collect');
});

const openaiOutputs: Record<string, Record<string, any>> = {};

test('OpenAI batch, single stage: collect stamps the provenance', async () => {
  process.env.OPENAI_USE_LANES = '0';
  stubOpenAI('api_key', fixtureText('openai-route'));
  const id = await batch.submitBatch('openai', [makeItem('explainer-c06-openai') as any]);
  await batch.pollAndRetrieve('openai', id);
  openaiOutputs.batch = readOutput('openai-route', id);
  assertStamped(openaiOutputs.batch, 'batch', 'OpenAI batch collect');
});

test('OpenAI sync of the same paper: identical apart from route and model', async () => {
  process.env.OPENAI_USE_LANES = '0';
  stubOpenAI('api_key', fixtureText('openai-route'));
  const id = await batch.runSync('openai', [makeItem('explainer-c06-openai') as any]);
  openaiOutputs.sync = readOutput('openai-route', id);
  assertStamped(openaiOutputs.sync, 'sync', 'OpenAI sync');
  assert.ok(openaiOutputs.batch, '06: batch output from the previous test is missing');

  const strip = (j: Record<string, any>) => {
    assert.ok(j.metadata?.model, '06: comparison output has no model');
    assert.ok(j.metadata?.route, '06: comparison output has no route');
    const copy = JSON.parse(JSON.stringify(j));
    delete copy.metadata.route;
    delete copy.metadata.model;
    return copy;
  };

  assert.deepEqual(
    strip(openaiOutputs.batch),
    strip(openaiOutputs.sync),
    '06: batch and sync output differ beyond metadata.route and metadata.model',
  );
});

test('OpenAI batch with lanes opted in: synthesis collect stamps the provenance', async () => {
  process.env.OPENAI_USE_LANES = '1';
  stubOpenAI('api_key', fixtureText('openai-lanes'));
  const id = await batch.submitBatch('openai', [makeItem('explainer-c06-split') as any]);
  await batch.pollAndRetrieve('openai', id);
  process.env.OPENAI_USE_LANES = '0';
  assertStamped(readOutput('openai-lanes', id), 'batch', 'OpenAI lane synthesis collect');
});

test('Codex local batch: collect re-reads and stamps provenance from state', async () => {
  process.env.OPENAI_USE_LANES = '0';
  stubOpenAI('codex_cli', fixtureText('codex-local'));
  const id = await batch.submitBatch('openai', [makeItem('explainer-c06-codex') as any]);
  assert.match(id, /^codexbatch_/, '06: codex auth should create a local batch');
  await batch.pollAndRetrieve('openai', id);
  assertStamped(readOutput('codex-local', id), 'sync', 'Codex local batch');
});

test('batch has no saveResult call and exactly one finalizeResult call', () => {
  const ts = require('typescript') as typeof import('typescript');
  const source = fs.readFileSync(path.join(REPO_ROOT, 'src/batch.ts'), 'utf8');
  assert.ok(source.trim().length > 0, '06: src/batch.ts is empty');
  const ast = ts.createSourceFile(
    'batch.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
  );
  const callNames: string[] = [];

  const visit = (node: import('typescript').Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      callNames.push(node.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);

  assert.ok(callNames.length > 0, '06: source scan found no calls');
  assert.equal(
    callNames.filter(name => name === 'saveResult').length,
    0,
    '06: src/batch.ts still calls saveResult',
  );
  assert.equal(
    callNames.filter(name => name === 'finalizeResult').length,
    1,
    '06: src/batch.ts must call finalizeResult exactly once',
  );
});
// AUTOMETTA-CONTRACT-END

test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});
