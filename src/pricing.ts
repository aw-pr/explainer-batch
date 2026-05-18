import type { ProviderName } from './providers';

/** Standard (non-batch) prices in USD per million tokens. */
const STANDARD_PRICES: Record<ProviderName, Record<string, { input: number; output: number }>> = {
  claude: {
    'claude-opus-4-6': { input: 5.0, output: 25.0 },
    'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
    'claude-haiku-4-5': { input: 1.0, output: 5.0 },
    'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },
    'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
    'claude-opus-4-5': { input: 5.0, output: 25.0 },
    'claude-opus-4-1': { input: 15.0, output: 75.0 },
  },
  openai: {
    'gpt-5.4': { input: 10.0, output: 30.0 },
    'gpt-5.4-mini': { input: 2.0, output: 6.0 },
    'gpt-5-mini': { input: 0.5, output: 1.5 },
    'gpt-5.3-codex': { input: 4.0, output: 12.0 },
    'gpt-5.3-codex-mini': { input: 1.2, output: 3.6 },
  },
};

export const BATCH_DISCOUNT = 0.5;

export interface CostBreakdown {
  provider: ProviderName;
  model: string;
  input_tokens: number;
  output_tokens: number;
  standard_cost_usd: number;
  batch_cost_usd: number;
  saving_usd: number;
}

export function calcCost(
  provider: ProviderName,
  model: string,
  inputTokens: number,
  outputTokens: number,
  isBatch = true
): CostBreakdown {
  const price = STANDARD_PRICES[provider][model];

  if (!price) {
    return {
      provider,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      standard_cost_usd: 0,
      batch_cost_usd: 0,
      saving_usd: 0,
    };
  }

  const standardCost =
    (inputTokens / 1_000_000) * price.input +
    (outputTokens / 1_000_000) * price.output;

  const discount = isBatch ? BATCH_DISCOUNT : 0;
  const batchCost = standardCost * (1 - discount);
  const saving = standardCost - batchCost;

  return {
    provider,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    standard_cost_usd: round4(standardCost),
    batch_cost_usd: round4(batchCost),
    saving_usd: round4(saving),
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(4)}`;
}
