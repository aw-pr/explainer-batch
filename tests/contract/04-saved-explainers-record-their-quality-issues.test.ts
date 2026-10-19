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

const output = require('../../src/output') as typeof import('../../src/output');
const schema = require('../../src/schema/explainer-schema') as typeof import('../../src/schema/explainer-schema');

const EXPECTED_DATE = '2026-10-19';
const GOOD_DATA = [12.5, 30.1, 7.2, 44, 18, 26];
const ANCHORED_REF = '<a href="https://example.org/paper" target="_blank" rel="noopener noreferrer">Smith 2026</a>';

function doc(slugTitle: string, data: number[] = GOOD_DATA): Record<string, any> {
  return {
    version: 1,
    metadata: {
      title: 'Contract fixture: Smith (2026)',
      eyebrow: 'Research Explainer · Smith (2026)',
      date_created: EXPECTED_DATE,
      filename_slug: `${EXPECTED_DATE}_smith_${slugTitle}_explainer`,
    },
    hero: { headline: 'Headline', headline_html: 'Headline', subtitle: 'Subtitle', publication_date: 'Published October 2026' },
    top_block: {
      kind: 'pills',
      pills: [
        { number: '12%', description: 'First finding', accent_color: '#111111' },
        { number: '3x', description: 'Second finding', accent_color: '#222222' },
      ],
    },
    charts: [{
      title: 'Chart',
      caption: 'Caption',
      config_json: JSON.stringify({ type: 'bar', data: { labels: data.map((_, i) => `L${i + 1}`), datasets: [{ label: 'S', data }] } }),
    }],
    sections: [{ label: 'Intro', paragraphs: ['Adoption rose to 12% while the cost fell by 3x.'] }],
    end_takeaway: { label: 'So what', body: 'The point.' },
    references: [ANCHORED_REF],
  };
}

const PROVENANCE = { model: 'contract-model', runMode: 'batch' as const, expectedDate: EXPECTED_DATE };

async function saveAndRead(customId: string, value: unknown, provenance: Record<string, unknown> = PROVENANCE) {
  const saved = await output.saveResult(customId, JSON.stringify(value), provenance as never);
  assert.equal(path.dirname(saved.jsonPath), OUT_DIR);
  return JSON.parse(fs.readFileSync(saved.jsonPath, 'utf8'));
}

test('a clean explainer is saved with an empty quality record', async () => {
  const saved = await saveAndRead('explainer-url-contract04-clean', doc('clean'));
  assert.deepEqual(saved.metadata.quality, { issues: [], needs_review: false });
  assert.equal(saved.metadata.model, 'contract-model');
});

test('an invalid explainer is still saved, with its issues and needs_review', async () => {
  const bad = doc('missing-subtitle');
  delete bad.hero.subtitle;
  const saved = await saveAndRead('explainer-url-contract04-bad', bad);
  assert.equal(saved.metadata.quality?.needs_review, true);
  assert.ok(Array.isArray(saved.metadata.quality.issues));
  assert.ok(saved.metadata.quality.issues.some((i: string) => /hero\.subtitle/.test(i)), JSON.stringify(saved.metadata.quality));
});

test('validation sees the canonical chart (stringified config parsed) that is saved', async () => {
  const saved = await saveAndRead('explainer-url-contract04-ordinal', doc('ordinal', [1, 2, 3, 4, 5, 6]));
  assert.equal(typeof saved.charts?.[0]?.config_json, 'object');
  assert.equal(saved.metadata.quality?.needs_review, true);
  assert.ok(saved.metadata.quality.issues.some((i: string) => /ordinal sequence/.test(i)), JSON.stringify(saved.metadata.quality));
});

test('the expected date comes from provenance, not from the document', async () => {
  const stale = doc('stale-date');
  stale.metadata.date_created = '2026-01-01';
  const saved = await saveAndRead('explainer-url-contract04-date', stale);
  assert.ok(saved.metadata.quality?.issues.some((i: string) => /date_created must equal 2026-10-19/.test(i)), JSON.stringify(saved.metadata.quality));
});

test('validation runs after provenance stamping', async () => {
  const unanchored = doc('stamped');
  unanchored.references = ['Smith 2026, no anchor'];
  const saved = await saveAndRead('explainer-url-contract04-stamped', unanchored, { ...PROVENANCE, detectedReference: ANCHORED_REF });
  assert.deepEqual(saved.references, [ANCHORED_REF]);
  assert.deepEqual(saved.metadata.quality, { issues: [], needs_review: false });
});

test('metadata-less JSON is kept as _error.txt and rejected without a TypeError', async () => {
  const before = new Set(fs.readdirSync(OUT_DIR));
  const raw = JSON.stringify({ version: 1, sections: [{ label: 'Only', paragraphs: ['x'] }] });
  let caught: unknown;
  try {
    await output.saveResult('explainer-url-contract04-nometa', raw, PROVENANCE as never);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof Error, 'saveResult must reject metadata-less JSON');
  assert.equal(caught instanceof TypeError, false, `rejected with a TypeError: ${(caught as Error).message}`);
  const added = fs.readdirSync(OUT_DIR).filter((f) => !before.has(f));
  const errFiles = added.filter((f) => f.endsWith('_error.txt'));
  assert.equal(errFiles.length, 1, `expected one new _error.txt, got ${added.join(', ')}`);
  assert.equal(fs.readFileSync(path.join(OUT_DIR, errFiles[0]), 'utf8'), raw);
  assert.equal(added.filter((f) => f.endsWith('.json')).length, 0);
});

test('the model-facing schema does not ask the model for quality', () => {
  const meta = (schema.EXPLAINER_JSON_SCHEMA as any).properties.metadata;
  assert.ok(meta && typeof meta.properties === 'object');
  assert.equal('quality' in meta.properties, false);
  assert.equal(meta.required.includes('quality'), false);
});
// AUTOMETTA-CONTRACT-END
