import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildSystemPrompt, buildUserInstruction } from '../../src/prompt';

const OUTPUT_TS = path.join(__dirname, '..', '..', 'src', 'output.ts');

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/02-charts-come-only-from-stated-values.md
const CARD = '02-charts-come-only-from-stated-values';
const systemPrompt = (): string => {
  const text = buildSystemPrompt();
  assert.ok(text.length > 1000, `${CARD}: system prompt is empty or truncated`);
  return text;
};
const userInstructions = (): string[] => [
  buildUserInstruction('2026-10-19'),
  buildUserInstruction('2026-10-19', 'Focus on the cost results.'),
];
const paragraphs = (text: string): string[] => text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
const sentences = (text: string): string[] =>
  text.split(/\n+|(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);

const REQUIRED_CHART_RULES: Array<[string, RegExp]> = [
  ['never read values off a figure', /never read (?:values|numbers) off/i],
  ['every value stated in the text or a table', /stated in the text or a table/i],
  ['caption names the table or page', /names? the (?:source )?table or page/i],
  ['pie, doughnut and radar are banned', /pie, doughnut,? (?:or|and) radar/i],
  ['never join categories with a line', /never (?:join|connect) categories with a line/i],
  ['never split a reported range', /never split a (?:reported )?range/i],
  ['no stacked bars on a log axis', /\b(?:no|never)\b[^.\n]*stacked bars?[^.\n]*\blog\b/i],
  ['prefer a table', /prefer a `?table`?/i],
  ['at most one chart', /at most one chart/i],
];

test(`${CARD}: system prompt states every interim chart rule`, () => {
  const text = systemPrompt();
  for (const [name, re] of REQUIRED_CHART_RULES) {
    assert.match(text, re, `${CARD}: system prompt is missing the rule: ${name}`);
  }
});

test(`${CARD}: the one-chart rule is tied to URL sources`, () => {
  const hits = sentences(systemPrompt()).filter(s => /at most one chart/i.test(s));
  assert.ok(hits.length > 0, `${CARD}: no sentence says "at most one chart"`);
  assert.ok(hits.some(s => /\bURL\b/.test(s)), `${CARD}: "at most one chart" is not stated for URL sources`);
});

test(`${CARD}: pie, doughnut, radar and spider are only ever mentioned to ban them`, () => {
  const offenders = sentences(systemPrompt())
    .filter(s => /\b(?:pie|doughnut|radar|spider)\b/i.test(s))
    .filter(s => !/\b(?:no|never|not|banned|off the menu)\b/i.test(s));
  assert.deepEqual(offenders, [], `${CARD}: a sentence still offers pie, doughnut, radar or spider charts`);
});

test(`${CARD}: the read-off and reproduce-the-figure rules are gone`, () => {
  const text = systemPrompt();
  const removed: Array<[string, RegExp]> = [
    ['match the axes', /match the axes/i],
    ["whatever the paper's genre", /whatever the paper['’]s genre/i],
    ['faithfully recreated figure', /faithfully recreated/i],
    ['recreate the relevant figure', /recreate the relevant figure/i],
    ['reproduce it / that shape', /reproduce (?:it|that shape|that)\b/i],
  ];
  for (const [name, re] of removed) {
    assert.doesNotMatch(text, re, `${CARD}: system prompt still carries the removed rule: ${name}`);
  }
});

test(`${CARD}: the paragraphs carrying the new chart rules have no em dash`, () => {
  const ruleParas = paragraphs(systemPrompt()).filter(p => REQUIRED_CHART_RULES.some(([, re]) => re.test(p)));
  assert.ok(ruleParas.length > 0, `${CARD}: found no chart-rule paragraphs`);
  for (const p of ruleParas) {
    assert.ok(!/[—―]/.test(p), `${CARD}: chart-rule paragraph contains an em dash: ${p.slice(0, 80)}`);
  }
});

test(`${CARD}: the skill.md example carries no real EPIC numbers`, () => {
  const text = systemPrompt();
  for (const token of ['HotpotQA', 'MuSiQue', 'MultiNews', '58.4', '63.6', '52.0', '52.1', '58.8', '20.1', '17.7', '16.4']) {
    assert.ok(!text.includes(token), `${CARD}: system prompt still contains the EPIC example value ${token}`);
  }
  assert.match(text, /"table"\s*:\s*\{/, `${CARD}: the section example lost its table block`);
});

test(`${CARD}: the user instruction agrees with the chart rules`, () => {
  for (const text of userInstructions()) {
    assert.ok(text.length > 100, `${CARD}: user instruction is empty`);
    assert.doesNotMatch(text, /read the figures/i, `${CARD}: user instruction still says "Read the figures"`);
    assert.doesNotMatch(text, /capability profile/i, `${CARD}: user instruction still invites radar-style capability profiles`);
    assert.match(text, /prefer a table/i, `${CARD}: user instruction lost "prefer a table"`);
    assert.match(text, /stated/i, `${CARD}: user instruction does not limit charts to stated values`);
    assert.ok(!/[—―]/.test(text), `${CARD}: user instruction contains an em dash`);
  }
  assert.match(userInstructions()[1], /Focus on the cost results\./, `${CARD}: focus hint no longer reaches the user instruction`);
});

test(`${CARD}: the 6-point chart filter in output.ts is untouched`, () => {
  const src = fs.readFileSync(OUTPUT_TS, 'utf8');
  assert.match(src, /const MIN_CHART_POINTS = \(\(\) => \{/, `${CARD}: MIN_CHART_POINTS was removed or reshaped`);
  assert.match(src, /Math\.floor\(n\) : 6;/, `${CARD}: MIN_CHART_POINTS no longer defaults to 6`);
  assert.match(src, /if \(len < MIN_CHART_POINTS\)/, `${CARD}: the thin-chart filter no longer runs`);
});
// AUTOMETTA-CONTRACT-END
