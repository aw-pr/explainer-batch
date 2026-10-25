// Contract test for stage-cards/26-caption-index-and-label-parser.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/26-caption-index-and-label-parser.test.ts
// Needs poppler (pdftotext) and the held PDFs: $EXPLAINER_HELD_DIR, else input/_held/ here, else ../explainer-batch/input/_held/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.join(__dirname, '..', '..');

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/26-caption-index-and-label-parser.md
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

const label = () => load('src/figure-locator/label');
const captions = () => load('src/figure-locator/captions');

function key(noun: string, number: string, panel?: string) {
  return panel === undefined ? { noun, number } : { noun, number, panel };
}

// Synthetic pdftotext -bbox-layout output: one <block> per entry, one line per
// string, words split on spaces. Coordinates are what the assertions read back.
interface SynthBlock { lines: string[]; x: number; y: number }
function synthXml(pages: SynthBlock[][]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const out = ['<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title></title></head><body><doc>'];
  for (const blocks of pages) {
    out.push('  <page width="612.000000" height="792.000000">');
    for (const b of blocks) {
      const yMax = b.y + 12 * b.lines.length;
      out.push(`    <flow><block xMin="${b.x.toFixed(6)}" yMin="${b.y.toFixed(6)}" xMax="${(b.x + 300).toFixed(6)}" yMax="${yMax.toFixed(6)}">`);
      b.lines.forEach((line, i) => {
        const ly = b.y + 12 * i;
        out.push(`      <line xMin="${b.x.toFixed(6)}" yMin="${ly.toFixed(6)}" xMax="${(b.x + 300).toFixed(6)}" yMax="${(ly + 10).toFixed(6)}">`);
        let x = b.x;
        for (const w of line.split(' ')) {
          out.push(`        <word xMin="${x.toFixed(6)}" yMin="${ly.toFixed(6)}" xMax="${(x + 6 * w.length).toFixed(6)}" yMax="${(ly + 10).toFixed(6)}">${esc(w)}</word>`);
          x += 6 * w.length + 3;
        }
        out.push('      </line>');
      });
      out.push('    </block></flow>');
    }
    out.push('  </page>');
  }
  out.push('</doc></body></html>');
  return out.join('\n');
}

const SYNTH = synthXml([
  [
    { lines: ['Figure 2: Event studies by', 'coding tool and production layer'], x: 72, y: 90 },
    { lines: ['Figure 8 presents the corresponding event studies for the', 'async agents, which we discuss below in more detail here.'], x: 72, y: 300 },
    { lines: ['the effect is largest in the top quartile of the sample. Figure 13. All in', 'all, these results show that adoption is broad and persistent.'], x: 72, y: 400 },
  ],
  [
    { lines: ['Figure 2 (continued): Event studies by', 'coding tool and production layer'], x: 72, y: 90 },
    { lines: ['Table 4: R&D spending by firm size'], x: 72, y: 500 },
  ],
  [
    { lines: ['Fig. 5(b). Panel detail for the second', 'experiment'], x: 320, y: 140 },
    { lines: ['Figure 2: Event studies in the appendix sample'], x: 72, y: 600 },
  ],
]);

test('parseLabel normalises nouns, numbers and panels', () => {
  const { parseLabel } = label();
  assert.deepEqual(parseLabel('Figure 3'), key('Figure', '3'));
  assert.deepEqual(parseLabel('Fig. 2(b)'), key('Figure', '2', 'b'));
  assert.deepEqual(parseLabel('Fig 2b'), key('Figure', '2', 'b'));
  assert.deepEqual(parseLabel('FIGURE 4'), key('Figure', '4'));
  assert.deepEqual(parseLabel('figure 7'), key('Figure', '7'));
  assert.deepEqual(parseLabel('Table IV'), key('Table', 'IV'));
  assert.deepEqual(parseLabel('Tab. 2'), key('Table', '2'));
  assert.deepEqual(parseLabel('TABLE 1'), key('Table', '1'));
  assert.deepEqual(parseLabel('Figure A1'), key('Figure', 'A1'));
  assert.deepEqual(parseLabel('Figure S2'), key('Figure', 'S2'));
  assert.deepEqual(parseLabel('Figure 3.1'), key('Figure', '3.1'));
  assert.deepEqual(parseLabel('Scheme 1'), key('Scheme', '1'));
  assert.deepEqual(parseLabel('Exhibit 6'), key('Exhibit', '6'));
  assert.equal(parseLabel('Chart 3'), null);
  assert.equal(parseLabel('the results'), null);
  assert.equal(parseLabel(''), null);
});

test('labelsEqual compares noun and number; Table 4 is never Figure 4', () => {
  const { parseLabel, labelsEqual } = label();
  assert.equal(labelsEqual(parseLabel('Table 4'), parseLabel('Figure 4')), false);
  assert.equal(labelsEqual(parseLabel('Fig. 4'), parseLabel('FIGURE 4')), true);
  assert.equal(labelsEqual(parseLabel('Figure 2(b)'), parseLabel('Figure 2')), true);
  assert.equal(labelsEqual(parseLabel('Figure 2'), parseLabel('Figure 12')), false);
  assert.equal(labelsEqual(parseLabel('Table A1'), parseLabel('Table 1')), false);
});

test('formatLabel writes noun, number and panel', () => {
  const { formatLabel } = label();
  assert.equal(formatLabel(key('Figure', '3')), 'Figure 3');
  assert.equal(formatLabel(key('Figure', '2', 'b')), 'Figure 2b');
  assert.equal(formatLabel(key('Table', 'IV')), 'Table IV');
});

test('matchCaption accepts caption starts and rejects references in prose', () => {
  const { matchCaption } = label();
  const yes: Array<[string, ReturnType<typeof key>]> = [
    ['Figure 1: Overview of Productivity Effects of AI Coding Tools', key('Figure', '1')],
    ['Figure 4. Comparison of PIC Algorithms.', key('Figure', '4')],
    ['Figure 3 The Software Production Hierarchy', key('Figure', '3')],
    ['Fig. 2(b): Second panel', key('Figure', '2', 'b')],
    ['Table 1: AI Coding Tools and the Production Hierarchy', key('Table', '1')],
    ['TABLE IV. Results', key('Table', 'IV')],
    ['Figure D2. Quantile-quantile plots for hydroelectric dams', key('Figure', 'D2')],
  ];
  for (const [text, want] of yes) {
    const m = matchCaption(text);
    assert.ok(m, `expected a caption match for "${text}"`);
    assert.deepEqual(m.key, want, text);
    assert.equal(m.continued, false, text);
  }
  for (const text of [
    'Figure 8 presents the corresponding event studies',
    'Figure 13 shows the same pattern',
    'Figures 3 and 4 show the results',
    'As Figure 2: shows',
    'Chart 3: Revenue',
  ]) {
    assert.equal(matchCaption(text), null, `"${text}" must not be a caption`);
  }
});

test('matchCaption marks continued captions', () => {
  const { matchCaption } = label();
  const a = matchCaption('Figure 2 (continued): Event studies by coding tool');
  assert.ok(a);
  assert.deepEqual(a.key, key('Figure', '2'));
  assert.equal(a.continued, true);
  const b = matchCaption('Table 3: (Continued) Summary statistics');
  assert.ok(b);
  assert.equal(b.continued, true);
});

test('parseCaptionIndex reads block-start captions only, with page, box and text', () => {
  const { parseCaptionIndex } = captions();
  const index = parseCaptionIndex(SYNTH, 4) as any[];
  assert.ok(Array.isArray(index));
  const summary = index.map(e => `${e.page} ${e.label} ${e.continued ? 'cont' : 'first'}`);
  assert.deepEqual(summary, ['4 Figure 2 first', '5 Figure 2 cont', '5 Table 4 first', '6 Figure 5b first', '6 Figure 2 first']);
  const first = index[0];
  assert.deepEqual(first.key, key('Figure', '2'));
  assert.equal(first.text, 'Figure 2: Event studies by coding tool and production layer');
  assert.deepEqual(first.box, { xMin: 72, yMin: 90, xMax: 372, yMax: 114 });
  assert.equal(index[2].text, 'Table 4: R&D spending by firm size');
  assert.deepEqual(index[3].box, { xMin: 320, yMin: 140, xMax: 620, yMax: 164 });
  assert.deepEqual(parseCaptionIndex(SYNTH).map((e: any) => e.page), [1, 2, 2, 3, 3]);
});

test('selectCaption prefers the first caption, uses the page hint only as a tie-breaker, and reports missing labels', () => {
  const { parseCaptionIndex, selectCaption } = captions();
  const { parseLabel } = label();
  const index = parseCaptionIndex(SYNTH, 4);

  const plain = selectCaption(index, parseLabel('Figure 2'));
  assert.equal(plain.ok, true);
  assert.equal(plain.entry.page, 4);
  assert.equal(plain.entry.continued, false);
  assert.deepEqual(plain.notes, []);

  const tie = selectCaption(index, parseLabel('Figure 2'), 6);
  assert.equal(tie.ok, true);
  assert.equal(tie.entry.page, 6);
  assert.deepEqual(tie.notes, []);

  const continuedPage = selectCaption(index, parseLabel('Figure 2'), 5);
  assert.equal(continuedPage.ok, true);
  assert.equal(continuedPage.entry.page, 4, 'a continued caption is never chosen over a first caption');
  assert.ok(continuedPage.notes.includes('page-hint-ignored'));

  const wrongHint = selectCaption(index, parseLabel('Table 4'), 9);
  assert.equal(wrongHint.ok, true);
  assert.equal(wrongHint.entry.page, 5);
  assert.ok(wrongHint.notes.includes('page-hint-ignored'));

  const panel = selectCaption(index, parseLabel('Figure 5'));
  assert.equal(panel.ok, true);
  assert.equal(panel.entry.label, 'Figure 5b');

  const onlyContinued = parseCaptionIndex(synthXml([[{ lines: ['Table 9 (continued): Leftover rows of the panel'], x: 72, y: 90 }]]), 2);
  const fallback = selectCaption(onlyContinued, parseLabel('Table 9'));
  assert.equal(fallback.ok, true, 'a continued caption is used when it is the only one');
  assert.equal(fallback.entry.continued, true);
  assert.equal(fallback.entry.page, 2);

  const missing = selectCaption(index, parseLabel('Figure 14'));
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'label-not-found');
  assert.deepEqual(missing.labels, ['Figure 2', 'Table 4', 'Figure 5b']);
});

test('buildCaptionIndex scans the whole w35275.pdf with no page cap', () => {
  const { buildCaptionIndex } = captions();
  const index = buildCaptionIndex(heldPdf('w35275.pdf')) as any[];
  assert.equal(index.length, 17);
  const labels = index.map(e => e.label).sort();
  const want = [
    ...Array.from({ length: 12 }, (_, i) => `Figure ${i + 1}`),
    ...Array.from({ length: 5 }, (_, i) => `Table ${i + 1}`),
  ].sort();
  assert.deepEqual(labels, want);
  const page = (l: string) => index.find(e => e.label === l)?.page;
  assert.equal(page('Figure 1'), 5);
  assert.equal(page('Figure 3'), 12);
  assert.equal(page('Figure 8'), 36);
  assert.equal(page('Figure 9'), 38);
  assert.equal(page('Table 1'), 15);
  assert.equal(index.filter(e => e.page === 36).length, 1, 'page 36 holds one caption; "Figure 8 presents" is prose');
  const fig1 = index.find(e => e.label === 'Figure 1');
  assert.ok(fig1.text.startsWith('Figure 1: Overview of Productivity Effects of AI Coding Tools'));
  assert.ok(fig1.box.yMin > 70 && fig1.box.yMin < 75, `Figure 1 caption top ${fig1.box.yMin}`);
});

test('buildCaptionIndex finds the evaluation figures in the other held PDFs', () => {
  const { buildCaptionIndex } = captions();
  const epic = buildCaptionIndex(heldPdf('2410.15332v3.pdf')) as any[];
  assert.equal(epic.find(e => e.label === 'Figure 4')?.page, 5);
  assert.equal(epic.length, 10);
  const fly = buildCaptionIndex(heldPdf('flyvbjerg-it-cost-risk.pdf')) as any[];
  assert.equal(fly.find(e => e.label === 'Figure 3')?.page, 9);
  assert.equal(fly.find(e => e.label === 'Figure 2')?.page, 8);
  assert.equal(fly.find(e => e.label === 'Figure D2')?.page, 24);
  assert.equal(fly.length, 22);
});

test('buildCaptionIndex throws on a missing PDF', () => {
  const { buildCaptionIndex } = captions();
  assert.throws(() => buildCaptionIndex(path.join(REPO_ROOT, 'no-such-file.pdf')), /no-such-file\.pdf/);
});

test('scripts/figure-captions.ts prints one tab-separated line per caption', () => {
  const script = path.join(REPO_ROOT, 'scripts', 'figure-captions.ts');
  assert.ok(fs.existsSync(script), 'scripts/figure-captions.ts does not exist');
  const run = spawnSync(process.execPath, ['--require', 'ts-node/register', script, heldPdf('w35275.pdf')], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' },
  });
  assert.equal(run.status, 0, run.stderr);
  const lines = run.stdout.trim().split('\n');
  assert.equal(lines.length, 17);
  assert.ok(lines.includes('p5\tFigure 1\tFigure 1: Overview of Productivity Effects of AI'), run.stdout);
  assert.ok(lines.some(l => l.startsWith('p12\tFigure 3\tFigure 3: The Software')), run.stdout);
  assert.ok(!lines.some(l => l.includes('presents')), 'a prose reference was printed');
  for (const l of lines) assert.match(l, /^p\d+\t(Figure|Table) \d+\t\S/);

  const missing = spawnSync(process.execPath, ['--require', 'ts-node/register', script, path.join(REPO_ROOT, 'no-such-file.pdf')], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' },
  });
  assert.notEqual(missing.status, 0);
});

test('the locator modules stand alone: no import of the legacy figure-vlm module', () => {
  for (const rel of ['src/figure-locator/label.ts', 'src/figure-locator/captions.ts']) {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    assert.doesNotMatch(src, /figure-vlm/, `${rel} imports the legacy module`);
  }
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'src', 'figure-vlm.ts')), 'src/figure-vlm.ts must stay until W10');
});
// AUTOMETTA-CONTRACT-END
