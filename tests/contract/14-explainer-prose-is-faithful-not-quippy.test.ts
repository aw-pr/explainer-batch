import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, buildUserInstruction } from '../../src/prompt';
import * as figureVlm from '../../src/figure-vlm';
import * as figureData from '../../src/figure-data';

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/14-explainer-prose-is-faithful-not-quippy.md
const CARD = '14-explainer-prose-is-faithful-not-quippy';
const EM_DASH = /[—―]/;
const systemPrompt = (): string => {
  const text = buildSystemPrompt();
  assert.ok(text.length > 1000, `${CARD}: system prompt is empty or truncated`);
  return text;
};
const count = (text: string, re: RegExp): number => (text.match(new RegExp(re.source, 'gi')) ?? []).length;

type PromptFn = (...args: unknown[]) => string;
const exported = (mod: Record<string, unknown>, name: string): PromptFn => {
  const fn = mod[name];
  assert.equal(typeof fn, 'function', `${CARD}: ${name} is not exported, so its caption rules cannot be checked`);
  return fn as PromptFn;
};
const captionPrompts = (): Array<[string, string]> => [
  ['figure-vlm selectionPrompt', exported(figureVlm as Record<string, unknown>, 'selectionPrompt')({})],
  ['figure-vlm selectionPrompt (named)', exported(figureVlm as Record<string, unknown>, 'selectionPrompt')({ named: 'Figure 3' })],
  ['figure-vlm candidatePrompt', exported(figureVlm as Record<string, unknown>, 'candidatePrompt')({}, 4)],
  ['figure-data extractionPrompt', exported(figureData as Record<string, unknown>, 'extractionPrompt')({ sourceFigure: 'Figure 2' }, true)],
];

test(`${CARD}: the ranked style rules are in the system prompt`, () => {
  const text = systemPrompt();
  const required: Array<[string, RegExp]> = [
    ['1 faithful', /only what the paper supports/i],
    ['2 headlines and pills claim no more than the body', /claim no more than the body/i],
    ['3 gloss on first use', /on first use/i],
    ['4 sentence length cap', /28 words/],
    ['5 lead with the finding', /lead each section with its finding/i],
    ['6 no manufactured twist', /no manufactured twist/i],
    ['6 one figurative line', /at most one figurative line/i],
    ['7 end_takeaway is the so what', /so what/i],
    ['8 no jokes', /no jokes/i],
    ['9 template cap', /at most twice/i],
    ['9 couplet ban', /It is not X\. It is Y\./],
    ['10 headline contrast only when real', /only when the finding (?:really )?is a contrast/i],
    ['11 British English', /British English/],
    ['11 no em dashes', /no em dashes/i],
    ['caption gloss keeps the meaning', /must not change what the statistic means/i],
  ];
  for (const [name, re] of required) {
    assert.match(text, re, `${CARD}: system prompt is missing style rule ${name}`);
  }
});

test(`${CARD}: the punchline, wit, assertive and punchy rules are gone`, () => {
  const text = systemPrompt();
  const removed: Array<[string, RegExp]> = [
    ['dry wit', /dry wit/i],
    ['understatement', /understatement/i],
    ['assertive', /assertive/i],
    ['take positions', /take positions/i],
    ['punchy sentences', /punchy/i],
    ['punchline closers', /punchline/i],
    ['reversal closers', /reversal/i],
    ['mandatory contrast headline', /\+ contrast clause/i],
    ['tail-parameter gloss that turns size into frequency', /so common the average stops working/i],
  ];
  for (const [name, re] of removed) {
    assert.doesNotMatch(text, re, `${CARD}: system prompt still carries the removed rule: ${name}`);
  }
});

test(`${CARD}: the system prompt contains no em dash`, () => {
  const text = systemPrompt();
  const lines = text.split('\n').filter(l => EM_DASH.test(l));
  assert.deepEqual(lines, [], `${CARD}: system prompt still contains em dashes`);
});

test(`${CARD}: the banned-phrase lists are merged into one`, () => {
  const text = systemPrompt();
  for (const word of ['tapestry', 'delve', 'synergy', 'leverage']) {
    assert.equal(count(text, new RegExp(`\\b${word}\\b`)), 1, `${CARD}: "${word}" should appear exactly once, in the one merged banned list`);
  }
});

test(`${CARD}: the rest of skill.md is still in place`, () => {
  const text = systemPrompt();
  for (const heading of ['## JSON schema', '## Headline rules', '## Pre-delivery checklist']) {
    assert.ok(text.includes(heading), `${CARD}: heading "${heading}" went missing`);
  }
  assert.match(text, /No semicolons/, `${CARD}: the no-semicolon headline rule went missing`);
  assert.doesNotMatch(buildUserInstruction('2026-10-19'), /Published Month Year|publication_date/, `${CARD}: user instruction still asks for a publication date`);
  assert.match(buildUserInstruction('2026-10-19'), /`citation`/, `${CARD}: user instruction lacks its citation sentence`);
});

test(`${CARD}: every caption prompt carries the hard-floor rules`, () => {
  for (const [name, prompt] of captionPrompts()) {
    assert.ok(prompt.length > 200, `${CARD}: ${name} is empty`);
    assert.match(prompt, /caption/i, `${CARD}: ${name} no longer asks for a caption`);
    assert.match(prompt, /no em dash/i, `${CARD}: ${name} lacks the no-em-dash rule`);
    assert.match(prompt, /British/, `${CARD}: ${name} lacks the British spelling rule`);
    assert.match(prompt, /must not change what the statistic means/i, `${CARD}: ${name} lacks the gloss-fidelity rule`);
    assert.ok(!EM_DASH.test(prompt), `${CARD}: ${name} itself contains an em dash`);
  }
});
// AUTOMETTA-CONTRACT-END
