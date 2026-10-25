import { createHash } from 'node:crypto';
import { LlmContractError } from './llm-contract';
import type { ProviderId, Route, RunPlan, SchemaRef, Stage, StageBinding } from './llm-contract';
import { lookupModel, resolveStageModel } from './model-registry';
import type { ModelRegistry } from './model-registry';
import { parseRoutePreference, resolveCredentialBinding } from './routes';
import type { CredentialBinding, CredentialInventory, CredentialKind } from './routes';

type Environment = Readonly<Record<string, string | undefined>>;
type PolicySource = 'default' | 'ROUTE_PREFERENCE' | 'route-flag' | 'sync-flag';
type SkippedRoute = { route: Route; reason: 'MODEL_ROUTE_UNSUPPORTED' | 'MISSING_ROUTE_CREDENTIAL' };

export interface RunPlanDecision {
  provider: ProviderId;
  route: Route;
  credentialKind: CredentialKind;
  models: { synthesis: string; repair: string; vision: string | null };
  policySource: PolicySource;
  skipped: SkippedRoute[];
}

export interface BuildRunPlanOptions {
  provider: string;
  env: Environment;
  cli?: { route?: Route; sync?: boolean };
  inventory: CredentialInventory;
  registry: ModelRegistry;
  schema: SchemaRef;
  figures?: 'required' | 'optional' | 'none';
}

function providerId(value: string): ProviderId {
  if (value === 'gemini') throw new LlmContractError('PROVIDER_DISABLED', 'Gemini routes are not enabled.');
  if (value !== 'claude' && value !== 'openai') {
    throw new LlmContractError('UNKNOWN_PROVIDER', 'Provider is not recognised.');
  }
  return value;
}

function canonicalRoute(value: string): Route {
  if (value !== 'batch-api' && value !== 'subscription-cli' && value !== 'sync-api') {
    throw new LlmContractError('INVALID_ROUTE_PREFERENCE', 'A pinned route must be batch-api, subscription-cli or sync-api.');
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter(key => record[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function deepFreeze<T extends object>(value: T): T {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') deepFreeze(child);
  }
  return Object.freeze(value);
}

function validateModel(registry: ModelRegistry, provider: ProviderId, requested: string, stage: Stage): string {
  try {
    const row = lookupModel(registry, requested);
    if (row.provider !== provider) {
      throw new LlmContractError('MODEL_PROVIDER_MISMATCH', 'Model belongs to another provider.');
    }
    return row.id;
  } catch (error) {
    if (!(error instanceof LlmContractError)) throw error;
    throw new LlmContractError(error.code, `Invalid ${stage} model for the selected provider.`);
  }
}

function stageModel(
  registry: ModelRegistry, provider: ProviderId, stage: Stage, env: Environment,
  legacyKeys: string[], warnings: Set<string>,
): string {
  const key = `MODEL_${provider.toUpperCase()}_${stage.toUpperCase()}`;
  const legacyKey = legacyKeys.find(name => Boolean(env[name]));
  for (const name of legacyKeys) {
    if (env[name] !== undefined && name !== legacyKey) {
      warnings.add(`${name} is ignored because another legacy ${stage} override takes precedence.`);
    }
  }
  let translated: string | undefined;
  if (legacyKey) {
    translated = validateModel(registry, provider, env[legacyKey]!, stage);
    warnings.add(`${legacyKey} is deprecated; use ${key}.`);
    if (env[key] && validateModel(registry, provider, env[key]!, stage) !== translated) {
      throw new LlmContractError('CONFLICTING_MODEL_OVERRIDE', `Legacy and provider-scoped ${stage} overrides disagree.`);
    }
  }
  try {
    return resolveStageModel(registry, provider, stage, {
      env: translated ? { ...env, [key]: env[key] || translated } : env,
    }).model;
  } catch (error) {
    if (!(error instanceof LlmContractError)) throw error;
    throw new LlmContractError(error.code, `Invalid ${stage} model for the selected provider.`);
  }
}

function supportsRoute(registry: ModelRegistry, model: string, route: Route): boolean {
  const routes = lookupModel(registry, model).routes;
  return !routes?.length || routes.includes(route);
}

function credentialAbsent(provider: ProviderId, route: Route, inventory: CredentialInventory): boolean {
  if (provider === 'openai' && route === 'subscription-cli') {
    return (inventory.codexAuth === undefined || inventory.codexAuth === 'missing')
      && inventory.kinds['codex-chatgpt-login'] !== 'wrong-kind';
  }
  const kind = provider === 'claude'
    ? route === 'subscription-cli' ? 'claude-oauth-token' : 'anthropic-api-key'
    : 'openai-api-key';
  return inventory.kinds[kind] === undefined;
}

function selectRoute(
  provider: ProviderId, candidates: Route[], pinned: boolean, inventory: CredentialInventory,
  registry: ModelRegistry, modelFor: (route: Route) => string,
): { binding: CredentialBinding; model: string; skipped: SkippedRoute[] } {
  const skipped: SkippedRoute[] = [];
  for (const route of candidates) {
    const model = modelFor(route);
    if (!supportsRoute(registry, model, route)) {
      if (pinned) throw new LlmContractError('MODEL_ROUTE_UNSUPPORTED', 'Selected model does not support the pinned route.');
      skipped.push({ route, reason: 'MODEL_ROUTE_UNSUPPORTED' });
      continue;
    }
    if (!pinned && credentialAbsent(provider, route, inventory)) {
      skipped.push({ route, reason: 'MISSING_ROUTE_CREDENTIAL' });
      continue;
    }
    return { binding: resolveCredentialBinding(provider, route, inventory), model, skipped };
  }
  throw new LlmContractError('NO_USABLE_ROUTE', 'No declared route has a supported model and available credential.');
}

export function buildRunPlan(opts: BuildRunPlanOptions): {
  plan: RunPlan; digest: string; decision: RunPlanDecision; warnings: string[];
} {
  const { env, inventory, registry } = opts;
  const provider = providerId(opts.provider);
  const cli = opts.cli ?? {};
  const warnings = new Set<string>();
  if (cli.route !== undefined && cli.sync) {
    throw new LlmContractError('CONFLICTING_ROUTE_FLAGS', '--route and --sync cannot be combined.');
  }
  let policySource: PolicySource;
  let candidates: Route[];
  if (cli.route !== undefined) {
    policySource = 'route-flag';
    candidates = [canonicalRoute(cli.route)];
  } else if (cli.sync) {
    policySource = 'sync-flag';
    if (provider === 'claude' && inventory.kinds['anthropic-api-key'] && inventory.kinds['claude-oauth-token']) {
      throw new LlmContractError('MIXED_BILLING_CREDENTIALS', 'Legacy Claude --sync refuses simultaneous API and OAuth credentials.');
    }
    const route = provider === 'openai' && inventory.kinds['openai-api-key'] !== undefined
      ? 'sync-api' : 'subscription-cli';
    candidates = [route];
    warnings.add(`--sync is deprecated; use --route ${route}.`);
  } else {
    policySource = env.ROUTE_PREFERENCE === undefined ? 'default' : 'ROUTE_PREFERENCE';
    candidates = parseRoutePreference(env.ROUTE_PREFERENCE);
  }
  const synthesis = selectRoute(provider, candidates, policySource.endsWith('-flag'), inventory, registry,
    route => {
      const legacyKeys = provider === 'claude' && route === 'batch-api'
        ? ['MODEL_BATCH', 'MODEL'] : ['MODEL_SYNTHESIS'];
      for (const name of ['MODEL', 'MODEL_BATCH', 'MODEL_SYNTHESIS']) {
        if (env[name] !== undefined && !legacyKeys.includes(name)) {
          warnings.add(`${name} is ignored for ${provider} synthesis on ${route}; use MODEL_${provider.toUpperCase()}_SYNTHESIS.`);
        }
      }
      return stageModel(registry, provider, 'synthesis', env, legacyKeys, warnings);
    });

  const rawAttempts = env.MAX_REPAIR_ATTEMPTS;
  const maxRepairAttempts = rawAttempts === undefined ? 2 : Number(rawAttempts);
  if ((rawAttempts !== undefined && !/^\d+$/.test(rawAttempts))
    || !Number.isSafeInteger(maxRepairAttempts) || maxRepairAttempts < 0) {
    throw new Error('MAX_REPAIR_ATTEMPTS must be a non-negative safe integer.');
  }
  const repairRoute = env.REPAIR_ROUTE === undefined
    ? synthesis.binding.route === 'subscription-cli' ? 'subscription-cli' : 'sync-api'
    : canonicalRoute(env.REPAIR_ROUTE);
  if (repairRoute === 'batch-api') {
    throw new LlmContractError('ROUTE_UNSUPPORTED', 'Repair requires an immediate route.');
  }
  const repairModel = stageModel(registry, provider, 'repair', env, [], warnings);
  if (!supportsRoute(registry, repairModel, repairRoute)) {
    throw new LlmContractError('MODEL_ROUTE_UNSUPPORTED', 'Repair model does not support its route.');
  }
  if (maxRepairAttempts > 0) resolveCredentialBinding(provider, repairRoute, inventory);

  if (env.FIGURE_VLM_PROVIDER !== undefined) {
    warnings.add('FIGURE_VLM_PROVIDER is deprecated; use VISION_PROVIDER.');
    if (env.VISION_PROVIDER !== undefined && env.VISION_PROVIDER !== env.FIGURE_VLM_PROVIDER) {
      throw new LlmContractError('CONFLICTING_MODEL_OVERRIDE', 'Legacy and explicit vision providers disagree.');
    }
  }
  const visionProvider = providerId(env.VISION_PROVIDER ?? env.FIGURE_VLM_PROVIDER ?? provider);
  const visionCandidates = env.VISION_ROUTE !== undefined
    ? [canonicalRoute(env.VISION_ROUTE)]
    : parseRoutePreference(env.VISION_ROUTE_PREFERENCE ?? 'subscription,api');
  const visionModel = stageModel(registry, visionProvider, 'vision', env, ['FIGURE_VLM_MODEL'], warnings);
  for (const name of ['FIGURE_VLM_VERIFY_MODEL', 'FIGURE_DATA_MODEL']) {
    if (env[name]) {
      validateModel(registry, visionProvider, env[name]!, 'vision');
      warnings.add(`${name} is deprecated; its provider membership was validated for vision.`);
    }
  }
  let vision: StageBinding | null = null;
  let visionDisabledReason: string | undefined;
  const figures = opts.figures ?? 'optional';
  if (figures === 'none') {
    visionDisabledReason = 'Figures are disabled by the run policy.';
  } else {
    try {
      const selected = selectRoute(visionProvider, visionCandidates, env.VISION_ROUTE !== undefined,
        inventory, registry, () => visionModel);
      vision = { provider: visionProvider, route: selected.binding.route, model: selected.model, maxOutputTokens: 8192 };
    } catch (error) {
      const unavailable = error instanceof LlmContractError && (
        error.code === 'NO_USABLE_ROUTE' || error.code === 'MODEL_ROUTE_UNSUPPORTED'
        || (credentialAbsent(visionProvider, visionCandidates[0], inventory)
          && (error.code === 'MISSING_ROUTE_CREDENTIAL' || error.code === 'CODEX_AUTH_NOT_SUBSCRIPTION')));
      if (figures === 'required' || !unavailable) throw error;
      visionDisabledReason = (error as LlmContractError).code;
    }
  }

  const plan: RunPlan = deepFreeze({
    version: 1, strategy: 'single-pass', provider, route: synthesis.binding.route,
    tiers: {
      synthesis: { provider, route: synthesis.binding.route, model: synthesis.model, maxOutputTokens: provider === 'claude' ? 16384 : 8192 },
      repair: { provider, route: repairRoute, model: repairModel, maxOutputTokens: 8192 },
      vision,
    },
    ...(visionDisabledReason ? { visionDisabledReason } : {}),
    schema: { ...opts.schema }, registryDigest: registry.digest,
    policyDigest: digest({
      version: 1, provider, policySource, candidates, repairRoute, maxRepairAttempts,
      visionProvider, visionCandidates, visionPinned: env.VISION_ROUTE !== undefined, figures,
    }),
    maxRepairAttempts, concurrency: 1,
    callTimeoutMs: { synthesis: 600000, repair: 300000, vision: 180000 },
    activeWallClockLimitMs: 7200000,
  });
  return {
    plan, digest: planDigest(plan), warnings: [...warnings],
    decision: {
      provider, route: plan.route, credentialKind: synthesis.binding.credentialKind,
      models: { synthesis: synthesis.model, repair: repairModel, vision: vision?.model ?? null },
      policySource, skipped: synthesis.skipped,
    },
  };
}

export function planDigest(plan: RunPlan): string {
  return digest(plan);
}

export function assertPlanProvider(plan: RunPlan, explicitProvider: string | undefined): void {
  if (explicitProvider !== undefined && explicitProvider !== plan.provider) {
    throw new LlmContractError('RUN_PROVIDER_MISMATCH', 'Explicit provider differs from the stored run plan.');
  }
}
