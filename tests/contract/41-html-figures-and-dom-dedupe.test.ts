// Contract test for stage-cards/41-html-figures-and-dom-dedupe.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/41-html-figures-and-dom-dedupe.test.ts
// No network: snapshot fetches go through an injected fake. The live-page case uses a local file:// page and is
// skipped only when Playwright's Chromium cannot be launched from this seat.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = path.join(__dirname, '..', '..');
const FIXTURES = path.join(__dirname, 'fixtures', '41-html-figures-and-dom-dedupe');
const ARXIV_HTML = path.join(__dirname, 'fixtures', '40-arxiv-source-step', 'html.html');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-41-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/41-html-figures-and-dom-dedupe.md
function load(rel: string): Record<string, any> {
  const file = path.join(REPO_ROOT, rel);
  assert.ok(fs.existsSync(file + '.ts'), `${rel}.ts does not exist`);
  return require(file) as Record<string, any>;
}
const dom = () => load('src/figure-locator/dom-figures');
const preprocess = () => load('src/preprocess');
const read = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const labelKey = (noun: string, number: string, panel?: string) => ({ noun, number, ...(panel ? { panel } : {}) });

const ANTHROPIC_URL = 'https://www.anthropic.com/research/claude-code-expertise';
const CDN = 'https://www-cdn.anthropic.com/images/4zrzovbb/website/';
const ANTHROPIC = [
  ['Figure 1', 'b0c229bb9765b65716dfdf1cd0bedc2713037288-1920x1080.png'],
  ['Figure 2', 'c8c039a010b96ad191a3a9b7dfe6ad01adb410bf-1920x1080.png'],
  ['Table 1', 'ffb14937444e81d80b38d7b085438b61d5ea46ff-1850x1830.png'],
  ['Figure 3', 'a72b63aceab4eadb0baa5799a69cc3ff211e7462-1920x1080.png'],
  ['Figure 4', 'c72f140ee2d30cdf1385e425098fb698b7c5d74c-1920x1080.png'],
  ['Table 2', '54cae744dadf523561ef80b448161fef13991420-1850x1487.png'],
  ['Figure 5', '140578bc2523d4945c016d72e69628d2692228c8-1920x1080.png'],
  ['Figure 6', '3d2d5df2002152c1a010a139deadab4a7e593a39-1920x1080.png'],
];
const LEGACY_IMG_SRC_1 = 'https://www.anthropic.com/_next/image?url=https%3A%2F%2Fwww-cdn.anthropic.com%2Fimages%2F4zrzovbb%2Fwebsite%2Fb0c229bb9765b65716dfdf1cd0bedc2713037288-1920x1080.png&amp;w=3840&amp;q=75';

const u32be = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const png = (w: number, h: number) => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), u32be(13), Buffer.from('IHDR'), u32be(w), u32be(h), Buffer.from([8, 2, 0, 0, 0]), u32be(0)]);
const u32le = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u24le = (n: number) => Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]);
function webp(w: number, h: number): Buffer {
  const payload = Buffer.concat([Buffer.from([0, 0, 0, 0]), u24le(w - 1), u24le(h - 1)]);
  const body = Buffer.concat([Buffer.from('WEBP'), Buffer.from('VP8X'), u32le(payload.length), payload]);
  return Buffer.concat([Buffer.from('RIFF'), u32le(body.length), body]);
}
function fakeFetch(map: Record<string, Buffer | Error>): { fn: (url: string) => Promise<Buffer>; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fn: async (url: string) => {
      urls.push(url);
      const hit = map[url];
      if (!hit) throw new Error(`HTTP 404 ${url}`);
      if (hit instanceof Error) throw hit;
      return hit;
    },
  };
}

test('dom-figures exports its contract', () => {
  const d = dom();
  for (const name of ['intersectionOverUnion', 'dedupeDomCandidates', 'loadPlaywright', 'renderReady', 'fromSnapshot', 'fromLivePage']) {
    assert.equal(typeof d[name], 'function', `${name} must be exported`);
  }
});

test('the Anthropic page yields its eight figures in order, labelled from --figure-label, with unwrapped CDN URLs', () => {
  const cands = preprocess().parseFigureCandidates(read('anthropic-expertise.html'), ANTHROPIC_URL);
  assert.equal(cands.length, 8, 'eight <figure> elements, and never the bare hero image');
  assert.deepEqual(cands.map((c: any) => c.label), ANTHROPIC.map(([label]) => label));
  assert.deepEqual(cands.map((c: any) => c.sources), ANTHROPIC.map(([, file]) => [CDN + file]),
    'src and both srcset entries unwrap to one CDN URL, recorded once');
  assert.ok(!cands.some((c: any) => c.sources.some((s: string) => s.includes('33af4a6c00c03400eaae6a07d7836cd1d97ea3a5'))), 'the hero image is not a candidate');
});

test('fields the legacy snapshot path reads are unchanged', () => {
  const cands = preprocess().parseFigureCandidates(read('anthropic-expertise.html'), ANTHROPIC_URL);
  assert.equal(cands[0].imgSrc, LEGACY_IMG_SRC_1, 'imgSrc stays exactly what today\'s parser records');
  assert.equal(cands[0].figcaption, 'The nine modes of work: Each interactive session is classified into the single mode that best describes what it is trying to accomplish.');
  assert.equal(cands[0].alt, '');
  assert.equal(cands[0].sourceFigure, undefined, 'sourceFigure still reads only the figcaption text');
  const arxiv = preprocess().parseFigureCandidates(fs.readFileSync(ARXIV_HTML, 'utf8'), 'https://arxiv.org/html/2410.15332v3');
  const withImg = arxiv.filter((c: any) => c.imgSrc !== '');
  assert.deepEqual(withImg.map((c: any) => [c.imgSrc, c.sourceFigure, c.alt]), [
    ['https://arxiv.org/html/2410.15332v3/fig-intro-positioning.png', 'Figure 1', 'Refer to caption'],
    ['https://arxiv.org/html/2410.15332v3/fig-eval-zero.png', 'Figure 7', 'Refer to caption'],
  ]);
});

test('the arXiv render yields <object data> SVG candidates, labelled, with an empty imgSrc', () => {
  const cands = preprocess().parseFigureCandidates(fs.readFileSync(ARXIV_HTML, 'utf8'), 'https://arxiv.org/html/2410.15332v3');
  assert.equal(cands.length, 10);
  assert.deepEqual(cands.map((c: any) => c.label), Array.from({ length: 10 }, (_, i) => `Figure ${i + 1}`));
  const f4 = cands[3];
  assert.deepEqual(f4.sources, ['https://arxiv.org/html/2410.15332v3/fig-algo.svg']);
  assert.equal(f4.imgSrc, '', 'a figure with no <img> has an empty imgSrc, which the legacy fetch drops');
  assert.equal(f4.sourceFigure, 'Figure 4');
});

test('every label source and asset source is read, in the stated order', () => {
  const cands = preprocess().parseFigureCandidates(read('sources.html'), 'https://example.org/articles/page');
  assert.deepEqual(cands.map((c: any) => c.label), ['Figure 7', 'Table 3', 'Figure 2b', 'Figure 4', 'Figure 3'],
    'aria-label, data-label, caption text with a panel, caption text over --figure-label, LaTeXML id; a figure with no asset is skipped');
  assert.deepEqual(cands[0].sources, [
    'https://example.org/p/fallback.png', 'https://example.org/p/fallback-2x.png', 'https://example.org/p/large.webp',
  ], 'img src, the largest img srcset entry, then the largest picture source entry');
  assert.equal(cands[0].imgSrc, 'https://example.org/p/fallback.png');
  assert.deepEqual(cands[1].sources, ['https://example.org/articles/t3.svg']);
  assert.deepEqual(cands[2].sources, ['https://example.org/articles/two-a.png', 'https://example.org/articles/two-b.png']);
});

test('without any <figure>, wrappers match by whole class token only', () => {
  const cands = preprocess().parseFigureCandidates(read('wrappers.html'), 'https://example.org/x');
  assert.deepEqual(cands.map((c: any) => c.imgSrc), [
    'https://example.org/a/chart.png', 'https://example.org/a/plot.png', 'https://example.org/a/fig.png',
  ], 'typography, paragraph and prefigured are not tokens chart, figure, graph or plot');
  assert.deepEqual(cands.map((c: any) => c.sources), [
    ['https://example.org/a/chart.png'], ['https://example.org/a/plot.png'], ['https://example.org/a/fig.png'],
  ]);
});

test('true IoU with wrapper preference replaces overlap over the smaller area', () => {
  const { intersectionOverUnion, dedupeDomCandidates } = dom();
  assert.equal(intersectionOverUnion({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 }), 1);
  assert.equal(intersectionOverUnion({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 }), 0);
  assert.equal(intersectionOverUnion({ x: 0, y: 0, w: 800, h: 600 }, { x: 100, y: 100, w: 200, h: 150 }), 0.0625);
  const boxes = [
    { key: 'f1', tag: 'figure', x: 0, y: 0, w: 600, h: 400, label: 'Figure 1' },
    { key: 'a1', tag: 'img', x: 10, y: 10, w: 280, h: 300, parent: 'f1' },
    { key: 'a2', tag: 'img', x: 300, y: 10, w: 280, h: 300, parent: 'f1' },
    { key: 'f2', tag: 'figure', x: 0, y: 500, w: 600, h: 420, label: 'Figure 2', caption: 'The second caption.' },
    { key: 'b1', tag: 'img', x: 0, y: 500, w: 600, h: 380, parent: 'f2' },
    { key: 'c1', tag: 'svg', x: 0, y: 1000, w: 500, h: 300 },
    { key: 'c2', tag: 'canvas', x: 5, y: 1005, w: 490, h: 290 },
    { key: 'd1', tag: 'img', x: 0, y: 1400, w: 400, h: 300 },
    { key: 'd2', tag: 'img', x: 0, y: 1500, w: 400, h: 300 },
    { key: 'e1', tag: 'div', x: 0, y: 2000, w: 800, h: 600 },
    { key: 'e2', tag: 'img', x: 100, y: 2100, w: 200, h: 150 },
  ];
  const kept = dedupeDomCandidates(boxes);
  assert.deepEqual(kept.map((b: any) => b.key), ['f1', 'b1', 'c2', 'd1', 'd2', 'e1', 'e2'],
    'a two-image figure stays and its children go; a one-image figure becomes its image; IoU >= 0.7 keeps the smaller; IoU < 0.7 keeps both');
  const b1 = kept.find((b: any) => b.key === 'b1');
  assert.equal(b1.label, 'Figure 2', 'the one-image figure carries its label to the image');
  assert.equal(b1.caption, 'The second caption.', 'and its caption');
});

test('fromSnapshot returns the labelled asset as fetched, sniffed, with no vision call', async () => {
  const { fromSnapshot } = dom();
  const cands = preprocess().parseFigureCandidates(read('anthropic-expertise.html'), ANTHROPIC_URL);
  const bytes = png(1920, 1080);
  const f = fakeFetch({ [CDN + ANTHROPIC[6][1]]: bytes });
  const r = await fromSnapshot(cands, labelKey('Figure', '5'), { fetchBytes: f.fn });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(f.urls, [CDN + ANTHROPIC[6][1]], 'only the matched figure is fetched');
  assert.equal(r.provenance, 'dom-asset');
  assert.equal(r.ext, 'png');
  assert.equal(r.width, 1920);
  assert.equal(r.height, 1080);
  assert.ok(Buffer.compare(r.bytes, bytes) === 0, 'the original bytes, never a re-encoded copy');
  assert.equal(r.source, CDN + ANTHROPIC[6][1]);
  assert.deepEqual(r.label, labelKey('Figure', '5'));
  assert.match(r.captionText, /^Expertise and how sessions end:/);

  const table = await fromSnapshot(cands, labelKey('Table', '1'), { fetchBytes: fakeFetch({ [CDN + ANTHROPIC[2][1]]: png(1850, 1830) }).fn });
  assert.equal(table.ok, true, 'Table 1 is its own label, not Figure 1');
  assert.equal(table.source, CDN + ANTHROPIC[2][1]);

  const none = await fromSnapshot(cands, labelKey('Figure', '9'), { fetchBytes: fakeFetch({}).fn });
  assert.equal(none.ok, false);
  assert.equal(none.reason, 'label-not-found');
  assert.deepEqual(none.labels, ANTHROPIC.map(([label]) => label));
});

test('fromSnapshot tries each source in order and skips what is not an image', async () => {
  const { fromSnapshot } = dom();
  const cands = preprocess().parseFigureCandidates(read('sources.html'), 'https://example.org/articles/page');
  const f = fakeFetch({
    'https://example.org/p/fallback.png': new Error('ETIMEDOUT'),
    'https://example.org/p/fallback-2x.png': Buffer.from('<!DOCTYPE html><html>not found</html>'),
    'https://example.org/p/large.webp': webp(1600, 900),
  });
  const r = await fromSnapshot(cands, labelKey('Figure', '7'), { fetchBytes: f.fn });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(f.urls, ['https://example.org/p/fallback.png', 'https://example.org/p/fallback-2x.png', 'https://example.org/p/large.webp']);
  assert.equal(r.ext, 'webp');
  assert.equal(r.source, 'https://example.org/p/large.webp');
  assert.equal(r.width, 1600);

  const svg = await fromSnapshot(cands, labelKey('Table', '3'), {
    fetchBytes: fakeFetch({ 'https://example.org/articles/t3.svg': Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>') }).fn,
  });
  assert.equal(svg.ok, true);
  assert.equal(svg.ext, 'svg');
  assert.equal('width' in svg, false, 'an SVG has no width key');
  assert.equal('height' in svg, false, 'an SVG has no height key');

  const dead = await fromSnapshot(cands, labelKey('Figure', '2'), { fetchBytes: fakeFetch({}).fn });
  assert.equal(dead.ok, false);
  assert.equal(dead.reason, 'source-unavailable');
});

test('fromLivePage matches by label in a real browser without resizing the viewport', async t => {
  const d = dom();
  const pw = await d.loadPlaywright();
  if (!pw) { t.skip('playwright is not installed'); return; }
  let browser: any;
  try { browser = await pw.chromium.launch(); } catch (e) { t.skip(`chromium cannot launch here: ${(e as Error).message.split('\n')[0]}`); return; }
  await browser.close();
  const dir = path.join(TMP, 'live');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'b.png'), png(4, 4));
  fs.writeFileSync(path.join(dir, 'page.html'), [
    '<!DOCTYPE html><html><body style="margin:0">',
    '<img src="hero.png" width="800" height="300" alt="hero">',
    '<figure style="margin:0"><img src="a.png" width="600" height="300" alt=""><figcaption style="--figure-label:&quot;Figure 1&quot;">One.</figcaption></figure>',
    '<figure style="margin:0"><img src="b.png" width="600" height="300" alt=""><figcaption style="--figure-label:&quot;Figure 2&quot;">Two.</figcaption></figure>',
    '<figure style="margin:0"><canvas id="c" width="400" height="200"></canvas><figcaption>Figure 3: a drawn chart.</figcaption></figure>',
    '<script>const g=document.getElementById("c").getContext("2d");g.fillStyle="#036";g.fillRect(20,20,360,160);</script>',
    '</body></html>',
  ].join('\n'));
  const pageUrl = pathToFileURL(path.join(dir, 'page.html')).href;
  const bUrl = pathToFileURL(path.join(dir, 'b.png')).href;
  const f = fakeFetch({ [bUrl]: png(4, 4) });
  const r = await d.fromLivePage(pageUrl, labelKey('Figure', '2'), { fetchBytes: f.fn });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.provenance, 'dom-asset');
  assert.equal(r.source, bUrl);
  assert.deepEqual(f.urls, [bUrl]);
  const shot = await d.fromLivePage(pageUrl, labelKey('Figure', '3'), { fetchBytes: fakeFetch({}).fn });
  assert.equal(shot.ok, true, `a canvas figure is an element screenshot: ${JSON.stringify(shot)}`);
  assert.equal(shot.ext, 'png');
  assert.equal(shot.source, 'screenshot');
  assert.ok(shot.width >= 400 && shot.height >= 200, `the screenshot covers the canvas, got ${shot.width}x${shot.height}`);
  const miss = await d.fromLivePage(pageUrl, labelKey('Figure', '4'), { fetchBytes: fakeFetch({}).fn });
  assert.equal(miss.reason, 'label-not-found');
  assert.deepEqual(miss.labels, ['Figure 1', 'Figure 2', 'Figure 3']);
});

test('no class substring selectors, no viewport resize, no vision, no legacy import in the new module', () => {
  const files = ['src/figure-locator/dom-figures.ts', 'src/preprocess.ts', 'src/state.ts'];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    assert.doesNotMatch(src, /class\*="graph" i|class\*="figure" i/, `${rel} still matches class substrings`);
  }
  for (const file of fs.readdirSync(path.join(REPO_ROOT, 'src', 'figure-locator')).filter(f => f.endsWith('.ts'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(REPO_ROOT, 'src', 'figure-locator', file), 'utf8'), /setViewportSize/, `${file} resizes the viewport`);
  }
  const mod = fs.readFileSync(path.join(REPO_ROOT, 'src', 'figure-locator', 'dom-figures.ts'), 'utf8');
  assert.doesNotMatch(mod, /figure-vlm/);
  assert.doesNotMatch(mod, /from '\.\.\/vision'/);
  const state = fs.readFileSync(path.join(REPO_ROOT, 'src', 'state.ts'), 'utf8');
  assert.match(state, /interface FigureCandidate \{[\s\S]*?\blabel\?: string;[\s\S]*?\}/, 'FigureCandidate gains an optional label');
  assert.match(state, /interface FigureCandidate \{[\s\S]*?\bsources\?: string\[\];[\s\S]*?\}/, 'FigureCandidate gains optional sources');
  assert.match(state, /interface FigureCandidate \{[\s\S]*?\bimgSrc: string;[\s\S]*?\}/, 'imgSrc stays a required string');
});
// AUTOMETTA-CONTRACT-END
