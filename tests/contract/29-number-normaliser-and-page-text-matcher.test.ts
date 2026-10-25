// Contract test for stage-cards/29-number-normaliser-and-page-text-matcher.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/29-number-normaliser-and-page-text-matcher.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const GATE_DIR = path.join(REPO_ROOT, 'contract', 'chart-gate');

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/29-number-normaliser-and-page-text-matcher.md
const FIXTURES = path.join(__dirname, 'fixtures', '29-number-normaliser-and-page-text-matcher');

function load(): { numbers: any; match: any } {
  return {
    numbers: require(path.join(GATE_DIR, 'numbers')),
    match: require(path.join(GATE_DIR, 'match')),
  };
}

function lines(file: string): string[] {
  const text = fs.readFileSync(path.join(FIXTURES, file), 'utf8');
  assert.ok(text.length > 1000, `fixture ${file} is empty`);
  return text.split('\n');
}

// pageText(n) over a fixed set of fixture pages; any other page has no text.
function pages(map: Record<number, string>): (page: number) => any {
  const { match } = load();
  return (page: number) => (map[page] ? match.pageTextFromLines(page, lines(map[page]), true) : null);
}

function synthetic(page: number, body: string[], usable = true): (p: number) => any {
  const { match } = load();
  return (p: number) => (p === page ? match.pageTextFromLines(page, body, usable) : null);
}

function values(tokens: Array<{ value: number }>): number[] {
  return tokens.map(t => t.value);
}

const DEMIRER_X = ['Lines of code', 'Files touched', 'Commits', 'Pull requests', 'Repos touched', 'Releases'];
const DEMIRER_SERIES = [
  { name: 'Autocomplete', values: [228.2, 50.8, 35.9, 11, 13.6, 10.2] },
  { name: 'Sync agent', values: [741.3, 187, 109.1, 65.5, 25.5, 20.3] },
  { name: 'Async agent', values: [658.3, 52.4, 33.6, 71.8, 13.8, null] },
];
const DEMIRER_CHART = { x: { label: 'Production layer', values: DEMIRER_X }, y: { label: 'Avg. % change after adoption' } };

const FLYVBJERG_X = ['IT', 'Nuclear storage', 'Defense', 'Olympics', 'Nuclear power', 'Buildings', 'Dams (other)',
  'Hydroelectric dams', 'Rail', 'Aerospace', 'Rail stations', 'Water', 'Mining', 'Tunnels', 'Bridges', 'Roads',
  'Fossil thermal power', 'Pipelines', 'Oil and gas', 'Wind power', 'Nuclear decommissioning', 'Energy transmission',
  'Solar power'];
const FLYVBJERG_VALUES = [0.92, 1.047, 1.235, 1.237, 1.526, 1.728, 1.793, 1.801, 1.962, 2.276, 2.31, 2.502, 2.579,
  2.621, 2.687, 2.85, 2.866, 2.966, 3.054, 4.289, 4.504, 5.463, 7.836];

const EPIC_READ_OFFS = [
  { name: 'Fully Recompute (FR)', values: [0.3, 0.7, 1.2, 1.8, 2.6, 3.4, 4.3, 5.1, 5.7, 6.2] },
  { name: 'CacheBlend-15', values: [0.25, 0.5, 0.8, 1.1, 1.4, 1.7, 2, null, null, null] },
  { name: 'LegoLink-16', values: [0.15, 0.3, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95, 1.05, 1.15] },
];
const EPIC_READ_OFF_CHART = { x: { label: 'Context length (tokens)', values: [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000, 50000] }, y: { label: 'TTFT', unit: 's' } };
const EPIC_FIG10 = [
  { name: 'Mistral 7B Instruct', values: [32.33, 58.4, 20.05, 49.49, 63.56, 40.67] },
  { name: 'Llama 3.1 8B Instruct', values: [32.31, 51.96, 17.68, 42.31, 58.79, 35.97] },
];
const EPIC_FIG10_CHART = { x: { label: 'Dataset', values: ['Needle', 'HotpotQA', 'MultiNews', 'SAMSum', 'MuSiQue', '2WikiMQA'] }, y: { label: 'Runtime overhead', unit: '%' } };

test('29: the two modules exist and stay pure, vendorable code', () => {
  for (const name of ['numbers.ts', 'match.ts']) {
    const file = path.join(GATE_DIR, name);
    assert.ok(fs.existsSync(file), `contract/chart-gate/${name} does not exist`);
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(src.trim().length > 0, `contract/chart-gate/${name} is empty`);
    const specifiers = [...src.matchAll(/(?:\bfrom\s+|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g)].map(m => m[1]);
    for (const spec of specifiers) {
      assert.match(spec, /^\.\//, `contract/chart-gate/${name} imports ${spec}; only sibling modules are allowed`);
    }
    assert.doesNotMatch(src, /\bprocess\.|\bfetch\(/, `contract/chart-gate/${name} touches process or the network`);
  }
});

test('29: tokeniseLine reads printed numbers as the grammar says', () => {
  const { numbers } = load();
  assert.deepEqual(values(numbers.tokeniseLine('CI [0.75,1.17] here')), [0.75, 1.17]);
  assert.deepEqual(values(numbers.tokeniseLine('total 13,108.7 lines')), [13108.7]);
  assert.deepEqual(values(numbers.tokeniseLine('pairs [12,5] and [1,250]')), [12, 5, 1250]);
  assert.deepEqual(values(numbers.tokeniseLine('fell by −3.1 points')), [-3.1]);
  assert.deepEqual(values(numbers.tokeniseLine('fell by –3.1 points')), [-3.1]);
  assert.deepEqual(values(numbers.tokeniseLine('Outcomes (Weeks 21–30, %)')), [21, 30]);
  assert.deepEqual(values(numbers.tokeniseLine('released 2024-06 and 2024-06-30')), []);

  const pct = numbers.tokeniseLine('overhead 58.40% of TTFT');
  assert.equal(pct.length, 1);
  assert.equal(pct[0].value, 58.4);
  assert.equal(pct[0].percent, true);
  assert.equal(pct[0].decimals, 2);
  assert.equal(pct[0].sig, 4);

  const eleven = numbers.tokeniseLine('PRs 11.0 and 187 and 10000')[0];
  assert.equal(eleven.value, 11);
  assert.equal(eleven.decimals, 1);
  assert.equal(eleven.sig, 3);
  const ticks = numbers.tokeniseLine('PRs 11.0 and 187 and 10000');
  assert.deepEqual(values(ticks), [11, 187, 10000]);
  assert.equal(ticks[1].decimals, 0);
  assert.equal(ticks[2].sig, 1, '10000 is an axis tick: one significant digit as printed');
  assert.equal(numbers.tokeniseLine('  value 42 here', 7)[0].line, 7);
  assert.equal(numbers.tokeniseLine('  value 42 here', 7)[0].column, 8);

  for (const form of ['7 × 10⁻⁵', '7 x 10^-5', '7·10^-5', '7E-5', '7e-05']) {
    const toks = numbers.tokeniseLine(`rate ${form} per call`);
    assert.equal(toks.length, 1, `${form} should be one token, got ${JSON.stringify(values(toks))}`);
    assert.ok(Math.abs(toks[0].value - 7e-5) < 1e-15, `${form} read as ${toks[0].value}`);
  }
});

test('29: valueMatchesToken is exact up to representation, never rounding', () => {
  const { numbers } = load();
  const tok = (s: string) => {
    const t = numbers.tokeniseLine(s);
    assert.equal(t.length, 1, `expected one token in ${s}`);
    return t[0];
  };
  assert.equal(numbers.valueMatchesToken(11, tok('11.0')), true);
  assert.equal(numbers.valueMatchesToken(187, tok('187.0')), true);
  assert.equal(numbers.valueMatchesToken(58.4, tok('58.40%')), true);
  assert.equal(numbers.valueMatchesToken(13108.7, tok('13,108.7')), true);
  assert.equal(numbers.valueMatchesToken(-3.1, tok('−3.1')), true);
  assert.equal(numbers.valueMatchesToken(7e-5, tok('7 × 10⁻⁵')), true);
  assert.equal(numbers.valueMatchesToken(741, tok('741.3')), false, '741 must not match 741.3');
  assert.equal(numbers.valueMatchesToken(0.9, tok('0.92')), false, '0.9 must not match 0.92');
  assert.equal(numbers.valueMatchesToken(45, tok('0.45'), { percentAxis: true }), true);
  assert.equal(numbers.valueMatchesToken(0.45, tok('45%'), { percentAxis: true }), true);
  assert.equal(numbers.valueMatchesToken(92, tok('0.92')), false, 'a unitless axis never converts fractions');
  assert.equal(numbers.valueMatchesToken(92, tok('0.92'), { percentAxis: false }), false);
});

test('29: Demirer Table 5 verifies all three series at tier A by row layout', () => {
  const { match } = load();
  const pageText = pages({ 35: 'w35275-p35.txt' });
  for (const s of DEMIRER_SERIES) {
    const v = match.matchSeries(DEMIRER_CHART, { ...s, source: { kind: 'table', ref: 'Table 5', page: 35 } }, pageText);
    assert.equal(v.pass, true, `${s.name}: ${v.reason}`);
    assert.equal(v.tier, 'A', `${s.name} should pass at tier A, got ${v.tier}`);
    assert.equal(v.page, 35);
    assert.deepEqual(v.unmatched, []);
  }
});

test('29: a citation one page off is found on the neighbour and recorded', () => {
  const { match } = load();
  const pageText = pages({ 35: 'w35275-p35.txt' });
  const v = match.matchSeries(DEMIRER_CHART, { ...DEMIRER_SERIES[1], source: { kind: 'table', ref: 'Table 5', page: 36 } }, pageText);
  assert.equal(v.pass, true, String(v.reason));
  assert.equal(v.page, 35);
  const far = match.matchSeries(DEMIRER_CHART, { ...DEMIRER_SERIES[1], source: { kind: 'table', ref: 'Table 5', page: 38 } }, pageText);
  assert.equal(far.pass, false);
  assert.match(String(far.reason), /Table 5 not found on page 38 \(searched 37 to 39\)/);
});

test('29: rounding a table value fails the series', () => {
  const { match } = load();
  const pageText = pages({ 35: 'w35275-p35.txt' });
  const rounded = { name: 'Sync agent', values: [741, 187, 109.1, 65.5, 25.5, 20.3], source: { kind: 'table', ref: 'Table 5', page: 35 } };
  const v = match.matchSeries(DEMIRER_CHART, rounded, pageText);
  assert.equal(v.pass, false);
  assert.deepEqual(v.unmatched, [741]);
});

test('29: tier B accepts unrecognised labels only for long numbers', () => {
  const { match } = load();
  const pageText = pages({ 35: 'w35275-p35.txt' });
  const renamed = { name: 'Inline completion', values: [228.2, 50.8, 35.9, 11, 13.6, 10.2], source: { kind: 'table', ref: 'Table 5', page: 35 } };
  const b = match.matchSeries({ x: { values: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] } }, renamed, pageText);
  assert.equal(b.pass, true, String(b.reason));
  assert.equal(b.tier, 'B');

  const short = synthetic(4, [
    'Table 2: Counts',
    '   Alpha   Beta   Gamma',
    '   1       2      5',
    '',
    '',
    'Body text continues here with enough words to read as prose on this page.',
  ]);
  const s = match.matchSeries({ x: { values: ['P', 'Q', 'R'] } }, { name: 'Delta', values: [1, 2, 5], source: { kind: 'table', ref: 'Table 2', page: 4 } }, short);
  assert.equal(s.pass, false, 'short numbers must not pass at tier B');
});

test('29: a table value printed only outside the table region is not a match', () => {
  const { match } = load();
  const page = synthetic(9, [
    'Table 3: Results by arm',
    '   Arm        Score',
    '   Control    412.7',
    '   Treated    530.9',
    '',
    '',
    'In the discussion we note a figure of 618.4 for a different sample entirely.',
  ]);
  const chart = { x: { values: ['Control', 'Treated', 'Pooled'] } };
  const v = match.matchSeries(chart, { name: 'Score', values: [412.7, 530.9, 618.4], source: { kind: 'table', ref: 'Table 3', page: 9 } }, page);
  assert.equal(v.pass, false);
  assert.deepEqual(v.unmatched, [618.4]);
});

test('29: Flyvbjerg Table D2 verifies 23 values by column layout', () => {
  const { match } = load();
  const pageText = pages({ 27: 'flyvbjerg-p27.txt' });
  const chart = { x: { label: 'Project type', values: FLYVBJERG_X }, y: { label: 'Alpha (tail fatness; lower = riskier)' } };
  const v = match.matchSeries(chart, { name: 'Median alpha', values: FLYVBJERG_VALUES, source: { kind: 'table', ref: 'Table D2', page: 27 } }, pageText);
  assert.equal(FLYVBJERG_VALUES.length, 23);
  assert.equal(v.pass, true, String(v.reason));
  assert.equal(v.tier, 'A');
  assert.deepEqual(v.unmatched, []);
  const d3 = FLYVBJERG_VALUES.slice();
  d3[0] = 0.91;
  const wrong = match.matchSeries(chart, { name: 'Median alpha', values: d3, source: { kind: 'table', ref: 'Table D2', page: 27 } }, pageText);
  assert.equal(wrong.pass, false, 'Table D3 values must not satisfy a Table D2 citation');
  assert.deepEqual(wrong.unmatched, [0.91]);
  const mixed = FLYVBJERG_VALUES.slice();
  mixed[0] = 0.75;
  const band = match.matchSeries(chart, { name: 'Median alpha', values: mixed, source: { kind: 'table', ref: 'Table D2', page: 27 } }, pageText);
  assert.equal(band.pass, false, 'a value taken from the CI column breaks the alpha column band');
});

test('29: EPIC read-off values fail on pages 8 and 12; Figure 10 value labels pass', () => {
  const { match } = load();
  const pageText = pages({ 8: '2410.15332v3-p08.txt', 12: '2410.15332v3-p12.txt' });
  for (const page of [8, 12]) {
    for (const s of EPIC_READ_OFFS) {
      const v = match.matchSeries(EPIC_READ_OFF_CHART, { ...s, source: { kind: 'value_labels', ref: 'Figure 9', page } }, pageText);
      assert.equal(v.pass, false, `${s.name} read-offs must fail on page ${page}`);
      assert.ok(v.unmatched.length > 0);
    }
  }
  for (const s of EPIC_FIG10) {
    const v = match.matchSeries(EPIC_FIG10_CHART, { ...s, source: { kind: 'value_labels', ref: 'Figure 10', page: 12 } }, pageText);
    assert.equal(v.pass, true, `${s.name}: ${v.reason}`);
    assert.equal(v.page, 12);
  }
  const ticks = match.matchSeries(EPIC_READ_OFF_CHART, { name: 'Ticks', values: [0.5, 1, 2], source: { kind: 'value_labels', ref: 'Figure 9', page: 8 } }, pageText);
  assert.equal(ticks.pass, false, 'axis ticks printed on the page are not value labels');
  const pts = match.matchSeries(EPIC_FIG10_CHART, { name: 'Mistral 7B Instruct', points: [{ x: 1, y: 32.33 }, { x: 2, y: 58.4 }, { x: 3, y: 20.05 }], source: { kind: 'value_labels', ref: 'Figure 10', page: 12 } }, pageText);
  assert.equal(pts.pass, true, `points[].y are the values: ${pts.reason}`);
  const two = match.matchSeries({ x: { values: ['Needle', 'HotpotQA'] }, y: { unit: '%' } }, { name: 'Mistral 7B Instruct', values: [32.33, 58.4], source: { kind: 'value_labels', ref: 'Figure 10', page: 12 } }, pageText);
  assert.equal(two.pass, false, 'fewer than three value labels need the series name or x label on the value line');
  const blind = synthetic(6, ['Scores 412.7 and 530.9 and 618.4 printed beside a chart with no caption here at all.'], false);
  const unusable = match.matchSeries({ x: { values: ['a', 'b', 'c'] } }, { name: 'Score', values: [412.7, 530.9, 618.4], source: { kind: 'value_labels', ref: 'Figure 3', page: 6 } }, blind);
  assert.equal(unusable.pass, false, 'an unusable page with no caption cannot verify value labels');
});

test('29: a text fragment must be prose that holds the values', () => {
  const { match } = load();
  const pageText = pages({ 12: '2410.15332v3-p12.txt', 35: 'w35275-p35.txt' });
  const chart = { x: { values: ['Pull requests', 'Commits', 'Files'] }, y: { unit: '%' } };
  const fragment = 'the effect on pull requests is 71.8%, substantially larger than the 33.6% effect on commits and 52.4% on files';
  const ok = match.matchSeries(chart, { name: 'Async agent', values: [71.8, 33.6, 52.4], source: { kind: 'text', ref: fragment, page: 35 } }, pageText);
  assert.equal(ok.pass, true, String(ok.reason));
  const missing = match.matchSeries(chart, { name: 'Async agent', values: [71.8, 33.6, 52.5], source: { kind: 'text', ref: fragment, page: 35 } }, pageText);
  assert.equal(missing.pass, false);
  const ticks = match.matchSeries({ x: { values: ['a', 'b', 'c'] } }, { name: 'Ticks', values: [15, 15, 15], source: { kind: 'text', ref: '15 15 15', page: 12 } }, pageText);
  assert.equal(ticks.pass, false, 'a fragment of bare axis ticks is refused');
  const absent = match.matchSeries(chart, { name: 'Async agent', values: [71.8, 33.6, 52.4], source: { kind: 'text', ref: 'a sentence about 71.8 and 33.6 and 52.4 that the paper never prints', page: 35 } }, pageText);
  assert.equal(absent.pass, false, 'a fragment that is not on the page is refused');
  const shortPage = synthetic(2, ['Sales were up 5 to 9 on 7 in the period we studied, a modest rise overall.']);
  const short = match.matchSeries({ x: { values: ['a', 'b', 'c'] } }, { name: 'Sales', values: [5, 9, 7], source: { kind: 'text', ref: 'up 5 to 9 on 7', page: 2 } }, shortPage);
  assert.equal(short.pass, false, 'a fragment under 20 characters is refused even with words in it');
  const longFragment = `Sales were up 5 to 9 on 7 ${'and the period we studied was a long one '.repeat(4)}`.trim();
  assert.ok(longFragment.length > 160);
  const longPage = synthetic(2, [longFragment]);
  const tooLong = match.matchSeries({ x: { values: ['a', 'b', 'c'] } }, { name: 'Sales', values: [5, 9, 7], source: { kind: 'text', ref: longFragment, page: 2 } }, longPage);
  assert.equal(tooLong.pass, false, 'a fragment over 160 characters is refused');
  const hyphen = synthetic(3, ['The measured improve-', 'ment was 12.5 then 30.1 and finally 44.2 percent across the three cohorts.']);
  const joined = match.matchSeries({ x: { values: ['a', 'b', 'c'] } }, { name: 'Gain', values: [12.5, 30.1, 44.2], source: { kind: 'text', ref: 'improvement was 12.5 then 30.1 and finally 44.2 percent', page: 3 } }, hyphen);
  assert.equal(joined.pass, true, `line-end hyphenation is undone: ${joined.reason}`);
});

test('29: a table caption below its table, an uncited page and an unmatched kind', () => {
  const { match } = load();
  const below = synthetic(7, [
    'Prose above the table with enough ordinary words to read as a page.',
    '',
    '',
    '   Arm        Score',
    '   Control    412.7',
    '   Treated    530.9',
    '   Table 7: Scores by arm',
    '',
    'Prose continues below the caption with ordinary words and no numbers.',
  ]);
  const up = match.matchSeries({ x: { values: ['Control', 'Treated'] } }, { name: 'Score', values: [412.7, 530.9], source: { kind: 'table', ref: 'Table 7', page: 7 } }, below);
  assert.equal(up.pass, true, `a caption below the table extends the region upward: ${up.reason}`);
  assert.equal(up.tier, 'A');
  const noPage = match.matchSeries({ x: { values: ['Control', 'Treated'] } }, { name: 'Score', values: [412.7, 530.9], source: { kind: 'table', ref: 'Table 7' } }, below);
  assert.equal(noPage.pass, false, 'a series with no cited page cannot be checked');
  const supplied = match.matchSeries({ x: { values: ['Control', 'Treated'] } }, { name: 'Score', values: [412.7, 530.9], source: { kind: 'supplied', ref: 'data.json', page: 7 } }, below);
  assert.equal(supplied.pass, false);
  assert.ok(String(supplied.reason).length > 0, 'an unmatched kind says why');
});

test('29: year and page-number tokens are excluded unless the axis is years', () => {
  const { match } = load();
  const body = [
    'Table 4: Releases by year',
    '   Year     Count',
    '   Launch   2024',
    '   Revisit  2025',
    '   Final    2026',
    '',
    '',
    'Prose words continue here so the page reads as a page of ordinary text.',
  ];
  const page = synthetic(3, body);
  const counts = { name: 'Count', values: [2024, 2025, 2026], source: { kind: 'table', ref: 'Table 4', page: 3 } };
  const asCounts = match.matchSeries({ x: { values: ['Launch', 'Revisit', 'Final'] } }, counts, page);
  assert.equal(asCounts.pass, false, 'year-like values do not match on a category axis');
  const asYears = match.matchSeries({ x: { values: [2024, 2025, 2026] } }, counts, page);
  assert.equal(asYears.pass, true, `on a year axis they do: ${asYears.reason}`);

  const footer = synthetic(5, [
    'Table 6: Scores',
    '   Arm        Score',
    '   Control    412.7',
    '',
    '',
    'Some prose words here so the page reads as ordinary text for the reader.',
    '418',
  ]);
  const pn = match.matchSeries({ x: { values: ['Control', 'Other'] } }, { name: 'Score', values: [412.7, 418], source: { kind: 'value_labels', ref: 'Figure 2', page: 5 } }, footer);
  assert.equal(pn.pass, false, 'a bare integer on its own line is a page number, not a value');
});
// AUTOMETTA-CONTRACT-END
