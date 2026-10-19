// Contract test for stage-cards/12-the-figure-picker-prefers-the-results-figure.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/12-the-figure-picker-prefers-the-results-figure.test.ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.join(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-12-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/12-the-figure-picker-prefers-the-results-figure.md
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
  PLAYWRIGHT_BROWSERS_PATH: path.join(TMP, 'no-browsers-here'),
});

let serve: (url: string) => Response = url => {
  throw new Error(`network access is forbidden in contract test 12 (${url})`);
};
globalThis.fetch = (async (input: unknown) => {
  const url = String(input instanceof URL ? input : (input as { url?: string }).url ?? input);
  return serve(url);
}) as typeof fetch;

const vision = require('../../src/vision') as Record<string, unknown>;
const figure = require('../../src/figure-vlm') as Record<string, any>;
const prompt = require('../../src/prompt') as Record<string, any>;

interface VisionCall { system: string; prompt: string; imagePaths: string[] }

function stubVision(onSelect: string, onSingle: string): VisionCall[] {
  const calls: VisionCall[] = [];
  vision.visionAuthAvailable = () => true;
  vision.resolveVisionProvider = () => 'claude';
  vision.runVision = async (opts: { system?: string; prompt?: string; imagePaths?: string[] }) => {
    const call: VisionCall = { system: opts.system ?? '', prompt: opts.prompt ?? '', imagePaths: opts.imagePaths ?? [] };
    calls.push(call);
    return { text: call.imagePaths.length > 1 ? onSelect : onSingle, route: 'api', provider: 'claude' };
  };
  return calls;
}

// A minimal two-page PDF; selection is answered with "no figure", so only the
// selection prompt matters.
function buildPdf(pageCount: number): Buffer {
  const objs: string[] = [];
  objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[1] = `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pageCount} >>`;
  for (let i = 0; i < pageCount; i++) {
    const content = '0.2 g 72 72 300 300 re f';
    objs[2 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R >>`;
    objs[3 + i * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  }
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

const PDF_PATH = path.join(TMP, 'paper.pdf');
fs.writeFileSync(PDF_PATH, buildPdf(2));

const CONTEXT = {
  headline: 'Agents ship code faster than they write it',
  subtitle: 'A field study',
  sectionLabels: ['Method', 'Results'],
  chartTitles: ['Throughput by team size', 'Defect rate over time'],
};

const STEERED_AWAY = /CONCEPTUAL|complementary|ALREADY recreates|duplicate/i;
const PREFERS_RESULTS = /key results figure/i;

function selectionText(calls: VisionCall[]): string {
  const sel = calls.find(c => c.imagePaths.length > 1);
  assert.ok(sel, 'a selection call carrying more than one image must have been made');
  return `${sel.system}\n${sel.prompt}`;
}

test('PDF figure selection prefers the key results figure even when the explainer has charts', async () => {
  const calls = stubVision('{"found": false}', '{"ok": true}');
  const result = await figure.extractFigureViaVlm({ pdfPath: PDF_PATH, context: CONTEXT });
  assert.equal(result, null);
  const text = selectionText(calls);
  assert.doesNotMatch(text, STEERED_AWAY, 'the selection prompt must not steer away from results plots');
  assert.match(text, PREFERS_RESULTS, 'the selection prompt must ask for the paper\'s key results figure');
  assert.match(text, /Agents ship code faster than they write it/, 'the explainer headline must still reach the selection prompt');
});

test('URL candidate selection prefers the key results figure even when the explainer has charts', async () => {
  const pngDir = path.join(TMP, 'png');
  fs.mkdirSync(pngDir, { recursive: true });
  const render = spawnSync('pdftoppm', ['-png', '-r', '30', '-f', '1', '-l', '1', PDF_PATH, path.join(pngDir, 'asset')]);
  assert.equal(render.status, 0, 'pdftoppm must be on PATH for this contract test');
  const png = fs.readFileSync(path.join(pngDir, fs.readdirSync(pngDir).find(f => f.endsWith('.png'))!));
  serve = url => {
    if (url.endsWith('.png')) return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    throw new Error(`unexpected fetch ${url}`);
  };
  const calls = stubVision(
    JSON.stringify({ found: true, candidate: 1, source_figure: 'Figure 1', caption: 'c', alt_text: 'a', confidence: 0.9 }),
    JSON.stringify({ ok: true, reason: 'fine' }),
  );
  await figure.extractFigureViaVlm({
    url: 'https://example.invalid/articles/agents',
    context: CONTEXT,
    snapshotCandidates: [
      { imgSrc: 'https://example.invalid/a.png', figcaption: 'Figure 1: A.', sourceFigure: 'Figure 1' },
      { imgSrc: 'https://example.invalid/b.png', figcaption: 'Figure 2: B.', sourceFigure: 'Figure 2' },
    ],
  });
  const text = selectionText(calls);
  assert.doesNotMatch(text, STEERED_AWAY, 'the candidate prompt must not steer away from results plots');
  assert.match(text, PREFERS_RESULTS, 'the candidate prompt must ask for the key results figure');
});

test('the synthesis instruction forbids the image block', () => {
  const text = prompt.buildUserInstruction('2026-10-19') as string;
  assert.ok(text.length > 200, 'buildUserInstruction must return the instruction');
  assert.doesNotMatch(text, /emit (it|them|the figure)? ?as an `image` block/i, 'the instruction must not ask for an image block');
  assert.match(text, /never emit[^.]*`image`/i, 'the instruction must say never to emit `image`');
  assert.match(text, /figure pipeline/i, 'the instruction must say the figure pipeline attaches the image');
  assert.match(text, /2026-10-19/, 'the date instruction must be unchanged');
  assert.match(text, /Return only a valid JSON object/, 'the JSON-only instruction must be unchanged');
});

test('the figure docs no longer describe conceptual steering as the design', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'FIGURE-EXTRACTION.md'), 'utf8');
  assert.ok(doc.length > 1000, 'docs/FIGURE-EXTRACTION.md must be readable');
  assert.doesNotMatch(doc, /complementary conceptual figure/i);
  assert.doesNotMatch(doc, /steers towards\s+a \*?conceptual\*? figure/i);
  assert.match(doc, /key results figure/i, 'the docs must state the new preference');
});
// AUTOMETTA-CONTRACT-END
