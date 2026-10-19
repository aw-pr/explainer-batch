// Contract test for stage-cards/11-figure-directives-and-pdf-urls-are-honoured.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/11-figure-directives-and-pdf-urls-are-honoured.test.ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-11-'));
for (const dir of ['input', 'output']) fs.mkdirSync(path.join(TMP, dir));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/11-figure-directives-and-pdf-urls-are-honoured.md
// Every knob read at load time is pinned before src/ is loaded, so a fill-only
// .env cannot change the verdict. PLAYWRIGHT_BROWSERS_PATH points at nothing,
// so no code path can start a browser or reach the network through one.
Object.assign(process.env, {
  EXPLAINER_STATE_FILE: path.join(TMP, 'state.json'),
  EXPLAINER_INPUT_DIR: path.join(TMP, 'input'),
  EXPLAINER_OUTPUT_DIR: path.join(TMP, 'output'),
  EXPLAINER_OBSIDIAN_DIR: '',
  EXPLAINER_JOBS_DIR: path.join(TMP, 'jobs'),
  WEBSITE_REPO: '',
  ANTHROPIC_API_KEY: 'contract-test-not-a-key',
  CLAUDE_CODE_OAUTH_TOKEN: '',
  OPENAI_API_KEY: 'contract-test-not-a-key',
  FIGURE_RECREATE: '0',
  FIGURE_VLM_MODEL: 'claude-sonnet-5-5',
  FIGURE_VLM_VERIFY_MODEL: 'claude-sonnet-5-5',
  FIGURE_VLM_VERIFY: '1',
  FIGURE_VLM_ATTEMPTS: '2',
  FIGURE_VLM_MAX_PAGES: '24',
  FIGURE_VLM_DPI: '300',
  FIGURE_VLM_PAD: '0.005',
  FIGURE_VLM_REFINE_PX: '2200',
  FIGURE_VLM_MAX_PX: '2200',
  FIGURE_VLM_JPEG_QUALITY: '90',
  PLAYWRIGHT_BROWSERS_PATH: path.join(TMP, 'no-browsers-here'),
});

let fetched: string[] = [];
let serve: (url: string) => Response = url => {
  throw new Error(`network access is forbidden in contract test 11 (${url})`);
};
globalThis.fetch = (async (input: unknown) => {
  const url = String(input instanceof URL ? input : (input as { url?: string }).url ?? input);
  fetched.push(url);
  return serve(url);
}) as typeof fetch;

const vision = require('../../src/vision') as Record<string, unknown>;
const figure = require('../../src/figure-vlm') as Record<string, any>;
const preprocess = require('../../src/preprocess') as Record<string, any>;

interface VisionCall { system: string; prompt: string; imagePaths: string[] }
type Reply = (call: VisionCall) => string;

// A call carrying more than one image is a selection; a single-image call is
// a refine or a crop verification.
function stubVision(onSelect: Reply, onSingle: Reply): VisionCall[] {
  const calls: VisionCall[] = [];
  vision.visionAuthAvailable = () => true;
  vision.resolveVisionProvider = () => 'claude';
  vision.runVision = async (opts: { system?: string; prompt?: string; imagePaths?: string[] }) => {
    const call: VisionCall = { system: opts.system ?? '', prompt: opts.prompt ?? '', imagePaths: opts.imagePaths ?? [] };
    calls.push(call);
    return { text: (call.imagePaths.length > 1 ? onSelect : onSingle)(call), route: 'api', provider: 'claude' };
  };
  return calls;
}

function captureWarnings<T>(fn: () => T): { value: T; warnings: string[] } {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
  try {
    return { value: fn(), warnings };
  } finally {
    console.warn = original;
  }
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 24;
  };
}

// Hand-built PDF: every page is covered by one 512x512 grey-noise image, so a
// crop anywhere on any page is never mistaken for a blank render.
function buildPdf(pages: Array<{ w: number; h: number; rotate?: number }>): Buffer {
  const n = 512;
  const next = lcg(7);
  const img = Buffer.alloc(n * n);
  for (let i = 0; i < img.length; i++) img[i] = next();
  const objs: Buffer[] = [];
  objs[0] = Buffer.from('<< /Type /Catalog /Pages 2 0 R >>');
  objs[1] = Buffer.from(`<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  objs[2] = Buffer.concat([
    Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${n} /Height ${n} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${img.length} >>\nstream\n`),
    img,
    Buffer.from('\nendstream'),
  ]);
  pages.forEach((p, i) => {
    const content = `q ${p.w} 0 0 ${p.h} 0 0 cm /Im0 Do Q`;
    objs[3 + i * 2] = Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.w} ${p.h}]${p.rotate ? ` /Rotate ${p.rotate}` : ''} ` +
      `/Resources << /XObject << /Im0 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    );
    objs[4 + i * 2] = Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  const offsets: number[] = [];
  let pos = parts[0].length;
  objs.forEach((o, i) => {
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]);
    offsets.push(pos);
    parts.push(b);
    pos += b.length;
  });
  parts.push(Buffer.from(
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`,
  ));
  return Buffer.concat(parts);
}

// Page 1 is US letter, page 2 is 400x200pt rotated 90 degrees (displayed
// 200x400), page 3 is 300x300. A crop computed from page 1's size is wrong on
// pages 2 and 3.
const PDF_BYTES = buildPdf([{ w: 612, h: 792 }, { w: 400, h: 200, rotate: 90 }, { w: 300, h: 300 }]);
const PDF_PATH = path.join(TMP, 'mixed.pdf');
fs.writeFileSync(PDF_PATH, PDF_BYTES);
const DPI = 300;

function pick(page: number, bbox: number[]): { select: Reply; single: Reply } {
  return {
    select: () => JSON.stringify({ found: true, page, bbox, source_figure: 'Figure 2', caption: 'c', alt_text: 'a', confidence: 0.9 }),
    single: () => JSON.stringify({ found: true, bbox, ok: true, reason: 'looks right' }),
  };
}

function pngSize(b64: string): { w: number; h: number } {
  const buf = Buffer.from(b64, 'base64');
  assert.equal(buf.toString('ascii', 1, 4), 'PNG', 'cropPngBase64 must be a PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

async function cropOf(page: number, bbox: number[]): Promise<{ w: number; h: number }> {
  const { select, single } = pick(page, bbox);
  stubVision(select, single);
  const result = await figure.extractFigureViaVlm({ pdfPath: PDF_PATH, keepCropPng: true });
  assert.ok(result, `a crop on page ${page} must be produced`);
  assert.equal(result.page, page);
  assert.ok(result.cropPngBase64, 'keepCropPng must return the crop PNG');
  return pngSize(result.cropPngBase64);
}

function assertNear(actual: number, displayedPts: number, fraction: number, what: string): void {
  const full = displayedPts * DPI / 72;
  assert.ok(actual >= full * (fraction - 0.05) && actual <= full * (fraction + 0.06),
    `${what}: ${actual}px is not about ${fraction} of the displayed page (${Math.round(full)}px)`);
}

// ---- Outcome 1: image_* directives build an override on their own ----

test('parseFocusDirectives is exported', () => {
  assert.equal(typeof preprocess.parseFocusDirectives, 'function');
});

test('a bare image_page_hint builds an override without pinning a figure', () => {
  const d = preprocess.parseFocusDirectives('image_page_hint: 7\nStress the cost findings.');
  assert.ok(d.imageOverride, 'image_page_hint alone must produce an imageOverride');
  assert.equal(d.imageOverride.pageHint, 7);
  assert.equal(d.imageOverride.source_figure, undefined, 'a page hint must not pin a figure name');
  assert.equal(d.focusHint, 'Stress the cost findings.');
});

test('a bare image_caption and image_alt build an override', () => {
  const d = preprocess.parseFocusDirectives('image_caption: Costs rise with scale.\nimage_alt: A rising line.');
  assert.ok(d.imageOverride, 'image_caption alone must produce an imageOverride');
  assert.equal(d.imageOverride.caption, 'Costs rise with scale.');
  assert.equal(d.imageOverride.alt_text, 'A rising line.');
  assert.equal(d.imageOverride.source_figure, undefined);
});

test('image: Figure N still pins and normalises the label', () => {
  const d = preprocess.parseFocusDirectives('image: fig. 3\nimage_caption: The main result.');
  assert.ok(d.imageOverride);
  assert.equal(d.imageOverride.source_figure, 'Figure 3');
  assert.equal(d.imageOverride.caption, 'The main result.');
});

test('an unknown image_* key is warned about and kept out of the focus hint', () => {
  const { value: d, warnings } = captureWarnings(() => preprocess.parseFocusDirectives('image_raster: true\nStress the cost findings.'));
  assert.ok(warnings.some(w => w.includes('image_raster')), 'an unknown image_* key must produce a warning naming it');
  assert.equal(d.focusHint, 'Stress the cost findings.', 'an unknown image_* directive must not reach the synthesis model');
});

test('a sidecar with no image_* key builds no override and warns nothing', () => {
  const { value: d, warnings } = captureWarnings(() => preprocess.parseFocusDirectives('Stress the cost findings.\nrecreate: Figure 2'));
  assert.equal(d.imageOverride, undefined);
  assert.equal(d.focusHint, 'Stress the cost findings.');
  assert.equal(d.recreate?.target, 'Figure 2');
  assert.deepEqual(warnings, []);
});

// ---- Outcome 2: a PDF URL is downloaded and takes the PDF path ----

test('a PDF URL is downloaded and its figure comes from the PDF path', async () => {
  fetched = [];
  serve = url => {
    if (url === 'https://example.invalid/papers/sample.pdf') {
      return new Response(PDF_BYTES, { status: 200, headers: { 'content-type': 'application/pdf' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const { select, single } = pick(1, [0.1, 0.1, 0.6, 0.4]);
  const calls = stubVision(select, single);
  const result = await figure.extractFigureViaVlm({ url: 'https://example.invalid/papers/sample.pdf' });
  assert.deepEqual(fetched, ['https://example.invalid/papers/sample.pdf'], 'the PDF URL must be fetched once, by the figure pipeline');
  assert.ok(result, 'a figure must be extracted from a downloaded PDF');
  assert.equal(result.page, 1, 'the result must come from the PDF path (it carries a page number)');
  assert.equal(calls[0]?.imagePaths.length, 3, 'selection must see one thumbnail per PDF page');
});

test('a failed PDF download yields no figure and does not throw', async () => {
  fetched = [];
  serve = () => new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  stubVision(() => '{"found": false}', () => '{"ok": true}');
  const result = await figure.extractFigureViaVlm({ url: 'https://example.invalid/papers/missing.pdf' });
  assert.equal(result, null);
  assert.ok(fetched.includes('https://example.invalid/papers/missing.pdf'), 'the PDF URL must have been requested');
});

test('an HTML URL with snapshot candidates is not downloaded as a PDF', async () => {
  const pngDir = path.join(TMP, 'png');
  fs.mkdirSync(pngDir, { recursive: true });
  const render = spawnSync('pdftoppm', ['-png', '-r', '30', '-f', '1', '-l', '1', PDF_PATH, path.join(pngDir, 'asset')]);
  assert.equal(render.status, 0, 'pdftoppm must be on PATH for this contract test');
  const png = fs.readFileSync(path.join(pngDir, fs.readdirSync(pngDir).find(f => f.endsWith('.png'))!));
  fetched = [];
  serve = url => {
    if (url.endsWith('.png')) return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    throw new Error(`unexpected fetch ${url}`);
  };
  stubVision(
    () => JSON.stringify({ found: true, candidate: 1, source_figure: 'Figure 1', caption: 'c', alt_text: 'a', confidence: 0.9 }),
    () => JSON.stringify({ ok: true, reason: 'fine' }),
  );
  const result = await figure.extractFigureViaVlm({
    url: 'https://example.invalid/articles/agents',
    snapshotCandidates: [
      { imgSrc: 'https://example.invalid/a.png', figcaption: 'Figure 1: A.', sourceFigure: 'Figure 1' },
      { imgSrc: 'https://example.invalid/b.png', figcaption: 'Figure 2: B.', sourceFigure: 'Figure 2' },
    ],
  });
  assert.ok(result, 'the snapshot path must still serve HTML sources');
  assert.equal(result.source_figure, 'Figure 1');
  assert.ok(!fetched.includes('https://example.invalid/articles/agents'), 'an HTML page URL must not be fetched as a PDF');
});

// ---- Outcome 3: crops use the size and rotation of the page that was picked ----

test('a crop on page 1 is unchanged', async () => {
  const size = await cropOf(1, [0.1, 0.1, 0.6, 0.4]);
  assertNear(size.w, 612, 0.51, 'page 1 width');
  assertNear(size.h, 792, 0.31, 'page 1 height');
});

test('a crop on a rotated page uses that page\'s displayed size', async () => {
  const size = await cropOf(2, [0, 0, 0.5, 0.5]);
  assertNear(size.w, 200, 0.505, 'rotated page 2 width');
  assertNear(size.h, 400, 0.505, 'rotated page 2 height');
});

test('a crop on a smaller page uses that page\'s own size', async () => {
  const size = await cropOf(3, [0.25, 0.25, 0.75, 0.75]);
  assertNear(size.w, 300, 0.51, 'page 3 width');
  assertNear(size.h, 300, 0.51, 'page 3 height');
});
// AUTOMETTA-CONTRACT-END
