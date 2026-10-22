// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/50-the-lead-figure-is-a-sidecar-asset.md
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.resolve(__dirname, '../..');
const TMP = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), 'eb-contract-50-')),
);
const OUT_DIR = path.join(TMP, 'output');
const REVIEW_DIR = path.join(OUT_DIR, 'review');
const WEBSITE_DIR = path.join(TMP, 'website');
const STAGING_DIR = path.join(WEBSITE_DIR, 'explainers-new');
const MIRROR_DIR = path.join(TMP, 'mirror');

for (const dir of ['input', 'output', 'website', 'mirror']) {
  fs.mkdirSync(path.join(TMP, dir));
}

Object.assign(process.env, {
  EXPLAINER_STATE_FILE: path.join(TMP, 'state.json'),
  EXPLAINER_INPUT_DIR: path.join(TMP, 'input'),
  EXPLAINER_OUTPUT_DIR: OUT_DIR,
  EXPLAINER_OBSIDIAN_DIR: MIRROR_DIR,
  WEBSITE_REPO: WEBSITE_DIR,
  FIGURE_RECREATE: '1',
});
delete process.env.MIN_CHART_POINTS;

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error('50: network forbidden');
}) as typeof fetch;

after(() => {
  globalThis.fetch = originalFetch;
  fs.rmSync(TMP, { recursive: true, force: true });
});

// A real 1x1 JPEG (sips output from a 1x1 RGB PNG), so imageSize reads its SOF header.
const JPEG = Buffer.from(
  'ffd8ffe000104a46494600010100004800480000ffe1004c4578696600004d4d002a0000000800018769000400000001' +
  '0000001a000000000003a00100030000000100010000a00200040000000100000001a003000400000001000000010000' +
  '0000ffed003850686f746f73686f7020332e30003842494d04040000000000003842494d0425000000000010d41d8cd9' +
  '8f00b204e9800998ecf8427effc00011080001000103012200021101031101ffc4001f00000105010101010101000000' +
  '00000000000102030405060708090a0bffc400b5100002010303020403050504040000017d0102030004110512213141' +
  '0613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a4344' +
  '45464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2' +
  'a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3' +
  'f4f5f6f7f8f9faffc4001f0100030101010101010101010000000000000102030405060708090a0bffc400b511000201' +
  '02040403040705040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272' +
  'd10a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a73' +
  '7475767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6' +
  'c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faffdb0043000606060606060a06060a0e0a' +
  '0a0a0e120e0e0e0e12171212121212171c1717171717171c1c1c1c1c1c1c1c22222222222227272727272c2c2c2c2c2c' +
  '2c2c2c2cffdb0043010707070b0a0b130a0a132e1f1a1f2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e' +
  '2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2effdd00040001ffda000c03010002110311003f00f3aa28' +
  'a2be38fe913fffd9',
  'hex',
);

const PNG = Buffer.from(
  '89504e470d0a1a0a' +
  '0000000d49484452000000020000000108020000007b40e8dd' +
  '0000000d49444154789c63f8cfc000440008fe01ffc69e79f7' +
  '0000000049454e44ae426082',
  'hex',
);

const RANDOM_BYTES = Buffer.from('6ea14c09d23785f0b8632de74a915c08', 'hex');
const EXPECTED_DATE = '2026-10-22';
const CAPTION = 'Planning and execution are separated by policy checks.';
const ALT_TEXT = 'A planning component feeds a policy gate before execution.';

type Doc = Record<string, any>;
type FigureAsset = {
  label: string;
  caption: string;
  alt_text: string;
  bytes: Buffer;
  page?: number;
  provenance: 'vlm-crop';
};
type FigureHook = (
  wire: Doc,
  itemKey: string,
) => Promise<FigureAsset | null>;

function doc(title: string): Doc {
  return {
    hero: {
      title,
      headline: 'Governed agents separate planning from execution',
      emphasis: null,
      subtitle: 'The paper describes explicit controls for tool use.',
    },
    top_block: {
      kind: 'pills',
      pills: [
        { lead: 'Governance', text: 'Policy checks precede tool use.' },
        { lead: 'Audit trail', text: 'Recorded decisions support inspection.' },
      ],
    },
    sections: [
      {
        label: 'Architecture',
        paragraphs: ['The paper separates planning from execution.'],
        list: null,
        table: null,
      },
      {
        label: 'Evidence',
        paragraphs: ['The diagram shows the policy gate between components.'],
        list: null,
        table: null,
      },
      {
        label: 'Limits',
        paragraphs: ['Further evaluation remains necessary.'],
        list: null,
        table: null,
      },
    ],
    charts: [],
    figure_request: {
      label: 'Figure 3',
      why: 'The diagram shows the separation of planning and execution.',
    },
    end_takeaway: {
      label: 'Implication',
      body: 'Explicit policy checks make agent decisions easier to inspect.',
    },
    citation: {
      authors: [{ family: 'Smith', given: null }],
      year: 2026,
      title: 'Governed agent architectures',
      venue: null,
      url: 'https://example.org/paper',
    },
  };
}

function receipt(text: string, overrides: Doc = {}): Doc {
  return {
    provider: 'openai',
    route: 'batch-api',
    stage: 'synthesis',
    model: 'gpt-5.6-terra',
    customId: 'cid-50',
    attemptId: 'attempt-1',
    finishReason: 'stop',
    text,
    usage: {
      in: 1000,
      out: 500,
      cacheRead: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      source: 'reported',
    },
    ...overrides,
  };
}

function store() {
  const map = new Map<string, string>();
  return {
    map,
    get(key: string) {
      const value = map.get(key);
      return value === undefined ? undefined : JSON.parse(value);
    },
    put(key: string, value: unknown) {
      assert.ok(key.length > 0, '50: checkpoint key is non-empty');
      const encoded = JSON.stringify(value);
      assert.ok(
        typeof encoded === 'string' && encoded.length > 0,
        '50: checkpoint is serialisable and non-empty',
      );
      map.set(key, encoded);
    },
  };
}

function repairer(replies: Doc[]) {
  const calls: Array<{ instruction: string; payload: string }> = [];
  const fn = async (instruction: string, payload: string): Promise<any> => {
    assert.ok(
      typeof instruction === 'string' && instruction.length > 0,
      '50: repair instruction is non-empty',
    );
    assert.ok(
      typeof payload === 'string' && payload.length > 0,
      '50: repair payload is non-empty',
    );
    calls.push({ instruction, payload });
    const reply = replies.shift();
    assert.ok(reply, '50: repair has an expected reply');
    return reply;
  };
  return { calls, fn };
}

function figure(label = 'Figure 3', bytes = JPEG): FigureAsset {
  return {
    label,
    caption: CAPTION,
    alt_text: ALT_TEXT,
    bytes: Buffer.from(bytes),
    page: 4,
    provenance: 'vlm-crop',
  };
}

function hookReturning(asset: FigureAsset | null) {
  const calls: Array<{ wire: Doc; itemKey: string }> = [];
  const fn: FigureHook = async (wire, itemKey) => {
    calls.push({ wire, itemKey });
    return asset;
  };
  return { calls, fn };
}

function seam(): Record<string, any> {
  const mod = require('../../src/finalize');
  assert.equal(typeof mod.finalizeResult, 'function', '50: finalizeResult exists');
  return mod;
}

async function run(
  itemKey: string,
  wire: Doc,
  hook: FigureHook,
  overrides: Doc = {},
): Promise<any> {
  const repair = repairer([]);
  return seam().finalizeResult(
    itemKey,
    receipt(JSON.stringify(wire)),
    {
      stamp: { expectedDate: EXPECTED_DATE },
      checkpoints: store(),
      repair: repair.fn,
      figure: hook,
      ...overrides,
    },
  );
}

function cleanJson(text: string, description: string): void {
  assert.ok(text.trim().length > 0, `50: ${description} is non-empty`);
  assert.doesNotMatch(text, /data:image/i, `50: ${description} has no inline image`);
  assert.doesNotMatch(
    text,
    /recreated_figure/,
    `50: ${description} has no recreated_figure`,
  );
}

function saved(outcome: any, wire: Doc): Doc {
  assert.ok(
    ['succeeded', 'needs_review'].includes(outcome.status),
    '50: outcome has a saved status',
  );
  assert.ok(
    typeof outcome.jsonPath === 'string' && outcome.jsonPath.length > 0,
    '50: saved JSON path is non-empty',
  );
  assert.ok(fs.existsSync(outcome.jsonPath), '50: saved JSON exists');

  const text = fs.readFileSync(outcome.jsonPath, 'utf8');
  cleanJson(text, 'saved JSON');
  const article = JSON.parse(text);
  assert.deepEqual(article, outcome.article, '50: disk and outcome articles agree');

  const { ExplainerV2 } = require('../../contract/explainer-v2');
  assert.equal(
    ExplainerV2.safeParse(article).success,
    true,
    '50: saved JSON satisfies ExplainerV2',
  );
  assert.match(
    article.metadata.slug,
    /^\d{4}-\d{2}-\d{2}_[a-z0-9][a-z0-9_-]*_explainer$/,
    '50: saved slug is non-empty and safe',
  );
  assert.equal(
    outcome.artefactDigest,
    crypto.createHash('sha256').update(text).digest('hex'),
    '50: artefact digest covers exactly the saved JSON bytes',
  );

  if (wire.figure_request !== null) {
    assert.deepEqual(
      article.figure_request,
      wire.figure_request,
      '50: figure_request is retained',
    );
  }

  for (const directory of [STAGING_DIR, MIRROR_DIR]) {
    const copy = path.join(directory, `${article.metadata.slug}.json`);
    if (outcome.status === 'succeeded') {
      assert.ok(fs.existsSync(copy), '50: successful JSON copy exists');
      const copyText = fs.readFileSync(copy, 'utf8');
      cleanJson(copyText, 'copied JSON');
      assert.equal(copyText, text, '50: JSON copy is byte-identical');
    } else {
      assert.equal(fs.existsSync(copy), false, '50: review JSON is not copied');
    }
  }
  return article;
}

function assertAssetCopies(article: Doc, filename: string, bytes: Buffer): void {
  assert.ok(bytes.length > 0, '50: expected image bytes are non-empty');
  assert.equal(
    article.lead_figure.asset,
    `${article.metadata.slug}/${filename}`,
    '50: asset path uses the literal expected filename',
  );
  for (const directory of [OUT_DIR, STAGING_DIR, MIRROR_DIR]) {
    const file = path.join(directory, article.metadata.slug, filename);
    assert.ok(fs.existsSync(file), `50: sidecar exists in ${directory}`);
    assert.deepEqual(fs.readFileSync(file), bytes, '50: sidecar bytes are identical');
  }
}

function assertNoSidecar(article: Doc): void {
  assert.equal(
    Object.hasOwn(article, 'lead_figure'),
    false,
    '50: no lead_figure property',
  );
  for (const directory of [OUT_DIR, REVIEW_DIR, STAGING_DIR, MIRROR_DIR]) {
    assert.equal(
      fs.existsSync(path.join(directory, article.metadata.slug)),
      false,
      '50: no sidecar directory was written',
    );
  }
}

function assertDropped(article: Doc, message: string): void {
  const dropped = article.metadata.quality.dropped;
  assert.ok(
    Array.isArray(dropped) && dropped.length > 0,
    '50: dropped record is non-empty',
  );
  assert.ok(dropped.includes(message), `50: dropped contains "${message}"`);
}

test('50: fixture is valid v2 wire output', () => {
  const { ModelOutputV2 } = require('../../contract/explainer-v2');
  assert.equal(
    ModelOutputV2.safeParse(doc('Valid sidecar fixture')).success,
    true,
    '50: wire fixture validates',
  );
  assert.ok(JPEG.length > 0, '50: JPEG literal is non-empty');
  assert.ok(PNG.length > 0, '50: PNG literal is non-empty');
  assert.ok(RANDOM_BYTES.length > 0, '50: random bytes literal is non-empty');
});

test('50: JPEG stamps the complete lead figure and copies exact bytes', async () => {
  const wire = doc('JPEG sidecar');
  const hook = hookReturning(figure());
  const outcome = await run('jpeg-sidecar', wire, hook.fn);
  assert.equal(outcome.status, 'succeeded', '50: JPEG outcome succeeds');
  assert.equal(hook.calls.length, 1, '50: JPEG hook called once');
  assert.equal(hook.calls[0].itemKey, 'jpeg-sidecar', '50: hook receives itemKey');
  assert.deepEqual(
    hook.calls[0].wire.figure_request,
    wire.figure_request,
    '50: hook receives the requested figure',
  );

  const article = saved(outcome, wire);
  assert.deepEqual(article.lead_figure, {
    label: 'Figure 3',
    caption: CAPTION,
    alt_text: ALT_TEXT,
    asset: `${article.metadata.slug}/figure-3.jpg`,
    sha256: crypto.createHash('sha256').update(JPEG).digest('hex'),
    width: 1,
    height: 1,
    page: 4,
    provenance: 'vlm-crop',
  }, '50: complete JPEG lead_figure stamp');
  assert.equal(
    outcome.jsonPath,
    path.join(OUT_DIR, `${article.metadata.slug}.json`),
    '50: successful JSON is in output',
  );
  assert.deepEqual(outcome.destinations, {
    output: 'written',
    staging: 'written',
    mirror: 'written',
  }, '50: successful destinations are written');
  assertAssetCopies(article, 'figure-3.jpg', JPEG);
});

test('50: Figure 4b PNG has panel filename and 2x1 dimensions', async () => {
  const wire = doc('PNG panel sidecar');
  wire.figure_request.label = 'Figure 4b';
  const hook = hookReturning(figure('Figure 4b', PNG));
  const outcome = await run('png-panel', wire, hook.fn);
  assert.equal(outcome.status, 'succeeded', '50: PNG outcome succeeds');
  assert.equal(hook.calls.length, 1, '50: PNG hook called once');
  const article = saved(outcome, wire);
  assert.equal(article.lead_figure.label, 'Figure 4b', '50: panel label retained');
  assert.equal(article.lead_figure.width, 2, '50: PNG width is two');
  assert.equal(article.lead_figure.height, 1, '50: PNG height is one');
  assert.equal(
    article.lead_figure.sha256,
    crypto.createHash('sha256').update(PNG).digest('hex'),
    '50: PNG hash covers literal bytes',
  );
  assertAssetCopies(article, 'figure-4b.png', PNG);
});

test('50: Table 2 keeps the table noun in its filename', async () => {
  const wire = doc('Table sidecar');
  wire.figure_request.label = 'Table 2';
  const hook = hookReturning(figure('Table 2'));
  const outcome = await run('table-sidecar', wire, hook.fn);
  assert.equal(outcome.status, 'succeeded', '50: table outcome succeeds');
  assert.equal(hook.calls.length, 1, '50: table hook called once');
  const article = saved(outcome, wire);
  assert.equal(article.lead_figure.label, 'Table 2', '50: table label retained');
  assertAssetCopies(article, 'table-2.jpg', JPEG);
});

test('50: a label without a number uses figure.png', async () => {
  const wire = doc('Overview sidecar');
  wire.figure_request.label = 'Overview';
  const hook = hookReturning(figure('Overview', PNG));
  const outcome = await run('overview-sidecar', wire, hook.fn);
  assert.equal(outcome.status, 'succeeded', '50: overview outcome succeeds');
  assert.equal(hook.calls.length, 1, '50: overview hook called once');
  const article = saved(outcome, wire);
  assert.equal(article.lead_figure.label, 'Overview', '50: overview label retained');
  assertAssetCopies(article, 'figure.png', PNG);
});

test('50: null figure result records the reason without changing success', async () => {
  const wire = doc('No located figure');
  const hook = hookReturning(null);
  const outcome = await run('no-located-figure', wire, hook.fn);
  assert.equal(outcome.status, 'succeeded', '50: null figure preserves success');
  assert.equal(hook.calls.length, 1, '50: null-result hook called once');
  const article = saved(outcome, wire);
  assertDropped(article, 'figure_request: no figure located');
  assertNoSidecar(article);
});

test('50: throwing figure hook records boom without changing success', async () => {
  const wire = doc('Throwing figure hook');
  let calls = 0;
  const outcome = await run('throwing-figure', wire, async () => {
    calls++;
    throw new Error('boom');
  });
  assert.equal(outcome.status, 'succeeded', '50: thrown error preserves success');
  assert.equal(calls, 1, '50: throwing hook called once');
  const article = saved(outcome, wire);
  assertDropped(article, 'figure_request: boom');
  assertNoSidecar(article);
});

test('50: random non-image bytes are dropped', async () => {
  const wire = doc('Unrecognised figure bytes');
  const hook = hookReturning(figure('Figure 3', RANDOM_BYTES));
  const outcome = await run('random-figure', wire, hook.fn);
  assert.equal(outcome.status, 'succeeded', '50: invalid bytes preserve success');
  assert.equal(hook.calls.length, 1, '50: invalid-bytes hook called once');
  const article = saved(outcome, wire);
  assertDropped(article, 'figure_request: unrecognised image bytes');
  assertNoSidecar(article);
});

test('50: null figure_request never calls the figure hook', async () => {
  const wire = doc('No requested figure');
  wire.figure_request = null;
  let calls = 0;
  const outcome = await run('no-requested-figure', wire, async () => {
    calls++;
    return figure();
  });
  assert.equal(outcome.status, 'succeeded', '50: null request succeeds');
  assert.equal(calls, 0, '50: figure hook is never called');
  const article = saved(outcome, wire);
  assertNoSidecar(article);
});

test('50: replay restores checkpointed bytes without another hook call', async () => {
  const wire = doc('Replay sidecar');
  const checkpoints = store();
  const hook = hookReturning(figure());
  const input = receipt(JSON.stringify(wire), { attemptId: 'replay-attempt-50' });
  const context = {
    stamp: { expectedDate: EXPECTED_DATE },
    checkpoints,
    figure: hook.fn,
    repair: repairer([]).fn,
  };

  const first = await seam().finalizeResult('replay-item-50', input, context);
  assert.equal(first.status, 'succeeded', '50: first replay outcome succeeds');
  assert.equal(hook.calls.length, 1, '50: initial hook called once');
  const firstArticle = saved(first, wire);
  assertAssetCopies(firstArticle, 'figure-3.jpg', JPEG);
  assert.match(first.artefactDigest, /^[0-9a-f]{64}$/, '50: first digest is valid');

  const encodedCheckpoints = [...checkpoints.map.values()].join('\n');
  assert.ok(encodedCheckpoints.length > 0, '50: checkpoints are non-empty');
  assert.ok(
    encodedCheckpoints.includes(JPEG.toString('base64')),
    '50: checkpoints retain image bytes as base64',
  );

  for (const directory of [OUT_DIR, STAGING_DIR, MIRROR_DIR]) {
    fs.unlinkSync(path.join(directory, firstArticle.metadata.slug, 'figure-3.jpg'));
  }

  const second = await seam().finalizeResult('replay-item-50', input, context);
  assert.equal(second.status, 'succeeded', '50: replay outcome succeeds');
  assert.equal(hook.calls.length, 1, '50: replay makes no further figure call');
  assert.equal(
    second.artefactDigest,
    first.artefactDigest,
    '50: replay preserves artefactDigest',
  );
  const secondArticle = saved(second, wire);
  assert.deepEqual(secondArticle, firstArticle, '50: replay preserves article');
  assertAssetCopies(secondArticle, 'figure-3.jpg', JPEG);
});

test('50: review after two repairs writes its sidecar only under review', async () => {
  const wire = doc('Review sidecar');
  wire.sections.push(
    {
      label: 'Controls',
      paragraphs: ['Policy gates constrain tool use.'],
      list: null,
      table: null,
    },
    {
      label: 'Operations',
      paragraphs: ['Operators inspect recorded decisions.'],
      list: null,
      table: null,
    },
    {
      label: 'Scope',
      paragraphs: ['Further evaluation remains necessary.'],
      list: null,
      table: null,
    },
  );
  const repair = repairer([
    receipt(JSON.stringify(wire), {
      stage: 'repair', route: 'sync-api', attemptId: 'review-repair-1',
    }),
    receipt(JSON.stringify(wire), {
      stage: 'repair', route: 'sync-api', attemptId: 'review-repair-2',
    }),
  ]);
  let figureCalls = 0;
  const outcome = await run('review-sidecar', wire, async () => {
    assert.equal(repair.calls.length, 2, '50: figure hook runs after both repairs');
    figureCalls++;
    return figure();
  }, { repair: repair.fn });

  assert.equal(repair.calls.length, 2, '50: two repairs attempted');
  assert.equal(outcome.repairAttempts, 2, '50: two repairs recorded');
  assert.equal(figureCalls, 1, '50: review figure hook called once');
  assert.equal(outcome.status, 'needs_review', '50: editorial issue needs review');
  const article = saved(outcome, wire);
  assert.equal(article.sections.length, 6, '50: all six sections survive');
  assert.ok(
    article.metadata.quality.issues.length > 0,
    '50: review has surviving issues',
  );
  assert.match(
    article.metadata.quality.issues.join('\n'),
    /sections/,
    '50: surviving issue names sections',
  );
  assert.equal(
    outcome.jsonPath,
    path.join(REVIEW_DIR, `${article.metadata.slug}.json`),
    '50: review JSON path',
  );
  assert.equal(
    article.lead_figure.asset,
    `${article.metadata.slug}/figure-3.jpg`,
    '50: review asset is relative to review JSON',
  );
  const imagePath = path.join(REVIEW_DIR, article.metadata.slug, 'figure-3.jpg');
  assert.ok(fs.existsSync(imagePath), '50: review sidecar exists');
  assert.deepEqual(fs.readFileSync(imagePath), JPEG, '50: review sidecar bytes');
  assert.deepEqual(outcome.destinations, {
    output: 'written', staging: 'skipped', mirror: 'skipped',
  }, '50: review copies are skipped');

  for (const directory of [OUT_DIR, STAGING_DIR, MIRROR_DIR]) {
    assert.equal(
      fs.existsSync(path.join(directory, article.metadata.slug)),
      false,
      '50: review sidecar has no success, staging or mirror directory',
    );
    assert.equal(
      fs.existsSync(path.join(directory, `${article.metadata.slug}.json`)),
      false,
      '50: review JSON has no success, staging or mirror copy',
    );
  }
});

function readSource(relative: string): string {
  const source = fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
  assert.ok(source.trim().length > 0, `50: ${relative} is non-empty`);
  return source;
}

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : [file];
  });
}

test('50: production uses locateLeadFigure and never assigns recreated_figure', () => {
  const output = readSource('src/output.ts');
  assert.doesNotMatch(
    output,
    /\bfunction\s+attachFigureImage\b|\b(?:const|let|var)\s+attachFigureImage\b/,
    '50: attachFigureImage is no longer defined',
  );
  assert.match(
    output,
    /\bfunction\s+locateLeadFigure\b|\b(?:const|let|var)\s+locateLeadFigure\b/,
    '50: locateLeadFigure is defined',
  );

  const ts = require('typescript') as typeof import('typescript');
  const batch = ts.createSourceFile(
    'src/batch.ts',
    readSource('src/batch.ts'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const save = batch.statements.find(
    (node): node is import('typescript').FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'saveThroughSeam',
  );
  assert.ok(save?.body, '50: saveThroughSeam has a body');

  let hookCallsLocator = false;
  function visit(node: import('typescript').Node): void {
    if (
      ts.isPropertyAssignment(node) &&
      (
        ts.isIdentifier(node.name) ||
        ts.isStringLiteral(node.name)
      ) &&
      node.name.text === 'figure'
    ) {
      const initializer = node.initializer;
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        const findCall = (child: import('typescript').Node): void => {
          if (
            ts.isCallExpression(child) &&
            ts.isIdentifier(child.expression) &&
            child.expression.text === 'locateLeadFigure'
          ) {
            hookCallsLocator = true;
          }
          ts.forEachChild(child, findCall);
        };
        findCall(initializer.body);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(save.body);
  assert.equal(
    hookCallsLocator,
    true,
    '50: saveThroughSeam supplies a figure hook calling locateLeadFigure',
  );

  const files = sourceFiles(path.join(REPO_ROOT, 'src')).filter(file => {
    const relative = path.relative(REPO_ROOT, file).split(path.sep).join('/');
    return !relative.startsWith('src/types/') && relative !== 'src/figure-data.ts';
  });
  assert.ok(files.length > 0, '50: recreated_figure scan has source files');
  for (const file of files) {
    const relative = path.relative(REPO_ROOT, file);
    const source = readSource(relative);
    assert.doesNotMatch(
      source,
      /\.recreated_figure\s*=|recreated_figure\s*:/,
      `50: ${relative} never assigns recreated_figure`,
    );
  }
});

function smoke(detected: boolean): Doc {
  const guardPath = path.join(TMP, 'forbid-network.cjs');
  fs.writeFileSync(guardPath, `
const deny = () => { throw new Error('50: smoke network forbidden'); };
globalThis.fetch = deny;
require('node:net').Socket.prototype.connect = deny;
for (const name of ['node:http', 'node:https']) {
  const mod = require(name);
  mod.request = deny;
  mod.get = deny;
}
`, 'utf8');

  const args = [
    'ts-node',
    'scripts/smoke-contract.ts',
    'tests/unit/fixtures/v2/alenezi-agentic-ai-architecture.model-output.json',
    ...(detected ? ['--detected'] : []),
  ];
  const result = spawnSync('npx', args, {
    cwd: REPO_ROOT,
    timeout: 120_000,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 8 * 1024 * 1024,
    env: {
      ...process.env,
      NODE_OPTIONS: `--require ${JSON.stringify(guardPath)}`,
      npm_config_offline: 'true',
      npm_config_yes: 'false',
    },
  });

  assert.equal(
    result.status,
    0,
    `50: smoke exits zero (${result.error?.message ?? result.stderr ?? 'no stderr'})`,
  );
  cleanJson(result.stdout, 'smoke stdout');
  assert.match(
    result.stdout,
    /repair attempts: 0\b/,
    '50: smoke records zero repair attempts',
  );
  assert.ok(
    result.stdout.includes(`"origin": "${detected ? 'detected' : 'model'}"`),
    '50: smoke prints the expected citation origin',
  );
  const start = result.stdout.indexOf('{');
  const end = result.stdout.lastIndexOf('}');
  assert.ok(start >= 0 && end > start, '50: smoke prints a JSON object');
  const article = JSON.parse(result.stdout.slice(start, end + 1));
  const { ExplainerV2 } = require('../../contract/explainer-v2');
  assert.equal(
    ExplainerV2.safeParse(article).success,
    true,
    '50: smoke article satisfies ExplainerV2',
  );
  assert.equal(
    article.references[0].origin,
    detected ? 'detected' : 'model',
    '50: smoke reference has the expected origin',
  );
  assert.ok(article.lead_figure, '50: smoke includes a lead figure');
  assert.match(
    article.lead_figure.asset,
    /^[^/]+\/[^/]+\.jpg$/,
    '50: smoke lead figure uses a JPEG sidecar',
  );
  return article;
}

test('50: detected smoke runs offline with a JPEG and no repairs', () => {
  smoke(true);
});

test('50: model-citation smoke runs offline with a JPEG and no repairs', () => {
  smoke(false);
});
// AUTOMETTA-CONTRACT-END
