// Contract test for stage-cards/28-pixel-space-crop-and-sidecar-asset.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/28-pixel-space-crop-and-sidecar-asset.test.ts
// Needs poppler (pdfinfo, pdftotext, pdftoppm, pdftohtml, pdfimages) and the held PDFs: $EXPLAINER_HELD_DIR, else input/_held/ here, else ../explainer-batch/input/_held/.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.join(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-28-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/28-pixel-space-crop-and-sidecar-asset.md
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

const asset = () => load('src/figure-locator/asset');
const crop = () => load('src/figure-locator/pdf-crop');

const u16be = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u16le = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32be = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const u32le = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u24le = (n: number) => Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]);

function png(w: number, h: number): Buffer {
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), u32be(13), Buffer.from('IHDR'), u32be(w), u32be(h), Buffer.from([8, 2, 0, 0, 0]), u32be(0)]);
}
function jpeg(w: number, h: number): Buffer {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0]), u16be(16), Buffer.from('JFIF\0'), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])]);
  const dht = Buffer.concat([Buffer.from([0xff, 0xc4]), u16be(6), Buffer.from([0, 1, 2, 3])]);
  const sof = Buffer.concat([Buffer.from([0xff, 0xc0]), u16be(17), Buffer.from([8]), u16be(h), u16be(w), Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, dht, sof, Buffer.from([0xff, 0xd9])]);
}
function gif(w: number, h: number): Buffer {
  return Buffer.concat([Buffer.from('GIF89a'), u16le(w), u16le(h), Buffer.from([0, 0, 0, 0x3b])]);
}
function riff(chunk: string, payload: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from('WEBP'), Buffer.from(chunk), u32le(payload.length), payload]);
  return Buffer.concat([Buffer.from('RIFF'), u32le(body.length), body]);
}
const webpVp8x = (w: number, h: number) => riff('VP8X', Buffer.concat([Buffer.from([0, 0, 0, 0]), u24le(w - 1), u24le(h - 1)]));
const webpVp8l = (w: number, h: number) => riff('VP8L', Buffer.concat([Buffer.from([0x2f]), u32le(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14))]));
const webpVp8 = (w: number, h: number) => riff('VP8 ', Buffer.concat([Buffer.from([0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a]), u16le(w), u16le(h), Buffer.alloc(4)]));

function buildPdf(file: string, rotate?: number): string {
  const content = '0.2 g 72 72 300 300 re f';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]${rotate ? ` /Rotate ${rotate}` : ''} /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
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

function runCrop(pdf: string, label: string, out: string) {
  const script = path.join(REPO_ROOT, 'scripts', 'figure-crop.ts');
  assert.ok(fs.existsSync(script), 'scripts/figure-crop.ts does not exist');
  const run = spawnSync(process.execPath, ['--require', 'ts-node/register', script, pdf, label, out], {
    cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' },
  });
  return { run, json: run.stdout.trim() ? JSON.parse(run.stdout.trim().split('\n').pop()!) : null };
}

test('sniffImageType and imageSize read PNG, JPEG, GIF and the three WebP headers without decoding', () => {
  const { sniffImageType, imageSize } = asset();
  const cases: Array<[string, Buffer, string, number, number]> = [
    ['png', png(640, 480), 'png', 640, 480],
    ['jpeg', jpeg(2012, 845), 'jpg', 2012, 845],
    ['gif', gif(33, 17), 'gif', 33, 17],
    ['webp VP8X', webpVp8x(1500, 946), 'webp', 1500, 946],
    ['webp VP8L', webpVp8l(300, 200), 'webp', 300, 200],
    ['webp VP8', webpVp8(320, 240), 'webp', 320, 240],
  ];
  assert.equal(webpVp8l(300, 200).length, 25, 'the VP8L fixture is the minimal 25-byte header');
  for (const [what, buf, type, w, h] of cases) {
    assert.equal(sniffImageType(buf), type, what);
    assert.deepEqual(imageSize(buf), { width: w, height: h }, what);
  }
});

test('sniffImageType recognises SVG, which has no pixel size, and rejects other bytes', () => {
  const { sniffImageType, imageSize } = asset();
  const svgs = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
    '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    '\n  <!-- exported --><svg viewBox="0 0 4 4"></svg>',
  ];
  for (const s of svgs) {
    assert.equal(sniffImageType(Buffer.from(s)), 'svg', s);
    assert.equal(imageSize(Buffer.from(s)), null, s);
  }
  assert.equal(sniffImageType(Buffer.from('%PDF-1.4 not an image')), null);
  assert.equal(sniffImageType(Buffer.from('<html><body></body></html>')), null);
  assert.equal(imageSize(Buffer.from('hello')), null);
});

test('assetFileName follows the label: figure-3.jpg, figure-2b.jpg, table-2.png, figure.jpg', () => {
  const { assetFileName } = asset();
  assert.equal(assetFileName({ noun: 'Figure', number: '3' }, 'jpg'), 'figure-3.jpg');
  assert.equal(assetFileName({ noun: 'Figure', number: '2', panel: 'b' }, 'jpg'), 'figure-2b.jpg');
  assert.equal(assetFileName({ noun: 'Table', number: '2' }, 'png'), 'table-2.png');
  assert.equal(assetFileName({ noun: 'Figure', number: 'A1' }, 'webp'), 'figure-a1.webp');
  assert.equal(assetFileName(null, 'jpg'), 'figure.jpg');
});

test('writeAsset writes the file and returns sha256, size, page and provenance', () => {
  const { writeAsset } = asset();
  const dir = path.join(TMP, 'assets', 'nested');
  const bytes = png(64, 48);
  const rec = writeAsset(dir, { noun: 'Figure', number: '2', panel: 'b' }, bytes, { page: 4, provenance: 'pdf-vector-crop', label: 'Figure 2b' });
  assert.equal(rec.asset, 'figure-2b.png');
  assert.equal(rec.file, path.join(dir, 'figure-2b.png'));
  assert.deepEqual(fs.readFileSync(rec.file), bytes);
  assert.equal(rec.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(rec.width, 64);
  assert.equal(rec.height, 48);
  assert.equal(rec.page, 4);
  assert.equal(rec.provenance, 'pdf-vector-crop');
  assert.equal(rec.label, 'Figure 2b');
  const svg = writeAsset(dir, { noun: 'Figure', number: '7' }, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), { provenance: 'dom-asset' });
  assert.equal(svg.asset, 'figure-7.svg');
  for (const k of ['width', 'height', 'page', 'label']) assert.ok(!(k in svg), `an unknown ${k} is absent from the record, not undefined`);
  assert.throws(() => writeAsset(dir, null, Buffer.from('not an image'), { provenance: 'dom-asset' }));
});

test('renderDpiFor and embeddedImagePpi: 300 dpi, raised to the raster ppi for pdf-embedded, capped at 600', () => {
  const { renderDpiFor, embeddedImagePpi } = crop();
  assert.equal(renderDpiFor('pdf-vector-crop', 469), 300);
  assert.equal(renderDpiFor('pdf-embedded', 469), 469);
  assert.equal(renderDpiFor('pdf-embedded', 150), 300);
  assert.equal(renderDpiFor('pdf-embedded', 900), 600);
  assert.equal(renderDpiFor('pdf-embedded', null), 300);
  assert.equal(embeddedImagePpi(heldPdf('flyvbjerg-it-cost-risk.pdf'), 9), 300);
  assert.equal(embeddedImagePpi(heldPdf('2410.15332v3.pdf'), 5), 617);
  assert.equal(embeddedImagePpi(heldPdf('w35275.pdf'), 5), null);
});

test('cropPdfRegion cuts in the displayed frame: a box past x 612 on a /Rotate 90 page keeps its full width', () => {
  const { cropPdfRegion } = crop();
  const { imageSize, sniffImageType } = asset();
  const rot = buildPdf(path.join(TMP, 'rot.pdf'), 90);
  const out = cropPdfRegion(rot, 1, { x0: 600, y0: 100, x1: 700, y1: 200 }, 300);
  assert.ok(out, 'no crop from the rotated page');
  assert.equal(sniffImageType(out.bytes), 'jpg');
  assert.ok(Math.abs(out.width - 417) <= 1 && Math.abs(out.height - 417) <= 1, `rotated crop ${out.width}x${out.height}, want about 417x417`);
  assert.deepEqual(imageSize(out.bytes), { width: out.width, height: out.height });
  const flat = buildPdf(path.join(TMP, 'flat.pdf'));
  const edge = cropPdfRegion(flat, 1, { x0: 600, y0: 100, x1: 700, y1: 200 }, 300);
  assert.ok(edge && edge.width <= 51, 'an unrotated page is clamped at its 612-point edge');
});

test('scripts/figure-crop.ts writes figure-4.jpg for EPIC at 300 dpi with a full record', () => {
  const out = path.join(TMP, 'epic');
  const { run, json } = runCrop(heldPdf('2410.15332v3.pdf'), 'Figure 4', out);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(json.asset, 'figure-4.jpg');
  const file = path.join(out, 'figure-4.jpg');
  assert.ok(fs.existsSync(file));
  const bytes = fs.readFileSync(file);
  assert.equal(json.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(asset().imageSize(bytes), { width: json.width, height: json.height });
  assert.ok(json.width >= 1950 && json.width <= 2150, `EPIC crop width ${json.width}, about 2012`);
  assert.ok(json.height >= 820 && json.height <= 940, `EPIC crop height ${json.height}, about 845`);
  assert.equal(json.page, 5);
  assert.equal(json.provenance, 'pdf-vector-crop');
  assert.equal(json.label, 'Figure 4');
});

test('scripts/figure-crop.ts takes the Flyvbjerg image box as pdf-embedded at 1500 by 946', () => {
  const out = path.join(TMP, 'fly');
  const { run, json } = runCrop(heldPdf('flyvbjerg-it-cost-risk.pdf'), 'Figure 3', out);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(json.asset, 'figure-3.jpg');
  assert.equal(json.provenance, 'pdf-embedded');
  assert.equal(json.page, 9);
  assert.ok(Math.abs(json.width - 1500) <= 1 && Math.abs(json.height - 946) <= 1, `${json.width}x${json.height}`);
});

test('scripts/figure-crop.ts --force-region-crop renders the framed region instead of the embedded image', () => {
  const script = path.join(REPO_ROOT, 'scripts', 'figure-crop.ts');
  const out = path.join(TMP, 'fly-forced');
  const run = spawnSync(process.execPath, ['--require', 'ts-node/register', script, heldPdf('flyvbjerg-it-cost-risk.pdf'), 'Figure 3', out, '--force-region-crop'], {
    cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' },
  });
  assert.equal(run.status, 0, run.stderr);
  const json = JSON.parse(run.stdout.trim().split('\n').pop()!);
  assert.equal(json.provenance, 'pdf-vector-crop');
  assert.ok(json.width > 2050 && json.width < 2300, `forced crop width ${json.width}, about 522 points at 300 dpi`);
});

test('scripts/figure-crop.ts stops with a reason and writes nothing for a missing label', () => {
  const out = path.join(TMP, 'none');
  const { run, json } = runCrop(heldPdf('w35275.pdf'), 'Figure 14', out);
  assert.equal(run.status, 1);
  assert.equal(json.reason, 'label-not-found');
  assert.ok(!fs.existsSync(out) || fs.readdirSync(out).length === 0);
});

test('no sips, no sharp and no legacy import in the locator; the legacy module is untouched', () => {
  const dir = path.join(REPO_ROOT, 'src', 'figure-locator');
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(src, /['"]sips['"]/, `${f} calls sips`);
    assert.doesNotMatch(src, /from ['"]sharp['"]|require\(['"]sharp['"]\)/, `${f} imports sharp`);
    assert.doesNotMatch(src, /figure-vlm/, `${f} imports the legacy module`);
  }
  for (const f of ['asset.ts', 'pdf-crop.ts']) assert.ok(fs.existsSync(path.join(dir, f)), `${f} missing`);
  const legacy = fs.readFileSync(path.join(REPO_ROOT, 'src', 'figure-vlm.ts'), 'utf8');
  for (const fn of ['function pngSizePx(', 'function encodeJpegDataUrl(', 'function cropPdfBboxPng(']) {
    assert.ok(legacy.includes(fn), `src/figure-vlm.ts lost ${fn}; it stays until W10`);
  }
});
// AUTOMETTA-CONTRACT-END
