import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { validateJsonOutput } from '../../src/quality';

const FIXTURES = path.join(__dirname, 'fixtures', '15-style-rules-are-checked-in-code');

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/15-style-rules-are-checked-in-code.md
const CARD = '15-style-rules-are-checked-in-code';
type Issue = { check: string; path: string; message: string };
type Json = Record<string, any>;

const CLEAN_FIXTURES: Array<[string, string, string]> = [
  ['clean-demirer-2026-06-17.json', '2026-06-17', 'c1922fbe3994d1f0b14c8a9d8bf015c37cfaa003ac47304c6bda75bb08007d84'],
  ['clean-flyvbjerg-terra-2026-07-31.json', '2026-07-31', 'b14ba5c5dbd1f3d906aa2620a5ec24024b1b412e4ab44b6cb2c1ded5040c030a'],
];
const loadFixture = (name: string, sha: string): Json => {
  const raw = fs.readFileSync(path.join(FIXTURES, name));
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), sha, `${CARD}: fixture ${name} was edited`);
  return JSON.parse(raw.toString('utf8'));
};
const lint = (json: unknown): Issue[] => {
  let mod: Record<string, unknown> = {};
  try { mod = require('../../src/style-lint'); } catch (e: any) { if (e?.code !== 'MODULE_NOT_FOUND') throw e; }
  const fn = mod['lintStyle'];
  assert.equal(typeof fn, 'function', `${CARD}: src/style-lint.ts does not export lintStyle`);
  const out = (fn as (j: unknown) => Issue[])(json);
  assert.ok(Array.isArray(out), `${CARD}: lintStyle did not return an array`);
  return out;
};
const base = (): Json => loadFixture(CLEAN_FIXTURES[0][0], CLEAN_FIXTURES[0][2]);
const BASE_DATE = CLEAN_FIXTURES[0][1];
const PLAIN = 'sections[1].paragraphs[0]';
const HTML = 'sections[0].paragraphs_html[0]';
const appendPlain = (s: string) => (j: Json) => { j.sections[1].paragraphs[0] += s; };
const appendHtml = (s: string) => (j: Json) => { j.sections[0].paragraphs_html[0] += s; };

const BAD: Array<[string, string, string, (j: Json) => void]> = [
  ['em dash', 'dash', PLAIN, appendPlain(' Each wave adds autonomy — and cost.')],
  ['horizontal bar', 'dash', PLAIN, appendPlain(' Each wave adds autonomy ― and cost.')],
  ['spaced hyphen', 'dash', PLAIN, appendPlain(' Each wave adds autonomy - and cost.')],
  ['en dash between words', 'dash', PLAIN, appendPlain(' Each wave adds autonomy – and cost.')],
  ['em dash entity in html', 'dash', HTML, appendHtml(' Each wave adds autonomy &mdash; and cost.')],
  ['behavior', 'spelling', PLAIN, appendPlain(' Their behavior changes.')],
  ['organization', 'spelling', PLAIN, appendPlain(' The organization adopts them.')],
  ['analyzed', 'spelling', PLAIN, appendPlain(' The authors analyzed the logs.')],
  ['delve', 'banned-phrase', PLAIN, appendPlain(' The authors delve into the logs.')],
  ['leverage', 'banned-phrase', PLAIN, appendPlain(' The tools leverage telemetry.')],
  ['not even close', 'banned-phrase', PLAIN, appendPlain(' The gap is not even close.')],
  ['corporate robust', 'banned-phrase', PLAIN, appendPlain(' It is a robust platform.')],
  ['metaphorical bandwidth', 'banned-phrase', PLAIN, appendPlain(' Teams lack the bandwidth to review it.')],
  ['pill number missing from body', 'number-not-in-body', 'top_block.pills[0].number', (j) => { j.top_block.pills[0].number = '999%'; }],
  ['headline number missing from body', 'number-not-in-body', 'hero.headline', (j) => { j.hero.headline = 'AI writes 7.3 times more code, but much less of it ever ships'; }],
];

const GOOD: Array<[string, (j: Json) => void]> = [
  ['en dash between digits', appendPlain(' Ranges such as 16–64% stay as printed.')],
  ['ordinary hyphen', appendPlain(' End-to-end latency fell.')],
  ['size, seize, capsize', appendPlain(' The sample size was large, so firms could seize the gain before the project capsized.')],
  ['proper noun', appendPlain(' The Center for Security and Emerging Technology agrees.')],
  ['quoted title', appendPlain(' The authors call it "behavior cloning at scale".')],
  ['code in backticks', appendPlain(' The helper `normalize()` runs first.')],
  ['code element in html', appendHtml(' The helper <code>normalize()</code> runs first.')],
  ['technical bandwidth, robustness, ecosystem', appendPlain(' Decode is limited by memory bandwidth, and robustness scores held steady across the MCP ecosystem and the Python package ecosystem.')],
  ['references are citations, not prose', (j) => { j.references[0] = j.references[0].replace('Writing Code vs. Shipping Code', 'Analyzing Labor Behavior — Writing Code'); }],
  ['concept pill with no number', (j) => { j.top_block.pills[2].number = 'Weak link'; }],
  ['chart config is not prose', (j) => { j.charts[0].config_json.options.plugins = { title: { display: true, text: 'Normalized color — center' } }; }],
];

test(`${CARD}: real clean outputs trip no check and validate`, () => {
  for (const [name, date, sha] of CLEAN_FIXTURES) {
    const j = loadFixture(name, sha);
    assert.deepEqual(lint(j), [], `${CARD}: clean fixture ${name} tripped the style lint`);
    const v = validateJsonOutput(j, { expectedDate: date });
    assert.deepEqual(v.issues, [], `${CARD}: clean fixture ${name} failed validation`);
  }
});

for (const [name, check, where, mutate] of BAD) {
  test(`${CARD}: bad fixture "${name}" trips exactly one ${check} issue at ${where}`, () => {
    const j = base();
    mutate(j);
    const issues = lint(j);
    assert.equal(issues.length, 1, `${CARD}: "${name}" produced ${issues.length} issues: ${JSON.stringify(issues)}`);
    assert.equal(issues[0].check, check, `${CARD}: "${name}" tripped ${issues[0].check}, expected ${check}`);
    assert.equal(issues[0].path, where, `${CARD}: "${name}" reported path ${issues[0].path}, expected ${where}`);
    assert.ok(typeof issues[0].message === 'string' && issues[0].message.trim().length > 0, `${CARD}: "${name}" has an empty message`);
  });
}

for (const [name, mutate] of GOOD) {
  test(`${CARD}: good fixture "${name}" trips nothing`, () => {
    const j = base();
    mutate(j);
    assert.deepEqual(lint(j), [], `${CARD}: "${name}" tripped the style lint`);
  });
}

test(`${CARD}: style issues reach validateJsonOutput, which feeds repair`, () => {
  assert.equal(validateJsonOutput(base(), { expectedDate: BASE_DATE }).ok, true, `${CARD}: base fixture no longer validates`);
  for (const [name, , where, mutate] of BAD) {
    const j = base();
    mutate(j);
    const v = validateJsonOutput(j, { expectedDate: BASE_DATE });
    assert.equal(v.ok, false, `${CARD}: "${name}" passed validation, so repair never sees it`);
    assert.ok(v.issues.some(i => i.includes(where)), `${CARD}: "${name}" validation issue does not name ${where}`);
  }
});
// AUTOMETTA-CONTRACT-END
