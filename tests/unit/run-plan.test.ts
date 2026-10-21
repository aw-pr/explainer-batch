import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LlmContractError } from '../../src/llm-contract';
import type { ProviderId, Route, RunPlan } from '../../src/llm-contract';
import type { ModelRegistry } from '../../src/model-registry';
import {
  assertSingleCredential, childEnvironment, parseRoutePreference, resolveCredentialBinding,
} from '../../src/routes';
import type { CredentialInventory, CredentialKind } from '../../src/routes';
import { assertPlanProvider, buildRunPlan, planDigest } from '../../src/run-plan';
import type { BuildRunPlanOptions } from '../../src/run-plan';

const schema = { id: 'unit-schema', version: 2, digest: 'schema-digest' };
const models: Array<[string, ProviderId, Route[]?]> = [
  ['claude-opus-4-8', 'claude'], ['claude-sonnet', 'claude'], ['claude-alternative', 'claude'],
  ['gpt-5.6-terra', 'openai'], ['openai-mini', 'openai'], ['openai-vision', 'openai'],
  ['claude-sync-only', 'claude', ['sync-api']], ['openai-batch-only', 'openai', ['batch-api']],
];
const registry: ModelRegistry = {
  digest: 'unit-registry-digest',
  tiers: { claude: { sonnet: 'claude-sonnet' }, openai: { mini: 'openai-mini', batch: 'openai-vision' } },
  localStages: {}, pricing: {},
  models: Object.fromEntries(models.map(([id, provider, routes]) => [id, { id, provider, routes }])),
};
registry.models['claude-alternative'].aliases = ['alternative'];

function inventory(
  kinds: CredentialInventory['kinds'] = {
    'anthropic-api-key': 'present', 'claude-oauth-token': 'present', 'openai-api-key': 'present',
  },
  codexAuth: CredentialInventory['codexAuth'] = 'chatgpt',
): CredentialInventory & { reads: CredentialKind[] } {
  const reads: CredentialKind[] = [];
  return {
    kinds, codexAuth, reads,
    read(kind) { reads.push(kind); return `fake-secret-${kind}`; },
  };
}

function build(options: Partial<BuildRunPlanOptions> = {}) {
  return buildRunPlan({ provider: 'claude', env: {}, inventory: inventory(), registry, schema, ...options });
}

function code(expected: string) {
  return (error: unknown) => error instanceof LlmContractError && error.code === expected;
}

const matrix: Array<[ProviderId, Route, string, CredentialKind]> = [
  ['claude', 'batch-api', 'anthropic-api-sdk', 'anthropic-api-key'],
  ['claude', 'sync-api', 'anthropic-api-sdk', 'anthropic-api-key'],
  ['claude', 'subscription-cli', 'claude-agent-sdk', 'claude-oauth-token'],
  ['openai', 'batch-api', 'openai-api', 'openai-api-key'],
  ['openai', 'sync-api', 'openai-api', 'openai-api-key'],
  ['openai', 'subscription-cli', 'codex-cli', 'codex-chatgpt-login'],
];

for (const [provider, route, surface, kind] of matrix) {
  test(`${provider} ${route} binds ${surface} and lazily reads only ${kind}`, () => {
    const inv = inventory();
    const binding = resolveCredentialBinding(provider, route, inv);
    assert.deepEqual(inv.reads, []);
    assert.equal(binding.provider, provider);
    assert.equal(binding.route, route);
    assert.equal(binding.surface, surface);
    assert.equal(binding.credentialKind, kind);
    assert.ok(!JSON.stringify(binding).includes('fake-secret'));
    assert.equal(binding.credential(), `fake-secret-${kind}`);
    assert.deepEqual(inv.reads, [kind]);
  });
  test(`${provider} ${route} refuses its absent or wrong-kind credential`, () => {
    const inv = inventory({}, 'missing');
    assert.throws(() => resolveCredentialBinding(provider, route, inv), code(
      kind === 'codex-chatgpt-login' ? 'CODEX_AUTH_NOT_SUBSCRIPTION' : 'MISSING_ROUTE_CREDENTIAL',
    ));
    const wrong = inventory({ [kind]: 'wrong-kind' });
    assert.throws(() => resolveCredentialBinding(provider, route, wrong), code(
      kind === 'anthropic-api-key' ? 'CLAUDE_OAUTH_WRONG_SURFACE'
        : kind === 'codex-chatgpt-login' ? 'CODEX_AUTH_NOT_SUBSCRIPTION' : 'MISSING_ROUTE_CREDENTIAL',
    ));
    assert.deepEqual(inv.reads, []);
    assert.deepEqual(wrong.reads, []);
  });
}

test('provider and malformed Codex refusals never read credentials', () => {
  for (const provider of ['gemini', 'unregistered', '__proto__']) {
    assert.throws(() => resolveCredentialBinding(provider, 'sync-api', inventory()),
      code(provider === 'gemini' ? 'PROVIDER_DISABLED' : 'UNKNOWN_PROVIDER'));
    assert.throws(() => build({ provider }), code(provider === 'gemini' ? 'PROVIDER_DISABLED' : 'UNKNOWN_PROVIDER'));
  }
  for (const codexAuth of ['missing', 'api-key', 'malformed', undefined] as const) {
    const inv = inventory({}, codexAuth);
    if (codexAuth === undefined) delete inv.codexAuth;
    assert.throws(() => resolveCredentialBinding('openai', 'subscription-cli', inv), code('CODEX_AUTH_NOT_SUBSCRIPTION'));
    assert.deepEqual(inv.reads, []);
  }
});

test('route preference rejects empty, duplicate, unknown and inherited property tokens', () => {
  assert.deepEqual(parseRoutePreference(undefined), ['batch-api', 'subscription-cli', 'sync-api']);
  assert.deepEqual(parseRoutePreference(' API , Subscription '), ['sync-api', 'subscription-cli']);
  for (const value of ['', 'batch,', 'batch,BATCH', 'api,,batch', 'sync-api', 'constructor', '__proto__']) {
    assert.throws(() => parseRoutePreference(value), code('INVALID_ROUTE_PREFERENCE'));
  }
});

test('child environments are independent allowlists and never read the Codex login', () => {
  const inv = inventory();
  const parent = Object.freeze({
    PATH: '/bin', HOME: '/tmp/unit-home', CODEX_HOME: '/tmp/unit-codex',
    ANTHROPIC_API_KEY: 'parent-api', OPENAI_API_KEY: 'parent-api', GEMINI_API_KEY: 'parent-api',
    CLAUDE_CODE_OAUTH_TOKEN: 'parent-oauth', ANTHROPIC_AUTH_TOKEN: 'parent-bearer',
    OP_SERVICE_ACCOUNT_TOKEN: 'parent-service', UNRELATED: 'discard',
  });
  const claude = childEnvironment(resolveCredentialBinding('claude', 'subscription-cli', inv), parent);
  assert.deepEqual(claude, { PATH: '/bin', HOME: '/tmp/unit-home', CLAUDE_CODE_OAUTH_TOKEN: 'fake-secret-claude-oauth-token' });
  const codex = childEnvironment(resolveCredentialBinding('openai', 'subscription-cli', inv), parent);
  assert.deepEqual(codex, { PATH: '/bin', HOME: '/tmp/unit-home', CODEX_HOME: '/tmp/unit-codex' });
  assert.deepEqual(inv.reads, ['claude-oauth-token']);
  assert.equal(parent.CLAUDE_CODE_OAUTH_TOKEN, 'parent-oauth');
  for (const provider of ['claude', 'openai'] as const) {
    for (const route of ['batch-api', 'sync-api'] as const) {
      assert.throws(() => childEnvironment(resolveCredentialBinding(provider, route, inv), parent), code('ROUTE_UNSUPPORTED'));
    }
  }
});

test('each binding rejects all foreign credential variables, including empty ones', () => {
  const variables: Partial<Record<CredentialKind, string>> = {
    'anthropic-api-key': 'ANTHROPIC_API_KEY', 'claude-oauth-token': 'CLAUDE_CODE_OAUTH_TOKEN',
    'openai-api-key': 'OPENAI_API_KEY', 'gemini-api-key': 'GEMINI_API_KEY',
  };
  for (const [provider, route, , kind] of matrix) {
    const binding = resolveCredentialBinding(provider, route, inventory());
    assert.doesNotThrow(() => assertSingleCredential(binding, { PATH: '/bin' }));
    for (const variable of Object.values(variables)) {
      if (variable === variables[kind]) {
        assert.doesNotThrow(() => assertSingleCredential(binding, { [variable]: 'fake-own' }));
      } else {
        assert.throws(() => assertSingleCredential(binding, { [variable]: '' }), code('MIXED_BILLING_CREDENTIALS'));
      }
    }
  }
});

test('walks skip absent credentials and unsupported routes, never malformed configurations', () => {
  const inv = inventory({ 'claude-oauth-token': 'present' }, 'missing');
  const result = build({ inventory: inv });
  assert.equal(result.plan.route, 'subscription-cli');
  assert.deepEqual(result.decision.skipped, [{ route: 'batch-api', reason: 'MISSING_ROUTE_CREDENTIAL' }]);
  assert.throws(() => build({ inventory: inv, env: { ROUTE_PREFERENCE: 'api,batch' } }), code('NO_USABLE_ROUTE'));
  const missingCodex = build({ provider: 'openai', inventory: inventory({ 'openai-api-key': 'present' }, 'missing'),
    env: { ROUTE_PREFERENCE: 'subscription,api' } });
  assert.equal(missingCodex.plan.route, 'sync-api');
  assert.deepEqual(missingCodex.decision.skipped, [{ route: 'subscription-cli', reason: 'MISSING_ROUTE_CREDENTIAL' }]);
  for (const codexAuth of ['api-key', 'malformed'] as const) {
    const openai = inventory({ 'openai-api-key': 'present' }, codexAuth);
    assert.throws(() => build({ provider: 'openai', inventory: openai, env: { ROUTE_PREFERENCE: 'subscription,api' } }),
      code('CODEX_AUTH_NOT_SUBSCRIPTION'));
    assert.deepEqual(openai.reads, []);
  }
  for (const kind of ['anthropic-api-key', 'claude-oauth-token', 'openai-api-key'] as const) {
    const provider = kind === 'openai-api-key' ? 'openai' : 'claude';
    assert.throws(() => build({ provider, inventory: inventory({ [kind]: 'wrong-kind' }),
      env: { ROUTE_PREFERENCE: kind === 'claude-oauth-token' ? 'subscription,api' : 'api,subscription' } }),
    code(kind === 'anthropic-api-key' ? 'CLAUDE_OAUTH_WRONG_SURFACE' : 'MISSING_ROUTE_CREDENTIAL'));
  }
  const sync = build({ env: { MODEL_CLAUDE_SYNTHESIS: 'claude-sync-only', ROUTE_PREFERENCE: 'batch,api' } });
  assert.equal(sync.plan.route, 'sync-api');
  assert.deepEqual(sync.decision.skipped, [{ route: 'batch-api', reason: 'MODEL_ROUTE_UNSUPPORTED' }]);
  assert.deepEqual(inv.reads, []);
});

test('pins ignore preferences, fail closed and reject conflicting flags', () => {
  assert.equal(build({ cli: { route: 'sync-api' }, env: { ROUTE_PREFERENCE: 'invalid' } }).plan.route, 'sync-api');
  assert.throws(() => build({ cli: { route: 'sync-api', sync: true } }), code('CONFLICTING_ROUTE_FLAGS'));
  assert.throws(() => build({ cli: { route: 'invalid' as Route } }), code('INVALID_ROUTE_PREFERENCE'));
  assert.throws(() => build({ cli: { route: 'batch-api' }, env: { MODEL_CLAUDE_SYNTHESIS: 'claude-sync-only' } }),
    code('MODEL_ROUTE_UNSUPPORTED'));
  assert.throws(() => build({ cli: { route: 'subscription-cli' }, inventory: inventory({ 'anthropic-api-key': 'present' }) }),
    code('MISSING_ROUTE_CREDENTIAL'));
});

test('legacy sync retains provider-specific billing rules and gives actionable warnings', () => {
  const claude = build({ inventory: inventory({ 'claude-oauth-token': 'present' }), cli: { sync: true } });
  assert.equal(claude.plan.route, 'subscription-cli');
  assert.equal(claude.decision.policySource, 'sync-flag');
  assert.match(claude.warnings.join(' '), /--sync.*deprecated.*--route subscription-cli/);
  assert.throws(() => build({ cli: { sync: true } }), code('MIXED_BILLING_CREDENTIALS'));
  assert.equal(build({ provider: 'openai', cli: { sync: true } }).plan.route, 'sync-api');
  assert.equal(build({ provider: 'openai', inventory: inventory({}), cli: { sync: true } }).plan.route, 'subscription-cli');
  assert.throws(() => build({ provider: 'openai', inventory: inventory({}, 'api-key'), cli: { sync: true } }),
    code('CODEX_AUTH_NOT_SUBSCRIPTION'));
});

for (const provider of ['claude', 'openai'] as const) {
  for (const stage of ['synthesis', 'repair', 'vision'] as const) {
    test(`${provider} ${stage} checks model membership and provider before credential access`, () => {
      const inv = inventory();
      const variable = `MODEL_${provider.toUpperCase()}_${stage.toUpperCase()}`;
      const foreign = provider === 'claude' ? 'gpt-5.6-terra' : 'claude-sonnet';
      for (const [value, expected] of [[foreign, 'MODEL_PROVIDER_MISMATCH'], ['unknown-private-model', 'UNKNOWN_MODEL']]) {
        assert.throws(() => build({ provider, inventory: inv, env: { [variable]: value } }), code(expected));
      }
      assert.deepEqual(inv.reads, []);
    });
  }
}

test('legacy synthesis translation respects routes, precedence, aliases and scoped conflicts', () => {
  const precedence = build({ env: { MODEL_BATCH: 'alternative', MODEL: 'claude-sonnet' } });
  assert.equal(precedence.plan.tiers.synthesis.model, 'claude-alternative');
  assert.match(precedence.warnings.join(' '), /MODEL is ignored/);
  assert.equal(build({ env: { MODEL: 'alternative' } }).plan.tiers.synthesis.model, 'claude-alternative');
  const sync = build({ cli: { route: 'sync-api' }, env: { MODEL_BATCH: 'claude-alternative', MODEL_SYNTHESIS: 'claude-sonnet' } });
  assert.equal(sync.plan.tiers.synthesis.model, 'claude-sonnet');
  assert.equal(sync.plan.tiers.vision?.model, 'claude-sonnet');
  assert.match(sync.warnings.join(' '), /MODEL_BATCH is ignored/);
  for (const [cli, legacy] of [
    [{ route: 'batch-api' }, 'MODEL'], [{ route: 'batch-api' }, 'MODEL_BATCH'],
    [{ route: 'sync-api' }, 'MODEL_SYNTHESIS'], [{ route: 'subscription-cli' }, 'MODEL_SYNTHESIS'],
  ] as const) {
    assert.throws(() => build({ cli, env: { [legacy]: 'claude-alternative', MODEL_CLAUDE_SYNTHESIS: 'claude-sonnet' } }),
      code('CONFLICTING_MODEL_OVERRIDE'));
  }
  assert.doesNotThrow(() => build({ env: { MODEL: 'alternative', MODEL_CLAUDE_SYNTHESIS: 'claude-alternative' } }));
  const openai = build({ provider: 'openai', env: { MODEL_BATCH: 'claude-alternative', MODEL_SYNTHESIS: 'openai-vision' } });
  assert.equal(openai.plan.tiers.synthesis.model, 'openai-vision');
  assert.match(openai.warnings.join(' '), /MODEL_BATCH.*ignored/);
  assert.throws(() => build({ provider: 'openai', env: { MODEL_SYNTHESIS: 'openai-vision', MODEL_OPENAI_SYNTHESIS: 'openai-mini' } }),
    code('CONFLICTING_MODEL_OVERRIDE'));
});

test('repair routes must resolve before return unless attempts are explicitly waived', () => {
  const inv = inventory({ 'anthropic-api-key': 'present' }, 'missing');
  assert.throws(() => build({ inventory: inv, env: { REPAIR_ROUTE: 'subscription-cli' } }), code('MISSING_ROUTE_CREDENTIAL'));
  const waived = build({ inventory: inv, env: { REPAIR_ROUTE: 'subscription-cli', MAX_REPAIR_ATTEMPTS: '0' } });
  assert.equal(waived.plan.maxRepairAttempts, 0);
  assert.equal(waived.plan.tiers.repair.model, 'claude-sonnet');
  assert.deepEqual(inv.reads, []);
  const defaultWaived = build({ env: { MAX_REPAIR_ATTEMPTS: '0' } });
  assert.equal(defaultWaived.plan.tiers.repair.route, 'sync-api');
  for (const value of ['', '-1', '1.2', 'NaN', 'Infinity', '1e2', '9007199254740992']) {
    assert.throws(() => build({ env: { MAX_REPAIR_ATTEMPTS: value } }), /MAX_REPAIR_ATTEMPTS/);
  }
  assert.throws(() => build({ env: { REPAIR_ROUTE: 'batch-api' } }), code('ROUTE_UNSUPPORTED'));
  assert.throws(() => build({ provider: 'openai', env: { MODEL_OPENAI_REPAIR: 'openai-batch-only' } }), code('MODEL_ROUTE_UNSUPPORTED'));
});

test('vision routes and provider are explicit, with optional absence recorded and required absence rejected', () => {
  const inv = inventory({ 'anthropic-api-key': 'present' });
  assert.equal(build({ inventory: inv }).plan.tiers.vision?.provider, 'claude');
  assert.equal(build({ inventory: inv }).plan.tiers.vision?.route, 'sync-api');
  const cross = build({ inventory: inv, env: { VISION_PROVIDER: 'openai' } });
  assert.equal(cross.plan.tiers.vision?.provider, 'openai');
  assert.equal(cross.plan.tiers.vision?.route, 'subscription-cli');
  assert.equal(build({ env: { VISION_ROUTE: 'batch-api' } }).plan.tiers.vision?.route, 'batch-api');
  const disabled = build({ inventory: inv, env: { VISION_ROUTE_PREFERENCE: 'subscription' } });
  assert.equal(disabled.plan.tiers.vision, null);
  assert.ok(disabled.plan.visionDisabledReason);
  assert.equal(disabled.decision.models.vision, null);
  assert.throws(() => build({ inventory: inv, figures: 'required', env: { VISION_ROUTE_PREFERENCE: 'subscription' } }), code('NO_USABLE_ROUTE'));
  const none = build({ figures: 'none' });
  assert.equal(none.plan.tiers.vision, null);
  assert.ok(none.plan.visionDisabledReason);
  assert.throws(() => build({ env: { VISION_ROUTE: 'unknown' } }), code('INVALID_ROUTE_PREFERENCE'));
  assert.throws(() => build({ env: { VISION_PROVIDER: 'unknown' } }), code('UNKNOWN_PROVIDER'));
  assert.throws(() => build({ env: { VISION_PROVIDER: 'gemini' } }), code('PROVIDER_DISABLED'));
  assert.throws(() => build({ inventory: inventory({ 'anthropic-api-key': 'present' }, 'malformed'), env: { VISION_PROVIDER: 'openai' } }),
    code('CODEX_AUTH_NOT_SUBSCRIPTION'));
});

test('legacy vision knobs are translated once, validated and warned without using synthesis overrides', () => {
  const env = {
    MODEL: 'claude-alternative', FIGURE_VLM_MODEL: 'claude-sonnet',
    FIGURE_VLM_VERIFY_MODEL: 'claude-alternative', FIGURE_DATA_MODEL: 'alternative', FIGURE_VLM_PROVIDER: 'claude',
  };
  const result = build({ env });
  assert.equal(result.plan.tiers.vision?.model, 'claude-sonnet');
  assert.equal(result.plan.tiers.synthesis.model, 'claude-alternative');
  for (const name of Object.keys(env)) assert.ok(result.warnings.some(warning => warning.includes(name)));
  for (const name of ['FIGURE_VLM_MODEL', 'FIGURE_VLM_VERIFY_MODEL', 'FIGURE_DATA_MODEL']) {
    assert.throws(() => build({ env: { [name]: 'gpt-5.6-terra' } }), code('MODEL_PROVIDER_MISMATCH'));
  }
  assert.throws(() => build({ env: { FIGURE_VLM_MODEL: 'alternative', MODEL_CLAUDE_VISION: 'claude-sonnet' } }), code('CONFLICTING_MODEL_OVERRIDE'));
  assert.throws(() => build({ env: { FIGURE_VLM_PROVIDER: 'openai', VISION_PROVIDER: 'claude' } }), code('CONFLICTING_MODEL_OVERRIDE'));
  assert.doesNotThrow(() => build({ env: { FIGURE_VLM_VERIFY_MODEL: 'alternative', MODEL_CLAUDE_VISION: 'claude-sonnet' } }));
});

test('plan is detached and deeply frozen, has deterministic digests, and carries no credential or environment data', () => {
  const inv = inventory();
  const ownSchema = { ...schema };
  const env = { HOME: '/tmp/private-login-location', OPENAI_API_KEY: 'fake-env-secret' };
  const result = build({ inventory: inv, schema: ownSchema, env });
  const { plan } = result;
  function frozen(value: unknown): void {
    if (value !== null && typeof value === 'object') {
      assert.ok(Object.isFrozen(value));
      Object.values(value).forEach(frozen);
    }
  }
  frozen(plan);
  assert.ok(!Object.isFrozen(ownSchema));
  ownSchema.version = 9;
  assert.equal(plan.schema.version, 2);
  assert.deepEqual(plan.callTimeoutMs, { synthesis: 600000, repair: 300000, vision: 180000 });
  assert.equal(plan.activeWallClockLimitMs, 7200000);
  assert.equal(plan.maxRepairAttempts, 2);
  assert.equal(plan.concurrency, 1);
  assert.equal(plan.tiers.synthesis.maxOutputTokens, 16384);
  assert.equal(build({ provider: 'openai' }).plan.tiers.synthesis.maxOutputTokens, 8192);
  assert.equal(result.digest, build().digest);
  assert.equal(planDigest({ ...plan, schema: { digest: schema.digest, version: schema.version, id: schema.id } }), result.digest);
  for (const stage of ['SYNTHESIS', 'REPAIR', 'VISION']) {
    assert.notEqual(build({ env: { [`MODEL_CLAUDE_${stage}`]: 'alternative' } }).digest, result.digest);
  }
  assert.notEqual(build({ env: { ROUTE_PREFERENCE: 'batch,api' } }).plan.policyDigest, plan.policyDigest);
  assert.notEqual(build({ env: { VISION_ROUTE_PREFERENCE: 'api' } }).plan.policyDigest, plan.policyDigest);
  assert.notEqual(build({ env: { VISION_ROUTE: 'sync-api' } }).plan.policyDigest,
    build({ env: { VISION_ROUTE_PREFERENCE: 'api' } }).plan.policyDigest);
  assert.equal(plan.registryDigest, registry.digest);
  const serialised = JSON.stringify(result);
  for (const forbidden of ['fake-secret', env.HOME, env.OPENAI_API_KEY, 'credential()']) assert.ok(!serialised.includes(forbidden));
  assert.deepEqual(inv.reads, []);
  assert.doesNotThrow(() => assertPlanProvider(plan, undefined));
  assert.doesNotThrow(() => assertPlanProvider(plan, 'claude'));
  assert.throws(() => assertPlanProvider(plan, 'openai'), code('RUN_PROVIDER_MISMATCH'));
  assert.equal(planDigest(JSON.parse(JSON.stringify(plan)) as RunPlan), result.digest);
});

test('invalid model errors do not echo arbitrary override values', () => {
  const secret = 'fake-secret-in-wrong-field';
  assert.throws(() => build({ env: { MODEL_CLAUDE_SYNTHESIS: secret } }), error => {
    assert.ok(error instanceof LlmContractError);
    assert.equal(error.code, 'UNKNOWN_MODEL');
    assert.ok(!error.message.includes(secret));
    return true;
  });
});
