import { costCall } from './cost-ledger';
import type { PricingStatus } from './cost-ledger';
import { loadModelRegistry } from './model-registry';
import type { ModelRegistry } from './model-registry';
import type { ProviderName } from './providers';

export const BATCH_DISCOUNT = 0.5;

export interface CostBreakdown {
  provider: ProviderName;
  model: string;
  input_tokens: number;
  output_tokens: number;
  standard_cost_usd: number;
  batch_cost_usd: number;
  saving_usd: number;
  pricing_status: PricingStatus;
}

let registry: ModelRegistry | undefined;

export function calcCost(
  provider: ProviderName,
  model: string,
  inputTokens: number,
  outputTokens: number,
  isBatch = true
): CostBreakdown {
  registry ??= loadModelRegistry();
  const entry = costCall(registry, {
    callId: 'legacy-calc-cost',
    attemptId: 'legacy-calc-cost',
    stage: 'synthesis',
    provider,
    route: isBatch ? 'batch-api' : 'sync-api',
    model,
    usage: { in: inputTokens, out: outputTokens, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, source: 'reported' },
    at: new Date(),
  });
  const standardCost = entry.api_equivalent_usd ?? 0;
  const chargedCost = entry.estimated_charge_usd ?? 0;

  return {
    provider,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    standard_cost_usd: round4(standardCost),
    batch_cost_usd: round4(chargedCost),
    saving_usd: round4(standardCost - chargedCost),
    pricing_status: entry.pricing_status,
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(4)}`;
}
