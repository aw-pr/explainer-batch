// Contract test for stage-cards/01-contract-tests-run-with-npm-test.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/01-contract-tests-run-with-npm-test.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.join(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-01-'));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/01-contract-tests-run-with-npm-test.md
const TAG = `contract01-${process.pid}`;
const UNIT_SENTINEL = path.join(REPO_ROOT, 'tests', 'unit', `${TAG}.test.ts`);
const NESTED_DIR = path.join(REPO_ROOT, 'tests', 'unit', `${TAG}-nested`);
const NESTED_SENTINEL = path.join(NESTED_DIR, `${TAG}.test.ts`);
const CONTRACT_SENTINEL = path.join(REPO_ROOT, 'tests', 'contract', `${TAG}-excluded.test.ts`);
const FAILING_SENTINEL = path.join(REPO_ROOT, 'tests', 'unit', `${TAG}-fails.test.ts`);
const UNIT_DIR = path.join(REPO_ROOT, 'tests', 'unit');
const UNIT_DIR_EXISTED = fs.existsSync(UNIT_DIR);

function sentinelSource(markerEnv: string): string {
  // A type annotation and an interface prove the runner transpiles TypeScript.
  return [
    "import { test } from 'node:test';",
    "import fs from 'node:fs';",
    'interface Marker { file: string }',
    `const marker: Marker = { file: process.env.${markerEnv} as string };`,
    "test('contract 01 sentinel', () => { fs.writeFileSync(marker.file, 'ran'); });",
    '',
  ].join('\n');
}

function runNpmTest(extraEnv: Record<string, string>) {
  // NODE_TEST_CONTEXT marks a node:test child; inherited, it turns the nested
  // runner into a silent no-op, so it is removed.
  // No npm log file or update check: a sandboxed seat cannot write under the home directory.
  const env: Record<string, string | undefined> = {
    ...process.env,
    npm_config_logs_max: '0',
    npm_config_update_notifier: 'false',
    ...extraEnv,
  };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync('npm', ['test'], {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
    timeout: 120_000,
  });
}

function cleanup(): void {
  for (const f of [UNIT_SENTINEL, CONTRACT_SENTINEL, FAILING_SENTINEL]) fs.rmSync(f, { force: true });
  fs.rmSync(NESTED_DIR, { recursive: true, force: true });
  if (!UNIT_DIR_EXISTED && fs.existsSync(UNIT_DIR) && fs.readdirSync(UNIT_DIR).length === 0) fs.rmdirSync(UNIT_DIR);
}

test('package.json declares an npm test script that uses node:test with ts-node', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const script = pkg.scripts?.test;
  assert.equal(typeof script, 'string', 'scripts.test is missing');
  assert.match(script, /--test\b/, 'scripts.test must run the node:test runner');
  assert.match(script, /ts-node\/register/, 'scripts.test must load ts-node/register');
  assert.match(script, /tests\/unit/, 'scripts.test must run the tests/unit tree');
});

test('npm test runs TypeScript tests anywhere under tests/unit and nothing under tests/contract', () => {
  const m1 = path.join(TMP, 'unit.marker');
  const m2 = path.join(TMP, 'nested.marker');
  const m3 = path.join(TMP, 'contract.marker');
  try {
    fs.mkdirSync(NESTED_DIR, { recursive: true });
    fs.writeFileSync(UNIT_SENTINEL, sentinelSource('CONTRACT01_UNIT_MARKER'));
    fs.writeFileSync(NESTED_SENTINEL, sentinelSource('CONTRACT01_NESTED_MARKER'));
    fs.writeFileSync(CONTRACT_SENTINEL, sentinelSource('CONTRACT01_CONTRACT_MARKER'));
    const res = runNpmTest({
      CONTRACT01_UNIT_MARKER: m1,
      CONTRACT01_NESTED_MARKER: m2,
      CONTRACT01_CONTRACT_MARKER: m3,
    });
    assert.equal(res.status, 0, `npm test exited ${res.status}:\n${res.stdout}\n${res.stderr}`);
    assert.equal(fs.existsSync(m1), true, 'a tests/unit/*.test.ts sentinel did not run');
    assert.equal(fs.readFileSync(m1, 'utf8'), 'ran');
    assert.equal(fs.existsSync(m2), true, 'a nested tests/unit/**/*.test.ts sentinel did not run');
    assert.equal(fs.existsSync(m3), false, 'npm test must not run tests/contract (queued cards are red by design)');
  } finally {
    cleanup();
  }
});

test('npm test exits non-zero when a unit test fails', () => {
  try {
    fs.writeFileSync(
      FAILING_SENTINEL,
      "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('contract 01 failing sentinel', () => { assert.equal(1, 2); });\n",
    );
    const res = runNpmTest({});
    assert.notEqual(res.status, 0, 'npm test passed although a unit test failed');
  } finally {
    cleanup();
  }
});

const FIXTURES = path.join(REPO_ROOT, 'tests', 'unit', 'fixtures');

function fixtureJson(name: string): Record<string, any> {
  const file = path.join(FIXTURES, 'v2', name);
  assert.equal(fs.existsSync(file), true, `01: missing fixture tests/unit/fixtures/v2/${name}`);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(parsed !== null && typeof parsed === 'object', '01: fixture object');
  assert.equal(Array.isArray(parsed), false, '01: fixture is not an array');
  assert.ok(parsed.hero && typeof parsed.hero.title === 'string' && parsed.hero.title.length > 0, '01: wire hero');
  assert.equal(Object.hasOwn(parsed, 'metadata'), false, '01: metadata belongs to the stamp');
  assert.equal(Object.hasOwn(parsed, 'version'), false, '01: version belongs to the stamp');
  assert.ok(Array.isArray(parsed.charts) && parsed.charts.length > 0, '01: fixture charts');
  return parsed;
}

function firstChart(name: string): Record<string, any> {
  const chart = fixtureJson(name).charts[0];
  assert.ok(chart && typeof chart === 'object', '01: structured chart');
  assert.ok(Array.isArray(chart.series) && chart.series.length > 0, '01: chart series');
  return chart;
}

function assertChartIssues(chart: Record<string, any>, fragment: RegExp): void {
  const { chartIssues } = require('../../src/quality') as Record<string, any>;
  assert.equal(typeof chartIssues, 'function', '01: chartIssues export');
  const issues = chartIssues(chart, 0);
  assert.ok(Array.isArray(issues) && issues.length > 0, '01: chartIssues must reject fixture');
  assert.match(issues.join('\n'), fragment, '01: expected chart issue');
}

test('fixture: v2 ordinal sequence [1,2,3,4,5]', () => {
  const chart = firstChart('ordinal-sequence.json');
  assert.deepEqual(chart.series[0].values, [1, 2, 3, 4, 5], '01: ordinal values');
  assertChartIssues(chart, /ordinal sequence/);
});

test('fixture: v2 uniform values [2,2,2,2]', () => {
  const chart = firstChart('uniform-values.json');
  assert.deepEqual(chart.series[0].values, [2, 2, 2, 2], '01: uniform values');
  assertChartIssues(chart, /uniform values/);
});

test('fixture: v2 stacked bars on a logarithmic axis', () => {
  const doc = fixtureJson('stacked-log.json');
  const chart = doc.charts[0];
  assert.equal(chart.kind, 'stacked_bar', '01: stacked bars');
  assert.equal(chart.y.scale, 'log', '01: logarithmic axis');
  const { wireIssues } = require('../../src/finalize') as Record<string, any>;
  assert.equal(typeof wireIssues, 'function', '01: wireIssues export');
  const issues = wireIssues(doc, { citationKnown: false });
  assert.ok(issues.length > 0, '01: stacked-log wire rejected');
  assert.match(issues.join('\n'), /charts\[0\].*log/i, '01: stacked-log path');
});

test('fixture: truncated output does not parse', () => {
  const file = path.join(FIXTURES, 'truncated-output.txt');
  assert.equal(fs.existsSync(file), true, 'missing fixture tests/unit/fixtures/truncated-output.txt');
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.trimStart().startsWith('{'), 'truncated output should begin as a JSON object');
  assert.ok(text.length > 40, 'truncated output should carry some content');
  assert.throws(() => JSON.parse(text));
  const { extractJson } = require('../../src/output') as typeof import('../../src/output');
  assert.throws(() => extractJson(text));
});

test('the obsolete metadata-less fixture is deleted', () => {
  for (const relative of ['metadata-less.json', 'v2/metadata-less.json']) {
    assert.equal(fs.existsSync(path.join(FIXTURES, relative)), false, `01: obsolete ${relative}`);
  }
});

test('README documents npm test', () => {
  const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
  assert.match(readme, /npm test\b/);
});
// AUTOMETTA-CONTRACT-END
