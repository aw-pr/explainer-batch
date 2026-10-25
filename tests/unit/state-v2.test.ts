import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  emptyStateV2, listReceipts, loadStateV2, recordReceipt, transactState, withBatchLock,
  type Receipt, type StateV2,
} from '../../src/state-v2';
import { migrateStateV1 } from '../../src/state-migration';

const REPO_ROOT = path.join(__dirname, '..', '..');
const SRC_V2 = path.join(REPO_ROOT, 'src', 'state-v2.ts');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eb-state-v2-')));
const LEGACY_FILE = path.join(TMP, 'legacy-state.json');
process.env.EXPLAINER_STATE_FILE = LEGACY_FILE;
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let counter = 0;
function stateFile(): string {
  counter += 1;
  const dir = path.join(TMP, `case-${counter}`);
  fs.mkdirSync(dir);
  return path.join(dir, 'state.json');
}

function receipt(i: number, extra: Partial<Receipt> = {}): Receipt {
  return {
    runId: 'run-u', batchId: 'local_u', itemId: `item-${i}`, customId: `k_${i}`,
    attemptId: `k_${i}.1`, stage: 'synthesis', digest: `sha256:${i}`, ...extra,
  };
}

function codeOf(fn: () => unknown): string | undefined {
  try { fn(); } catch (error) { return (error as { code?: string }).code; }
  return undefined;
}

function runChild(body: string): Promise<number> {
  const script = `require('ts-node/register'); const fs = require('fs'); const s = require(${JSON.stringify(SRC_V2)}); ${body}`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], {
      cwd: REPO_ROOT, env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' }, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    child.on('error', reject);
    child.on('exit', code => { if (code !== 0 && code !== 3) reject(new Error(`child exited ${code}: ${err}`)); else resolve(code as number); });
  });
}

async function waitFor(file: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${file}`);
    await new Promise(r => setTimeout(r, 20));
  }
}

test('a crash after the temp file is written but before the rename leaves the old state, and the temp file is ignored', async () => {
  const file = stateFile();
  transactState(file, s => { recordReceipt(s, receipt(1)); });
  const before = fs.readFileSync(file, 'utf8');
  const code = await runChild(`
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => { if (to === ${JSON.stringify(file)}) process.exit(3); return rename(from, to); };
    s.transactState(${JSON.stringify(file)}, st => { s.recordReceipt(st, { runId: 'run-u', batchId: 'local_u', itemId: 'lost', customId: 'k_lost', attemptId: 'k_lost.1', stage: 'synthesis', digest: 'sha256:lost' }); });
  `);
  assert.equal(code, 3);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'the old state is intact');
  const temps = fs.readdirSync(path.dirname(file)).filter(n => n.startsWith('state.json.tmp-'));
  assert.equal(temps.length, 1, 'the uniquely named temp file was written');
  assert.match(fs.readFileSync(path.join(path.dirname(file), temps[0]), 'utf8'), /k_lost/);
  assert.equal(loadStateV2(file).revision, 1);

  const after = transactState(file, s => { recordReceipt(s, receipt(2)); }, { lockWaitMs: 5000 });
  assert.equal(after.revision, 2, 'the dead writer\'s lock was reclaimed');
  assert.deepEqual(listReceipts(loadStateV2(file)).map(r => r.customId).sort(), ['k_1', 'k_2'], 'the temp file never landed');
});

test('a throwing or asynchronous transaction writes nothing', () => {
  const file = stateFile();
  transactState(file, s => { recordReceipt(s, receipt(1)); });
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => transactState(file, s => { recordReceipt(s, receipt(2)); throw new Error('boom'); }), /boom/);
  assert.throws(() => transactState(file, (async () => {}) as unknown as (s: StateV2) => void), /synchronous/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['state.json'], 'the lock is released after a failure');
});

test('a transaction that would produce an invalid state is refused before writing', () => {
  const file = stateFile();
  transactState(file, () => {});
  const before = fs.readFileSync(file, 'utf8');
  assert.equal(codeOf(() => transactState(file, s => {
    (s.batches as Record<string, unknown>).x = { id: 'x', provider: 'openai', route: null, kind: 'local', status: 'processing', requests: {} };
  })), 'STATE_CORRUPT');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('corrupt state shapes are refused and left untouched', () => {
  const good = emptyStateV2();
  const variants: Array<[string, unknown]> = [
    ['array', []],
    ['batch without a route', { ...good, batches: { a: { id: 'a', provider: 'openai', kind: 'remote', status: 'ended', requests: {} } } }],
    ['batch keyed under another id', { ...good, batches: { a: { id: 'b', provider: 'openai', route: 'batch-api', kind: 'remote', status: 'ended', requests: {} } } }],
    ['item with an unknown state', { ...good, batches: { a: { id: 'a', provider: 'openai', route: 'batch-api', kind: 'remote', status: 'ended', requests: { r: { state: 'done' } } } } }],
    ['receipt under the wrong key', { ...good, receipts: { wrong: receipt(1) } }],
    ['file cache for an unknown provider', { ...good, file_cache: { mistral: {} } }],
    ['missing receipts', { version: 2, revision: 0, batches: {}, plans: {}, file_cache: {} }],
  ];
  for (const [label, value] of variants) {
    const file = stateFile();
    const bytes = JSON.stringify(value);
    fs.writeFileSync(file, bytes);
    assert.equal(codeOf(() => loadStateV2(file)), 'STATE_CORRUPT', label);
    assert.equal(codeOf(() => transactState(file, () => {})), 'STATE_CORRUPT', label);
    assert.equal(fs.readFileSync(file, 'utf8'), bytes, `${label}: untouched`);
  }
});

test('locks with a live other-user owner or an unreadable owner are never reclaimed', () => {
  const file = stateFile();
  transactState(file, () => {});
  const lockDir = `${file}.lock`;
  // pid 1 belongs to root, so a signal probe from this user fails with EPERM: alive.
  fs.mkdirSync(lockDir);
  fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ nonce: 'n', hostname: os.hostname(), pid: 1, startedAt: 'x' }));
  assert.equal(codeOf(() => transactState(file, () => {}, { lockWaitMs: 150 })), 'STATE_BUSY');
  assert.ok(fs.existsSync(path.join(lockDir, 'owner.json')));
  fs.writeFileSync(path.join(lockDir, 'owner.json'), '{"pid": ');
  assert.equal(codeOf(() => transactState(file, () => {}, { lockWaitMs: 150 })), 'STATE_BUSY', 'an unreadable owner is uncertain');
  assert.ok(fs.existsSync(path.join(lockDir, 'owner.json')));
  fs.rmSync(path.join(lockDir, 'owner.json'));
  assert.equal(codeOf(() => transactState(file, () => {}, { lockWaitMs: 150 })), 'STATE_BUSY', 'an empty lock directory is uncertain');
  assert.ok(fs.existsSync(lockDir));
  fs.rmSync(lockDir, { recursive: true });
  assert.equal(loadStateV2(file).revision, 1);
});

test('a same-process re-acquire is not re-entrant', () => {
  const file = stateFile();
  transactState(file, () => {
    assert.equal(codeOf(() => transactState(file, () => {}, { lockWaitMs: 100 })), 'STATE_BUSY');
  });
  assert.equal(loadStateV2(file).revision, 1);
});

test('concurrent processes interleave transactions without losing updates, and a batch lock excludes across processes', async () => {
  const file = stateFile();
  const ready = path.join(path.dirname(file), 'ready');
  const holder = runChild(`
    s.withBatchLock(${JSON.stringify(file)}, 'batch/X', async () => {
      fs.writeFileSync(${JSON.stringify(ready)}, '');
      await new Promise(r => setTimeout(r, 1500));
    }).then(() => fs.rmSync(${JSON.stringify(ready)}));
  `);
  const writers = Array.from({ length: 3 }, (_, w) => runChild(`
    for (let i = 0; i < 15; i += 1) {
      s.transactState(${JSON.stringify(file)}, st => {
        s.recordReceipt(st, { runId: 'run-p', batchId: 'b', itemId: 'w${w}-' + i, customId: 'k${w}_' + i, attemptId: 'k${w}_' + i + '.1', stage: 'repair', digest: 'd${w}-' + i });
      }, { lockWaitMs: 60000 });
    }
  `));
  await waitFor(ready, 20000);
  let busy: unknown;
  try { await withBatchLock(file, 'batch/X', async () => {}, { lockWaitMs: 100 }); } catch (error) { busy = error; }
  assert.equal((busy as { code?: string })?.code, 'STATE_BUSY', 'another process holds batch/X');
  await Promise.all([holder, ...writers]);
  await withBatchLock(file, 'batch/X', async () => {}, { lockWaitMs: 1000 });
  const state = loadStateV2(file);
  assert.equal(listReceipts(state).length, 45);
  assert.equal(state.revision, 45);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['state.json'], 'no lock, temp or staging directory is left');
});

const LANE_REQUEST = { type: 'lane' as const, lane: 'methods', input: 'x.pdf', output: null, result: 'pending' as const, error: null };
const PENDING = { type: 'explainer' as const, input: 'p.pdf', output: null, result: 'pending' as const, error: null };
const DONE = { type: 'explainer' as const, input: 'd.pdf', output: 'output/d.json', result: 'succeeded' as const, error: null };

function v1Batch(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, model: 'm', submitted_at: '2026-09-01T00:00:00Z', status: 'processing', requests: { p: { ...DONE } }, ...extra };
}

test('ambiguous or conflicting legacy route history is quarantined with every v1 field kept', () => {
  const v1 = {
    batches: [
      v1Batch('batch_lane_model_only', { provider: 'openai', lane_model: 'gpt-5.6-luna' }),
      v1Batch('batch_lane_request_only', { provider: 'openai', requests: { 'p::lane::methods': { ...LANE_REQUEST } } }),
      v1Batch('msgbatch_lane_request', { provider: 'claude', requests: { q: { ...LANE_REQUEST } } }),
      v1Batch('sync_claude_1', { provider: 'openai' }),
      v1Batch('codexbatch_2', { provider: 'claude' }),
      v1Batch('codexbatch_3', { requests: { p: { ...PENDING } } }),
      v1Batch('sync_openai_4'),
      v1Batch('sync_gemini_5', { provider: 'openai' }),
      v1Batch('batch_no_provider'),
      v1Batch('batch_odd_provider', { provider: 'mistral' }),
      v1Batch('remote_claude_without_prefix', { provider: 'claude' }),
      v1Batch('codexbatch_6', { provider: 'openai', requests: { p: { ...PENDING }, d: { ...DONE } } }),
      v1Batch('msgbatch_dup', { provider: 'claude' }),
      v1Batch('msgbatch_dup', { provider: 'claude', status: 'ended' }),
    ],
  };
  const frozen = JSON.parse(JSON.stringify(v1));
  const { state, report } = migrateStateV1(v1);
  assert.deepEqual(v1, frozen, 'the input is not mutated');
  assert.equal(report.batches.length, v1.batches.length);
  const archived = state.legacy?.batches ?? {};
  const expected: Record<string, string> = {
    batch_lane_model_only: 'lane_history',
    batch_lane_request_only: 'lane_history',
    msgbatch_lane_request: 'lane_history',
    sync_claude_1: 'conflicting_evidence',
    codexbatch_2: 'conflicting_evidence',
    sync_openai_4: 'needs_route_evidence',
    sync_gemini_5: 'needs_route_evidence',
    batch_no_provider: 'needs_route_evidence',
    batch_odd_provider: 'conflicting_evidence',
    'msgbatch_dup#13': 'duplicate_id',
  };
  for (const [key, status] of Object.entries(expected)) {
    assert.equal(state.batches[key], undefined, `${key} is not executable`);
    assert.equal(archived[key]?.migration_status, status, `${key} is archived as ${status}`);
    const original = v1.batches.find((b, i) => (key.includes('#') ? `${b.id}#${i}` : b.id) === key)!;
    const { route: _route, migration_status: _status, archive_reason: _reason, ...kept } = archived[key];
    assert.deepEqual(kept, original, `${key} keeps every v1 field`);
  }
  assert.equal(archived.batch_lane_model_only.route, 'batch-api', 'a known route is still recorded on lane history');
  assert.equal(archived.sync_openai_4.route, null);

  assert.equal(state.batches.remote_claude_without_prefix.provider, 'claude');
  assert.equal(state.batches.remote_claude_without_prefix.kind, 'remote');
  assert.equal(state.batches.remote_claude_without_prefix.route, 'batch-api');
  assert.equal(state.batches.msgbatch_dup.status, 'processing', 'the first record keeps the executable slot');

  assert.equal(archived.codexbatch_3, undefined, 'a codexbatch_ id with no provider is not archived');
  const unset = state.batches.codexbatch_3;
  assert.equal(unset.kind, 'local');
  assert.equal(unset.provider, 'openai');
  assert.equal(unset.route, 'subscription-cli');
  assert.equal(unset.requests.p.state, 'outcome_unknown');
  assert.equal(unset.requests.p.needs_source_recovery, true);

  const codex = state.batches.codexbatch_6;
  assert.equal(codex.route, 'subscription-cli');
  assert.equal(codex.requests.p.state, 'outcome_unknown');
  assert.equal(codex.requests.p.needs_source_recovery, true);
  assert.equal(codex.requests.d.state, 'succeeded');
  assert.equal(codex.requests.d.needs_source_recovery, undefined);

  for (const batch of Object.values(state.batches)) {
    assert.ok(['batch-api', 'sync-api', 'subscription-cli'].includes(batch.route));
  }
  const file = stateFile();
  fs.writeFileSync(file, JSON.stringify(state));
  assert.doesNotThrow(() => loadStateV2(file), 'the converted state validates');
});

test('remote pending items stay in flight; local Claude pending items become outcome_unknown', () => {
  const { state } = migrateStateV1({
    batches: [
      v1Batch('msgbatch_r', { requests: { p: { ...PENDING }, e: { ...DONE, result: 'errored', error: 'x' } } }),
      v1Batch('sync_claude_7', { requests: { p: { ...PENDING } } }),
    ],
  });
  assert.equal(state.batches.msgbatch_r.requests.p.state, 'running');
  assert.equal(state.batches.msgbatch_r.requests.e.state, 'errored');
  assert.equal(state.batches.msgbatch_r.legacy_inference, undefined);
  assert.equal(state.batches.sync_claude_7.requests.p.state, 'outcome_unknown');
  assert.equal(state.batches.sync_claude_7.requests.p.needs_source_recovery, undefined);
  assert.ok(state.batches.sync_claude_7.legacy_inference);
  assert.equal(state.legacy, undefined, 'nothing to archive');
});

test('migration refuses a versioned or malformed input', () => {
  assert.equal(codeOf(() => migrateStateV1({ version: 2, revision: 0 })), 'STATE_VERSION_UNSUPPORTED');
  assert.equal(codeOf(() => migrateStateV1({ batches: {} })), 'STATE_CORRUPT');
  assert.equal(codeOf(() => migrateStateV1({ batches: [{ id: 'x' }] })), 'STATE_CORRUPT');
});

function runScript(args: string[]): void {
  execFileSync(process.execPath, ['--require', 'ts-node/register', path.join(REPO_ROOT, 'scripts', 'migrate-state-v2.ts'), ...args], {
    cwd: REPO_ROOT, env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('the migration script refuses an already-migrated or absent state and leaves it untouched', () => {
  const file = stateFile();
  const v2Bytes = JSON.stringify({ ...emptyStateV2(), revision: 7 });
  fs.writeFileSync(file, v2Bytes);
  assert.throws(() => runScript(['--state', file]));
  assert.throws(() => runScript(['--state', file, '--apply']));
  assert.equal(fs.readFileSync(file, 'utf8'), v2Bytes);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['state.json']);
  const absent = path.join(path.dirname(stateFile()), 'state.json');
  assert.throws(() => runScript(['--state', absent, '--apply']));
  assert.ok(!fs.existsSync(absent));
});

test('the legacy reader refuses any versioned file, including a future one', () => {
  const legacy = require('../../src/state') as typeof import('../../src/state');
  fs.writeFileSync(LEGACY_FILE, JSON.stringify({ version: 3 }));
  assert.equal(codeOf(() => legacy.readState()), 'STATE_VERSION_UNSUPPORTED');
  assert.equal(codeOf(() => legacy.mergeBatch({ id: 'b', model: 'm', submitted_at: 'x', status: 'ended', requests: {} })), 'STATE_VERSION_UNSUPPORTED');
  assert.equal(fs.readFileSync(LEGACY_FILE, 'utf8'), JSON.stringify({ version: 3 }));
});
