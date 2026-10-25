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

function finalize(): (itemKey: string, result: unknown, ctx: Record<string, unknown>) => Promise<any> {
  const file = path.join(REPO_ROOT, 'src', 'finalize.ts');
  assert.ok(fs.existsSync(file), 'src/finalize.ts must exist');
  const mod = require('../../src/finalize') as Record<string, any>;
  assert.equal(typeof mod.finalizeResult, 'function', 'src/finalize.ts must export finalizeResult');
  return mod.finalizeResult;
}

function doc(slugTitle: string, data: number[] = GOOD_DATA): Record<string, any> {
  return {
    hero: {
      title: slugTitle,
      headline: 'Governed agents separate planning from execution',
      emphasis: null,
      subtitle: 'Subtitle',
    },
    top_block: {
      kind: 'pills',
      pills: [
        { lead: 'Governance', text: 'Policy checks precede tool use.' },
        { lead: 'Audit trail', text: 'Recorded decisions support inspection.' },
      ],
    },
    charts: [{
      kind: 'bar',
      title: 'Measured latency',
      caption: 'Latency varies across the measured cases.',
      x: {
        label: 'Case', unit: null, type: 'category',
        values: data.map((_, i) => `L${i + 1}`),
      },
      y: { label: 'Latency', unit: 'ms', scale: 'linear' },
      series: [{
        name: 'Measured',
        values: [...data],
        points: null,
        source: { kind: 'table', ref: 'Table 2', page: 4 },
      }],
    }],
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
    figure_request: {
      label: 'Figure 1',
      why: 'The diagram shows the separation of planning and execution.',
    },
    end_takeaway: { label: 'Implication', body: 'Policy gates constrain tool use.' },
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
      assert.ok(typeof key === 'string' && key.length > 0, '38: checkpoint key');
      map.set(key, JSON.stringify(value));
    },
  };
}

function repairer(replies: Array<Record<string, any>>) {
  const calls: Array<{ instruction: string; payload: string }> = [];
  const fn = async (instruction: string, payload: string) => {
    assert.ok(typeof instruction === 'string' && instruction.length > 0, '38: instruction');
    assert.doesNotMatch(
      instruction,
      /date_created|filename_slug|slug|metadata|publication_date|references/i,
      '38: wire instruction only',
    );
    assert.ok(typeof payload === 'string' && payload.length > 0, '38: payload');
    calls.push({ instruction, payload });
    const next = replies.shift();
    assert.ok(next, '38: unexpected repair');
    return next;
  };
  return { fn, calls };
}

function ctx(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { stamp: { expectedDate: EXPECTED_DATE }, checkpoints: store(), ...over };
}

function chartData(article: any): unknown {
  return article.charts[0].series[0].values;
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

function sixSections(wire: Record<string, any>): Record<string, any> {
  wire.sections.push(
    { label: 'Controls', paragraphs: ['Policy gates constrain tool use.'], list: null, table: null },
    { label: 'Operations', paragraphs: ['Operators inspect recorded decisions.'], list: null, table: null },
    { label: 'Scope', paragraphs: ['Further evaluation remains necessary.'], list: null, table: null },
  );
  return wire;
}

test('38: the seam and kept helpers are exported', () => {
  finalize();
  const output = require('../../src/output') as Record<string, any>;
  const quality = require('../../src/quality') as Record<string, any>;
  const repair = require('../../src/repair') as Record<string, any>;
  assert.equal(typeof output.persistArtefact, 'function', '38: persistArtefact');
  assert.equal(typeof output.extractJson, 'function', '38: extractJson');
  assert.equal(repair.MAX_REPAIR_ATTEMPTS, 2, '38: repair bound');
  assert.equal(typeof quality.chartIssues, 'function', '38: chartIssues');
  assert.equal(typeof quality.buildWireRepairInstruction, 'function', '38: buildWireRepairInstruction');
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
  assert.equal(outcome.status, 'succeeded', '38: clean success');
  assert.equal(outcome.itemKey, 'item-clean', '38: item key');
  assert.equal(repair.calls.length, 0, '38: no repair');
  assert.equal(outcome.repairAttempts, 0, '38: no attempts');
  const file = `${EXPECTED_DATE}_smith_clean_explainer.json`;
  assert.equal(outcome.jsonPath, path.join(OUT_DIR, file), '38: output path');
  assert.deepEqual(outcome.destinations, {
    output: 'written', staging: 'written', mirror: 'written',
  }, '38: destinations');
  assert.ok(fs.existsSync(path.join(STAGING_DIR, file)), '38: staged');
  assert.ok(fs.existsSync(path.join(MIRROR_DIR, file)), '38: mirrored');
  assert.equal(outcome.artefactDigest, sha256File(outcome.jsonPath), '38: exact saved digest');
  const saved = JSON.parse(fs.readFileSync(outcome.jsonPath, 'utf8'));
  assert.deepEqual(saved, outcome.article, '38: saved article');
  assert.deepEqual(saved.metadata.quality, { issues: [], dropped: [] }, '38: clean quality');
  assert.equal(saved.version, 2, '38: version');
  assert.equal(saved.metadata.model, 'gpt-5.6-terra', '38: model');
  assert.equal(saved.metadata.provider, 'openai', '38: provider');
  assert.equal(saved.metadata.route, 'batch', '38: route');
  assert.deepEqual(outcome.issues, [], '38: no issues');
  assert.equal(outcome.receipts.length, 1, '38: synthesis receipt');
  assert.equal(outcome.receipts[0].customId, 'cid-38', '38: receipt id');
  assert.equal(outcome.receipts[0].usage.in, 1000, '38: usage');
  assert.match(outcome.chartDigest, /^[0-9a-f]{64}$/, '38: chart digest');
  assert.equal(sha256File(path.join(STAGING_DIR, file)), outcome.artefactDigest, '38: staged bytes');
  assert.equal(sha256File(path.join(MIRROR_DIR, file)), outcome.artefactDigest, '38: mirrored bytes');
});

test('38: identical receipts from all six routes give the same canonical article', async () => {
  const finalizeResult = finalize();
  const text = JSON.stringify(doc('routes'));
  const routes = [
    ['claude', 'batch-api', 'claude-opus-4-8'],
    ['claude', 'sync-api', 'claude-opus-4-8'],
    ['claude', 'subscription-cli', 'claude-opus-4-8'],
    ['openai', 'batch-api', 'gpt-5.6-terra'],
    ['openai', 'sync-api', 'gpt-5.6-terra'],
    ['openai', 'subscription-cli', 'gpt-5.6-terra'],
  ];
  const articles: any[] = [];
  for (const [provider, route, model] of routes) {
    const outcome = await finalizeResult(
      `item-${provider}-${route}`,
      receipt(text, { provider, route, model, customId: `cid-${provider}-${route}` }),
      ctx(),
    );
    assert.equal(outcome.status, 'succeeded', '38: route success');
    assert.equal(outcome.article.metadata.model, model, '38: route model');
    assert.equal(outcome.article.metadata.provider, provider, '38: route provider');
    assert.equal(outcome.article.metadata.route, route === 'batch-api' ? 'batch' : 'sync', '38: route stamp');
    const { model: _m, provider: _p, route: _r, ...rest } = outcome.article.metadata;
    articles.push({ ...outcome.article, metadata: rest });
  }
  assert.equal(articles.length, 6, '38: all routes');
  for (const article of articles.slice(1)) {
    assert.deepEqual(article, articles[0], '38: same article');
  }
});

test('38: deterministic fixes are made in code first, so they cost no repair call', async () => {
  const finalizeResult = finalize();
  const repair = repairer([]);
  const stale = doc('codefirst');
  stale.metadata = { date_created: '1900-01-01' };
  stale.hero.headline = '<b>Governed agents</b> separate planning from execution';
  stale.sections[0].paragraphs = ['<span>The paper separates planning</span> & execution.'];
  const outcome = await finalizeResult(
    'item-codefirst',
    receipt(JSON.stringify(stale)),
    ctx({ repair: repair.fn }),
  );
  assert.equal(repair.calls.length, 0, '38: deterministic fixes');
  assert.equal(outcome.status, 'succeeded', '38: success');
  assert.equal(outcome.article.metadata.date_created, EXPECTED_DATE, '38: context date');
  assert.equal(
    outcome.article.hero.headline,
    'Governed agents separate planning from execution',
    '38: plain sanitising',
  );
  assert.equal(
    outcome.article.sections[0].paragraphs[0],
    'The paper separates planning &amp; execution.',
    '38: inline sanitising',
  );
  const drops = outcome.article.metadata.quality.dropped;
  assert.ok(drops.length > 0, '38: recorded changes');
  for (const fragment of ['metadata', 'hero.headline', 'sections[0].paragraphs[0]']) {
    assert.ok(drops.some((message: string) => message.includes(fragment)), `38: drop ${fragment}`);
  }
  assert.equal(
    path.basename(outcome.jsonPath),
    `${EXPECTED_DATE}_smith_codefirst_explainer.json`,
    '38: stamped filename',
  );
});

test('38: chart issues never reach repair; a failing chart is removed and succeeds', async () => {
  const finalizeResult = finalize();
  const repair = repairer([]);
  const outcome = await finalizeResult(
    'item-chartonly',
    receipt(JSON.stringify(doc('chartonly', ORDINAL_DATA))),
    ctx({ repair: repair.fn }),
  );
  assert.equal(repair.calls.length, 0, '38: no chart repair');
  assert.equal(outcome.status, 'succeeded', '38: chart removal succeeds');
  assert.deepEqual(outcome.article.charts, [], '38: invalid chart removed');
  const drops = outcome.article.metadata.quality.dropped;
  assert.ok(drops.length > 0, '38: dropped chart recorded');
  assert.ok(drops.some((message: string) => message.includes('charts[0]')), '38: dropped chart path');
  assert.deepEqual(outcome.article.metadata.quality.issues, [], '38: issue resolved');
  const file = `${EXPECTED_DATE}_smith_chartonly_explainer.json`;
  assert.equal(outcome.jsonPath, path.join(OUT_DIR, file), '38: normal output');
  assert.equal(fs.existsSync(path.join(REVIEW_DIR, file)), false, '38: no review copy');
  assert.deepEqual(outcome.destinations, {
    output: 'written', staging: 'written', mirror: 'written',
  }, '38: successful destinations');
  assert.equal(outcome.artefactDigest, sha256File(outcome.jsonPath), '38: saved digest');
});

test('38: prose repair sees empty charts and cannot alter or add chart data', async () => {
  const finalizeResult = finalize();
  const baseline = await finalizeResult(
    'item-protect-base',
    receipt(JSON.stringify(doc('protect'))),
    ctx(),
  );
  assert.equal(baseline.status, 'succeeded', '38: clean baseline');
  assert.equal(baseline.article.charts.length, 1, '38: baseline chart');
  const broken = doc('protect');
  delete broken.hero.subtitle;

  const fixed = doc('protect', [100, 200, 300, 400, 500, 600]);
  fixed.charts.push(JSON.parse(JSON.stringify(fixed.charts[0])));
  const repair = repairer([repairReply(JSON.stringify(fixed))]);
  const outcome = await finalizeResult(
    'item-protect',
    receipt(JSON.stringify(broken)),
    ctx({ repair: repair.fn }),
  );

  assert.equal(repair.calls.length, 1, '38: one prose repair');
  const { instruction, payload } = repair.calls[0];
  assert.match(instruction, /hero\.subtitle/, '38: prose issue');
  assert.doesNotMatch(instruction, /charts\[|ordinal sequence/, '38: no chart issue');
  const sent = JSON.parse(payload);
  assert.deepEqual(sent.charts, [], '38: empty chart payload');
  assert.equal(Object.hasOwn(sent, 'metadata'), false, '38: unstamped payload');
  assert.equal(outcome.article.hero.subtitle, 'Subtitle', '38: prose adopted');
  assert.equal(outcome.article.charts.length, 1, '38: added chart discarded');
  assert.deepEqual(chartData(outcome.article), GOOD_DATA, '38: original chart values');
  assert.deepEqual(outcome.article.charts, baseline.article.charts, '38: entire chart preserved');
  assert.equal(outcome.chartDigest, baseline.chartDigest, '38: chart digest preserved');
  assert.equal(outcome.status, 'succeeded', '38: repaired success');
  assert.equal(outcome.receipts.length, 2, '38: both receipts');
  assert.equal(outcome.receipts[1].stage, 'repair', '38: repair receipt');

  const ordinalBroken = doc('ordinal protect', ORDINAL_DATA);
  delete ordinalBroken.hero.subtitle;
  const ordinalReply = doc('ordinal protect');
  const ordinalRepair = repairer([repairReply(JSON.stringify(ordinalReply))]);
  const ordinal = await finalizeResult(
    'item-ordinal-protect',
    receipt(JSON.stringify(ordinalBroken)),
    ctx({ repair: ordinalRepair.fn }),
  );
  assert.equal(ordinalRepair.calls.length, 1, '38: ordinal prose repair');
  assert.deepEqual(JSON.parse(ordinalRepair.calls[0].payload).charts, [], '38: ordinal hidden');
  assert.doesNotMatch(ordinalRepair.calls[0].instruction, /charts\[|ordinal sequence/, '38: ordinal issue hidden');
  assert.equal(ordinal.status, 'succeeded', '38: ordinal removal succeeds');
  assert.deepEqual(ordinal.article.charts, [], '38: reply cannot replace invalid original');
});

test('38: repair is bounded at two attempts and keeps the best candidate', async () => {
  const finalizeResult = finalize();
  const broken = sixSections(doc('bounded'));
  broken.hero.subtitle = 'x'.repeat(321);
  const half = sixSections(doc('bounded'));
  const worse = sixSections(doc('bounded'));
  worse.hero.subtitle = 'x'.repeat(321);
  delete worse.hero.headline;
  const repair = repairer([
    repairReply(JSON.stringify(half)),
    repairReply(JSON.stringify(worse)),
    repairReply(JSON.stringify(doc('bounded'))),
  ]);
  const outcome = await finalizeResult(
    'item-bounded',
    receipt(JSON.stringify(broken)),
    ctx({ repair: repair.fn }),
  );
  assert.equal(repair.calls.length, 2, '38: at most two repairs');
  assert.equal(outcome.repairAttempts, 2, '38: attempts recorded');
  assert.equal(outcome.status, 'needs_review', '38: editorial review');
  assert.equal(outcome.article.hero.subtitle, 'Subtitle', '38: better candidate retained');
  assert.equal(
    outcome.article.hero.headline,
    'Governed agents separate planning from execution',
    '38: worse candidate rejected',
  );
  assert.equal(outcome.article.sections.length, 6, '38: editorial sections retained');
  assert.ok(outcome.issues.length > 0, '38: surviving issue');
  assert.match(outcome.issues.join('\n'), /sections/, '38: sections issue');
  assert.doesNotMatch(outcome.issues.join('\n'), /hero\.subtitle/, '38: subtitle fixed');
  assert.deepEqual(outcome.article.metadata.quality.issues, outcome.issues, '38: quality issues');
  assert.equal(outcome.receipts.length, 3, '38: all receipts retained');
  assert.equal(outcome.receipts[2].text, JSON.stringify(worse), '38: rejected receipt retained');
  const filename = `${outcome.article.metadata.slug}.json`;
  assert.equal(outcome.jsonPath, path.join(REVIEW_DIR, filename), '38: review path');
  assert.deepEqual(outcome.destinations, {
    output: 'written', staging: 'skipped', mirror: 'skipped',
  }, '38: review destinations');
  for (const directory of [OUT_DIR, STAGING_DIR, MIRROR_DIR]) {
    assert.equal(fs.existsSync(path.join(directory, filename)), false, '38: review isolated');
  }

  const junk = repairer([
    repairReply('this is not json at all'),
    repairReply(JSON.stringify(doc('junkreply'))),
  ]);
  const brokenJunk = doc('junkreply');
  delete brokenJunk.hero.subtitle;
  const afterJunk = await finalizeResult(
    'item-junkreply',
    receipt(JSON.stringify(brokenJunk)),
    ctx({ repair: junk.fn }),
  );
  assert.equal(junk.calls.length, 2, '38: junk consumes an attempt');
  assert.equal(afterJunk.status, 'succeeded', '38: repair after junk');
  assert.equal(afterJunk.receipts[1].text, 'this is not json at all', '38: junk receipt retained');

  const once = repairer([repairReply(JSON.stringify(doc('fixedonce')))]);
  const brokenOnce = doc('fixedonce');
  delete brokenOnce.hero.subtitle;
  const good = await finalizeResult(
    'item-fixedonce',
    receipt(JSON.stringify(brokenOnce)),
    ctx({ repair: once.fn }),
  );
  assert.equal(once.calls.length, 1, '38: stop when fixed');
  assert.equal(good.status, 'succeeded', '38: one repair succeeds');

  const truncated = repairer([
    repairReply(undefined, {
      finishReason: 'length',
      error: { code: 'OUTPUT_LIMIT', message: 'cut off', retryable: false },
    }),
    repairReply(JSON.stringify(doc('truncrepair'))),
  ]);
  const brokenTrunc = doc('truncrepair');
  delete brokenTrunc.hero.subtitle;
  const afterTrunc = await finalizeResult(
    'item-truncrepair',
    receipt(JSON.stringify(brokenTrunc)),
    ctx({ repair: truncated.fn }),
  );
  assert.equal(truncated.calls.length, 2, '38: truncation consumes an attempt');
  assert.equal(afterTrunc.status, 'succeeded', '38: repair after truncation');
  assert.equal(afterTrunc.receipts[1].finishReason, 'length', '38: truncated receipt retained');
});

test('38: unparseable output fails INVALID_JSON; wire output needs no metadata key', async () => {
  const finalizeResult = finalize();
  const before = listOutputs();
  const repair = repairer([]);
  const text = 'Sorry, I cannot help with that.';
  const outcome = await finalizeResult(
    'item-badjson',
    receipt(text),
    ctx({ repair: repair.fn }),
  );
  assert.equal(outcome.status, 'errored', '38: invalid JSON error');
  assert.equal(outcome.code, 'INVALID_JSON', '38: invalid JSON code');
  assert.ok(typeof outcome.message === 'string' && outcome.message.length > 0, '38: error message');
  assert.equal(repair.calls.length, 0, '38: no reconstruction call');
  assert.deepEqual(listOutputs(), before, '38: no writes');
  assert.equal(outcome.receipts.length, 1, '38: raw receipt retained');
  assert.equal(outcome.receipts[0].text, text, '38: raw text retained');

  const wire = doc('nometa');
  assert.equal(Object.hasOwn(wire, 'metadata'), false, '38: metadata absent on wire');
  const valid = await finalizeResult(
    'item-nometa',
    receipt(JSON.stringify(wire)),
    ctx({ repair: repair.fn }),
  );
  assert.equal(valid.status, 'succeeded', '38: metadata-less wire valid');
  assert.equal(repair.calls.length, 0, '38: no repair needed');
  assert.ok(fs.existsSync(valid.jsonPath), '38: metadata-less wire saved');
  assert.equal(valid.article.metadata.date_created, EXPECTED_DATE, '38: metadata stamped');
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

test('38: replay of a finished or interrupted item makes no further repair calls', async () => {
  const finalizeResult = finalize();
  const broken = doc('replay');
  delete broken.hero.subtitle;
  const input = receipt(JSON.stringify(broken), { attemptId: 'attempt-replay' });
  const checkpoints = store();

  const first = repairer([repairReply(JSON.stringify(doc('replay')))]);
  const done = await finalizeResult(
    'item-replay',
    input,
    ctx({ checkpoints, repair: first.fn }),
  );
  assert.equal(done.status, 'succeeded', '38: initial success');
  assert.equal(first.calls.length, 1, '38: initial repair');
  assert.ok(checkpoints.map.size > 0, '38: progress checkpointed');
  assert.match(done.artefactDigest, /^[0-9a-f]{64}$/, '38: original digest');
  assert.equal(done.artefactDigest, sha256File(done.jsonPath), '38: original bytes');

  const again = repairer([]);
  const replay = await finalizeResult(
    'item-replay',
    input,
    ctx({ checkpoints, repair: again.fn }),
  );
  assert.equal(again.calls.length, 0, '38: no replay repair');
  assert.equal(replay.status, 'succeeded', '38: replay success');
  assert.equal(replay.artefactDigest, done.artefactDigest, '38: exact replay digest');
  assert.equal(replay.chartDigest, done.chartDigest, '38: replay chart digest');
  assert.equal(sha256File(replay.jsonPath), done.artefactDigest, '38: replay bytes');
  assert.equal(replay.receipts.length, 2, '38: replay receipts');
  assert.deepEqual(replay.article, done.article, '38: replay article');

  const interrupted = store();
  const brokenI = doc('interrupt');
  delete brokenI.hero.subtitle;
  const inputI = receipt(JSON.stringify(brokenI), { attemptId: 'attempt-interrupt' });
  const r1 = repairer([repairReply(JSON.stringify(doc('interrupt')))]);
  let interruptedDigest = '';
  let interruptedArticle: any;
  await assert.rejects(finalizeResult('item-interrupt', inputI, ctx({
    checkpoints: interrupted,
    repair: r1.fn,
    persist: async (article: any) => {
      interruptedArticle = JSON.parse(JSON.stringify(article));
      interruptedDigest = crypto.createHash('sha256')
        .update(JSON.stringify(article, null, 2)).digest('hex');
      throw new Error('disk full');
    },
  })), /disk full/);
  assert.equal(r1.calls.length, 1, '38: repaired before interruption');
  assert.match(interruptedDigest, /^[0-9a-f]{64}$/, '38: interrupted digest captured');
  assert.equal(interruptedArticle.hero.title, 'interrupt', '38: interrupted article captured');

  const r2 = repairer([]);
  const resumed = await finalizeResult(
    'item-interrupt',
    inputI,
    ctx({ checkpoints: interrupted, repair: r2.fn }),
  );
  assert.equal(r2.calls.length, 0, '38: no repair after interrupted save');
  assert.equal(resumed.status, 'succeeded', '38: resumed success');
  assert.ok(fs.existsSync(resumed.jsonPath), '38: resumed file');
  assert.equal(resumed.artefactDigest, interruptedDigest, '38: interrupted digest preserved');
  assert.equal(sha256File(resumed.jsonPath), interruptedDigest, '38: interrupted bytes preserved');
  assert.deepEqual(resumed.article, interruptedArticle, '38: interrupted article preserved');
  assert.equal(resumed.receipts.length, 2, '38: interrupted receipts retained');

  const fresh = repairer([repairReply(JSON.stringify(doc('replay')))]);
  const newAttempt = await finalizeResult(
    'item-replay',
    { ...input, attemptId: 'attempt-replay-2' },
    ctx({ checkpoints, repair: fresh.fn }),
  );
  assert.equal(fresh.calls.length, 1, '38: new attempt repairs');
  assert.equal(newAttempt.status, 'succeeded', '38: new attempt succeeds');
});
// AUTOMETTA-CONTRACT-END
