import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-46-')));
for (const dir of ['input', 'output', 'website', 'mirror']) fs.mkdirSync(path.join(TMP, dir));
const OUT_DIR = path.join(TMP, 'output');
const REVIEW_DIR = path.join(OUT_DIR, 'review');
const STAGING_DIR = path.join(TMP, 'website', 'explainers-new');
const MIRROR_DIR = path.join(TMP, 'mirror');

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/46-the-finalise-seam-saves-v2.md
Object.assign(process.env, {
  EXPLAINER_STATE_FILE: path.join(TMP, 'state.json'),
  EXPLAINER_INPUT_DIR: path.join(TMP, 'input'),
  EXPLAINER_OUTPUT_DIR: OUT_DIR,
  EXPLAINER_OBSIDIAN_DIR: MIRROR_DIR,
  WEBSITE_REPO: path.join(TMP, 'website'),
  FIGURE_RECREATE: '0',
});
delete process.env.MIN_CHART_POINTS;
globalThis.fetch = (async () => {
  throw new Error('46: network forbidden');
}) as typeof fetch;

const EXPECTED_DATE = '2026-10-22';
const FORBIDDEN_INSTRUCTION = /date_created|filename_slug|slug|metadata|publication_date|references/i;
const DETECTED = {
  authors: [{ family: 'Jones', given: 'A.' }],
  year: 2025,
  title: 'Detected research paper',
  venue: 'Research Journal',
  url: 'https://example.org/detected',
};

function doc(title: string): Record<string, any> {
  return {
    hero: {
      title,
      headline: 'Governed agents separate planning from execution',
      emphasis: null,
      subtitle: 'The paper describes explicit controls for tool use.',
    },
    top_block: {
      kind: 'pills',
      pills: [
        { lead: 'Governance', text: 'Policy checks precede tool use.' },
        { lead: 'Audit trail', text: 'Recorded decisions support inspection.' },
      ],
    },
    sections: [
      {
        label: 'Architecture',
        paragraphs: ['The paper separates planning from execution.'],
        list: null,
        table: null,
      },
      {
        label: 'Evidence',
        paragraphs: [
          'Table 2 states 12.5, 30.1, 7.2, 44, 18 and 26 ms for the measured cases.',
        ],
        list: null,
        table: null,
      },
      {
        label: 'Limits',
        paragraphs: ['The reported measurements describe the tested cases.'],
        list: null,
        table: null,
      },
    ],
    charts: [{
      kind: 'bar',
      title: 'Measured latency',
      caption: 'Latency varies across the measured cases.',
      x: {
        label: 'Case',
        unit: null,
        type: 'category',
        values: ['A', 'B', 'C', 'D', 'E', 'F'],
      },
      y: { label: 'Latency', unit: 'ms', scale: 'linear' },
      series: [{
        name: 'Measured',
        values: [12.5, 30.1, 7.2, 44, 18, 26],
        points: null,
        source: { kind: 'table', ref: 'Table 2', page: 4 },
      }],
    }],
    figure_request: {
      label: 'Figure 1',
      why: 'The diagram shows the separation of planning and execution.',
    },
    end_takeaway: {
      label: 'Implication',
      body: 'Explicit policy checks make agent decisions easier to inspect.',
    },
    citation: {
      authors: [{ family: 'Smith', given: null }],
      year: 2026,
      title: 'Governed agent architectures',
      venue: null,
      url: 'https://example.org/paper',
    },
  };
}

function receipt(text: string, over: Record<string, unknown> = {}): Record<string, any> {
  return {
    provider: 'openai', route: 'batch-api', stage: 'synthesis', model: 'gpt-5.6-terra',
    customId: 'cid-46', attemptId: 'attempt-1', finishReason: 'stop', text,
    usage: {
      in: 1000, out: 500, cacheRead: 0, cacheWrite5m: 0,
      cacheWrite1h: 0, source: 'reported',
    },
    ...over,
  };
}

function repairReply(text: string): Record<string, any> {
  return receipt(text, {
    stage: 'repair', route: 'sync-api', model: 'gpt-5.6-luna',
    attemptId: `repair-${crypto.randomUUID()}`,
  });
}

function store() {
  const map = new Map<string, string>();
  return {
    map,
    get(key: string) {
      const value = map.get(key);
      return value === undefined ? undefined : JSON.parse(value);
    },
    put(key: string, value: unknown) {
      assert.ok(typeof key === 'string' && key.length > 0, '46: checkpoint key');
      map.set(key, JSON.stringify(value));
    },
  };
}

function repairer(replies: Array<Record<string, any>>) {
  const calls: Array<{ instruction: string; payload: string }> = [];
  const fn = async (instruction: string, payload: string) => {
    assert.ok(typeof instruction === 'string' && instruction.length > 0, '46: instruction');
    assert.doesNotMatch(instruction, FORBIDDEN_INSTRUCTION, '46: wire instruction only');
    assert.ok(typeof payload === 'string' && payload.length > 0, '46: payload');
    calls.push({ instruction, payload });
    const next = replies.shift();
    assert.ok(next, '46: unexpected repair');
    return next;
  };
  return { fn, calls };
}

function ctx(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { stamp: { expectedDate: EXPECTED_DATE }, checkpoints: store(), ...over };
}

function seam(): Record<string, any> {
  const mod = require('../../src/finalize') as Record<string, any>;
  assert.equal(typeof mod.finalizeResult, 'function', '46: finalizeResult');
  return mod;
}

async function run(
  key: string,
  wire: Record<string, any>,
  over: Record<string, unknown> = {},
): Promise<any> {
  return seam().finalizeResult(key, receipt(JSON.stringify(wire)), ctx(over));
}

function saved(outcome: any): Record<string, any> {
  assert.ok(typeof outcome.jsonPath === 'string' && outcome.jsonPath.length > 0, '46: path');
  assert.ok(fs.existsSync(outcome.jsonPath), '46: saved file');
  const article = JSON.parse(fs.readFileSync(outcome.jsonPath, 'utf8'));
  assert.deepEqual(article, outcome.article, '46: saved article');
  return article;
}

function dropped(article: any, fragment: string): void {
  assert.ok(article.metadata.quality.dropped.length > 0, '46: dropped record');
  assert.ok(
    article.metadata.quality.dropped.some((message: string) => message.includes(fragment)),
    `46: dropped ${fragment}`,
  );
}

function listOutputs(): string[] {
  const walk = (dir: string): string[] => fs.existsSync(dir)
    ? fs.readdirSync(dir).flatMap((name) => {
      const file = path.join(dir, name);
      return fs.statSync(file).isDirectory() ? walk(file) : [file];
    })
    : [];
  return [...walk(OUT_DIR), ...walk(STAGING_DIR), ...walk(MIRROR_DIR)].sort();
}

function sixSections(wire: Record<string, any>): Record<string, any> {
  wire.sections.push(
    { label: 'Controls', paragraphs: ['Policy gates constrain tool use.'], list: null, table: null },
    { label: 'Operations', paragraphs: ['Operators inspect recorded decisions.'], list: null, table: null },
    { label: 'Scope', paragraphs: ['Further evaluation remains necessary.'], list: null, table: null },
  );
  return wire;
}

test('46: exports and default chart minimum', () => {
  const mod = seam();
  for (const name of ['canonicaliseWire', 'wireIssues', 'stampArtefact', 'slugFor']) {
    assert.equal(typeof mod[name], 'function', `46: ${name}`);
  }
  const quality = require('../../src/quality') as Record<string, any>;
  assert.equal(typeof quality.chartIssues, 'function', '46: chartIssues');
  assert.equal(typeof quality.buildWireRepairInstruction, 'function', '46: wire instruction');
  const output = require('../../src/output') as Record<string, any>;
  assert.equal(output.MIN_CHART_POINTS, 6, '46: default minimum');

  const contract = require('../../contract/explainer-v2') as Record<string, any>;
  assert.equal(contract.ModelOutputV2.safeParse(doc('fixture')).success, true, '46: valid fixture');
  assert.deepEqual(
    quality.chartIssues(doc('chart').charts[0], 0),
    [],
    '46: stated chart passes',
  );
  const ordinal = doc('ordinal');
  ordinal.charts[0].series[0].values = [1, 2, 3, 4, 5, 6];
  const issues = quality.chartIssues(ordinal.charts[0], 0);
  assert.ok(issues.length > 0, '46: ordinal detected');
  assert.match(issues.join('\n'), /^charts\[0\]/, '46: chart path');
});

test('46: detected citation discards malformed model citation before repair', async () => {
  const wire = doc('known malformed');
  wire.citation.authors = [];
  const repair = repairer([]);
  const outcome = await run('known-malformed', wire, {
    stamp: { expectedDate: EXPECTED_DATE, detectedReference: DETECTED },
    repair: repair.fn,
  });
  assert.equal(repair.calls.length, 0, '46: no citation repair');
  assert.equal(outcome.status, 'succeeded', '46: success');
  const article = saved(outcome);
  assert.deepEqual(article.references[0], { ...DETECTED, origin: 'detected' }, '46: detected reference');
  dropped(article, 'citation');
});

test('46: detected citation with null model citation is not a drop', async () => {
  const wire = doc('known null');
  wire.citation = null;
  const repair = repairer([]);
  const outcome = await run('known-null', wire, {
    stamp: { expectedDate: EXPECTED_DATE, detectedReference: DETECTED },
    repair: repair.fn,
  });
  assert.equal(repair.calls.length, 0, '46: no repair');
  assert.equal(outcome.status, 'succeeded', '46: success');
  const article = saved(outcome);
  assert.deepEqual(article.references[0], { ...DETECTED, origin: 'detected' }, '46: detected reference');
  assert.equal(
    article.metadata.quality.dropped.some((message: string) => /citation/.test(message)),
    false,
    '46: null citation not dropped',
  );
});

test('46: unknown citation uses the model reference with nulls stripped', async () => {
  const repair = repairer([]);
  const outcome = await run('model-reference', doc('model reference'), { repair: repair.fn });
  assert.equal(outcome.status, 'succeeded', '46: success');
  assert.equal(repair.calls.length, 0, '46: no repair');
  assert.deepEqual(saved(outcome).references[0], {
    authors: [{ family: 'Smith' }],
    year: 2026,
    title: 'Governed agent architectures',
    url: 'https://example.org/paper',
    origin: 'model',
  }, '46: model reference');
});

test('46: unknown null citation is repaired once and adopted', async () => {
  const wire = doc('missing citation');
  wire.citation = null;
  const repair = repairer([repairReply(JSON.stringify(doc('missing citation')))]);
  const outcome = await run('missing-citation', wire, { repair: repair.fn });
  assert.equal(repair.calls.length, 1, '46: one citation repair');
  assert.match(repair.calls[0].instruction, /citation/i, '46: citation requested');
  assert.deepEqual(JSON.parse(repair.calls[0].payload).charts, [], '46: charts hidden');
  assert.equal(outcome.status, 'succeeded', '46: success');
  assert.equal(saved(outcome).references[0].origin, 'model', '46: model origin');
});

test('46: unknown keys are dropped before validation and cannot supply stamps', async () => {
  const wire = doc('unknown keys');
  Object.assign(wire, {
    version: 999,
    metadata: { date_created: '1900-01-01', model: 'injected-model', slug: 'injected-slug' },
    references: [{ title: 'Injected reference' }],
    lead_figure: { asset: 'injected.jpg' },
    image: { src: 'injected.png' },
  });
  wire.hero.publication_date = '1900-01';
  const repair = repairer([]);
  const outcome = await run('unknown-keys', wire, { repair: repair.fn });
  assert.equal(repair.calls.length, 0, '46: deterministic drops');
  assert.equal(outcome.status, 'succeeded', '46: success');
  const article = saved(outcome);
  for (const key of ['version', 'metadata', 'references', 'lead_figure', 'image', 'hero.publication_date']) {
    dropped(article, key);
  }
  assert.equal(article.version, 2, '46: stamped version');
  assert.equal(article.metadata.date_created, EXPECTED_DATE, '46: stamped date');
  assert.equal(article.metadata.model, 'gpt-5.6-terra', '46: receipt model');
  assert.equal(article.references[0].title, 'Governed agent architectures', '46: wire citation');
  assert.equal(Object.hasOwn(article, 'lead_figure'), false, '46: no lead figure');
  assert.equal(Object.hasOwn(article, 'image'), false, '46: no image');
  assert.equal(Object.hasOwn(article.hero, 'publication_date'), false, '46: no model publication date');
  assert.doesNotMatch(JSON.stringify(article), /injected|1900-01|999/, '46: injected values absent');
});

test('46: object nulls are stripped after stamping but array gaps survive', async () => {
  const wire = doc('null handling');
  wire.figure_request = null;
  wire.charts[0].x.values = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  wire.charts[0].series[0].values = [12.5, 30.1, null, 7.2, 44, 18, 26];

  const canonical = seam().canonicaliseWire(wire, { citationKnown: false });
  assert.equal(Object.hasOwn(canonical.wire.hero, 'emphasis'), true, '46: wire keeps emphasis key');
  assert.equal(canonical.wire.hero.emphasis, null, '46: wire keeps null');
  assert.equal(Object.hasOwn(canonical.wire.sections[0], 'list'), true, '46: wire keeps list key');
  assert.equal(canonical.wire.sections[0].list, null, '46: wire list null');
  assert.equal(canonical.wire.figure_request, null, '46: wire figure null');

  const repair = repairer([]);
  const outcome = await run('null-handling', wire, { repair: repair.fn });
  assert.equal(outcome.status, 'succeeded', '46: success');
  assert.equal(repair.calls.length, 0, '46: no repair');
  const article = saved(outcome);
  assert.equal(Object.hasOwn(article.hero, 'emphasis'), false, '46: emphasis absent');
  assert.equal(Object.hasOwn(article.sections[0], 'list'), false, '46: list absent');
  assert.equal(Object.hasOwn(article.sections[0], 'table'), false, '46: table absent');
  assert.equal(Object.hasOwn(article, 'figure_request'), false, '46: figure request absent');
  assert.equal(article.charts.length, 1, '46: gap chart retained');
  assert.deepEqual(
    article.charts[0].series[0].values,
    [12.5, 30.1, null, 7.2, 44, 18, 26],
    '46: array gap retained',
  );
  const { ExplainerV2 } = require('../../contract/explainer-v2');
  assert.equal(ExplainerV2.safeParse(article).success, true, '46: stored contract');
});

test('46: receipt and context supply every stamp', async () => {
  const { CONTRACT_REVISION } = require('../../contract/explainer-v2');
  for (const [route, expected] of [
    ['batch-api', 'batch'],
    ['sync-api', 'sync'],
    ['subscription-cli', 'sync'],
  ]) {
    const input = receipt(JSON.stringify(doc(`stamp ${route}`)), {
      provider: 'claude', model: 'claude-opus-4-8', route,
    });
    const outcome = await seam().finalizeResult(`stamp-${route}`, input, ctx({
      stamp: {
        expectedDate: EXPECTED_DATE,
        publishedOn: '2026-09',
        source: { kind: 'pdf', ref: 'paper.pdf' },
      },
    }));
    assert.equal(outcome.status, 'succeeded', '46: stamped success');
    const article = saved(outcome);
    assert.equal(article.version, 2, '46: version');
    assert.equal(article.metadata.model, 'claude-opus-4-8', '46: receipt model');
    assert.equal(article.metadata.provider, 'claude', '46: receipt provider');
    assert.equal(article.metadata.route, expected, '46: route');
    assert.equal(article.metadata.contract_revision, CONTRACT_REVISION, '46: revision');
    assert.equal(article.metadata.date_created, EXPECTED_DATE, '46: date');
    assert.deepEqual(article.metadata.source, { kind: 'pdf', ref: 'paper.pdf' }, '46: source');
    assert.equal(article.hero.publication_date, '2026-09', '46: publication date');
    assert.deepEqual(article.figure_request, doc('stamp').figure_request, '46: request retained');
  }
  const absent = await run('stamp-absent', doc('stamp absent'));
  assert.equal(absent.status, 'succeeded', '46: optional stamps absent');
  const article = saved(absent);
  assert.equal(Object.hasOwn(article.metadata, 'source'), false, '46: source absent');
  assert.equal(Object.hasOwn(article.hero, 'publication_date'), false, '46: publication absent');
  assert.equal(article.metadata.date_created, EXPECTED_DATE, '46: expected date');
});

test('46: slug transliteration, word boundary, fallback and output path', async () => {
  const { slugFor } = seam();
  assert.equal(
    slugFor(
      '2026-10-22',
      'Ångström-Núñez',
      'Agentic AI: a "governance" architecture for regulated finance teams at scale',
    ),
    '2026-10-22_angstrom-nunez_agentic-ai-a-governance-architecture-for_explainer',
    '46: literal slug',
  );
  assert.equal(
    slugFor('2026-10-22', '!!!', 'Governed agents'),
    '2026-10-22_paper_governed-agents_explainer',
    '46: family fallback',
  );
  assert.equal(
    slugFor('2026-10-22', 'abcdefghijklmnopqr stu', '!!!'),
    '2026-10-22_abcdefghijklmnopqr_paper_explainer',
    '46: family boundary and title fallback',
  );
  const wire = doc('Agentic AI: a "governance" architecture for regulated finance teams at scale');
  wire.citation.authors[0].family = 'Ångström-Núñez';
  const outcome = await run('slug-path', wire);
  assert.equal(outcome.status, 'succeeded', '46: slug success');
  const article = saved(outcome);
  assert.equal(
    article.metadata.slug,
    '2026-10-22_angstrom-nunez_agentic-ai-a-governance-architecture-for_explainer',
    '46: saved slug',
  );
  assert.match(article.metadata.slug, /^\d{4}-\d{2}-\d{2}_[a-z0-9][a-z0-9_-]*_explainer$/, '46: slug grammar');
  assert.equal(outcome.jsonPath, path.join(OUT_DIR, `${article.metadata.slug}.json`), '46: output path');
});

test('46: invalid charts are removed and repair cannot alter or add charts', async () => {
  for (const [key, values, labels] of [
    ['ordinal', [1, 2, 3, 4, 5, 6], ['A', 'B', 'C', 'D', 'E', 'F']],
    ['thin', [12.5, 30.1, 7.2, 44, 18], ['A', 'B', 'C', 'D', 'E']],
  ] as const) {
    const wire = doc(`chart ${key}`);
    wire.charts[0].series[0].values = [...values];
    wire.charts[0].x.values = [...labels];
    const repair = repairer([]);
    const outcome = await run(`chart-${key}`, wire, { repair: repair.fn });
    assert.equal(repair.calls.length, 0, '46: chart never repaired');
    assert.equal(outcome.status, 'succeeded', '46: chart removal succeeds');
    const article = saved(outcome);
    assert.deepEqual(article.charts, [], '46: chart removed');
    dropped(article, 'charts[0]');
    assert.deepEqual(article.metadata.quality.issues, [], '46: no surviving issue');
    assert.equal(outcome.jsonPath, path.join(OUT_DIR, `${article.metadata.slug}.json`), '46: normal output');
    assert.equal(fs.existsSync(path.join(REVIEW_DIR, `${article.metadata.slug}.json`)), false, '46: no review copy');
  }

  const clean = await run('chart-clean', doc('chart protection'));
  assert.equal(clean.status, 'succeeded', '46: clean baseline');
  assert.equal(clean.article.charts.length, 1, '46: baseline chart');
  assert.match(clean.chartDigest, /^[0-9a-f]{64}$/, '46: baseline digest');

  const broken = doc('chart protection');
  delete broken.hero.subtitle;
  const reply = doc('chart protection');
  reply.charts[0].series[0].values = [100, 200, 300, 400, 500, 600];
  reply.charts.push(JSON.parse(JSON.stringify(reply.charts[0])));
  const repair = repairer([repairReply(JSON.stringify(reply))]);
  const outcome = await run('chart-protected', broken, { repair: repair.fn });
  assert.equal(repair.calls.length, 1, '46: prose repair');
  assert.deepEqual(JSON.parse(repair.calls[0].payload).charts, [], '46: hidden charts');
  assert.doesNotMatch(repair.calls[0].instruction, /charts\[/, '46: no chart issue');
  assert.equal(outcome.status, 'succeeded', '46: repaired success');
  assert.deepEqual(saved(outcome).charts, clean.article.charts, '46: original charts');
  assert.equal(outcome.chartDigest, clean.chartDigest, '46: chart digest unchanged');
});

test('46: exhausted invalid emphasis is dropped and succeeds', async () => {
  const wire = doc('bad emphasis');
  wire.hero.emphasis = 'not present in the headline';
  const repair = repairer([
    repairReply(JSON.stringify(wire)),
    repairReply(JSON.stringify(wire)),
  ]);
  const outcome = await run('bad-emphasis', wire, { repair: repair.fn });
  assert.equal(repair.calls.length, 2, '46: bounded emphasis repair');
  assert.equal(outcome.repairAttempts, 2, '46: attempts recorded');
  assert.equal(outcome.status, 'succeeded', '46: optional removal succeeds');
  const article = saved(outcome);
  assert.equal(Object.hasOwn(article.hero, 'emphasis'), false, '46: emphasis absent');
  dropped(article, 'hero.emphasis');
  assert.deepEqual(article.metadata.quality.issues, [], '46: emphasis issue resolved');
});

test('46: six sections surviving repair save only for review', async () => {
  const wire = sixSections(doc('editorial sections'));
  const repair = repairer([
    repairReply(JSON.stringify(wire)),
    repairReply(JSON.stringify(wire)),
  ]);
  const outcome = await run('editorial-sections', wire, { repair: repair.fn });
  assert.equal(repair.calls.length, 2, '46: two editorial repairs');
  assert.equal(outcome.status, 'needs_review', '46: editorial review');
  const article = saved(outcome);
  assert.equal(article.sections.length, 6, '46: sections retained');
  assert.ok(article.metadata.quality.issues.length > 0, '46: review issues');
  assert.match(article.metadata.quality.issues.join('\n'), /sections/, '46: section issue');
  const filename = `${article.metadata.slug}.json`;
  assert.equal(outcome.jsonPath, path.join(REVIEW_DIR, filename), '46: review path');
  assert.deepEqual(outcome.destinations, {
    output: 'written', staging: 'skipped', mirror: 'skipped',
  }, '46: review destinations');
  for (const directory of [OUT_DIR, STAGING_DIR, MIRROR_DIR]) {
    assert.equal(fs.existsSync(path.join(directory, filename)), false, '46: review isolated');
  }
});

test('46: empty required sections fail without any writes', async () => {
  const wire = doc('structural sections');
  wire.sections = [];
  const before = listOutputs();
  const repair = repairer([
    repairReply(JSON.stringify(wire)),
    repairReply(JSON.stringify(wire)),
  ]);
  const outcome = await run('structural-sections', wire, { repair: repair.fn });
  assert.equal(repair.calls.length, 2, '46: structural repair exhausted');
  assert.equal(outcome.status, 'errored', '46: structural error');
  assert.equal(outcome.code, 'INVALID_ARTICLE', '46: structural code');
  assert.ok(typeof outcome.message === 'string' && outcome.message.length > 0, '46: error message');
  assert.deepEqual(listOutputs(), before, '46: no writes anywhere');
});

test('46: wire repair instructions mention only model-owned fields', async () => {
  const { buildWireRepairInstruction } = require('../../src/quality');
  for (const citationKnown of [true, false]) {
    const instruction = buildWireRepairInstruction(
      ['hero.subtitle: required'],
      { citationKnown },
    );
    assert.ok(typeof instruction === 'string' && instruction.length > 0, '46: instruction text');
    assert.match(instruction, /hero\.subtitle/, '46: requested issue');
    assert.doesNotMatch(instruction, FORBIDDEN_INSTRUCTION, '46: no stamps');
  }
  const broken = doc('wire instruction');
  delete broken.hero.subtitle;
  const repair = repairer([repairReply(JSON.stringify(doc('wire instruction')))]);
  const outcome = await run('wire-instruction', broken, { repair: repair.fn });
  assert.equal(outcome.status, 'succeeded', '46: repair success');
  assert.equal(repair.calls.length, 1, '46: instruction exercised');
  const sent = JSON.parse(repair.calls[0].payload);
  assert.deepEqual(sent.charts, [], '46: charts empty');
  assert.equal(Object.hasOwn(sent, 'metadata'), false, '46: unstamped payload');
  assert.equal(Object.hasOwn(sent, 'references'), false, '46: wire citation field');
});

test('46: seam imports no adapters or legacy save helpers', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'src', 'finalize.ts'), 'utf8');
  assert.ok(source.length > 0, '46: source exists');
  const specifiers = [
    ...source.matchAll(/(?:from\s+|require\s*\(|import\s*\()\s*['"]([^'"]+)['"]/g),
  ].map((match) => match[1]);
  assert.ok(specifiers.length > 0, '46: imports scanned');
  for (const banned of [
    './types/explainer-json', './providers', './batch', './vision',
    './figure-vlm', './figure-data', './index',
  ]) {
    assert.equal(
      specifiers.some((specifier) => specifier === banned || specifier.startsWith(`${banned}.`)),
      false,
      `46: banned import ${banned}`,
    );
  }
  assert.doesNotMatch(
    source,
    /\bsaveResult\b|\battachFigureImage\b|\bnormalizeSchemaDrift\b|\bstampProvenanceByline\b/,
    '46: no legacy helpers',
  );
});

// AUTOMETTA-CONTRACT-END
