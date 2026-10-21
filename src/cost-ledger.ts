import { LlmContractError } from './llm-contract';
import type { ProviderId, Route, Stage, TokenUsage } from './llm-contract';
import { priceFor } from './model-registry';
import type { ModelRegistry, PriceRow } from './model-registry';

export type PricingStatus = 'priced' | 'review_due' | 'partial' | 'unpriced';
export type CostWarningCode =
  | 'UNPRICED_MODEL'
  | 'UNPRICED_TOKEN_CATEGORY'
  | 'UNKNOWN_USAGE'
  | 'PRICE_REVIEW_DUE';
export type TokenCategory = 'in' | 'out' | 'cacheRead' | 'cacheWrite5m' | 'cacheWrite1h';

export interface CostWarning {
  code: CostWarningCode;
  call_id: string;
  model: string;
  route: Route;
  registry_digest: string;
  category?: TokenCategory;
  message: string;
}

export interface CallInput {
  callId: string;
  attemptId: string;
  stage: Stage;
  provider: ProviderId;
  route: Route;
  model: string;
  usage: TokenUsage;
  at: Date;
}

export interface LedgerEntry {
  call_id: string;
  attempt_id: string;
  stage: Stage;
  provider: ProviderId;
  route: Route;
  model: string;
  usage: TokenUsage;
  price_snapshot_digest: string;
  pricing_timestamp: string;
  price_row: PriceRow | null;
  pricing_status: PricingStatus;
  estimated_charge_usd: number | null;
  api_equivalent_usd: number | null;
  saving_usd: number | null;
  warnings: CostWarning[];
}

export interface CostSummary {
  estimated_charge_usd: number | null;
  api_equivalent_usd: number | null;
  saving_usd: number | null;
  known_charge_usd: number;
  pricing_status: PricingStatus;
  unpriced_call_ids: string[];
}

export const BATCH_RATE_FACTORS: Partial<Record<ProviderId, number>> = { claude: 0.5, openai: 0.5 };

const CATEGORIES: readonly TokenCategory[] = ['in', 'out', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h'];

const STANDARD_RATE_FIELD: Record<TokenCategory, string> = {
  in: 'inPer1M',
  out: 'outPer1M',
  cacheRead: 'cachedInPer1M',
  cacheWrite5m: 'cacheWrite5mPer1M',
  cacheWrite1h: 'cacheWrite1hPer1M',
};

const BATCH_RATE_FIELD: Record<TokenCategory, string> = {
  in: 'batchInPer1M',
  out: 'batchOutPer1M',
  cacheRead: 'batchCachedInPer1M',
  cacheWrite5m: 'batchCacheWrite5mPer1M',
  cacheWrite1h: 'batchCacheWrite1hPer1M',
};

const STATUS_RANK: Record<PricingStatus, number> = { priced: 0, review_due: 1, partial: 2, unpriced: 3 };

function rateField(row: PriceRow, field: string): number | undefined {
  const value = (row as unknown as Record<string, unknown>)[field];
  return typeof value === 'number' ? value : undefined;
}

function standardRate(row: PriceRow, category: TokenCategory): number | undefined {
  return rateField(row, STANDARD_RATE_FIELD[category]);
}

function batchRate(row: PriceRow, provider: ProviderId, category: TokenCategory): number | undefined {
  const explicit = rateField(row, BATCH_RATE_FIELD[category]);
  if (explicit !== undefined) return explicit;
  const factor = BATCH_RATE_FACTORS[provider];
  if ((category === 'in' || category === 'out') && factor !== undefined) {
    const standard = standardRate(row, category);
    return standard === undefined ? undefined : standard * factor;
  }
  return undefined;
}

export function costCall(reg: ModelRegistry, call: CallInput): LedgerEntry {
  const { route, model } = call;
  const row = Object.hasOwn(reg.pricing, model) ? reg.pricing[model] : null;
  const warnings: CostWarning[] = [];
  const warn = (code: CostWarningCode, message: string, category?: TokenCategory): void => {
    if (warnings.some((w) => w.code === code && w.category === category)) return;
    warnings.push({
      code, call_id: call.callId, model, route, registry_digest: reg.digest,
      ...(category !== undefined ? { category } : {}), message,
    });
  };
  const entry = (
    status: PricingStatus,
    charge: number | null,
    equivalent: number | null,
  ): LedgerEntry => ({
    call_id: call.callId,
    attempt_id: call.attemptId,
    stage: call.stage,
    provider: call.provider,
    route,
    model,
    usage: call.usage,
    price_snapshot_digest: reg.digest,
    pricing_timestamp: call.at.toISOString(),
    price_row: row ? { ...row } : null,
    pricing_status: status,
    estimated_charge_usd: charge,
    api_equivalent_usd: equivalent,
    saving_usd: charge !== null && equivalent !== null ? equivalent - charge : null,
    warnings,
  });

  if (!row) {
    warn('UNPRICED_MODEL', `No price row for model ${model}.`);
    return entry('unpriced', route === 'subscription-cli' ? 0 : null, null);
  }

  let standardMicros: number | null = 0;
  let batchMicros: number | null = 0;
  for (const category of CATEGORIES) {
    const tokens = call.usage[category];
    if (tokens === 0) continue;
    if (tokens === null) {
      standardMicros = null;
      batchMicros = null;
      warn('UNKNOWN_USAGE', `Token count for ${category} is unknown.`, category);
      continue;
    }
    const standard = standardRate(row, category);
    if (standard === undefined) {
      standardMicros = null;
      warn('UNPRICED_TOKEN_CATEGORY', `No standard rate for ${category} on ${model}.`, category);
    } else if (standardMicros !== null) {
      standardMicros += tokens * standard;
    }
    if (route === 'batch-api') {
      const batch = batchRate(row, call.provider, category);
      if (batch === undefined) {
        batchMicros = null;
        warn('UNPRICED_TOKEN_CATEGORY', `No batch rate for ${category} on ${model}.`, category);
      } else if (batchMicros !== null) {
        batchMicros += tokens * batch;
      }
    }
  }

  const equivalent = standardMicros === null ? null : standardMicros / 1_000_000;
  const batchSum = batchMicros === null ? null : batchMicros / 1_000_000;
  const charge = route === 'subscription-cli' ? 0 : route === 'batch-api' ? batchSum : equivalent;

  const price = priceFor(reg, model, call.at);
  if (price.status === 'review_due') {
    warn('PRICE_REVIEW_DUE', `Price row for ${model} needs review; the list rate is used.`);
  }

  const hasGap = warnings.some((w) => w.code === 'UNKNOWN_USAGE' || w.code === 'UNPRICED_TOKEN_CATEGORY');
  const status: PricingStatus = hasGap ? 'partial' : price.status === 'review_due' ? 'review_due' : 'priced';
  return entry(status, charge, equivalent);
}

function sumOrNull(values: Array<number | null>): number | null {
  let total = 0;
  for (const value of values) {
    if (value === null) return null;
    total += value;
  }
  return total;
}

export function summariseLedger(entries: LedgerEntry[]): CostSummary {
  const seen = new Map<string, string>();
  const unique: LedgerEntry[] = [];
  for (const e of entries) {
    const content = JSON.stringify(e);
    const prior = seen.get(e.call_id);
    if (prior === undefined) {
      seen.set(e.call_id, content);
      unique.push(e);
    } else if (prior !== content) {
      throw new LlmContractError('RESULT_CONFLICT', `Ledger call ${e.call_id} repeats with different content.`);
    }
  }

  let status: PricingStatus = 'priced';
  const unpricedCallIds: string[] = [];
  let knownCharge = 0;
  for (const e of unique) {
    if (STATUS_RANK[e.pricing_status] > STATUS_RANK[status]) status = e.pricing_status;
    if (e.pricing_status === 'unpriced' || e.pricing_status === 'partial') unpricedCallIds.push(e.call_id);
    if (e.estimated_charge_usd !== null) knownCharge += e.estimated_charge_usd;
  }

  return {
    estimated_charge_usd: sumOrNull(unique.map((e) => e.estimated_charge_usd)),
    api_equivalent_usd: sumOrNull(unique.map((e) => e.api_equivalent_usd)),
    saving_usd: sumOrNull(unique.map((e) => e.saving_usd)),
    known_charge_usd: knownCharge,
    pricing_status: status,
    unpriced_call_ids: unpricedCallIds,
  };
}
