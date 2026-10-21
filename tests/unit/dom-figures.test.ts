import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseFigureCandidates } from '../../src/preprocess';
import { dedupeDomCandidates, fromSnapshot, intersectionOverUnion, largestSrcsetEntry, resolveAssetUrl } from '../../src/figure-locator/dom-figures';
import { parseLabel } from '../../src/figure-locator/label';

const ANTHROPIC = fs.readFileSync(path.join(__dirname, '../fixtures/figure-locator/anthropic-expertise/page.html'), 'utf8');
const ARXIV = fs.readFileSync(path.join(__dirname, '../contract/fixtures/40-arxiv-source-step/html.html'), 'utf8');
const ARXIV_URL = 'https://arxiv.org/html/2410.15332v3';
const CDN = 'https://www-cdn.anthropic.com/images/4zrzovbb/website/';
const png = (w: number, h: number) => {
  const buf = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buf);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(w, 16);
  buf.writeUInt32BE(h, 20);
  return buf;
};

test('the Anthropic page gives eight labelled figures with unwrapped CDN URLs and no hero', () => {
  const cands = parseFigureCandidates(ANTHROPIC, 'https://www.anthropic.com/research/claude-code-expertise');
  assert.deepEqual(cands.map(c => c.label),
    ['Figure 1', 'Figure 2', 'Table 1', 'Figure 3', 'Figure 4', 'Table 2', 'Figure 5', 'Figure 6']);
  for (const c of cands) {
    assert.equal(c.sources?.length, 1);
    assert.ok(c.sources[0].startsWith(CDN) && c.sources[0].endsWith('.png'), c.sources[0]);
    assert.ok(c.imgSrc.startsWith('https://www.anthropic.com/_next/image?url='), 'imgSrc keeps its legacy wrapper');
  }
  assert.ok(!cands.some(c => c.sources?.some(s => s.includes('33af4a6c'))), 'the bare hero image is never a candidate');
});

test('the arXiv render gives its <object data> SVG figures, labelled from their captions', () => {
  const cands = parseFigureCandidates(ARXIV, ARXIV_URL);
  assert.deepEqual(cands.map(c => c.label), Array.from({ length: 10 }, (_, i) => `Figure ${i + 1}`));
  const f4 = cands[3];
  assert.equal(f4.imgSrc, '');
  assert.deepEqual(f4.sources, [`${ARXIV_URL}/fig-algo.svg`]);
  const svgs = cands.filter(c => c.imgSrc === '');
  assert.equal(svgs.length, 8);
  assert.ok(svgs.every(c => c.sources?.length === 1 && c.sources[0].endsWith('.svg')));
});

test('a LaTeXML id labels a figure whose caption carries none', () => {
  const s4f4 = /<figure id="S4\.F4"[\s\S]*?<\/figure>/.exec(ARXIV)![0].replace(/<figcaption\b[\s\S]*?<\/figcaption>/, '');
  const html = `${s4f4}\n<figure id="S2.T1"><img src="t1.png" alt=""></figure>`;
  assert.deepEqual(parseFigureCandidates(html, ARXIV_URL).map(c => c.label), ['Figure 4', 'Table 1']);
});

test('the snapshot parser keeps the cap of twenty candidates', () => {
  const html = Array.from({ length: 25 }, (_, i) => `<figure><img src="f${i}.png"><figcaption>Figure ${i + 1}: x.</figcaption></figure>`).join('\n');
  assert.equal(parseFigureCandidates(html, 'https://example.org/').length, 20);
});

test('srcset and _next/image helpers pick the largest entry and unwrap the inner URL', () => {
  assert.equal(largestSrcsetEntry('a.png 1x, b.png 2x'), 'b.png');
  assert.equal(largestSrcsetEntry('a.png 640w, b.png 1600w, c.png 800w'), 'b.png');
  assert.equal(largestSrcsetEntry('a.png, b.png 1.5x'), 'b.png', 'no descriptor counts as 1x');
  assert.equal(resolveAssetUrl('/_next/image?url=https%3A%2F%2Fcdn.example%2Fx.png&amp;w=3840&amp;q=75', 'https://site.example/a'),
    'https://cdn.example/x.png');
});

test('IoU keeps a two-image figure over its children and takes the image box for a one-image figure', () => {
  assert.equal(intersectionOverUnion({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 0, w: 10, h: 10 }), 50 / 150);
  const kept = dedupeDomCandidates([
    { key: 'two', tag: 'figure', x: 0, y: 0, w: 600, h: 400, label: 'Figure 1' },
    { key: 'a', tag: 'img', x: 0, y: 0, w: 290, h: 360, parent: 'two' },
    { key: 'b', tag: 'img', x: 310, y: 0, w: 290, h: 360, parent: 'two' },
    { key: 'one', tag: 'figure', x: 0, y: 500, w: 600, h: 440, label: 'Figure 2', caption: 'Two.' },
    { key: 'c', tag: 'img', x: 0, y: 500, w: 600, h: 400, parent: 'one' },
  ]);
  assert.deepEqual(kept.map(b => b.key), ['two', 'c']);
  assert.equal(kept[1].label, 'Figure 2');
  assert.equal(kept[1].caption, 'Two.');
});

test('fromSnapshot falls back to imgSrc for a candidate persisted without sources', async () => {
  const urls: string[] = [];
  const r = await fromSnapshot(
    [{ imgSrc: 'https://example.org/old.png', figcaption: 'Figure 3: old.', label: 'Figure 3' }],
    parseLabel('Figure 3')!,
    { fetchBytes: async url => { urls.push(url); return png(10, 20); } },
  );
  assert.equal(r.ok, true);
  assert.deepEqual(urls, ['https://example.org/old.png']);
  if (r.ok) assert.deepEqual([r.width, r.height, r.captionText], [10, 20, 'Figure 3: old.']);
});
