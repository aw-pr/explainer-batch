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
globalThis.fetch = (async () => {
  throw new Error('network access is forbidden in contract test 09');
}) as typeof fetch;

const EXPECTED_DATE = '2026-10-19';

function doc(): Record<string, any> {
  return {
    version: 1,
    metadata: {
      title: 'Contract fixture: Smith (2026)',
      eyebrow: 'Research Explainer · Smith (2026)',
      date_created: EXPECTED_DATE,
      filename_slug: `${EXPECTED_DATE}_smith_contract-fixture_explainer`,
    },
    hero: { headline: 'Headline', headline_html: 'Headline', subtitle: 'Subtitle', publication_date: 'Published October 2026' },
    top_block: {
      kind: 'pills',
      pills: [
        { number: '12%', description: 'First finding', accent_color: '#111111' },
        { number: '3x', description: 'Second finding', accent_color: '#222222' },
      ],
    },
    sections: [{ label: 'Intro', paragraphs: ['Adoption rose to 12% while the cost fell by 3x.'] }],
    end_takeaway: { label: 'So what', body: 'The point.' },
    references: ['<a href="https://example.org/paper" target="_blank" rel="noopener noreferrer">Smith 2026</a>'],
  };
}

const VALID = JSON.stringify(doc());
// One issue: the subtitle is missing.
const ONE_ISSUE = (() => { const d = doc(); delete d.hero.subtitle; return JSON.stringify(d); })();
// Three issues: subtitle, headline and title missing.
const THREE_ISSUES = (() => { const d = doc(); delete d.hero.subtitle; delete d.hero.headline; delete d.metadata.title; return JSON.stringify(d); })();
const UNPARSEABLE = 'Sorry, here is the fix: {"version": 1, "metadata": {';

function loadRepair(): (opts: Record<string, unknown>) => Promise<Record<string, any>> {
  const mod = require('../../src/repair') as Record<string, any>;
  assert.equal(typeof mod.repairUntilValid, 'function', 'src/repair.ts must export repairUntilValid');
  return mod.repairUntilValid;
}

function scripted(replies: Array<{ text: string; inputTokens: number; outputTokens: number }>) {
  const calls: string[] = [];
  const repair = async (_system: string, text: string) => {
    calls.push(text);
    const next = replies.shift();
    if (!next) throw new Error('repair called more often than scripted');
    return next;
  };
  return { calls, repair };
}

test('usage is summed across every repair attempt', async () => {
  const { calls, repair } = scripted([
    { text: ONE_ISSUE, inputTokens: 100, outputTokens: 10 },
    { text: VALID, inputTokens: 200, outputTokens: 20 },
  ]);
  const res = await loadRepair()({ rawText: THREE_ISSUES, expectedDate: EXPECTED_DATE, repair });
  assert.equal(calls.length, 2);
  assert.equal(res.text, VALID);
  assert.equal(res.usage?.inputTokens, 300);
  assert.equal(res.usage?.outputTokens, 30);
});

test('an unparseable repair never replaces a parseable candidate, and its tokens still count', async () => {
  const { repair } = scripted([
    { text: UNPARSEABLE, inputTokens: 50, outputTokens: 5 },
    { text: UNPARSEABLE, inputTokens: 60, outputTokens: 6 },
  ]);
  const res = await loadRepair()({ rawText: ONE_ISSUE, expectedDate: EXPECTED_DATE, repair });
  assert.equal(res.text, ONE_ISSUE);
  assert.equal(res.usage?.inputTokens, 110);
  assert.equal(res.usage?.outputTokens, 11);
});

test('a parseable repair with more issues does not replace the better candidate', async () => {
  const { calls, repair } = scripted([
    { text: THREE_ISSUES, inputTokens: 1, outputTokens: 1 },
    { text: THREE_ISSUES, inputTokens: 1, outputTokens: 1 },
  ]);
  const res = await loadRepair()({ rawText: ONE_ISSUE, expectedDate: EXPECTED_DATE, repair });
  assert.equal(res.text, ONE_ISSUE);
  assert.equal(calls[1], ONE_ISSUE, 'the second attempt must repair the best candidate, not the worse reply');
});

test('a repair with fewer issues is adopted', async () => {
  const { repair } = scripted([
    { text: VALID, inputTokens: 1, outputTokens: 1 },
  ]);
  const res = await loadRepair()({ rawText: THREE_ISSUES, expectedDate: EXPECTED_DATE, repair });
  assert.equal(res.text, VALID);
});

test('a valid first reply makes no repair call and reports no usage', async () => {
  const { calls, repair } = scripted([]);
  const res = await loadRepair()({ rawText: VALID, expectedDate: EXPECTED_DATE, repair });
  assert.equal(calls.length, 0);
  assert.equal(res.text, VALID);
  assert.equal(res.usage, undefined);
});

test('repair is attempted at most twice', async () => {
  const { calls, repair } = scripted([
    { text: ONE_ISSUE, inputTokens: 1, outputTokens: 1 },
    { text: ONE_ISSUE, inputTokens: 1, outputTokens: 1 },
    { text: ONE_ISSUE, inputTokens: 1, outputTokens: 1 },
  ]);
  await loadRepair()({ rawText: ONE_ISSUE, expectedDate: EXPECTED_DATE, repair });
  assert.equal(calls.length, 2);
});

test('the result field is text, not html', async () => {
  const { repair } = scripted([]);
  const res = await loadRepair()({ rawText: VALID, expectedDate: EXPECTED_DATE, repair });
  assert.equal('html' in res, false);
  const batchSrc = fs.readFileSync(path.join(REPO_ROOT, 'src', 'batch.ts'), 'utf8');
  const repairSrc = fs.readFileSync(path.join(REPO_ROOT, 'src', 'repair.ts'), 'utf8');
  assert.doesNotMatch(batchSrc, /\.html\b/, 'batch.ts still reads a .html field');
  assert.doesNotMatch(repairSrc, /\bhtml\s*:/, 'repair.ts still returns an html field');
});
// AUTOMETTA-CONTRACT-END
