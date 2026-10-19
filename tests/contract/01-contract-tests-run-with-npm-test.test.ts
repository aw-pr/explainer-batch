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
  const file = path.join(FIXTURES, name);
  assert.equal(fs.existsSync(file), true, `missing fixture tests/unit/fixtures/${name}`);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(typeof parsed, 'object');
  assert.equal(Array.isArray(parsed), false);
  return parsed;
}

function firstDatasetData(doc: Record<string, any>): unknown {
  const cfg = doc.charts?.[0]?.config_json;
  assert.equal(typeof cfg, 'object', 'charts[0].config_json must be an object in this fixture');
  return cfg?.data?.datasets?.[0]?.data;
}

test('fixture: stringified config_json', () => {
  const doc = fixtureJson('stringified-config-json.json');
  assert.equal(doc.version, 1);
  assert.equal(typeof doc.metadata, 'object');
  const raw = doc.charts?.[0]?.config_json;
  assert.equal(typeof raw, 'string', 'charts[0].config_json must be a JSON string');
  const cfg = JSON.parse(raw);
  assert.ok(Array.isArray(cfg?.data?.datasets?.[0]?.data) && cfg.data.datasets[0].data.length > 0);
});

test('fixture: ordinal sequence [1,2,3,4,5]', () => {
  assert.deepEqual(firstDatasetData(fixtureJson('ordinal-sequence.json')), [1, 2, 3, 4, 5]);
});

test('fixture: uniform values [2,2,2,2]', () => {
  assert.deepEqual(firstDatasetData(fixtureJson('uniform-values.json')), [2, 2, 2, 2]);
});

test('fixture: stacked bars on a logarithmic axis', () => {
  const doc = fixtureJson('stacked-log.json');
  const cfg = doc.charts?.[0]?.config_json;
  assert.equal(typeof cfg, 'object');
  const scales = cfg?.options?.scales ?? {};
  const axes = Object.values(scales) as Array<Record<string, unknown>>;
  assert.ok(axes.some((a) => a?.stacked === true), 'no stacked axis');
  assert.ok(axes.some((a) => a?.type === 'logarithmic'), 'no logarithmic axis');
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

test('fixture: metadata-less JSON', () => {
  const doc = fixtureJson('metadata-less.json');
  assert.equal(doc.version, 1);
  assert.equal('metadata' in doc, false);
  assert.ok(Array.isArray(doc.sections) && doc.sections.length > 0);
});

test('README documents npm test', () => {
  const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
  assert.match(readme, /npm test\b/);
});
// AUTOMETTA-CONTRACT-END
