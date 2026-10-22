import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-47-'));
for (const dir of ['input', 'output', 'jobs']) fs.mkdirSync(path.join(TMP, dir));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/47-requests-ask-for-the-v2-wire-shape.md
Object.assign(process.env, {
  EXPLAINER_STATE_FILE: path.join(TMP, 'state.json'),
  EXPLAINER_INPUT_DIR: path.join(TMP, 'input'),
  EXPLAINER_OUTPUT_DIR: path.join(TMP, 'output'),
  EXPLAINER_OBSIDIAN_DIR: '',
  EXPLAINER_JOBS_DIR: path.join(TMP, 'jobs'),
  WEBSITE_REPO: '',
  ANTHROPIC_API_KEY: 'contract-test-not-a-key',
  CLAUDE_CODE_OAUTH_TOKEN: '',
  OPENAI_API_KEY: 'contract-test-not-a-key',
  OPENAI_USE_LANES: '0',
  STRUCTURED_OUTPUT: '1',
  FIGURE_RECREATE: '0',
});
for (const key of [
  'MODEL', 'MODEL_BATCH', 'MODEL_LANE', 'MODEL_SYNTHESIS', 'MODEL_REPAIR',
  'PROVIDER', 'FIGURE_VLM_PROVIDER', 'FIGURE_VLM_MODEL',
]) {
  delete process.env[key];
}

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error('47: network forbidden');
}) as typeof fetch;

const prompt = require('../../src/prompt');
const preprocess = require('../../src/preprocess');
const batch = require('../../src/batch');
const providers = require('../../src/providers');
const stateMod = require('../../src/state');
const ts = require('typescript') as typeof import('typescript');

const FILL = "Fill `citation` from the paper's front matter: the authors in order, the year, the full title, the venue and a URL.";
const KNOWN = "The paper's citation is already known: set `citation` to null.";
const NO_IMAGE = 'Never emit an `image` block: the figure pipeline locates and attaches the figure.';
const PIN = 'A sidecar pins Figure 3 as the lead figure; set `figure_request.label` to it and write `why` for it.';
const EMPHASIS = '\n\nREADER EMPHASIS FOR THIS PAPER\nFocus on liquidity.\nWeight the pills, sections, and charts toward this angle where the paper supports it. If the paper does not cover it, do not invent content; stay faithful to the source.';

function nonempty(value: unknown, label: string): asserts value is string {
  assert.equal(typeof value, 'string', `47: ${label} type`);
  assert.ok((value as string).trim().length > 0, `47: ${label} empty`);
}

function read(relative: string): string {
  const text = fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
  nonempty(text, relative);
  return text;
}

function dialect(provider: 'claude' | 'openai'): Record<string, unknown> {
  const value = JSON.parse(read(`contract/generated/model-output.${provider}.json`));
  assert.ok(value && typeof value === 'object' && !Array.isArray(value),
    `47: ${provider} dialect object`);
  assert.ok(Object.keys(value).length > 0, `47: ${provider} dialect empty`);
  return value;
}

function wireModule(): any {
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'src/wire-schema.ts')),
    '47: wire-schema missing');
  return require('../../src/wire-schema');
}

function citationSentence(text: unknown, known: boolean, label: string): void {
  nonempty(text, label);
  const wanted = known ? KNOWN : FILL;
  const unwanted = known ? FILL : KNOWN;
  assert.equal(text.split(wanted).length - 1, 1, `47: ${label} citation sentence`);
  assert.ok(!text.includes(unwanted), `47: ${label} opposite citation sentence`);
}

function userText(messages: any, label: string): string {
  assert.ok(Array.isArray(messages) && messages.length > 0,
    `47: ${label} messages`);
  const users = messages.filter((message: any) => message.role === 'user');
  assert.equal(users.length, 1, `47: ${label} user count`);
  const content = users[0].content;
  let text: string;
  if (typeof content === 'string') {
    text = content;
  } else {
    assert.ok(Array.isArray(content) && content.length > 0,
      `47: ${label} content`);
    text = content
      .filter((block: any) => block.type === 'text' || block.type === 'input_text')
      .map((block: any) => {
        nonempty(block.text, `${label} block`);
        return block.text;
      })
      .join('\n');
  }
  nonempty(text, label);
  return text;
}

const DETECTED_CITATION = {
  authors: [{ family: 'Acharya', given: 'V.' }],
  year: 2024,
  title: 'Liquidity',
  venue: 'Journal of Finance',
  url: 'https://doi.org/10.1000/xyz',
};

function makeItem(customId: string, known: boolean) {
  return {
    customId,
    input: `https://example.org/${customId}`,
    source: { kind: 'url' as const, url: `https://example.org/${customId}` },
    isUrl: true,
    htmlContent: 'FULL-PAPER-47: the paper body.',
    detectedSurname: 'Acharya',
    detectedPublished: 'Published March 2024',
    detectedReference: 'Acharya, V. (2024). <em>Liquidity</em>.',
    ...(known ? {
      detectedCitation: DETECTED_CITATION,
      publishedOn: '2024-03',
    } : {}),
  };
}

function persisted(id: string, items: ReturnType<typeof makeItem>[]): void {
  nonempty(id, 'batch id');
  const saved = stateMod.getBatchById(stateMod.readState(), id);
  assert.ok(saved, '47: batch not persisted');
  assert.ok(saved.requests && Object.keys(saved.requests).length > 0,
    '47: requests not persisted');
  for (const item of items) {
    const req = saved.requests[item.customId];
    assert.ok(req, '47: request not persisted');
    if (item.detectedCitation !== undefined) {
      assert.deepEqual(req.detectedCitation, DETECTED_CITATION,
        '47: citation not persisted');
      assert.equal(req.publishedOn, '2024-03', '47: publishedOn not persisted');
    } else {
      assert.equal(req.detectedCitation, undefined, '47: unknown citation invented');
    }
  }
}

test('47: user turns ask for citation and retain figure rules', () => {
  const unknown = prompt.buildUserInstruction('2026-10-22');
  const known = prompt.buildUserInstruction('2026-10-22', undefined, undefined, true);
  citationSentence(unknown, false, 'unknown');
  citationSentence(known, true, 'known');

  for (const text of [unknown, known]) {
    nonempty(text, 'user instruction');
    assert.doesNotMatch(text,
      /metadata\.date_created|filename_slug|Published Month Year|metadata|Chart\.js|slug|2026-10-22/,
      '47: obsolete user rule');
    for (const required of ['prefer a table', 'stated', '`figure_request`', NO_IMAGE]) {
      assert.ok(text.includes(required), `47: missing ${required}`);
    }
    assert.doesNotMatch(text, /[\u2014\u2015]/, '47: user em dash');
  }

  assert.equal(prompt.buildUserInstruction('2031-02-03'), unknown,
    '47: unknown turn depends on date');
  assert.equal(prompt.buildUserInstruction('2031-02-03', undefined, undefined, true),
    known, '47: known turn depends on date');
});

test('47: known citation preserves pin and emphasis order', () => {
  const base = prompt.buildUserInstruction('2026-10-22', undefined, undefined, true);
  nonempty(base, 'known base');
  const pinned = prompt.buildUserInstruction('2026-10-22', undefined, 'Figure 3', true);
  nonempty(pinned, 'known pinned');
  assert.equal(pinned, `${base} ${PIN}`, '47: pin sentence or order changed');

  const focused = prompt.buildUserInstruction(
    '2026-10-22', '  Focus on liquidity.  ', 'Figure 3', true,
  );
  nonempty(focused, 'known focused');
  citationSentence(focused, true, 'focused');
  assert.equal(focused, `${base} ${PIN}${EMPHASIS}`,
    '47: emphasis text or order changed');
  assert.doesNotMatch(focused, /[\u2014\u2015]/, '47: focused em dash');
  assert.equal(
    prompt.buildUserInstruction('2031-02-03', '  Focus on liquidity.  ', 'Figure 3', true),
    focused, '47: focused turn depends on date',
  );
});

test('47: generated dialects and structured-output re-export', () => {
  const wire = wireModule();
  assert.equal(typeof wire.wireSchema, 'function', '47: wireSchema export');
  for (const provider of ['claude', 'openai'] as const) {
    const expected = dialect(provider);
    const actual = wire.wireSchema(provider);
    assert.ok(actual && Object.keys(actual).length > 0, '47: wire schema empty');
    assert.deepEqual(actual, expected, `47: ${provider} wire dialect`);
  }

  assert.equal(typeof wire.structuredOutputEnabled, 'function',
    '47: structuredOutputEnabled export');
  const legacy = require('../../src/schema/explainer-schema');
  assert.strictEqual(legacy.structuredOutputEnabled, wire.structuredOutputEnabled,
    '47: structuredOutputEnabled not re-exported');

  const before = process.env.STRUCTURED_OUTPUT;
  try {
    delete process.env.STRUCTURED_OUTPUT;
    assert.equal(wire.structuredOutputEnabled(), true, '47: structured default');
    process.env.STRUCTURED_OUTPUT = '0';
    assert.equal(wire.structuredOutputEnabled(), false, '47: structured off');
    process.env.STRUCTURED_OUTPUT = '1';
    assert.equal(wire.structuredOutputEnabled(), true, '47: structured on');
    process.env.STRUCTURED_OUTPUT = 'false';
    assert.equal(wire.structuredOutputEnabled(), true, '47: structured semantics changed');
  } finally {
    if (before === undefined) delete process.env.STRUCTURED_OUTPUT;
    else process.env.STRUCTURED_OUTPUT = before;
  }
});

test('47: request modules no longer import the v1 schema', () => {
  for (const file of ['src/batch.ts', 'src/providers.ts']) {
    const text = read(file);
    assert.doesNotMatch(text, /EXPLAINER_JSON_SCHEMA/, `47: ${file} v1 schema`);
    assert.doesNotMatch(text,
      /\bfrom\s*['"]\.\/schema\/explainer-schema(?:\.ts|\.js)?['"]/,
      `47: ${file} v1 import`);
  }
  assert.match(read('src/batch.ts'),
    /\bimport\s*\{[^}]*\bwireSchema\b[^}]*\}\s*from\s*['"]\.\/wire-schema['"]/s,
    '47: batch wireSchema import');

  const definitions: string[] = [];
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts')) {
        const relative = path.relative(REPO_ROOT, full);
        const source = ts.createSourceFile(full, read(relative), ts.ScriptTarget.Latest, true);
        const visit = (node: import('typescript').Node): void => {
          if (ts.isFunctionDeclaration(node)
            && node.name?.text === 'openAIJsonSchemaFormat'
            && node.body) {
            definitions.push(relative);
          }
          if (ts.isVariableDeclaration(node)
            && ts.isIdentifier(node.name)
            && node.name.text === 'openAIJsonSchemaFormat'
            && node.initializer) {
            definitions.push(relative);
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
      }
    }
  }
  walk(path.join(REPO_ROOT, 'src'));
  assert.deepEqual(definitions, ['src/providers.ts'],
    '47: OpenAI format constructor not unique');
});

test('47: Claude batch sends its dialect and citation-aware user turns', async t => {
  const captures: any[] = [];
  t.mock.method(providers.ClaudeProvider.prototype as any, 'getClient', () => ({
    messages: {
      batches: {
        create: async (body: unknown) => {
          captures.push(body);
          return { id: 'msgbatch_contract47', processing_status: 'in_progress' };
        },
      },
    },
  }));

  const items = [
    makeItem('explainer-c47-claude-known', true),
    makeItem('explainer-c47-claude-unknown', false),
  ];
  const id = await batch.submitBatch('claude', items);
  assert.equal(captures.length, 1, '47: Claude submission count');
  const rows = captures[0].requests;
  assert.ok(Array.isArray(rows) && rows.length > 0, '47: Claude requests empty');
  assert.deepEqual(rows.map((row: any) => row.custom_id), items.map(item => item.customId),
    '47: Claude request ids');
  const expected = dialect('claude');
  for (const item of items) {
    const row = rows.find((candidate: any) => candidate.custom_id === item.customId);
    assert.ok(row?.params, '47: Claude params missing');
    assert.ok(Array.isArray(row.params.tools) && row.params.tools.length > 0,
      '47: Claude tools missing');
    assert.deepEqual(row.params.tools[0].input_schema, expected,
      '47: Claude input_schema dialect');
    assert.equal(row.params.tools[0].name, 'emit_explainer', '47: Claude tool name');
    assert.deepEqual(row.params.tool_choice,
      providers.acceptsForcedToolChoice(row.params.model)
        ? { type: 'tool', name: 'emit_explainer' }
        : { type: 'auto' },
      '47: Claude tool choice changed');
    const text = userText(row.params.messages, item.customId);
    assert.match(text, /FULL-PAPER-47/, '47: Claude paper missing');
    citationSentence(text, item.detectedCitation !== undefined, item.customId);
  }
  persisted(id, items);
});

test('47: OpenAI batch sends its dialect and citation-aware user turns', async t => {
  const uploads: string[] = [];
  const submitted: string[] = [];
  const proto = providers.OpenAIProvider.prototype;
  t.mock.method(proto, 'authMode', () => 'api_key');
  t.mock.method(proto, 'requireBatchAuth', () => undefined);
  t.mock.method(proto, 'uploadJsonl', async (lines: string) => {
    nonempty(lines, 'OpenAI JSONL');
    uploads.push(lines);
    return 'file-contract47';
  });
  t.mock.method(proto, 'createBatch', async (fileId: string) => {
    submitted.push(fileId);
    return { id: 'batch_contract47', status: 'validating' };
  });

  const items = [
    makeItem('explainer-c47-openai-known', true),
    makeItem('explainer-c47-openai-unknown', false),
  ];
  const id = await batch.submitBatch('openai', items);
  assert.equal(uploads.length, 1, '47: OpenAI upload count');
  assert.deepEqual(submitted, ['file-contract47'], '47: OpenAI upload not submitted');
  nonempty(uploads[0], 'OpenAI uploaded body');
  const rows = uploads[0].split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert.deepEqual(rows.map(row => row.custom_id), items.map(item => item.customId),
    '47: OpenAI request ids');
  const expected = dialect('openai');
  for (const item of items) {
    const row = rows.find(candidate => candidate.custom_id === item.customId);
    assert.ok(row?.body, '47: OpenAI body missing');
    assert.equal(row.method, 'POST', '47: OpenAI method');
    assert.equal(row.url, '/v1/responses', '47: OpenAI endpoint');
    assert.ok(row.body.text?.format, '47: OpenAI format missing');
    assert.deepEqual(row.body.text.format, {
      type: 'json_schema', name: 'explainer', strict: true, schema: expected,
    }, '47: OpenAI format dialect');
    const text = userText(row.body.input, item.customId);
    assert.match(text, /FULL-PAPER-47/, '47: OpenAI paper missing');
    citationSentence(text, item.detectedCitation !== undefined, item.customId);
  }
  persisted(id, items);
});

function assertPlainStrings(value: unknown): void {
  let count = 0;
  function visit(node: unknown): void {
    if (typeof node === 'string') {
      nonempty(node, 'citation string');
      // Decoded "&" is required by the literal title fixture.
      assert.doesNotMatch(node, /<[A-Za-z\/!]|&(?:#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/,
        '47: citation markup or entity');
      count += 1;
    } else if (Array.isArray(node)) {
      for (const child of node) visit(child);
    } else if (node && typeof node === 'object') {
      for (const child of Object.values(node)) visit(child);
    }
  }
  visit(value);
  assert.ok(count > 0, '47: no citation strings checked');
}

test('47: buildCitation maps literal metadata to literal citations', () => {
  assert.equal(typeof preprocess.buildCitation, 'function', '47: buildCitation export');
  const fixtures = [
    {
      meta: {
        authors: ['Acharya, Vivek', 'Jean Paul Sartre'],
        title: 'Bank runs &amp; liquidity',
        date: '2024/03/05',
        doi: '10.1000/xyz',
        journal: 'Journal of Finance',
      },
      url: 'https://example.org/p',
      expected: {
        authors: [
          { family: 'Acharya', given: 'V.' },
          { family: 'Sartre', given: 'J. P.' },
        ],
        year: 2024,
        title: 'Bank runs & liquidity',
        venue: 'Journal of Finance',
        url: 'https://doi.org/10.1000/xyz',
      },
    },
    {
      meta: {
        authors: ['Ada Lovelace'],
        title: 'Notes on engines',
        date: '2025/07/20',
      },
      url: 'https://arxiv.org/html/2507.15003v2',
      expected: {
        authors: [{ family: 'Lovelace', given: 'A.' }],
        year: 2025,
        title: 'Notes on engines',
        venue: 'arXiv preprint arXiv:2507.15003',
        url: 'https://arxiv.org/abs/2507.15003v2',
      },
    },
    {
      meta: { authors: ['Plato'], title: 'Republic' },
      url: 'https://example.org/republic',
      expected: {
        authors: [{ family: 'Plato' }],
        title: 'Republic',
        url: 'https://example.org/republic',
      },
    },
    {
      meta: {
        authors: ['<i>Acharya</i>, <b>Vivek</b>'],
        title: '<em>Liquidity</em> &amp; evidence',
        journal: '<strong>Research Review</strong>',
      },
      url: 'https://example.org/p',
      expected: {
        authors: [{ family: 'Acharya', given: 'V.' }],
        title: 'Liquidity & evidence',
        venue: 'Research Review',
        url: 'https://example.org/p',
      },
    },
  ];

  for (const fixture of fixtures) {
    const actual = preprocess.buildCitation(fixture.meta, fixture.url);
    assert.ok(actual && typeof actual === 'object', '47: citation missing');
    assert.deepEqual(actual, fixture.expected, '47: citation literal mapping');
    assertPlainStrings(actual);
  }

  const plato = preprocess.buildCitation(
    { authors: ['Plato'], title: 'Republic' }, 'https://example.org/republic',
  );
  assert.ok(plato?.authors?.length > 0, '47: Plato author missing');
  assert.equal(Object.hasOwn(plato.authors[0], 'given'), false,
    '47: absent given must be omitted');
  assert.equal(Object.hasOwn(plato, 'year'), false,
    '47: absent year must be omitted');

  assert.equal(
    preprocess.buildCitation({ authors: ['Plato'] }, 'https://example.org/p'),
    undefined, '47: citation without title',
  );
  assert.equal(
    preprocess.buildCitation({ authors: [], title: 'Republic' }, 'https://example.org/p'),
    undefined, '47: citation without authors',
  );
});

test('47: publishedOnFrom returns a month or undefined', () => {
  assert.equal(typeof preprocess.publishedOnFrom, 'function',
    '47: publishedOnFrom export');
  assert.equal(preprocess.publishedOnFrom('2024/03/05'), '2024-03',
    '47: slash date month');
  assert.equal(preprocess.publishedOnFrom('2024-11'), '2024-11',
    '47: year-month date');
  assert.equal(preprocess.publishedOnFrom(undefined), undefined,
    '47: missing date');
  assert.equal(preprocess.publishedOnFrom('2024'), undefined,
    '47: year alone has no month');
});

// AUTOMETTA-CONTRACT-END
