import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parsePgm, type GreyMap, type Rect } from '../../src/figure-locator/geometry';
import { regionOnPage, type PageBlock } from '../../src/figure-locator/region';
import type { CaptionEntry } from '../../src/figure-locator/captions';

interface Snapshot {
  size: { w: number; h: number }; blocks: PageBlock[]; images: Rect[]; caption: CaptionEntry;
  grey: { width: number; height: number; inkRows: Array<Array<[number, number]>> };
}

function snapshot(name: string) {
  const file = path.join(__dirname, '../fixtures/figure-locator/region', `${name}.json`);
  const s = JSON.parse(fs.readFileSync(file, 'utf8')) as Snapshot;
  const data = new Uint8Array(s.grey.width * s.grey.height).fill(255);
  s.grey.inkRows.forEach((runs, y) => runs.forEach(([x0, x1]) => data.fill(0, y * s.grey.width + x0, y * s.grey.width + x1)));
  return { ...s, grey: { width: s.grey.width, height: s.grey.height, data } };
}

function near(actual: Rect, expected: Rect, tolerance = 6) {
  for (const key of ['x0', 'y0', 'x1', 'y1'] as const) {
    assert.ok(Math.abs(actual[key] - expected[key]) <= tolerance, `${key}: ${actual[key]} versus ${expected[key]}`);
  }
}

for (const c of [
  { name: 'w35275', page: 5, region: { x0: 128, y0: 95, x1: 488, y1: 282 }, embedded: false },
  { name: 'hu-2410.15332v3', page: 5, region: { x0: 54, y0: 69, x1: 541, y1: 280 }, embedded: false },
  { name: 'flyvbjerg', page: 9, region: { x0: 32, y0: 67, x1: 554, y1: 314 }, embedded: true },
]) {
  test(`offline ${c.name} measures the held figure from its caption, blocks, ink and images`, () => {
    const s = snapshot(c.name);
    const result = regionOnPage(s.size, s.blocks, s.grey, s.images, s.caption);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.page, c.page);
    assert.equal(result.label, s.caption.label);
    near(result.region, c.region);
    assert.equal(result.ambiguous, false);
    assert.deepEqual(result.candidates, [result.region]);
    assert.equal(result.provenance, c.embedded ? 'pdf-embedded' : 'pdf-vector-crop');
    if (c.embedded) {
      near(result.cropBox, { x0: 114, y0: 78, x1: 474, y1: 305 }, 2);
      near(result.contentBox, result.cropBox, 3);
      assert.ok(result.coverage >= 0.95);
      const forced = regionOnPage(s.size, s.blocks, s.grey, s.images, s.caption, { forceRegionCrop: true });
      assert.equal(forced.ok, true);
      if (forced.ok) {
        assert.equal(forced.provenance, 'pdf-vector-crop');
        assert.deepEqual(forced.cropBox, forced.region);
      }
    } else {
      assert.deepEqual(result.cropBox, result.region);
      if (c.name === 'w35275') assert.equal(result.coverage, 0);
      else {
        assert.ok(result.coverage > 0.15 && result.coverage < 0.35);
        assert.ok(result.region.y1 >= 276, 'the image strip extends past the last ink row');
      }
    }
  });
}

test('offline /Rotate 90 region uses the displayed 792 by 612 frame past x=612', () => {
  const s = snapshot('rotated');
  assert.deepEqual(s.size, { w: 792, h: 612 });
  const result = regionOnPage(s.size, s.blocks, s.grey, s.images, s.caption);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.region.x0 > 612);
  assert.ok(result.region.x1 > 612 && result.region.x1 <= 792);
  near(result.region, { x0: 628, y0: 196, x1: 716, y1: 404 }, 3);
});

function synthetic(rects: Rect[], extraBlocks: PageBlock[] = []) {
  const size = { w: 600, h: 800 };
  const grey: GreyMap = { width: 600, height: 800, data: new Uint8Array(600 * 800).fill(255) };
  for (const r of rects) for (let y = r.y0; y < r.y1; y++) grey.data.fill(0, y * grey.width + r.x0, y * grey.width + r.x1);
  const caption: CaptionEntry = {
    key: { noun: 'Figure', number: '2' }, label: 'Figure 2', page: 1,
    box: { xMin: 100, yMin: 700, xMax: 500, yMax: 710 }, text: 'Figure 2: Panels', continued: false,
  };
  const blocks: PageBlock[] = [
    { box: { x0: 100, y0: 700, x1: 500, y1: 710 }, lineCount: 1, wordCount: 3, text: caption.text },
    ...extraBlocks,
  ];
  return { size, grey, caption, blocks };
}

test('stacked panels retain the five nearest candidates in page order and union all bands', () => {
  const rects = Array.from({ length: 7 }, (_, i) => ({ x0: 150, x1: 400, y0: 332 + i * 50, y1: 362 + i * 50 }));
  const s = synthetic(rects);
  const result = regionOnPage(s.size, s.blocks, s.grey, [], s.caption, { notes: ['page-hint-ignored'] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.ambiguous, true);
  assert.equal(result.candidates.length, 6);
  near(result.candidates[0], { x0: 146, y0: 428, x1: 404, y1: 466 }, 0);
  near(result.candidates[4], { x0: 146, y0: 628, x1: 404, y1: 666 }, 0);
  near(result.region, { x0: 146, y0: 328, x1: 404, y1: 666 }, 0);
  assert.deepEqual(result.candidates[5], result.region);
  assert.deepEqual(result.notes, ['page-hint-ignored']);
});

test('an isolated horizontal rule stops the scan while dense figure rows remain content', () => {
  const s = synthetic([
    { x0: 150, x1: 400, y0: 640, y1: 680 },
    { x0: 0, x1: 600, y0: 630, y1: 631 },
    { x0: 150, x1: 400, y0: 570, y1: 610 },
  ]);
  const result = regionOnPage(s.size, s.blocks, s.grey, [], s.caption);
  assert.equal(result.ok, true);
  if (result.ok) {
    near(result.region, { x0: 146, y0: 636, x1: 404, y1: 684 }, 0);
    assert.equal(result.ambiguous, false);
  }
  const dense = synthetic([{ x0: 10, x1: 590, y0: 640, y1: 680 }]);
  const drawing = regionOnPage(dense.size, dense.blocks, dense.grey, [], dense.caption);
  assert.equal(drawing.ok, true);
  if (drawing.ok) near(drawing.region, { x0: 6, y0: 636, x1: 594, y1: 684 }, 0);
});

test('column captions measure their own column and stop before prose glyphs', () => {
  const prose = (x0: number, x1: number): PageBlock => ({
    box: { x0, x1, y0: 600, y1: 630 }, lineCount: 3, wordCount: 18,
    text: 'The prose block belongs to one of two columns and stops the figure scan.',
  });
  const s = synthetic([
    { x0: 70, x1: 230, y0: 640, y1: 680 },
    { x0: 350, x1: 550, y0: 650, y1: 680 },
    { x0: 70, x1: 230, y0: 599, y1: 631 },
  ], [prose(50, 270), prose(330, 550)]);
  s.caption.box = { xMin: 60, yMin: 700, xMax: 250, yMax: 710 };
  s.blocks[0].box = { x0: 60, y0: 700, x1: 250, y1: 710 };
  const result = regionOnPage(s.size, s.blocks, s.grey, [], s.caption);
  assert.equal(result.ok, true);
  if (result.ok) near(result.region, { x0: 66, y0: 636, x1: 234, y1: 684 }, 0);
});

test('no nearby ink, a 40-point gap and a tiny body stop with region-too-small', () => {
  for (const rects of [[], [{ x0: 100, x1: 400, y0: 500, y1: 600 }], [{ x0: 200, x1: 220, y0: 675, y1: 685 }]]) {
    const s = synthetic(rects);
    assert.deepEqual(regionOnPage(s.size, s.blocks, s.grey, [], s.caption), { ok: false, reason: 'region-too-small', notes: [] });
  }
});

test('P5 headers accept arbitrary whitespace and comments without consuming binary whitespace pixels', () => {
  const pixels = Buffer.from([10, 32, 13, 9, 0, 255]);
  for (const header of ['P5\t3\v2\f255\r\n', 'P5\n# scan\n3\t2\r255\n', 'P5  \r\n3 \t 2\n255\t\r\n ']) {
    const grey = parsePgm(Buffer.concat([Buffer.from(header), pixels]));
    assert.equal(grey.width, 3);
    assert.equal(grey.height, 2);
    assert.deepEqual(Array.from(grey.data), Array.from(pixels));
  }
  for (const invalid of ['P2\n3 2\n255\n', 'P5\n0 2\n255\n', 'P5\n3 2\n65535\n']) {
    assert.throws(() => parsePgm(Buffer.concat([Buffer.from(invalid), pixels])));
  }
  assert.throws(() => parsePgm(Buffer.from('P5\n3 2\n255\n\0')));
});

test('CLI rejects missing arguments and unknown flags with exit 2 before opening a PDF', () => {
  for (const args of [[], ['unused.pdf'], ['unused.pdf', 'Figure 1', '--unknown'], ['--force-region-crop', 'Figure 1']]) {
    const run = spawnSync(process.execPath, ['--require', 'ts-node/register', path.join(__dirname, '../../scripts/figure-region.ts'), ...args], {
      encoding: 'utf8', input: '', env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' },
    });
    assert.equal(run.status, 2, run.stderr);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /Usage:/);
  }
});
