import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-48-'));
for (const dir of ['input', 'output', 'jobs']) {
  fs.mkdirSync(path.join(TMP, dir));
}
const OUT_DIR = path.join(TMP, 'output');

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/48-every-route-saves-through-the-v2-seam.md
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
  throw new Error('48: network access is forbidden');
}) as typeof fetch;

const contract = require('../../contract/explainer-v2') as
  typeof import('../../contract/explainer-v2');
type Wire = import('../../contract/explainer-v2').ModelOutputV2;

const providers = require('../../src/providers') as typeof import('../../src/providers');
const stateMod = require('../../src/state') as typeof import('../../src/state');
const prompt = require('../../src/prompt') as typeof import('../../src/prompt');
const htmlExport = require('../../src/html-export') as any;
const exportedPaths: string[] = [];

htmlExport.exportHtmlForJsonFiles = async (files: string[]) => {
  exportedPaths.push(...files);
  return { ok: files.length, failed: 0, failures: [] };
};

const batch = require('../../src/batch') as typeof import('../../src/batch');
const SYSTEM_PROMPT = prompt.buildSystemPrompt();

const DETECTED = {
  authors: [{ family: 'Lovelace', given: 'A.' }],
  year: 2024,
  title: 'Notes on the Engine',
  venue: 'Engine Studies',
  url: 'https://example.org/detected-paper',
};

const MODEL_CITATION = {
  authors: [{ family: 'Turing', given: 'A.' }],
  year: 2023,
  title: 'A Model Account of Engines',
  venue: 'Computing Studies',
  url: 'https://example.org/model-paper',
};

const PUBLISHED_ON = '2024-03';

function wire(title: string): Wire {
  return {
    hero: {
      title,
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
      year: 2023,
      title: 'A Model Account of Engines',
      venue: 'Computing Studies',
      url: 'https://example.org/model-paper',
    },
  };
}

function chart(): Wire['charts'][number] {
  return {
    kind: 'bar',
    title: 'Engine groups',
    caption: 'The table reports counts for each group.',
    x: {
      label: 'Group',
      unit: null,
      type: 'category',
      values: ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'],
    },
    y: { label: 'Count', unit: 'items', scale: 'linear' },
    series: [
      {
        name: 'Observed',
        values: [2, 5, 9, 14, 20, 27],
        points: null,
        source: { kind: 'table', ref: 'Table 1', page: 1 },
      },
    ],
  };
}

interface Site {
  name: string;
  provider: 'claude' | 'openai';
  mode: 'api_key' | 'codex_cli' | 'claude_cli';
  sync: boolean;
  lanes: boolean;
  route: 'batch' | 'sync';
  model: string;
}

const SITES: Site[] = [
  {
    name: 'claude-batch',
    provider: 'claude',
    mode: 'api_key',
    sync: false,
    lanes: false,
    route: 'batch',
    model: 'claude-opus-4-8',
  },
  {
    name: 'openai-single',
    provider: 'openai',
    mode: 'api_key',
    sync: false,
    lanes: false,
    route: 'batch',
    model: 'gpt-5.6-terra',
  },
  {
    name: 'openai-lanes',
    provider: 'openai',
    mode: 'api_key',
    sync: false,
    lanes: true,
    route: 'batch',
    model: 'gpt-5.6-terra',
  },
  {
    name: 'codex-local',
    provider: 'openai',
    mode: 'codex_cli',
    sync: false,
    lanes: false,
    route: 'sync',
    model: 'gpt-5.6-terra',
  },
  {
    name: 'claude-cli',
    provider: 'claude',
    mode: 'claude_cli',
    sync: true,
    lanes: false,
    route: 'sync',
    model: 'claude-sonnet-5-5',
  },
  {
    name: 'openai-sync-api',
    provider: 'openai',
    mode: 'api_key',
    sync: true,
    lanes: false,
    route: 'sync',
    model: 'gpt-5.6-terra',
  },
  {
    name: 'openai-sync-codex',
    provider: 'openai',
    mode: 'codex_cli',
    sync: true,
    lanes: false,
    route: 'sync',
    model: 'gpt-5.6-terra',
  },
];

interface RepairCall {
  model: string;
  instruction: string;
  payload: string;
  transport: string;
}

let serial = 0;

function installStubs(
  site: Site,
  synthesisText: string,
  repairText: string,
  run: number,
): RepairCall[] {
  process.env.OPENAI_USE_LANES = site.lanes ? '1' : '0';
  process.env.ANTHROPIC_API_KEY =
    site.mode === 'claude_cli' ? '' : 'contract-test-not-a-key';
  process.env.CLAUDE_CODE_OAUTH_TOKEN =
    site.mode === 'claude_cli' ? 'contract-test-not-a-token' : '';

  Object.assign(process.env, site.provider === 'claude' ? {
    MODEL_BATCH: 'claude-opus-4-8',
    MODEL_SYNTHESIS: 'claude-sonnet-5-5',
    MODEL_LANE: 'claude-opus-4-8',
    MODEL_REPAIR: 'claude-sonnet-5-5',
  } : {
    MODEL_BATCH: 'gpt-5.6-luna',
    MODEL_SYNTHESIS: 'gpt-5.6-terra',
    MODEL_LANE: 'gpt-5.6-luna',
    MODEL_REPAIR: 'gpt-5.6-luna',
  });

  const repairs: RepairCall[] = [];

  const complete = (
    model: string,
    instruction: string,
    input: any,
    transport: string,
  ) => {
    if (instruction === SYSTEM_PROMPT) {
      return { text: synthesisText, inputTokens: 10, outputTokens: 20 };
    }
    if (/Focus lane:/.test(instruction)) {
      return { text: '- a lane bullet', inputTokens: 2, outputTokens: 3 };
    }

    const payload = typeof input === 'string'
      ? input
      : input?.[0]?.content?.[0]?.text;

    assert.equal(typeof payload, 'string', '48: repair payload is not text');
    assert.ok(payload.trim().length > 0, '48: repair payload is empty');
    repairs.push({ model, instruction, payload, transport });

    return { text: repairText, inputTokens: 7, outputTokens: 11 };
  };

  const claude = providers.ClaudeProvider.prototype as any;
  let claudeRequests: Array<{ customId: string }> = [];
  claude.createBatch = async (requests: Array<{ customId: string }>) => {
    claudeRequests = requests;
    return { id: `msgbatch_c48_${run}`, status: 'in_progress' };
  };
  claude.retrieveBatch = async () => ({
    status: 'ended',
    counts: { processing: 0, succeeded: 1, errored: 0 },
  });
  claude.iterateBatchResults = async function* () {
    assert.ok(claudeRequests.length > 0, '48: Claude stub captured no requests');
    for (const request of claudeRequests) {
      yield {
        customId: request.customId,
        type: 'succeeded',
        text: synthesisText,
        inputTokens: 10,
        outputTokens: 20,
      };
    }
  };
  claude.createMessage = async (
    model: string, _max: number, instruction: string, input: any,
  ) => complete(model, instruction, input, 'claude-api');
  claude.createMessageWithContent = claude.createMessage;
  claude.createMessageViaCli = async (
    model: string, instruction: string, input: any,
  ) => complete(model, instruction, input, 'claude-cli');

  const openai = providers.OpenAIProvider.prototype as any;
  const linesByFile = new Map<string, string[]>();
  const fileByBatch = new Map<string, string>();
  let fileNumber = 0;

  openai.authMode = () => site.mode === 'codex_cli' ? 'codex_cli' : 'api_key';
  openai.requireBatchAuth = () => undefined;
  openai.fileExists = async () => true;
  openai.uploadFile = async () => `file-c48-pdf-${run}`;
  openai.uploadJsonl = async (lines: string) => {
    const id = `file-c48-${run}-${++fileNumber}`;
    linesByFile.set(id, lines.split('\n').filter(Boolean));
    return id;
  };
  openai.createBatch = async (fileId: string) => {
    const id = `batch_c48_${fileId}`;
    fileByBatch.set(id, fileId);
    return { id, status: 'validating' };
  };
  openai.retrieveBatch = claude.retrieveBatch;
  openai.iterateBatchResults = async function* (batchId: string) {
    const fileId = fileByBatch.get(batchId);
    assert.ok(fileId, '48: OpenAI stub has no file for the batch');
    const lines = linesByFile.get(fileId);
    assert.ok(lines?.length, '48: OpenAI stub captured no requests');

    for (const line of lines) {
      const row = JSON.parse(line);
      yield {
        customId: row.custom_id,
        type: 'succeeded',
        text: /Focus lane:/.test(row.body.instructions)
          ? '- a lane bullet'
          : synthesisText,
        inputTokens: 10,
        outputTokens: 20,
      };
    }
  };
  openai.createMessage = async (
    model: string, _max: number, instruction: string, input: any,
  ) => complete(model, instruction, input, 'openai');
  openai.createVisionViaCodex = async () => {
    throw new Error('48: vision must not run');
  };

  return repairs;
}

async function execute(
  site: Site,
  title: string,
  detected: boolean,
  synthesisText: string,
  repairText = synthesisText,
) {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR);
  exportedPaths.length = 0;

  const run = ++serial;
  const repairs = installStubs(site, synthesisText, repairText, run);
  const customId = `explainer-c48-${run}`;
  const input = `https://example.org/${customId}`;
  const item = {
    customId,
    input,
    source: { kind: 'url' as const, url: input },
    isUrl: true,
    htmlContent: 'The complete paper describes the engine procedure.',
    publishedOn: PUBLISHED_ON,
    ...(detected ? { detectedCitation: DETECTED } : {}),
  };

  const id = site.sync
    ? await batch.runSync(site.provider, [item as any])
    : await batch.submitBatch(site.provider, [item as any]);

  assert.ok(id.length > 0, '48: route returned an empty batch id');
  if (!site.sync) await batch.pollAndRetrieve(site.provider, id);

  const savedBatch = stateMod.getBatchById(stateMod.readState(), id);
  assert.ok(savedBatch, '48: batch missing after completion');
  assert.match(savedBatch.submitted_at, /^\d{4}-\d{2}-\d{2}T/, '48: submit time missing');
  const req = savedBatch.requests[customId];
  assert.ok(req, '48: paper request missing after completion');

  const date = savedBatch.submitted_at.slice(0, 10);
  const family = detected ? 'lovelace' : 'turing';
  const slug = `${date}_${family}_${title}_explainer`;

  return { req, date, slug, repairs, customId, input };
}

function readSaved(relativeFile: string): Record<string, any> {
  assert.ok(relativeFile.length > 0, '48: saved relative path is empty');
  const file = path.join(OUT_DIR, relativeFile);
  assert.ok(fs.existsSync(file), `48: saved JSON missing: ${relativeFile}`);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.trim().length > 0, '48: saved JSON is empty');
  const article = JSON.parse(text);
  const parsed = contract.ExplainerV2.safeParse(article);
  assert.ok(parsed.success, `48: saved JSON fails ExplainerV2: ${
    parsed.success ? '' : parsed.error.message
  }`);
  return article;
}

function filesBelow(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesBelow(full) : [full];
  });
}

test('48: the literal fixtures are valid v2 wire output', () => {
  const plain = wire('fixture');
  assert.ok(contract.ModelOutputV2.safeParse(plain).success, '48: invalid plain wire fixture');
  plain.charts = [chart()];
  assert.ok(contract.ModelOutputV2.safeParse(plain).success, '48: invalid chart wire fixture');
});

for (const site of SITES) {
  for (const detected of [true, false]) {
    test(`48: ${site.name} saves with ${detected ? 'detected' : 'model'} citation`, async () => {
      const title = `${site.name}-${detected ? 'known' : 'model'}`;
      const result = await execute(site, title, detected, JSON.stringify(wire(title)));
      const { req, slug, date, input, repairs } = result;

      assert.equal(req.result, 'succeeded', `48: ${site.name} did not succeed`);
      assert.equal(req.output, `${slug}.json`, `48: ${site.name} output is not relative`);
      const article = readSaved(`${slug}.json`);

      assert.equal(article.version, 2, '48: saved version is not 2');
      assert.equal(article.metadata.slug, slug, '48: incorrect stamped slug');
      assert.equal(article.metadata.route, site.route, '48: incorrect route mapping');
      assert.equal(article.metadata.provider, site.provider, '48: incorrect provider');
      assert.equal(article.metadata.model, site.model, '48: incorrect synthesis model');
      assert.equal(article.metadata.date_created, date, '48: date is not the submit date');
      assert.equal(article.hero.publication_date, PUBLISHED_ON, '48: publication date lost');
      assert.deepEqual(article.metadata.source, { kind: 'url', ref: input }, '48: source lost');
      assert.deepEqual(
        article.references[0],
        { ...(detected ? DETECTED : MODEL_CITATION), origin: detected ? 'detected' : 'model' },
        '48: reference is not the selected citation with its origin',
      );
      assert.equal(repairs.length, 0, '48: valid wire output triggered repair');
      assert.deepEqual(
        exportedPaths,
        [path.join(OUT_DIR, `${slug}.json`)],
        '48: successful output did not reach HTML export',
      );
    });
  }

  test(`48: ${site.name} adopts one repair and accounts for its tokens`, async () => {
    const title = `${site.name}-repair`;
    const broken = wire(title);
    broken.charts = [chart()];
    broken.hero.subtitle = '';

    const reply = wire(title);
    reply.hero.subtitle = 'The repaired account describes the engine procedure.';
    reply.charts = [];

    const { req, slug, repairs } = await execute(
      site, title, false, JSON.stringify(broken), JSON.stringify(reply),
    );

    assert.equal(req.result, 'succeeded', '48: repaired paper did not succeed');
    assert.equal(req.output, `${slug}.json`, '48: repaired output path is incorrect');
    assert.equal(repairs.length, 1, '48: expected exactly one repair');
    assert.ok(repairs[0].instruction.trim().length > 0, '48: empty repair instruction');
    assert.equal(
      repairs[0].model,
      site.provider === 'claude' ? 'claude-sonnet-5-5' : 'gpt-5.6-luna',
      '48: incorrect repair model',
    );
    assert.equal(
      repairs[0].transport,
      site.provider === 'openai'
        ? 'openai'
        : site.mode === 'claude_cli' ? 'claude-cli' : 'claude-api',
      '48: repair used the wrong provider transport',
    );

    const payload = JSON.parse(repairs[0].payload);
    assert.deepEqual(payload.charts, [], '48: repair payload contains chart data');
    assert.equal(payload.hero.subtitle, '', '48: repair did not receive the broken field');

    const article = readSaved(`${slug}.json`);
    assert.equal(
      article.hero.subtitle,
      'The repaired account describes the engine procedure.',
      '48: repair reply was not adopted',
    );
    assert.equal(article.charts.length, 1, '48: original chart was lost during repair');
    assert.deepEqual(
      article.charts[0].series[0].values,
      [2, 5, 9, 14, 20, 27],
      '48: original chart values changed during repair',
    );
    assert.ok(req.usage, '48: repaired request has no usage');
    assert.equal(req.usage.input_tokens, 17, '48: repair input tokens were not added');
    assert.equal(req.usage.output_tokens, 31, '48: repair output tokens were not added');
  });

  test(`48: ${site.name} keeps unparseable synthesis as raw output only`, async () => {
    const raw = 'RAW-SYNTHESIS-MARKER { unfinished output';
    const { req } = await execute(site, `${site.name}-invalid`, false, raw);

    assert.equal(req.result, 'errored', '48: unparseable synthesis did not error');
    assert.equal(typeof req.error, 'string', '48: invalid synthesis has no error text');
    assert.match(req.error!, /^INVALID_JSON:/, '48: incorrect invalid JSON error code');

    const files = filesBelow(OUT_DIR);
    const errors = files.filter(file => /_error\.txt$/.test(file));
    assert.equal(errors.length, 1, '48: expected exactly one raw error file');
    assert.equal(fs.readFileSync(errors[0], 'utf8'), raw, '48: raw synthesis was altered');
    assert.equal(
      files.filter(file => /\.json$/.test(file)).length,
      0,
      '48: unparseable synthesis wrote JSON',
    );
    assert.equal(exportedPaths.length, 0, '48: invalid synthesis reached HTML export');
  });

  test(`48: ${site.name} saves a surviving editorial issue for review`, async () => {
    const title = `${site.name}-review`;
    const editorial = wire(title);
    editorial.sections = Array.from({ length: 6 }, () => ({
      label: 'Limits',
      paragraphs: ['The account does not establish wider effects.'],
      list: null,
      table: null,
    }));

    const { req, slug, repairs } = await execute(
      site, title, true, JSON.stringify(editorial),
    );

    assert.ok(repairs.length > 0, '48: editorial issue was never offered for repair');
    assert.equal(req.result, 'succeeded', '48: review item is not marked succeeded');
    assert.equal(req.output, `review/${slug}.json`, '48: review output path is incorrect');

    const article = readSaved(`review/${slug}.json`);
    assert.equal(article.sections.length, 6, '48: surviving editorial content was lost');
    assert.ok(
      article.metadata.quality.issues.length > 0,
      '48: review item has no surviving quality issue',
    );
    assert.match(
      article.metadata.quality.issues.join('\n'),
      /sections/i,
      '48: quality record does not name the section bound',
    );
    assert.equal(
      fs.existsSync(path.join(OUT_DIR, `${slug}.json`)),
      false,
      '48: review item was also saved as a normal output',
    );
    assert.equal(exportedPaths.length, 0, '48: review item reached HTML export');
  });
}

test('48: batch has one seam caller and six completion calls', () => {
  const ts = require('typescript') as typeof import('typescript');
  const source = fs.readFileSync(path.join(REPO_ROOT, 'src/batch.ts'), 'utf8');
  assert.ok(source.trim().length > 0, '48: src/batch.ts is empty');
  assert.doesNotMatch(
    source,
    /\b(?:saveResult|repairUntilValid|maybeRepairClaude|maybeRepairOpenAI)\b/,
    '48: legacy save or repair name remains in src/batch.ts',
  );

  const ast = ts.createSourceFile(
    'batch.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
  );
  const calls: import('typescript').CallExpression[] = [];
  const helpers: import('typescript').FunctionDeclaration[] = [];

  const visit = (node: import('typescript').Node): void => {
    if (ts.isCallExpression(node)) calls.push(node);
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'saveThroughSeam') {
      helpers.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);

  const namedCalls = (name: string) => calls.filter(call =>
    ts.isIdentifier(call.expression) && call.expression.text === name,
  );
  const seamCalls = namedCalls('finalizeResult');

  assert.equal(helpers.length, 1, '48: expected one saveThroughSeam helper');
  assert.ok(helpers[0].body, '48: saveThroughSeam has no body');
  assert.equal(seamCalls.length, 1, '48: expected one finalizeResult call');

  let owner: import('typescript').Node | undefined = seamCalls[0].parent;
  while (owner && owner !== helpers[0]) owner = owner.parent;
  assert.equal(owner, helpers[0], '48: finalizeResult is not inside saveThroughSeam');
  assert.equal(
    namedCalls('saveThroughSeam').length,
    6,
    '48: expected six saveThroughSeam completion calls',
  );

  const output = require('../../src/output') as any;
  assert.equal(typeof output.saveRawOutput, 'function', '48: saveRawOutput is not exported');
});
// AUTOMETTA-CONTRACT-END

test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});
