// Contract test for stage-cards/39-numbered-vision-picker.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/39-numbered-vision-picker.test.ts
// Needs poppler (pdftoppm, pdfinfo) and the held PDFs: $EXPLAINER_HELD_DIR, else input/_held/ here, else ../explainer-batch/input/_held/.
// No model is ever called: every vision function here is an injected fake.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-39-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/39-numbered-vision-picker.md
function heldPdf(name: string): string {
  const candidates = [
    ...(process.env.EXPLAINER_HELD_DIR ? [path.join(process.env.EXPLAINER_HELD_DIR, name)] : []),
    path.join(REPO_ROOT, 'input', '_held', name),
    path.join(REPO_ROOT, '..', 'explainer-batch', 'input', '_held', name),
  ];
  const found = candidates.find(p => fs.existsSync(p));
  assert.ok(found, `held PDF ${name} not found in ${candidates.join(' or ')}`);
  return found;
}

function load(rel: string): Record<string, any> {
  const file = path.join(REPO_ROOT, rel);
  assert.ok(fs.existsSync(file + '.ts'), `${rel}.ts does not exist`);
  return require(file) as Record<string, any>;
}
const picker = () => load('src/figure-locator/picker');

const PICKER_SYSTEM = 'You are checking a figure crop for a research explainer. Reply with a single integer and nothing else.';
const VERIFY_SYSTEM = 'You are checking a figure crop for a research explainer. Reply yes or no.';
const VERIFY_PROMPT = 'Is this one complete figure with no body text? Reply yes or no.';
const CAPTION = 'Figure 4. Comparison of PIC Algorithms. The area above the dashed line corresponds to the compile step.';

interface Call { system: string; prompt: string; imagePaths: string[]; labels: string[] }
function fakeVision(replies: Array<string | Error>): { fn: (req: Call) => Promise<string>; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...replies];
  return {
    calls,
    fn: async (req: Call) => {
      calls.push({ system: req.system, prompt: req.prompt, imagePaths: [...req.imagePaths], labels: [...req.labels] });
      const next = queue.shift();
      if (next === undefined) throw new Error('fake vision: unexpected extra call');
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

function img(name: string): string {
  const file = path.join(TMP, name);
  fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  return file;
}
const rect = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

function input(over: Record<string, unknown> = {}) {
  return {
    label: 'Figure 4',
    captionText: CAPTION,
    candidates: [
      { image: img('c1.jpg'), region: rect(50, 60, 300, 200) },
      { image: img('c2.jpg'), region: rect(50, 60, 545, 280) },
    ],
    pageImage: img('page.jpg'),
    page: 5,
    pinned: true,
    ...over,
  };
}
const NO_VERIFY = { FIGURE_VERIFY: '' };
const VERIFY = { FIGURE_VERIFY: '1' };

test('picker exports its contract', () => {
  const p = picker();
  for (const name of ['parsePick', 'pickerPrompt', 'pickRegion', 'runPickerVision', 'renderPickerImages']) {
    assert.equal(typeof p[name], 'function', `${name} must be exported`);
  }
  assert.equal(p.PICKER_SYSTEM, PICKER_SYSTEM);
  assert.equal(p.VERIFY_SYSTEM, VERIFY_SYSTEM);
  assert.equal(p.VERIFY_PROMPT, VERIFY_PROMPT);
});

test('parsePick accepts a single integer and nothing else', () => {
  const { parsePick } = picker();
  assert.equal(parsePick('2', 2), 2);
  assert.equal(parsePick('  1 \n', 2), 1);
  assert.equal(parsePick('```\n2\n```', 2), 2);
  assert.equal(parsePick('```text\n1\n```', 3), 1);
  assert.equal(parsePick('0', 2), 0, '0 is a decline, not a parse failure');
  for (const bad of ['3', 'Candidate 2', '2.', 'two', '', '1 or 2', '-1', '{"candidate":1}']) {
    assert.equal(parsePick(bad, 2), null, `${JSON.stringify(bad)} must be unparseable with two candidates`);
  }
});

test('two candidates make one call: caption in the prompt, labelled images, page last', async () => {
  const { pickRegion } = picker();
  const v = fakeVision(['2']);
  const inp = input();
  const r = await pickRegion(inp, v.fn, NO_VERIFY);
  assert.equal(v.calls.length, 1);
  const c = v.calls[0];
  assert.equal(c.system, PICKER_SYSTEM);
  assert.ok(c.prompt.includes(CAPTION), 'the prompt must quote the caption text');
  assert.match(c.prompt, /Candidates 1 to 2\b/);
  assert.match(c.prompt, /complete body of Figure 4/);
  assert.match(c.prompt, /the last image is the page/);
  assert.match(c.prompt, /or 0 if none is complete/);
  assert.deepEqual(c.labels, ['Candidate 1', 'Candidate 2', 'Page 5']);
  assert.deepEqual(c.imagePaths, [inp.candidates[0].image, inp.candidates[1].image, inp.pageImage]);
  assert.deepEqual(r, { ok: true, index: 1, via: 'picker', calls: { picker: 1, verify: 0 }, notes: [] });
});

test('without a page image the prompt and the images name candidates only', async () => {
  const { pickRegion, pickerPrompt } = picker();
  const v = fakeVision(['1']);
  const r = await pickRegion(input({ pageImage: undefined, page: undefined }), v.fn, NO_VERIFY);
  assert.deepEqual(v.calls[0].labels, ['Candidate 1', 'Candidate 2']);
  assert.equal(v.calls[0].imagePaths.length, 2);
  assert.doesNotMatch(v.calls[0].prompt, /last image is the page/);
  assert.equal(r.ok, true);
  assert.equal(r.index, 0);
  assert.equal(pickerPrompt('Figure 4', CAPTION, 2, false), v.calls[0].prompt, 'pickRegion must send pickerPrompt verbatim');
});

test('a pinned request ends with no figure on a decline, a parse failure or a transport error', async () => {
  const { pickRegion } = picker();
  const cases: Array<[string | Error, string]> = [
    ['0', 'picker-declined'],
    ['I think the second one.', 'picker-unavailable'],
    ['3', 'picker-unavailable'],
    [new Error('socket hang up'), 'picker-unavailable'],
  ];
  for (const [reply, reason] of cases) {
    const v = fakeVision([reply]);
    const r = await pickRegion(input({ pinned: true }), v.fn, NO_VERIFY);
    assert.equal(r.ok, false, `pinned ${String(reply)} must not yield a figure`);
    assert.equal(r.reason, reason, `pinned ${String(reply)}`);
    assert.deepEqual(r.calls, { picker: 1, verify: 0 });
    assert.equal(v.calls.length, 1, 'no retry after a failed pick');
  }
});

test('an unpinned request takes the largest candidate only when the picker is unavailable', async () => {
  const { pickRegion } = picker();
  for (const reply of [new Error('ETIMEDOUT'), 'The figure is candidate two.']) {
    const v = fakeVision([reply]);
    const r = await pickRegion(input({ pinned: false }), v.fn, VERIFY);
    assert.equal(r.ok, true, `unpinned ${String(reply)} falls back`);
    assert.equal(r.index, 1, 'candidate 2 has the larger area');
    assert.equal(r.via, 'largest');
    assert.ok(r.notes.includes('picker-unavailable: largest region taken'), 'the fallback must be noted');
    assert.deepEqual(r.calls, { picker: 1, verify: 0 }, 'the largest-region fallback is never verified');
  }
  const tie = fakeVision([new Error('down')]);
  const same = await pickRegion(input({
    pinned: false,
    candidates: [{ image: img('t1.jpg'), region: rect(0, 0, 100, 100) }, { image: img('t2.jpg'), region: rect(200, 0, 300, 100) }],
  }), tie.fn, NO_VERIFY);
  assert.equal(same.index, 0, 'a tie on area takes the first candidate');
  const declined = await pickRegion(input({ pinned: false }), fakeVision(['0']).fn, NO_VERIFY);
  assert.equal(declined.ok, false);
  assert.equal(declined.reason, 'picker-declined', 'an unpinned decline has no fallback');
});

test('a single candidate is never sent to a model', async () => {
  const { pickRegion } = picker();
  const v = fakeVision([]);
  const one = input({ candidates: [{ image: img('only.jpg'), region: rect(10, 10, 200, 200) }] });
  for (const env of [NO_VERIFY, VERIFY]) {
    const r = await pickRegion(one, v.fn, env);
    assert.deepEqual(r, { ok: true, index: 0, via: 'single', calls: { picker: 0, verify: 0 }, notes: [] });
  }
  assert.equal(v.calls.length, 0);
  await assert.rejects(pickRegion(input({ candidates: [] }), v.fn, NO_VERIFY), 'zero candidates is a caller error');
});

test('FIGURE_VERIFY=1 adds exactly one yes/no call on the picked crop, and anything but yes rejects', async () => {
  const { pickRegion } = picker();
  const ok = fakeVision(['1', 'Yes.']);
  const inp = input();
  const r = await pickRegion(inp, ok.fn, VERIFY);
  assert.equal(ok.calls.length, 2);
  assert.equal(ok.calls[1].system, VERIFY_SYSTEM);
  assert.equal(ok.calls[1].prompt, VERIFY_PROMPT);
  assert.deepEqual(ok.calls[1].imagePaths, [inp.candidates[0].image]);
  assert.deepEqual(ok.calls[1].labels, ['Candidate 1']);
  assert.deepEqual(r, { ok: true, index: 0, via: 'picker', calls: { picker: 1, verify: 1 }, notes: [] });
  for (const pinned of [true, false]) {
    for (const second of ['no', 'maybe', new Error('verify transport')]) {
      const v = fakeVision(['2', second]);
      const out = await pickRegion(input({ pinned }), v.fn, VERIFY);
      assert.equal(out.ok, false, `verify ${String(second)} (pinned ${pinned}) must reject`);
      assert.equal(out.reason, 'verify-rejected');
      assert.deepEqual(out.calls, { picker: 1, verify: 1 });
    }
  }
  for (const env of [{ FIGURE_VERIFY: '0' }, {}, { FIGURE_VERIFY: 'yes' }]) {
    const v = fakeVision(['2']);
    await pickRegion(input(), v.fn, env);
    assert.equal(v.calls.length, 1, `FIGURE_VERIFY=${JSON.stringify(env)} must not verify`);
  }
});

test('at most six candidates are sent', async () => {
  const { pickRegion } = picker();
  const many = Array.from({ length: 8 }, (_, i) => ({ image: img(`m${i}.jpg`), region: rect(0, i * 10, 100, i * 10 + 9) }));
  const v = fakeVision(['6']);
  const r = await pickRegion(input({ candidates: many }), v.fn, NO_VERIFY);
  assert.deepEqual(v.calls[0].labels, ['Candidate 1', 'Candidate 2', 'Candidate 3', 'Candidate 4', 'Candidate 5', 'Candidate 6', 'Page 5']);
  assert.match(v.calls[0].prompt, /Candidates 1 to 6\b/);
  assert.equal(r.index, 5);
  const seven = fakeVision(['7']);
  const out = await pickRegion(input({ candidates: many, pinned: true }), seven.fn, NO_VERIFY);
  assert.equal(out.reason, 'picker-unavailable', 'a number above the sent count is unparseable');
});

test('renderPickerImages cuts each region and the page at 100 dpi as JPEG files', () => {
  const { renderPickerImages } = picker();
  const asset = load('src/figure-locator/asset');
  const dir = path.join(TMP, 'render');
  const out = renderPickerImages(heldPdf('w35275.pdf'), 5, [rect(100, 90, 300, 290), rect(120, 300, 480, 400)], dir);
  assert.ok(out, 'renderPickerImages must return the files');
  assert.equal(out.candidates.length, 2);
  for (const file of [...out.candidates, out.page]) {
    assert.ok(path.resolve(file).startsWith(path.resolve(dir) + path.sep), `${file} must be written inside the given directory`);
    const bytes = fs.readFileSync(file);
    assert.equal(asset.sniffImageType(bytes), 'jpg', `${file} must be a JPEG`);
  }
  const s1 = asset.imageSize(fs.readFileSync(out.candidates[0]));
  const s2 = asset.imageSize(fs.readFileSync(out.candidates[1]));
  const sp = asset.imageSize(fs.readFileSync(out.page));
  assert.ok(Math.abs(s1.width - 278) <= 3 && Math.abs(s1.height - 278) <= 3, `200x200 pt at 100 dpi is about 278 px, got ${s1.width}x${s1.height}`);
  assert.ok(Math.abs(s2.width - 500) <= 3 && Math.abs(s2.height - 139) <= 3, `360x100 pt at 100 dpi is about 500x139 px, got ${s2.width}x${s2.height}`);
  assert.ok(Math.abs(sp.width - 850) <= 3 && Math.abs(sp.height - 1100) <= 3, `a 612x792 page at 100 dpi is 850x1100 px, got ${sp.width}x${sp.height}`);
  assert.equal(renderPickerImages(path.join(TMP, 'missing.pdf'), 1, [rect(0, 0, 100, 100)], path.join(TMP, 'r2')), null);
});

test('the adapter is the single edit point: one runVision call, in picker.ts only', () => {
  const dir = path.join(REPO_ROOT, 'src', 'figure-locator');
  const src = fs.readFileSync(path.join(dir, 'picker.ts'), 'utf8');
  assert.match(src, /from '\.\.\/vision'/, 'picker.ts must import from ../vision');
  assert.equal((src.match(/\brunVision\(/g) ?? []).length, 1, 'picker.ts must call runVision exactly once');
  assert.doesNotMatch(src, /figure-vlm/, 'picker.ts must not import the legacy module');
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'picker.ts')) {
    assert.doesNotMatch(fs.readFileSync(path.join(dir, file), 'utf8'), /from '\.\.\/vision'/, `${file} must not call vision directly`);
  }
});
// AUTOMETTA-CONTRACT-END
