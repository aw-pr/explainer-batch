// Contract test for stage-cards/23-registry-and-public-snapshot.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/23-registry-and-public-snapshot.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-23-'));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/23-registry-and-public-snapshot.md
globalThis.fetch = (async () => {
  throw new Error('network access is forbidden in contract test 23');
}) as typeof fetch;

const REGISTRY_ENV = [
  'EXPLAINER_MODEL_REGISTRY', 'MCP_MODEL_REGISTRY', 'MODEL', 'MODEL_BATCH', 'MODEL_LANE', 'MODEL_SYNTHESIS',
  'MODEL_REPAIR', 'FIGURE_VLM_MODEL', 'MAX_TOKENS', 'SYNTHESIS_MAX_TOKENS', 'REPAIR_MAX_TOKENS', 'LANE_MAX_TOKENS',
  'MODEL_CLAUDE_SYNTHESIS', 'MODEL_CLAUDE_REPAIR', 'MODEL_CLAUDE_VISION',
  'MODEL_OPENAI_SYNTHESIS', 'MODEL_OPENAI_REPAIR', 'MODEL_OPENAI_VISION',
];
for (const key of REGISTRY_ENV) delete process.env[key];

const NOW = new Date('2026-10-21T12:00:00Z');
const SNAPSHOT = path.join(REPO_ROOT, 'config', 'models.snapshot.json');

// A fleet registry in the shape of mcp-hub's config/models.json.
const FLEET = {
  _comment: 'contract fixture',
  _updated: '2026-10-20',
  claude: { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-4-6', haiku: 'claude-haiku-4-5-20251001', fable: 'claude-fable-5-1' },
  openai: { synthesis: 'gpt-6-astra', batch: 'gpt-5.6-terra', lane: 'gpt-5.6-terra', mini: 'gpt-5.6-luna' },
  gemini: { pro: 'gemini-2.5-pro', flash: 'gemini-2.5-flash', flash_lite: 'gemini-2.5-flash-lite' },
  pricing: {
    _comment: 'USD per 1M tokens',
    'claude-sonnet-4-6': { inPer1M: 3.0, outPer1M: 15.0, cachedInPer1M: 0.3, verified: true },
    'claude-sonnet-5-5': { inPer1M: 2.0, outPer1M: 10.0, cachedInPer1M: 0.2, verified: true },
    'claude-opus-4-8': { inPer1M: 5.0, outPer1M: 25.0, cachedInPer1M: 0.5, verified: true },
    'claude-opus-5-5': { inPer1M: 4.0, outPer1M: 20.0, cachedInPer1M: 0.2, verified: true },
    'claude-haiku-4-5-20251001': { inPer1M: 1.0, outPer1M: 5.0, verified: true },
    'claude-fable-5-1': { inPer1M: 10.0, outPer1M: 50.0, verified: true },
    'gpt-6-astra': { inPer1M: 10.0, outPer1M: 50.0, cachedInPer1M: 1.0, verified: true },
    'gpt-5.6-terra': { inPer1M: 2.0, outPer1M: 12.0, verified: true },
    'gpt-5.6-luna': { inPer1M: 0.2, outPer1M: 1.2, verified: true },
    'gpt-5.6-sol': { inPer1M: 5.0, outPer1M: 30.0, introInPer1M: 4.0, introOutPer1M: 20.0, introUntil: '2026-01-01', verified: true },
    'gemini-2.5-pro': { inPer1M: 1.25, outPer1M: 10.0, verified: true },
    'gemini-2.5-flash': { inPer1M: 0.3, outPer1M: 2.5, verified: true },
    'gemini-2.5-flash-lite': { inPer1M: 0.1, outPer1M: 0.4, verified: false },
  },
};

function load(): Record<string, any> {
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'src', 'model-registry.ts')), 'src/model-registry.ts must exist');
  return require('../../src/model-registry') as Record<string, any>;
}

let counter = 0;
function cloneRoot(opts: { snapshot?: boolean; local?: unknown } = {}): string {
  counter += 1;
  const root = path.join(TMP, `clone-${counter}`);
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  if (opts.snapshot !== false) fs.copyFileSync(SNAPSHOT, path.join(root, 'config', 'models.snapshot.json'));
  if (opts.local !== undefined) {
    fs.writeFileSync(path.join(root, 'config', 'models.json'), typeof opts.local === 'string' ? opts.local : JSON.stringify(opts.local));
  }
  return root;
}

function writeFile(name: string, content: unknown): string {
  const file = path.join(TMP, name);
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  return file;
}

function expectCode(fn: () => unknown, code: string, label: string): void {
  let thrown: any;
  try { fn(); } catch (error) { thrown = error; }
  assert.ok(thrown, `${label}: expected an error with code ${code}, nothing was thrown`);
  assert.equal(thrown.code, code, `${label}: expected ${code}, got ${thrown && thrown.code} (${thrown && thrown.message})`);
}

function model(reg: unknown, provider: string, stage: string, env: Record<string, string> = {}): string {
  const out = load().resolveStageModel(reg, provider, stage, { env });
  assert.equal(typeof out.model, 'string');
  return out.model;
}

test('the committed snapshot is public-safe and records where it came from', () => {
  assert.ok(fs.existsSync(SNAPSHOT), 'config/models.snapshot.json must be committed');
  const text = fs.readFileSync(SNAPSHOT, 'utf8');
  const json = JSON.parse(text);
  assert.ok(json && typeof json === 'object');
  for (const banned of ['/Users/', '/home/', 'op://', 'sk-ant', 'sk-proj', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']) {
    assert.ok(!text.includes(banned), `snapshot must not contain ${banned}`);
  }
  assert.match(text, /[0-9a-f]{64}/, 'snapshot must carry the fleet source digest (a sha256 hex)');
  assert.match(text, /2026-\d\d-\d\d/, 'snapshot must carry its capture date');
});

test('a public clone resolves every default tier from the snapshot alone, with ownership and prices', () => {
  const { loadModelRegistry, modelProvider, priceFor } = load();
  const reg = loadModelRegistry({ env: {}, repoRoot: cloneRoot() });
  const expected: Array<[string, string, string]> = [
    ['claude', 'synthesis', 'claude-opus-4-8'],
    ['claude', 'repair', 'claude-sonnet-5-5'],
    ['claude', 'vision', 'claude-sonnet-5-5'],
    ['openai', 'synthesis', 'gpt-5.6-terra'],
    ['openai', 'repair', 'gpt-6-luna'],
    ['openai', 'vision', 'gpt-6.1-sol'],
  ];
  for (const [provider, stage, id] of expected) {
    assert.equal(model(reg, provider, stage), id, `${provider} ${stage}`);
    assert.equal(modelProvider(reg, id), provider, `${id} is owned by ${provider}`);
    const price = priceFor(reg, id, NOW);
    assert.equal(price.status, 'priced', `${id} must have a complete ordinary price`);
    assert.ok(price.inputPer1M > 0 && price.outputPer1M > 0, `${id} prices must be positive`);
  }
  assert.equal(modelProvider(reg, 'gemini-2.5-flash'), 'gemini', 'gemini ids are not classed as OpenAI');
  assert.equal(typeof reg.digest, 'string');
  assert.ok(reg.digest.length >= 16);
});

test('a missing snapshot with no registry configured fails REGISTRY_UNAVAILABLE instead of inventing defaults', () => {
  const { loadModelRegistry } = load();
  expectCode(() => loadModelRegistry({ env: {}, repoRoot: cloneRoot({ snapshot: false }) }), 'REGISTRY_UNAVAILABLE', 'no snapshot');
});

test('precedence: provider env override, then local tiers, then the fleet registry, then the snapshot', () => {
  const { loadModelRegistry } = load();
  const fleet = writeFile('fleet.json', FLEET);
  const fleetOnly = loadModelRegistry({ env: { MCP_MODEL_REGISTRY: fleet }, repoRoot: cloneRoot() });
  assert.equal(model(fleetOnly, 'claude', 'repair'), 'claude-sonnet-4-6', 'fleet alias beats the snapshot');
  assert.equal(model(fleetOnly, 'openai', 'repair'), 'gpt-5.6-luna');
  assert.equal(model(fleetOnly, 'openai', 'vision'), 'gpt-5.6-terra');
  assert.equal(model(fleetOnly, 'claude', 'synthesis'), 'claude-opus-4-8', 'synthesis stays on the compatibility profile');
  assert.equal(model(fleetOnly, 'openai', 'synthesis'), 'gpt-5.6-terra', 'no automatic promotion to openai.synthesis');

  const localRoot = cloneRoot({ local: { tiers: { claude: { repair: 'claude-haiku-4-5-20251001' } } } });
  const local = loadModelRegistry({ env: { MCP_MODEL_REGISTRY: fleet }, repoRoot: localRoot });
  assert.equal(model(local, 'claude', 'repair'), 'claude-haiku-4-5-20251001', 'local tier beats the fleet');
  assert.equal(model(local, 'claude', 'repair', { MODEL_CLAUDE_REPAIR: 'claude-opus-5-5' }), 'claude-opus-5-5', 'provider env beats local');
  assert.equal(model(local, 'claude', 'vision'), 'claude-sonnet-4-6', 'an override for one stage leaves the others alone');
  assert.notEqual(local.digest, fleetOnly.digest, 'the digest reflects the merged inputs');
  assert.equal(loadModelRegistry({ env: { MCP_MODEL_REGISTRY: fleet }, repoRoot: localRoot }).digest, local.digest, 'the digest is deterministic');

  const explicit = writeFile('explicit.json', { ...FLEET, claude: { ...FLEET.claude, sonnet: 'claude-sonnet-5-5' } });
  const both = loadModelRegistry({ env: { MCP_MODEL_REGISTRY: fleet, EXPLAINER_MODEL_REGISTRY: explicit }, repoRoot: cloneRoot() });
  assert.equal(model(both, 'claude', 'repair'), 'claude-sonnet-5-5', 'EXPLAINER_MODEL_REGISTRY beats the fleet');
});

test('bad registry files and bad overrides are named errors, never silently ignored', () => {
  const { loadModelRegistry } = load();
  const missing = path.join(TMP, 'does-not-exist.json');
  expectCode(() => loadModelRegistry({ env: { EXPLAINER_MODEL_REGISTRY: missing }, repoRoot: cloneRoot() }), 'REGISTRY_NOT_FOUND', 'missing explicit registry');
  expectCode(() => loadModelRegistry({ env: { MCP_MODEL_REGISTRY: missing }, repoRoot: cloneRoot() }), 'REGISTRY_NOT_FOUND', 'missing fleet registry');
  const broken = writeFile('broken.json', '{"claude": ');
  expectCode(() => loadModelRegistry({ env: { EXPLAINER_MODEL_REGISTRY: broken }, repoRoot: cloneRoot() }), 'REGISTRY_INVALID', 'unparseable explicit registry');
  expectCode(() => loadModelRegistry({ env: {}, repoRoot: cloneRoot({ local: '{ not json' }) }), 'REGISTRY_INVALID', 'unparseable local config');

  const reg = loadModelRegistry({ env: {}, repoRoot: cloneRoot() });
  expectCode(() => model(reg, 'claude', 'repair', { MODEL_CLAUDE_REPAIR: 'gpt-5.6-terra' }), 'MODEL_PROVIDER_MISMATCH', 'openai model as claude repair');
  expectCode(() => model(reg, 'openai', 'vision', { MODEL_OPENAI_VISION: 'claude-sonnet-5-5' }), 'MODEL_PROVIDER_MISMATCH', 'claude model as openai vision');
  expectCode(() => model(reg, 'openai', 'repair', { MODEL_OPENAI_REPAIR: 'gpt-made-up-9' }), 'UNKNOWN_MODEL', 'unknown model');
  const badLocal = loadModelRegistry({ env: {}, repoRoot: cloneRoot({ local: { tiers: { openai: { vision: 'claude-opus-5-5' } } } }) });
  expectCode(() => model(badLocal, 'openai', 'vision'), 'MODEL_PROVIDER_MISMATCH', 'local tier pointing at another provider');
  expectCode(() => load().lookupModel(reg, 'not-a-model'), 'UNKNOWN_MODEL', 'lookup of an unknown id');
});

test('ownership comes from registry rows, not id prefixes, and declared aliases resolve exactly', () => {
  const { loadModelRegistry, modelProvider, lookupModel } = load();
  const root = cloneRoot({ local: { models: {
    'claude-lookalike': { provider: 'openai', aliases: ['lookalike-alias'] },
  } } });
  const reg = loadModelRegistry({ env: {}, repoRoot: root });
  assert.equal(modelProvider(reg, 'claude-lookalike'), 'openai');
  assert.equal(lookupModel(reg, 'lookalike-alias').id, 'claude-lookalike');
  assert.equal(model(reg, 'openai', 'repair', { MODEL_OPENAI_REPAIR: 'claude-lookalike' }), 'claude-lookalike');
});

test('price rows are atomic, unpriced rows are visible, and stale or promotional evidence is flagged', () => {
  const { loadModelRegistry, priceFor } = load();
  const fleet = writeFile('fleet-prices.json', FLEET);
  const root = cloneRoot({ local: {
    models: { 'my-local-model': { provider: 'openai' } },
    pricing: { 'claude-sonnet-4-6': { inPer1M: 3.5, outPer1M: 17.5, verified: true } },
  } });
  const reg = loadModelRegistry({ env: { MCP_MODEL_REGISTRY: fleet }, repoRoot: root });

  const sonnet = priceFor(reg, 'claude-sonnet-4-6', NOW);
  assert.equal(sonnet.status, 'priced');
  assert.equal(sonnet.inputPer1M, 3.5);
  assert.equal(sonnet.outputPer1M, 17.5);
  assert.equal(sonnet.cachedInputPer1M ?? null, null, 'a local price row replaces the fleet row whole: no inherited cached rate');

  const terra = priceFor(reg, 'gpt-5.6-terra', NOW);
  assert.equal(terra.status, 'priced');
  assert.equal(terra.inputPer1M, 2.0);
  assert.equal(terra.outputPer1M, 12.0);

  assert.equal(priceFor(reg, 'my-local-model', NOW).status, 'unpriced', 'a custom row without a price is reported, not zeroed');

  const sol = priceFor(reg, 'gpt-5.6-sol', NOW);
  assert.equal(sol.status, 'review_due', 'a promotion whose end date has passed needs review');
  assert.equal(sol.code, 'PRICE_REVIEW_DUE');
  const lite = priceFor(reg, 'gemini-2.5-flash-lite', NOW);
  assert.equal(lite.status, 'review_due', 'an unverified price row needs review');
  assert.equal(lite.code, 'PRICE_REVIEW_DUE');
});

test('the snapshot updater is deterministic, path-free and round-trips through the loader', () => {
  const script = path.join(REPO_ROOT, 'scripts', 'update-model-snapshot.ts');
  assert.ok(fs.existsSync(script), 'scripts/update-model-snapshot.ts must exist');
  const fleet = writeFile('fleet-for-update.json', FLEET);
  const run = (out: string) => execFileSync(process.execPath, ['--require', 'ts-node/register', script, '--fleet', fleet, '--out', out], {
    cwd: REPO_ROOT,
    env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1', MCP_MODEL_REGISTRY: '', EXPLAINER_MODEL_REGISTRY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const outA = path.join(TMP, 'snap-a.json');
  const outB = path.join(TMP, 'snap-b.json');
  run(outA);
  run(outB);
  const a = fs.readFileSync(outA, 'utf8');
  assert.equal(a, fs.readFileSync(outB, 'utf8'), 'two runs over the same fleet file are byte-identical');
  assert.ok(!a.includes(TMP) && !a.includes(os.tmpdir()) && !a.includes('/Users/'), 'no local paths in the snapshot');
  const fleetDigest = crypto.createHash('sha256').update(fs.readFileSync(fleet)).digest('hex');
  assert.ok(a.includes(fleetDigest), 'the snapshot records the sha256 of the fleet file it was built from');
  assert.ok(a.includes('2026-10-20'), 'the snapshot records the fleet capture date');

  const root = path.join(TMP, 'clone-updated');
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.copyFileSync(outA, path.join(root, 'config', 'models.snapshot.json'));
  const { loadModelRegistry, priceFor } = load();
  const reg = loadModelRegistry({ env: {}, repoRoot: root });
  assert.equal(model(reg, 'claude', 'repair'), 'claude-sonnet-4-6', 'the regenerated snapshot carries the fleet aliases');
  assert.equal(model(reg, 'openai', 'vision'), 'gpt-5.6-terra');
  assert.equal(priceFor(reg, 'claude-sonnet-4-6', NOW).inputPer1M, 3.0);
  assert.equal(model(reg, 'claude', 'synthesis'), 'claude-opus-4-8', 'regenerating never changes the synthesis profile');
});

test('the legacy model-config bridge keeps today\'s defaults and stops treating every non-claude id as OpenAI', () => {
  for (const key of REGISTRY_ENV) delete process.env[key];
  const mc = require('../../src/model-config') as Record<string, any>;
  const claude = mc.getModelConfig('claude');
  assert.equal(claude.batchModel, 'claude-opus-4-8');
  assert.equal(claude.synthesisModel, 'claude-opus-4-8');
  assert.equal(claude.repairModel, 'claude-sonnet-5-5');
  const openai = mc.getModelConfig('openai');
  assert.equal(openai.batchModel, 'gpt-5.6-terra');
  assert.equal(openai.synthesisModel, 'gpt-5.6-terra');
  assert.equal(openai.repairModel, 'gpt-5.6-luna');
  assert.equal(mc.modelBelongsToProvider('claude-opus-4-8', 'claude'), true);
  assert.equal(mc.modelBelongsToProvider('gpt-5.6-terra', 'openai'), true);
  assert.equal(mc.modelBelongsToProvider('gpt-5.6-terra', 'claude'), false);
  assert.equal(mc.modelBelongsToProvider('gemini-2.5-flash', 'openai'), false, 'a gemini id is not an OpenAI model');
});

test('the example local config documents the typed tier overrides and loads cleanly', () => {
  const example = fs.readFileSync(path.join(REPO_ROOT, 'config', 'models.json.example'), 'utf8');
  const parsed = JSON.parse(example);
  assert.ok(parsed.tiers && typeof parsed.tiers === 'object', 'config/models.json.example must show a tiers block');
  const { loadModelRegistry } = load();
  const reg = loadModelRegistry({ env: {}, repoRoot: cloneRoot({ local: example }) });
  for (const provider of ['claude', 'openai']) {
    for (const stage of ['synthesis', 'repair', 'vision']) {
      assert.ok(model(reg, provider, stage).length > 0, `${provider} ${stage} resolves with the example config`);
    }
  }
});
// AUTOMETTA-CONTRACT-END
