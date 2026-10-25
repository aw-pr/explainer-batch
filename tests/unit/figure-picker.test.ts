import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePick, pickerPrompt, pickRegion, PICKER_SYSTEM, VERIFY_SYSTEM, VERIFY_PROMPT,
  type VisionRequest,
} from '../../src/figure-locator/picker';

const rect = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
const cand = (name: string, r = rect(0, 0, 100, 100)) => ({ image: `${name}.jpg`, region: r });
const base = {
  label: 'Figure 2',
  captionText: 'Figure 2. Results.',
  candidates: [cand('a', rect(0, 0, 50, 50)), cand('b', rect(0, 0, 200, 200)), cand('c', rect(0, 0, 100, 100))],
  pageImage: 'page.jpg',
  page: 3,
  pinned: true,
};

function fake(replies: Array<string | Error>) {
  const calls: VisionRequest[] = [];
  const queue = [...replies];
  return {
    calls,
    fn: async (req: VisionRequest) => {
      calls.push(req);
      const next = queue.shift();
      if (next === undefined) throw new Error('unexpected call');
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

test('parsePick accepts only an integer in range', () => {
  assert.equal(parsePick('2', 3), 2);
  assert.equal(parsePick('```json\n3\n```', 3), 3);
  assert.equal(parsePick(' 0 ', 3), 0);
  for (const bad of ['4', '2.', 'Candidate 2', '', '-1', '{"n":1}', 'one']) assert.equal(parsePick(bad, 3), null);
});

test('pickerPrompt mentions the page only when given', () => {
  assert.match(pickerPrompt('Figure 2', 'cap', 3, true), /beside that caption; the last image is the page\. Which/);
  assert.doesNotMatch(pickerPrompt('Figure 2', 'cap', 3, false), /last image/);
});

test('one call carries system, labels and images in order', async () => {
  const v = fake(['2']);
  const r = await pickRegion(base, v.fn, {});
  assert.equal(v.calls[0].system, PICKER_SYSTEM);
  assert.deepEqual(v.calls[0].labels, ['Candidate 1', 'Candidate 2', 'Candidate 3', 'Page 3']);
  assert.deepEqual(v.calls[0].imagePaths, ['a.jpg', 'b.jpg', 'c.jpg', 'page.jpg']);
  assert.deepEqual(r, { ok: true, index: 1, via: 'picker', calls: { picker: 1, verify: 0 }, notes: [] });
});

test('the page label has no number when page is absent', async () => {
  const v = fake(['1']);
  await pickRegion({ ...base, page: undefined }, v.fn, {});
  assert.equal(v.calls[0].labels.at(-1), 'Page');
});

test('pinned stops: decline, unparseable and error', async () => {
  for (const [reply, reason] of [['0', 'picker-declined'], ['maybe', 'picker-unavailable'], [new Error('x'), 'picker-unavailable']] as const) {
    const r = await pickRegion(base, fake([reply]).fn, {});
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, reason);
  }
});

test('unpinned fallback takes the largest, first on a tie, and a decline stays a decline', async () => {
  const r = await pickRegion({ ...base, pinned: false }, fake([new Error('x')]).fn, { FIGURE_VERIFY: '1' });
  assert.deepEqual(r, { ok: true, index: 1, via: 'largest', calls: { picker: 1, verify: 0 }, notes: ['picker-unavailable: largest region taken'] });
  const tie = await pickRegion({ ...base, pinned: false, candidates: [cand('a'), cand('b')] }, fake(['nope']).fn, {});
  assert.equal(tie.ok && tie.index, 0);
  const declined = await pickRegion({ ...base, pinned: false }, fake(['0']).fn, {});
  assert.equal(declined.ok, false);
});

test('a single candidate makes no call and zero candidates throws', async () => {
  const v = fake([]);
  const r = await pickRegion({ ...base, candidates: [cand('only')] }, v.fn, { FIGURE_VERIFY: '1' });
  assert.deepEqual(r, { ok: true, index: 0, via: 'single', calls: { picker: 0, verify: 0 }, notes: [] });
  assert.equal(v.calls.length, 0);
  await assert.rejects(pickRegion({ ...base, candidates: [] }, v.fn, {}));
});

test('FIGURE_VERIFY=1 adds one yes/no call; only yes passes', async () => {
  const ok = fake(['1', 'Yes.']);
  const r = await pickRegion(base, ok.fn, { FIGURE_VERIFY: '1' });
  assert.equal(ok.calls[1].system, VERIFY_SYSTEM);
  assert.equal(ok.calls[1].prompt, VERIFY_PROMPT);
  assert.deepEqual(ok.calls[1].imagePaths, ['a.jpg']);
  assert.deepEqual(ok.calls[1].labels, ['Candidate 1']);
  assert.deepEqual(r, { ok: true, index: 0, via: 'picker', calls: { picker: 1, verify: 1 }, notes: [] });
  for (const second of ['no', 'maybe', new Error('x')]) {
    const out = await pickRegion({ ...base, pinned: false }, fake(['2', second]).fn, { FIGURE_VERIFY: '1' });
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.reason, 'verify-rejected');
  }
  for (const flag of ['0', 'yes', undefined]) {
    const v = fake(['2']);
    await pickRegion(base, v.fn, { FIGURE_VERIFY: flag });
    assert.equal(v.calls.length, 1);
  }
});

test('only six candidates are sent', async () => {
  const many = Array.from({ length: 8 }, (_, i) => cand(`m${i}`));
  const v = fake(['7']);
  const r = await pickRegion({ ...base, candidates: many }, v.fn, {});
  assert.equal(v.calls[0].imagePaths.length, 7);
  assert.equal(r.ok, false);
});
