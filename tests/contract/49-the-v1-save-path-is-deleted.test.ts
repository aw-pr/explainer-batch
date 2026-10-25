import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-49-'));

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/49-the-v1-save-path-is-deleted.md
Object.assign(process.env, {
  EXPLAINER_STATE_FILE: path.join(TMP, 'state.json'),
  EXPLAINER_INPUT_DIR: path.join(TMP, 'input'),
  EXPLAINER_OUTPUT_DIR: path.join(TMP, 'output'),
  EXPLAINER_OBSIDIAN_DIR: '',
  WEBSITE_REPO: '',
  FIGURE_RECREATE: '0',
});
delete process.env.MIN_CHART_POINTS;
globalThis.fetch = (async () => {
  throw new Error('49: network forbidden');
}) as typeof fetch;

const DELETED = [
  'saveResult',
  'SaveResult',
  'RunProvenance',
  'normalizeSchemaDrift',
  'canonicaliseExplainerJson',
  'normalizeExplainerJson',
  'stampProvenanceByline',
  'repairUntilValid',
  'RepairResult',
  'validateJsonOutput',
  'buildRepairInstruction',
  'buildReference',
  'formatCitationDate',
  'detectedSurname',
  'detectedPublished',
  'EXPLAINER_JSON_SCHEMA',
];

function source(relative: string): string {
  const file = path.join(REPO_ROOT, relative);
  assert.equal(fs.existsSync(file), true, `49: missing ${relative}`);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.trim().length > 0, `49: empty ${relative}`);
  return text;
}

function filesUnder(relative: string): string[] {
  const directory = path.join(REPO_ROOT, relative);
  assert.equal(fs.existsSync(directory), true, `49: missing ${relative}`);
  const walk = (dir: string): string[] => fs.readdirSync(dir).flatMap(name => {
    const file = path.join(dir, name);
    return fs.statSync(file).isDirectory() ? walk(file) : [file];
  });
  const files = walk(directory);
  assert.ok(files.length > 0, `49: no files scanned under ${relative}`);
  return files;
}

function freshOutput(minimum?: string): Record<string, any> {
  const file = require.resolve('../../src/output');
  const cached = require.cache[file];
  const previous = process.env.MIN_CHART_POINTS;
  delete require.cache[file];
  if (minimum === undefined) delete process.env.MIN_CHART_POINTS;
  else process.env.MIN_CHART_POINTS = minimum;
  try {
    return require(file);
  } finally {
    delete require.cache[file];
    if (cached) require.cache[file] = cached;
    if (previous === undefined) delete process.env.MIN_CHART_POINTS;
    else process.env.MIN_CHART_POINTS = previous;
  }
}

function charts(): Array<Record<string, any>> {
  return [
    {
      kind: 'bar',
      title: 'Six measured cases',
      caption: 'Measurements across six cases.',
      x: {
        label: 'Case', unit: null, type: 'category',
        values: ['A', 'B', 'C', 'D', 'E', 'F'],
      },
      y: { label: 'Latency', unit: 'ms', scale: 'linear' },
      series: [{
        name: 'Measured',
        values: [12.5, 30.1, 7.2, 44, 18, 26],
        points: null,
        source: { kind: 'table', ref: 'Table 2', page: 4 },
      }],
    },
    {
      kind: 'bar',
      title: 'Five measured cases',
      caption: 'Measurements across five cases.',
      x: {
        label: 'Case', unit: null, type: 'category',
        values: ['A', 'B', 'C', 'D', 'E'],
      },
      y: { label: 'Latency', unit: 'ms', scale: 'linear' },
      series: [{
        name: 'Measured',
        values: [12.5, 30.1, 7.2, 44, 18],
        points: null,
        source: { kind: 'table', ref: 'Table 3', page: 5 },
      }],
    },
  ];
}

function styleFixture(paragraph: string): Record<string, any> {
  return {
    hero: {
      title: 'Governed agents',
      headline: 'Planning precedes execution',
      emphasis: null,
      subtitle: 'Policy checks constrain tool use.',
    },
    top_block: {
      kind: 'pills',
      pills: [
        { lead: 'Governance', text: 'Policy checks precede tool use.' },
        { lead: 'Inspection', text: 'Recorded decisions support review.' },
      ],
    },
    sections: [
      { label: 'Architecture', paragraphs: [paragraph], list: null, table: null },
      {
        label: 'Limits',
        paragraphs: ['The findings describe the tested cases.'],
        list: null,
        table: null,
      },
    ],
    charts: [],
    figure_request: null,
    end_takeaway: { label: 'Implication', body: 'Inspect decisions before execution.' },
    citation: {
      authors: [{ family: 'Smith', given: null }],
      year: 2026,
      title: 'Governed agent architectures',
      venue: null,
      url: 'https://example.org/paper',
    },
  };
}

test('49: the hand-written v1 schema is deleted', () => {
  const schema = path.join(REPO_ROOT, 'src/schema/explainer-schema.ts');
  assert.equal(fs.existsSync(schema), false, '49: v1 schema survives');
});

test('49: deleted names occur nowhere under src or scripts', () => {
  assert.ok(DELETED.length > 0, '49: deleted-name list');
  const pattern = new RegExp(`\\b(?:${DELETED.join('|')})\\b`);
  for (const root of ['src', 'scripts']) {
    for (const file of filesUnder(root)) {
      const text = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(
        text,
        pattern,
        `49: deleted name survives in ${path.relative(REPO_ROOT, file)}`,
      );
    }
  }
});

test('49: the v1 detected reference is gone from detection and request state', () => {
  for (const file of ['src/preprocess.ts', 'src/state.ts']) {
    assert.doesNotMatch(source(file), /\bdetectedReference\b/, `49: ${file} still carries detectedReference`);
  }
  assert.match(source('src/state.ts'), /\bdetectedCitation\b/, '49: request state lost detectedCitation');
});

test('49: quality and repair no longer import the v1 type', () => {
  for (const file of ['src/quality.ts', 'src/repair.ts']) {
    assert.doesNotMatch(
      source(file),
      /(?:from\s*|require\s*\(\s*|import\s*\(\s*)['"][^'"]*types\/explainer-json(?:\.ts)?['"]/,
      `49: ${file} imports the v1 type`,
    );
  }
});

test('49: kept helpers and repair bound remain exported', () => {
  const output = freshOutput();
  const quality = require('../../src/quality') as Record<string, any>;
  const repair = require('../../src/repair') as Record<string, any>;
  const style = require('../../src/style-lint') as Record<string, any>;
  for (const name of ['extractJson', 'persistArtefact', 'saveRawOutput', 'dropThinCharts']) {
    assert.equal(typeof output[name], 'function', `49: output.${name}`);
  }
  for (const name of ['chartIssues', 'buildWireRepairInstruction']) {
    assert.equal(typeof quality[name], 'function', `49: quality.${name}`);
  }
  assert.equal(repair.MAX_REPAIR_ATTEMPTS, 2, '49: repair bound');
  assert.equal(typeof style.lintStyle, 'function', '49: lintStyle');
});

test('49: the default thin-chart rule keeps six values and records the five-value chart', () => {
  const output = freshOutput();
  assert.equal(typeof output.dropThinCharts, 'function', '49: dropThinCharts');
  const input = charts();
  assert.equal(input.length, 2, '49: two literal charts');
  const result = output.dropThinCharts(input);
  assert.deepEqual(result.kept, [input[0]], '49: only six-value chart retained');
  assert.ok(Array.isArray(result.dropped) && result.dropped.length > 0, '49: dropped record');
  assert.ok(
    result.dropped.some((message: string) => message.includes('Five measured cases')),
    '49: dropped record names the five-value chart',
  );
});

test('49: a fresh output module honours MIN_CHART_POINTS=3', () => {
  const output = freshOutput('3');
  assert.equal(typeof output.dropThinCharts, 'function', '49: overridden dropThinCharts');
  const input = charts();
  const result = output.dropThinCharts(input);
  assert.deepEqual(result.kept, input, '49: both charts retained with minimum three');
  assert.deepEqual(result.dropped, [], '49: neither chart dropped with minimum three');
});

test('49: finalise calls the exported thin-chart helper', () => {
  assert.match(
    source('src/finalize.ts'),
    /\bdropThinCharts\s*\(/,
    '49: finalise does not call dropThinCharts',
  );
});

test('49: style lint reads v2 paragraphs and ignores v1-only fields', () => {
  const { lintStyle } = require('../../src/style-lint');
  assert.equal(typeof lintStyle, 'function', '49: lintStyle export');
  const bad = styleFixture('Planning precedes execution — subject to policy checks.');
  const issues = lintStyle(bad);
  assert.equal(issues.length, 1, '49: exactly one style issue');
  assert.equal(issues[0].check, 'dash', '49: dash issue');
  assert.equal(issues[0].path, 'sections[0].paragraphs[0]', '49: v2 paragraph path');
  assert.ok(issues[0].message.trim().length > 0, '49: non-empty style message');

  assert.deepEqual(
    lintStyle(styleFixture('Planning precedes execution, subject to policy checks.')),
    [],
    '49: clean v2 fixture',
  );
  assert.deepEqual(lintStyle({
    sections: [{ paragraphs_html: ['Legacy prose — with a dash.'] }],
    top_block: { pills: [{ number: '999% — legacy' }] },
  }), [], '49: v1-only keys are ignored');
});

test('49: documentation describes the seam and generated schemas', () => {
  for (const file of ['CLAUDE.md', 'AGENTS.md', 'README.md']) {
    assert.doesNotMatch(
      source(file),
      /\bsaveResult\b|\bnormalizeSchemaDrift\b|src\/schema\//,
      `49: stale v1 documentation in ${file}`,
    );
  }
  const claude = source('CLAUDE.md');
  assert.match(claude, /src\/finalize\.ts/, '49: module map lists finalise');
  assert.match(claude, /src\/wire-schema\.ts/, '49: module map lists wire schema');
});
// AUTOMETTA-CONTRACT-END
