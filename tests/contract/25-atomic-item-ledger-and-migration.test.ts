// Contract test for stage-cards/25-atomic-item-ledger-and-migration.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/25-atomic-item-ledger-and-migration.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-25-')));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/25-atomic-item-ledger-and-migration.md
const LEGACY_FILE = path.join(TMP, 'legacy-state.json');
process.env.EXPLAINER_STATE_FILE = LEGACY_FILE;
globalThis.fetch = (async () => {
  throw new Error('network access is forbidden in contract test 25');
}) as typeof fetch;

const SRC_V2 = path.join(REPO_ROOT, 'src', 'state-v2.ts');
function v2(): Record<string, any> {
  assert.ok(fs.existsSync(SRC_V2), 'src/state-v2.ts must exist');
  return require('../../src/state-v2') as Record<string, any>;
}
function migration(): Record<string, any> {
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'src', 'state-migration.ts')), 'src/state-migration.ts must exist');
  return require('../../src/state-migration') as Record<string, any>;
}

let counter = 0;
function stateFile(): string {
  counter += 1;
  const dir = path.join(TMP, `case-${counter}`);
  fs.mkdirSync(dir);
  return path.join(dir, 'state.json');
}

function expectCode(fn: () => unknown, code: string, label: string): void {
  let thrown: any;
  try { fn(); } catch (error) { thrown = error; }
  assert.ok(thrown, `${label}: expected an error with code ${code}, nothing was thrown`);
  assert.equal(thrown.code, code, `${label}: expected ${code}, got ${thrown && thrown.code} (${thrown && thrown.message})`);
}

function receipt(i: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { runId: 'run-1', batchId: 'local_1', itemId: `item-${i}`, customId: `k_${i}`, attemptId: `k_${i}.1`, stage: 'synthesis', digest: `sha256:${i}`, ...extra };
}

function plantLock(lockDir: string, owner: Record<string, unknown>): void {
  fs.mkdirSync(lockDir);
  fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify(owner));
}

function childScript(body: string): string {
  return `require('ts-node/register'); const s = require(${JSON.stringify(SRC_V2)}); ${body}`;
}
function runChild(body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', childScript(body)], {
      cwd: REPO_ROOT, env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' }, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    child.on('error', reject);
    child.on('exit', code => { if (code !== 0 && code !== 3) reject(new Error(`child exited ${code}: ${err}`)); else resolve(code as number); });
  });
}

test('an absent state file is an empty version-2 state; the first transaction creates it', () => {
  const { loadStateV2, transactState, listReceipts, recordReceipt } = v2();
  const file = stateFile();
  const empty = loadStateV2(file);
  assert.equal(empty.version, 2);
  assert.equal(empty.revision, 0);
  assert.deepEqual(listReceipts(empty), []);
  assert.ok(!fs.existsSync(file), 'loading never creates the file');
  const after = transactState(file, (s: any) => { assert.equal(recordReceipt(s, receipt(1)), 'recorded'); });
  assert.equal(after.revision, 1);
  const reread = loadStateV2(file);
  assert.equal(reread.version, 2);
  assert.equal(reread.revision, 1);
  assert.equal(listReceipts(reread).length, 1);
  assert.equal(listReceipts(reread)[0].digest, 'sha256:1');
  const leftovers = fs.readdirSync(path.dirname(file)).filter(n => n !== 'state.json');
  assert.deepEqual(leftovers, [], 'no temp file or lock directory is left behind');
});

test('corrupt, malformed, legacy or future state is refused and left byte-for-byte untouched', () => {
  const { loadStateV2, transactState } = v2();
  const cases: Array<[string, string, string]> = [
    ['invalid JSON', '{"version": 2, "revision": ', 'STATE_CORRUPT'],
    ['wrong shape', JSON.stringify({ version: 2, revision: 'one', batches: 5 }), 'STATE_CORRUPT'],
    ['future version', JSON.stringify({ version: 3, revision: 0 }), 'STATE_VERSION_UNSUPPORTED'],
    ['legacy v1 state', JSON.stringify({ batches: [], openai_file_cache: {} }), 'STATE_VERSION_UNSUPPORTED'],
  ];
  for (const [label, bytes, code] of cases) {
    const file = stateFile();
    fs.writeFileSync(file, bytes);
    expectCode(() => loadStateV2(file), code, `load ${label}`);
    let ran = false;
    expectCode(() => transactState(file, () => { ran = true; }), code, `transact ${label}`);
    assert.equal(ran, false, `${label}: no mutation runs against refused state`);
    assert.equal(fs.readFileSync(file, 'utf8'), bytes, `${label}: the original bytes are untouched`);
  }
  const legacy = stateFile();
  fs.writeFileSync(legacy, JSON.stringify({ batches: [] }));
  let message = '';
  try { loadStateV2(legacy); } catch (error: any) { message = String(error.message); }
  assert.match(message, /migrate-state-v2/, 'a v1 state names the migration script');
});

test('receipts are recorded exactly once: an identical repeat is a no-op, a contradictory one conflicts', () => {
  const { transactState, recordReceipt, listReceipts, loadStateV2 } = v2();
  const file = stateFile();
  transactState(file, (s: any) => { recordReceipt(s, receipt(1)); });
  let outcome = '';
  transactState(file, (s: any) => { outcome = recordReceipt(s, receipt(1)); });
  assert.equal(outcome, 'duplicate');
  const before = fs.readFileSync(file, 'utf8');
  expectCode(() => transactState(file, (s: any) => { recordReceipt(s, receipt(1, { digest: 'sha256:other' })); }), 'RESULT_CONFLICT', 'contradictory receipt');
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'a failed transaction writes nothing');
  transactState(file, (s: any) => { assert.equal(recordReceipt(s, receipt(1, { attemptId: 'k_1.2', digest: 'sha256:other' })), 'recorded'); });
  transactState(file, (s: any) => { assert.equal(recordReceipt(s, receipt(1, { runId: 'run-2', digest: 'sha256:other' })), 'recorded'); });
  assert.equal(listReceipts(loadStateV2(file)).length, 3);
});

test('concurrent processes lose no updates and every receipt lands exactly once', async () => {
  const file = stateFile();
  const workers = 4;
  const each = 20;
  await Promise.all(Array.from({ length: workers }, (_, w) => runChild(`
    for (let i = 0; i < ${each}; i += 1) {
      s.transactState(${JSON.stringify(file)}, st => {
        s.recordReceipt(st, { runId: 'run-c', batchId: 'local_c', itemId: 'w${w}-' + i, customId: 'k_w${w}_' + i, attemptId: 'k_w${w}_' + i + '.1', stage: 'synthesis', digest: 'sha256:w${w}-' + i });
      }, { lockWaitMs: 60000 });
    }
  `)));
  const { loadStateV2, listReceipts } = v2();
  const state = loadStateV2(file);
  const receipts = listReceipts(state);
  assert.equal(receipts.length, workers * each, 'no receipt is lost');
  assert.equal(new Set(receipts.map((r: any) => `${r.runId}|${r.customId}|${r.attemptId}`)).size, workers * each, 'no receipt is doubled');
  assert.equal(state.revision, workers * each, 'every transaction advanced the revision exactly once');
});

test('a process that dies holding the state lock is reclaimed on the same host, and its write never lands', async () => {
  const { transactState, recordReceipt, listReceipts, loadStateV2 } = v2();
  const file = stateFile();
  transactState(file, (s: any) => { recordReceipt(s, receipt(1)); });
  const code = await runChild(`
    s.transactState(${JSON.stringify(file)}, st => {
      s.recordReceipt(st, { runId: 'run-1', batchId: 'local_1', itemId: 'crash', customId: 'k_crash', attemptId: 'k_crash.1', stage: 'synthesis', digest: 'sha256:crash' });
      process.exit(3);
    });
  `);
  assert.equal(code, 3);
  assert.ok(fs.existsSync(`${file}.lock`), 'the dead owner left its lock directory at <state>.lock');
  const owner = JSON.parse(fs.readFileSync(path.join(`${file}.lock`, 'owner.json'), 'utf8'));
  for (const field of ['nonce', 'hostname', 'pid', 'startedAt']) assert.ok(owner[field] !== undefined && owner[field] !== '', `lock owner records ${field}`);
  assert.equal(owner.hostname, os.hostname());
  const after = transactState(file, (s: any) => { recordReceipt(s, receipt(2)); }, { lockWaitMs: 10000 });
  assert.equal(after.revision, 2, 'the crashed transaction never advanced the revision');
  const ids = listReceipts(loadStateV2(file)).map((r: any) => r.customId).sort();
  assert.deepEqual(ids, ['k_1', 'k_2'], 'the crashed receipt was never written');
  assert.ok(!fs.existsSync(`${file}.lock`), 'the reclaimed lock is released');
});

test('a live or foreign lock owner yields STATE_BUSY after a finite wait and is never evicted by age', () => {
  const { transactState } = v2();
  const file = stateFile();
  transactState(file, () => {});
  const lockDir = `${file}.lock`;
  plantLock(lockDir, { nonce: 'foreign', hostname: 'another-host.invalid', pid: 1, startedAt: '2020-01-01T00:00:00.000Z' });
  const started = Date.now();
  expectCode(() => transactState(file, () => {}, { lockWaitMs: 300 }), 'STATE_BUSY', 'foreign host owner');
  assert.ok(Date.now() - started < 10000, 'the wait is finite');
  assert.ok(fs.existsSync(path.join(lockDir, 'owner.json')), 'a foreign lock is never removed');
  fs.rmSync(lockDir, { recursive: true });
  plantLock(lockDir, { nonce: 'live', hostname: os.hostname(), pid: process.pid, startedAt: '2020-01-01T00:00:00.000Z' });
  expectCode(() => transactState(file, () => {}, { lockWaitMs: 300 }), 'STATE_BUSY', 'live same-host owner');
  assert.ok(fs.existsSync(path.join(lockDir, 'owner.json')), 'a live owner keeps its lock');
  fs.rmSync(lockDir, { recursive: true });
  assert.doesNotThrow(() => transactState(file, () => {}, { lockWaitMs: 300 }));
});

test('a batch execution lock excludes a second collector of the same batch, not of another', async () => {
  const { withBatchLock, transactState, recordReceipt } = v2();
  const file = stateFile();
  let innerSame: any;
  let innerOther = false;
  await withBatchLock(file, 'batch-A', async () => {
    try { await withBatchLock(file, 'batch-A', async () => {}, { lockWaitMs: 200 }); } catch (error) { innerSame = error; }
    await withBatchLock(file, 'batch-B', async () => { innerOther = true; }, { lockWaitMs: 200 });
    transactState(file, (s: any) => { recordReceipt(s, receipt(9)); }, { lockWaitMs: 2000 });
  });
  assert.equal(innerSame && innerSame.code, 'STATE_BUSY', 'the same batch cannot be collected twice at once');
  assert.equal(innerOther, true, 'another batch can be collected meanwhile');
  let after = false;
  await withBatchLock(file, 'batch-A', async () => { after = true; }, { lockWaitMs: 200 });
  assert.equal(after, true, 'the batch lock is released when its holder finishes');
  let thrown: any;
  try { await withBatchLock(file, 'batch-C', async () => { throw new Error('boom'); }); } catch (error) { thrown = error; }
  assert.match(String(thrown && thrown.message), /boom/);
  await withBatchLock(file, 'batch-C', async () => {}, { lockWaitMs: 200 });
});

test('the file cache is namespaced by provider, account scope and purpose', () => {
  const { emptyStateV2, fileCachePut, fileCacheGet } = v2();
  const state = emptyStateV2();
  const entry = { fileId: 'file-123', sizeBytes: 10, uploadedAt: '2026-10-21T00:00:00Z', verifiedAt: '2026-10-21T00:00:00Z' };
  fileCachePut(state, 'openai', 'org-a', 'pdf', 'abc', entry);
  assert.equal(fileCacheGet(state, 'openai', 'org-a', 'pdf', 'abc').fileId, 'file-123');
  assert.equal(fileCacheGet(state, 'claude', 'org-a', 'pdf', 'abc'), undefined, 'one provider never sees another provider\'s file id');
  assert.equal(fileCacheGet(state, 'openai', 'org-b', 'pdf', 'abc'), undefined, 'another account scope is separate');
  assert.equal(fileCacheGet(state, 'openai', 'org-a', 'image', 'abc'), undefined, 'another purpose is separate');
});

const V1 = {
  batches: [
    { id: 'msgbatch_known', provider: 'claude', model: 'claude-opus-4-8', submitted_at: '2026-09-01T00:00:00Z', status: 'ended', requests: {
      'p1': { type: 'explainer', input: 'a.pdf', output: 'output/a.json', result: 'succeeded', error: null, usage: { input_tokens: 100, output_tokens: 50, standard_cost_usd: 1, batch_cost_usd: 0.5, saving_usd: 0.5 } },
    } },
    { id: 'msgbatch_noprovider', model: 'claude-opus-4-8', submitted_at: '2026-09-02T00:00:00Z', status: 'processing', requests: {
      'p2': { type: 'explainer', input: 'b.pdf', output: null, result: 'pending', error: null },
    } },
    { id: 'msgbatch_contradicts', provider: 'openai', model: 'gpt-5.6-terra', submitted_at: '2026-09-03T00:00:00Z', status: 'ended', requests: {} },
    { id: 'batch_openai_plain', provider: 'openai', model: 'gpt-5.6-terra', submitted_at: '2026-09-04T00:00:00Z', status: 'ended', requests: {
      'p4': { type: 'explainer', input: 'd.pdf', output: 'output/d.json', result: 'succeeded', error: null },
    } },
    { id: 'batch_openai_lanes', provider: 'openai', model: 'gpt-5.6-terra', lane_model: 'gpt-5.6-luna', submitted_at: '2026-09-05T00:00:00Z', status: 'processing', requests: {
      'p5::lane::methods': { type: 'lane', lane: 'methods', input: 'e.pdf', output: null, result: 'pending', error: null },
    } },
    { id: 'sync_claude_1700000000000', provider: 'claude', model: 'claude-opus-4-8', submitted_at: '2026-09-06T00:00:00Z', status: 'processing', requests: {
      'p6': { type: 'explainer', input: 'f.pdf', output: 'output/f.json', result: 'succeeded', error: null },
      'p7': { type: 'explainer', input: 'g.pdf', output: null, result: 'pending', error: null },
    } },
    { id: 'sync_openai_1700000000001', provider: 'openai', model: 'gpt-5.6-terra', submitted_at: '2026-09-07T00:00:00Z', status: 'ended', requests: {
      'p8': { type: 'explainer', input: 'h.pdf', output: 'output/h.json', result: 'succeeded', error: null, usage: { input_tokens: 7, output_tokens: 3, standard_cost_usd: 0.2, batch_cost_usd: 0.2, saving_usd: 0 } },
    } },
    { id: 'codexbatch_1700000000002', provider: 'openai', model: 'gpt-5.6-terra', submitted_at: '2026-09-08T00:00:00Z', status: 'ended', requests: {
      'p9': { type: 'explainer', input: 'i.pdf', output: 'output/i.json', result: 'succeeded', error: null },
    } },
  ],
  openai_file_cache: { 'abc123': { file_id: 'file-legacy', sha256: 'abc123', size_bytes: 42, updated_at: '2026-09-01T00:00:00Z' } },
};

test('migration converts known records, quarantines ambiguous route history and never fabricates billing', () => {
  const { migrateStateV1 } = migration();
  const input = JSON.parse(JSON.stringify(V1));
  const { state, report } = migrateStateV1(input);
  assert.deepEqual(input, V1, 'migration is pure: its input is not mutated');
  assert.equal(state.version, 2);
  const batches = state.batches as Record<string, any>;

  const known = batches['msgbatch_known'];
  assert.ok(known, 'a remote claude batch stays executable');
  assert.equal(known.provider, 'claude');
  assert.equal(known.route, 'batch-api');
  assert.equal(known.kind, 'remote');
  assert.equal(known.remoteId, 'msgbatch_known');
  assert.match(JSON.stringify(known), /output\/a\.json/, 'its outputs are retained');
  assert.equal(batches['msgbatch_noprovider'].provider, 'claude', 'a consistent record with no provider takes the old claude default');
  assert.equal(batches['msgbatch_noprovider'].route, 'batch-api');
  assert.equal(batches['batch_openai_plain'].provider, 'openai');
  assert.equal(batches['batch_openai_plain'].route, 'batch-api');

  const localClaude = batches['sync_claude_1700000000000'];
  assert.equal(localClaude.kind, 'local');
  assert.equal(localClaude.provider, 'claude');
  assert.equal(localClaude.route, 'subscription-cli');
  assert.ok(localClaude.legacy_inference, 'the inference is recorded on the record');
  const items = JSON.stringify(localClaude);
  assert.match(items, /succeeded/, 'completed results stay completed');
  assert.match(items, /outcome_unknown/, 'an unrecoverable active attempt becomes outcome_unknown');
  assert.equal(batches['codexbatch_1700000000002'].kind, 'local');
  assert.equal(batches['codexbatch_1700000000002'].provider, 'openai');
  assert.equal(batches['codexbatch_1700000000002'].route, 'subscription-cli');

  for (const id of ['sync_openai_1700000000001', 'batch_openai_lanes', 'msgbatch_contradicts']) {
    assert.equal(batches[id], undefined, `${id} must not be executable`);
    assert.ok(state.legacy && state.legacy.batches && state.legacy.batches[id], `${id} is kept in the read-only legacy archive`);
  }
  const syncOpenai = state.legacy.batches['sync_openai_1700000000001'];
  assert.equal(syncOpenai.route, null, 'an OpenAI sync route is never inferred');
  assert.equal(syncOpenai.migration_status, 'needs_route_evidence');
  assert.match(JSON.stringify(syncOpenai), /output\/h\.json/, 'the archived record keeps its history');

  for (const batch of Object.values(batches)) {
    assert.ok(['batch-api', 'sync-api', 'subscription-cli'].includes(batch.route), `executable batch ${batch.id} has a real route`);
  }
  assert.equal(state.file_cache?.openai, undefined, 'without a confirmed account scope no legacy file id enters the provider cache');
  assert.match(JSON.stringify(state.legacy), /file-legacy/, 'legacy file ids are retained as unverified entries');
  assert.ok(state.legacy_usage, 'old aggregate usage is preserved');
  assert.match(JSON.stringify(state.legacy_usage), /"input_tokens":7/);
  assert.ok(!/"(standard|batch)_cost_usd":0(?![.\d])/.test(JSON.stringify(state.legacy_usage)), 'unknown legacy charges are not relabelled as zero');
  assert.ok(Array.isArray(report.batches) && report.batches.length === V1.batches.length, 'the report covers every batch');

  const scoped = migrateStateV1(JSON.parse(JSON.stringify(V1)), { openaiAccountScope: 'org-confirmed' }).state;
  const { fileCacheGet } = v2();
  assert.equal(fileCacheGet(scoped, 'openai', 'org-confirmed', 'pdf', 'abc123')?.fileId, 'file-legacy', 'a confirmed account scope moves known file ids into the OpenAI namespace');
});

test('the migration script previews read-only, applies with a byte-for-byte backup, and refuses a busy or corrupt state', () => {
  const script = path.join(REPO_ROOT, 'scripts', 'migrate-state-v2.ts');
  assert.ok(fs.existsSync(script), 'scripts/migrate-state-v2.ts must exist');
  const run = (args: string[]) => execFileSync(process.execPath, ['--require', 'ts-node/register', script, ...args], {
    cwd: REPO_ROOT, env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  }).toString();
  const file = stateFile();
  const original = JSON.stringify(V1, null, 2);
  fs.writeFileSync(file, original);

  const preview = run(['--state', file]);
  assert.match(preview, /sync_openai_1700000000001/, 'the preview reports every batch');
  assert.match(preview, /needs_route_evidence/);
  assert.equal(fs.readFileSync(file, 'utf8'), original, 'preview never writes');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['state.json'], 'preview creates no backup or lock');

  const lockDir = `${file}.lock`;
  plantLock(lockDir, { nonce: 'foreign', hostname: 'another-host.invalid', pid: 1, startedAt: '2020-01-01T00:00:00.000Z' });
  assert.throws(() => run(['--state', file, '--apply']), 'apply refuses while another owner holds the lock');
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  fs.rmSync(lockDir, { recursive: true });

  run(['--state', file, '--apply']);
  const backups = fs.readdirSync(path.dirname(file)).filter(n => n !== 'state.json');
  assert.equal(backups.length, 1, 'apply leaves exactly one backup and no lock or temp file');
  assert.equal(fs.readFileSync(path.join(path.dirname(file), backups[0]), 'utf8'), original, 'the backup is the original bytes');
  const { loadStateV2 } = v2();
  const migrated = loadStateV2(file);
  assert.equal(migrated.version, 2);
  assert.ok(migrated.batches['msgbatch_known']);

  const corrupt = stateFile();
  fs.writeFileSync(corrupt, '{"batches": [');
  assert.throws(() => run(['--state', corrupt, '--apply']), 'a corrupt state is refused');
  assert.equal(fs.readFileSync(corrupt, 'utf8'), '{"batches": [');
});

test('the legacy runtime keeps its exports, still reads v1, and refuses to read a migrated v2 file', () => {
  fs.writeFileSync(LEGACY_FILE, JSON.stringify({ batches: [V1.batches[0]], openai_file_cache: {} }));
  const legacy = require('../../src/state') as Record<string, any>;
  for (const name of ['readState', 'writeState', 'mergeBatch', 'mergeOpenAIFileCache', 'getLatestPendingBatchByProvider', 'getBatchById']) {
    assert.equal(typeof legacy[name], 'function', `src/state.ts still exports ${name}`);
  }
  assert.equal(legacy.readState().batches[0].id, 'msgbatch_known', 'a v1 file reads as before');
  fs.writeFileSync(LEGACY_FILE, JSON.stringify({ version: 2, revision: 4, batches: {}, receipts: {}, file_cache: {} }));
  const v2Bytes = fs.readFileSync(LEGACY_FILE, 'utf8');
  expectCode(() => legacy.readState(), 'STATE_VERSION_UNSUPPORTED', 'legacy reader on a v2 file');
  assert.equal(fs.readFileSync(LEGACY_FILE, 'utf8'), v2Bytes, 'the v2 file is not touched by the legacy reader');
  assert.equal(fs.readdirSync(TMP).filter(n => n.startsWith('legacy-state.json.corrupt')).length, 0, 'a v2 file is not treated as corrupt');
});
// AUTOMETTA-CONTRACT-END
