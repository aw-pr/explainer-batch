import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadModelRegistry, lookupModel, priceFor, resolveStageModel } from '../../src/model-registry';

const NOW = new Date('2026-10-21T12:00:00Z');
const SNAPSHOT = path.join(__dirname, '..', '..', 'config', 'models.snapshot.json');

function makeRoot(local?: unknown): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-registry-unit-'));
  fs.mkdirSync(path.join(root, 'config'));
  fs.copyFileSync(SNAPSHOT, path.join(root, 'config', 'models.snapshot.json'));
  if (local !== undefined) fs.writeFileSync(path.join(root, 'config', 'models.json'), JSON.stringify(local));
  return root;
}

function code(fn: () => unknown): string | undefined {
  try { fn(); } catch (error) { return (error as { code?: string }).code; }
  return undefined;
}

test('local stage selection beats the profile and env beats local', () => {
  const reg = loadModelRegistry({ env: {}, repoRoot: makeRoot({ tiers: { claude: { repair: 'claude-haiku-4-5-20251001' } } }) });
  assert.deepEqual(resolveStageModel(reg, 'claude', 'repair', { env: {} }), { model: 'claude-haiku-4-5-20251001', source: 'local' });
  assert.equal(resolveStageModel(reg, 'claude', 'repair', { env: { MODEL_CLAUDE_REPAIR: 'claude-opus-5-5' } }).source, 'env');
  assert.equal(resolveStageModel(reg, 'claude', 'vision', { env: {} }).source, 'profile');
});

test('an explicit registry that is missing or unparseable is a named error', () => {
  const root = makeRoot();
  const broken = path.join(root, 'broken.json');
  fs.writeFileSync(broken, '{');
  assert.equal(code(() => loadModelRegistry({ env: { EXPLAINER_MODEL_REGISTRY: path.join(root, 'nope.json') }, repoRoot: root })), 'REGISTRY_NOT_FOUND');
  assert.equal(code(() => loadModelRegistry({ env: { EXPLAINER_MODEL_REGISTRY: broken }, repoRoot: root })), 'REGISTRY_INVALID');
});

test('structurally invalid layers are rejected', () => {
  const badProvider = makeRoot({ models: { x: { provider: 'nobody' } } });
  assert.equal(code(() => loadModelRegistry({ env: {}, repoRoot: badProvider })), 'REGISTRY_INVALID');
  const badPrice = makeRoot({ pricing: { x: { inPer1M: -1, outPer1M: 1 } } });
  assert.equal(code(() => loadModelRegistry({ env: {}, repoRoot: badPrice })), 'REGISTRY_INVALID');
  const clash = makeRoot({ models: { 'a-model': { provider: 'openai', aliases: ['claude-sonnet-5-5'] } } });
  assert.equal(code(() => loadModelRegistry({ env: {}, repoRoot: clash })), 'REGISTRY_INVALID');
});

test('a gemini synthesis lookup without an explicit model names the env knob', () => {
  const reg = loadModelRegistry({ env: {}, repoRoot: makeRoot() });
  assert.throws(() => resolveStageModel(reg, 'gemini', 'synthesis', { env: {} }), /MODEL_GEMINI_SYNTHESIS/);
  assert.equal(resolveStageModel(reg, 'gemini', 'repair', { env: {} }).model, 'gemini-2.5-flash');
});

test('prices: missing is unpriced, unverified and expired promotions need review', () => {
  const reg = loadModelRegistry({ env: {}, repoRoot: makeRoot({
    models: { custom: { provider: 'openai' } },
    pricing: {
      unverified: { inPer1M: 1, outPer1M: 2, verified: false },
      expired: { inPer1M: 1, outPer1M: 2, introUntil: '2026-01-01' },
    },
  }) });
  assert.equal(priceFor(reg, 'custom', NOW).status, 'unpriced');
  assert.equal(priceFor(reg, 'unverified', NOW).code, 'PRICE_REVIEW_DUE');
  assert.equal(priceFor(reg, 'expired', NOW).status, 'review_due');
  assert.equal(priceFor(reg, 'claude-opus-4-8', NOW).status, 'priced');
  assert.equal(code(() => lookupModel(reg, 'ghost')), 'UNKNOWN_MODEL');
});
