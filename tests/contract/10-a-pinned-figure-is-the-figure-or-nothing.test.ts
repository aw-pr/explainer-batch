// Contract test for stage-cards/10-a-pinned-figure-is-the-figure-or-nothing.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/10-a-pinned-figure-is-the-figure-or-nothing.test.ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.join(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-10-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/10-a-pinned-figure-is-the-figure-or-nothing.md
// Every knob figure-vlm reads at load time is pinned before src/ is loaded, so
// a fill-only .env cannot change the verdict, and no credential is real.
Object.assign(process.env, {
  EXPLAINER_STATE_FILE: path.join(TMP, 'state.json'),
  EXPLAINER_INPUT_DIR: path.join(TMP, 'input'),
  EXPLAINER_OUTPUT_DIR: path.join(TMP, 'output'),
  EXPLAINER_OBSIDIAN_DIR: '',
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
});

globalThis.fetch = (async () => {
  throw new Error('network access is forbidden in contract test 10');
}) as typeof fetch;

const vision = require('../../src/vision') as Record<string, unknown>;
const figure = require('../../src/figure-vlm') as Record<string, any>;

interface VisionCall { system: string; prompt: string; imagePaths: string[] }
type Reply = (call: VisionCall) => string;

// Replaces every vision call with a recorder. A call carrying more than one
// image is a selection (pages or candidates); a single-image call is a refine
// or a crop verification.
function stubVision(onSelect: Reply, onSingle: Reply | 'throw'): VisionCall[] {
  const calls: VisionCall[] = [];
  vision.visionAuthAvailable = () => true;
  vision.resolveVisionProvider = () => 'claude';
  vision.runVision = async (opts: { system?: string; prompt?: string; imagePaths?: string[] }) => {
    const call: VisionCall = { system: opts.system ?? '', prompt: opts.prompt ?? '', imagePaths: opts.imagePaths ?? [] };
    calls.push(call);
    if (call.imagePaths.length > 1) return { text: onSelect(call), route: 'api', provider: 'claude' };
    if (onSingle === 'throw') throw new Error('ECONNRESET (stubbed transport failure)');
    return { text: onSingle(call), route: 'api', provider: 'claude' };
  };
  return calls;
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

const PDF_PATH = path.join(TMP, 'paper.pdf');
fs.writeFileSync(PDF_PATH, buildPdf([{ w: 612, h: 792 }, { w: 612, h: 792 }]));

const BBOX = [0.1, 0.1, 0.6, 0.4];
function pdfSelection(label?: string): Reply {
  return () => JSON.stringify({
    found: true, page: 1, bbox: BBOX,
    ...(label ? { source_figure: label } : {}),
    caption: 'stub caption', alt_text: 'stub alt', confidence: 0.9,
  });
}
const SINGLE_OK: Reply = () => JSON.stringify({ found: true, bbox: BBOX, ok: true, reason: 'looks right' });
const SINGLE_REJECT: Reply = () => JSON.stringify({ found: true, bbox: BBOX, ok: false, reason: 'this is Figure 1, not Figure 3' });
const SINGLE_GARBAGE: Reply = () => 'I could not decide, sorry.';

const PIN = { source_figure: 'Figure 3' };

function runPdf(override?: { source_figure: string }) {
  return figure.extractFigureViaVlm({ pdfPath: PDF_PATH, override });
}

test('a confirmed pinned figure is returned under the pin, and every vision call names the pin', async () => {
  const calls = stubVision(pdfSelection('Figure 3'), SINGLE_OK);
  const result = await runPdf(PIN);
  assert.ok(result, 'a pinned figure that the selection and verification both confirm must be returned');
  assert.match(result.source_figure, /\b3\b/, 'the returned label must be the pinned figure');
  const singles = calls.filter(c => c.imagePaths.length === 1);
  assert.ok(singles.length > 0, 'the pinned PDF flow must verify the crop with a vision call');
  for (const c of calls) {
    assert.match(`${c.system}\n${c.prompt}`, /Figure 3/, 'every vision call for a pinned figure, verification included, must name the expected label');
  }
});

test('a pinned figure whose selection omits the label yields no figure', async () => {
  stubVision(pdfSelection(undefined), SINGLE_OK);
  assert.equal(await runPdf(PIN), null, 'an unlabelled pick must not be stamped with the pin');
});

test('a pinned figure whose selection reports a different label yields no figure', async () => {
  stubVision(pdfSelection('Figure 1'), SINGLE_OK);
  assert.equal(await runPdf(PIN), null, 'a pick reported as another figure must not be stamped with the pin');
});

test('a pinned figure whose verification reply cannot be parsed yields no figure', async () => {
  stubVision(pdfSelection('Figure 3'), SINGLE_GARBAGE);
  assert.equal(await runPdf(PIN), null, 'verification must fail closed for a pin on an unparseable reply');
});

test('a pinned figure whose verification call fails in transport yields no figure', async () => {
  stubVision(pdfSelection('Figure 3'), 'throw');
  assert.equal(await runPdf(PIN), null, 'verification must fail closed for a pin on a transport error');
});

test('a pinned figure the verifier rejects yields no figure', async () => {
  stubVision(pdfSelection('Figure 3'), SINGLE_REJECT);
  assert.equal(await runPdf(PIN), null, 'an explicit verifier rejection must still drop a pinned figure');
});

test('an unpinned pick is labelled from the selection', async () => {
  stubVision(pdfSelection('Figure 2'), SINGLE_OK);
  const result = await runPdf(undefined);
  assert.ok(result, 'an unpinned pick that verifies must be returned');
  assert.equal(result.source_figure, 'Figure 2');
});

test('an unpinned pick still fails open when verification cannot be parsed', async () => {
  stubVision(pdfSelection('Figure 2'), SINGLE_GARBAGE);
  const result = await runPdf(undefined);
  assert.ok(result, 'unpinned behaviour is unchanged: an unparseable verification still accepts the crop');
  assert.equal(result.source_figure, 'Figure 2');
});

test('an unpinned pick still fails open when verification fails in transport', async () => {
  stubVision(pdfSelection('Figure 2'), 'throw');
  const result = await runPdf(undefined);
  assert.ok(result, 'unpinned behaviour is unchanged: a verification transport error still accepts the crop');
  assert.equal(result.source_figure, 'Figure 2');
});

// Snapshot path: a real PNG asset served by a stubbed fetch.
const PNG_DIR = path.join(TMP, 'png');
fs.mkdirSync(PNG_DIR);
const render = spawnSync('pdftoppm', ['-png', '-r', '30', '-f', '1', '-l', '1', PDF_PATH, path.join(PNG_DIR, 'asset')]);
assert.equal(render.status, 0, 'pdftoppm must be on PATH for this contract test');
const PNG_BYTES = fs.readFileSync(path.join(PNG_DIR, fs.readdirSync(PNG_DIR).find(f => f.endsWith('.png'))!));

const CANDIDATES = [
  { imgSrc: 'https://example.invalid/fig1.png', figcaption: 'Figure 1: The hierarchy.', alt: 'fig one', sourceFigure: 'Figure 1' },
  { imgSrc: 'https://example.invalid/fig3.png', figcaption: 'Figure 3: The results.', alt: 'fig three', sourceFigure: 'Figure 3' },
];

function serveAssets(): void {
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input instanceof URL ? input : (input as { url?: string }).url ?? input);
    if (!url.startsWith('https://example.invalid/')) throw new Error(`unexpected fetch ${url}`);
    return new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } });
  }) as typeof fetch;
}

const CANDIDATE_PICK: Reply = () => JSON.stringify({ found: true, candidate: 2, source_figure: 'Figure 3', caption: 'c', alt_text: 'a', confidence: 0.9 });

test('the snapshot seam is exported', () => {
  assert.equal(typeof figure.extractFromSnapshot, 'function', 'extractFromSnapshot must be exported for this contract');
});

test('a pinned snapshot match is verified against the expected label', async () => {
  serveAssets();
  const calls = stubVision(CANDIDATE_PICK, SINGLE_OK);
  const result = await figure.extractFromSnapshot(CANDIDATES, 'claude', { named: 'Figure 3' }, false);
  assert.ok(result, 'a verified pinned snapshot asset must be returned');
  assert.equal(result.source_figure, 'Figure 3');
  const verifies = calls.filter(c => c.imagePaths.length === 1);
  assert.ok(verifies.length > 0, 'the pinned snapshot asset must go through crop verification');
  for (const c of verifies) assert.match(`${c.system}\n${c.prompt}`, /Figure 3/, 'snapshot verification must name the expected label');
});

test('a pinned snapshot match whose verification cannot be parsed yields no figure', async () => {
  serveAssets();
  stubVision(CANDIDATE_PICK, SINGLE_GARBAGE);
  assert.equal(await figure.extractFromSnapshot(CANDIDATES, 'claude', { named: 'Figure 3' }, false), null);
});

test('a pinned snapshot match whose verification fails in transport yields no figure', async () => {
  serveAssets();
  stubVision(CANDIDATE_PICK, 'throw');
  assert.equal(await figure.extractFromSnapshot(CANDIDATES, 'claude', { named: 'Figure 3' }, false), null);
});

test('an unpinned snapshot pick keeps its candidate label and is not dropped by an unparseable verification', async () => {
  serveAssets();
  stubVision(CANDIDATE_PICK, SINGLE_GARBAGE);
  const result = await figure.extractFromSnapshot(CANDIDATES, 'claude', {}, false);
  assert.ok(result, 'unpinned snapshot behaviour is unchanged');
  assert.equal(result.source_figure, 'Figure 3');
});

test('no live path stamps the pin over the selection as a fallback', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'src', 'figure-vlm.ts'), 'utf8');
  assert.ok(src.length > 1000, 'src/figure-vlm.ts must be readable');
  assert.doesNotMatch(src, /\bnamed\s*\?\?/, 'a `named ?? <selection label>` fallback stamps the pin on an unconfirmed pick');
});
// AUTOMETTA-CONTRACT-END
