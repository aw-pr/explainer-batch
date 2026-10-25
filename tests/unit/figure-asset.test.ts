import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assetFileName, imageSize, pngSizePx, sniffImageType } from '../../src/figure-locator/asset';

const HEADERS = path.join(__dirname, '../fixtures/figure-locator/headers');
const fixture = (name: string) => fs.readFileSync(path.join(HEADERS, name));

for (const [name, type, width, height] of [
  ['png-640x480.png', 'png', 640, 480],
  ['jpeg-2012x845.jpg', 'jpg', 2012, 845],
  ['gif-33x17.gif', 'gif', 33, 17],
  ['webp-vp8x-1500x946.webp', 'webp', 1500, 946],
  ['webp-vp8l-300x200.webp', 'webp', 300, 200],
  ['webp-vp8-320x240.webp', 'webp', 320, 240],
] as const) {
  test(`${name} is sniffed as ${type} and read as ${width} by ${height} from its header`, () => {
    const buf = fixture(name);
    assert.equal(sniffImageType(buf), type);
    assert.deepEqual(imageSize(buf), { width, height });
  });
}

test('the JPEG reader skips DHT to reach a progressive SOF2', () => {
  const buf = fixture('jpeg-2012x845.jpg');
  assert.ok(buf.includes(Buffer.from([0xff, 0xc4])) && buf.includes(Buffer.from([0xff, 0xc2])));
  assert.deepEqual(imageSize(buf), { width: 2012, height: 845 });
});

test('the minimal VP8L header is 25 bytes and is enough', () => {
  assert.equal(fixture('webp-vp8l-300x200.webp').length, 25);
});

test('an SVG behind an XML declaration and a doctype is sniffed and has no pixel size', () => {
  const buf = fixture('doctype.svg');
  assert.equal(sniffImageType(buf), 'svg');
  assert.equal(imageSize(buf), null);
});

test('HTML carrying an inline SVG is not an image', () => {
  const buf = fixture('page.html');
  assert.equal(sniffImageType(buf), null);
  assert.equal(imageSize(buf), null);
});

test('truncated headers give no size', () => {
  assert.equal(imageSize(fixture('png-640x480.png').subarray(0, 20)), null);
  assert.equal(imageSize(fixture('jpeg-2012x845.jpg').subarray(0, 30)), null);
  assert.equal(imageSize(fixture('webp-vp8x-1500x946.webp').subarray(0, 24)), null);
});

test('pngSizePx reads a PNG file and declines anything else', () => {
  assert.deepEqual(pngSizePx(path.join(HEADERS, 'png-640x480.png')), { w: 640, h: 480 });
  assert.equal(pngSizePx(path.join(HEADERS, 'gif-33x17.gif')), null);
  assert.equal(pngSizePx(path.join(HEADERS, 'missing.png')), null);
});

test('assetFileName lower-cases noun and number and appends the panel', () => {
  assert.equal(assetFileName({ noun: 'Figure', number: '3' }, 'jpg'), 'figure-3.jpg');
  assert.equal(assetFileName({ noun: 'Figure', number: '2', panel: 'b' }, 'jpg'), 'figure-2b.jpg');
  assert.equal(assetFileName({ noun: 'Table', number: '2' }, 'png'), 'table-2.png');
  assert.equal(assetFileName({ noun: 'Figure', number: 'A1' }, 'webp'), 'figure-a1.webp');
  assert.equal(assetFileName({ noun: 'Figure', number: '' }, 'svg'), 'figure.svg');
  assert.equal(assetFileName(null, 'jpg'), 'figure.jpg');
});
