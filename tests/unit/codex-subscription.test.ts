import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCodexSubscriptionProvider } from '../../src/providers/codex-subscription';
import { buildSourceSnapshot } from '../../src/source-snapshot';
import { checkResult } from '../../src/llm-contract';
import type { PreparedItem, ProviderRequest, RunPlan } from '../../src/llm-contract';
import type { CredentialBinding } from '../../src/routes';

const binding: CredentialBinding = {
  provider: 'openai', route: 'subscription-cli', surface: 'codex-cli', credentialKind: 'codex-chatgpt-login',
  credential() { throw new Error('A subscription adapter must not request a credential string.'); },
};
const schema = { id: 'fixture', version: 1, digest: 'fixture-digest' };
const tier = { provider: 'openai', route: 'subscription-cli', model: 'fixture-model', maxOutputTokens: 100 } as const;
const plan: RunPlan = {
  version: 1, provider: 'openai', route: 'subscription-cli', strategy: 'single-pass',
  tiers: { synthesis: tier, repair: tier, vision: tier }, schema, registryDigest: 'r', policyDigest: 'p',
  maxRepairAttempts: 1, concurrency: 1, callTimeoutMs: { synthesis: 5000, repair: 5000, vision: 5000 },
  activeWallClockLimitMs: 10000,
};
const item: PreparedItem = {
  itemId: 'i', customId: 'c', attemptId: 'c.1', instruction: 'Explain the paper.', schema,
  source: { digest: 's', text: '[Page 1]\nSource text. '.repeat(50000), images: [
    { relativePath: 'image.png', label: 'First figure', sha256: 'image-digest' },
  ] },
};
const completed = { type: 'turn.completed', usage: { input_tokens: 20, output_tokens: 3, cached_input_tokens: 4 } };

function script(file: string, body: string): void {
  fs.writeFileSync(file, `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
}

function fixture(t: { after(fn: () => void): void }, config: Record<string, unknown> = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'unit-codex-subscription-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tmpRoot = path.join(root, 'calls');
  fs.mkdirSync(tmpRoot);
  const authFile = path.join(root, 'login.json');
  const auth = { auth_mode: 'chatgpt', tokens: { access_token: 'fixture-access' }, ignored: 'operator settings' };
  fs.writeFileSync(authFile, JSON.stringify(auth));
  const capture = path.join(root, 'capture.json');
  const bin = path.join(root, 'fake-codex');
  script(bin, `
const fs = require('node:fs');
const cfg = ${JSON.stringify({ events: [{ type: 'thread.started', thread_id: 'thread-fixture' }, completed], output: '{"ok":true}', ...config })};
const args = process.argv.slice(2);
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', data => { prompt += data; });
process.stdin.on('end', () => {
  const outputFile = args[args.indexOf('--output-last-message') + 1];
  fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ args, prompt, cwd: process.cwd(), env: process.env,
    auth: JSON.parse(fs.readFileSync(process.env.CODEX_HOME + '/auth.json', 'utf8')) }));
  if (cfg.hang) {
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
  }
  if (cfg.descendant) {
    const child = require('node:child_process').spawn(process.execPath, ['-e',
      "process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 1000);"],
      { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    child.once('message', () => fs.writeFileSync(${JSON.stringify(capture + '.pids')}, JSON.stringify([process.pid, child.pid])));
  }
  for (const event of cfg.events) process.stdout.write(JSON.stringify(event) + '\\n');
  if (cfg.oversized) process.stdout.write('x'.repeat(8 * 1024 * 1024 + 1) + '\\n');
  if (cfg.output !== null) fs.writeFileSync(outputFile, cfg.output);
  if (!cfg.hang) process.exitCode = cfg.exit ?? 0;
});`);
  const provider = createCodexSubscriptionProvider({
    binding, authFile, tmpRoot, codexBin: bin, killGraceMs: 50, sourceRoot: root,
    parentEnv: { PATH: process.env.PATH, OPENAI_API_KEY: 'fixture-forbidden', CODEX_HOME: 'fixture-forbidden' },
    schemaFor: () => ({ type: 'object' }), systemPrompt: () => 'System instructions.',
  });
  const context = (signal = new AbortController().signal) => ({ signal, deadline: new Date(Date.now() + 10000).toISOString() });
  const request = () => provider.buildRequest('synthesis', item, plan) as Promise<ProviderRequest & { route: 'subscription-cli' }>;
  return { root, tmpRoot, authFile, capture, provider, request, context };
}

test('Codex uses stdin, labelled images and an isolated login, and sums reported usage', async t => {
  const f = fixture(t, { events: [{ type: 'thread.started', thread_id: 'thread-fixture' }, completed, completed] });
  const originalAuth = fs.readFileSync(f.authFile);
  const req = await f.request();
  const result = await f.provider.complete(req, f.context());
  assert.deepEqual(checkResult(result), result);
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.text, '{"ok":true}');
  assert.equal(result.providerRequestId, 'thread-fixture');
  assert.deepEqual(result.usage, { in: 40, out: 6, cacheRead: 8, cacheWrite5m: null, cacheWrite1h: null, source: 'reported' });
  const capture = JSON.parse(fs.readFileSync(f.capture, 'utf8'));
  assert.equal(capture.prompt, `System instructions.\n\nExplain the paper.\n\nAttached images, in order:\nImage 1: First figure\n\nSource text:\n${item.source.text}`);
  assert.ok(Buffer.byteLength(capture.prompt) > 1000000);
  assert.equal(req.wireBytes, Buffer.byteLength(capture.prompt));
  assert.deepEqual(capture.args.slice(-3), ['--image', path.join(f.root, 'image.png'), '-']);
  assert.equal(capture.args.includes(capture.prompt), false);
  assert.equal(capture.env.OPENAI_API_KEY, undefined);
  assert.equal(capture.env.CODEX_HOME, path.join(path.dirname(capture.cwd), 'auth'));
  assert.deepEqual(capture.auth, { OPENAI_API_KEY: null, auth_mode: 'chatgpt', tokens: { access_token: 'fixture-access' } });
  assert.deepEqual(fs.readFileSync(f.authFile), originalAuth);
  assert.deepEqual(fs.readdirSync(f.tmpRoot), []);
});

test('turn.failed takes precedence over a non-zero CLI exit', async t => {
  const f = fixture(t, { events: [{ type: 'turn.failed' }], output: null, exit: 1 });
  const result = await f.provider.complete(await f.request(), f.context());
  assert.equal(result.finishReason, 'error');
  assert.equal(result.error?.code, 'CLI_FAILURE');
  assert.deepEqual(fs.readdirSync(f.tmpRoot), []);
});

test('a missing last-message file is MISSING_OUTPUT', async t => {
  const f = fixture(t, { output: null });
  const result = await f.provider.complete(await f.request(), f.context());
  assert.equal(result.error?.code, 'MISSING_OUTPUT');
  assert.deepEqual(fs.readdirSync(f.tmpRoot), []);
});

test('an API-key login is refused before creating a private root or starting the CLI', async t => {
  const f = fixture(t);
  fs.writeFileSync(f.authFile, JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'fixture' }, OPENAI_API_KEY: 'fixture-key' }));
  await assert.rejects(f.provider.complete(await f.request(), f.context()), { code: 'CODEX_AUTH_NOT_SUBSCRIPTION' });
  assert.equal(fs.existsSync(f.capture), false);
  assert.deepEqual(fs.readdirSync(f.tmpRoot), []);
});

test('caller abort overrides a failure event and escalates past an ignored SIGTERM', async t => {
  const f = fixture(t, { hang: true, events: [{ type: 'turn.failed' }] });
  const controller = new AbortController();
  const running = f.provider.complete(await f.request(), f.context(controller.signal));
  const readyBy = Date.now() + 5000;
  while (!fs.existsSync(f.capture) && Date.now() < readyBy) await new Promise(r => setTimeout(r, 10));
  controller.abort();
  const result = await running;
  assert.ok(fs.existsSync(f.capture), 'the fake CLI was running before cancellation');
  assert.equal(result.error?.code, 'CANCELLED');
  assert.deepEqual(fs.readdirSync(f.tmpRoot), []);
});

test('an oversized stdout line fails closed and cleanup still runs', async t => {
  const f = fixture(t, { oversized: true });
  const result = await f.provider.complete(await f.request(), f.context());
  assert.equal(result.error?.code, 'CLI_FAILURE');
  assert.deepEqual(fs.readdirSync(f.tmpRoot), []);
});

test('cancellation kills a resistant descendant even after its parent closes', async t => {
  const f = fixture(t, { descendant: true, events: [] });
  const controller = new AbortController();
  const running = f.provider.complete(await f.request(), f.context(controller.signal));
  const pidFile = f.capture + '.pids';
  const readyBy = Date.now() + 5000;
  while (!fs.existsSync(pidFile) && Date.now() < readyBy) await new Promise(r => setTimeout(r, 10));
  controller.abort();
  const result = await running;
  assert.equal(result.error?.code, 'CANCELLED');
  assert.ok(fs.existsSync(pidFile), 'the descendant installed its signal handler');
  const pids: number[] = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  t.after(() => {
    for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  });
  const goneBy = Date.now() + 2000;
  while (pids.some(alive) && Date.now() < goneBy) await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(pids.filter(alive), []);
  assert.deepEqual(fs.readdirSync(f.tmpRoot), []);
});

test('local schema-write failures throw after removing the private root', async t => {
  const f = fixture(t);
  const req = await f.request();
  (req.payload as { schema: unknown }).schema = 1n;
  await assert.rejects(f.provider.complete(req, f.context()), TypeError);
  assert.equal(fs.existsSync(f.capture), false);
  assert.deepEqual(fs.readdirSync(f.tmpRoot), []);
});

test('source snapshots reuse page extraction, preserve all pages and reject clipping', t => {
  const f = fixture(t);
  const bin = path.join(f.root, 'bin');
  fs.mkdirSync(bin);
  script(path.join(bin, 'pdfinfo'), "process.stdout.write('Pages: 2\\n');");
  script(path.join(bin, 'pdftotext'), `
const args = process.argv.slice(2);
process.stdout.write('Content for page ' + args[args.indexOf('-f') + 1] + '.  \\n\\f');`);
  const oldPath = process.env.PATH;
  const oldExtractor = process.env.PDFTOTEXT_BIN;
  t.after(() => {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    if (oldExtractor === undefined) delete process.env.PDFTOTEXT_BIN;
    else process.env.PDFTOTEXT_BIN = oldExtractor;
  });
  process.env.PATH = `${bin}${path.delimiter}${oldPath ?? ''}`;
  delete process.env.PDFTOTEXT_BIN;
  fs.writeFileSync(path.join(f.root, 'paper.pdf'), '%PDF-unit-snapshot');
  fs.writeFileSync(path.join(f.root, 'image.png'), 'image bytes');
  const input = { root: f.root, pdf: 'paper.pdf', images: [{ relativePath: 'image.png', label: 'Figure 1' }] };
  const snapshot = buildSourceSnapshot(input, { maxChars: 1000 });
  assert.equal(snapshot.text, '[Page 1]\nContent for page 1.\n\n[Page 2]\nContent for page 2.');
  assert.match(snapshot.pdf!.sha256, /^[0-9a-f]{64}$/);
  assert.match(snapshot.images[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(buildSourceSnapshot(input, { maxChars: 1000 }).digest, snapshot.digest);
  assert.throws(() => buildSourceSnapshot(input, { maxChars: 10 }), { code: 'SOURCE_TOO_LARGE' });
  const plain = buildSourceSnapshot({ root: f.root, text: '  Verbatim text.\n' }, { maxChars: 1000 });
  assert.equal(plain.text, '  Verbatim text.\n');
  assert.equal(plain.pdf, undefined);
  assert.deepEqual(plain.images, []);
});
