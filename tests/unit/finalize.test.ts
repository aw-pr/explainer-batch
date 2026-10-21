import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FinalizeContext } from '../../src/finalize';
import type { NormalizedResult } from '../../src/llm-contract';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-finalize-unit-'));
Object.assign(process.env, {
  EXPLAINER_OUTPUT_DIR: path.join(temporary, 'output'),
  EXPLAINER_OBSIDIAN_DIR: path.join(temporary, 'mirror'),
  EXPLAINER_INPUT_DIR: path.join(temporary, 'input'),
  EXPLAINER_STATE_FILE: path.join(temporary, 'state.json'),
  WEBSITE_REPO: path.join(temporary, 'website'),
});
delete process.env.MIN_CHART_POINTS;
globalThis.fetch = (async () => { throw new Error('No network in finalise unit tests'); }) as typeof fetch;
const { finalizeResult } = require('../../src/finalize') as typeof import('../../src/finalize');
const { persistArtefact } = require('../../src/output') as typeof import('../../src/output');
after(() => fs.rmSync(temporary, { recursive: true, force: true }));

const date = '2026-10-19';
const provenance = { expectedDate: date, model: 'context-model', runMode: 'sync' as const };

function article(): Record<string, any> {
  return {
    version: 1,
    metadata: { title: 'Smith (2026)', eyebrow: 'Research Explainer', date_created: date, filename_slug: `${date}_smith_unit_explainer` },
    hero: { headline: 'Finding', headline_html: 'Finding', subtitle: 'Details', publication_date: 'Published October 2026' },
    top_block: { kind: 'takeaway', label: 'Result', body: 'The result.' },
    sections: [{ label: 'Evidence', paragraphs: ['The observed result.'] }],
    references: ['<a href="https://example.org/paper" target="_blank" rel="noopener noreferrer">Smith (2026)</a>'],
  };
}

function receipt(document: unknown, attemptId = 'attempt-1'): NormalizedResult {
  return {
    provider: 'openai', route: 'subscription-cli', stage: 'synthesis', model: 'receipt-model',
    customId: 'custom-id', attemptId, finishReason: 'stop', text: JSON.stringify(document),
    usage: { in: 100, out: 50, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, source: 'reported' },
  };
}

function checkpoints() {
  const values = new Map<string, string>();
  return {
    values,
    async get(key: string) { return values.has(key) ? JSON.parse(values.get(key)!) : undefined; },
    async put(key: string, value: unknown) { values.set(key, JSON.stringify(value)); },
  };
}

function context(overrides: Partial<FinalizeContext> = {}): FinalizeContext {
  return { provenance, checkpoints: checkpoints(), ...overrides };
}

const fakePersist: typeof persistArtefact = async () => ({
  jsonPath: path.join(temporary, 'fake.json'),
  destinations: { output: 'written', staging: 'skipped', mirror: 'skipped' },
});

test('code-first metadata fixes, source attribution and schema drift require no repair', async () => {
  const source = article();
  source.metadata.date_created = '2020-01-01';
  source.metadata.filename_slug = '2020-01-01_unknown_unit_explainer';
  source.metadata.title = 'Unknown (2026)';
  source.metadata.quality = { needs_review: true, issues: ['Old issue'] };
  source.sections = [{ label: 'Evidence', paragraphs_html: ['<p>The observed result.</p>'] }];
  source.references = [];
  const outcome = await finalizeResult('code-first', receipt(source), context({
    provenance: { ...provenance, detectedSurname: 'Smith', detectedPublished: 'Published September 2026', detectedReference: article().references[0] },
    repair: async () => { assert.fail('metadata must be fixed without a model call'); },
  }));
  assert.equal(outcome.status, 'succeeded');
  if (outcome.status === 'errored') return;
  assert.equal(outcome.article.metadata.filename_slug, `${date}_smith_unit_explainer`);
  assert.equal(outcome.article.metadata.title, 'Smith (2026)');
  assert.equal(outcome.article.metadata.date_created, date);
  assert.equal(outcome.article.metadata.model, 'context-model');
  assert.equal(outcome.article.hero.publication_date, 'Published September 2026');
  assert.deepEqual(outcome.article.sections[0].paragraphs, ['The observed result.']);
  assert.deepEqual(outcome.article.metadata.quality, { issues: [], needs_review: false });
  assert.equal(outcome.artefactDigest, createHash('sha256').update(fs.readFileSync(outcome.jsonPath)).digest('hex'));
});

test('repair cannot add charts and equal issue counts do not replace the best candidate', async () => {
  const broken = article();
  delete broken.hero.subtitle;
  delete broken.hero.headline_html;
  const better = article();
  delete better.hero.headline_html;
  const equal = article();
  delete equal.hero.subtitle;
  equal.hero.headline = 'A replacement to reject';
  better.charts = [{ title: 'Added', caption: 'Added', config_json: { data: { datasets: [{ data: [12, 21, 33, 41, 59, 63] }] } } }];
  let calls = 0;
  const outcome = await finalizeResult('bounded', receipt(broken), context({
    persist: fakePersist,
    repair: async (_instruction, payload) => {
      assert.equal('charts' in JSON.parse(payload), false);
      return { ...receipt(calls++ === 0 ? better : equal), stage: 'repair' };
    },
  }));
  assert.equal(calls, 2);
  assert.equal(outcome.repairAttempts, 2);
  assert.equal(outcome.receipts.length, 3);
  assert.equal(outcome.status, 'needs_review');
  if (outcome.status === 'errored') return;
  assert.equal(outcome.article.hero.subtitle, 'Details');
  assert.equal(outcome.article.hero.headline, 'Finding');
  assert.equal('charts' in outcome.article, false);
  assert.equal(outcome.chartDigest, createHash('sha256').update('{}').digest('hex'));
});

test('chart-only reviews preserve chart digests through prose repair', async () => {
  const original = article();
  original.charts = [{ title: 'Measured', caption: 'Results', config_json: { data: { datasets: [{ data: [1, 2, 3, 4, 5, 6] }] } } }];
  const baseline = await finalizeResult('chart-base', receipt(original), context({ persist: fakePersist }));
  const broken = structuredClone(original);
  delete broken.hero.subtitle;
  const outcome = await finalizeResult('chart-repair', receipt(broken), context({
    persist: fakePersist,
    repair: async (instruction, payload) => {
      assert.doesNotMatch(instruction, /ordinal/);
      for (const key of ['charts', 'chart', 'recreated_figure']) assert.equal(key in JSON.parse(payload), false);
      return { ...receipt(article()), stage: 'repair' };
    },
  }));
  assert.equal(outcome.status, 'needs_review');
  assert.equal(outcome.repairAttempts, 1);
  if (baseline.status === 'errored' || outcome.status === 'errored') assert.fail('expected review artefacts');
  assert.equal(outcome.chartDigest, baseline.chartDigest);
  assert.deepEqual(outcome.article.charts, baseline.article.charts);
});

test('replay after persist failure retains receipts and the exact digest without further calls', async () => {
  const source = article();
  delete source.hero.subtitle;
  let repairCalls = 0;
  let figureCalls = 0;
  const store = checkpoints();
  const ctx = context({
    checkpoints: store,
    repair: async () => { repairCalls++; return { ...receipt(article()), stage: 'repair' }; },
    figure: async (candidate) => { figureCalls++; candidate.hero.subtitle = 'Must not escape'; return null; },
  });
  await assert.rejects(finalizeResult('resume', receipt(source), { ...ctx, persist: async () => { throw new Error('disk full'); } }), /disk full/);
  const saved = await finalizeResult('resume', receipt(source), ctx);
  const replay = await finalizeResult('resume', receipt(source), ctx);
  assert.equal(saved.status, 'succeeded');
  if (saved.status === 'errored' || replay.status === 'errored') assert.fail('expected saved artefacts');
  assert.equal(saved.artefactDigest, replay.artefactDigest);
  assert.equal(saved.article.hero.subtitle, 'Details');
  assert.equal(saved.receipts.length, 2);
  assert.equal(repairCalls, 1);
  assert.equal(figureCalls, 1);
  await finalizeResult('resume', receipt(source, 'attempt-2'), ctx);
  assert.equal(repairCalls, 2);
  assert.equal(figureCalls, 2);
});

test('a repair checkpoint survives interruption before figure work begins', async () => {
  const source = article();
  delete source.hero.subtitle;
  const store = checkpoints();
  let calls = 0;
  const ctx = context({
    checkpoints: {
      get: store.get,
      put: async (key, value) => { await store.put(key, value); throw new Error('interrupted'); },
    },
    persist: fakePersist,
    repair: async () => { calls++; return receipt(article()); },
  });
  await assert.rejects(finalizeResult('repair-checkpoint', receipt(source), ctx), /interrupted/);
  let figures = 0;
  const resumed = await finalizeResult('repair-checkpoint', receipt(source), {
    ...ctx, checkpoints: store, figure: async () => { figures++; return null; },
  });
  assert.equal(resumed.status, 'succeeded');
  assert.equal(calls, 1);
  assert.equal(figures, 1);
});

test('throwing or malformed repair callbacks reject without checkpointing incomplete work', async () => {
  const source = article();
  delete source.hero.subtitle;
  for (const repair of [
    async () => { throw new Error('callback failed'); },
    async () => ({ ...receipt(article()), attemptId: '' }),
  ]) {
    const store = checkpoints();
    await assert.rejects(finalizeResult('repair-error', receipt(source), context({ checkpoints: store, repair, persist: fakePersist })));
    assert.equal(store.values.size, 0);
  }
});

test('a completed figure checkpoint survives interruption before final validation', async () => {
  const store = checkpoints();
  let figures = 0;
  const ctx = context({
    checkpoints: {
      get: store.get,
      put: async (key, value) => {
        await store.put(key, value);
        if (key.endsWith(':figure')) throw new Error('interrupted after figure');
      },
    },
    figure: async () => { figures++; return { source_figure: 'Figure 1', caption: 'Smith (2026), Figure 1.' }; },
    persist: fakePersist,
  });
  await assert.rejects(finalizeResult('figure-checkpoint', receipt(article()), ctx), /interrupted after figure/);
  const resumed = await finalizeResult('figure-checkpoint', receipt(article()), { ...ctx, checkpoints: store });
  assert.equal(figures, 1);
  assert.equal(resumed.status, 'succeeded');
  if (resumed.status === 'errored') return;
  assert.equal(resumed.article.image?.source_figure, 'Figure 1');
});

test('malformed synthesis shapes become checked error receipts without saving or checkpointing', async () => {
  const store = checkpoints();
  const malformed = { ...receipt(article()), text: '' };
  const outcome = await finalizeResult('empty-receipt', malformed, context({
    checkpoints: store,
    persist: async () => { assert.fail('invalid receipts cannot be saved'); },
  }));
  assert.equal(outcome.status, 'errored');
  if (outcome.status !== 'errored') return;
  assert.equal(outcome.code, 'EMPTY_OUTPUT');
  assert.equal(outcome.receipts[0].finishReason, 'error');
  assert.equal(store.values.size, 0);
});

test('missing provenance uses the document date, then UTC, without stamping model or mode', async () => {
  for (const ownDate of [date, undefined]) {
    const source = article();
    source.metadata.date_created = ownDate;
    const outcome = await finalizeResult(`fallback-${ownDate}`, receipt(source), context({ provenance: {}, persist: fakePersist }));
    assert.equal(outcome.status, 'succeeded');
    if (outcome.status === 'errored') return;
    assert.equal(outcome.article.metadata.date_created, ownDate ?? new Date().toISOString().slice(0, 10));
    assert.equal(outcome.article.metadata.model, undefined);
    assert.equal(outcome.article.metadata.run_mode, undefined);
  }
});

test('destination copy failures preserve the atomic output and review copies are skipped', async () => {
  const staging = path.join(temporary, 'website', 'explainers-new');
  fs.rmSync(staging, { recursive: true, force: true });
  fs.writeFileSync(staging, 'Block staging directory creation');
  const source = article();
  const saved = await finalizeResult('copy-failure', receipt(source), context());
  assert.equal(saved.status, 'succeeded');
  if (saved.status === 'errored') return;
  assert.deepEqual(saved.destinations, { output: 'written', staging: 'failed', mirror: 'written' });
  assert.deepEqual(fs.readdirSync(path.join(temporary, 'output')).filter(name => name.endsWith('.tmp')), []);
  delete source.hero.subtitle;
  const review = await finalizeResult('review-copies', receipt(source), context());
  assert.equal(review.status, 'needs_review');
  if (review.status === 'errored') return;
  assert.equal(path.dirname(review.jsonPath), path.join(temporary, 'output', 'review'));
  assert.deepEqual(review.destinations, { output: 'written', staging: 'skipped', mirror: 'skipped' });
});
