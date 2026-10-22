// Contract test for stage-cards/43-migrate-v1-reads-every-live-explainer.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/43-migrate-v1-reads-every-live-explainer.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/43-migrate-v1-reads-every-live-explainer.md
const SLUG = '2026-05-01_smith_agent-costs_explainer';
const NO_IO = { listing: [] as string[], bytes: (_: string) => undefined as Uint8Array | undefined };

function contract(): Record<string, any> {
  return require('../../contract/explainer-v2') as Record<string, any>;
}

function migrate(raw: unknown): Record<string, any> {
  const mod = require('../../contract/migrate-v1') as Record<string, any>;
  return mod.migrateV1(raw, NO_IO);
}

function migrated(raw: unknown): Record<string, any> {
  const r = migrate(raw);
  assert.equal(r.ok, true, `migrateV1 must succeed: ${r.reason ?? ''}`);
  const parsed = contract().ExplainerV2.safeParse(r.explainer);
  assert.ok(parsed.success, `the result must parse as ExplainerV2: ${JSON.stringify(parsed.error?.issues ?? []).slice(0, 400)}`);
  assert.equal(r.explainer.metadata.migrated_from, 1);
  return r.explainer;
}

function v1(): Record<string, any> {
  return {
    version: 1,
    metadata: { title: 'Agent Costs: Smith (2026)', eyebrow: 'Research Explainer · Smith (2026)', date_created: '2026-05-01', filename_slug: SLUG },
    hero: { headline: 'Agents cut costs by a third', subtitle: 'What the study found.' },
    top_block: { kind: 'pills', pills: [{ number: '33%', description: 'Lower cost' }, { number: '2x', description: 'Faster' }] },
    sections: [
      { label: 'Why', paragraphs: ['Costs fell.'] },
      { label: 'How', paragraphs: ['Three steps.'], table: { caption: 'Costs by year', columns: ['Year', 'Cost'], rows: [['2025', '10']] } },
    ],
    end_takeaway: { label: 'So what', body: 'Cheaper and faster.' },
    references: ['Smith, J. (2026). Agent costs in practice. Journal of Agents, 4(2), 1-20.'],
  };
}

function table(doc: Record<string, any>): Record<string, any> {
  return doc.sections[1].table;
}

test('an end_takeaway written with headline instead of label migrates, label taken from headline and body from body_html', () => {
  const doc = v1();
  doc.end_takeaway = { headline: 'The harness is the product', body: 'Plain body.', body_html: 'The <strong>harness</strong> matters.' };
  const out = migrated(doc);
  assert.equal(out.end_takeaway.label, 'The harness is the product');
  assert.equal(out.end_takeaway.body, 'The <strong>harness</strong> matters.');
});

test('an end_takeaway written with paragraphs_html instead of body migrates, the paragraphs joined by one space', () => {
  const doc = v1();
  doc.end_takeaway = { label: 'What it means', paragraphs_html: ['First <em>point</em>.', 'Second point.'] };
  const out = migrated(doc);
  assert.equal(out.end_takeaway.label, 'What it means');
  assert.equal(out.end_takeaway.body, 'First <em>point</em>. Second point.');
});

test('plain paragraphs stand in for the body when no html twin exists, and label wins over headline when both are present', () => {
  const doc = v1();
  doc.end_takeaway = { label: 'Label wins', headline: 'Headline loses', paragraphs: ['One.', 'Two.'] };
  const out = migrated(doc);
  assert.equal(out.end_takeaway.label, 'Label wins');
  assert.equal(out.end_takeaway.body, 'One. Two.');
});

test('body wins over paragraphs, and empty paragraph entries drop before the join', () => {
  const doc = v1();
  doc.end_takeaway = { label: 'Both', body: 'The body wins.', paragraphs_html: ['Paragraphs lose.'] };
  assert.equal(migrated(doc).end_takeaway.body, 'The body wins.');
  doc.end_takeaway = { label: 'Gaps', paragraphs_html: ['', 'Only <em>this</em>.', ''] };
  assert.equal(migrated(doc).end_takeaway.body, 'Only <em>this</em>.');
});

test('a takeaway top block reads the same variants', () => {
  const doc = v1();
  doc.top_block = { kind: 'takeaway', headline: 'Top headline', paragraphs_html: ['Top <strong>body</strong>.'] };
  delete doc.end_takeaway;
  const out = migrated(doc);
  assert.equal(out.top_block.kind, 'takeaway');
  assert.equal(out.top_block.label, 'Top headline');
  assert.equal(out.top_block.body, 'Top <strong>body</strong>.');
});

test('the existing label and body takeaway still migrates unchanged', () => {
  const out = migrated(v1());
  assert.equal(out.end_takeaway.label, 'So what');
  assert.equal(out.end_takeaway.body, 'Cheaper and faster.');
});

test('a takeaway with no label and no headline is still a typed failure, never an invented label', () => {
  const doc = v1();
  doc.end_takeaway = { body: 'A body with nothing to call it.' };
  const r = migrate(doc);
  assert.equal(r.ok, false, 'a missing label must not be filled in');
  assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
});

test('blank table cells migrate as empty strings and the result parses', () => {
  const doc = v1();
  table(doc).columns = ['Measure', 'Level 1', 'Level 4', 'Level 5'];
  table(doc).rows = [['Net value', '0.625', '', '0.944'], ['Governance cost', '', '0.180', '0.160']];
  const out = migrated(doc);
  assert.deepEqual(table(out).rows, [['Net value', '0.625', '', '0.944'], ['Governance cost', '', '0.180', '0.160']]);
});

test('the stored and wire schemas accept an empty cell but still reject markup in a cell and an empty column heading', () => {
  const { ExplainerV2, ModelOutputV2, TableCell } = contract();
  assert.ok(TableCell && typeof TableCell.safeParse === 'function', 'contract/explainer-v2.ts exports TableCell');
  assert.ok(TableCell.safeParse('').success && TableCell.safeParse('0.625').success, 'TableCell accepts empty and plain text');
  assert.ok(!TableCell.safeParse('<b>x</b>').success, 'TableCell rejects markup');
  const base = migrated(v1());
  const withCells = (rows: string[][], columns = ['Year', 'Cost']) => ({ ...base, sections: base.sections.map((s: any, i: number) => i === 1 ? { ...s, table: { ...s.table, columns, rows } } : s) });
  assert.ok(ExplainerV2.safeParse(withCells([['2025', '']])).success, 'ExplainerV2 accepts an empty cell');
  assert.ok(!ExplainerV2.safeParse(withCells([['2025', '<b>10</b>']])).success, 'ExplainerV2 still rejects a tag in a cell');
  assert.ok(!ExplainerV2.safeParse(withCells([['2025', '10 &amp; 11']])).success, 'ExplainerV2 still rejects an entity in a cell');
  assert.ok(!ExplainerV2.safeParse(withCells([['2025', '10']], ['Year', ''])).success, 'ExplainerV2 still rejects an empty column heading');
  const cellShape = ModelOutputV2.shape.sections.element.shape.table.unwrap().shape.rows.element.element;
  assert.ok(cellShape.safeParse('').success, 'the wire cell accepts an empty string');
  assert.ok(!cellShape.safeParse('<i>x</i>').success, 'the wire cell rejects markup');
});

test('the contract revision stays 1, the generated files match the source, and neither the stored nor the OpenAI cell carries a minLength', () => {
  assert.equal(contract().CONTRACT_REVISION, 1);
  const r = spawnSync('npm', ['run', '-s', 'contract:check'], { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, WEBSITE_REPO: '' } });
  assert.equal(r.status, 0, `contract:check must pass: ${r.stdout}${r.stderr}`);
  const openai = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'contract', 'generated', 'model-output.openai.json'), 'utf8'));
  const stored = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'contract', 'generated', 'explainer-v2.schema.json'), 'utf8'));
  const cellOf = (schema: unknown): Record<string, any> | undefined => {
    let found: Record<string, any> | undefined;
    const walk = (n: any): void => {
      if (!n || typeof n !== 'object' || found) return;
      if (n.properties?.rows?.items?.items) { found = n.properties.rows.items.items; return; }
      for (const v of Object.values(n)) walk(v);
    };
    walk(schema);
    return found;
  };
  const openaiCell = cellOf(openai), storedCell = cellOf(stored);
  assert.ok(openaiCell && storedCell, 'both dialects describe table rows');
  assert.equal(openaiCell!.type, 'string');
  assert.equal(openaiCell!.minLength, undefined, 'the OpenAI cell carries no minLength');
  assert.equal(storedCell!.type, 'string');
  assert.equal(storedCell!.minLength, undefined, 'the stored schema no longer requires a non-empty cell');
});

test('the unit tests carry a fixture for each new case', () => {
  const fixtures = path.join(REPO_ROOT, 'tests', 'unit', 'fixtures', 'v1');
  for (const f of ['takeaway-headline.json', 'takeaway-paragraphs.json', 'blank-cells.json']) {
    const p = path.join(fixtures, f);
    assert.ok(fs.existsSync(p), `tests/unit/fixtures/v1/${f} must exist`);
    const fixture = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(fixture.ok, true, `${f} must be a fixture that migrates`);
    assert.ok(fixture.input && typeof fixture.input === 'object', `${f} must carry an input document`);
  }
});
// AUTOMETTA-CONTRACT-END
