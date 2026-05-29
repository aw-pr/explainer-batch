/**
 * Offline smoke test for model configuration + pricing coverage.
 *
 * No API calls, no credentials, no cost. Run via `npm run smoke`.
 *
 * For each provider it asserts that:
 *   - every resolved tier (batch/lane/synthesis/repair) is a non-empty model id;
 *   - each resolved model has a pricing row, so a model bump that forgets to add
 *     a price row fails loudly here instead of silently reporting $0 cost.
 *
 * Exits non-zero on any failure so it can gate CI / a pre-push hook.
 */
import { getModelConfig } from '../src/model-config';
import { calcCost } from '../src/pricing';
import type { ProviderName } from '../src/providers';

const PROVIDERS: ProviderName[] = ['claude', 'openai'];

let failures = 0;

function check(ok: boolean, msg: string): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!ok) failures++;
}

for (const provider of PROVIDERS) {
  console.log(`\n[${provider}]`);
  const cfg = getModelConfig(provider);
  const tiers: Array<[string, string]> = [
    ['batch', cfg.batchModel],
    ['lane', cfg.laneModel],
    ['synthesis', cfg.synthesisModel],
    ['repair', cfg.repairModel],
  ];

  const priced = new Set<string>();
  for (const [tier, model] of tiers) {
    check(typeof model === 'string' && model.length > 0, `${tier} resolves to a model id (${model})`);
    if (!model || priced.has(model)) continue;
    priced.add(model);
    const cost = calcCost(provider, model, 1_000_000, 1_000_000);
    check(cost.standard_cost_usd > 0, `${model} has a pricing row ($${cost.standard_cost_usd} per 1M in + 1M out)`);
  }
}

console.log(
  failures === 0
    ? '\nPASS: every provider tier resolves and is priced.'
    : `\nFAIL: ${failures} problem(s) above.`
);
process.exit(failures === 0 ? 0 : 1);
