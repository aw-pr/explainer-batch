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
const { finalizeResult, canonicaliseWire, wireIssues, stampArtefact } = require('../../src/finalize') as typeof import('../../src/finalize');
const { persistArtefact } = require('../../src/output') as typeof import('../../src/output');
const { chartIssues, buildWireRepairInstruction } = require('../../src/quality') as typeof import('../../src/quality');
const { lintStyle } = require('../../src/style-lint') as typeof import('../../src/style-lint');
after(() => fs.rmSync(temporary, { recursive: true, force: true }));

const date = '2026-10-19';
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/v2/governed-agents.model-output.json'), 'utf8');
function article(): Record<string, any> {
  return JSON.parse(fixture);
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
  return { stamp: { expectedDate: date }, checkpoints: checkpoints(), ...overrides };
}

const fakePersist: typeof persistArtefact = async () => ({
  jsonPath: path.join(temporary, 'fake.json'),
  destinations: { output: 'written', staging: 'skipped', mirror: 'skipped' },
});

const sidecarPng = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000020000000108020000007b40e8dd' +
  '0000000d49444154789c63f8cfc000440008fe01ffc69e79f70000000049454e44ae426082', 'hex',
);

for (const [label, filename] of [
  ['Figure 3', 'figure-3.png'], ['Figure 4b', 'figure-4b.png'],
  ['Table 2', 'table-2.png'], ['Overview', 'figure.png'],
]) {
  test(`sidecar for ${label} is named ${filename} beside every JSON copy`, async () => {
    const wire = article();
    wire.hero.title = `Sidecar naming ${label}`;
    wire.figure_request = { label, why: 'The figure shows the architecture.' };
    const outcome = await finalizeResult(`naming-${label}`, receipt(wire), context({
      figure: async () => ({ label, caption: 'Architecture.', alt_text: 'A policy gate.', bytes: sidecarPng, provenance: 'vlm-crop' }),
    }));
    assert.equal(outcome.status, 'succeeded');
    if (outcome.status === 'errored') return;
    const lead = outcome.article.lead_figure!;
    assert.equal(lead.asset, `${outcome.article.metadata.slug}/${filename}`);
    assert.equal(lead.width, 2);
    assert.equal(lead.height, 1);
    for (const directory of [path.join(temporary, 'output'), path.join(temporary, 'website/explainers-new'), path.join(temporary, 'mirror')]) {
      assert.deepEqual(fs.readFileSync(path.join(directory, lead.asset)), sidecarPng);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, `${outcome.article.metadata.slug}.json`), 'utf8')), outcome.article);
    }
  });
}

test('a failed figure hook is checkpointed and preserves the request and item status', async () => {
  const wire = article();
  wire.figure_request = { label: 'Figure 3', why: 'The figure shows the architecture.' };
  let calls = 0;
  const ctx = context({
    persist: fakePersist,
    figure: async () => { calls++; throw new Error('crop unavailable'); },
  });
  const first = await finalizeResult('failed-figure', receipt(wire), ctx);
  const second = await finalizeResult('failed-figure', receipt(wire), ctx);
  assert.equal(first.status, 'succeeded');
  assert.equal(second.status, 'succeeded');
  assert.equal(calls, 1);
  if (first.status === 'errored') return;
  assert.equal(first.article.lead_figure, undefined);
  assert.deepEqual(first.article.figure_request, wire.figure_request);
  assert.ok(first.article.metadata.quality.dropped.includes('figure_request: crop unavailable'));
});

test('SVG sidecar omits dimensions and a mirror sidecar failure prevents that JSON copy', async () => {
  const wire = article();
  wire.hero.title = 'SVG mirror failure';
  wire.figure_request = { label: 'Figure 2', why: 'The figure shows the architecture.' };
  const slug = stampArtefact(wire as any, receipt(wire), { expectedDate: date }, { issues: [], dropped: [] }).metadata.slug;
  const mirrorBlocker = path.join(temporary, 'mirror', slug);
  fs.mkdirSync(path.dirname(mirrorBlocker), { recursive: true });
  fs.writeFileSync(mirrorBlocker, 'blocks the sidecar directory');
  const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>');
  const outcome = await finalizeResult('svg-sidecar', receipt(wire), context({
    figure: async () => ({ label: 'Figure 2', caption: 'Architecture.', alt_text: 'A policy gate.', bytes, provenance: 'pdf-vector-crop' }),
  }));
  assert.equal(outcome.status, 'succeeded');
  if (outcome.status === 'errored') return;
  assert.deepEqual(outcome.destinations, { output: 'written', staging: 'written', mirror: 'failed' });
  assert.equal(Object.hasOwn(outcome.article.lead_figure!, 'width'), false);
  assert.equal(Object.hasOwn(outcome.article.lead_figure!, 'height'), false);
  assert.equal(outcome.article.lead_figure!.asset, `${slug}/figure-2.svg`);
  assert.deepEqual(fs.readFileSync(path.join(temporary, 'output', outcome.article.lead_figure!.asset)), bytes);
  assert.equal(fs.existsSync(path.join(temporary, 'mirror', `${slug}.json`)), false);
});

test('retry after primary sidecar write failure reuses figure bytes before publishing JSON', async () => {
  const wire = article();
  wire.hero.title = 'Primary sidecar retry';
  wire.figure_request = { label: 'Figure 2', why: 'The figure shows the architecture.' };
  const slug = stampArtefact(wire as any, receipt(wire), { expectedDate: date }, { issues: [], dropped: [] }).metadata.slug;
  const blocker = path.join(temporary, 'output', slug);
  fs.mkdirSync(path.dirname(blocker), { recursive: true });
  fs.writeFileSync(blocker, 'blocks the sidecar directory');
  let calls = 0;
  const ctx = context({ figure: async () => {
    calls++;
    return { label: 'Figure 2', caption: 'Architecture.', alt_text: 'A policy gate.', bytes: sidecarPng, provenance: 'vlm-crop' };
  } });
  await assert.rejects(finalizeResult('retry-sidecar', receipt(wire), ctx));
  assert.equal(fs.existsSync(path.join(temporary, 'output', `${slug}.json`)), false);
  fs.unlinkSync(blocker);
  const outcome = await finalizeResult('retry-sidecar', receipt(wire), ctx);
  assert.equal(outcome.status, 'succeeded');
  assert.equal(calls, 1);
  assert.deepEqual(fs.readFileSync(path.join(temporary, 'output', slug, 'figure-2.png')), sidecarPng);
});

function editorial(): Record<string, any> {
  const wire = article();
  wire.hero.subtitle = 'x'.repeat(321);
  return wire;
}

test('canonicalisation handles text and unknown keys at each nested wire shape without stripping nulls', () => {
  const raw = article();
  raw.metadata = { slug: 'injected' };
  raw.hero.title = '<b>Governed</b> &amp; agents';
  raw.top_block = { kind: 'pills', extra: true, pills: [{ lead: '<b>Checks</b>', text: 'Policy &amp; audit', extra: true }] };
  raw.sections[0] = {
    label: '<b>Architecture</b>',
    paragraphs: ['<span>Safe</span> & useful <em class="bad">text</em>'],
    list: { ordered: false, intro: '<b>Read</b>', items: [{ label: '<i>Step</i>', body: '<span>Act</span>', extra: true }] },
    table: {
      caption: '<b>Cases</b>', columns: ['<b>Case</b>', 'Time &amp; unit'],
      rows: [['<i>A</i>', ''], ['B', '10&nbsp;ms']],
      source: { ref: '<b>Table 2</b>', page: null, extra: true }, extra: true,
    },
    extra: true,
  };
  raw.charts[0].x.values[0] = '<i>A</i>';
  raw.charts[0].series[0].source.ref = '<b>Table 2</b>';
  raw.charts[0].series[0].source.extra = true;
  raw.citation.authors[0].family = '<b>Smith</b>';
  raw.citation.authors[0].extra = true;
  raw.figure_request = { label: '<b>Figure 1</b>', why: '<i>Architecture</i>', extra: true };
  const { wire: result, dropped } = canonicaliseWire(raw, { citationKnown: false });
  const wire = result as Record<string, any>;
  assert.equal(raw.hero.title, '<b>Governed</b> &amp; agents', 'input is untouched');
  assert.equal(wire.hero.title, 'Governed & agents');
  assert.equal(wire.hero.emphasis, null);
  assert.equal(wire.sections[0].paragraphs[0], 'Safe &amp; useful <em>text</em>');
  assert.equal(wire.sections[0].list.intro, 'Read');
  assert.deepEqual(wire.sections[0].list.items[0], { label: 'Step', body: 'Act' });
  assert.deepEqual(wire.sections[0].table.rows, [['A', ''], ['B', '10\u00a0ms']]);
  assert.deepEqual(wire.sections[0].table.source, { ref: 'Table 2', page: null });
  assert.equal(wire.top_block.pills[0].text, 'Policy & audit');
  assert.equal(wire.charts[0].x.values[0], 'A');
  assert.equal(wire.charts[0].series[0].source.ref, 'Table 2');
  assert.equal(wire.citation.authors[0].family, 'Smith');
  assert.deepEqual(wire.figure_request, { label: 'Figure 1', why: 'Architecture' });
  for (const at of ['metadata', 'top_block.extra', 'top_block.pills[0].extra', 'sections[0].table.source.extra',
    'charts[0].series[0].source.extra', 'citation.authors[0].extra', 'figure_request.extra']) {
    assert.ok(dropped.some(message => message.startsWith(`${at}:`)), at);
  }
  assert.deepEqual(canonicaliseWire(wire, { citationKnown: false }), { wire, dropped: [] });
});

test('receipt stamps, detected citation and canonicalisation require no repair', async () => {
  const source = article();
  source.metadata = { date_created: '1900-01-01', model: 'injected' };
  source.citation = { authors: [] };
  source.sections[0].paragraphs = ['<span>The observed result.</span>'];
  const outcome = await finalizeResult('code-first', receipt(source), context({
    stamp: { expectedDate: date, detectedReference: article().citation, publishedOn: '2026-09', source: { kind: 'pdf', ref: 'paper.pdf' } },
    repair: async () => { assert.fail('deterministic changes must require no model call'); },
  }));
  assert.equal(outcome.status, 'succeeded');
  if (outcome.status === 'errored') return;
  assert.equal(outcome.article.metadata.slug, `${date}_smith_governed-agents_explainer`);
  assert.equal(outcome.article.metadata.model, 'receipt-model');
  assert.equal(outcome.article.metadata.provider, 'openai');
  assert.equal(outcome.article.metadata.route, 'sync');
  assert.equal(outcome.article.hero.publication_date, '2026-09');
  assert.equal(outcome.article.references[0].origin, 'detected');
  assert.deepEqual(outcome.article.sections[0].paragraphs, ['The observed result.']);
  assert.deepEqual(outcome.article.metadata.quality.issues, []);
  assert.equal(outcome.artefactDigest, createHash('sha256').update(fs.readFileSync(outcome.jsonPath)).digest('hex'));
});

test('repair cannot add charts and equal issue counts do not replace the best candidate', async () => {
  const broken = editorial();
  broken.hero.title = 'x'.repeat(81);
  const better = editorial();
  const equal = article();
  equal.hero.title = 'x'.repeat(81);
  equal.hero.headline = 'A replacement to reject';
  better.charts.push(structuredClone(better.charts[0]));
  let calls = 0;
  const outcome = await finalizeResult('bounded', receipt(broken), context({
    persist: fakePersist,
    repair: async (_instruction, payload) => {
      assert.deepEqual(JSON.parse(payload).charts, []);
      return { ...receipt(calls++ === 0 ? better : equal), stage: 'repair' };
    },
  }));
  assert.equal(calls, 2);
  assert.equal(outcome.repairAttempts, 2);
  assert.equal(outcome.receipts.length, 3);
  assert.equal(outcome.status, 'needs_review');
  if (outcome.status === 'errored') return;
  assert.equal(outcome.article.hero.title, 'Governed agents');
  assert.equal(outcome.article.hero.headline, article().hero.headline);
  assert.deepEqual(outcome.article.charts[0].series[0].values, article().charts[0].series[0].values);
  assert.equal(outcome.article.charts.length, 1);
});

test('chart issues are removed after repair and valid chart digests survive prose repair', async () => {
  for (const values of [[1, 2, 3, 4, 5, 6], [12.5, 30.1, 7.2, 44, 18, 26]]) {
    const original = article();
    original.charts[0].series[0].values = values;
    const baseline = await finalizeResult('chart-base', receipt(original), context({ persist: fakePersist }));
    const broken = structuredClone(original);
    delete broken.hero.subtitle;
    const outcome = await finalizeResult('chart-repair', receipt(broken), context({
      persist: fakePersist,
      repair: async (instruction, payload) => {
        assert.doesNotMatch(instruction, /ordinal|charts\[/);
        assert.deepEqual(JSON.parse(payload).charts, []);
        return { ...receipt(article()), stage: 'repair' };
      },
    }));
    assert.equal(outcome.status, 'succeeded');
    assert.equal(outcome.repairAttempts, 1);
    if (baseline.status === 'errored' || outcome.status === 'errored') assert.fail('expected saved artefacts');
    assert.equal(outcome.chartDigest, baseline.chartDigest);
    assert.deepEqual(outcome.article.charts, baseline.article.charts);
    assert.equal(outcome.article.charts.length, values[0] === 1 ? 0 : 1);
  }
});

test('neutral chart checks cover ordinal, share-of-whole, uniform and single-point data', async () => {
  for (const [values, message] of [
    [[1, 2, 3], /ordinal/], [[3, 2, 1], /ordinal/], [[40, 60], /share-of-whole/],
    [[0.2, 0.8], /share-of-whole/], [[7, 7, 7], /uniform/], [[9], /single point/],
  ] as const) {
    const chart = article().charts[0];
    chart.series[0].values = [...values];
    assert.match(chartIssues(chart, 2).join('\n'), message);
    assert.ok(chartIssues(chart, 2).every(issue => issue.startsWith('charts[2]')));
  }
  const scatter = article().charts[0];
  scatter.kind = 'scatter';
  scatter.x = { label: 'Time', unit: 's', type: 'linear', values: [] };
  scatter.series[0].values = [];
  scatter.series[0].points = [12.5, 30.1, 7.2, 44, 18, 26].map((y, x) => ({ x, y }));
  assert.deepEqual(chartIssues(scatter, 0), []);
  assert.deepEqual(wireIssues({ ...article(), charts: [scatter] }, { citationKnown: false }), []);
  const saved = await finalizeResult('scatter', receipt({ ...article(), charts: [scatter] }), context({ persist: fakePersist }));
  assert.equal(saved.status, 'succeeded');
  if (saved.status !== 'errored') assert.equal(saved.article.charts.length, 1);
});

test('thin-chart records retain original paths alongside invalid chart removals', async () => {
  const wire = article();
  const thin = structuredClone(wire.charts[0]);
  thin.title = 'Five measured cases';
  thin.x.values.pop();
  thin.series[0].values.pop();
  wire.charts = [null, thin];
  const saved = await finalizeResult('mixed-chart-drops', receipt(wire), context({ persist: fakePersist }));
  assert.equal(saved.status, 'succeeded');
  if (saved.status === 'errored') return;
  assert.deepEqual(saved.article.charts, []);
  assert.deepEqual(saved.article.metadata.quality.dropped, [
    'charts[0]: invalid chart removed',
    'charts[1]: "Five measured cases" dropped, fewer than 6 points',
  ]);
});

test('malformed chart series are dropped without preventing an article from saving', async () => {
  for (const series of [null, 'invalid', [null], [{ values: 'invalid' }]]) {
    const wire = article();
    wire.charts[0].series = series;
    const saved = await finalizeResult('malformed-chart-series', receipt(wire), context({ persist: fakePersist }));
    assert.equal(saved.status, 'succeeded');
    if (saved.status === 'errored') continue;
    assert.deepEqual(saved.article.charts, []);
    assert.deepEqual(saved.article.metadata.quality.issues, []);
    assert.ok(saved.article.metadata.quality.dropped.some(message => message.startsWith('charts[0]:')));
  }
});

test('invalid optional items are dropped; editorial content is kept; required failures are never persisted', async () => {
  const wire = article();
  wire.hero.emphasis = 'Absent phrase';
  wire.figure_request = { why: 'A diagram' };
  const optional = await finalizeResult('optional', receipt(wire), context({ persist: fakePersist }));
  assert.equal(optional.status, 'succeeded');
  if (optional.status === 'errored') return;
  assert.equal(Object.hasOwn(optional.article.hero, 'emphasis'), false);
  assert.equal(Object.hasOwn(optional.article, 'figure_request'), false);
  assert.ok(optional.article.metadata.quality.dropped.some(i => i.includes('figure_request')));
  const pills = article();
  pills.top_block = { kind: 'pills', pills: [{ lead: 'Controls', text: 'Policy gates.' }, { lead: 'Audit', text: 'Recorded decisions.' }] };
  const review = await finalizeResult('editorial', receipt(pills), context({ persist: fakePersist }));
  assert.equal(review.status, 'needs_review');
  assert.match(review.issues.join('\n'), /end_takeaway/);
  for (const broken of [{ ...article(), sections: [] }, { ...article(), citation: null }]) {
    const error = await finalizeResult('structural', receipt(broken), context({
      persist: async () => { assert.fail('structural failures cannot be saved'); },
    }));
    assert.equal(error.status, 'errored');
    if (error.status === 'errored') assert.equal(error.code, 'INVALID_ARTICLE');
  }
});

test('replay after persist failure retains receipts and exact digests without further repair calls', async () => {
  const source = article();
  delete source.hero.subtitle;
  let repairCalls = 0;
  const store = checkpoints();
  const ctx = context({
    checkpoints: store,
    repair: async () => { repairCalls++; return { ...receipt(article()), stage: 'repair' }; },
  });
  await assert.rejects(finalizeResult('resume', receipt(source), { ...ctx, persist: async () => { throw new Error('disk full'); } }), /disk full/);
  const saved = await finalizeResult('resume', receipt(source), ctx);
  const replay = await finalizeResult('resume', receipt(source), ctx);
  assert.equal(saved.status, 'succeeded');
  if (saved.status === 'errored' || replay.status === 'errored') assert.fail('expected saved artefacts');
  assert.equal(saved.artefactDigest, replay.artefactDigest);
  assert.deepEqual(saved.article, replay.article);
  assert.equal(saved.receipts.length, 2);
  assert.equal(repairCalls, 1);
  assert.equal([...store.values.keys()].some(key => key.endsWith(':figure')), false);
  await finalizeResult('resume', receipt(source, 'attempt-2'), ctx);
  assert.equal(repairCalls, 2);
});

test('repair and final checkpoints survive interruption without repeating completed repair work', async () => {
  for (const stage of [':repair', ':final']) {
    const source = article();
    delete source.hero.subtitle;
    const store = checkpoints();
    let calls = 0;
    const ctx = context({
      checkpoints: {
        get: store.get,
        put: async (key, value) => {
          await store.put(key, value);
          if (key.endsWith(stage)) throw new Error(`interrupted at ${stage}`);
        },
      },
      persist: fakePersist,
      repair: async () => { calls++; return receipt(article()); },
    });
    await assert.rejects(finalizeResult('checkpoint', receipt(source), ctx), /interrupted/);
    const resumed = await finalizeResult('checkpoint', receipt(source), { ...ctx, checkpoints: store });
    assert.equal(resumed.status, 'succeeded');
    assert.equal(calls, 1);
  }
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

test('malformed or empty synthesis receipts and unparseable JSON do not save or checkpoint', async () => {
  const store = checkpoints();
  const ctx = context({ checkpoints: store, persist: async () => { assert.fail('invalid receipts cannot be saved'); } });
  await assert.rejects(finalizeResult('malformed', { ...receipt(article()), attemptId: '' }, ctx), { code: 'MALFORMED_RESULT' });
  const empty = await finalizeResult('empty-receipt', { ...receipt(article()), text: '' }, ctx);
  assert.equal(empty.status, 'errored');
  if (empty.status === 'errored') assert.equal(empty.code, 'EMPTY_OUTPUT');
  assert.equal(empty.receipts[0].finishReason, 'error');
  const invalid = await finalizeResult('invalid-json', { ...receipt(article()), text: 'not JSON' }, ctx);
  assert.equal(invalid.status, 'errored');
  if (invalid.status === 'errored') assert.equal(invalid.code, 'INVALID_JSON');
  assert.equal(store.values.size, 0);
});

test('invalid harness stamps throw rather than triggering a repair or INVALID_ARTICLE outcome', async () => {
  const source = article();
  const stamp = { expectedDate: 'not-a-date' };
  assert.throws(() => stampArtefact(source as any, receipt(source), stamp, { issues: [], dropped: [] }));
  await assert.rejects(finalizeResult('bad-stamp', receipt(source), context({
    stamp,
    repair: async () => { assert.fail('code-owned values cannot be repaired'); },
    persist: async () => { assert.fail('invalid stamps cannot be saved'); },
  })));
});

test('style lint reads v2 pills, list bodies, tables and takeaways', () => {
  const wire = article();
  wire.top_block = { kind: 'pills', pills: [{ lead: '9 controls', text: 'color' }, { lead: 'Audit', text: 'Observed.' }] };
  wire.sections[0].list = { ordered: false, intro: 'color', items: [{ label: null, body: 'color' }] };
  wire.sections[1].table = { caption: 'color', columns: ['Case', 'Time'], rows: [['A', 'color']], source: null };
  wire.end_takeaway = { label: 'Finding', body: 'color' };
  const issues = lintStyle(wire);
  for (const at of ['top_block.pills[0].text', 'sections[0].list.intro', 'sections[0].list.items[0].body',
    'sections[1].table.caption', 'sections[1].table.rows[0][1]', 'end_takeaway.body']) {
    assert.ok(issues.some(i => i.path === at && i.check === 'spelling'), at);
  }
  assert.ok(issues.some(i => i.path === 'top_block.pills[0].lead' && i.check === 'number-not-in-body'));
  wire.sections[1].table.rows[0][1] = '9';
  assert.equal(lintStyle(wire).some(i => i.check === 'number-not-in-body'), false);
  assert.doesNotMatch(buildWireRepairInstruction([
    'hero.subtitle: contains metadata, date_created, slug, publication_date and references',
    'charts[0].title: invalid',
  ], { citationKnown: true }), /date_created|slug|metadata|publication_date|references|charts\[/i);
});

test('destination copy failures preserve atomic output and review copies are skipped', async () => {
  const staging = path.join(temporary, 'website', 'explainers-new');
  fs.rmSync(staging, { recursive: true, force: true });
  fs.writeFileSync(staging, 'Block staging directory creation');
  const saved = await finalizeResult('copy-failure', receipt(article()), context());
  assert.equal(saved.status, 'succeeded');
  if (saved.status === 'errored') return;
  assert.deepEqual(saved.destinations, { output: 'written', staging: 'failed', mirror: 'written' });
  assert.deepEqual(fs.readdirSync(path.join(temporary, 'output')).filter(name => name.endsWith('.tmp')), []);
  const review = await finalizeResult('review-copies', receipt(editorial()), context());
  assert.equal(review.status, 'needs_review');
  if (review.status === 'errored') return;
  assert.equal(path.dirname(review.jsonPath), path.join(temporary, 'output', 'review'));
  assert.deepEqual(review.destinations, { output: 'written', staging: 'skipped', mirror: 'skipped' });
});
