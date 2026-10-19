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
globalThis.fetch = (async () => {
  throw new Error('network access is forbidden in contract test 03');
}) as typeof fetch;

const output = require('../../src/output') as Record<string, any>;
const quality = require('../../src/quality') as typeof import('../../src/quality');

const EXPECTED_DATE = '2026-10-19';
const GOOD_DATA = [12.5, 30.1, 7.2, 44, 18, 26];

function chartConfig(data: unknown[]) {
  return {
    type: 'bar',
    data: { labels: data.map((_, i) => `L${i + 1}`), datasets: [{ label: 'Series', data }] },
  };
}

function doc(configJson: unknown): Record<string, any> {
  return {
    version: 1,
    metadata: {
      title: 'Contract fixture: Smith (2026)',
      eyebrow: 'Research Explainer · Smith (2026)',
      date_created: EXPECTED_DATE,
      filename_slug: `${EXPECTED_DATE}_smith_contract-fixture_explainer`,
    },
    hero: { headline: 'Headline', headline_html: 'Headline', subtitle: 'Subtitle', publication_date: 'Published October 2026' },
    top_block: {
      kind: 'pills',
      pills: [
        { number: '12%', description: 'First finding', accent_color: '#111111' },
        { number: '3x', description: 'Second finding', accent_color: '#222222' },
      ],
    },
    charts: [{ title: 'Chart', caption: 'Caption', config_json: configJson }],
    image: null,
    sections: [{ label: 'Intro', paragraphs: ['Adoption rose to 12% while the cost fell by 3x.'] }],
    end_takeaway: { label: 'So what', body: 'The point.' },
    references: ['<a href="https://example.org/paper" target="_blank" rel="noopener noreferrer">Smith 2026</a>'],
  };
}

const ORDINAL_STRINGIFIED = () => doc(JSON.stringify(chartConfig([1, 2, 3, 4, 5])));
const GOOD_STRINGIFIED = () => doc(JSON.stringify(chartConfig(GOOD_DATA)));

function canonicalise(value: unknown): Record<string, any> {
  assert.equal(typeof output.canonicaliseExplainerJson, 'function', 'src/output.ts must export canonicaliseExplainerJson');
  return output.canonicaliseExplainerJson(value);
}

test('canonicaliseExplainerJson parses a stringified config_json into an object', () => {
  const canon = canonicalise(ORDINAL_STRINGIFIED());
  const cfg = canon.charts?.[0]?.config_json;
  assert.equal(typeof cfg, 'object');
  assert.deepEqual(cfg.data.datasets[0].data, [1, 2, 3, 4, 5]);
});

test('canonicaliseExplainerJson keeps charts under the six-point filter (dropping stays a save-time step)', () => {
  const canon = canonicalise(ORDINAL_STRINGIFIED());
  assert.equal(Array.isArray(canon.charts), true);
  assert.equal(canon.charts.length, 1);
});

test('the ordinal check fires on a canonicalised stringified chart', () => {
  const v = quality.validateJsonOutput(canonicalise(ORDINAL_STRINGIFIED()), { expectedDate: EXPECTED_DATE });
  assert.equal(v.ok, false);
  assert.ok(v.issues.some((i) => /ordinal sequence/.test(i)), `no ordinal issue in: ${v.issues.join(' | ')}`);
});

test('validateJsonOutput rejects a config_json that is still a string (malformed JSON)', () => {
  const v = quality.validateJsonOutput(canonicalise(doc('{"type":"bar","data":')), { expectedDate: EXPECTED_DATE });
  assert.equal(v.ok, false);
  assert.ok(v.issues.some((i) => /charts\[0\]\.config_json/.test(i)), `no config_json issue in: ${v.issues.join(' | ')}`);
});

test('a clean stringified chart validates with no issues after canonicalisation', () => {
  const v = quality.validateJsonOutput(canonicalise(GOOD_STRINGIFIED()), { expectedDate: EXPECTED_DATE });
  assert.deepEqual(v.issues, []);
  assert.equal(v.ok, true);
});

function loadRepair(): (opts: Record<string, unknown>) => Promise<Record<string, any>> {
  const file = path.join(REPO_ROOT, 'src', 'repair.ts');
  assert.equal(fs.existsSync(file), true, 'src/repair.ts must exist');
  const mod = require('../../src/repair') as Record<string, any>;
  assert.equal(typeof mod.repairUntilValid, 'function', 'src/repair.ts must export repairUntilValid');
  return mod.repairUntilValid;
}

test('the shared repair loop sends a stringified ordinal chart to repair', async () => {
  const repairUntilValid = loadRepair();
  const calls: Array<{ system: string; text: string }> = [];
  await repairUntilValid({
    rawText: JSON.stringify(ORDINAL_STRINGIFIED()),
    expectedDate: EXPECTED_DATE,
    repair: async (system: string, text: string) => {
      calls.push({ system, text });
      return { text: JSON.stringify(GOOD_STRINGIFIED()), inputTokens: 10, outputTokens: 20 };
    },
  });
  assert.ok(calls.length >= 1, 'repair was never called for an ordinal chart');
  assert.match(calls[0].system, /ordinal sequence/);
});

test('the shared repair loop does not call repair for a clean structured-output document', async () => {
  const repairUntilValid = loadRepair();
  let called = 0;
  await repairUntilValid({
    rawText: JSON.stringify(GOOD_STRINGIFIED()),
    expectedDate: EXPECTED_DATE,
    repair: async () => {
      called += 1;
      return { text: JSON.stringify(GOOD_STRINGIFIED()), inputTokens: 1, outputTokens: 1 };
    },
  });
  assert.equal(called, 0);
});

test('src/batch.ts validates only through the shared repair loop', () => {
  const batchSrc = fs.readFileSync(path.join(REPO_ROOT, 'src', 'batch.ts'), 'utf8');
  assert.doesNotMatch(batchSrc, /validateJsonOutput/, 'batch.ts still validates on its own');
  assert.match(batchSrc, /repairUntilValid/, 'batch.ts does not use repairUntilValid');
});
// AUTOMETTA-CONTRACT-END
