// Contract test for stage-cards/27-page-geometry-and-region-rule.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/27-page-geometry-and-region-rule.test.ts
// Needs poppler (pdfinfo, pdftotext, pdftoppm, pdftohtml) and the held PDFs: $EXPLAINER_HELD_DIR, else input/_held/ here, else ../explainer-batch/input/_held/.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.join(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-27-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/27-page-geometry-and-region-rule.md
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

const geometry = () => load('src/figure-locator/geometry');
const region = () => load('src/figure-locator/region');
const checks = () => load('src/figure-locator/checks');

type Rect = { x0: number; y0: number; x1: number; y1: number };
function near(actual: Rect, want: [number, number, number, number], tol: number, what: string) {
  assert.ok(actual && [actual.x0, actual.y0, actual.x1, actual.y1].every(Number.isFinite), `${what}: not a rect: ${JSON.stringify(actual)}`);
  const got = [actual.x0, actual.y0, actual.x1, actual.y1];
  got.forEach((v, i) => assert.ok(Math.abs(v - want[i]) <= tol, `${what}: got ${got.map(n => n.toFixed(1)).join(',')} want ${want.join(',')} within ${tol}`));
}

// A one-page PDF in top-left points: rects are filled grey boxes, texts are
// Helvetica lines. Rotate writes /Rotate on the page.
interface SynthPage { rects?: Rect[]; texts?: Array<{ x: number; y: number; size: number; text: string }>; rotate?: number }
function buildPdf(file: string, pg: SynthPage): string {
  const ops: string[] = [];
  for (const r of pg.rects ?? []) ops.push(`0.2 g ${r.x0} ${792 - r.y1} ${r.x1 - r.x0} ${r.y1 - r.y0} re f`);
  for (const t of pg.texts ?? []) ops.push(`BT /F1 ${t.size} Tf 0 g ${t.x} ${792 - t.y} Td (${t.text}) Tj ET`);
  const content = ops.join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]${pg.rotate ? ` /Rotate ${pg.rotate}` : ''} /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(file, body);
  return file;
}

const PARAGRAPH = [
  'The results in this section are drawn from the full sample of projects and',
  'the estimates are stable across the robustness checks we report in the',
  'appendix, so the main text discusses only the central specification here.',
].map((text, i) => ({ x: 72, y: 470 + 14 * i, size: 11, text }));

test('pageSizePts reports the displayed frame, swapping width and height for /Rotate 90', () => {
  const { pageSizePts, pageCount } = geometry();
  const flat = buildPdf(path.join(TMP, 'flat.pdf'), { texts: [{ x: 72, y: 100, size: 12, text: 'Figure 1: Flat' }] });
  const rot = buildPdf(path.join(TMP, 'rot.pdf'), { texts: [{ x: 72, y: 100, size: 12, text: 'Figure 1: Rotated' }], rotate: 90 });
  assert.deepEqual(pageSizePts(flat, 1), { w: 612, h: 792 });
  assert.deepEqual(pageSizePts(rot, 1), { w: 792, h: 612 });
  assert.equal(pageCount(heldPdf('w35275.pdf')), 97);
  assert.equal(pageSizePts(path.join(TMP, 'missing.pdf'), 1), null);
});

test('parsePgm reads a binary PGM header and pixels with no dependency', () => {
  const { parsePgm, renderGrey } = geometry();
  const buf = Buffer.concat([Buffer.from('P5\n3 2\n255\n', 'latin1'), Buffer.from([0, 128, 255, 10, 20, 30])]);
  const g = parsePgm(buf);
  assert.equal(g.width, 3);
  assert.equal(g.height, 2);
  assert.deepEqual(Array.from(g.data), [0, 128, 255, 10, 20, 30]);
  const rot = buildPdf(path.join(TMP, 'rot2.pdf'), { texts: [{ x: 72, y: 100, size: 12, text: 'Figure 1: Rotated' }], rotate: 90 });
  const rendered = renderGrey(rot, 1, 72);
  assert.equal(rendered.width, 792);
  assert.equal(rendered.height, 612);
  assert.equal(rendered.data.length, 792 * 612);
});

test('imageBoxes reads pdftohtml boxes in points and writes nothing beside the source PDF', () => {
  const { imageBoxes } = geometry();
  const fly = heldPdf('flyvbjerg-it-cost-risk.pdf');
  const before = fs.readdirSync(path.dirname(fly)).sort();
  const boxes = imageBoxes(fly, 9) as Rect[];
  assert.equal(boxes.length, 1);
  near(boxes[0], [114, 78, 474, 305], 1, 'Flyvbjerg page 9 image box');
  const epic = imageBoxes(heldPdf('2410.15332v3.pdf'), 5) as Rect[];
  assert.equal(epic.length, 5);
  assert.ok(epic.some(b => Math.abs(b.x0 - 335) <= 1 && Math.abs(b.x1 - b.x0 - 206) <= 1 && Math.abs(b.y1 - b.y0 - 114) <= 1), JSON.stringify(epic));
  assert.equal(imageBoxes(heldPdf('w35275.pdf'), 5).length, 0);
  assert.deepEqual(fs.readdirSync(path.dirname(fly)).sort(), before, 'pdftohtml wrote files next to the held PDFs');
});

test('locateRegion: EPIC Figure 4 is a full-width vector crop stopped by the running header', () => {
  const r = region().locateRegion(heldPdf('2410.15332v3.pdf'), 'Figure 4');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.page, 5);
  assert.equal(r.label, 'Figure 4');
  near(r.region, [54, 69, 541, 280], 6, 'EPIC region');
  assert.equal(r.provenance, 'pdf-vector-crop');
  assert.ok(r.coverage > 0.15 && r.coverage < 0.35, `EPIC coverage ${r.coverage}, the strip is about 24 percent`);
  assert.equal(r.ambiguous, false);
  assert.equal(r.candidates.length, 1);
});

test('locateRegion: w35275 Figure 1 sits below its caption (NBER style) and stops at the Notes block', () => {
  const r = region().locateRegion(heldPdf('w35275.pdf'), 'Figure 1');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.page, 5);
  near(r.region, [128, 95, 488, 282], 6, 'w35275 region');
  assert.equal(r.provenance, 'pdf-vector-crop');
  assert.equal(r.coverage, 0);
  assert.equal(r.ambiguous, false);
});

test('locateRegion: Flyvbjerg Figure 3 keeps its frame and takes the embedded image at 100 percent of the content extents', () => {
  const fly = heldPdf('flyvbjerg-it-cost-risk.pdf');
  const r = region().locateRegion(fly, 'Figure 3');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.page, 9);
  near(r.region, [32, 67, 554, 314], 6, 'Flyvbjerg region (the framed box)');
  assert.equal(r.provenance, 'pdf-embedded');
  near(r.cropBox, [114, 78, 474, 305], 2, 'Flyvbjerg crop box (the image box)');
  near(r.contentBox, [114, 78, 474, 305], 3, 'Flyvbjerg content extents');
  assert.ok(r.coverage >= 0.95, `coverage ${r.coverage}`);

  const forced = region().locateRegion(fly, 'Figure 3', { forceRegionCrop: true });
  assert.equal(forced.ok, true);
  assert.equal(forced.provenance, 'pdf-vector-crop');
  assert.deepEqual(forced.cropBox, forced.region);
});

test('locateRegion: a missing label, a missing PDF and a tiny body each stop with a named reason', () => {
  const { locateRegion } = region();
  const missing = locateRegion(heldPdf('w35275.pdf'), 'Figure 14');
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'label-not-found');
  assert.equal(missing.labels.length, 17);
  assert.equal(locateRegion(path.join(TMP, 'nope.pdf'), 'Figure 1').reason, 'source-unavailable');

  const tiny = buildPdf(path.join(TMP, 'tiny.pdf'), {
    rects: [{ x0: 200, y0: 360, x1: 220, y1: 370 }],
    texts: [{ x: 120, y: 400, size: 10, text: 'Figure 1: A very small mark' }, ...PARAGRAPH],
  });
  const t = locateRegion(tiny, 'Figure 1');
  assert.equal(t.ok, false, JSON.stringify(t));
  assert.equal(t.reason, 'region-too-small');
});

test('locateRegion: two bands 20 points apart above a caption are ambiguous candidates plus their union', () => {
  const pdf = buildPdf(path.join(TMP, 'stacked.pdf'), {
    rects: [{ x0: 150, y0: 200, x1: 400, y1: 260 }, { x0: 150, y0: 280, x1: 400, y1: 340 }],
    texts: [{ x: 120, y: 380, size: 10, text: 'Figure 2: Two panels stacked' }, ...PARAGRAPH],
  });
  const r = region().locateRegion(pdf, 'Figure 2');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.ambiguous, true);
  assert.equal(r.candidates.length, 3);
  near(r.candidates[0], [146, 196, 404, 264], 4, 'upper band');
  near(r.candidates[1], [146, 276, 404, 344], 4, 'lower band');
  near(r.candidates[2], [146, 196, 404, 344], 4, 'union');
  near(r.region, [146, 196, 404, 344], 4, 'region is the union');
  assert.equal(r.provenance, 'pdf-vector-crop');

  const single = buildPdf(path.join(TMP, 'single.pdf'), {
    rects: [{ x0: 150, y0: 250, x1: 400, y1: 340 }],
    texts: [{ x: 120, y: 380, size: 10, text: 'Figure 2: One panel' }, ...PARAGRAPH],
  });
  const one = region().locateRegion(single, 'Figure 2');
  assert.equal(one.ok, true, JSON.stringify(one));
  assert.equal(one.ambiguous, false);
  near(one.region, [146, 246, 404, 344], 4, 'single band region');
});

test('looksBlank rejects tiny and empty crops and keeps real ones', () => {
  const { looksBlank } = checks();
  const white = buildPdf(path.join(TMP, 'white.pdf'), {});
  const out = path.join(TMP, 'white');
  spawnSync('pdftoppm', ['-png', '-r', '150', '-f', '1', '-l', '1', white, out]);
  const whitePng = fs.readdirSync(TMP).map(f => path.join(TMP, f)).find(f => f.startsWith(out) && f.endsWith('.png'));
  assert.ok(whitePng, 'pdftoppm wrote no PNG');
  assert.equal(looksBlank(whitePng, { w: 1275, h: 1650 }), true);
  assert.equal(looksBlank(whitePng, { w: 40, h: 400 }), true);
  const fly = path.join(TMP, 'fly');
  spawnSync('pdftoppm', ['-png', '-r', '50', '-f', '9', '-l', '9', heldPdf('flyvbjerg-it-cost-risk.pdf'), fly]);
  const flyPng = fs.readdirSync(TMP).map(f => path.join(TMP, f)).find(f => f.startsWith(fly) && f.endsWith('.png'));
  assert.ok(flyPng);
  assert.equal(looksBlank(flyPng, { w: 407, h: 544 }), false);
});

test('scripts/figure-region.ts prints the located region as JSON and exits 1 on a stop', () => {
  const script = path.join(REPO_ROOT, 'scripts', 'figure-region.ts');
  assert.ok(fs.existsSync(script), 'scripts/figure-region.ts does not exist');
  const run = (args: string[]) => spawnSync(process.execPath, ['--require', 'ts-node/register', script, ...args], {
    cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' },
  });
  const ok = run([heldPdf('2410.15332v3.pdf'), 'Figure 4']);
  assert.equal(ok.status, 0, ok.stderr);
  const json = JSON.parse(ok.stdout.trim().split('\n').pop()!);
  assert.equal(json.page, 5);
  near(json.region, [54, 69, 541, 280], 6, 'CLI EPIC region');
  assert.equal(json.provenance, 'pdf-vector-crop');
  const stop = run([heldPdf('w35275.pdf'), 'Figure 14']);
  assert.equal(stop.status, 1);
  assert.equal(JSON.parse(stop.stdout.trim().split('\n').pop()!).reason, 'label-not-found');
});

test('the legacy module is untouched and the new modules do not import it', () => {
  for (const rel of ['src/figure-locator/geometry.ts', 'src/figure-locator/region.ts', 'src/figure-locator/checks.ts']) {
    assert.doesNotMatch(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'), /figure-vlm/, `${rel} imports the legacy module`);
  }
  const legacy = fs.readFileSync(path.join(REPO_ROOT, 'src', 'figure-vlm.ts'), 'utf8');
  for (const fn of ['function pageSizePts(', 'function pageCount(', 'export function renderPdfPage(', 'function looksBlank(']) {
    assert.ok(legacy.includes(fn), `src/figure-vlm.ts lost ${fn}; it stays until W10`);
  }
});
// AUTOMETTA-CONTRACT-END
