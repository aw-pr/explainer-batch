// Contract test for stage-cards/30-structural-reject-list.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/30-structural-reject-list.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const REJECT = path.join(REPO_ROOT, 'contract', 'chart-gate', 'reject.ts');

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/30-structural-reject-list.md
function rejectRules(chart: unknown): { hits: string[]; flags: string[] } {
  const mod = require(REJECT.replace(/\.ts$/, ''));
  assert.equal(typeof mod.rejectRules, 'function', 'contract/chart-gate/reject.ts must export rejectRules');
  const out = mod.rejectRules(chart);
  assert.ok(Array.isArray(out.hits) && Array.isArray(out.flags), 'rejectRules returns { hits, flags }');
  return out;
}

const RULE_ORDER = ['pie-doughnut-radar', 'line-across-categories', 'mixed-projected', 'stacked-on-log',
  'ordinal-sequence', 'two-value-split', 'no-variation', 'caption-admission'];

const src = (page = 4) => ({ kind: 'table', ref: 'Table 1', page });

function chart(over: Record<string, unknown> = {}): Record<string, any> {
  return {
    kind: 'bar',
    title: 'A measured comparison',
    caption: 'Scores by arm in the main trial.',
    x: { label: 'Arm', type: 'category', values: ['Control', 'Low dose', 'High dose'] },
    y: { label: 'Score', unit: 'points', scale: 'linear' },
    series: [{ name: 'Score', values: [412.7, 530.9, 618.4], source: src() }],
    ...over,
  };
}

function only(c: unknown, rule: string): void {
  const { hits } = rejectRules(c);
  assert.deepEqual(hits, [rule], `expected exactly [${rule}], got ${JSON.stringify(hits)}`);
}

function none(c: unknown, why: string): void {
  const { hits } = rejectRules(c);
  assert.deepEqual(hits, [], `${why}: expected no hits, got ${JSON.stringify(hits)}`);
}

test('30: reject.ts exists and is pure, vendorable code', () => {
  assert.ok(fs.existsSync(REJECT), 'contract/chart-gate/reject.ts does not exist');
  const text = fs.readFileSync(REJECT, 'utf8');
  assert.ok(text.trim().length > 0, 'reject.ts is empty');
  for (const m of text.matchAll(/(?:\bfrom\s+|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g)) {
    assert.match(m[1], /^\.\//, `reject.ts imports ${m[1]}; only sibling modules are allowed`);
  }
  assert.doesNotMatch(text, /\bprocess\.|\bfetch\(/, 'reject.ts touches process or the network');
});

test('30: a measured bar chart trips nothing', () => {
  none(chart(), 'baseline chart');
});

test('30: a doughnut in v1 form is a banned type', () => {
  const v1 = { title: 'Shares', caption: 'Shares of respondents.', config_json: JSON.stringify({ type: 'doughnut', data: { labels: ['a', 'b', 'c', 'd'], datasets: [{ label: 'Share', data: [15, 25, 40, 5] }] } }) };
  only(v1, 'pie-doughnut-radar');
  const radar = { title: 'Profile', caption: 'Profile.', config_json: { type: 'radar', data: { labels: ['a', 'b', 'c'], datasets: [{ label: 'x', data: [3.2, 4.1, 2.7] }] } } };
  only(radar, 'pie-doughnut-radar');
  only({ title: 'Polar', caption: 'Polar.', config_json: { type: 'polarArea', data: { labels: ['a', 'b', 'c'], datasets: [{ data: [3.2, 4.1, 2.7] }] } } }, 'pie-doughnut-radar');
  assert.deepEqual(rejectRules(v1).flags, [], 'a v1 entry carries no flags');
  const linearV1 = { title: 'Line', caption: 'Approximate.', config_json: { type: 'line', data: { labels: ['a', 'b', 'c'], datasets: [{ data: [1, 2, 3] }] } } };
  assert.deepEqual(rejectRules(linearV1), { hits: [], flags: [] }, 'a v1 entry is checked for the two v1 rules only');
  only(chart({ kind: 'pie' }), 'pie-doughnut-radar');
});

test('30: a line across categories is rejected; a line over dates is not', () => {
  only(chart({ kind: 'line', x: { label: 'Expertise', type: 'category', values: ['Novice', 'Intermediate', 'Expert'] }, series: [{ name: 'Accuracy', values: [77.4, 91.2, 92.8], source: src() }] }), 'line-across-categories');
  only(chart({ kind: 'line', x: { label: 'Size', type: 'linear', unit: 'tokens', values: ['<50', '~250', '~500'] }, series: [{ name: 'Rate', values: [12.4, 30.1, 41.7], source: src() }] }), 'line-across-categories');
  none(chart({ kind: 'line', x: { label: 'Quarter', type: 'category', values: ['Q1 2023', 'Q2 2023', 'Q3 2023', 'Q4 2023'] }, series: [{ name: 'Adoption', values: [12.4, 18.9, 25.3, 31.6], source: src() }] }), 'Mertens quarters are a time axis');
  none(chart({ kind: 'line', x: { label: 'Month', type: 'category', values: ['Jan 2024', 'Feb 2024', 'Mar 2024'] }, series: [{ name: 'Usage', values: [12.4, 18.9, 25.3], source: src() }] }), 'month-year labels are a time axis');
  none(chart({ kind: 'line', x: { label: 'Context', type: 'linear', unit: 'tokens', values: [5000, 10000, 20000] }, series: [{ name: 'TTFT', values: [0.31, 0.72, 1.24], source: src() }] }), 'a numeric line');
  none(chart({ kind: 'bar', x: { label: 'Expertise', type: 'category', values: ['Novice', 'Intermediate', 'Expert'] }, series: [{ name: 'Accuracy', values: [77.4, 91.2, 92.8], source: src() }] }), 'bars across categories are what bars are for');
});

test('30: observed and projected values in one chart are rejected', () => {
  const twoSeries = chart({
    x: { label: 'Year', type: 'category', values: ['2023', '2024', '2027 (proj.)', '2028 (proj.)'] },
    series: [{ name: 'Capacity', values: [41.2, 48.7, 77.5, 90.3], source: src() }, { name: 'Demand', values: [38.4, 45.1, 70.2, 86.9], source: src() }],
  });
  only(twoSeries, 'mixed-projected');
  const caption = chart({
    caption: 'A roadmap of expected qubit counts by processor generation.',
    x: { label: 'Processor', type: 'category', values: ['Heron (2024)', 'Flamingo (2025)', 'Starling (2029)'] },
    series: [{ name: 'Qubits', values: [133.5, 462.2, 2000.4], source: src() }],
  });
  only(caption, 'mixed-projected');
  const allProjected = chart({
    x: { label: 'Year', type: 'category', values: ['2027 (proj.)', '2028 (proj.)', '2029 (proj.)'] },
    series: [{ name: 'Projected capacity', values: [77.5, 90.3, 104.6], source: src() }],
  });
  none(allProjected, 'a chart whose labels are all projected is not mixed');
});

test('30: a single series over 2024 and 2028 (proj.) hits mixed-projected then two-value-split', () => {
  const { hits } = rejectRules(chart({ x: { label: 'Year', type: 'category', values: ['2024', '2028 (proj.)'] }, series: [{ name: 'Capacity', values: [1.6, 7.2], source: src() }] }));
  assert.deepEqual(hits, ['mixed-projected', 'two-value-split'], 'hits are reported in rule order');
});

test('30: stacked bars on a log scale are rejected, in v2 and in v1 form', () => {
  only(chart({ kind: 'stacked_bar', y: { label: 'Change', unit: '%', scale: 'log' }, series: [
    { name: 'Autocomplete', values: [228.2, 50.8, 35.9], source: src() },
    { name: 'Sync agent', values: [741.3, 187, 109.1], source: src() },
  ] }), 'stacked-on-log');
  none(chart({ kind: 'stacked_bar', y: { label: 'Change', unit: '%', scale: 'linear' }, series: [
    { name: 'Autocomplete', values: [228.2, 50.8, 35.9], source: src() },
    { name: 'Sync agent', values: [741.3, 187, 109.1], source: src() },
  ] }), 'stacked bars on a linear axis');
  none(chart({ kind: 'bar', y: { label: 'Change', unit: '%', scale: 'log' } }), 'unstacked bars on a log axis');
  const v1 = { title: 'Layers', caption: 'Event-study estimates.', config_json: JSON.stringify({
    type: 'bar',
    data: { labels: ['Lines', 'Files', 'Commits'], datasets: [{ label: 'A', data: [228.2, 50.8, 35.9] }, { label: 'B', data: [741.3, 187, 109.1] }] },
    options: { scales: { x: { stacked: true }, y: { type: 'logarithmic', stacked: true } } },
  }) };
  only(v1, 'stacked-on-log');
  const v1DatasetStack = { title: 'Layers', caption: 'Layers.', config_json: {
    type: 'bar',
    data: { labels: ['Lines', 'Files', 'Commits'], datasets: [{ label: 'A', stack: 's', data: [228.2, 50.8, 35.9] }, { label: 'B', stack: 's', data: [741.3, 187, 109.1] }] },
    options: { scales: { yAxis: { type: 'logarithmic' } } },
  } };
  only(v1DatasetStack, 'stacked-on-log');
});

test('30: ordinal sequences are rejected', () => {
  only(chart({ x: { label: 'Rank', type: 'category', values: ['a', 'b', 'c', 'd', 'e'] }, series: [{ name: 'Rank', values: [1, 2, 3, 4, 5], source: src() }] }), 'ordinal-sequence');
  only(chart({ x: { label: 'Rank', type: 'category', values: ['a', 'b', 'c', 'd'] }, series: [{ name: 'Rank', values: [0, 1, 2, 3], source: src() }] }), 'ordinal-sequence');
  only(chart({ x: { label: 'Rank', type: 'category', values: ['a', 'b', 'c', 'd'] }, series: [{ name: 'Rank', values: [4, 3, 2, 1], source: src() }] }), 'ordinal-sequence');
  only(chart({ x: { label: 'Level', type: 'category', values: ['a', 'b', 'c', 'd'] }, series: [{ name: 'Level', values: [0, 5, 10, 15], source: src() }] }), 'ordinal-sequence');
  none(chart({ x: { label: 'Dose', type: 'linear', unit: 'mg', values: [1, 2, 3, 4] }, series: [{ name: 'Response', values: [10, 20, 30, 40], source: src() }] }), 'a constant step from 10 on a numeric axis');
});

test('30: a two-value split is rejected', () => {
  only(chart({ x: { label: 'Group', type: 'category', values: ['Yes', 'No'] }, series: [{ name: 'Share', values: [1.6, 98.4], source: src() }] }), 'two-value-split');
  only(chart({ x: { label: 'Group', type: 'category', values: ['Before', 'After'] }, series: [{ name: 'Cost', values: [2880, 288], source: src() }] }), 'two-value-split');
  none(chart({ x: { label: 'Group', type: 'category', values: ['Before', 'After'] }, series: [
    { name: 'Cost', values: [2880, 288], source: src() }, { name: 'Time', values: [41.5, 12.7], source: src() },
  ] }), 'two series of two points are not a single split');
});

test('30: a chart with no variation is rejected; a uniform baseline beside a varying series is not', () => {
  only(chart({ x: { label: 'Arm', type: 'category', values: ['a', 'b', 'c', 'd'] }, series: [{ name: 'Score', values: [2, 2, 2, 2], source: src() }] }), 'no-variation');
  none(chart({ x: { label: 'Model', type: 'category', values: ['a', 'b', 'c', 'd'] }, series: [
    { name: 'Baseline', values: [71.9, 71.9, 71.9, 71.9], source: src() },
    { name: 'Tuned', values: [74.2, 78.6, 80.1, 83.4], source: src() },
  ] }), 'Lin baseline beside a varying series');
});

test('30: a caption or series name that admits estimation is rejected', () => {
  for (const caption of ['Values are approximate read-offs from the published curves.', 'Values traced from the published figure.',
    'Reconstructed from the authors’ description.', 'Subjective intensity ratings inferred from the text.', 'Estimated from the model in Sec. I.B.']) {
    only(chart({ caption }), 'caption-admission');
  }
  only(chart({ series: [{ name: 'Illustrative score', values: [412.7, 530.9, 618.4], source: src() }] }), 'caption-admission');
  none(chart({ caption: 'Event-study estimates (weeks 21 to 30) by tool.' }), 'Demirer event-study estimates');
});

test('30: a four-part composition is not rejected', () => {
  none(chart({ x: { label: 'Part', type: 'category', values: ['A', 'B', 'C', 'D'] }, series: [{ name: 'Share', values: [42.5, 31.5, 17.25, 8.75], source: src() }] }), 'four-part composition');
});

test('30: flags are recorded without rejecting', () => {
  const linear = rejectRules(chart({ x: { label: 'Year', type: 'category', values: ['w', 'x', 'y', 'z'] }, series: [{ name: 'Cost', values: [3500, 3200, 2900, 2600], source: src() }] }));
  assert.deepEqual(linear.hits, [], 'a straight line is not a reject rule');
  assert.ok(linear.flags.includes('linear-series'), `linear-series flag missing: ${JSON.stringify(linear.flags)}`);
  const plain = rejectRules(chart());
  assert.deepEqual(plain.flags, [], 'a measured chart carries no flags');
  const handoff = rejectRules(chart({ kind: 'line', x: { label: 'Year', type: 'category', values: ['2021', '2022', '2023', '2024', '2025'] }, series: [
    { name: 'Historical', values: [1.2, 1.5, 1.9, null, null], source: src() },
    { name: 'Outlook', values: [null, null, 1.9, 2.4, 3.1], source: src() },
  ] }));
  assert.deepEqual(handoff.hits, []);
  assert.ok(handoff.flags.includes('hand-off-gap'), `hand-off-gap flag missing: ${JSON.stringify(handoff.flags)}`);
});

test('30: rule identifiers are exactly the documented set', () => {
  const seen = new Set<string>();
  const cases = [
    { config_json: { type: 'pie', data: { labels: ['a', 'b'], datasets: [{ data: [3.5, 6.5] }] } } },
    chart({ caption: 'Approximate values.', kind: 'line', x: { label: 'L', type: 'category', values: ['Novice', '2028 (proj.)'] }, series: [{ name: 'S', values: [2, 2], source: src() }] }),
  ];
  for (const c of cases) for (const h of rejectRules(c).hits) seen.add(h);
  for (const h of seen) assert.ok(RULE_ORDER.includes(h), `unknown rule id ${h}`);
  assert.deepEqual(rejectRules(cases[1]).hits, ['line-across-categories', 'mixed-projected', 'two-value-split', 'caption-admission'],
    'every matching rule is reported, in rule order');
});

test('30: scatter points and null gaps are read as numeric values', () => {
  const scatter = chart({ kind: 'scatter', x: { label: 'Size', type: 'linear', unit: 'params', values: [] }, series: [
    { name: 'Score', points: [{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }], source: src() },
  ] });
  only(scatter, 'no-variation');
  const gappy = chart({ x: { label: 'Rank', type: 'category', values: ['a', 'b', 'c', 'd', 'e'] }, series: [{ name: 'Rank', values: [1, null, 2, 3, 4], source: src() }] });
  only(gappy, 'ordinal-sequence');
});
// AUTOMETTA-CONTRACT-END
