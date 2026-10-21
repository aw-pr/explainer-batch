import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { LlmContractError } from './llm-contract';
import type { ProviderId, Route, Stage } from './llm-contract';

export interface ModelRow {
  id: string;
  provider: ProviderId;
  aliases?: string[];
  routes?: Route[];
  images?: boolean;
  pdf?: boolean;
}

export interface PriceRow {
  inPer1M: number;
  outPer1M: number;
  cachedInPer1M?: number;
  introInPer1M?: number;
  introOutPer1M?: number;
  introUntil?: string;
  verified?: boolean;
}

export interface ModelRegistry {
  digest: string;
  tiers: Record<string, Record<string, string>>;
  localStages: Record<string, Record<string, string>>;
  models: Record<string, ModelRow>;
  pricing: Record<string, PriceRow>;
}

export interface PriceStatus {
  status: 'priced' | 'unpriced' | 'review_due';
  code?: 'PRICE_REVIEW_DUE';
  inputPer1M?: number;
  outputPer1M?: number;
  cachedInputPer1M?: number;
}

const PROVIDERS: readonly ProviderId[] = ['claude', 'openai', 'gemini'];
const DEFAULT_ROOT = path.join(__dirname, '..');

type StageProfile = { alias: string } | { id: string } | null;

const COMPATIBILITY_PROFILE: Record<ProviderId, Record<Stage, StageProfile>> = {
  claude: {
    synthesis: { id: 'claude-opus-4-8' },
    repair: { alias: 'sonnet' },
    vision: { alias: 'sonnet' },
  },
  openai: {
    synthesis: { id: 'gpt-5.6-terra' },
    repair: { alias: 'mini' },
    vision: { alias: 'batch' },
  },
  gemini: {
    synthesis: null,
    repair: { alias: 'flash' },
    vision: { alias: 'flash' },
  },
};

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProvider(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value);
}

function readLayer(file: string, label: string, missingCode: 'REGISTRY_NOT_FOUND' | null): Json | null {
  if (!fs.existsSync(file)) {
    if (missingCode) throw new LlmContractError(missingCode, `${label} not found: ${file}`);
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!isRecord(parsed)) throw new Error('top level is not an object');
    return parsed;
  } catch (error) {
    throw new LlmContractError('REGISTRY_INVALID', `${label} is not valid registry JSON: ${(error as Error).message}`);
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function mergeLayer(reg: Omit<ModelRegistry, 'digest'>, layer: Json, label: string, isLocal: boolean): void {
  for (const provider of PROVIDERS) {
    const tierObject = layer[provider];
    if (!isRecord(tierObject)) continue;
    for (const [alias, value] of Object.entries(tierObject)) {
      if (typeof value !== 'string') continue;
      (reg.tiers[provider] ??= {})[alias] = value;
      if (!isLocal) reg.models[value] ??= { id: value, provider };
    }
  }

  if (isRecord(layer.models)) {
    for (const [id, row] of Object.entries(layer.models)) {
      if (!isRecord(row) || !isProvider(row.provider)) {
        throw new LlmContractError('REGISTRY_INVALID', `${label}: model "${id}" names an unknown provider.`);
      }
      reg.models[id] = { ...reg.models[id], ...(row as Omit<ModelRow, 'id'>), id };
    }
  }

  if (isRecord(layer.pricing)) {
    for (const [id, row] of Object.entries(layer.pricing)) {
      if (id.startsWith('_') || !isRecord(row)) continue;
      for (const field of ['inPer1M', 'outPer1M'] as const) {
        const rate = row[field];
        if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) {
          throw new LlmContractError('REGISTRY_INVALID', `${label}: price row "${id}" needs a non-negative ${field}.`);
        }
      }
      reg.pricing[id] = row as unknown as PriceRow;
    }
  }

  if (isLocal && isRecord(layer.tiers)) {
    for (const [provider, stages] of Object.entries(layer.tiers)) {
      if (!isProvider(provider) || !isRecord(stages)) {
        throw new LlmContractError('REGISTRY_INVALID', `${label}: tiers.${provider} is not a provider stage map.`);
      }
      for (const [stage, id] of Object.entries(stages)) {
        if (typeof id !== 'string') {
          throw new LlmContractError('REGISTRY_INVALID', `${label}: tiers.${provider}.${stage} must be a model id.`);
        }
        (reg.localStages[provider] ??= {})[stage] = id;
      }
    }
  }
}

function assertAliasesUnique(models: Record<string, ModelRow>): void {
  const owners = new Map<string, string>();
  for (const row of Object.values(models)) owners.set(row.id, row.id);
  for (const row of Object.values(models)) {
    for (const alias of row.aliases ?? []) {
      const owner = owners.get(alias);
      if (owner !== undefined && owner !== row.id) {
        throw new LlmContractError('REGISTRY_INVALID', `Alias "${alias}" of "${row.id}" collides with "${owner}".`);
      }
      owners.set(alias, row.id);
    }
  }
}

export function loadModelRegistry(opts: { env?: Record<string, string | undefined>; repoRoot?: string } = {}): ModelRegistry {
  const env = opts.env ?? process.env;
  const root = opts.repoRoot ?? DEFAULT_ROOT;
  const resolveFile = (value: string) => path.resolve(root, value);
  const fleetPath = env.MCP_MODEL_REGISTRY ? resolveFile(env.MCP_MODEL_REGISTRY) : null;
  const explicitPath = env.EXPLAINER_MODEL_REGISTRY ? resolveFile(env.EXPLAINER_MODEL_REGISTRY) : null;

  const snapshot = readLayer(path.join(root, 'config', 'models.snapshot.json'), 'Model snapshot', null);
  if (!snapshot && !fleetPath && !explicitPath) {
    throw new LlmContractError(
      'REGISTRY_UNAVAILABLE',
      'No config/models.snapshot.json and no MCP_MODEL_REGISTRY or EXPLAINER_MODEL_REGISTRY file.',
    );
  }

  const reg: Omit<ModelRegistry, 'digest'> = { tiers: {}, localStages: {}, models: {}, pricing: {} };
  if (snapshot) mergeLayer(reg, snapshot, 'Model snapshot', false);
  if (fleetPath) mergeLayer(reg, readLayer(fleetPath, 'MCP_MODEL_REGISTRY file', 'REGISTRY_NOT_FOUND')!, 'MCP_MODEL_REGISTRY file', false);
  const local = readLayer(path.join(root, 'config', 'models.json'), 'Local config/models.json', null);
  if (local) mergeLayer(reg, local, 'Local config/models.json', true);
  if (explicitPath) {
    mergeLayer(reg, readLayer(explicitPath, 'EXPLAINER_MODEL_REGISTRY file', 'REGISTRY_NOT_FOUND')!, 'EXPLAINER_MODEL_REGISTRY file', false);
  }

  assertAliasesUnique(reg.models);
  const digest = crypto.createHash('sha256').update(canonical(reg)).digest('hex');
  return { ...reg, digest };
}

export function lookupModel(reg: ModelRegistry, idOrAlias: string): ModelRow {
  const exact = Object.hasOwn(reg.models, idOrAlias) ? reg.models[idOrAlias] : undefined;
  if (exact) return exact;
  const aliased = Object.values(reg.models).find(row => row.aliases?.includes(idOrAlias));
  if (aliased) return aliased;
  throw new LlmContractError('UNKNOWN_MODEL', `Model "${idOrAlias}" is not in the model registry.`);
}

export function modelProvider(reg: ModelRegistry, id: string): ProviderId {
  return lookupModel(reg, id).provider;
}

export function resolveStageModel(
  reg: ModelRegistry,
  provider: ProviderId,
  stage: Stage,
  opts: { env?: Record<string, string | undefined> } = {},
): { model: string; source: 'env' | 'local' | 'profile' } {
  const env = opts.env ?? process.env;
  const envKey = `MODEL_${provider.toUpperCase()}_${stage.toUpperCase()}`;
  let requested: string | undefined;
  let source: 'env' | 'local' | 'profile';

  if (env[envKey]) {
    requested = env[envKey];
    source = 'env';
  } else if (reg.localStages[provider]?.[stage]) {
    requested = reg.localStages[provider][stage];
    source = 'local';
  } else {
    source = 'profile';
    const entry = COMPATIBILITY_PROFILE[provider][stage];
    if (!entry) {
      throw new LlmContractError(
        'UNKNOWN_MODEL',
        `${provider} has no default ${stage} model; set ${envKey}.`,
      );
    }
    requested = 'id' in entry ? entry.id : reg.tiers[provider]?.[entry.alias];
    if (!requested) {
      throw new LlmContractError('UNKNOWN_MODEL', `Tier alias ${provider}.${(entry as { alias: string }).alias} is not in the model registry.`);
    }
  }

  const row = lookupModel(reg, requested!);
  if (row.provider !== provider) {
    throw new LlmContractError(
      'MODEL_PROVIDER_MISMATCH',
      `Model "${row.id}" belongs to ${row.provider}, not ${provider}, for stage ${stage}.`,
    );
  }
  return { model: row.id, source };
}

export function priceFor(reg: ModelRegistry, id: string, now: Date): PriceStatus {
  const row = Object.hasOwn(reg.pricing, id) ? reg.pricing[id] : undefined;
  if (!row) return { status: 'unpriced' };
  const promotionEnded = row.introUntil !== undefined && new Date(row.introUntil).getTime() < now.getTime();
  const reviewDue = row.verified === false || promotionEnded;
  return {
    status: reviewDue ? 'review_due' : 'priced',
    ...(reviewDue ? { code: 'PRICE_REVIEW_DUE' as const } : {}),
    inputPer1M: row.inPer1M,
    outputPer1M: row.outPer1M,
    ...(row.cachedInPer1M !== undefined ? { cachedInputPer1M: row.cachedInPer1M } : {}),
  };
}
