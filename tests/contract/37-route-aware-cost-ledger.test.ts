// Contract test for stage-cards/37-route-aware-cost-ledger.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/37-route-aware-cost-ledger.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/37-route-aware-cost-ledger.md
globalThis.fetch = (async () => {
  throw new Error('network access is forbidden in contract test 37');
}) as typeof fetch;
// The legacy wrapper reads the committed snapshot only, never a fleet or operator file.
delete process.env.MCP_MODEL_REGISTRY;
delete process.env.EXPLAINER_MODEL_REGISTRY;

const AT = new Date('2026-10-21T12:00:00.000Z');
const M = 1_000_000;
const EPS = 1e-9;

function ledger(): Record<string, any> {
  const file = path.join(REPO_ROOT, 'src', 'cost-ledger.ts');
  assert.ok(fs.existsSync(file), 'src/cost-ledger.ts must exist');
  return require('../../src/cost-ledger') as Record<string, any>;
}

function registry(): any {
  return {
    digest: 'contract-37-registry',
    tiers: {},
    localStages: {},
    models: {},
    pricing: {
      'gpt-5.6-terra': { inPer1M: 2, outPer1M: 12, verified: true },
      'gpt-5.6-luna': { inPer1M: 0.2, outPer1M: 1.2, verified: true },
      'claude-sonnet-5-5': { inPer1M: 2, outPer1M: 10, cachedInPer1M: 0.2, cacheWrite5mPer1M: 2.5, verified: true },
      'claude-opus-5-5': { inPer1M: 4, outPer1M: 20, batchInPer1M: 1, batchOutPer1M: 5, verified: true },
      'gemini-2.5-pro': { inPer1M: 1.25, outPer1M: 10, verified: true },
      'promo-ended': { inPer1M: 5, outPer1M: 30, introInPer1M: 4, introOutPer1M: 20, introUntil: '2026-01-01', verified: true },
      'promo-active': { inPer1M: 5, outPer1M: 30, introInPer1M: 4, introOutPer1M: 20, introUntil: '2027-01-01', verified: true },
    },
  };
}

function usage(over: Record<string, number | null> = {}): any {
  return { in: M, out: M, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, source: 'reported', ...over };
}

function call(over: Record<string, unknown> = {}): any {
  return {
    callId: 'call-1', attemptId: 'attempt-1', stage: 'synthesis', provider: 'openai',
    route: 'sync-api', model: 'gpt-5.6-terra', usage: usage(), at: AT, ...over,
  };
}

function near(actual: unknown, expected: number, label: string): void {
  assert.equal(typeof actual, 'number', `${label} must be a number, got ${JSON.stringify(actual)}`);
  assert.ok(Math.abs((actual as number) - expected) < EPS, `${label}: expected ${expected}, got ${actual}`);
}

function codes(entry: any): string[] {
  assert.ok(Array.isArray(entry.warnings), 'a ledger entry carries a warnings array');
  return entry.warnings.map((w: any) => w.code);
}

test('37: terra on each route prices the design fixture: batch 7, sync 14, subscription 0 with a 14 equivalent', () => {
  const { costCall } = ledger();
  const reg = registry();
  const batch = costCall(reg, call({ route: 'batch-api' }));
  near(batch.estimated_charge_usd, 7, 'batch estimated charge');
  near(batch.api_equivalent_usd, 14, 'batch API equivalent');
  near(batch.saving_usd, 7, 'batch saving');
  assert.equal(batch.pricing_status, 'priced');
  assert.deepEqual(codes(batch), []);

  const sync = costCall(reg, call({ route: 'sync-api' }));
  near(sync.estimated_charge_usd, 14, 'sync estimated charge');
  near(sync.api_equivalent_usd, 14, 'sync API equivalent');
  near(sync.saving_usd, 0, 'sync saving');

  const sub = costCall(reg, call({ route: 'subscription-cli' }));
  assert.equal(sub.estimated_charge_usd, 0, 'subscription incremental charge is exactly 0');
  near(sub.api_equivalent_usd, 14, 'subscription API equivalent');
  near(sub.saving_usd, 14, 'subscription saving');
  assert.equal(sub.pricing_status, 'priced');
});

test('37: a ledger entry records the call identity, the registry digest, the timestamp and a copy of the price row', () => {
  const { costCall } = ledger();
  const reg = registry();
  const entry = costCall(reg, call({ callId: 'c-9', attemptId: 'a-3', stage: 'repair', route: 'batch-api' }));
  assert.equal(entry.call_id, 'c-9');
  assert.equal(entry.attempt_id, 'a-3');
  assert.equal(entry.stage, 'repair');
  assert.equal(entry.provider, 'openai');
  assert.equal(entry.route, 'batch-api');
  assert.equal(entry.model, 'gpt-5.6-terra');
  assert.deepEqual(entry.usage, usage());
  assert.equal(entry.price_snapshot_digest, 'contract-37-registry');
  assert.equal(entry.pricing_timestamp, '2026-10-21T12:00:00.000Z');
  assert.deepEqual(entry.price_row, { inPer1M: 2, outPer1M: 12, verified: true });
  reg.pricing['gpt-5.6-terra'].inPer1M = 999;
  assert.equal(entry.price_row.inPer1M, 2, 'a later registry change must not reprice a recorded call');
  near(entry.estimated_charge_usd, 7, 'recorded charge after a registry change');
});

test('37: batch synthesis plus a standard-rate repair sums to 8.4 charged, 15.4 equivalent, 7 saved', () => {
  const { costCall, summariseLedger } = ledger();
  const reg = registry();
  const synthesis = costCall(reg, call({ callId: 'syn', route: 'batch-api' }));
  const repair = costCall(reg, call({ callId: 'rep', stage: 'repair', route: 'sync-api', model: 'gpt-5.6-luna' }));
  near(repair.estimated_charge_usd, 1.4, 'luna repair charge');
  near(repair.api_equivalent_usd, 1.4, 'luna repair equivalent');
  const summary = summariseLedger([synthesis, repair]);
  near(summary.estimated_charge_usd, 8.4, 'summary estimated charge');
  near(summary.api_equivalent_usd, 15.4, 'summary API equivalent');
  near(summary.saving_usd, 7, 'summary saving');
  near(summary.known_charge_usd, 8.4, 'summary known charge');
  assert.equal(summary.pricing_status, 'priced');
  assert.deepEqual(summary.unpriced_call_ids, []);
});

test('37: a failed repair or vision call with reported usage is still costed', () => {
  const { costCall } = ledger();
  const failed = {
    provider: 'openai', route: 'sync-api', stage: 'vision', model: 'gpt-5.6-luna',
    customId: 'cid', attemptId: 'att-f', finishReason: 'error',
    error: { code: 'HTTP_ERROR', message: 'upstream 500', retryable: true, httpStatus: 500 },
    usage: usage(),
  };
  const entry = costCall(registry(), { ...failed, callId: 'vision-1', at: AT });
  near(entry.estimated_charge_usd, 1.4, 'failed vision call charge');
  assert.equal(entry.stage, 'vision');
  assert.equal(entry.attempt_id, 'att-f');
});

test('37: explicit batch rates win over the provider factor, and a provider without a factor has no batch price', () => {
  const { costCall, BATCH_RATE_FACTORS } = ledger();
  assert.equal(BATCH_RATE_FACTORS.claude, 0.5);
  assert.equal(BATCH_RATE_FACTORS.openai, 0.5);
  assert.equal(BATCH_RATE_FACTORS.gemini, undefined, 'no verified Gemini batch factor yet');
  const reg = registry();
  const opus = costCall(reg, call({ provider: 'claude', model: 'claude-opus-5-5', route: 'batch-api' }));
  near(opus.estimated_charge_usd, 6, 'explicit batch rates 1 and 5');
  near(opus.api_equivalent_usd, 24, 'standard rates 4 and 20');

  const gemini = costCall(reg, call({ provider: 'gemini', model: 'gemini-2.5-pro', route: 'batch-api' }));
  assert.equal(gemini.estimated_charge_usd, null, 'no batch rate and no factor: charge unknown, not zero');
  near(gemini.api_equivalent_usd, 11.25, 'standard rates still give the equivalent');
  assert.equal(gemini.saving_usd, null);
  assert.equal(gemini.pricing_status, 'partial');
  assert.ok(codes(gemini).includes('UNPRICED_TOKEN_CATEGORY'));
});

test('37: cache tokens are priced per category, and a category with no rate nulls the affected totals', () => {
  const { costCall } = ledger();
  const reg = registry();
  const cached = costCall(reg, call({
    provider: 'claude', model: 'claude-sonnet-5-5', route: 'sync-api',
    usage: usage({ in: M, out: 0, cacheRead: M, cacheWrite5m: M, cacheWrite1h: 0 }),
  }));
  near(cached.api_equivalent_usd, 4.7, 'input 2 + cache read 0.2 + cache write 2.5');
  near(cached.estimated_charge_usd, 4.7, 'sync charge equals the equivalent');
  assert.equal(cached.pricing_status, 'priced');

  const hour = costCall(reg, call({
    callId: 'c-1h', provider: 'claude', model: 'claude-sonnet-5-5', route: 'sync-api',
    usage: usage({ cacheWrite1h: 1000 }),
  }));
  assert.equal(hour.api_equivalent_usd, null);
  assert.equal(hour.estimated_charge_usd, null);
  assert.equal(hour.pricing_status, 'partial');
  const warning = hour.warnings.find((w: any) => w.code === 'UNPRICED_TOKEN_CATEGORY');
  assert.ok(warning, JSON.stringify(hour.warnings));
  assert.equal(warning.category, 'cacheWrite1h');
  assert.equal(warning.model, 'claude-sonnet-5-5');
  assert.equal(warning.route, 'sync-api');
  assert.equal(warning.call_id, 'c-1h');
  assert.equal(warning.registry_digest, 'contract-37-registry');
  assert.ok(typeof warning.message === 'string' && warning.message.length > 0);

  const batchCache = costCall(reg, call({
    provider: 'claude', model: 'claude-sonnet-5-5', route: 'batch-api',
    usage: usage({ in: M, out: M, cacheRead: M }),
  }));
  assert.equal(batchCache.estimated_charge_usd, null, 'cache categories are never halved without an explicit batch rate');
  near(batchCache.api_equivalent_usd, 12.2, 'standard 2 + 10 + 0.2');
  assert.equal(batchCache.pricing_status, 'partial');
  assert.ok(codes(batchCache).includes('UNPRICED_TOKEN_CATEGORY'));

  const zeroCache = costCall(reg, call({ route: 'batch-api', usage: usage({ cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }) }));
  near(zeroCache.estimated_charge_usd, 7, 'a zero-token category needs no rate');
});

test('37: unknown usage is null, never zero', () => {
  const { costCall } = ledger();
  const reg = registry();
  const unknown = { in: null, out: null, cacheRead: null, cacheWrite5m: null, cacheWrite1h: null, source: 'unavailable' };
  const sync = costCall(reg, call({ usage: unknown }));
  assert.equal(sync.estimated_charge_usd, null);
  assert.equal(sync.api_equivalent_usd, null);
  assert.equal(sync.saving_usd, null);
  assert.equal(sync.pricing_status, 'partial');
  assert.ok(codes(sync).includes('UNKNOWN_USAGE'));

  const partialOut = costCall(reg, call({ usage: usage({ out: null }) }));
  assert.equal(partialOut.api_equivalent_usd, null, 'one unknown category nulls the total');

  const sub = costCall(reg, call({ route: 'subscription-cli', usage: unknown }));
  assert.equal(sub.estimated_charge_usd, 0, 'subscription charge stays 0 when usage is unknown');
  assert.equal(sub.api_equivalent_usd, null);
  assert.equal(sub.saving_usd, null);
});

test('37: an unpriced model warns UNPRICED_MODEL and is never priced at zero', () => {
  const { costCall, summariseLedger } = ledger();
  const reg = registry();
  const entry = costCall(reg, call({ callId: 'mystery', model: 'mystery-model' }));
  assert.equal(entry.pricing_status, 'unpriced');
  assert.equal(entry.estimated_charge_usd, null);
  assert.equal(entry.api_equivalent_usd, null);
  assert.equal(entry.price_row, null);
  assert.deepEqual(codes(entry), ['UNPRICED_MODEL']);

  const sub = costCall(reg, call({ callId: 'mystery-sub', model: 'mystery-model', route: 'subscription-cli' }));
  assert.equal(sub.estimated_charge_usd, 0);
  assert.equal(sub.api_equivalent_usd, null);
  assert.equal(sub.pricing_status, 'unpriced');

  const priced = costCall(reg, call({ callId: 'known', route: 'batch-api' }));
  const summary = summariseLedger([priced, entry, sub]);
  assert.equal(summary.estimated_charge_usd, null, 'one unknown charge makes the total unknown');
  assert.equal(summary.api_equivalent_usd, null);
  assert.equal(summary.saving_usd, null);
  near(summary.known_charge_usd, 7, 'known charge is the lower-bound subtotal');
  assert.equal(summary.pricing_status, 'unpriced');
  assert.deepEqual(summary.unpriced_call_ids, ['mystery', 'mystery-sub']);
});

test('37: a passed promotion date warns PRICE_REVIEW_DUE and keeps the list rate; an active one is priced at list', () => {
  const { costCall, summariseLedger } = ledger();
  const reg = registry();
  const ended = costCall(reg, call({ callId: 'p-end', model: 'promo-ended' }));
  assert.equal(ended.pricing_status, 'review_due');
  assert.ok(codes(ended).includes('PRICE_REVIEW_DUE'));
  near(ended.estimated_charge_usd, 35, 'list rates 5 and 30, not an inferred rise or the intro rate');
  near(ended.api_equivalent_usd, 35, 'review-due equivalent');

  const active = costCall(reg, call({ callId: 'p-on', model: 'promo-active' }));
  assert.equal(active.pricing_status, 'priced');
  assert.deepEqual(codes(active), []);
  near(active.estimated_charge_usd, 35, 'list rate, as the registry prices it');

  const summary = summariseLedger([active, ended]);
  assert.equal(summary.pricing_status, 'review_due');
  near(summary.estimated_charge_usd, 70, 'review-due calls still count');
  assert.deepEqual(summary.unpriced_call_ids, []);
});

test('37: the summary status ranks unpriced over partial over review_due over priced, and an empty ledger is zero', () => {
  const { costCall, summariseLedger } = ledger();
  const reg = registry();
  const partial = costCall(reg, call({ callId: 'part', usage: usage({ out: null }) }));
  const review = costCall(reg, call({ callId: 'rev', model: 'promo-ended' }));
  const summary = summariseLedger([review, partial]);
  assert.equal(summary.pricing_status, 'partial');
  assert.deepEqual(summary.unpriced_call_ids, ['part']);
  near(summary.known_charge_usd, 35, 'known charge skips the unknown call');

  const empty = summariseLedger([]);
  assert.equal(empty.estimated_charge_usd, 0);
  assert.equal(empty.api_equivalent_usd, 0);
  assert.equal(empty.saving_usd, 0);
  assert.equal(empty.known_charge_usd, 0);
  assert.equal(empty.pricing_status, 'priced');
  assert.deepEqual(empty.unpriced_call_ids, []);
});

test('37: usage is deduplicated by call id, and a contradictory duplicate is RESULT_CONFLICT', () => {
  const { costCall, summariseLedger } = ledger();
  const reg = registry();
  const a = costCall(reg, call({ callId: 'dup', route: 'batch-api' }));
  const again = costCall(reg, call({ callId: 'dup', route: 'batch-api' }));
  const summary = summariseLedger([a, again]);
  near(summary.estimated_charge_usd, 7, 'an identical re-collected call counts once');
  const other = costCall(reg, call({ callId: 'dup', route: 'sync-api' }));
  assert.throws(() => summariseLedger([a, other]), (err: any) => err?.code === 'RESULT_CONFLICT');
});

test('37: totals are unrounded', () => {
  const { costCall } = ledger();
  const tiny = costCall(registry(), call({ model: 'gpt-5.6-luna', usage: usage({ in: 1, out: 1 }) }));
  near(tiny.estimated_charge_usd, 0.0000014, 'one input and one output token');
  assert.notEqual(tiny.estimated_charge_usd, 0);
});

test('37: the ledger module is pure: no filesystem, process, network or provider imports', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'src', 'cost-ledger.ts'), 'utf8');
  const specifiers = [...src.matchAll(/(?:from\s+|require\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.ok(specifiers.length > 0, 'cost-ledger.ts imports its contract types');
  for (const s of specifiers) {
    assert.ok(['./llm-contract', './model-registry'].includes(s), `cost-ledger.ts may import only ./llm-contract and ./model-registry, found ${s}`);
  }
  assert.doesNotMatch(src, /process\.env|Date\.now\(\)|new Date\(\s*\)/, 'cost-ledger.ts takes the call time as input');
});

test('37: calcCost is a compatibility wrapper over the committed registry, with no copied price table', () => {
  const pricingSrc = fs.readFileSync(path.join(REPO_ROOT, 'src', 'pricing.ts'), 'utf8');
  assert.doesNotMatch(pricingSrc, /STANDARD_PRICES/, 'the copied price table is gone');
  assert.doesNotMatch(pricingSrc, /\b(?:input|output)\s*:\s*\d/, 'src/pricing.ts carries no literal per-model rates');
  assert.match(pricingSrc, /['"]\.\/(?:cost-ledger|model-registry)['"]/, 'src/pricing.ts reads rates through the ledger or the registry');

  const { calcCost, formatUsd, BATCH_DISCOUNT } = require('../../src/pricing') as Record<string, any>;
  assert.equal(BATCH_DISCOUNT, 0.5);
  assert.equal(formatUsd(1.23456), '$1.2346');
  const batch = calcCost('openai', 'gpt-5.6-terra', M, M);
  assert.equal(batch.provider, 'openai');
  assert.equal(batch.model, 'gpt-5.6-terra');
  assert.equal(batch.input_tokens, M);
  assert.equal(batch.output_tokens, M);
  near(batch.standard_cost_usd, 14, 'legacy standard cost');
  near(batch.batch_cost_usd, 7, 'legacy batch cost');
  near(batch.saving_usd, 7, 'legacy saving');
  assert.equal(batch.pricing_status, 'priced');
  const sync = calcCost('openai', 'gpt-5.6-terra', M, M, false);
  near(sync.batch_cost_usd, 14, 'legacy sync cost');
  near(sync.saving_usd, 0, 'legacy sync saving');
  const opus = calcCost('claude', 'claude-opus-4-8', M, M);
  near(opus.standard_cost_usd, 30, 'snapshot rates 5 and 25');
  const unknown = calcCost('claude', 'not-a-real-model', M, M);
  assert.equal(unknown.standard_cost_usd, 0, 'legacy callers keep a number');
  assert.equal(unknown.pricing_status, 'unpriced', 'but the zero is labelled unpriced');
});
// AUTOMETTA-CONTRACT-END
