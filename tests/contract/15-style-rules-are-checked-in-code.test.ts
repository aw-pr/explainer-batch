import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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

function v2Fixture(name: string, sha: string): Json {
  const original = loadFixture(name, sha);
  assert.ok(original.sections.length >= 2, `${CARD}: source sections`);
  const extraBody: string[] = [];
  for (const section of original.sections) {
    if (section.list) {
      if (section.list.intro) extraBody.push(section.list.intro);
      for (const item of section.list.items) {
        if (item.label) extraBody.push(item.label);
        extraBody.push(item.body);
      }
    }
    if (section.table) {
      if (section.table.caption) extraBody.push(section.table.caption);
      for (const column of section.table.columns ?? []) extraBody.push(String(column));
      for (const row of section.table.rows ?? []) {
        for (const cell of row) extraBody.push(String(cell));
      }
    }
  }
  const sections = original.sections.map((section: Json) => ({
    label: section.label,
    paragraphs: [...section.paragraphs],
    list: null,
    table: null,
  }));
  sections[sections.length - 1].paragraphs.push(...extraBody);
  return {
    hero: {
      title: 'Research findings',
      headline: original.hero.headline,
      emphasis: null,
      subtitle: original.hero.subtitle,
    },
    top_block: {
      kind: 'pills',
      pills: original.top_block.pills.map((pill: Json) => ({
        lead: pill.number,
        text: pill.description,
      })),
    },
    sections,
    charts: [{
      kind: 'bar',
      title: 'Measured cases',
      caption: 'The measurements describe the tested cases.',
      x: {
        label: 'Case', unit: null, type: 'category',
        values: ['A', 'B', 'C', 'D', 'E', 'F'],
      },
      y: { label: 'Latency', unit: 'ms', scale: 'linear' },
      series: [{
        name: 'Measured', values: [12.5, 30.1, 7.2, 44, 18, 26], points: null,
        source: { kind: 'table', ref: 'Table 2', page: 4 },
      }],
    }],
    figure_request: null,
    end_takeaway: {
      label: original.end_takeaway.label,
      body: original.end_takeaway.body,
    },
    citation: {
      authors: [{ family: 'Smith', given: null }],
      year: 2026,
      title: 'Research findings',
      venue: null,
      url: 'https://example.org/paper',
    },
  };
}

const lint = (json: unknown): Issue[] => {
  let mod: Record<string, unknown> = {};
  try { mod = require('../../src/style-lint'); } catch (e: any) { if (e?.code !== 'MODULE_NOT_FOUND') throw e; }
  const fn = mod['lintStyle'];
  assert.equal(typeof fn, 'function', `${CARD}: src/style-lint.ts does not export lintStyle`);
  const out = (fn as (j: unknown) => Issue[])(json);
  assert.ok(Array.isArray(out), `${CARD}: lintStyle did not return an array`);
  return out;
};

const wireIssues = (json: unknown): string[] => {
  const mod = require('../../src/finalize') as Record<string, any>;
  assert.equal(typeof mod.wireIssues, 'function', `${CARD}: wireIssues export`);
  assert.equal(typeof mod.canonicaliseWire, 'function', `${CARD}: canonicaliseWire export`);
  const out = mod.wireIssues(mod.canonicaliseWire(json, { citationKnown: false }).wire, { citationKnown: false });
  assert.ok(Array.isArray(out), `${CARD}: wireIssues did not return an array`);
  return out;
};

const base = (): Json => v2Fixture(CLEAN_FIXTURES[0][0], CLEAN_FIXTURES[0][2]);
const PLAIN = 'sections[1].paragraphs[0]';
const INLINE = 'sections[0].paragraphs[0]';
const appendPlain = (s: string) => (j: Json) => { j.sections[1].paragraphs[0] += s; };
const appendInline = (s: string) => (j: Json) => { j.sections[0].paragraphs[0] += s; };

const BAD: Array<[string, string, string, (j: Json) => void]> = [
  ['em dash', 'dash', PLAIN, appendPlain(' Each wave adds autonomy — and cost.')],
  ['horizontal bar', 'dash', PLAIN, appendPlain(' Each wave adds autonomy ― and cost.')],
  ['spaced hyphen', 'dash', PLAIN, appendPlain(' Each wave adds autonomy - and cost.')],
  ['en dash between words', 'dash', PLAIN, appendPlain(' Each wave adds autonomy – and cost.')],
  ['em dash entity in inline prose', 'dash', INLINE, appendInline(' Each wave adds autonomy &mdash; and cost.')],
  ['behavior', 'spelling', PLAIN, appendPlain(' Their behavior changes.')],
  ['organization', 'spelling', PLAIN, appendPlain(' The organization adopts them.')],
  ['analyzed', 'spelling', PLAIN, appendPlain(' The authors analyzed the logs.')],
  ['delve', 'banned-phrase', PLAIN, appendPlain(' The authors delve into the logs.')],
  ['leverage', 'banned-phrase', PLAIN, appendPlain(' The tools leverage telemetry.')],
  ['not even close', 'banned-phrase', PLAIN, appendPlain(' The gap is not even close.')],
  ['corporate robust', 'banned-phrase', PLAIN, appendPlain(' It is a robust platform.')],
  ['metaphorical bandwidth', 'banned-phrase', PLAIN, appendPlain(' Teams lack the bandwidth to review it.')],
  ['pill lead number missing from body', 'number-not-in-body', 'top_block.pills[0].lead', (j) => { j.top_block.pills[0].lead = '999%'; }],
  ['headline number missing from body', 'number-not-in-body', 'hero.headline', (j) => { j.hero.headline = 'AI writes 7.3 times more code, but much less of it ever ships'; }],
];

const GOOD: Array<[string, (j: Json) => void]> = [
  ['en dash between digits', appendPlain(' Ranges such as 16–64% stay as printed.')],
  ['ordinary hyphen', appendPlain(' End-to-end latency fell.')],
  ['size, seize, capsize', appendPlain(' The sample size was large, so firms could seize the gain before the project capsized.')],
  ['proper noun', appendPlain(' The Center for Security and Emerging Technology agrees.')],
  ['quoted title', appendPlain(' The authors call it "behavior cloning at scale".')],
  ['code in backticks', appendPlain(' The helper `normalize()` runs first.')],
  ['code element in inline prose', appendInline(' The helper <code>normalize()</code> runs first.')],
  ['technical bandwidth, robustness, ecosystem', appendPlain(' Decode is limited by memory bandwidth, and robustness scores held steady across the MCP ecosystem and the Python package ecosystem.')],
  ['citation is not prose', (j) => {
    j.citation.title = 'Analyzing Labor Behavior — Writing Code';
  }],
  ['stored references are not prose', (j) => {
    j.references = [{
      authors: [{ family: 'Smith' }],
      title: 'Analyzing Labor Behavior — Writing Code',
      origin: 'model',
    }];
  }],
  ['concept pill with no number', (j) => { j.top_block.pills[2].lead = 'Weak link'; }],
  ['chart data is not prose', (j) => {
    j.charts[0].series[0].name = 'Normalized color — center';
    j.charts[0].series[0].source.ref = 'Normalized color — center';
  }],
];

test(`${CARD}: clean v2 fixtures trip no check and validate`, () => {
  for (const [name, , sha] of CLEAN_FIXTURES) {
    const j = v2Fixture(name, sha);
    assert.deepEqual(lint(j), [], `${CARD}: clean v2 fixture ${name} tripped the style lint`);
    assert.deepEqual(wireIssues(j), [], `${CARD}: clean v2 fixture ${name} failed validation`);
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

test(`${CARD}: style issues reach wireIssues, which feeds repair`, () => {
  assert.deepEqual(wireIssues(base()), [], `${CARD}: base fixture no longer validates`);
  for (const [name, check, where, mutate] of BAD) {
    const j = base();
    mutate(j);
    const issues = wireIssues(j);
    assert.ok(issues.length > 0, `${CARD}: "${name}" passed validation, so repair never sees it`);
    assert.ok(
      issues.some(issue => issue.startsWith(`style (${check}) at ${where}:`)),
      `${CARD}: "${name}" lacks the prefixed style issue at ${where}`,
    );
  }
});
// AUTOMETTA-CONTRACT-END
