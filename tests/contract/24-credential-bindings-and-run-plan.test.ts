// Contract test for stage-cards/24-credential-bindings-and-run-plan.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/24-credential-bindings-and-run-plan.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-24-'));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/24-credential-bindings-and-run-plan.md
globalThis.fetch = (async () => {
  throw new Error('network access is forbidden in contract test 24');
}) as typeof fetch;

const SECRETS: Record<string, string> = {
  'anthropic-api-key': 'sk-ant-api-CONTRACT24-SECRET',
  'claude-oauth-token': 'sk-ant-oat-CONTRACT24-SECRET',
  'openai-api-key': 'sk-proj-CONTRACT24-SECRET',
  'gemini-api-key': 'gemini-CONTRACT24-SECRET',
};
const SCHEMA = { id: 'explainer', version: 2, digest: 'sha256:schema' };

function routes(): Record<string, any> {
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'src', 'routes.ts')), 'src/routes.ts must exist');
  return require('../../src/routes') as Record<string, any>;
}
function runPlan(): Record<string, any> {
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'src', 'run-plan.ts')), 'src/run-plan.ts must exist');
  return require('../../src/run-plan') as Record<string, any>;
}

let registryCache: unknown;
function registry(): unknown {
  if (registryCache) return registryCache;
  const root = path.join(TMP, 'clone');
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'config', 'models.snapshot.json'), path.join(root, 'config', 'models.snapshot.json'));
  fs.writeFileSync(path.join(root, 'config', 'models.json'), JSON.stringify({
    models: { 'claude-sync-only': { provider: 'claude', routes: ['sync-api', 'subscription-cli'] } },
    pricing: { 'claude-sync-only': { inPer1M: 1, outPer1M: 2, verified: true } },
  }));
  const reg = (require('../../src/model-registry') as Record<string, any>).loadModelRegistry({ env: {}, repoRoot: root });
  registryCache = reg;
  return reg;
}

interface Inv { kinds: Record<string, string>; codexAuth?: string; read: (kind: string) => string; reads: string[] }
function inventory(kinds: Record<string, string>, codexAuth = 'missing'): Inv {
  const reads: string[] = [];
  return {
    kinds, codexAuth, reads,
    read(kind: string) { reads.push(kind); return SECRETS[kind] ?? `unexpected-${kind}`; },
  };
}
const API_ONLY = () => inventory({ 'anthropic-api-key': 'present' });
const OAUTH_ONLY = () => inventory({ 'claude-oauth-token': 'present' });

function plan(opts: { provider?: string; env?: Record<string, string>; cli?: Record<string, unknown>; inv?: Inv; figures?: string } = {}) {
  return runPlan().buildRunPlan({
    provider: opts.provider ?? 'claude',
    env: opts.env ?? {},
    cli: opts.cli ?? {},
    inventory: opts.inv ?? API_ONLY(),
    registry: registry(),
    schema: SCHEMA,
    figures: opts.figures ?? 'optional',
  });
}

function expectCode(fn: () => unknown, code: string, label: string): void {
  let thrown: any;
  try { fn(); } catch (error) { thrown = error; }
  assert.ok(thrown, `${label}: expected an error with code ${code}, nothing was thrown`);
  assert.equal(thrown.code, code, `${label}: expected ${code}, got ${thrown && thrown.code} (${thrown && thrown.message})`);
}

function assertNoSecrets(value: unknown, label: string): void {
  const text = JSON.stringify(value);
  for (const secret of Object.values(SECRETS)) assert.ok(!text.includes(secret), `${label} must not contain a credential value`);
}

test('ROUTE_PREFERENCE parses to an ordered allowlist with a fixed default and named rejections', () => {
  const { parseRoutePreference } = routes();
  assert.deepEqual(parseRoutePreference(undefined), ['batch-api', 'subscription-cli', 'sync-api']);
  assert.deepEqual(parseRoutePreference(' Batch , API '), ['batch-api', 'sync-api']);
  assert.deepEqual(parseRoutePreference('subscription'), ['subscription-cli']);
  for (const bad of ['', ' , ', 'batch,batch', 'batch,lane', 'sync', 'batch,,api']) {
    expectCode(() => parseRoutePreference(bad), 'INVALID_ROUTE_PREFERENCE', JSON.stringify(bad));
  }
});

test('each route binds exactly one surface and the one credential that surface may consume', () => {
  const { resolveCredentialBinding } = routes();
  const all = inventory({ 'anthropic-api-key': 'present', 'claude-oauth-token': 'present', 'openai-api-key': 'present' }, 'chatgpt');
  const expected: Array<[string, string, string, string]> = [
    ['claude', 'batch-api', 'anthropic-api-sdk', 'anthropic-api-key'],
    ['claude', 'sync-api', 'anthropic-api-sdk', 'anthropic-api-key'],
    ['claude', 'subscription-cli', 'claude-agent-sdk', 'claude-oauth-token'],
    ['openai', 'batch-api', 'openai-api', 'openai-api-key'],
    ['openai', 'sync-api', 'openai-api', 'openai-api-key'],
    ['openai', 'subscription-cli', 'codex-cli', 'codex-chatgpt-login'],
  ];
  for (const [provider, route, surface, kind] of expected) {
    const binding = resolveCredentialBinding(provider, route, all);
    assert.equal(binding.provider, provider);
    assert.equal(binding.route, route);
    assert.equal(binding.surface, surface, `${provider} ${route} surface`);
    assert.equal(binding.credentialKind, kind, `${provider} ${route} credential`);
    assert.equal(typeof binding.credential, 'function', 'the credential is an opaque accessor');
    assertNoSecrets(binding, `${provider} ${route} binding`);
  }
  assert.deepEqual(all.reads, [], 'resolving bindings never reads a credential value');
  assert.equal(resolveCredentialBinding('claude', 'sync-api', all).credential(), SECRETS['anthropic-api-key']);
  assert.deepEqual(all.reads, ['anthropic-api-key'], 'the accessor reads only its own credential');
});

test('invalid pairings are refused by name before any I/O', () => {
  const { resolveCredentialBinding } = routes();
  expectCode(() => resolveCredentialBinding('claude', 'sync-api', OAUTH_ONLY()), 'MISSING_ROUTE_CREDENTIAL', 'claude api without a key');
  expectCode(() => resolveCredentialBinding('claude', 'subscription-cli', API_ONLY()), 'MISSING_ROUTE_CREDENTIAL', 'claude subscription without OAuth');
  expectCode(() => resolveCredentialBinding('claude', 'batch-api', inventory({ 'anthropic-api-key': 'wrong-kind' })), 'CLAUDE_OAUTH_WRONG_SURFACE', 'OAuth token where the API key belongs');
  for (const codexAuth of ['missing', 'malformed', 'api-key']) {
    expectCode(() => resolveCredentialBinding('openai', 'subscription-cli', inventory({}, codexAuth)), 'CODEX_AUTH_NOT_SUBSCRIPTION', `codex auth ${codexAuth}`);
  }
  expectCode(() => resolveCredentialBinding('openai', 'batch-api', inventory({}, 'api-key')), 'MISSING_ROUTE_CREDENTIAL', 'an API key inside the Codex auth file is not an API binding');
  expectCode(() => resolveCredentialBinding('gemini', 'sync-api', inventory({ 'gemini-api-key': 'present' })), 'PROVIDER_DISABLED', 'gemini');
  expectCode(() => resolveCredentialBinding('mistral', 'sync-api', API_ONLY()), 'UNKNOWN_PROVIDER', 'unknown provider');
});

test('subscription children get an allowlisted environment holding only their own credential', () => {
  const { resolveCredentialBinding, childEnvironment, assertSingleCredential } = routes();
  const all = inventory({ 'anthropic-api-key': 'present', 'claude-oauth-token': 'present', 'openai-api-key': 'present' }, 'chatgpt');
  const parent = {
    PATH: '/usr/bin', HOME: '/tmp/home', CODEX_HOME: '/tmp/codex',
    ANTHROPIC_API_KEY: SECRETS['anthropic-api-key'], CLAUDE_CODE_OAUTH_TOKEN: SECRETS['claude-oauth-token'],
    OPENAI_API_KEY: SECRETS['openai-api-key'], GEMINI_API_KEY: SECRETS['gemini-api-key'], UNRELATED_SETTING: 'x',
  };
  const claudeChild = childEnvironment(resolveCredentialBinding('claude', 'subscription-cli', all), parent);
  assert.equal(claudeChild.CLAUDE_CODE_OAUTH_TOKEN, SECRETS['claude-oauth-token']);
  assert.equal(claudeChild.PATH, '/usr/bin');
  assert.equal(claudeChild.HOME, '/tmp/home');
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'UNRELATED_SETTING']) {
    assert.equal(claudeChild[key], undefined, `claude subscription child must not carry ${key}`);
  }
  const codexChild = childEnvironment(resolveCredentialBinding('openai', 'subscription-cli', all), parent);
  assert.equal(codexChild.CODEX_HOME, '/tmp/codex');
  for (const key of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'UNRELATED_SETTING']) {
    assert.equal(codexChild[key], undefined, `codex child must not carry ${key}`);
  }
  assert.equal(parent.ANTHROPIC_API_KEY, SECRETS['anthropic-api-key'], 'the parent environment is not mutated');
  const claudeBinding = resolveCredentialBinding('claude', 'subscription-cli', all);
  assert.doesNotThrow(() => assertSingleCredential(claudeBinding, { PATH: '/usr/bin', CLAUDE_CODE_OAUTH_TOKEN: 'x' }));
  expectCode(() => assertSingleCredential(claudeBinding, { CLAUDE_CODE_OAUTH_TOKEN: 'x', ANTHROPIC_API_KEY: 'y' }), 'MIXED_BILLING_CREDENTIALS', 'two credentials in one child');
});

test('the preference walk skips only absent credentials or capabilities, records why, and never falls outside the list', () => {
  const claudeBatch = plan({ inv: API_ONLY() });
  assert.equal(claudeBatch.plan.route, 'batch-api');
  assert.equal(claudeBatch.decision.route, 'batch-api');
  assert.equal(claudeBatch.decision.credentialKind, 'anthropic-api-key');
  assert.deepEqual(claudeBatch.decision.skipped, []);

  const oauth = plan({ inv: OAUTH_ONLY() });
  assert.equal(oauth.plan.route, 'subscription-cli');
  assert.deepEqual(oauth.decision.skipped.map((s: any) => [s.route, s.reason]), [['batch-api', 'MISSING_ROUTE_CREDENTIAL']]);

  expectCode(() => plan({ inv: OAUTH_ONLY(), env: { ROUTE_PREFERENCE: 'batch,api' } }), 'NO_USABLE_ROUTE', 'omitted routes are prohibited, not fallbacks');
  expectCode(() => plan({ inv: inventory({ 'anthropic-api-key': 'wrong-kind', 'claude-oauth-token': 'present' }) }), 'CLAUDE_OAUTH_WRONG_SURFACE', 'a malformed binding is an error, not a skip');
  expectCode(() => plan({ provider: 'openai', inv: inventory({}, 'api-key'), env: { ROUTE_PREFERENCE: 'subscription' } }), 'CODEX_AUTH_NOT_SUBSCRIPTION', 'api-key-backed codex login');
  expectCode(() => plan({ provider: 'openai', inv: inventory({}, 'missing') }), 'NO_USABLE_ROUTE', 'no openai credential at all');

  const syncOnly = plan({ inv: API_ONLY(), env: { MODEL_CLAUDE_SYNTHESIS: 'claude-sync-only', ROUTE_PREFERENCE: 'batch,api' } });
  assert.equal(syncOnly.plan.route, 'sync-api');
  assert.deepEqual(syncOnly.decision.skipped.map((s: any) => [s.route, s.reason]), [['batch-api', 'MODEL_ROUTE_UNSUPPORTED']]);
});

test('a pinned route fails on any unavailable requirement, and --sync with --route conflicts', () => {
  expectCode(() => plan({ inv: OAUTH_ONLY(), cli: { route: 'sync-api' } }), 'MISSING_ROUTE_CREDENTIAL', 'pinned route without its credential');
  expectCode(() => plan({ inv: API_ONLY(), cli: { route: 'batch-api' }, env: { MODEL_CLAUDE_SYNTHESIS: 'claude-sync-only' } }), 'MODEL_ROUTE_UNSUPPORTED', 'pinned route the model lacks');
  const pinned = plan({ inv: API_ONLY(), cli: { route: 'sync-api' }, env: { ROUTE_PREFERENCE: 'batch' } });
  assert.equal(pinned.plan.route, 'sync-api', '--route overrides the preference');
  expectCode(() => plan({ cli: { route: 'lane' } }), 'INVALID_ROUTE_PREFERENCE', 'unknown --route value');
  expectCode(() => plan({ cli: { route: 'sync-api', sync: true } }), 'CONFLICTING_ROUTE_FLAGS', '--sync with --route');
});

test('legacy --sync is a deprecated boundary alias with today\'s per-provider meaning', () => {
  const claude = plan({ inv: OAUTH_ONLY(), cli: { sync: true } });
  assert.equal(claude.plan.route, 'subscription-cli');
  assert.ok(claude.warnings.some((w: string) => /--sync/.test(w) && /deprecat/i.test(w)), 'a deprecation warning names --sync');
  expectCode(() => plan({ inv: inventory({ 'anthropic-api-key': 'present', 'claude-oauth-token': 'present' }), cli: { sync: true } }), 'MIXED_BILLING_CREDENTIALS', 'legacy claude --sync with key and OAuth');
  const openaiKey = plan({ provider: 'openai', inv: inventory({ 'openai-api-key': 'present' }, 'chatgpt'), cli: { sync: true } });
  assert.equal(openaiKey.plan.route, 'sync-api', 'an explicit OpenAI key keeps API-first sync');
  const openaiChat = plan({ provider: 'openai', inv: inventory({}, 'chatgpt'), cli: { sync: true } });
  assert.equal(openaiChat.plan.route, 'subscription-cli');
  assert.ok(openaiChat.warnings.some((w: string) => /--route/.test(w)), 'the warning recommends --route');
  expectCode(() => plan({ provider: 'openai', inv: inventory({}, 'api-key'), cli: { sync: true } }), 'CODEX_AUTH_NOT_SUBSCRIPTION', 'the auth-file API key shortcut is a migration error');
});

test('the plan carries frozen tiers, defaults and digests, and no secret material', () => {
  const inv = inventory({ 'anthropic-api-key': 'present', 'claude-oauth-token': 'present' });
  const result = plan({ inv });
  const p = result.plan;
  assert.equal(p.version, 1);
  assert.equal(p.strategy, 'single-pass');
  assert.equal(p.provider, 'claude');
  assert.equal(p.route, 'batch-api');
  assert.deepEqual(p.schema, SCHEMA);
  assert.equal(p.tiers.synthesis.provider, 'claude');
  assert.equal(p.tiers.synthesis.route, 'batch-api');
  assert.equal(p.tiers.synthesis.model, 'claude-opus-4-8', 'synthesis keeps the compatibility profile');
  assert.equal(p.tiers.repair.provider, 'claude', 'repair stays on the run provider');
  assert.equal(p.tiers.repair.route, 'sync-api', 'batch synthesis repairs on sync-api');
  assert.equal(p.tiers.repair.model, 'claude-sonnet-5-5');
  assert.equal(p.tiers.vision.provider, 'claude');
  assert.equal(p.tiers.vision.route, 'subscription-cli', 'vision walks its own subscription,api preference');
  assert.equal(p.tiers.vision.model, 'claude-sonnet-5-5');
  for (const tier of [p.tiers.synthesis, p.tiers.repair, p.tiers.vision]) {
    assert.ok(Number.isInteger(tier.maxOutputTokens) && tier.maxOutputTokens > 0);
  }
  assert.deepEqual(p.callTimeoutMs, { synthesis: 600000, repair: 300000, vision: 180000 });
  assert.equal(p.activeWallClockLimitMs, 7200000);
  assert.equal(p.concurrency, 1);
  assert.equal(p.maxRepairAttempts, 2);
  assert.equal(p.registryDigest, (registry() as any).digest);
  assert.ok(typeof p.policyDigest === 'string' && p.policyDigest.length >= 16);
  assert.ok(Object.isFrozen(p) && Object.isFrozen(p.tiers) && Object.isFrozen(p.tiers.synthesis), 'the plan is immutable');
  assert.ok(typeof result.digest === 'string' && result.digest.length >= 16);
  assert.equal(plan({ inv: inventory({ 'anthropic-api-key': 'present', 'claude-oauth-token': 'present' }) }).digest, result.digest, 'the plan digest is deterministic');
  assert.notEqual(plan({ inv, env: { MODEL_CLAUDE_REPAIR: 'claude-opus-5-5' } }).digest, result.digest, 'a model change changes the digest');
  assert.notEqual(plan({ inv, env: { ROUTE_PREFERENCE: 'batch,api' } }).plan.policyDigest, p.policyDigest, 'a policy change changes the policy digest');
  assertNoSecrets(result.plan, 'the plan');
  assertNoSecrets(result.decision, 'the selection decision');
  assert.deepEqual(inv.reads, [], 'building a plan never reads a credential value');
  assert.deepEqual(Object.keys(result.decision.models).sort(), ['repair', 'synthesis', 'vision']);
  assert.ok(['default', 'ROUTE_PREFERENCE', 'route-flag', 'sync-flag'].includes(result.decision.policySource));
});

test('repair and vision routes follow the synthesis route unless configured, and never fall back silently', () => {
  const sub = plan({ inv: OAUTH_ONLY() });
  assert.equal(sub.plan.tiers.repair.route, 'subscription-cli', 'subscription synthesis repairs on subscription');
  const api = plan({ inv: API_ONLY(), cli: { route: 'sync-api' } });
  assert.equal(api.plan.tiers.repair.route, 'sync-api');
  assert.equal(api.plan.tiers.vision.route, 'sync-api', 'without OAuth, vision takes the api entry of its preference');

  const openai = plan({ provider: 'openai', inv: inventory({ 'openai-api-key': 'present' }, 'chatgpt') });
  assert.equal(openai.plan.route, 'batch-api');
  assert.equal(openai.plan.tiers.synthesis.model, 'gpt-5.6-terra');
  assert.equal(openai.plan.tiers.repair.route, 'sync-api');
  assert.equal(openai.plan.tiers.repair.model, 'gpt-6-luna');
  assert.equal(openai.plan.tiers.vision.route, 'subscription-cli');
  assert.equal(openai.plan.tiers.vision.model, 'gpt-6.1-sol');

  const explicitRepair = plan({ provider: 'openai', inv: inventory({ 'openai-api-key': 'present' }, 'chatgpt'), env: { REPAIR_ROUTE: 'subscription-cli' } });
  assert.equal(explicitRepair.plan.tiers.repair.route, 'subscription-cli');
  expectCode(() => plan({ provider: 'openai', inv: inventory({ 'openai-api-key': 'present' }, 'missing'), env: { REPAIR_ROUTE: 'subscription-cli' } }), 'CODEX_AUTH_NOT_SUBSCRIPTION', 'unavailable explicit repair route fails preflight');
  assert.doesNotThrow(() => plan({ provider: 'openai', inv: inventory({ 'openai-api-key': 'present' }, 'missing'), env: { REPAIR_ROUTE: 'subscription-cli', MAX_REPAIR_ATTEMPTS: '0' } }), 'zero repair attempts waives the repair binding');
  expectCode(() => plan({ env: { REPAIR_ROUTE: 'batch-api' } }), 'ROUTE_UNSUPPORTED', 'repair must use an immediate route');

  const crossVision = plan({ inv: inventory({ 'anthropic-api-key': 'present' }, 'chatgpt'), env: { VISION_PROVIDER: 'openai' } });
  assert.equal(crossVision.plan.tiers.vision.provider, 'openai');
  assert.equal(crossVision.plan.tiers.vision.route, 'subscription-cli');
  assert.equal(crossVision.plan.tiers.vision.model, 'gpt-6.1-sol');
  assert.equal(plan({ inv: inventory({ 'anthropic-api-key': 'present' }, 'chatgpt') }).plan.tiers.vision.provider, 'claude', 'credentials alone never move vision to another provider');

  const deferred = plan({ inv: API_ONLY(), env: { VISION_ROUTE: 'batch-api' } });
  assert.equal(deferred.plan.tiers.vision.route, 'batch-api', 'an explicit VISION_ROUTE=batch-api schedules vision as a batch');

  const optional = plan({ inv: API_ONLY(), env: { VISION_ROUTE_PREFERENCE: 'subscription' }, figures: 'optional' });
  assert.equal(optional.plan.tiers.vision, null, 'an optional figure with no vision binding is disabled');
  assert.ok(typeof optional.plan.visionDisabledReason === 'string' && optional.plan.visionDisabledReason.length > 0, 'and the reason is recorded');
  expectCode(() => plan({ inv: API_ONLY(), env: { VISION_ROUTE_PREFERENCE: 'subscription' }, figures: 'required' }), 'NO_USABLE_ROUTE', 'required figures need a vision binding before submission');
});

test('model overrides are provider-scoped, validated before I/O, and vision never reads synthesis knobs', () => {
  const inv = API_ONLY();
  expectCode(() => plan({ inv, env: { MODEL_CLAUDE_SYNTHESIS: 'gpt-5.6-terra' } }), 'MODEL_PROVIDER_MISMATCH', 'openai model on a claude run');
  expectCode(() => plan({ inv, env: { MODEL_CLAUDE_REPAIR: 'claude-made-up-1' } }), 'UNKNOWN_MODEL', 'unknown repair model');
  expectCode(() => plan({ inv, env: { FIGURE_DATA_MODEL: 'gpt-5.6-terra' } }), 'MODEL_PROVIDER_MISMATCH', 'legacy figure-data model of another provider');
  assert.deepEqual(inv.reads, [], 'validation happens before any credential is read');

  const legacyBatch = plan({ inv: API_ONLY(), env: { MODEL: 'claude-fable-5-1' } });
  assert.equal(legacyBatch.plan.tiers.synthesis.model, 'claude-fable-5-1', 'claude batch keeps MODEL as a legacy synthesis override');
  assert.equal(legacyBatch.plan.tiers.vision.model, 'claude-sonnet-5-5', 'vision never reads MODEL');
  const legacySync = plan({ inv: API_ONLY(), cli: { route: 'sync-api' }, env: { MODEL_SYNTHESIS: 'claude-opus-5-5', MODEL_BATCH: 'claude-fable-5-1' } });
  assert.equal(legacySync.plan.tiers.synthesis.model, 'claude-opus-5-5', 'claude sync reads MODEL_SYNTHESIS');
  assert.equal(legacySync.plan.tiers.vision.model, 'claude-sonnet-5-5', 'vision never reads MODEL_SYNTHESIS');
  const openaiIgnored = plan({ provider: 'openai', inv: inventory({ 'openai-api-key': 'present' }), env: { MODEL_BATCH: 'gpt-6-astra' } });
  assert.equal(openaiIgnored.plan.tiers.synthesis.model, 'gpt-5.6-terra', 'MODEL_BATCH does not select an OpenAI synthesis model');
  assert.ok(openaiIgnored.warnings.some((w: string) => /MODEL_BATCH/.test(w)), 'the ignored knob is logged');

  const translated = plan({ inv: API_ONLY(), env: { FIGURE_VLM_MODEL: 'claude-opus-5-5' } });
  assert.equal(translated.plan.tiers.vision.model, 'claude-opus-5-5', 'FIGURE_VLM_MODEL is translated once into the vision tier');
  assert.ok(translated.warnings.some((w: string) => /FIGURE_VLM_MODEL/.test(w)));
  expectCode(() => plan({ inv: API_ONLY(), env: { FIGURE_VLM_MODEL: 'claude-opus-5-5', MODEL_CLAUDE_VISION: 'claude-sonnet-5-5' } }), 'CONFLICTING_MODEL_OVERRIDE', 'old and new vision settings disagree');
});

test('a stored plan is checked against an explicit provider on poll and resume', () => {
  const { assertPlanProvider } = runPlan();
  const { plan: p } = plan({ inv: API_ONLY() });
  assert.doesNotThrow(() => assertPlanProvider(p, undefined));
  assert.doesNotThrow(() => assertPlanProvider(p, 'claude'));
  expectCode(() => assertPlanProvider(p, 'openai'), 'RUN_PROVIDER_MISMATCH', 'poll with another provider');
});

test('route and plan modules do no I/O of their own and leave the legacy entrypoints alone', () => {
  for (const file of ['routes.ts', 'run-plan.ts']) {
    const source = fs.readFileSync(path.join(REPO_ROOT, 'src', file), 'utf8');
    assert.ok(!/process\.env/.test(source), `src/${file} must take its environment as an argument`);
    for (const banned of ["from 'fs'", "from 'node:fs'", 'child_process', '@anthropic-ai/', "from 'openai'", "'./providers'", "'./batch'", '.env.local', 'op://', 'auth.json']) {
      assert.ok(!source.includes(banned), `src/${file} must not reference ${banned}`);
    }
  }
  const index = fs.readFileSync(path.join(REPO_ROOT, 'src', 'index.ts'), 'utf8');
  assert.ok(!/run-plan|routes'/.test(index), 'CLI wiring is a later card');
});
// AUTOMETTA-CONTRACT-END
