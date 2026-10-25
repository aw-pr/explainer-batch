// Contract test for stage-cards/31-page-text-extraction-and-pdf-url-cache.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/31-page-text-extraction-and-pdf-url-cache.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-31-')));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/31-page-text-extraction-and-pdf-url-cache.md
const MATCHER_FIXTURES = path.join(__dirname, 'fixtures', '29-number-normaliser-and-page-text-matcher');
const HELD = [process.env.HELD_PDF_DIR, path.join(REPO_ROOT, 'input', '_held'), path.join(REPO_ROOT, '..', 'explainer-batch', 'input', '_held')]
  .filter((d): d is string => !!d)
  .find(d => fs.existsSync(path.join(d, 'w35275.pdf')));

const INPUT = path.join(TMP, 'input');
const CACHE = path.join(TMP, 'pdf-cache');
const FAKE = path.join(TMP, 'fake');
const LOG = path.join(TMP, 'pdftotext.log');
fs.mkdirSync(INPUT, { recursive: true });
fs.mkdirSync(FAKE, { recursive: true });
Object.assign(process.env, {
  EXPLAINER_STATE_FILE: path.join(TMP, 'state.json'),
  EXPLAINER_INPUT_DIR: INPUT,
  EXPLAINER_OUTPUT_DIR: path.join(TMP, 'output'),
  EXPLAINER_OBSIDIAN_DIR: '',
  WEBSITE_REPO: '',
  PDF_CACHE_DIR: CACHE,
});

const PDF_BYTES = Buffer.from('%PDF-1.4\n% contract fixture for card 31\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const PDF_URL = 'https://example.org/papers/demo.pdf';
const MISSING_URL = 'https://example.org/papers/missing.pdf';
const HTML_200_URL = 'https://example.org/papers/login-wall.pdf';
const THROW_URL = 'https://example.org/papers/reset.pdf';
const fetchCalls: string[] = [];
globalThis.fetch = (async (input: unknown) => {
  const url = String(input instanceof URL ? input.href : (input as { url?: string }).url ?? input);
  fetchCalls.push(url);
  if (url === PDF_URL) return new Response(PDF_BYTES, { status: 200, headers: { 'content-type': 'application/pdf' } });
  if (url === MISSING_URL) return new Response('not found', { status: 404 });
  if (url === HTML_200_URL) return new Response('<html><body>Please sign in</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  if (url === THROW_URL) throw new TypeError('fetch failed: connection reset');
  throw new Error(`network access is forbidden in contract test 31: ${url}`);
}) as typeof fetch;

const PROSE = fs.readFileSync(path.join(MATCHER_FIXTURES, 'w35275-p35.txt'), 'utf8');
assert.ok(PROSE.length > 1000, 'matcher fixture from card 29 is missing');
fs.writeFileSync(path.join(FAKE, 'page-3.txt'), `\u0000\u0000${PROSE.split('\n').slice(0, 40).join('\n\u0000')}\u000c`);
fs.writeFileSync(path.join(FAKE, 'page-4.txt'), 'Short page.\n');
const SCRIPT = path.join(FAKE, 'pdftotext');
fs.writeFileSync(SCRIPT, `#!/bin/sh\necho "$@" >> "${LOG}"\npage="$2"\nf="${FAKE}/page-$page.txt"\n[ -f "$f" ] || exit 1\ncat "$f"\n`);
fs.chmodSync(SCRIPT, 0o755);

function calls(): string[] {
  return fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean) : [];
}

function pageTextModule(): any {
  const mod = require(path.join(REPO_ROOT, 'src', 'page-text'));
  assert.equal(typeof mod.pageText, 'function', 'src/page-text.ts must export pageText');
  assert.equal(typeof mod.pageUsable, 'function', 'src/page-text.ts must export pageUsable');
  return mod;
}

test('31: pageText runs pdftotext once per (sha256, page), strips control characters and marks usable', () => {
  process.env.PDFTOTEXT_BIN = SCRIPT;
  const { pageText } = pageTextModule();
  const pdf = path.join(TMP, 'paper.pdf');
  fs.writeFileSync(pdf, PDF_BYTES);
  const copy = path.join(TMP, 'same-paper-renamed.pdf');
  fs.writeFileSync(copy, PDF_BYTES);

  const first = pageText(pdf, 3);
  assert.ok(first, 'pageText returned null for a page the binary printed');
  assert.equal(first.page, 3);
  assert.ok(Array.isArray(first.lines) && first.lines.length >= 30, 'lines are the page text split on newlines');
  const joined = first.lines.join('\n');
  assert.doesNotMatch(joined, /[\u0000-\u0008\u000b-\u001f]/, 'control characters survive');
  assert.match(joined, /Table 5: Attenuation of Productivity Effects/);
  assert.equal(first.usable, true, 'a page of prose is usable');
  assert.deepEqual(calls(), [`-f 3 -l 3 -layout ${pdf} -`], 'pdftotext is called with -f N -l N -layout <pdf> -');

  pageText(pdf, 3);
  pageText(copy, 3);
  assert.equal(calls().length, 1, 'a repeat call, or the same bytes under another name, must hit the cache');

  const short = pageText(pdf, 4);
  assert.ok(short, 'a short page still returns its lines');
  assert.equal(short.usable, false, 'a page with fewer than 40 words is not usable');
  assert.equal(calls().length, 2);

  assert.equal(pageText(pdf, 99), null, 'a failing pdftotext call yields null');
  assert.equal(pageText(pdf, 99), null);
  assert.equal(calls().length, 3, 'a failed extraction is cached too');
  assert.equal(pageText(path.join(TMP, 'no-such-file.pdf'), 1), null, 'an unreadable PDF yields null, not a throw');
  assert.equal(calls().length, 3, 'an unreadable PDF never reaches the binary');
});

test('31: pageUsable passes the held born-digital pages and refuses shifted glyphs', () => {
  const { pageUsable } = pageTextModule();
  for (const f of ['2410.15332v3-p08.txt', 'w35275-p35.txt']) {
    const text = fs.readFileSync(path.join(MATCHER_FIXTURES, f), 'utf8');
    assert.equal(pageUsable(text), true, `${f} should be usable`);
    const shifted = text.replace(/[a-z]/g, c => String.fromCharCode(c.charCodeAt(0) - 29));
    assert.equal(pageUsable(shifted), false, `${f} with glyphs shifted by 29 code points must not be usable`);
  }
  assert.equal(pageUsable('Only a few words here.'), false);
  assert.equal(pageUsable(''), false);
});

test('31: a PDF URL is downloaded into the cache and its path recorded beside source', async () => {
  fs.writeFileSync(path.join(INPUT, 'urls.txt'), `${PDF_URL}\n${MISSING_URL}\n${HTML_200_URL}\n${THROW_URL}\n`);
  const { preprocessInputs } = require(path.join(REPO_ROOT, 'src', 'preprocess'));
  const items = await preprocessInputs();
  assert.equal(items.length, 4, 'every URL is still queued');
  const ok = items.find((i: any) => i.input === PDF_URL);
  assert.ok(ok, 'the PDF URL item is missing');
  assert.equal(ok.source.kind, 'url');
  assert.equal(ok.source.url, PDF_URL);
  const sha = crypto.createHash('sha256').update(PDF_BYTES).digest('hex');
  assert.equal(ok.source.cachedPdfPath, path.join(CACHE, `${sha}.pdf`), 'cached path is <PDF_CACHE_DIR>/<sha256>.pdf');
  assert.deepEqual(fs.readFileSync(ok.source.cachedPdfPath), PDF_BYTES);
  assert.equal(ok.base64Data, undefined, 'the request still sends the URL, not inline bytes');

  for (const bad of [MISSING_URL, HTML_200_URL, THROW_URL]) {
    const item = items.find((i: any) => i.input === bad);
    assert.ok(item, `${bad} was dropped`);
    assert.equal(item.source.cachedPdfPath, undefined, `${bad} must not be cached`);
  }
  assert.deepEqual(fetchCalls.slice().sort(), [HTML_200_URL, MISSING_URL, PDF_URL, THROW_URL].sort(), 'one fetch per PDF URL, nothing else');
  assert.deepEqual(fs.readdirSync(CACHE), [`${sha}.pdf`], 'only the real PDF lands in the cache');
});

test('31: resolveSourcePdf returns the cached path for a URL request', () => {
  const sha = crypto.createHash('sha256').update(PDF_BYTES).digest('hex');
  const cached = path.join(CACHE, `${sha}.pdf`);
  assert.ok(fs.existsSync(cached), 'run the download test first: cache file missing');
  const customId = 'explainer-url-example-org-papers-demo-pdf';
  const gone = path.join(CACHE, 'gone.pdf');
  fs.writeFileSync(process.env.EXPLAINER_STATE_FILE!, JSON.stringify({
    batches: [
      { id: 'b-old', model: 'm', submitted_at: '2026-10-20T00:00:00Z', status: 'ended', requests: {
        [customId]: { type: 'explainer', input: PDF_URL, source: { kind: 'url', url: PDF_URL, cachedPdfPath: gone }, output: null, result: 'succeeded', error: null },
        'explainer-url-example-org-other-pdf': { type: 'explainer', input: 'https://example.org/other.pdf', source: { kind: 'url', url: 'https://example.org/other.pdf', cachedPdfPath: cached }, output: null, result: 'succeeded', error: null },
      } },
      { id: 'b-new', model: 'm', submitted_at: '2026-10-21T00:00:00Z', status: 'ended', requests: {
        [customId]: { type: 'explainer', input: PDF_URL, source: { kind: 'url', url: PDF_URL, cachedPdfPath: cached }, output: null, result: 'succeeded', error: null },
        'explainer-url-example-org-other-pdf': { type: 'explainer', input: 'https://example.org/other.pdf', source: { kind: 'url', url: 'https://example.org/other.pdf', cachedPdfPath: gone }, output: null, result: 'succeeded', error: null },
      } },
      { id: 'b-newest', model: 'm', submitted_at: '2026-10-22T00:00:00Z', status: 'processing', requests: {
        [customId]: { type: 'explainer', input: PDF_URL, source: { kind: 'url', url: PDF_URL }, output: null, result: 'pending', error: null },
        'explainer-url-example-org-other-pdf': { type: 'explainer', input: 'https://example.org/other.pdf', source: { kind: 'url', url: 'https://example.org/other.pdf' }, output: null, result: 'pending', error: null },
      } },
    ],
    openai_file_cache: {},
  }));
  const { resolveSourcePdf } = require(path.join(REPO_ROOT, 'src', 'output'));
  assert.equal(typeof resolveSourcePdf, 'function', 'src/output.ts must export resolveSourcePdf');
  assert.equal(resolveSourcePdf(customId), cached, 'the newest request that records a cached path decides');
  assert.equal(resolveSourcePdf('explainer-url-example-org-other-pdf'), null, 'that path\'s file is gone: null, with no fall-back to older batches');
  assert.equal(resolveSourcePdf('explainer-url-never-seen'), null);
});

test('31: the state type, the request body and the README carry the change', () => {
  const state = fs.readFileSync(path.join(REPO_ROOT, 'src', 'state.ts'), 'utf8');
  assert.match(state, /cachedPdfPath\?\s*:\s*string/, 'RequestState.source gains cachedPdfPath');
  const preprocess = fs.readFileSync(path.join(REPO_ROOT, 'src', 'preprocess.ts'), 'utf8');
  assert.match(preprocess, /cachedPdfPath\?\s*:\s*string/, 'InputSource gains cachedPdfPath');
  const batch = fs.readFileSync(path.join(REPO_ROOT, 'src', 'batch.ts'), 'utf8');
  assert.match(batch, /source:\s*\{\s*type:\s*'url',\s*url:\s*item\.input\s*\}/, 'a PDF URL is still sent as a URL document block');
  const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
  assert.match(readme, /PDF_CACHE_DIR/, 'README documents the cache directory');
  assert.match(readme, /_cache\/pdf/, 'README states the default cache directory');
  const pageTextSrc = fs.readFileSync(path.join(REPO_ROOT, 'src', 'page-text.ts'), 'utf8');
  assert.doesNotMatch(pageTextSrc, /from\s+['"]\.\.\/contract/, 'src/page-text.ts must not import from contract/ (tsconfig rootDir is src)');
});

test('31: the real pdftotext reads the held PDFs', { skip: HELD ? false : 'held PDFs not present' }, () => {
  delete process.env.PDFTOTEXT_BIN;
  const { pageText } = pageTextModule();
  const demirer = pageText(path.join(HELD!, 'w35275.pdf'), 35);
  assert.ok(demirer, 'page 35 of w35275.pdf returned null');
  assert.match(demirer.lines.join('\n'), /Sync Effect\s+741\.3\s+187\.0\s+109\.1/);
  assert.equal(demirer.usable, true);
  const epic = pageText(path.join(HELD!, '2410.15332v3.pdf'), 8);
  assert.ok(epic, 'page 8 of 2410.15332v3.pdf returned null');
  assert.doesNotMatch(epic.lines.join('\n'), /\u0000/, 'the 386 NUL bytes on EPIC page 8 are stripped');
  assert.equal(epic.usable, true);
});
// AUTOMETTA-CONTRACT-END
