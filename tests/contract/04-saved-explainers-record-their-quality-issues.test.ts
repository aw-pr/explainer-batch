// Contract test for stage-cards/04-saved-explainers-record-their-quality-issues.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/04-saved-explainers-record-their-quality-issues.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-04-'));
for (const dir of ['input', 'output']) fs.mkdirSync(path.join(TMP, dir));
const OUT_DIR = path.join(TMP, 'output');

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/04-saved-explainers-record-their-quality-issues.md
// Paths are pinned before src/ loads so the fill-only .env loader cannot send
// output to a real website checkout or Obsidian vault.
Object.assign(process.env, {
  EXPLAINER_STATE_FILE: path.join(TMP, 'state.json'),
  EXPLAINER_INPUT_DIR: path.join(TMP, 'input'),
  EXPLAINER_OUTPUT_DIR: OUT_DIR,
  EXPLAINER_OBSIDIAN_DIR: '',
  WEBSITE_REPO: '',
  FIGURE_RECREATE: '0',
});
delete process.env.MIN_CHART_POINTS;
globalThis.fetch = (async () => {
  throw new Error('network access is forbidden in contract test 04');
}) as typeof fetch;

const output = require('../../src/output') as Record<string, any>;
const seam = require('../../src/finalize') as Record<string, any>;
const EXPECTED_DATE = '2026-10-19';
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
      title, headline: 'Governed agents separate planning from execution',
      emphasis: null, subtitle: 'Policy checks constrain tool use.',
    },
    top_block: {
      kind: 'pills',
      pills: [
        { lead: 'Governance', text: 'Policy checks precede tool use.' },
        { lead: 'Inspection', text: 'Recorded decisions support review.' },
      ],
    },
    sections: [
      { label: 'Architecture', paragraphs: ['Planning precedes execution.'], list: null, table: null },
      { label: 'Evidence', paragraphs: ['Measurements describe the tested cases.'], list: null, table: null },
      { label: 'Limits', paragraphs: ['Further evaluation remains necessary.'], list: null, table: null },
    ],
    charts: [{
      kind: 'bar', title: 'Measured latency',
      caption: 'Latency varies across the measured cases.',
      x: {
        label: 'Case', unit: null, type: 'category',
        values: ['A', 'B', 'C', 'D', 'E', 'F'],
      },
      y: { label: 'Latency', unit: 'ms', scale: 'linear' },
      series: [{
        name: 'Measured', values: [12.5, 30.1, 7.2, 44, 18, 26], points: null,
        source: { kind: 'table', ref: 'Table 2', page: 4 },
      }],
    }],
    figure_request: null,
    end_takeaway: { label: 'Implication', body: 'Inspect decisions before execution.' },
    citation: {
      authors: [{ family: 'Smith', given: null }],
      year: 2026, title: 'Governed agent architectures',
      venue: null, url: 'https://example.org/paper',
    },
  };
}

function receipt(text: string): Record<string, any> {
  return {
    provider: 'openai', route: 'batch-api', stage: 'synthesis',
    model: 'contract-model', customId: 'cid-04', attemptId: 'attempt-04',
    finishReason: 'stop', text,
    usage: {
      in: 100, out: 50, cacheRead: 0, cacheWrite5m: 0,
      cacheWrite1h: 0, source: 'reported',
    },
  };
}

async function run(key: string, text: string, stamp: Record<string, unknown> = {}) {
  assert.equal(typeof seam.finalizeResult, 'function', '04: finalizeResult');
  const map = new Map<string, unknown>();
  return seam.finalizeResult(key, receipt(text), {
    stamp: { expectedDate: EXPECTED_DATE, ...stamp },
    checkpoints: {
      get: (k: string) => map.get(k),
      put: (k: string, value: unknown) => { map.set(k, value); },
    },
  });
}

async function saveAndRead(key: string, wire: Record<string, any>, stamp: Record<string, unknown> = {}) {
  const outcome = await run(key, JSON.stringify(wire), stamp);
  assert.ok(['succeeded', 'needs_review'].includes(outcome.status), '04: saved outcome');
  assert.ok(typeof outcome.jsonPath === 'string' && outcome.jsonPath.length > 0, '04: saved path');
  const saved = JSON.parse(fs.readFileSync(outcome.jsonPath, 'utf8'));
  assert.deepEqual(saved, outcome.article, '04: saved article matches outcome');
  assert.deepEqual(saved.metadata.quality.issues, outcome.issues, '04: saved issues match outcome');
  return { outcome, saved };
}

test('a clean explainer is saved with an empty v2 quality record', async () => {
  const { outcome, saved } = await saveAndRead('04-clean', doc('Clean quality'));
  assert.equal(outcome.status, 'succeeded', '04: clean success');
  assert.equal(path.dirname(outcome.jsonPath), OUT_DIR, '04: normal output directory');
  assert.deepEqual(saved.metadata.quality, { issues: [], dropped: [] }, '04: clean quality');
  assert.equal(saved.metadata.model, 'contract-model', '04: receipt model');
});

test('editorial issues are saved in review with their quality record', async () => {
  const wire = doc('Editorial quality');
  wire.sections.push(
    { label: 'Controls', paragraphs: ['Policy gates constrain tool use.'], list: null, table: null },
    { label: 'Operations', paragraphs: ['Operators inspect decisions.'], list: null, table: null },
    { label: 'Scope', paragraphs: ['The findings remain bounded.'], list: null, table: null },
  );
  const { outcome, saved } = await saveAndRead('04-review', wire);
  assert.equal(outcome.status, 'needs_review', '04: review status');
  assert.equal(path.dirname(outcome.jsonPath), path.join(OUT_DIR, 'review'), '04: review directory');
  assert.ok(saved.metadata.quality.issues.length > 0, '04: surviving issues');
  assert.match(saved.metadata.quality.issues.join('\n'), /sections/, '04: section issue');
  assert.deepEqual(saved.metadata.quality.dropped, [], '04: no deterministic drops');
});

test('invalid structured charts are removed and recorded in dropped', async () => {
  const wire = doc('Ordinal quality');
  wire.charts[0].series[0].values = [1, 2, 3, 4, 5, 6];
  const { outcome, saved } = await saveAndRead('04-ordinal', wire);
  assert.equal(outcome.status, 'succeeded', '04: removal resolves chart issue');
  assert.deepEqual(saved.charts, [], '04: ordinal chart removed');
  assert.deepEqual(saved.metadata.quality.issues, [], '04: no surviving issue');
  assert.ok(saved.metadata.quality.dropped.length > 0, '04: recorded removal');
  assert.ok(
    saved.metadata.quality.dropped.some((message: string) => message.includes('charts[0]')),
    '04: dropped chart path',
  );
});

test('the expected date comes from stamp context rather than model metadata', async () => {
  const wire = doc('Stamped date');
  wire.metadata = { date_created: '2026-01-01' };
  const { saved } = await saveAndRead('04-date', wire);
  assert.equal(saved.metadata.date_created, EXPECTED_DATE, '04: context date');
  assert.deepEqual(saved.metadata.quality.issues, [], '04: stale model stamp removed');
  assert.ok(saved.metadata.quality.dropped.length > 0, '04: stamp injection recorded');
  assert.ok(
    saved.metadata.quality.dropped.some((message: string) => message.includes('metadata')),
    '04: model metadata drop',
  );
});

test('detected structured citation overrides malformed model citation', async () => {
  const wire = doc('Detected reference');
  wire.citation = { authors: [] };
  const { outcome, saved } = await saveAndRead('04-reference', wire, { detectedReference: DETECTED });
  assert.equal(outcome.status, 'succeeded', '04: detected citation succeeds');
  assert.deepEqual(saved.references, [{ ...DETECTED, origin: 'detected' }], '04: detected reference');
  assert.deepEqual(saved.metadata.quality.issues, [], '04: no citation issue');
  assert.ok(
    saved.metadata.quality.dropped.some((message: string) => message.includes('citation')),
    '04: unused model citation recorded',
  );
});

test('wire JSON needs no metadata and is stamped before persistence', async () => {
  const wire = doc('Metadata supplied by code');
  assert.equal(Object.hasOwn(wire, 'metadata'), false, '04: wire has no metadata');
  const { saved } = await saveAndRead('04-nometa', wire);
  assert.equal(saved.version, 2, '04: stamped version');
  assert.equal(saved.metadata.date_created, EXPECTED_DATE, '04: stamped date');
  assert.deepEqual(saved.metadata.quality, { issues: [], dropped: [] }, '04: valid metadata-less wire');
});

test('unparseable output returns a structured error and the raw helper preserves its text', async () => {
  const raw = '{"hero":{"title":"Truncated';
  const before = fs.readdirSync(OUT_DIR).sort();
  const outcome = await run('04-invalid-json', raw);
  assert.equal(outcome.status, 'errored', '04: invalid JSON error');
  assert.equal(outcome.code, 'INVALID_JSON', '04: parse error code');
  assert.ok(typeof outcome.message === 'string' && outcome.message.length > 0, '04: error message');
  assert.deepEqual(fs.readdirSync(OUT_DIR).sort(), before, '04: seam writes no invalid article');
  assert.equal(typeof output.saveRawOutput, 'function', '04: raw helper');
  const filename = output.saveRawOutput('explainer-url-contract04-invalid', raw);
  assert.ok(typeof filename === 'string' && filename.length > 0, '04: raw filename');
  assert.match(filename, /_error\.txt$/, '04: raw error suffix');
  assert.equal(fs.readFileSync(path.join(OUT_DIR, filename), 'utf8'), raw, '04: exact raw text');
});

test('neither generated provider dialect asks the model for quality', () => {
  const { wireSchema } = require('../../src/wire-schema') as Record<string, any>;
  assert.equal(typeof wireSchema, 'function', '04: wireSchema');
  for (const provider of ['claude', 'openai']) {
    const schema = wireSchema(provider);
    assert.ok(schema.properties && Object.keys(schema.properties).length > 0, '04: dialect properties');
    assert.equal(Object.hasOwn(schema.properties, 'quality'), false, '04: no model quality field');
    assert.equal(Object.hasOwn(schema.properties, 'metadata'), false, '04: no model metadata');
    assert.ok(Array.isArray(schema.required) && schema.required.length > 0, '04: dialect required fields');
    assert.equal(schema.required.includes('quality'), false, '04: quality not required');
    assert.equal(schema.required.includes('metadata'), false, '04: metadata not required');
  }
});
// AUTOMETTA-CONTRACT-END
