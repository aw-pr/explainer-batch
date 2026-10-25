// Contract test for stage-cards/32-typecheck-reaches-contract.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/32-typecheck-reaches-contract.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-32-')));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/32-typecheck-reaches-contract.md
const TSCONFIG = path.join(REPO_ROOT, 'tsconfig.json');
const PROBE = path.join(__dirname, 'fixtures', '32-typecheck-reaches-contract', 'src', 'uses-contract.ts');
const TSC = require.resolve('typescript/bin/tsc', { paths: [REPO_ROOT] });

function tsc(args: string[]): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [TSC, ...args], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

function config(): any {
  return JSON.parse(fs.readFileSync(TSCONFIG, 'utf8'));
}

test('32: a src file importing a sibling contract/ module type-checks under the project options', () => {
  const probeConfig = path.join(TMP, 'tsconfig.probe.json');
  fs.writeFileSync(probeConfig, JSON.stringify({
    extends: TSCONFIG,
    compilerOptions: { noEmit: true },
    include: [],
    files: [PROBE],
  }));
  const r = tsc(['-p', probeConfig]);
  assert.doesNotMatch(r.out, /TS6059/, `rootDir still excludes files outside src/:\n${r.out}`);
  assert.equal(r.status, 0, r.out);
});

test('32: the project type-check covers src/ and contract/ and nothing under tests/', () => {
  assert.ok((config().include as string[]).includes('contract/**/*.ts'), 'tsconfig include lacks contract/**/*.ts');
  const r = tsc(['-p', TSCONFIG, '--listFilesOnly']);
  assert.equal(r.status, 0, r.out);
  const listed = r.out.split('\n').map(l => l.trim()).filter(Boolean).map(f => path.resolve(f));
  assert.ok(listed.includes(path.join(REPO_ROOT, 'src', 'index.ts')), 'src/index.ts is no longer in the project');
  const contractDir = path.join(REPO_ROOT, 'contract');
  const contractFiles = fs.existsSync(contractDir)
    ? (fs.readdirSync(contractDir, { recursive: true }) as string[]).filter(f => f.endsWith('.ts')).map(f => path.join(contractDir, f))
    : [];
  for (const f of contractFiles) assert.ok(listed.includes(f), `${path.relative(REPO_ROOT, f)} is not type-checked`);
  const tests = listed.filter(f => f.startsWith(path.join(REPO_ROOT, 'tests') + path.sep));
  assert.deepEqual(tests, [], 'files under tests/ joined the project type-check');
});

test('32: the whole project still type-checks', () => {
  const r = tsc(['-p', TSCONFIG, '--noEmit']);
  assert.equal(r.status, 0, r.out);
});

test('32: no other compiler option changes', () => {
  const { rootDir, ...rest } = config().compilerOptions;
  assert.ok(rootDir === undefined || path.resolve(REPO_ROOT, rootDir) === path.resolve(REPO_ROOT), `rootDir is ${rootDir}, not the repo root`);
  assert.deepEqual(rest, {
    target: 'ES2022',
    module: 'CommonJS',
    lib: ['ES2022'],
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    outDir: 'dist',
  });
  assert.deepEqual(config().exclude, ['node_modules', 'dist']);
});
// AUTOMETTA-CONTRACT-END
