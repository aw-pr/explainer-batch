// Contract test for stage-cards/03-chart-checks-run-on-structured-output.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/03-chart-checks-run-on-structured-output.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-03-'));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/03-chart-checks-run-on-structured-output.md
Object.assign(process.env, {
  EXPLAINER_STATE_FILE: path.join(TMP, 'state.json'),
  EXPLAINER_INPUT_DIR: path.join(TMP, 'input'),
  EXPLAINER_OUTPUT_DIR: path.join(TMP, 'output'),
  EXPLAINER_OBSIDIAN_DIR: '',
  WEBSITE_REPO: '',
  FIGURE_RECREATE: '0',
});
delete process.env.MIN_CHART_POINTS;
globalThis.fetch = (async () => {
  throw new Error('network access is forbidden in contract test 03');
}) as typeof fetch;

const quality = require('../../src/quality') as Record<string, any>;
const seam = require('../../src/finalize') as Record<string, any>;
const EXPECTED_DATE = '2026-10-19';

function doc(values: number[] = [12.5, 30.1, 7.2, 44, 18, 26]): Record<string, any> {
  return {
    hero: {
      title: 'Structured chart checks',
      headline: 'Measurements describe the tested cases',
      emphasis: null,
      subtitle: 'The paper compares measured latency.',
    },
    top_block: {
      kind: 'pills',
      pills: [
        { lead: 'Evidence', text: 'Values come from a printed table.' },
        { lead: 'Scope', text: 'The findings describe the tested cases.' },
      ],
    },
    sections: [
      {
        label: 'Evidence',
        paragraphs: ['The paper reports measured latency for the tested cases.'],
        list: null, table: null,
      },
      {
        label: 'Limits',
        paragraphs: ['Further evaluation remains necessary.'],
        list: null, table: null,
      },
    ],
    charts: [{
      kind: 'bar',
      title: 'Measured latency',
      caption: 'Latency varies across the measured cases.',
      x: {
        label: 'Case', unit: null, type: 'category',
        values: values.map((_, i) => `L${i + 1}`),
      },
      y: { label: 'Latency', unit: 'ms', scale: 'linear' },
      series: [{
        name: 'Measured', values, points: null,
        source: { kind: 'table', ref: 'Table 2', page: 4 },
      }],
    }],
    figure_request: null,
    end_takeaway: { label: 'Implication', body: 'Check the measured cases before generalising.' },
    citation: {
      authors: [{ family: 'Smith', given: null }],
      year: 2026, title: 'Measured latency', venue: null,
      url: 'https://example.org/paper',
    },
  };
}

function receipt(text: string): Record<string, any> {
  return {
    provider: 'openai', route: 'batch-api', stage: 'synthesis',
    model: 'contract-model', customId: 'cid-03', attemptId: 'attempt-03',
    finishReason: 'stop', text,
    usage: {
      in: 100, out: 50, cacheRead: 0, cacheWrite5m: 0,
      cacheWrite1h: 0, source: 'reported',
    },
  };
}

async function run(key: string, wire: Record<string, any>) {
  assert.equal(typeof seam.finalizeResult, 'function', '03: finalizeResult');
  let repairs = 0;
  const map = new Map<string, unknown>();
  const outcome = await seam.finalizeResult(key, receipt(JSON.stringify(wire)), {
    stamp: { expectedDate: EXPECTED_DATE },
    checkpoints: {
      get: (k: string) => map.get(k),
      put: (k: string, value: unknown) => { map.set(k, value); },
    },
    repair: async () => {
      repairs++;
      throw new Error('03: chart-only or clean output must not invoke repair');
    },
  });
  assert.equal(repairs, 0, '03: no chart repair');
  assert.equal(outcome.status, 'succeeded', '03: saved successfully');
  assert.ok(typeof outcome.jsonPath === 'string' && outcome.jsonPath.length > 0, '03: saved path');
  const saved = JSON.parse(fs.readFileSync(outcome.jsonPath, 'utf8'));
  assert.deepEqual(saved, outcome.article, '03: stored article');
  return saved;
}

test('wire canonicalisation keeps a structured chart until finalisation', () => {
  const wire = doc([1, 2, 3, 4, 5]);
  assert.equal(typeof seam.canonicaliseWire, 'function', '03: canonicaliseWire');
  const canonical = seam.canonicaliseWire(wire, { citationKnown: false });
  assert.equal(canonical.wire.charts.length, 1, '03: canonicalisation retains thin chart');
  assert.deepEqual(canonical.wire.charts[0].series[0].values, [1, 2, 3, 4, 5], '03: structured values');
});

test('chartIssues detects ordinal data in structured wire output', () => {
  assert.equal(typeof quality.chartIssues, 'function', '03: chartIssues');
  const issues = quality.chartIssues(doc([1, 2, 3, 4, 5, 6]).charts[0], 0);
  assert.ok(issues.length > 0, '03: ordinal issue');
  assert.match(issues.join('\n'), /charts\[0\].*ordinal sequence/, '03: ordinal chart path');
});

test('malformed structured chart data is rejected by wire validation', () => {
  const wire = doc();
  wire.charts[0].series[0].values = 'not an array';
  assert.equal(typeof seam.wireIssues, 'function', '03: wireIssues');
  const issues = seam.wireIssues(wire, { citationKnown: false });
  assert.ok(issues.length > 0, '03: malformed chart issue');
  assert.match(issues.join('\n'), /charts\[0\]\.series\[0\]\.values/, '03: malformed chart path');
});

test('clean structured chart data has no chart or wire issues', () => {
  const wire = doc();
  assert.equal(wire.charts.length, 1, '03: chart exercised');
  assert.deepEqual(quality.chartIssues(wire.charts[0], 0), [], '03: clean chart');
  assert.deepEqual(seam.wireIssues(wire, { citationKnown: false }), [], '03: clean wire');
});

test('the seam removes an ordinal chart without sending it to repair', async () => {
  const saved = await run('03-ordinal', doc([1, 2, 3, 4, 5, 6]));
  assert.deepEqual(saved.charts, [], '03: ordinal chart removed');
  assert.ok(saved.metadata.quality.dropped.length > 0, '03: removal recorded');
  assert.ok(
    saved.metadata.quality.dropped.some((issue: string) => issue.includes('charts[0]')),
    '03: removed chart path',
  );
});

test('the seam retains a clean structured chart without repair', async () => {
  const saved = await run('03-clean', doc());
  assert.equal(saved.charts.length, 1, '03: chart retained');
  assert.deepEqual(saved.charts[0].series[0].values, [12.5, 30.1, 7.2, 44, 18, 26], '03: values retained');
  assert.deepEqual(saved.metadata.quality, { issues: [], dropped: [] }, '03: clean quality');
});

test('src/batch.ts validates only through the shared repair loop', () => {
  const batchSrc = fs.readFileSync(path.join(REPO_ROOT, 'src', 'batch.ts'), 'utf8');
  assert.doesNotMatch(batchSrc, /validateJsonOutput/, 'batch.ts still validates on its own');
  assert.doesNotMatch(batchSrc, /repairUntilValid/, 'batch.ts still repairs outside the seam');
  assert.match(batchSrc, /\bsaveThroughSeam\b/, 'batch.ts does not save and repair through the seam');
});
// AUTOMETTA-CONTRACT-END
