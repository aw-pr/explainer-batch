import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { arxivSourceFigure, parseArxivHtmlFigures, includeGraphicsEnvironments, resolveIncludePath } from '../../src/figure-locator/arxiv-source';
import { parseLabel } from '../../src/figure-locator/label';

const fixtures = path.join(__dirname, '../contract/fixtures/40-arxiv-source-step');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxiv-source-unit-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const html = fs.readFileSync(path.join(fixtures, 'html.html'));
const realTex = ['fig-algo', 'fig-eval-data-dist'].map(name => ({
  path: `figs/${name}.tex`, text: fs.readFileSync(path.join(fixtures, 'tex', `${name}.tex`), 'utf8'),
}));
let count = 0;
const freshCache = () => path.join(tmp, `cache-${++count}`);

function pdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 36] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let text = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const offset = Buffer.byteLength(text);
    text += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const start = Buffer.byteLength(text);
  text += 'xref\n0 5\n0000000000 65535 f \n' + offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  return Buffer.from(text + `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}

function buildArchive(extra: Record<string, string | Buffer> = {}): Buffer {
  const dir = fs.mkdtempSync(path.join(tmp, 'archive-'));
  const root = path.join(dir, 'source');
  const files: Record<string, string | Buffer> = {
    ...Object.fromEntries(realTex.map(file => [file.path, file.text])),
    'figs/figs/fig-algo.pdf': pdf(),
    'figs/figs/fig-eval-data-dist.pdf': pdf(),
    'multi.tex': '\\begin{figure}\\includegraphics{fig-eval-e2e.pdf}\\includegraphics{second.pdf}\\end{figure}',
    'fig-eval-e2e.pdf': pdf(), 'second.pdf': pdf(),
    'eps.tex': '\\begin{figure}\\includegraphics{fig-eval-long-context.eps}\\end{figure}',
    'fig-eval-long-context.eps': '%!PS-Adobe-3.0 EPSF-3.0',
    ...extra,
  };
  for (const [name, bytes] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), bytes);
  }
  const archive = path.join(dir, 'source.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', root, ...Object.keys(files)]);
  return fs.readFileSync(archive);
}
const archive = buildArchive();
const fetcher = async (url: string) => {
  if (url === 'https://arxiv.org/html/2410.15332v3') return html;
  assert.equal(url, 'https://arxiv.org/e-print/2410.15332v3');
  return archive;
};
const locate = (text: string) => arxivSourceFigure('2410.15332v3', parseLabel(text)!, { cacheRoot: freshCache(), fetchBytes: fetcher, env: {} });

test('the real HTML and TeX map Figure 4 through S4.F4 to the PDF include', async () => {
  const figure = parseArxivHtmlFigures(html.toString())[3];
  assert.equal(figure.id, 'S4.F4');
  assert.equal(figure.label, 'Figure 4');
  assert.equal(figure.basename, 'fig-algo');
  const environments = includeGraphicsEnvironments(realTex);
  assert.deepEqual(environments.map(env => env.files), [['figs/figs/fig-algo.pdf'], ['figs/figs/fig-eval-data-dist']]);
  const result = await locate('Figure 4');
  assert.ok(result.ok);
  assert.equal(result.member, 'figs/figs/fig-algo.pdf');
  assert.equal(result.ext, 'jpg');
  assert.equal(result.width, 300);
  assert.equal(result.height, 150);
});

test('the real extension-less include resolves to the PDF member', async () => {
  assert.equal(resolveIncludePath('figs/figs/fig-eval-data-dist', ['figs/figs/fig-eval-data-dist.pdf']), 'figs/figs/fig-eval-data-dist.pdf');
  const result = await locate('Figure 5');
  assert.ok(result.ok);
  assert.equal(result.member, 'figs/figs/fig-eval-data-dist.pdf');
});

test('multiple includes require an existing pinned panel and EPS falls through', async () => {
  assert.deepEqual(await locate('Figure 6'), { ok: false, reason: 'multi-file', notes: [] });
  const panel = await locate('Figure 6b');
  assert.ok(panel.ok);
  assert.equal(panel.member, 'second.pdf');
  assert.equal(panel.label.panel, 'b');
  assert.deepEqual(await locate('Figure 6c'), { ok: false, reason: 'multi-file', notes: [] });
  assert.deepEqual(await locate('Figure 9'), { ok: false, reason: 'eps-only', notes: [] });
});

test('network failures are unavailable, while disabled makes no request', async () => {
  let calls = 0;
  const options = { cacheRoot: freshCache(), fetchBytes: async () => { calls++; throw new Error('offline'); }, env: {} };
  assert.deepEqual(await arxivSourceFigure('2410.15332v3', parseLabel('Figure 4')!, options), {
    ok: false, reason: 'unavailable', notes: ['arxiv-source: unavailable (offline)'],
  });
  const disabled = await arxivSourceFigure('2410.15332v3', parseLabel('Figure 4')!, { ...options, env: { FIGURE_ARXIV_SOURCE: '0' } });
  assert.equal(disabled.ok, false);
  assert.equal(calls, 1);
});

test('id fallback, table captions, object priority and missing assets', () => {
  const figures = parseArxivHtmlFigures(`
    <figure id='A1.F10'><img src='other.png'><object data='dir/chosen.svg'></object></figure>
    <figure id='S2.T3'><img src='table.png'></figure>
    <figure id='S1.F9'><figcaption><b>Table&nbsp;4:</b> Data</figcaption><img src='data.jpg'></figure>
    <figure id='S1.F8'><figcaption>Figure 8: Missing</figcaption></figure>`);
  assert.deepEqual(figures.map(figure => [figure.label, figure.basename]), [['Figure 10', 'chosen'], ['Table 3', 'table'], ['Table 4', 'data']]);
});

test('table environments, comments, explicit extensions and member prefixes', () => {
  assert.deepEqual(includeGraphicsEnvironments([{ path: 'tables.tex', text: `
    \\includegraphics{outside}
    % \\begin{figure}\\includegraphics{commented}\\end{figure}
    \\begin{table*}\\includegraphics[width=1cm]{ first.jpeg }\\end{table*}
    \\begin{table}\\includegraphics{second}\\end{table}`,
  }]).map(env => env.files), [['first.jpeg'], ['second']]);
  assert.equal(resolveIncludePath('./first.jpeg', ['./first.jpeg']), './first.jpeg');
  assert.equal(resolveIncludePath('first.jpg', ['first.jpeg']), null);
  assert.equal(resolveIncludePath('first', ['first.png', './first.pdf']), './first.pdf');
});

test('JPEG bytes pass through and malformed archives or PDFs give diagnostic notes', async () => {
  const jpeg = Buffer.from('ffd8ffffd9', 'hex');
  const bytes = buildArchive({ 'figs/figs/fig-algo.pdf': 'invalid PDF',
    'jpeg.tex': '\\begin{figure}\\includegraphics{fig-intro-positioning.jpeg}\\end{figure}',
    'fig-intro-positioning.jpeg': jpeg });
  const options = { cacheRoot: freshCache(), env: {}, fetchBytes: async (url: string) => url.includes('/html/') ? html : bytes };
  const image = await arxivSourceFigure('2410.15332v3', parseLabel('Figure 1')!, options);
  assert.ok(image.ok);
  assert.deepEqual(image.bytes, jpeg);
  const badPdf = await arxivSourceFigure('2410.15332v3', parseLabel('Figure 4')!, options);
  assert.equal(badPdf.ok, false);
  assert.match(badPdf.notes.join(), /render member.*failed/);
  const badTar = await arxivSourceFigure('2410.15332v3', parseLabel('Figure 4')!, {
    ...options, cacheRoot: freshCache(), fetchBytes: async (url: string) => url.includes('/html/') ? html : Buffer.from('bad tar'),
  });
  assert.equal(badTar.ok, false);
  assert.match(badTar.notes.join(), /tar listing failed/);
});
