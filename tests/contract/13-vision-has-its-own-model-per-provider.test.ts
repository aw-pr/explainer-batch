// Contract test for stage-cards/13-vision-has-its-own-model-per-provider.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/13-vision-has-its-own-model-per-provider.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-13-'));
for (const dir of ['input', 'output', 'jobs']) fs.mkdirSync(path.join(TMP, dir));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/13-vision-has-its-own-model-per-provider.md
// Paths and credentials are pinned before src/ is loaded, so the fill-only
// .env loader cannot redirect anything or reach a real account.
const PINNED_ENV: Record<string, string> = {
  EXPLAINER_STATE_FILE: path.join(TMP, 'state.json'),
  EXPLAINER_INPUT_DIR: path.join(TMP, 'input'),
  EXPLAINER_OUTPUT_DIR: path.join(TMP, 'output'),
  EXPLAINER_OBSIDIAN_DIR: '',
  EXPLAINER_JOBS_DIR: path.join(TMP, 'jobs'),
  WEBSITE_REPO: '',
  CLAUDE_CODE_OAUTH_TOKEN: '',
  ANTHROPIC_API_KEY: 'contract-test-not-a-key',
  OPENAI_API_KEY: 'contract-test-not-a-key',
  FIGURE_VLM_ROUTE: 'api',
};
const VISION_KEYS = ['FIGURE_VLM_PROVIDER', 'FIGURE_VLM_MODEL', 'FIGURE_VLM_VERIFY_MODEL', 'FIGURE_DATA_MODEL', 'MODEL', 'MODEL_BATCH', 'MODEL_SYNTHESIS', 'PROVIDER'];
Object.assign(process.env, PINNED_ENV);
for (const key of VISION_KEYS) delete process.env[key];

globalThis.fetch = (async () => {
  throw new Error('network access is forbidden in contract test 13');
}) as typeof fetch;

const modelConfig = require('../../src/model-config') as Record<string, any>;
const figureVlm = require('../../src/figure-vlm') as typeof import('../../src/figure-vlm');
const figureData = require('../../src/figure-data') as typeof import('../../src/figure-data');

function withEnv<T>(vars: Record<string, string>, fn: () => T): T {
  for (const key of VISION_KEYS) delete process.env[key];
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const key of VISION_KEYS) delete process.env[key];
  }
}

function runCli(vars: Record<string, string>) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !VISION_KEYS.includes(k)) env[k] = v;
  Object.assign(env, PINNED_ENV, { TS_NODE_TRANSPILE_ONLY: '1' }, vars);
  const res = spawnSync(process.execPath, ['--require', 'ts-node/register', 'src/index.ts', 'poll', '--provider', 'openai'], {
    cwd: REPO_ROOT, env, encoding: 'utf8', timeout: 60_000,
  });
  return { status: res.status, out: `${res.stdout}\n${res.stderr}` };
}

test('each provider has its own vision model default, independent of MODEL_BATCH', () => {
  withEnv({ MODEL_BATCH: 'gpt-5.6-sol', MODEL: 'gpt-5.6-sol' }, () => {
    assert.equal(modelConfig.getModelConfig('claude').visionModel, 'claude-opus-4-8', 'Claude visionModel default');
  });
  withEnv({ MODEL_BATCH: 'claude-fable-5-1', MODEL: 'claude-fable-5-1' }, () => {
    assert.equal(modelConfig.getModelConfig('openai').visionModel, 'gpt-5.6-terra', 'OpenAI visionModel default');
  });
  const example = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'models.json.example'), 'utf8'));
  assert.equal(example.claude?.visionModel, 'claude-opus-4-8', 'models.json.example lacks claude.visionModel');
  assert.equal(example.openai?.visionModel, 'gpt-5.6-terra', 'models.json.example lacks openai.visionModel');
});

test('resolveVisionModel honours FIGURE_VLM_MODEL when it matches the provider', () => {
  assert.equal(typeof modelConfig.resolveVisionModel, 'function', 'model-config does not export resolveVisionModel');
  withEnv({ MODEL_BATCH: 'gpt-5.6-sol' }, () => {
    assert.equal(modelConfig.resolveVisionModel('claude'), 'claude-opus-4-8');
  });
  withEnv({ FIGURE_VLM_MODEL: 'gpt-5.6-sol' }, () => {
    assert.equal(modelConfig.resolveVisionModel('openai'), 'gpt-5.6-sol');
  });
  withEnv({ FIGURE_VLM_MODEL: 'claude-sonnet-5-5' }, () => {
    assert.equal(modelConfig.resolveVisionModel('claude'), 'claude-sonnet-5-5');
  });
});

test('resolveVisionModel rejects a model from the other provider, naming both', () => {
  assert.equal(typeof modelConfig.resolveVisionModel, 'function', 'model-config does not export resolveVisionModel');
  withEnv({ FIGURE_VLM_MODEL: 'claude-opus-4-8' }, () => {
    assert.throws(() => modelConfig.resolveVisionModel('openai'), (e: Error) => /claude-opus-4-8/.test(e.message) && /openai/i.test(e.message));
  });
  withEnv({ FIGURE_VLM_MODEL: 'gpt-5.6-terra' }, () => {
    assert.throws(() => modelConfig.resolveVisionModel('claude'), (e: Error) => /gpt-5\.6-terra/.test(e.message) && /claude/i.test(e.message));
  });
});

test('figure extraction surfaces a mismatch instead of returning null', async () => {
  for (const key of VISION_KEYS) delete process.env[key];
  Object.assign(process.env, { FIGURE_VLM_PROVIDER: 'openai', FIGURE_VLM_MODEL: 'claude-opus-4-8' });
  try {
    await assert.rejects(
      figureVlm.extractFigureViaVlm({ pdfPath: null, url: null } as any),
      (e: Error) => /claude-opus-4-8/.test(e.message) && /openai/i.test(e.message),
      'extractFigureViaVlm swallowed a provider/model mismatch',
    );
  } finally {
    for (const key of VISION_KEYS) delete process.env[key];
  }
});

test('figure-data recreation surfaces a mismatched FIGURE_DATA_MODEL', async () => {
  for (const key of VISION_KEYS) delete process.env[key];
  Object.assign(process.env, { FIGURE_VLM_PROVIDER: 'openai', FIGURE_DATA_MODEL: 'claude-opus-4-8' });
  const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
  try {
    await assert.rejects(
      figureData.recreateFigureData({ cropPngBase64: onePixelPng, sourceFigure: 'Figure 1' } as any),
      (e: Error) => /claude-opus-4-8/.test(e.message) && /openai/i.test(e.message),
      'recreateFigureData swallowed a provider/model mismatch',
    );
  } finally {
    for (const key of VISION_KEYS) delete process.env[key];
  }
});

test('the CLI refuses to start with a mismatched vision model', () => {
  const selection = runCli({ FIGURE_VLM_PROVIDER: 'openai', FIGURE_VLM_MODEL: 'claude-opus-4-8' });
  assert.notEqual(selection.status, 0, `CLI exited 0 with FIGURE_VLM_MODEL mismatched:\n${selection.out}`);
  assert.match(selection.out, /claude-opus-4-8/, 'CLI error does not name the mismatched model');

  const verify = runCli({ FIGURE_VLM_PROVIDER: 'openai', FIGURE_VLM_VERIFY_MODEL: 'claude-opus-4-8' });
  assert.notEqual(verify.status, 0, `CLI exited 0 with FIGURE_VLM_VERIFY_MODEL mismatched:\n${verify.out}`);
  assert.match(verify.out, /claude-opus-4-8/, 'CLI error does not name the mismatched verify model');

  const data = runCli({ FIGURE_VLM_PROVIDER: 'claude', FIGURE_DATA_MODEL: 'gpt-5.6-terra' });
  assert.notEqual(data.status, 0, `CLI exited 0 with FIGURE_DATA_MODEL mismatched:\n${data.out}`);
  assert.match(data.out, /gpt-5\.6-terra/, 'CLI error does not name the mismatched data model');
});

test('the CLI still starts when the vision models match their provider', () => {
  const ok = runCli({ FIGURE_VLM_PROVIDER: 'claude', MODEL_BATCH: 'gpt-5.6-sol' });
  assert.equal(ok.status, 0, `CLI failed with a matching vision config:\n${ok.out}`);
  assert.match(ok.out, /No pending batch found/, 'CLI did not reach the poll step');
});

test('docs no longer tie the vision model to batchModel', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'FIGURE-EXTRACTION.md'), 'utf8');
  const row = doc.split('\n').find(l => l.startsWith('| `FIGURE_VLM_MODEL`'));
  assert.ok(row, 'FIGURE_VLM_MODEL row missing from docs/FIGURE-EXTRACTION.md');
  assert.doesNotMatch(row, /batchModel/, 'FIGURE_VLM_MODEL row still says the default is batchModel');
  assert.match(row, /visionModel/, 'FIGURE_VLM_MODEL row does not name the visionModel default');
});
// AUTOMETTA-CONTRACT-END

test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});
