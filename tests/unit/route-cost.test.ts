import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costCall, summariseLedger } from '../../src/cost-ledger';
import type { CallInput } from '../../src/cost-ledger';
import type { ModelRegistry } from '../../src/model-registry';

const AT = new Date('2026-10-21T12:00:00.000Z');
const M = 1_000_000;

const reg = {
  digest: 'unit-registry',
  tiers: {},
  localStages: {},
  models: {},
  pricing: {
    'gpt-5.6-terra': { inPer1M: 2, outPer1M: 12, verified: true },
    'gpt-5.6-luna': { inPer1M: 0.2, outPer1M: 1.2, verified: true },
    'claude-sonnet-5-5': { inPer1M: 2, outPer1M: 10, cachedInPer1M: 0.2, verified: true },
    'promo-ended': { inPer1M: 5, outPer1M: 30, introUntil: '2026-01-01', verified: true },
  },
} as ModelRegistry;

function call(over: Partial<CallInput> = {}): CallInput {
  return {
    callId: 'c1', attemptId: 'a1', stage: 'synthesis', provider: 'openai', route: 'sync-api',
    model: 'gpt-5.6-terra',
    usage: { in: M, out: M, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, source: 'reported' },
    at: AT, ...over,
  };
}

test('subscription charges 0 with a 14 equivalent', () => {
  const e = costCall(reg, call({ route: 'subscription-cli' }));
  assert.equal(e.estimated_charge_usd, 0);
  assert.equal(e.api_equivalent_usd, 14);
  assert.equal(e.saving_usd, 14);
});

test('batch synthesis plus standard repair sums to 8.4 charged', () => {
  const syn = costCall(reg, call({ callId: 's', route: 'batch-api' }));
  const rep = costCall(reg, call({ callId: 'r', stage: 'repair', model: 'gpt-5.6-luna' }));
  const summary = summariseLedger([syn, rep]);
  assert.ok(Math.abs((summary.estimated_charge_usd ?? 0) - 8.4) < 1e-9);
  assert.ok(Math.abs((summary.api_equivalent_usd ?? 0) - 15.4) < 1e-9);
  assert.equal(summary.pricing_status, 'priced');
});

test('cache read is priced; a cache write with no rate is partial and null', () => {
  const usage = { in: 0, out: 0, cacheRead: M, cacheWrite5m: 0, cacheWrite1h: 0, source: 'reported' as const };
  const read = costCall(reg, call({ provider: 'claude', model: 'claude-sonnet-5-5', usage }));
  assert.ok(Math.abs((read.estimated_charge_usd ?? 0) - 0.2) < 1e-9);
  const write = costCall(reg, call({
    provider: 'claude', model: 'claude-sonnet-5-5', usage: { ...usage, cacheRead: 0, cacheWrite5m: 10 },
  }));
  assert.equal(write.estimated_charge_usd, null);
  assert.equal(write.pricing_status, 'partial');
  assert.equal(write.warnings[0].code, 'UNPRICED_TOKEN_CATEGORY');
});

test('an ended promotion is review_due at the list rate', () => {
  const e = costCall(reg, call({ model: 'promo-ended' }));
  assert.equal(e.pricing_status, 'review_due');
  assert.equal(e.estimated_charge_usd, 35);
});

test('an unknown model is unpriced with null totals, and unknown usage is null', () => {
  const e = costCall(reg, call({ callId: 'm1', model: 'mystery' }));
  assert.equal(e.pricing_status, 'unpriced');
  assert.equal(e.estimated_charge_usd, null);
  const u = costCall(reg, call({ callId: 'u1', usage: { in: null, out: M, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, source: 'partial' } }));
  assert.equal(u.api_equivalent_usd, null);
  assert.equal(u.warnings[0].code, 'UNKNOWN_USAGE');
  assert.deepEqual(summariseLedger([e, u]).unpriced_call_ids, ['m1', 'u1']);
});
