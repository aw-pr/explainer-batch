// Contract test for stage-cards/09-repair-keeps-the-best-candidate.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/09-repair-keeps-the-best-candidate.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-09-'));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/09-repair-keeps-the-best-candidate.md
Object.assign(process.env, {
  EXPLAINER_STATE_FILE: path.join(TMP, 'state.json'),
  EXPLAINER_INPUT_DIR: path.join(TMP, 'input'),
  EXPLAINER_OUTPUT_DIR: path.join(TMP, 'output'),
  EXPLAINER_OBSIDIAN_DIR: '',
  WEBSITE_REPO: '',
  FIGURE_RECREATE: '0',
});
delete process.env.MIN_CHART_POINTS;
globalThis.fetch = (async () => {
  throw new Error('network access is forbidden in contract test 09');
}) as typeof fetch;

const EXPECTED_DATE = '2026-10-19';

function doc(): Record<string, any> {
  return {
    hero: {
      title: 'Repair candidates',
      headline: 'Governed agents separate planning from execution',
      emphasis: null,
      subtitle: 'Policy checks constrain tool use.',
    },
    top_block: {
      kind: 'pills',
      pills: [
        { lead: 'Governance', text: 'Policy checks precede tool use.' },
        { lead: 'Inspection', text: 'Recorded decisions support review.' },
      ],
    },
    sections: [
      { label: 'Architecture', paragraphs: ['Planning precedes execution.'], list: null, table: null },
      { label: 'Evidence', paragraphs: ['The paper describes the tested cases.'], list: null, table: null },
      { label: 'Limits', paragraphs: ['Further evaluation remains necessary.'], list: null, table: null },
    ],
    charts: [],
    figure_request: null,
    end_takeaway: { label: 'Implication', body: 'Inspect decisions before execution.' },
    citation: {
      authors: [{ family: 'Smith', given: null }],
      year: 2026, title: 'Governed agent architectures',
      venue: null, url: 'https://example.org/paper',
    },
  };
}

function oneIssue(): Record<string, any> {
  const wire = doc();
  wire.sections.push(
    { label: 'Controls', paragraphs: ['Policy gates constrain tool use.'], list: null, table: null },
    { label: 'Operations', paragraphs: ['Operators inspect decisions.'], list: null, table: null },
    { label: 'Scope', paragraphs: ['The findings remain bounded.'], list: null, table: null },
  );
  return wire;
}

function threeIssues(): Record<string, any> {
  const wire = oneIssue();
  wire.hero.subtitle = 'x'.repeat(321);
  delete wire.hero.headline;
  return wire;
}

const VALID = JSON.stringify(doc());
const ONE_ISSUE = JSON.stringify(oneIssue());
const THREE_ISSUES = JSON.stringify(threeIssues());
const UNPARSEABLE = 'Sorry, here is the fix: {"hero": {';

function receipt(text: string, stage = 'synthesis', input = 1000, output = 500): Record<string, any> {
  return {
    provider: 'openai', route: 'batch-api', stage,
    model: 'contract-model', customId: 'cid-09',
    attemptId: `09-${stage}-${input}-${output}`,
    finishReason: 'stop', text,
    usage: {
      in: input, out: output, cacheRead: 0, cacheWrite5m: 0,
      cacheWrite1h: 0, source: 'reported',
    },
  };
}

function scripted(replies: Array<{ text: string; inputTokens: number; outputTokens: number }>) {
  const calls: Array<{ instruction: string; payload: string }> = [];
  const repair = async (instruction: string, payload: string) => {
    assert.ok(instruction.length > 0, '09: repair instruction');
    assert.ok(payload.length > 0, '09: repair payload');
    calls.push({ instruction, payload });
    const next = replies.shift();
    assert.ok(next, '09: repair called more often than scripted');
    return receipt(next.text, 'repair', next.inputTokens, next.outputTokens);
  };
  return { calls, repair };
}

async function run(key: string, text: string, repair: (instruction: string, payload: string) => Promise<any>) {
  const { finalizeResult } = require('../../src/finalize') as Record<string, any>;
  assert.equal(typeof finalizeResult, 'function', '09: finalizeResult');
  const map = new Map<string, unknown>();
  return finalizeResult(key, receipt(text), {
    stamp: { expectedDate: EXPECTED_DATE },
    checkpoints: {
      get: (k: string) => map.get(k),
      put: (k: string, value: unknown) => { map.set(k, value); },
    },
    repair,
  });
}

function usage(outcome: any): { input: number; output: number } {
  assert.ok(Array.isArray(outcome.receipts) && outcome.receipts.length > 0, '09: receipts');
  const repairs = outcome.receipts.filter((r: any) => r.stage === 'repair');
  assert.equal(repairs.length, outcome.repairAttempts, '09: every attempt has a receipt');
  return repairs.reduce(
    (sum: { input: number; output: number }, r: any) => ({
      input: sum.input + r.usage.in,
      output: sum.output + r.usage.out,
    }),
    { input: 0, output: 0 },
  );
}

function saved(outcome: any): Record<string, any> {
  assert.ok(['succeeded', 'needs_review'].includes(outcome.status), '09: saved outcome');
  assert.ok(typeof outcome.jsonPath === 'string' && outcome.jsonPath.length > 0, '09: saved path');
  const article = JSON.parse(fs.readFileSync(outcome.jsonPath, 'utf8'));
  assert.deepEqual(article, outcome.article, '09: stored best candidate');
  return article;
}

test('v2 fixtures distinguish zero, one and three issues', () => {
  const { wireIssues } = require('../../src/finalize');
  assert.equal(typeof wireIssues, 'function', '09: wireIssues');
  assert.deepEqual(wireIssues(doc(), { citationKnown: false }), [], '09: valid fixture');
  assert.equal(wireIssues(oneIssue(), { citationKnown: false }).length, 1, '09: one-issue fixture');
  assert.equal(wireIssues(threeIssues(), { citationKnown: false }).length, 3, '09: three-issue fixture');
});

test('usage is summed across every repair receipt', async () => {
  const { calls, repair } = scripted([
    { text: ONE_ISSUE, inputTokens: 100, outputTokens: 10 },
    { text: VALID, inputTokens: 200, outputTokens: 20 },
  ]);
  const outcome = await run('09-usage', THREE_ISSUES, repair);
  assert.equal(calls.length, 2, '09: two repairs');
  assert.equal(outcome.status, 'succeeded', '09: repaired success');
  assert.equal(saved(outcome).sections.length, 3, '09: valid candidate adopted');
  assert.deepEqual(usage(outcome), { input: 300, output: 30 }, '09: summed repair usage');
  assert.deepEqual(
    outcome.receipts.filter((r: any) => r.stage === 'repair').map((r: any) => r.text),
    [ONE_ISSUE, VALID],
    '09: both repair receipts retained',
  );
});

test('unparseable repairs never replace a parseable candidate and their tokens still count', async () => {
  const { calls, repair } = scripted([
    { text: UNPARSEABLE, inputTokens: 50, outputTokens: 5 },
    { text: UNPARSEABLE, inputTokens: 60, outputTokens: 6 },
  ]);
  const outcome = await run('09-unparseable', ONE_ISSUE, repair);
  const article = saved(outcome);
  assert.equal(outcome.status, 'needs_review', '09: best candidate saved for review');
  assert.equal(article.sections.length, 6, '09: parseable candidate retained');
  assert.equal(article.hero.subtitle, 'Policy checks constrain tool use.', '09: original prose retained');
  assert.deepEqual(JSON.parse(calls[1].payload), oneIssue(), '09: second repair uses best candidate');
  assert.deepEqual(usage(outcome), { input: 110, output: 11 }, '09: rejected receipt usage counts');
});

test('a parseable repair with more issues does not replace the better candidate', async () => {
  const { calls, repair } = scripted([
    { text: THREE_ISSUES, inputTokens: 1, outputTokens: 1 },
    { text: THREE_ISSUES, inputTokens: 1, outputTokens: 1 },
  ]);
  const outcome = await run('09-worse', ONE_ISSUE, repair);
  const article = saved(outcome);
  assert.equal(outcome.status, 'needs_review', '09: better candidate retained');
  assert.equal(article.hero.subtitle, 'Policy checks constrain tool use.', '09: worse subtitle rejected');
  assert.equal(article.hero.headline, 'Governed agents separate planning from execution', '09: headline retained');
  assert.deepEqual(JSON.parse(calls[1].payload), oneIssue(), '09: second repair targets best candidate');
  assert.deepEqual(usage(outcome), { input: 2, output: 2 }, '09: both rejected receipts count');
});

test('a repair with fewer issues is adopted', async () => {
  const { calls, repair } = scripted([
    { text: VALID, inputTokens: 1, outputTokens: 1 },
  ]);
  const outcome = await run('09-better', THREE_ISSUES, repair);
  assert.equal(calls.length, 1, '09: stop when valid');
  assert.equal(outcome.status, 'succeeded', '09: repaired success');
  assert.equal(saved(outcome).sections.length, 3, '09: better sections adopted');
  assert.deepEqual(outcome.issues, [], '09: issues resolved');
});

test('valid input makes no repair call and has no repair usage', async () => {
  const { calls, repair } = scripted([]);
  const outcome = await run('09-valid', VALID, repair);
  assert.equal(calls.length, 0, '09: no repair');
  assert.equal(outcome.repairAttempts, 0, '09: no attempts');
  assert.equal(outcome.status, 'succeeded', '09: valid success');
  assert.equal(saved(outcome).sections.length, 3, '09: valid article saved');
  assert.equal(outcome.receipts.length, 1, '09: synthesis receipt only');
  assert.equal(outcome.receipts[0].text, VALID, '09: original text retained');
  assert.deepEqual(usage(outcome), { input: 0, output: 0 }, '09: no repair usage');
});

test('repair is attempted at most twice', async () => {
  const { calls, repair } = scripted([
    { text: ONE_ISSUE, inputTokens: 1, outputTokens: 1 },
    { text: ONE_ISSUE, inputTokens: 1, outputTokens: 1 },
    { text: VALID, inputTokens: 1, outputTokens: 1 },
  ]);
  const outcome = await run('09-bound', ONE_ISSUE, repair);
  assert.equal(calls.length, 2, '09: at most two repairs');
  assert.equal(outcome.repairAttempts, 2, '09: recorded attempt bound');
  assert.equal(saved(outcome).sections.length, 6, '09: third reply not consumed');
});

test('repair results carry JSON text receipts and never an html result field', async () => {
  const { repair } = scripted([{ text: VALID, inputTokens: 1, outputTokens: 1 }]);
  const outcome = await run('09-text', THREE_ISSUES, repair);
  assert.equal(outcome.status, 'succeeded', '09: success');
  assert.equal(Object.hasOwn(outcome, 'html'), false, '09: no html outcome field');
  assert.equal(outcome.receipts.length, 2, '09: repair receipt present');
  assert.equal(outcome.receipts[1].text, VALID, '09: repair text');
  assert.equal(Object.hasOwn(outcome.receipts[1], 'html'), false, '09: no html receipt field');
  const batchSrc = fs.readFileSync(path.join(REPO_ROOT, 'src', 'batch.ts'), 'utf8');
  const repairSrc = fs.readFileSync(path.join(REPO_ROOT, 'src', 'repair.ts'), 'utf8');
  assert.doesNotMatch(batchSrc, /\.html\b/, 'batch.ts still reads a .html field');
  assert.doesNotMatch(repairSrc, /\bhtml\s*:/, 'repair.ts still returns an html field');
});
// AUTOMETTA-CONTRACT-END
