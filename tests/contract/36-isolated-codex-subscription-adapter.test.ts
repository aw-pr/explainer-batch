// Contract test for stage-cards/36-isolated-codex-subscription-adapter.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/36-isolated-codex-subscription-adapter.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const WORK = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'contract-36-')));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/36-isolated-codex-subscription-adapter.md
globalThis.fetch = (async () => {
  throw new Error('network access is forbidden in contract test 36');
}) as typeof fetch;

const ADAPTER = path.join(REPO_ROOT, 'src', 'providers', 'codex-subscription.ts');
const SNAPSHOT = path.join(REPO_ROOT, 'src', 'source-snapshot.ts');
const BIN = path.join(WORK, 'bin');
const SOURCE_ROOT = path.join(WORK, 'source');
const TMP_ROOT = path.join(WORK, 'tmp');
const CAPTURE = path.join(WORK, 'capture.json');
for (const dir of [BIN, path.join(SOURCE_ROOT, 'input'), TMP_ROOT]) fs.mkdirSync(dir, { recursive: true });
const SCHEMA = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'contract', 'generated', 'model-output.openai.json'), 'utf8'));
const SCHEMA_REF = { id: 'explainer-model-output', version: 2, digest: 'sha256:fixture' };
const SYSTEM = 'SYSTEM PROMPT FOR CONTRACT 36';
const IMAGE = path.join(SOURCE_ROOT, 'input', 'page-12.png');
fs.writeFileSync(IMAGE, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));
const PARENT_ENV = {
  PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: '/home/fixture', LANG: 'en_GB.UTF-8',
  CODEX_HOME: '/home/fixture/.codex-operator', OPENAI_API_KEY: 'sk-must-not-leak', CODEX_API_KEY: 'sk-must-not-leak',
  ANTHROPIC_API_KEY: 'sk-ant-must-not-leak', OPENAI_BASE_URL: 'https://proxy.invalid',
};
const ALLOWED_ENV = new Set(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ', 'CODEX_HOME']);
const CHATGPT_AUTH = {
  OPENAI_API_KEY: null, auth_mode: 'chatgpt', last_refresh: '2026-10-01T00:00:00Z',
  tokens: { id_token: 'fixture-id', access_token: 'fixture-access', refresh_token: 'fixture-refresh', account_id: 'acct_fixture' },
};

function writeJson(file: string, value: unknown): string {
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}
const AUTH_OK = writeJson(path.join(WORK, 'auth-chatgpt.json'), CHATGPT_AUTH);
const AUTH_OK_BYTES = fs.readFileSync(AUTH_OK);
const AUTH_KEY = writeJson(path.join(WORK, 'auth-apikey.json'), { OPENAI_API_KEY: 'sk-fixture-api-key', auth_mode: 'apikey', tokens: null });
fs.writeFileSync(path.join(WORK, 'auth-malformed.json'), '{ not json');

function script(file: string, body: string): string {
  fs.writeFileSync(file, `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
  return file;
}

// pdfinfo and pdftotext stand-ins: the PDF's own bytes choose the behaviour.
script(path.join(BIN, 'pdfinfo'), `
const fs = require('fs');
const body = fs.readFileSync(process.argv[process.argv.length - 1], 'utf8');
if (body.includes('mode=noinfo')) process.exit(1);
process.stdout.write('Producer: fixture\\nPages:          3\\n');`);
script(path.join(BIN, 'pdftotext'), `
const fs = require('fs');
const args = process.argv.slice(2);
const page = Number(args[args.indexOf('-f') + 1]);
const body = fs.readFileSync(args[args.length - 2], 'utf8');
if (body.includes('mode=badpage') && page === 2) process.exit(3);
const words = ['Alpha', 'Beta', 'Gamma'];
process.stdout.write(body.includes('mode=blank') ? '   \\n\\f' : words[page - 1] + ' page ' + page + '.   \\n\\f');`);
process.env.PATH = `${BIN}${path.delimiter}${process.env.PATH ?? ''}`;
delete process.env.PDFTOTEXT_BIN;

function pdf(name: string, mode: string): string {
  fs.writeFileSync(path.join(SOURCE_ROOT, 'input', name), `%PDF-1.4\n% mode=${mode} ${name}\n%%EOF\n`);
  return `input/${name}`;
}

function fakeCodex(name: string, cfg: Record<string, unknown>): string {
  return script(path.join(BIN, name), `
const fs = require('fs');
const cp = require('child_process');
const cfg = ${JSON.stringify({ capture: CAPTURE, events: [], output: '{"title":"ok"}', exit: 0, ...cfg })};
const argv = process.argv.slice(2);
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { stdin += d; });
process.stdin.on('end', () => {
  const home = process.env.CODEX_HOME;
  const schemaFile = argv[argv.indexOf('--output-schema') + 1];
  const outFile = argv[argv.indexOf('--output-last-message') + 1];
  fs.writeFileSync(cfg.capture, JSON.stringify({
    argv, cwd: process.cwd(), env: process.env, stdin, cwdEntries: fs.readdirSync(process.cwd()),
    schema: JSON.parse(fs.readFileSync(schemaFile, 'utf8')), homeEntries: fs.readdirSync(home),
    auth: JSON.parse(fs.readFileSync(home + '/auth.json', 'utf8')), authMode: fs.statSync(home + '/auth.json').mode & 0o777,
  }));
  for (const e of cfg.events) process.stdout.write((typeof e === 'string' ? e : JSON.stringify(e)) + '\\n');
  if (cfg.output !== null) fs.writeFileSync(outFile, cfg.output);
  if (cfg.crash) { process.kill(process.pid, 'SIGKILL'); return; }
  if (cfg.hang) {
    const child = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    fs.writeFileSync(cfg.pids, JSON.stringify([process.pid, child.pid]));
    setInterval(() => {}, 1000);
    return;
  }
  process.exit(cfg.exit);
});`);
}

const STARTED = [{ type: 'thread.started', thread_id: 'th_fixture' }, { type: 'turn.started' }];
const DONE = { type: 'turn.completed', usage: { input_tokens: 5000, cached_input_tokens: 1200, output_tokens: 700 } };
const MESSAGE = { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: '{"title":"ok"}' } };

function contract(): Record<string, any> {
  return require('../../src/llm-contract') as Record<string, any>;
}
function snapshotModule(): Record<string, any> {
  assert.ok(fs.existsSync(SNAPSHOT), 'src/source-snapshot.ts must exist');
  return require('../../src/source-snapshot') as Record<string, any>;
}
function adapterModule(): Record<string, any> {
  assert.ok(fs.existsSync(ADAPTER), 'src/providers/codex-subscription.ts must exist');
  return require('../../src/providers/codex-subscription') as Record<string, any>;
}

function binding(overrides: Record<string, unknown> = {}): any {
  return {
    provider: 'openai', route: 'subscription-cli', surface: 'codex-cli', credentialKind: 'codex-chatgpt-login',
    credential: () => { throw new Error('the Codex adapter must not read a credential string'); }, ...overrides,
  };
}

const PLAN = {
  version: 1, provider: 'openai', route: 'subscription-cli', strategy: 'single-pass',
  tiers: {
    synthesis: { provider: 'openai', route: 'subscription-cli', model: 'gpt-5.6-terra', maxOutputTokens: 8192 },
    repair: { provider: 'openai', route: 'subscription-cli', model: 'gpt-5.6-luna', maxOutputTokens: 4096 },
    vision: { provider: 'openai', route: 'subscription-cli', model: 'gpt-5.6-terra', maxOutputTokens: 8192 },
  },
  schema: SCHEMA_REF, registryDigest: 'r', policyDigest: 'p', maxRepairAttempts: 2, concurrency: 1,
  callTimeoutMs: { synthesis: 600000, repair: 300000, vision: 180000 }, activeWallClockLimitMs: 7200000,
};

const LONG_TEXT = `[Page 1]\n${'The long source paragraph repeats to exceed a megabyte. '.repeat(27000)}`;

function item(id: string, source: Record<string, unknown>): Record<string, unknown> {
  return { itemId: `item-${id}`, customId: `cid_${id}`, attemptId: `cid_${id}.1`,
    instruction: `Write the explainer for item ${id}.`, source, schema: SCHEMA_REF };
}
const TEXT_SOURCE = { digest: 'd', text: LONG_TEXT, images: [{ relativePath: 'input/page-12.png', label: 'Figure 3 page render', sha256: 'x' }] };

function provider(codexBin: string, extra: Record<string, unknown> = {}): any {
  return adapterModule().createCodexSubscriptionProvider({
    binding: binding(), codexBin, authFile: AUTH_OK, parentEnv: PARENT_ENV, tmpRoot: TMP_ROOT, killGraceMs: 200,
    schemaFor: () => SCHEMA, systemPrompt: () => SYSTEM, sourceRoot: SOURCE_ROOT, ...extra,
  });
}

function ctx(deadlineMs = 60000) {
  return { signal: new AbortController().signal, deadline: new Date(Date.now() + deadlineMs).toISOString() };
}

async function run(codexBin: string, extra: Record<string, unknown> = {}, c = ctx()): Promise<any> {
  fs.rmSync(CAPTURE, { force: true });
  const p = provider(codexBin, extra);
  const req = await p.buildRequest('synthesis', item('s', TEXT_SOURCE), PLAN);
  return { req, result: await p.complete(req, c) };
}

function expectValid(result: any, label: string): void {
  assert.deepEqual(contract().checkResult(result), result, `${label}: result must already satisfy checkResult`);
}

async function expectCode(fn: () => unknown, code: string, label: string): Promise<void> {
  let thrown: any;
  try { await fn(); } catch (error) { thrown = error; }
  assert.ok(thrown, `${label}: expected ${code}, nothing was thrown`);
  assert.equal(thrown.code, code, `${label}: expected ${code}, got ${thrown && thrown.code} (${thrown && thrown.message})`);
}

function tmpRootEmpty(label: string): void {
  assert.deepEqual(fs.readdirSync(TMP_ROOT), [], `${label}: every per-call directory is removed`);
}

test('the shared error list names the two source-preparation failures', () => {
  const codes: string[] = [...contract().ERROR_CODES];
  for (const code of ['SOURCE_TEXT_UNAVAILABLE', 'SOURCE_TOO_LARGE']) assert.ok(codes.includes(code), `ERROR_CODES lacks ${code}`);
  assert.equal(new Set(codes).size, codes.length, 'ERROR_CODES has duplicates');
});

test('buildSourceSnapshot extracts every page through page-text with page labels', () => {
  const { buildSourceSnapshot } = snapshotModule();
  const rel = pdf('three.pdf', 'ok');
  const snap = buildSourceSnapshot({ root: SOURCE_ROOT, pdf: rel, images: [{ relativePath: 'input/page-12.png', label: 'Figure 3 page render' }] }, { maxChars: 100000 });
  assert.equal(snap.text, '[Page 1]\nAlpha page 1.\n\n[Page 2]\nBeta page 2.\n\n[Page 3]\nGamma page 3.');
  const bytes = fs.readFileSync(path.join(SOURCE_ROOT, rel));
  assert.deepEqual(snap.pdf, { relativePath: rel, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
  assert.deepEqual(snap.images, [{ relativePath: 'input/page-12.png', label: 'Figure 3 page render',
    sha256: crypto.createHash('sha256').update(fs.readFileSync(IMAGE)).digest('hex') }]);
  assert.match(snap.digest, /^[0-9a-f]{64}$/);
  const again = buildSourceSnapshot({ root: SOURCE_ROOT, pdf: rel, images: [{ relativePath: 'input/page-12.png', label: 'Figure 3 page render' }] }, { maxChars: 100000 });
  assert.equal(again.digest, snap.digest, 'the digest is deterministic');

  const plain = buildSourceSnapshot({ root: SOURCE_ROOT, text: 'Page content from an HTML source.' }, { maxChars: 100000 });
  assert.equal(plain.text, 'Page content from an HTML source.');
  assert.equal(plain.pdf, undefined);
  assert.deepEqual(plain.images, []);
  assert.notEqual(plain.digest, snap.digest);

  const source = fs.readFileSync(SNAPSHOT, 'utf8');
  assert.ok(/['"]\.\/page-text['"]/.test(source), 'source-snapshot reuses src/page-text.ts');
  assert.ok(!/['"]pdftotext['"]/.test(source), 'source-snapshot does not run pdftotext itself');
});

test('buildSourceSnapshot fails preflight instead of clipping or sending a file reference', async () => {
  const { buildSourceSnapshot } = snapshotModule();
  const cases: Array<[string, () => unknown, string]> = [
    ['no page count', () => buildSourceSnapshot({ root: SOURCE_ROOT, pdf: pdf('noinfo.pdf', 'noinfo') }, { maxChars: 1e6 }), 'SOURCE_TEXT_UNAVAILABLE'],
    ['a page fails', () => buildSourceSnapshot({ root: SOURCE_ROOT, pdf: pdf('badpage.pdf', 'badpage') }, { maxChars: 1e6 }), 'SOURCE_TEXT_UNAVAILABLE'],
    ['blank text layer', () => buildSourceSnapshot({ root: SOURCE_ROOT, pdf: pdf('blank.pdf', 'blank') }, { maxChars: 1e6 }), 'SOURCE_TEXT_UNAVAILABLE'],
    ['blank text source', () => buildSourceSnapshot({ root: SOURCE_ROOT, text: '  \n ' }, { maxChars: 1e6 }), 'SOURCE_TEXT_UNAVAILABLE'],
    ['too large', () => buildSourceSnapshot({ root: SOURCE_ROOT, pdf: pdf('big.pdf', 'ok') }, { maxChars: 20 }), 'SOURCE_TOO_LARGE'],
  ];
  for (const [label, fn, code] of cases) await expectCode(fn, code, label);
});

test('the factory and every call require a ChatGPT login, never an API key', async () => {
  await expectCode(() => adapterModule().createCodexSubscriptionProvider({
    binding: binding({ route: 'sync-api', surface: 'openai-api', credentialKind: 'openai-api-key' }), codexBin: 'codex',
    authFile: AUTH_OK, parentEnv: PARENT_ENV, tmpRoot: TMP_ROOT, schemaFor: () => SCHEMA, systemPrompt: () => SYSTEM, sourceRoot: SOURCE_ROOT,
  }), 'CODEX_AUTH_NOT_SUBSCRIPTION', 'an API binding');
  const bin = fakeCodex('codex-auth', { events: [...STARTED, MESSAGE, DONE] });
  for (const [label, authFile] of [['API-key auth', AUTH_KEY], ['malformed auth', path.join(WORK, 'auth-malformed.json')], ['missing auth', path.join(WORK, 'absent.json')]]) {
    fs.rmSync(CAPTURE, { force: true });
    const p = provider(bin, { authFile });
    const req = await p.buildRequest('synthesis', item('w', TEXT_SOURCE), PLAN);
    await expectCode(() => p.complete(req, ctx()), 'CODEX_AUTH_NOT_SUBSCRIPTION', label);
    assert.ok(!fs.existsSync(CAPTURE), `${label}: the CLI is never started`);
    tmpRootEmpty(label);
  }
});

test('identity, capabilities and request shape keep schema evidence unverified', async () => {
  const p = provider('codex');
  assert.equal(p.id, 'openai');
  assert.deepEqual([...p.routes], ['subscription-cli']);
  contract().assertProviderCapabilities(p);
  const cap = p.capabilities.byRoute['subscription-cli'];
  assert.equal(cap.schemaEvidence, 'unverified', 'schema compatibility stays unverified until the live probe card');
  assert.equal(cap.outputTokenLimit, 'advisory');
  assert.equal(cap.pdfNative, false);
  const req = await p.buildRequest('synthesis', item('r', TEXT_SOURCE), PLAN);
  assert.equal(req.route, 'subscription-cli');
  assert.equal(req.model, 'gpt-5.6-terra');
  assert.equal((req.payload as any).sourceDelivery, 'extracted-text');
  await expectCode(() => p.buildRequest('synthesis', item('p', { digest: 'd', text: '', pdf: { relativePath: 'input/three.pdf', sha256: 'x' }, images: [] }), PLAN),
    'SOURCE_TEXT_UNAVAILABLE', 'a source with no extracted text');
  const api = { ...PLAN, tiers: { ...PLAN.tiers, repair: { provider: 'openai', route: 'sync-api', model: 'gpt-5.6-luna', maxOutputTokens: 4096 } } };
  await expectCode(() => p.buildRequest('repair', item('q', TEXT_SOURCE), api), 'ROUTE_UNSUPPORTED', 'an API repair tier');
  const c = ctx();
  await expectCode(() => p.submitBatch([req], c), 'ROUTE_UNSUPPORTED', 'submitBatch');
  await expectCode(() => p.getBatch({ provider: 'openai', remoteId: 'x', submittedAt: 'x', expiresAt: 'x', requests: [] }, c), 'ROUTE_UNSUPPORTED', 'getBatch');
});

test('a successful call runs an isolated codex exec over stdin and returns the last message', async () => {
  const bin = fakeCodex('codex-ok', { events: [...STARTED, 'not json at all', MESSAGE, DONE] });
  const { req, result } = await run(bin);
  const cap = JSON.parse(fs.readFileSync(CAPTURE, 'utf8'));
  const argv: string[] = cap.argv;
  assert.deepEqual(argv.slice(0, 11), ['exec', '--model', 'gpt-5.6-terra', '--json', '--sandbox', 'read-only',
    '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules', '-C']);
  const [work, , schemaFile, , outFile] = argv.slice(11, 16);
  assert.equal(argv[12], '--output-schema');
  assert.equal(argv[14], '--output-last-message');
  assert.deepEqual(argv.slice(16), ['--image', IMAGE, '-'], 'images precede the stdin marker');
  const root = path.dirname(work);
  assert.equal(path.dirname(root), TMP_ROOT, 'one private root per call under tmpRoot');
  assert.equal(path.basename(work), 'work');
  assert.equal(cap.cwd, work, 'the process cwd is the -C directory');
  assert.deepEqual(cap.cwdEntries, [], 'the work directory starts empty');
  assert.equal(path.dirname(schemaFile), path.join(root, 'artifacts'));
  assert.equal(path.dirname(outFile), path.join(root, 'artifacts'));
  assert.notEqual(schemaFile, outFile);
  assert.deepEqual(cap.schema, SCHEMA, 'the schema file holds the injected dialect');

  assert.equal(cap.env.CODEX_HOME, path.join(root, 'auth'), 'an isolated auth home, never the operator\'s');
  for (const key of Object.keys(cap.env)) {
    if (/^(__CF_USER_TEXT_ENCODING|XPC_|PWD$|SHLVL$|_$|OLDPWD$)/.test(key)) continue;
    assert.ok(ALLOWED_ENV.has(key), `child env must not carry ${key}`);
  }
  assert.deepEqual(cap.homeEntries, ['auth.json'], 'the auth home holds the login and nothing else');
  assert.deepEqual(cap.auth, { OPENAI_API_KEY: null, auth_mode: 'chatgpt', last_refresh: CHATGPT_AUTH.last_refresh, tokens: CHATGPT_AUTH.tokens });
  assert.equal(cap.authMode, 0o600);
  assert.ok(fs.readFileSync(AUTH_OK).equals(AUTH_OK_BYTES), 'the operator auth file is byte-for-byte untouched');

  assert.ok(cap.stdin.length > 1000000, 'a long prompt travels over stdin');
  assert.equal(Buffer.byteLength(cap.stdin), req.wireBytes, 'wireBytes is the stdin byte count');
  assert.ok(cap.stdin.startsWith(SYSTEM), 'stdin starts with the system prompt');
  for (const needle of ['Write the explainer for item s.', 'Image 1: Figure 3 page render', LONG_TEXT]) {
    assert.ok(cap.stdin.includes(needle), `stdin includes ${needle.slice(0, 40)}`);
  }
  assert.ok(!argv.some(a => a.includes('The long source paragraph')), 'the prompt is never an argument');

  expectValid(result, 'success');
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.text, '{"title":"ok"}');
  assert.equal(result.provider, 'openai');
  assert.equal(result.route, 'subscription-cli');
  assert.equal(result.customId, 'cid_s');
  assert.equal(result.providerRequestId, 'th_fixture');
  assert.deepEqual(result.usage, { in: 5000, out: 700, cacheRead: 1200, cacheWrite5m: null, cacheWrite1h: null, source: 'reported' });
  tmpRootEmpty('success');
});

test('every failure shape becomes a named result and the private root is removed', async () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['turn failed', { events: [...STARTED, { type: 'turn.failed', error: { message: 'usage limit reached' } }], output: null, exit: 1 }, 'CLI_FAILURE'],
    ['error event', { events: [...STARTED, { type: 'error', message: 'stream disconnected' }], output: null, exit: 1 }, 'CLI_FAILURE'],
    ['unknown terminal event', { events: [...STARTED, MESSAGE, DONE, { type: 'turn.cancelled' }] }, 'CLI_FAILURE'],
    ['non-zero exit', { events: [...STARTED, MESSAGE, DONE], exit: 2 }, 'CLI_EXIT'],
    ['crash', { events: [...STARTED], output: null, crash: true }, 'CLI_EXIT'],
    ['no output file', { events: [...STARTED, MESSAGE, DONE], output: null }, 'MISSING_OUTPUT'],
    ['blank output file', { events: [...STARTED, MESSAGE, DONE], output: '  \n' }, 'MISSING_OUTPUT'],
    ['no completion event', { events: [...STARTED, MESSAGE] }, 'MISSING_OUTPUT'],
  ];
  let n = 0;
  for (const [label, cfg, code] of cases) {
    const { result } = await run(fakeCodex(`codex-case-${n++}`, cfg));
    expectValid(result, label);
    assert.equal(result.finishReason, 'error', label);
    assert.equal(result.error.code, code, label);
    tmpRootEmpty(label);
  }
  const { result: spawnFail } = await run(path.join(BIN, 'no-such-codex'));
  assert.equal(spawnFail.error.code, 'CLI_EXIT', 'a CLI that cannot start');
  tmpRootEmpty('spawn failure');
});

test('a timeout kills the whole process group', async () => {
  const pids = path.join(WORK, 'pids.json');
  const bin = fakeCodex('codex-hang', { events: [...STARTED], hang: true, pids });
  const { result } = await run(bin, {}, ctx(4000));
  expectValid(result, 'timeout');
  assert.equal(result.error.code, 'TIMEOUT');
  const [parent, grandchild] = JSON.parse(fs.readFileSync(pids, 'utf8')) as number[];
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (let i = 0; i < 40 && (alive(parent) || alive(grandchild)); i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(!alive(parent), 'the CLI process is gone');
  assert.ok(!alive(grandchild), 'its child process is gone too');
  tmpRootEmpty('timeout');
});

test('the adapter spawns without a shell and never reads operator config or API keys', () => {
  const source = fs.readFileSync(ADAPTER, 'utf8');
  assert.ok(!/shell\s*:\s*true/.test(source), 'no shell');
  assert.ok(!/\bexecSync\b|\bexecFile(?:Sync)?\b|(?<![.\w])exec\(/.test(source), 'spawn, not exec');
  assert.ok(!/['"]~\/\.codex|os\.homedir\(\)/.test(source), 'the operator Codex home is never derived inside the adapter');
  assert.ok(!/['"]pdftotext['"]/.test(source), 'PDF text comes from source-snapshot, not the adapter');
  assert.ok(!/process\.env/.test(source), 'the adapter reads no ambient environment; the caller passes parentEnv');
});
// AUTOMETTA-CONTRACT-END

test.after(() => {
  fs.rmSync(WORK, { recursive: true, force: true });
});
