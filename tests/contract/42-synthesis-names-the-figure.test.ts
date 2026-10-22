// Contract test for stage-cards/42-synthesis-names-the-figure.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/42-synthesis-names-the-figure.test.ts
// Needs poppler (pdfinfo, pdftotext, pdftoppm, pdftohtml, pdfimages) and the held PDFs: $EXPLAINER_HELD_DIR, else input/_held/ here, else ../explainer-batch/input/_held/.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-42-'));
for (const dir of ['input', 'output']) fs.mkdirSync(path.join(TMP, dir));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/42-synthesis-names-the-figure.md
// Every knob read at load time is pinned before src/ is loaded, so a fill-only .env cannot change the verdict.
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
  FIGURE_VERIFY: '',
  FIGURE_ARXIV_SOURCE: '0',
});
globalThis.fetch = (async () => { throw new Error('network access is forbidden in contract test 42'); }) as typeof fetch;

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
const request = () => load('src/figure-locator/request');
const locator = () => load('src/figure-locator/index');
const preprocess = () => load('src/preprocess');
const prompt = () => load('src/prompt');
const labelKey = (noun: string, number: string, panel?: string) => ({ noun, number, ...(panel ? { panel } : {}) });

let visionCalls = 0;
const vision = require('../../src/vision') as Record<string, unknown>;
vision.runVision = async () => { visionCalls += 1; throw new Error('vision must not be called in contract test 42'); };

const W35275_LABELS = [
  'Figure 1', 'Figure 2', 'Figure 3', 'Table 1', 'Figure 4', 'Table 2', 'Table 3', 'Figure 5', 'Table 4',
  'Figure 6', 'Figure 7', 'Table 5', 'Figure 8', 'Figure 9', 'Figure 10', 'Figure 11', 'Figure 12',
];

function captureWarnings<T>(fn: () => T): { value: T; warnings: string[] } {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
  try { return { value: fn(), warnings }; } finally { console.warn = original; }
}

test('request and locator modules export their contract', () => {
  assert.equal(typeof request().buildFigureRequest, 'function');
  assert.equal(typeof request().detectArxivId, 'function');
  assert.equal(typeof locator().locateFigure, 'function');
});

test('detectArxivId reads arXiv URLs, then the reference, then the source ref, then the first page', () => {
  const { detectArxivId } = request();
  assert.equal(detectArxivId({ url: 'https://arxiv.org/abs/2410.15332v3' }), '2410.15332v3');
  assert.equal(detectArxivId({ url: 'https://arxiv.org/pdf/2410.15332v3.pdf' }), '2410.15332v3');
  assert.equal(detectArxivId({ url: 'https://arxiv.org/html/2507.14554' }), '2507.14554');
  assert.equal(detectArxivId({ referenceUrl: 'https://arxiv.org/abs/2506.11019v2' }), '2506.11019v2');
  assert.equal(detectArxivId({ sourceRef: 'https://arxiv.org/pdf/2506.11019' }), '2506.11019');
  assert.equal(detectArxivId({ firstPageText: 'Epic\narXiv:2410.15332v3 [cs.LG] 28 May 2025' }), '2410.15332v3');
  assert.equal(detectArxivId({ url: 'https://arxiv.org/abs/2410.15332v3', firstPageText: 'arXiv:9999.99999' }), '2410.15332v3', 'a URL wins over the text layer');
  assert.equal(detectArxivId({ url: 'https://example.org/abs/2410.15332' }), null, 'only arxiv.org URLs count');
  assert.equal(detectArxivId({ firstPageText: 'no identifier here' }), null);
  assert.equal(detectArxivId({}), null);
});

test('precedence is image:, then recreate:, then figure_request', () => {
  const { buildFigureRequest } = request();
  const output = { figure_request: { label: 'Figure 3', why: 'It shows the hierarchy the paper measures.' } };
  const source = { url: 'https://example.org/paper' };
  const model = buildFigureRequest({ output, source });
  assert.deepEqual(model.label, labelKey('Figure', '3'));
  assert.equal(model.pinned, false);
  assert.equal(model.why, 'It shows the hierarchy the paper measures.');
  assert.equal(model.forceRegionCrop, false);

  const recreate = buildFigureRequest({ output, recreate: { enabled: true, target: 'Figure 1' }, source });
  assert.deepEqual(recreate.label, labelKey('Figure', '1'));
  assert.equal(recreate.pinned, true);
  assert.equal('why' in recreate, false, 'a why written for another figure is not carried onto the pin');

  const off = buildFigureRequest({ output, recreate: { enabled: false, target: 'Figure 1' }, source });
  assert.deepEqual(off.label, labelKey('Figure', '3'), 'recreate: no does not pin');

  const image = buildFigureRequest({
    output, recreate: { enabled: true, target: 'Figure 1' },
    override: { source_figure: 'Figure 2', pageHint: 9, caption: 'Cap.', alt_text: 'Alt.', forceRegionCrop: true }, source,
  });
  assert.deepEqual(image.label, labelKey('Figure', '2'));
  assert.equal(image.pinned, true);
  assert.equal(image.pageHint, 9);
  assert.equal(image.captionOverride, 'Cap.');
  assert.equal(image.altOverride, 'Alt.');
  assert.equal(image.forceRegionCrop, true);

  const agree = buildFigureRequest({ output, override: { source_figure: 'Figure 3' }, source });
  assert.equal(agree.why, 'It shows the hierarchy the paper measures.', 'a why for the pinned figure is kept');

  const none = buildFigureRequest({ output: { figure_request: null }, source });
  assert.equal(none.label, undefined);
  assert.equal(none.pinned, false);
  const prose = buildFigureRequest({ output: { figure_request: { label: 'the main chart', why: 'x' } }, source });
  assert.equal(prose.label, undefined, 'an unparseable label is no request');
  const hintOnly = buildFigureRequest({ output, override: { pageHint: 4 }, source });
  assert.deepEqual(hintOnly.label, labelKey('Figure', '3'), 'an override without image: does not pin');
  assert.equal(hintOnly.pinned, false);
  assert.equal(hintOnly.pageHint, 4);
});

test('the request carries the source and detects the arXiv id', () => {
  const { buildFigureRequest } = request();
  const epic = buildFigureRequest({ output: {}, source: { pdfPath: heldPdf('2410.15332v3.pdf') } });
  assert.equal(epic.source.pdfPath, heldPdf('2410.15332v3.pdf'));
  assert.equal(epic.source.arxivId, '2410.15332v3', 'read from the first page text layer');
  const w = buildFigureRequest({ output: {}, source: { pdfPath: heldPdf('w35275.pdf') } });
  assert.equal('arxivId' in w.source, false, 'no id means no arxivId key');
  const v1ref = buildFigureRequest({
    output: { references: ['Hu, J. (2025). <a href="https://arxiv.org/abs/2410.15332v3" target="_blank" rel="noopener noreferrer">Epic</a>.'] },
    source: { url: 'https://example.org/x' },
  });
  assert.equal(v1ref.source.arxivId, '2410.15332v3', 'a v1 HTML reference string is read');
  const v2ref = buildFigureRequest({ output: { references: [{ url: 'https://arxiv.org/abs/2506.11019' }] }, source: {} });
  assert.equal(v2ref.source.arxivId, '2506.11019', 'a v2 reference object is read');
});

test('a model output naming Figure 3 locates page 12 of w35275 with zero vision calls', async () => {
  const { buildFigureRequest } = request();
  const before = visionCalls;
  const req = buildFigureRequest({
    output: { figure_request: { label: 'Figure 3', why: 'It shows the software production hierarchy.' } },
    source: { pdfPath: heldPdf('w35275.pdf') },
  });
  const r = await locator().locateFigure(req);
  assert.equal(r.ok, true, JSON.stringify({ ...r, bytes: undefined }));
  assert.deepEqual(r.label, labelKey('Figure', '3'));
  assert.equal(r.page, 12);
  assert.equal(r.provenance, 'pdf-vector-crop');
  assert.deepEqual(r.calls, { picker: 0, verify: 0 });
  assert.equal(visionCalls, before, 'no vision call is made');
  assert.equal(r.ext, 'jpg');
  assert.deepEqual([...r.bytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.ok(r.width > 1500 && r.height > 150, `a 300 dpi crop of the region, got ${r.width}x${r.height}`);
  assert.match(r.captionText, /^Figure 3: The Software Production Hierarchy/);
  assert.ok(r.regionPt && r.regionPt.y0 > 84, 'the region is the body below the caption');
});

test('stops: a pinned miss is pin-not-found with the found labels; no label is no-request', async () => {
  const { buildFigureRequest } = request();
  const { locateFigure } = locator();
  const pdfPath = heldPdf('w35275.pdf');
  const pinned = await locateFigure(buildFigureRequest({ output: {}, override: { source_figure: 'Figure 14' }, source: { pdfPath } }));
  assert.equal(pinned.ok, false);
  assert.equal(pinned.reason, 'pin-not-found');
  assert.deepEqual(pinned.labels, W35275_LABELS);
  const unpinned = await locateFigure(buildFigureRequest({ output: { figure_request: { label: 'Figure 14', why: 'x' } }, source: { pdfPath } }));
  assert.equal(unpinned.reason, 'label-not-found');
  assert.deepEqual(unpinned.labels, W35275_LABELS);
  const nothing = await locateFigure(buildFigureRequest({ output: { figure_request: null }, source: { pdfPath } }));
  assert.equal(nothing.ok, false);
  assert.equal(nothing.reason, 'no-request');
  const noPdf = await locateFigure(buildFigureRequest({ output: { figure_request: { label: 'Figure 1', why: 'x' } }, source: { url: 'https://example.org/page' } }));
  assert.equal(noPdf.reason, 'source-unavailable', 'the skeleton has the PDF step only');
  const hinted = await locateFigure(buildFigureRequest({ output: {}, override: { source_figure: 'Figure 9', pageHint: 5 }, source: { pdfPath } }));
  assert.equal(hinted.ok, true);
  assert.equal(hinted.page, 38, 'a wrong page hint is ignored, not followed');
});

test('image_raster: is a recognised directive that forces the region crop', async () => {
  const { parseFocusDirectives } = preprocess();
  const { value: d, warnings } = captureWarnings(() => parseFocusDirectives('image: Figure 3\nimage_raster: true\nStress the cost findings.'));
  assert.deepEqual(warnings, [], 'image_raster must not warn');
  assert.equal(d.imageOverride.forceRegionCrop, true);
  assert.equal(d.imageOverride.source_figure, 'Figure 3');
  assert.equal(d.focusHint, 'Stress the cost findings.');
  for (const [value, expected] of [['yes', true], ['1', true], ['on', true], ['false', false], ['no', false]] as const) {
    const parsed = captureWarnings(() => parseFocusDirectives(`image_raster: ${value}`));
    assert.equal(parsed.value.imageOverride?.forceRegionCrop, expected, `image_raster: ${value}`);
    assert.deepEqual(parsed.warnings, []);
  }
  const other = captureWarnings(() => parseFocusDirectives('image_size: large\nKeep it short.'));
  assert.ok(other.warnings.some(w => w.includes('image_size')), 'another unknown image_* key still warns');
  const none = parseFocusDirectives('Stress the cost findings.');
  assert.equal(none.imageOverride, undefined);

  const { buildFigureRequest } = request();
  const pdfPath = heldPdf('flyvbjerg-it-cost-risk.pdf');
  const embedded = await locator().locateFigure(buildFigureRequest({ output: {}, override: { source_figure: 'Figure 3' }, source: { pdfPath } }));
  assert.equal(embedded.provenance, 'pdf-embedded');
  const forced = await locator().locateFigure(buildFigureRequest({ output: {}, override: { source_figure: 'Figure 3', forceRegionCrop: true }, source: { pdfPath } }));
  assert.equal(forced.ok, true);
  assert.equal(forced.provenance, 'pdf-vector-crop', 'image_raster: true crops the region over the embedded image');
});

test('skill.md asks for figure_request and never for an image block', () => {
  const skill = fs.readFileSync(path.join(REPO_ROOT, 'skill.md'), 'utf8');
  assert.doesNotMatch(skill, /NEVER emit/);
  assert.doesNotMatch(skill, /^\s*"image"\s*:/m, 'the output shape no longer lists an image key');
  assert.match(skill, /^\s*"figure_request"\s*:/m, 'the output shape lists figure_request');
  assert.ok(skill.includes('Do not emit an `image` field or any image bytes; name the figure in `figure_request` and the pipeline locates and attaches it.'));
  assert.ok(skill.includes("- [ ] `figure_request` names one figure by the paper's own label, or is null."));
  assert.ok(skill.includes('Figures are never a source of chart values.'));
  const para = skill.split(/\n\s*\n/).find(p => p.includes('`figure_request.label`'));
  assert.ok(para, 'a paragraph tells the model to name the figure in figure_request.label');
  assert.match(para, /key results figure/i);
  assert.match(para, /null/);
  assert.doesNotMatch(skill, /vision model (?:auto-)?picks/i, 'no paragraph says a vision model picks the figure');
  assert.equal((skill.match(/CONTRACT-V2-BEGIN/g) ?? []).length, 1, 'skill.md carries exactly one generated contract block');
  const system = prompt().buildSystemPrompt();
  assert.doesNotMatch(system, /CONTRACT-V2-BEGIN/, 'the system prompt strips the contract marker');
  assert.match(system, /`figure_request`/);
  assert.doesNotMatch(system, /NEVER emit/);
});

test('the user instruction asks for figure_request, still forbids image, and carries a pin', () => {
  const { buildUserInstruction } = prompt();
  const plain = buildUserInstruction('2026-10-21');
  assert.match(plain, /`figure_request`/);
  assert.match(plain, /never emit[^.]*`image`/i);
  assert.match(plain, /figure pipeline/i);
  assert.doesNotMatch(plain, /A sidecar pins/);
  const pinned = buildUserInstruction('2026-10-21', 'Focus on costs.', 'Figure 4');
  assert.ok(pinned.includes('A sidecar pins Figure 4 as the lead figure; set `figure_request.label` to it and write `why` for it.'));
  assert.match(pinned, /Focus on costs\./, 'the focus hint still follows');
  assert.ok(pinned.indexOf('A sidecar pins') < pinned.indexOf('Focus on costs.'), 'the pin sentence belongs to the base instruction, before the emphasis block');
  assert.equal(buildUserInstruction('2026-10-21', 'Focus on costs.'), buildUserInstruction('2026-10-21', 'Focus on costs.', undefined));
});

test('no vision, network or legacy import in the new modules', () => {
  for (const file of ['request.ts', 'index.ts']) {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'src', 'figure-locator', file), 'utf8');
    assert.doesNotMatch(src, /figure-vlm/, `${file} imports the legacy module`);
    assert.doesNotMatch(src, /from '\.\.\/vision'/, `${file} calls vision directly`);
    assert.doesNotMatch(src, /\bfetch\(/, `${file} fetches`);
  }
  assert.equal(visionCalls, 0);
});
// AUTOMETTA-CONTRACT-END
