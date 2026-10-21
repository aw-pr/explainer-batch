// Contract test for stage-cards/38-one-finalise-and-repair-seam.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/38-one-finalise-and-repair-seam.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-38-')));
for (const dir of ['input', 'output', 'website', 'mirror']) fs.mkdirSync(path.join(TMP, dir));
const OUT_DIR = path.join(TMP, 'output');
const REVIEW_DIR = path.join(OUT_DIR, 'review');
const STAGING_DIR = path.join(TMP, 'website', 'explainers-new');
const MIRROR_DIR = path.join(TMP, 'mirror');

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/38-one-finalise-and-repair-seam.md
// Paths are pinned before src/ loads so the fill-only .env loader cannot send
// output to a real website checkout or Obsidian vault.
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
  throw new Error('network access is forbidden in contract test 38');
}) as typeof fetch;

const EXPECTED_DATE = '2026-10-19';
const GOOD_DATA = [12.5, 30.1, 7.2, 44, 18, 26];
const ORDINAL_DATA = [1, 2, 3, 4, 5, 6];
const ANCHORED_REF = '<a href="https://example.org/paper" target="_blank" rel="noopener noreferrer">Smith 2026</a>';
const PROVENANCE = { model: 'gpt-5.6-terra', runMode: 'batch' as const, expectedDate: EXPECTED_DATE };

function finalize(): (itemKey: string, result: unknown, ctx: Record<string, unknown>) => Promise<any> {
  const file = path.join(REPO_ROOT, 'src', 'finalize.ts');
  assert.ok(fs.existsSync(file), 'src/finalize.ts must exist');
  const mod = require('../../src/finalize') as Record<string, any>;
  assert.equal(typeof mod.finalizeResult, 'function', 'src/finalize.ts must export finalizeResult');
  return mod.finalizeResult;
}

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

function receipt(text: string, over: Record<string, unknown> = {}): Record<string, any> {
  return {
    provider: 'openai', route: 'batch-api', stage: 'synthesis', model: 'gpt-5.6-terra',
    customId: 'cid-38', attemptId: 'attempt-1', finishReason: 'stop', text,
    usage: { in: 1000, out: 500, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, source: 'reported' },
    ...over,
  };
}

function repairReply(text: string | undefined, over: Record<string, unknown> = {}): Record<string, any> {
  return receipt(text ?? '', { stage: 'repair', route: 'sync-api', model: 'gpt-5.6-luna', attemptId: `repair-${crypto.randomUUID()}`, ...over });
}

// Values go through JSON, as a persisted checkpoint would.
function store() {
  const map = new Map<string, string>();
  return {
    map,
    get(key: string) {
      const v = map.get(key);
      return v === undefined ? undefined : JSON.parse(v);
    },
    put(key: string, value: unknown) {
      assert.equal(typeof key, 'string');
      map.set(key, JSON.stringify(value));
    },
  };
}

function repairer(replies: Array<Record<string, any>>) {
  const calls: Array<{ instruction: string; payload: string }> = [];
  const fn = async (instruction: string, payload: string) => {
    calls.push({ instruction, payload });
    const next = replies.shift();
    assert.ok(next, 'repair called more often than the test allows');
    return next;
  };
  return { fn, calls };
}

function ctx(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { provenance: PROVENANCE, checkpoints: store(), ...over };
}

function chartData(article: any): unknown {
  const cfg = article.charts?.[0]?.config_json;
  return (typeof cfg === 'string' ? JSON.parse(cfg) : cfg)?.data?.datasets?.[0]?.data;
}

function sha256File(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function listOutputs(): string[] {
  const walk = (dir: string): string[] => fs.existsSync(dir)
    ? fs.readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      return fs.statSync(p).isDirectory() ? walk(p) : [p];
    })
    : [];
  return [...walk(OUT_DIR), ...walk(STAGING_DIR), ...walk(MIRROR_DIR)].sort();
}

test('38: the seam and its bridges are exported, and the legacy names still work', () => {
  finalize();
  const output = require('../../src/output') as Record<string, any>;
  const quality = require('../../src/quality') as Record<string, any>;
  const repair = require('../../src/repair') as Record<string, any>;
  assert.equal(typeof output.persistArtefact, 'function', 'src/output.ts exports persistArtefact');
  assert.equal(typeof output.saveResult, 'function', 'saveResult stays as a bridge');
  assert.equal(typeof output.canonicaliseExplainerJson, 'function');
  assert.equal(typeof output.extractJson, 'function');
  assert.equal(typeof quality.validateJsonOutput, 'function');
  assert.equal(typeof quality.buildRepairInstruction, 'function');
  assert.equal(typeof repair.repairUntilValid, 'function', 'repairUntilValid stays as a bridge');
  assert.equal(repair.MAX_REPAIR_ATTEMPTS, 2);
  assert.equal(typeof quality.isChartIssue, 'function', 'src/quality.ts exports isChartIssue');
  for (const issue of [
    `charts[0].datasets[0].data is an ordinal sequence ([1,2,3]) - bar height is encoding rank order.`,
    'charts must not contain more than 4 entries.',
    'charts[1].caption is empty.',
    'chart must be an object when present.',
    'style (dash) at charts[0].caption: no em dashes.',
  ]) assert.equal(quality.isChartIssue(issue), true, issue);
  for (const issue of [
    'Missing hero.subtitle.',
    'references[0] is empty.',
    'style (dash) at sections[0].paragraphs[0]: no em dashes.',
    'top_block.pills must contain between 2 and 6 pills.',
  ]) assert.equal(quality.isChartIssue(issue), false, issue);
});

test('38: finalize.ts launches no hidden model calls and never calls saveResult', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'src', 'finalize.ts'), 'utf8');
  const specifiers = [...src.matchAll(/(?:from\s+|require\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.ok(specifiers.length > 0);
  for (const banned of ['./providers', './batch', './vision', './figure-vlm', './figure-data', './index']) {
    assert.ok(!specifiers.includes(banned), `finalize.ts must not import ${banned}`);
  }
  assert.doesNotMatch(src, /\bsaveResult\b|\battachFigureImage\b/, 'the seam composes the pure pieces, not the legacy save path');
});

test('38: a clean receipt is saved, staged and mirrored as a success with no repair call', async () => {
  const finalizeResult = finalize();
  const repair = repairer([]);
  const input = receipt(JSON.stringify(doc('clean')));
  const outcome = await finalizeResult('item-clean', input, ctx({ repair: repair.fn }));
  assert.equal(outcome.status, 'succeeded', JSON.stringify(outcome.issues));
  assert.equal(outcome.itemKey, 'item-clean');
  assert.equal(repair.calls.length, 0);
  assert.equal(outcome.repairAttempts, 0);
  const file = `${EXPECTED_DATE}_smith_clean_explainer.json`;
  assert.equal(outcome.jsonPath, path.join(OUT_DIR, file));
  assert.deepEqual(outcome.destinations, { output: 'written', staging: 'written', mirror: 'written' });
  assert.ok(fs.existsSync(path.join(STAGING_DIR, file)), 'a success is staged');
  assert.ok(fs.existsSync(path.join(MIRROR_DIR, file)), 'a success is mirrored');
  assert.equal(outcome.artefactDigest, sha256File(outcome.jsonPath), 'the digest is of the exact bytes saved');
  const saved = JSON.parse(fs.readFileSync(outcome.jsonPath, 'utf8'));
  assert.deepEqual(saved, outcome.article);
  assert.deepEqual(saved.metadata.quality, { issues: [], needs_review: false });
  assert.equal(saved.metadata.model, 'gpt-5.6-terra');
  assert.equal(saved.metadata.run_mode, 'batch');
  assert.deepEqual(outcome.issues, []);
  assert.equal(outcome.receipts.length, 1);
  assert.equal(outcome.receipts[0].customId, 'cid-38');
  assert.equal(outcome.receipts[0].usage.in, 1000);
  assert.equal(typeof outcome.chartDigest, 'string');
  assert.ok(outcome.chartDigest.length > 0);
});

test('38: identical receipts from all six routes give the same canonical article', async () => {
  const finalizeResult = finalize();
  const text = JSON.stringify(doc('routes'));
  const routes = [
    ['claude', 'batch-api', 'claude-opus-4-8'], ['claude', 'sync-api', 'claude-opus-4-8'], ['claude', 'subscription-cli', 'claude-opus-4-8'],
    ['openai', 'batch-api', 'gpt-5.6-terra'], ['openai', 'sync-api', 'gpt-5.6-terra'], ['openai', 'subscription-cli', 'gpt-5.6-terra'],
  ];
  const articles: any[] = [];
  for (const [provider, route, model] of routes) {
    const runMode = route === 'batch-api' ? 'batch' : 'sync';
    const outcome = await finalizeResult(`item-${provider}-${route}`, receipt(text, { provider, route, model, customId: `cid-${provider}-${route}` }),
      ctx({ provenance: { ...PROVENANCE, model, runMode } }));
    assert.equal(outcome.status, 'succeeded', `${provider} ${route}: ${JSON.stringify(outcome.issues)}`);
    assert.equal(outcome.article.metadata.model, model);
    assert.equal(outcome.article.metadata.run_mode, runMode);
    const { model: _m, run_mode: _r, ...rest } = outcome.article.metadata;
    articles.push({ ...outcome.article, metadata: rest });
  }
  for (const a of articles.slice(1)) assert.deepEqual(a, articles[0]);
});

test('38: deterministic fixes are made in code first, so they cost no repair call', async () => {
  const finalizeResult = finalize();
  const repair = repairer([]);
  const stale = doc('codefirst');
  stale.metadata.date_created = '2026-01-01';
  stale.metadata.filename_slug = '2026-01-01_smith_codefirst_explainer';
  stale.references = ['Smith 2026, no anchor'];
  const outcome = await finalizeResult('item-codefirst', receipt(JSON.stringify(stale)),
    ctx({ repair: repair.fn, provenance: { ...PROVENANCE, detectedReference: ANCHORED_REF } }));
  assert.equal(repair.calls.length, 0, 'date, slug prefix and detected reference are stamped, not repaired');
  assert.equal(outcome.status, 'succeeded', JSON.stringify(outcome.issues));
  assert.equal(outcome.article.metadata.date_created, EXPECTED_DATE);
  assert.equal(outcome.article.metadata.filename_slug, `${EXPECTED_DATE}_smith_codefirst_explainer`);
  assert.deepEqual(outcome.article.references, [ANCHORED_REF]);
  assert.equal(path.basename(outcome.jsonPath), `${EXPECTED_DATE}_smith_codefirst_explainer.json`);
});

test('38: chart issues never reach repair and chart data never changes; a chart-only issue goes to review', async () => {
  const finalizeResult = finalize();
  const repair = repairer([]);
  const outcome = await finalizeResult('item-chartonly', receipt(JSON.stringify(doc('chartonly', ORDINAL_DATA))), ctx({ repair: repair.fn }));
  assert.equal(repair.calls.length, 0, 'no repair call when only chart issues remain');
  assert.equal(outcome.status, 'needs_review');
  assert.ok(outcome.issues.some((i: string) => /ordinal sequence/.test(i)), JSON.stringify(outcome.issues));
  const file = `${EXPECTED_DATE}_smith_chartonly_explainer.json`;
  assert.equal(outcome.jsonPath, path.join(REVIEW_DIR, file), 'a review artefact goes to output/review/');
  assert.ok(!fs.existsSync(path.join(OUT_DIR, file)), 'and not to the normal output');
  assert.ok(!fs.existsSync(path.join(STAGING_DIR, file)), 'a review artefact is never staged');
  assert.ok(!fs.existsSync(path.join(MIRROR_DIR, file)), 'or mirrored');
  assert.deepEqual(outcome.destinations, { output: 'written', staging: 'skipped', mirror: 'skipped' });
  const saved = JSON.parse(fs.readFileSync(outcome.jsonPath, 'utf8'));
  assert.equal(saved.metadata.quality.needs_review, true);
  assert.deepEqual(saved.metadata.quality.issues, outcome.issues);
  assert.equal(outcome.artefactDigest, sha256File(outcome.jsonPath));
});

test('38: prose repair sees no chart data, and a reply that alters chart numbers keeps the originals', async () => {
  const finalizeResult = finalize();
  const broken = doc('protect', ORDINAL_DATA);
  delete broken.hero.subtitle;

  const baseline = await finalizeResult('item-protect-base', receipt(JSON.stringify(broken)), ctx());
  assert.equal(baseline.status, 'needs_review');

  const fixed = doc('protect', [100, 200, 300, 400, 500, 600]);
  fixed.charts.push({ title: 'Invented', caption: 'New', config_json: JSON.stringify({ type: 'bar', data: { labels: ['a', 'b', 'c', 'd', 'e', 'f'], datasets: [{ label: 'X', data: [9, 8, 7, 6, 5, 4] }] } }) });
  const repair = repairer([repairReply(JSON.stringify(fixed))]);
  const outcome = await finalizeResult('item-protect', receipt(JSON.stringify(broken)), ctx({ repair: repair.fn }));

  assert.equal(repair.calls.length, 1);
  const { instruction, payload } = repair.calls[0];
  assert.match(instruction, /hero\.subtitle/, 'the prose issue is in the instruction');
  assert.doesNotMatch(instruction, /ordinal sequence/, 'the chart issue is not');
  const sent = JSON.parse(payload);
  for (const key of ['charts', 'chart', 'recreated_figure']) assert.equal(key in sent, false, `the repair payload carries no ${key}`);
  assert.equal(sent.metadata.filename_slug, `${EXPECTED_DATE}_smith_protect_explainer`, 'the payload is the stamped candidate');

  assert.equal(outcome.article.hero.subtitle, 'Subtitle', 'the prose fix is kept');
  assert.equal(outcome.article.charts.length, 1, 'a chart the repair added is discarded');
  assert.deepEqual(chartData(outcome.article), ORDINAL_DATA, 'chart numbers are the originals');
  assert.equal(outcome.chartDigest, baseline.chartDigest, 'the chart-data digest is unchanged by repair');
  assert.equal(outcome.status, 'needs_review', 'the chart issue still stands');
  assert.equal(outcome.receipts.length, 2);
  assert.equal(outcome.receipts[1].stage, 'repair');
});

test('38: repair is bounded at two attempts and keeps the best candidate', async () => {
  const finalizeResult = finalize();
  const broken = doc('bounded');
  delete broken.hero.subtitle;
  delete broken.hero.headline_html;
  const half = doc('bounded');
  delete half.hero.headline_html;
  const worse = doc('bounded');
  delete worse.hero.subtitle;
  delete worse.hero.headline_html;
  delete worse.hero.headline;
  const repair = repairer([
    repairReply(JSON.stringify(half)),
    repairReply(JSON.stringify(worse)),
    repairReply(JSON.stringify(doc('bounded'))),
  ]);
  const outcome = await finalizeResult('item-bounded', receipt(JSON.stringify(broken)), ctx({ repair: repair.fn }));
  assert.equal(repair.calls.length, 2, 'at most two repair calls');
  assert.equal(outcome.repairAttempts, 2);
  assert.equal(outcome.status, 'needs_review');
  assert.equal(outcome.article.hero.subtitle, 'Subtitle', 'the better first reply is kept');
  assert.ok(outcome.issues.some((i: string) => /headline_html/.test(i)), JSON.stringify(outcome.issues));
  assert.ok(!outcome.issues.some((i: string) => /hero\.subtitle/.test(i)), JSON.stringify(outcome.issues));
  assert.equal(outcome.article.hero.headline, 'Headline', 'a worse later reply does not replace the best');
  assert.equal(outcome.receipts.length, 3, 'every receipt is kept, including the rejected one');
  assert.equal(outcome.receipts[2].text, JSON.stringify(worse));

  const junk = repairer([repairReply('this is not json at all'), repairReply(JSON.stringify(doc('junkreply')))]);
  const brokenJunk = doc('junkreply');
  delete brokenJunk.hero.subtitle;
  const afterJunk = await finalizeResult('item-junkreply', receipt(JSON.stringify(brokenJunk)), ctx({ repair: junk.fn }));
  assert.equal(junk.calls.length, 2, 'an unparseable reply uses up an attempt');
  assert.equal(afterJunk.status, 'succeeded', JSON.stringify(afterJunk.issues));
  assert.equal(afterJunk.receipts[1].text, 'this is not json at all');

  const once = repairer([repairReply(JSON.stringify(doc('fixedonce')))]);
  const brokenOnce = doc('fixedonce');
  delete brokenOnce.hero.subtitle;
  const good = await finalizeResult('item-fixedonce', receipt(JSON.stringify(brokenOnce)), ctx({ repair: once.fn }));
  assert.equal(once.calls.length, 1, 'repair stops once nothing repairable remains');
  assert.equal(good.status, 'succeeded', JSON.stringify(good.issues));

  const truncated = repairer([
    repairReply(undefined, { finishReason: 'length', error: { code: 'OUTPUT_LIMIT', message: 'cut off', retryable: false } }),
    repairReply(JSON.stringify(doc('truncrepair'))),
  ]);
  const brokenTrunc = doc('truncrepair');
  delete brokenTrunc.hero.subtitle;
  const afterTrunc = await finalizeResult('item-truncrepair', receipt(JSON.stringify(brokenTrunc)), ctx({ repair: truncated.fn }));
  assert.equal(truncated.calls.length, 2, 'a truncated repair reply uses up an attempt');
  assert.equal(afterTrunc.status, 'succeeded');
  assert.equal(afterTrunc.receipts[1].finishReason, 'length');
});

test('38: unparseable or metadata-less output fails INVALID_JSON with no repair and nothing saved', async () => {
  const finalizeResult = finalize();
  for (const [key, text] of [
    ['item-badjson', 'Sorry, I cannot help with that.'],
    ['item-nometa', JSON.stringify({ version: 1, sections: [{ label: 'Only', paragraphs: ['x'] }] })],
  ]) {
    const before = listOutputs();
    const repair = repairer([]);
    const input = receipt(text);
    const outcome = await finalizeResult(key, input, ctx({ repair: repair.fn }));
    assert.equal(outcome.status, 'errored');
    assert.equal(outcome.code, 'INVALID_JSON');
    assert.ok(typeof outcome.message === 'string' && outcome.message.length > 0);
    assert.equal(repair.calls.length, 0, 'no model call to reconstruct an unknown article');
    assert.deepEqual(listOutputs(), before, 'nothing is written');
    assert.equal(outcome.receipts.length, 1);
    assert.equal(outcome.receipts[0].text, text, 'the raw receipt is preserved');
  }
});

test('38: a truncated or failed synthesis is errored with its own code, never saved', async () => {
  const finalizeResult = finalize();
  const before = listOutputs();
  const repair = repairer([]);
  const outcome = await finalizeResult('item-length', receipt(JSON.stringify(doc('length')).slice(0, 200), {
    finishReason: 'length', error: { code: 'OUTPUT_LIMIT', message: 'max tokens', retryable: false },
  }), ctx({ repair: repair.fn }));
  assert.equal(outcome.status, 'errored');
  assert.equal(outcome.code, 'OUTPUT_LIMIT');
  assert.equal(repair.calls.length, 0);
  assert.deepEqual(listOutputs(), before);
});

test('38: a malformed receipt is an adapter bug and rejects MALFORMED_RESULT', async () => {
  const finalizeResult = finalize();
  const bad = receipt(JSON.stringify(doc('malformed')));
  delete bad.customId;
  await assert.rejects(finalizeResult('item-malformed', bad, ctx()), (err: any) => err?.code === 'MALFORMED_RESULT');
});

test('38: an optional figure is attached, and a figure failure saves without an image and a warning', async () => {
  const finalizeResult = finalize();
  const image = { source_figure: 'Figure 1', caption: 'Smith (2026), Figure 1.', src: 'figure-1.jpg' };
  const withFigure = await finalizeResult('item-figure', receipt(JSON.stringify(doc('figure'))), ctx({ figure: async () => image }));
  assert.equal(withFigure.status, 'succeeded', JSON.stringify(withFigure.issues));
  assert.deepEqual(withFigure.article.image, image);

  const failing = await finalizeResult('item-figfail', receipt(JSON.stringify(doc('figfail'))), ctx({
    figure: async () => { throw new Error('renderer missing'); },
  }));
  assert.equal(failing.status, 'succeeded');
  assert.equal('image' in failing.article, false);
  assert.ok(failing.warnings.some((w: string) => /renderer missing/.test(w)), JSON.stringify(failing.warnings));
});

test('38: replay of a finished or interrupted item makes no further repair or figure calls', async () => {
  const finalizeResult = finalize();
  const broken = doc('replay');
  delete broken.hero.subtitle;
  const input = receipt(JSON.stringify(broken), { attemptId: 'attempt-replay' });
  const checkpoints = store();
  let figureCalls = 0;
  const figure = async () => { figureCalls += 1; return { source_figure: 'Figure 2', caption: 'Smith (2026), Figure 2.' }; };

  const first = repairer([repairReply(JSON.stringify(doc('replay')))]);
  const done = await finalizeResult('item-replay', input, ctx({ checkpoints, repair: first.fn, figure }));
  assert.equal(done.status, 'succeeded', JSON.stringify(done.issues));
  assert.equal(first.calls.length, 1);
  assert.equal(figureCalls, 1);
  assert.ok(checkpoints.map.size > 0, 'progress is checkpointed');

  const again = repairer([]);
  const replay = await finalizeResult('item-replay', input, ctx({ checkpoints, repair: again.fn, figure }));
  assert.equal(again.calls.length, 0, 'replay makes no repair call');
  assert.equal(figureCalls, 1, 'replay makes no figure call');
  assert.equal(replay.status, 'succeeded');
  assert.equal(replay.artefactDigest, done.artefactDigest);
  assert.equal(replay.receipts.length, 2, 'replay returns every receipt of the attempt');

  const interrupted = store();
  const brokenI = doc('interrupt');
  delete brokenI.hero.subtitle;
  const inputI = receipt(JSON.stringify(brokenI), { attemptId: 'attempt-interrupt' });
  let figureI = 0;
  const figureCount = async () => { figureI += 1; return null; };
  const r1 = repairer([repairReply(JSON.stringify(doc('interrupt')))]);
  await assert.rejects(finalizeResult('item-interrupt', inputI, ctx({
    checkpoints: interrupted, repair: r1.fn, figure: figureCount,
    persist: async () => { throw new Error('disk full'); },
  })), /disk full/);
  assert.equal(r1.calls.length, 1);
  const r2 = repairer([]);
  const resumed = await finalizeResult('item-interrupt', inputI, ctx({ checkpoints: interrupted, repair: r2.fn, figure: figureCount }));
  assert.equal(r2.calls.length, 0, 'an interrupted save resumes without another repair');
  assert.equal(figureI, 1, 'or another figure call');
  assert.equal(resumed.status, 'succeeded');
  assert.ok(fs.existsSync(resumed.jsonPath));

  const fresh = repairer([repairReply(JSON.stringify(doc('replay')))]);
  await finalizeResult('item-replay', { ...input, attemptId: 'attempt-replay-2' }, ctx({ checkpoints, repair: fresh.fn, figure }));
  assert.equal(fresh.calls.length, 1, 'a new attempt of the same item is new work');
});
// AUTOMETTA-CONTRACT-END
