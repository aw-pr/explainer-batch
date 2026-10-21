// Contract test for stage-cards/40-arxiv-source-step.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/40-arxiv-source-step.test.ts
// Needs poppler (pdftoppm) and tar. No network: every fetch goes through an injected fake, and the CLI case reads a pre-filled cache.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.join(__dirname, '..', '..');
const FIXTURES = path.join(__dirname, 'fixtures', '40-arxiv-source-step');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-40-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/40-arxiv-source-step.md
const ID = '2410.15332v3';
const HTML_URL = `https://arxiv.org/html/${ID}`;
const EPRINT_URL = `https://arxiv.org/e-print/${ID}`;

function load(rel: string): Record<string, any> {
  const file = path.join(REPO_ROOT, rel);
  assert.ok(fs.existsSync(file + '.ts'), `${rel}.ts does not exist`);
  return require(file) as Record<string, any>;
}
const arxiv = () => load('src/figure-locator/arxiv-source');
const labelKey = (noun: string, number: string, panel?: string) => ({ noun, number, ...(panel ? { panel } : {}) });

function pdf(file: string, w: number, h: number): void {
  const content = `0.2 g 10 10 ${w - 20} ${h - 20} re f`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}
const u32be = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), u32be(13), Buffer.from('IHDR'), u32be(952), u32be(450), Buffer.from([8, 2, 0, 0, 0]), u32be(0)]);

// Two real environments from the e-print (tex/), and three synthetic ones that exercise the fall-through rules.
const SYNTHETIC: Record<string, string> = {
  'figs/fig-eval-e2e.tex': [
    '\\begin{figure}[t]', '    \\centering',
    '    \\includegraphics[width=0.48\\linewidth]{figs/figs/fig-eval-e2e.pdf}',
    '    \\includegraphics[width=0.48\\linewidth]{figs/figs/fig-eval-e2e-b.pdf}',
    '    \\caption{Accuracy vs. TTFT.}', '    \\label{fig-eval-e2e}', '\\end{figure}', '',
  ].join('\n'),
  'figs/fig-eval-long-context.tex': [
    '\\begin{figure}[t]', '    \\centering', '    \\includegraphics[width=0.7\\linewidth]{figs/figs/fig-eval-long-context.eps}',
    '    \\caption{TTFT vs. context length.}', '    \\label{fig-eval-long-context}', '\\end{figure}', '',
  ].join('\n'),
  'figs/fig-intro-positioning.tex': [
    '\\begin{figure}[t]', '    \\centering', '    \\includegraphics[width=1\\linewidth]{figs/figs/fig-intro-positioning.png}',
    '    \\caption{Design space of position-independent context caching.}', '    \\label{fig-intro-positioning}', '\\end{figure}', '',
  ].join('\n'),
};

function buildEprint(dir: string): Buffer {
  const root = path.join(dir, 'src');
  fs.mkdirSync(path.join(root, 'figs', 'figs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'main.tex'), '\\documentclass{article}\n\\begin{document}\n\\input{figs/fig-algo}\n\\input{figs/fig-eval-data-dist}\n\\end{document}\n');
  for (const name of ['fig-algo.tex', 'fig-eval-data-dist.tex']) fs.copyFileSync(path.join(FIXTURES, 'tex', name), path.join(root, 'figs', name));
  for (const [rel, text] of Object.entries(SYNTHETIC)) fs.writeFileSync(path.join(root, rel), text);
  pdf(path.join(root, 'figs/figs/fig-algo.pdf'), 476, 201);
  pdf(path.join(root, 'figs/figs/fig-eval-data-dist.pdf'), 476, 247);
  pdf(path.join(root, 'figs/figs/fig-eval-e2e.pdf'), 300, 300);
  pdf(path.join(root, 'figs/figs/fig-eval-e2e-b.pdf'), 200, 100);
  fs.writeFileSync(path.join(root, 'figs/figs/fig-eval-long-context.eps'), '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 333 217\n');
  fs.writeFileSync(path.join(root, 'figs/figs/fig-intro-positioning.png'), PNG);
  const out = path.join(dir, 'eprint.tar.gz');
  const run = spawnSync('tar', ['-czf', out, '-C', root, 'main.tex', 'figs'], { encoding: 'utf8' });
  assert.equal(run.status, 0, `tar failed: ${run.stderr}`);
  return fs.readFileSync(out);
}

const HTML = fs.readFileSync(path.join(FIXTURES, 'html.html'));
const EPRINT = buildEprint(path.join(TMP, 'eprint'));

function fakeFetch(map: Record<string, Buffer | Error>): { fn: (url: string) => Promise<Buffer>; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fn: async (url: string) => {
      urls.push(url);
      const hit = map[url];
      if (!hit) throw new Error(`unexpected fetch ${url}`);
      if (hit instanceof Error) throw hit;
      return hit;
    },
  };
}
const online = () => fakeFetch({ [HTML_URL]: HTML, [EPRINT_URL]: EPRINT });
let cacheN = 0;
const freshCache = () => path.join(TMP, `cache-${++cacheN}`);
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

test('arxiv-source exports its contract', () => {
  const a = arxiv();
  for (const name of ['parseArxivHtmlFigures', 'includeGraphicsEnvironments', 'resolveIncludePath', 'arxivSourceFigure']) {
    assert.equal(typeof a[name], 'function', `${name} must be exported`);
  }
});

test('the HTML render maps every figure label to its LaTeXML id and asset basename, in document order', () => {
  const figs = arxiv().parseArxivHtmlFigures(HTML.toString('utf8'));
  assert.equal(figs.length, 10);
  assert.deepEqual(figs.map((f: any) => f.label), Array.from({ length: 10 }, (_, i) => `Figure ${i + 1}`));
  const f4 = figs[3];
  assert.equal(f4.id, 'S4.F4');
  assert.equal(f4.basename, 'fig-algo', 'the <object data> basename, extension removed');
  assert.deepEqual(f4.key, labelKey('Figure', '4'));
  assert.equal(figs[0].basename, 'fig-intro-positioning', 'an <img src> asset is read too');
  assert.equal(figs[9].id, 'A1.F10', 'an appendix figure keeps its A-prefixed id');
  assert.equal(figs[9].basename, 'fig-eval-breakdown');
});

test('includeGraphicsEnvironments and resolveIncludePath follow TeX file resolution', () => {
  const { includeGraphicsEnvironments, resolveIncludePath } = arxiv();
  const envs = includeGraphicsEnvironments([
    { path: 'figs/fig-algo.tex', text: fs.readFileSync(path.join(FIXTURES, 'tex', 'fig-algo.tex'), 'utf8') },
    { path: 'figs/fig-eval-e2e.tex', text: SYNTHETIC['figs/fig-eval-e2e.tex'] },
  ]);
  assert.deepEqual(envs.map((e: any) => e.files), [
    ['figs/figs/fig-algo.pdf'],
    ['figs/figs/fig-eval-e2e.pdf', 'figs/figs/fig-eval-e2e-b.pdf'],
  ]);
  const members = ['figs/figs/fig-eval-data-dist.pdf', 'figs/figs/fig-algo.pdf', 'figs/figs/only.eps', 'figs/figs/both.png', 'figs/figs/both.pdf'];
  assert.equal(resolveIncludePath('figs/figs/fig-eval-data-dist', members), 'figs/figs/fig-eval-data-dist.pdf', 'an extension-less argument resolves');
  assert.equal(resolveIncludePath('figs/figs/fig-algo.pdf', members), 'figs/figs/fig-algo.pdf');
  assert.equal(resolveIncludePath('figs/figs/both', members), 'figs/figs/both.pdf', '.pdf is tried before .png');
  assert.equal(resolveIncludePath('figs/figs/only', members), 'figs/figs/only.eps');
  assert.equal(resolveIncludePath('figs/figs/absent', members), null);
  assert.equal(resolveIncludePath('./figs/figs/fig-algo.pdf', members), 'figs/figs/fig-algo.pdf', 'a leading ./ is ignored');
});

test('Figure 4 becomes a 300 dpi JPEG of the e-print PDF, fetched once and cached', async () => {
  const { arxivSourceFigure } = arxiv();
  const f = online();
  const cacheRoot = freshCache();
  const r = await arxivSourceFigure(ID, labelKey('Figure', '4'), { fetchBytes: f.fn, cacheRoot, env: {} });
  assert.equal(r.ok, true, JSON.stringify(r.notes ?? r));
  assert.equal(r.provenance, 'arxiv-source');
  assert.equal(r.member, 'figs/figs/fig-algo.pdf');
  assert.equal(r.htmlId, 'S4.F4');
  assert.deepEqual(r.label, labelKey('Figure', '4'));
  assert.equal(r.ext, 'jpg');
  assert.deepEqual([...r.bytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.ok(Math.abs(r.width - 1983) <= 2 && Math.abs(r.height - 838) <= 2, `476x201 pt at 300 dpi is about 1983x838, got ${r.width}x${r.height}`);
  assert.deepEqual([...f.urls].sort(), [EPRINT_URL, HTML_URL].sort(), 'exactly the HTML render and the e-print are fetched');
  const dir = path.join(cacheRoot, ID);
  assert.equal(sha(fs.readFileSync(path.join(dir, 'eprint.tar.gz'))), sha(EPRINT), 'the e-print is cached byte for byte');
  assert.equal(sha(fs.readFileSync(path.join(dir, 'html.html'))), sha(HTML), 'the HTML is cached byte for byte');
  const mapping = JSON.parse(fs.readFileSync(path.join(dir, 'mapping.json'), 'utf8'));
  assert.equal(mapping['Figure 4'].id, 'S4.F4');
  assert.equal(mapping['Figure 4'].basename, 'fig-algo');
  assert.equal(Object.keys(mapping).length, 10);

  const offline = fakeFetch({ [HTML_URL]: new Error('ENOTFOUND'), [EPRINT_URL]: new Error('ENOTFOUND') });
  const again = await arxivSourceFigure(ID, labelKey('Figure', '4'), { fetchBytes: offline.fn, cacheRoot, env: {} });
  assert.equal(again.ok, true, 'a cached paper needs no network');
  assert.equal(offline.urls.length, 0, 'the cache has no expiry');
  assert.equal(sha(again.bytes), sha(r.bytes));
});

test('an extension-less \\includegraphics resolves', async () => {
  const r = await arxiv().arxivSourceFigure(ID, labelKey('Figure', '5'), { fetchBytes: online().fn, cacheRoot: freshCache(), env: {} });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.member, 'figs/figs/fig-eval-data-dist.pdf');
  assert.ok(Math.abs(r.width - 1983) <= 2 && Math.abs(r.height - 1029) <= 2, `476x247 pt at 300 dpi, got ${r.width}x${r.height}`);
});

test('a PNG asset is stored as fetched', async () => {
  const r = await arxiv().arxivSourceFigure(ID, labelKey('Figure', '1'), { fetchBytes: online().fn, cacheRoot: freshCache(), env: {} });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.ext, 'png');
  assert.equal(sha(r.bytes), sha(PNG), 'no re-encoding');
  assert.equal(r.width, 952);
  assert.equal(r.height, 450);
});

test('a two-file environment falls through, unless a panel is pinned', async () => {
  const { arxivSourceFigure } = arxiv();
  const cacheRoot = freshCache();
  const multi = await arxivSourceFigure(ID, labelKey('Figure', '6'), { fetchBytes: online().fn, cacheRoot, env: {} });
  assert.equal(multi.ok, false);
  assert.equal(multi.reason, 'multi-file');
  const panel = await arxivSourceFigure(ID, labelKey('Figure', '6', 'b'), { fetchBytes: online().fn, cacheRoot, env: {} });
  assert.equal(panel.ok, true, JSON.stringify(panel));
  assert.equal(panel.member, 'figs/figs/fig-eval-e2e-b.pdf', 'panel b takes the second file');
  assert.deepEqual(panel.label, labelKey('Figure', '6', 'b'));
  assert.ok(Math.abs(panel.width - 833) <= 2 && Math.abs(panel.height - 417) <= 2, `200x100 pt at 300 dpi, got ${panel.width}x${panel.height}`);
  const tooFar = await arxivSourceFigure(ID, labelKey('Figure', '6', 'c'), { fetchBytes: online().fn, cacheRoot, env: {} });
  assert.equal(tooFar.ok, false);
  assert.equal(tooFar.reason, 'multi-file', 'a panel beyond the file count falls through');
});

test('an EPS-only asset falls through', async () => {
  const r = await arxiv().arxivSourceFigure(ID, labelKey('Figure', '9'), { fetchBytes: online().fn, cacheRoot: freshCache(), env: {} });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'eps-only');
});

test('a label the HTML does not carry, or an asset the e-print lacks, falls through', async () => {
  const { arxivSourceFigure } = arxiv();
  const cacheRoot = freshCache();
  const missing = await arxivSourceFigure(ID, labelKey('Figure', '12'), { fetchBytes: online().fn, cacheRoot, env: {} });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'label-not-found');
  const table = await arxivSourceFigure(ID, labelKey('Table', '4'), { fetchBytes: online().fn, cacheRoot, env: {} });
  assert.equal(table.reason, 'label-not-found', 'Table 4 is not Figure 4');
  const noAsset = await arxivSourceFigure(ID, labelKey('Figure', '2'), { fetchBytes: online().fn, cacheRoot, env: {} });
  assert.equal(noAsset.ok, false);
  assert.equal(noAsset.reason, 'no-asset', 'Figure 2 has no \\includegraphics in this e-print');
});

test('a network error reports unavailable, and FIGURE_ARXIV_SOURCE=0 skips without fetching', async () => {
  const { arxivSourceFigure } = arxiv();
  const down = fakeFetch({ [HTML_URL]: new Error('getaddrinfo ENOTFOUND arxiv.org'), [EPRINT_URL]: new Error('getaddrinfo ENOTFOUND arxiv.org') });
  const r = await arxivSourceFigure(ID, labelKey('Figure', '4'), { fetchBytes: down.fn, cacheRoot: freshCache(), env: {} });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unavailable');
  assert.ok(r.notes.some((n: string) => n.startsWith('arxiv-source: unavailable (') && n.includes('ENOTFOUND')), `notes: ${JSON.stringify(r.notes)}`);
  const halfDown = fakeFetch({ [HTML_URL]: HTML, [EPRINT_URL]: new Error('HTTP 503') });
  const half = await arxivSourceFigure(ID, labelKey('Figure', '4'), { fetchBytes: halfDown.fn, cacheRoot: freshCache(), env: {} });
  assert.equal(half.reason, 'unavailable', 'no e-print means no asset bytes');
  const off = fakeFetch({});
  const skipped = await arxivSourceFigure(ID, labelKey('Figure', '4'), { fetchBytes: off.fn, cacheRoot: freshCache(), env: { FIGURE_ARXIV_SOURCE: '0' } });
  assert.equal(skipped.ok, false);
  assert.equal(skipped.reason, 'disabled');
  assert.equal(off.urls.length, 0);
});

test('the CLI writes figure-4.jpg from a filled cache with no network', () => {
  const cacheRoot = path.join(TMP, 'cli-cache');
  fs.mkdirSync(path.join(cacheRoot, ID), { recursive: true });
  fs.writeFileSync(path.join(cacheRoot, ID, 'eprint.tar.gz'), EPRINT);
  fs.writeFileSync(path.join(cacheRoot, ID, 'html.html'), HTML);
  const out = path.join(TMP, 'cli-out');
  const script = path.join(REPO_ROOT, 'scripts', 'figure-arxiv.ts');
  assert.ok(fs.existsSync(script), 'scripts/figure-arxiv.ts does not exist');
  const run = spawnSync(process.execPath, ['--require', 'ts-node/register', script, ID, 'Figure 4', out, '--cache-dir', cacheRoot], {
    cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1', FIGURE_ARXIV_SOURCE: '1' },
  });
  assert.equal(run.status, 0, run.stderr);
  const rec = JSON.parse(run.stdout.trim().split('\n').pop()!);
  assert.equal(rec.asset, 'figure-4.jpg');
  assert.equal(rec.provenance, 'arxiv-source');
  assert.equal(rec.label, 'Figure 4');
  assert.ok(fs.existsSync(path.join(out, 'figure-4.jpg')));
  assert.equal(rec.sha256, sha(fs.readFileSync(path.join(out, 'figure-4.jpg'))));
  assert.ok(Math.abs(rec.width - 1983) <= 2);
  const miss = spawnSync(process.execPath, ['--require', 'ts-node/register', script, ID, 'Figure 9', path.join(TMP, 'cli-miss'), '--cache-dir', cacheRoot], {
    cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' },
  });
  assert.equal(miss.status, 1, 'a fall-through exits 1');
  assert.equal(JSON.parse(miss.stdout.trim().split('\n').pop()!).reason, 'eps-only');
  assert.equal(fs.existsSync(path.join(TMP, 'cli-miss')), false, 'a fall-through writes nothing');
  const usage = spawnSync(process.execPath, ['--require', 'ts-node/register', script], {
    cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' },
  });
  assert.equal(usage.status, 2, 'a usage error exits 2');
});

test('no new dependency, no legacy import, no sips', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'src', 'figure-locator', 'arxiv-source.ts'), 'utf8');
  assert.doesNotMatch(src, /figure-vlm/);
  assert.doesNotMatch(src, /'sips'/);
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  for (const dep of ['tar', 'tar-stream', 'jszip', 'adm-zip', 'sharp', 'jsdom', 'cheerio']) {
    assert.equal(pkg.dependencies?.[dep] ?? pkg.devDependencies?.[dep], undefined, `${dep} must not be added`);
  }
});
// AUTOMETTA-CONTRACT-END
