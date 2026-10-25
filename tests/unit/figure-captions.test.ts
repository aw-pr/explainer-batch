import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { formatLabel, labelsEqual, matchCaption, parseLabel } from '../../src/figure-locator/label';
import { parseCaptionIndex, selectCaption } from '../../src/figure-locator/captions';

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'figure-locator', 'captions');
const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

test('Table 4 is not Figure 4, and panels are ignored in equality', () => {
  assert.equal(labelsEqual(parseLabel('Table 4')!, parseLabel('Figure 4')!), false);
  assert.equal(labelsEqual(parseLabel('Figure 2(b)')!, parseLabel('Figure 2')!), true);
});

test('Fig. 2(b) parses to Figure, 2, b', () => {
  assert.deepEqual(parseLabel('Fig. 2(b)'), { noun: 'Figure', number: '2', panel: 'b' });
  assert.equal(formatLabel(parseLabel('Fig. 2(b)')!), 'Figure 2b');
  assert.equal(parseLabel('Chart 3'), null);
});

test('prose references are not captions', () => {
  assert.equal(matchCaption('Figure 8 presents the corresponding event studies'), null);
  assert.ok(matchCaption('Figure 8: Event studies'));
});

test('snapshot pages yield block-start captions only', () => {
  const p5 = parseCaptionIndex(fixture('w35275-p5.bbox.xml'), 5);
  assert.deepEqual(p5.map(e => [e.page, e.label]), [[5, 'Figure 1']]);
  assert.ok(p5[0].text.startsWith('Figure 1: Overview of Productivity Effects of AI Coding Tools'));
  const p36 = parseCaptionIndex(fixture('w35275-p36.bbox.xml'), 36);
  assert.equal(p36.length, 1);
  assert.ok(!p36.some(e => e.text.startsWith('Figure 8 presents')));
});

test('synthetic fixture: mid-block references and lower-case follow-ons are skipped, entities decoded', () => {
  const index = parseCaptionIndex(fixture('synthetic.bbox.xml'));
  assert.deepEqual(index.map(e => `${e.page} ${e.label} ${e.continued}`), ['2 Figure 2 true', '2 Table 4 false']);
  assert.equal(index[1].text, 'Table 4: R&D spending');
});

test('continued captions lose to first captions but are used when alone', () => {
  const index = parseCaptionIndex(fixture('synthetic.bbox.xml'));
  const sel = selectCaption(index, parseLabel('Figure 2')!);
  assert.ok(sel.ok && sel.entry.continued);
  const first = { ...index[0], continued: false, page: 9 };
  const both = selectCaption([index[0], first], parseLabel('Figure 2')!);
  assert.ok(both.ok && both.entry.page === 9);
});

test('page hint is a tie-breaker only', () => {
  const index = parseCaptionIndex(fixture('synthetic.bbox.xml'));
  const a = { ...index[1], page: 3 };
  const b = { ...index[1], page: 7 };
  const hinted = selectCaption([a, b], parseLabel('Table 4')!, 7);
  assert.ok(hinted.ok && hinted.entry.page === 7 && hinted.notes.length === 0);
  const ignored = selectCaption([a, b], parseLabel('Table 4')!, 5);
  assert.ok(ignored.ok && ignored.entry.page === 3 && ignored.notes.includes('page-hint-ignored'));
  const missing = selectCaption([a], parseLabel('Figure 1')!);
  assert.deepEqual(missing, { ok: false, reason: 'label-not-found', labels: ['Table 4'] });
});
