import test from 'node:test';
import assert from 'node:assert/strict';
import { adjacentEmbeddedBox } from '../../src/figure-locator/pdf-embedded';
import type { CaptionEntry } from '../../src/figure-locator/captions';
import type { PageBlock } from '../../src/figure-locator/region';
import * as captions from '../../src/figure-locator/captions';
import * as geometry from '../../src/figure-locator/geometry';
import * as regions from '../../src/figure-locator/region';
import * as crops from '../../src/figure-locator/pdf-crop';
import { locateEmbeddedFigure } from '../../src/figure-locator/pdf-embedded';
import type { FigureRequest } from '../../src/figure-locator/request';

const caption: CaptionEntry = {
  key: { noun: 'Figure', number: '1' }, label: 'Figure 1', page: 7,
  box: { xMin: 72, yMin: 697.157517, xMax: 523.275892, yMax: 731.081453 },
  text: 'Figure 1. Business outcome metrics.', continued: false,
};
const image = { x0: 72, y0: 324, x1: 523, y1: 686 };
const block = (box: PageBlock['box']): PageBlock => ({ box, text: 'Body text', lineCount: 1, wordCount: 2 });

test('the complete embedded four-panel image wins over preceding table and one-line prose', () => {
  assert.deepEqual(adjacentEmbeddedBox(caption, [image], [
    block({ x0: 72, y0: 287, x1: 523, y1: 298 }),
    block({ x0: 72, y0: 303, x1: 88, y1: 314 }),
  ]), image);
});

test('caption adjacency declines ambiguous images, distant images, text contamination and partial panels', () => {
  assert.equal(adjacentEmbeddedBox(caption, [image, { ...image, x0: 80 }], []), null);
  assert.equal(adjacentEmbeddedBox(caption, [image, { x0: 72, x1: 523, y0: 740, y1: 800 }], []), null);
  assert.equal(adjacentEmbeddedBox(caption, [{ ...image, y1: 650 }], []), null);
  assert.equal(adjacentEmbeddedBox(caption, [image], [block({ x0: 72, y0: 689, x1: 523, y1: 696 })]), null);
  assert.equal(adjacentEmbeddedBox(caption, [image], [block({ x0: 100, y0: 500, x1: 200, y1: 510 })]), null);
  assert.equal(adjacentEmbeddedBox({ ...caption, key: { ...caption.key, panel: 'a' } }, [image], []), null);
  assert.equal(adjacentEmbeddedBox(caption, [{ ...image, x1: 250 }], []), null);
});


const request: FigureRequest = {
  label: { noun: 'Figure', number: '1' }, pinned: true, forceRegionCrop: false,
  source: { pdfPath: 'test.pdf' },
};

test('native capture preserves requested label, caption, page, bytes and provenance; page hints stay advisory', t => {
  const bytes = Buffer.from('source image bytes');
  t.mock.method(captions, 'buildCaptionIndex', () => [caption]);
  t.mock.method(geometry, 'imageBoxes', () => [image]);
  t.mock.method(regions, 'pageBlocks', () => []);
  t.mock.method(crops, 'embeddedImagePpi', () => 350);
  const crop = t.mock.method(crops, 'cropPdfRegion', () => ({ bytes, width: 2205, height: 1770, dpi: 350 }));
  const result = locateEmbeddedFigure({ ...request, pageHint: 1 });
  assert.ok(result);
  assert.equal(result.captionText, caption.text);
  assert.deepEqual(result.label, request.label);
  assert.equal(result.page, 7);
  assert.equal(result.provenance, 'pdf-embedded');
  assert.equal(result.bytes, bytes);
  assert.deepEqual(result.calls, { picker: 0, verify: 0 });
  assert.deepEqual(result.notes, ['page-hint-ignored']);
  assert.deepEqual(crop.mock.calls[0].arguments, ['test.pdf', 7, image, 350]);
});

test('duplicate caption labels, missing labels and failed PDF tools fall through', t => {
  const index = t.mock.method(captions, 'buildCaptionIndex', () => [caption, { ...caption, page: 9 }]);
  assert.equal(locateEmbeddedFigure(request), null);
  index.mock.mockImplementation(() => []);
  assert.equal(locateEmbeddedFigure(request), null);
  index.mock.mockImplementation(() => { throw new Error('missing poppler'); });
  assert.equal(locateEmbeddedFigure(request), null);
});

test('panels, forced region crops and absent PDFs never enter native capture', t => {
  const index = t.mock.method(captions, 'buildCaptionIndex', () => { throw new Error('must not open PDF'); });
  assert.equal(locateEmbeddedFigure({ ...request, label: { noun: 'Figure', number: '1', panel: 'b' } }), null);
  assert.equal(locateEmbeddedFigure({ ...request, forceRegionCrop: true }), null);
  assert.equal(locateEmbeddedFigure({ ...request, source: {} }), null);
  assert.equal(index.mock.callCount(), 0);
});
