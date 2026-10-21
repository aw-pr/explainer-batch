// Contract test for stage-cards/21-a-pure-function-migrates-v1-to-v2.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/21-a-pure-function-migrates-v1-to-v2.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/21-a-pure-function-migrates-v1-to-v2.md
const SAMPLE = path.join(REPO_ROOT, 'output', '2026-04-16_alenezi_agentic-ai-architecture_explainer.json');
const SLUG = '2026-05-01_smith_agent-costs_explainer';
const NO_IO = { listing: [] as string[], bytes: (_: string) => undefined as Uint8Array | undefined };

function migrate(raw: unknown, io = NO_IO): Record<string, any> {
  const mod = require('../../contract/migrate-v1') as Record<string, any>;
  assert.equal(typeof mod.migrateV1, 'function', 'contract/migrate-v1.ts must export migrateV1');
  return mod.migrateV1(raw, io);
}

function migrated(raw: unknown, io = NO_IO): Record<string, any> {
  const r = migrate(raw, io);
  assert.equal(r.ok, true, `migrateV1 must succeed: ${r.reason ?? ''}`);
  const { ExplainerV2 } = require('../../contract/explainer-v2') as Record<string, any>;
  const parsed = ExplainerV2.safeParse(r.explainer);
  assert.ok(parsed.success, `the result must parse as ExplainerV2: ${JSON.stringify(parsed.error?.issues ?? []).slice(0, 400)}`);
  assert.equal(r.explainer.version, 2);
  assert.equal(r.explainer.metadata.migrated_from, 1);
  assert.equal(r.explainer.metadata.contract_revision, 1);
  assert.equal(r.explainer.references.length, 1);
  assert.equal(r.explainer.references[0].origin, 'legacy');
  assert.ok(Array.isArray(r.assets), 'a successful result carries an assets array');
  return r;
}

function has(list: string[], re: RegExp): boolean {
  return list.some((s) => re.test(s));
}

function v1(): Record<string, any> {
  return {
    version: 1,
    metadata: { title: 'Agent Costs: Smith (2026)', eyebrow: 'Research Explainer · Smith (2026)', date_created: '2026-05-01', filename_slug: SLUG },
    hero: { headline: 'Agents cut costs by a third', headline_html: 'Agents <span>cut costs by a third</span>', subtitle: 'What the study found.', publication_date: 'Published March 2026' },
    top_block: { kind: 'pills', pills: [{ number: '33%', description: 'Lower cost', accent_color: '#111111' }, { number: 'R&amp;D', description: 'Most affected', accent_color: '#222222' }] },
    sections: [
      { label: 'Why', paragraphs: ['Costs fell.'], paragraphs_html: ['Costs <strong>fell</strong>.'] },
      {
        label: 'How',
        paragraphs: ['Three steps.'],
        list: { ordered: true, style: 'steps', intro: 'Steps:', intro_html: 'Steps <em>in order</em>:', items: [{ label: 'One', body: 'Plan', body_html: '<strong>Plan</strong>' }] },
        table: { caption: 'Costs by year (Table 3, p. 12)', columns: ['Year', 'Cost'], rows: [['2025', '10']], align: ['left', 'right'] },
      },
    ],
    end_takeaway: { label: 'So what', body: 'Cheaper <em>and</em> faster.' },
    references: ['Smith, J. (2026). Agent costs in practice. <em>Journal of Agents</em>, 4(2), 1-20. <a href="https://doi.org/10.1/abc" target="_blank" rel="noopener noreferrer">https://doi.org/10.1/abc</a>'],
  };
}

function barConfig(type: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type,
    data: { labels: ['2024', '2025'], datasets: [{ label: 'Firms', data: [10, 12] }] },
    options: { scales: { x: { title: { text: 'Year' } }, y: { title: { text: 'Share of firms' } } } },
    ...extra,
  };
}

function png(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const zlib = require('node:zlib') as typeof import('node:zlib');
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

function hex(b: Uint8Array): string {
  return crypto.createHash('sha256').update(b).digest('hex');
}

test('the tracked v1 sample migrates to a valid v2 artefact', () => {
  const raw = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
  const { explainer: e, assets } = migrated(raw);
  assert.equal(e.metadata.slug, '2026-04-16_alenezi_agentic-ai-architecture_explainer');
  assert.equal(e.metadata.date_created, '2026-04-16');
  assert.equal(e.metadata.model, 'unknown');
  assert.equal(e.metadata.provider, 'unknown');
  assert.equal(e.metadata.route, 'unknown');
  assert.equal(e.metadata.source, undefined, 'a migrated artefact has no metadata.source');
  assert.equal(e.hero.title, 'Agentic AI Architecture');
  assert.equal(e.hero.emphasis, "they're becoming goal-directed systems with their own control loops");
  assert.equal(e.hero.publication_date, '2026-02');
  assert.equal(e.top_block.pills[0].lead, 'Reference Architecture');
  assert.equal(e.top_block.pills[0].accent_color, undefined);
  assert.match(e.sections[0].paragraphs[0], /Q&amp;A/);
  assert.match(e.sections[0].paragraphs[0], /<strong>missing architecture<\/strong>/);
  const ref = e.references[0];
  assert.equal(ref.authors[0].family, 'Alenezi');
  assert.equal(ref.year, 2026);
  assert.equal(ref.title, 'From Prompt-Response to Goal-Directed Systems: The Evolution of Agentic AI Software Architecture');
  assert.equal(ref.url, 'https://arxiv.org/abs/2602.10479');
  assert.equal(e.lead_figure.label, 'Figure 1');
  assert.equal(e.lead_figure.provenance, 'legacy');
  assert.equal(e.lead_figure.asset, '2026-04-16_alenezi_agentic-ai-architecture_explainer/figure-1.jpg');
  assert.equal(assets.length, 1, 'the base64 image becomes one asset to write');
  assert.equal(assets[0].path, e.lead_figure.asset);
  const b64 = String(raw.image.src).split(',')[1];
  assert.equal(Buffer.compare(Buffer.from(assets[0].bytes), Buffer.from(b64, 'base64')), 0, 'the asset bytes are the decoded base64');
  assert.equal(e.lead_figure.sha256, hex(Buffer.from(b64, 'base64')));
  assert.ok(Number.isInteger(e.lead_figure.width) && e.lead_figure.width > 0, 'a raster lead_figure carries its width');
  assert.ok(Number.isInteger(e.lead_figure.height) && e.lead_figure.height > 0, 'a raster lead_figure carries its height');
  assert.ok(!JSON.stringify(e).includes('data:image'), 'no base64 survives in the artefact');
});

test('v1 presentation fields map to v2 content fields', () => {
  const { explainer: e } = migrated(v1());
  assert.equal(e.hero.title, 'Agent Costs');
  assert.equal(e.hero.emphasis, 'cut costs by a third');
  assert.equal(e.hero.publication_date, '2026-03');
  assert.equal(e.top_block.pills[1].lead, 'R&D', 'pill numbers are entity-decoded');
  assert.equal(e.sections[0].paragraphs[0], 'Costs <strong>fell</strong>.', 'paragraphs come from the _html twin');
  const list = e.sections[1].list;
  assert.equal(list.intro, 'Steps <em>in order</em>:');
  assert.equal(list.items[0].body, '<strong>Plan</strong>');
  assert.equal(list.style, undefined, 'list.style is dropped');
  const table = e.sections[1].table;
  assert.equal(table.caption, 'Costs by year', 'the source tag leaves the caption');
  assert.deepEqual(table.source, { ref: 'Table 3', page: 12 });
  assert.equal(table.align, undefined, 'table.align is dropped');
  const ref = e.references[0];
  assert.equal(ref.authors[0].family, 'Smith');
  assert.equal(ref.year, 2026);
  assert.equal(ref.title, 'Agent costs in practice');
  assert.equal(ref.url, 'https://doi.org/10.1/abc');
  assert.equal(e.end_takeaway.body, 'Cheaper <em>and</em> faster.');
});

test('model and run_mode map to model, provider and route', () => {
  const none = migrated(v1()).explainer.metadata;
  assert.deepEqual([none.model, none.provider, none.route], ['unknown', 'unknown', 'unknown'], 'no model and no run_mode give unknown, never sync');
  const gpt = v1(); gpt.metadata.model = 'gpt-5.6-terra'; gpt.metadata.run_mode = 'sync';
  const g = migrated(gpt).explainer.metadata;
  assert.deepEqual([g.model, g.provider, g.route], ['gpt-5.6-terra', 'openai', 'sync']);
  const claude = v1(); claude.metadata.model = 'claude-opus-4-8'; claude.metadata.run_mode = 'batch';
  const c = migrated(claude).explainer.metadata;
  assert.deepEqual([c.model, c.provider, c.route], ['claude-opus-4-8', 'claude', 'batch']);
});

test('a convertible Chart.js chart becomes one legacy-sourced Chart and its duplicate is dropped', () => {
  const doc = v1();
  doc.charts = [{ title: 'Adoption', caption: 'Share of firms (Table 2, p. 6)', config_json: barConfig('bar'), config_raw: '' }];
  doc.chart = doc.charts[0];
  const { explainer: e } = migrated(doc);
  assert.equal(e.charts.length, 1, 'the identical legacy chart copy is not a second chart');
  const ch = e.charts[0];
  assert.equal(ch.kind, 'bar');
  assert.deepEqual(ch.x.values, ['2024', '2025']);
  assert.equal(ch.x.label, 'Year');
  assert.equal(ch.y.label, 'Share of firms');
  assert.equal(ch.series[0].name, 'Firms');
  assert.deepEqual(ch.series[0].values, [10, 12]);
  assert.equal(ch.series[0].source.kind, 'legacy');
  assert.equal(ch.series[0].source.ref, 'Table 2', 'the caption tag becomes the series source ref');
  const stacked = v1();
  stacked.charts = [{ title: 'Mix', caption: 'Mix', config_json: barConfig('bar', { options: { scales: { x: { stacked: true }, y: { stacked: true, title: { text: 'Share' } } } } }), config_raw: '' }];
  assert.equal(migrated(stacked).explainer.charts[0].kind, 'stacked_bar');
  const legacyOnly = v1();
  legacyOnly.charts = [];
  legacyOnly.chart = { title: 'Adoption', caption: 'Share', config_json: barConfig('line'), config_raw: '' };
  assert.equal(migrated(legacyOnly).explainer.charts[0].kind, 'line', 'a legacy chart with empty charts converts');
});

test('code-only and banned-type charts are dropped and listed', () => {
  const codeOnly = v1();
  codeOnly.charts = [];
  codeOnly.chart = { title: 'Costs over time', caption: 'Costs', config_json: null, config_raw: '{type:"bar",data:{labels:[]}}' };
  const a = migrated(codeOnly).explainer;
  assert.equal(a.charts.length, 0);
  assert.ok(has(a.metadata.quality.dropped, /Costs over time/), 'the dropped entry names the code-only chart');
  const banned = v1();
  banned.charts = [{ title: 'Share split', caption: 'Split', config_json: barConfig('doughnut'), config_raw: '' }];
  const b = migrated(banned).explainer;
  assert.equal(b.charts.length, 0);
  assert.ok(has(b.metadata.quality.dropped, /Share split/), 'the dropped entry names the banned-type chart');
});

test('a site-absolute media image resolves beside the artefact', () => {
  const name = `${'b'.repeat(16)}.jpg`;
  const bytes = jpeg(640, 480);
  const doc = v1();
  doc.image = { source_figure: 'Figure 2', caption: 'Costs by layer.', alt_text: 'Bar chart.', src: `/explainer-html/ai-strategy/media/${name}` };
  const io = { listing: [`media/${name}`], bytes: (p: string) => (p === `media/${name}` ? new Uint8Array(bytes) : undefined) };
  const { explainer: e, assets } = migrated(doc, io);
  assert.equal(e.lead_figure.asset, `media/${name}`);
  assert.equal(e.lead_figure.sha256, hex(bytes));
  assert.equal(e.lead_figure.width, 640);
  assert.equal(e.lead_figure.height, 480);
  assert.equal(e.lead_figure.provenance, 'legacy');
  assert.equal(e.lead_figure.caption, 'Costs by layer.');
  assert.equal(assets.length, 0, 'an existing file is not rewritten');
  const svg = v1();
  svg.image = { source_figure: 'Figure 4', caption: 'Diagram.', src: '/explainer-html/ai-strategy/media/diagram.svg' };
  const svgBytes = new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
  const s = migrated(svg, { listing: ['media/diagram.svg'], bytes: (p: string) => (p === 'media/diagram.svg' ? svgBytes : undefined) }).explainer;
  assert.equal(s.lead_figure.asset, 'media/diagram.svg');
  assert.equal(s.lead_figure.width, undefined, 'an SVG carries no width');
  const missing = v1();
  missing.image = { source_figure: 'Figure 5', caption: 'Gone.', src: '/explainer-html/ai-strategy/media/gone.jpg' };
  const m = migrated(missing).explainer;
  assert.equal(m.lead_figure, undefined, 'an image whose file is not beside the artefact is dropped');
  assert.ok(has(m.metadata.quality.dropped, /Figure 5|image/i));
});

test('a base64 image becomes a sidecar asset to write', () => {
  const bytes = png(3, 2);
  const doc = v1();
  doc.image = { source_figure: 'Figure 2', caption: 'Costs.', alt_text: 'Chart.', src: `data:image/png;base64,${bytes.toString('base64')}` };
  const { explainer: e, assets } = migrated(doc);
  assert.equal(e.lead_figure.asset, `${SLUG}/figure-2.png`);
  assert.equal(assets.length, 1);
  assert.equal(assets[0].path, `${SLUG}/figure-2.png`);
  assert.equal(Buffer.compare(Buffer.from(assets[0].bytes), bytes), 0);
  assert.equal(e.lead_figure.sha256, hex(bytes));
  assert.equal(e.lead_figure.width, 3);
  assert.equal(e.lead_figure.height, 2);
});

test('recreated_figure converts by provenance and estimated recreations are dropped', () => {
  const recreated = (data_provenance: string, provenance: string, source: string) => ({
    source_figure: 'Figure 1', title: 'Costs by firm size', caption: 'Costs.', chart_type: 'grouped_bar',
    x: { label: 'Size', values: ['Small', 'Large'] }, y: { label: 'Cost', unit: 'USD' },
    series: [{ name: 'Cost', values: [3, 5], provenance, source }],
    data_provenance, echarts_option: {},
  });
  const exact = v1(); exact.recreated_figure = recreated('paper_exact', 'exact', 'Table 5, page 35');
  const ex = migrated(exact).explainer;
  assert.equal(ex.charts.length, 1);
  assert.equal(ex.charts[0].kind, 'bar', 'grouped_bar becomes bar');
  assert.equal(ex.charts[0].series[0].source.kind, 'table');
  assert.equal(ex.charts[0].series[0].source.ref, 'Table 5');
  assert.equal(JSON.stringify(ex).includes('echarts_option'), false);
  const text = v1(); text.recreated_figure = recreated('paper_exact', 'exact', 'stated in section 4');
  assert.equal(migrated(text).explainer.charts[0].series[0].source.kind, 'text');
  const supplied = v1(); supplied.recreated_figure = recreated('supplied', 'exact', 'costs.csv');
  assert.equal(migrated(supplied).explainer.charts[0].series[0].source.kind, 'supplied');
  const estimated = v1(); estimated.recreated_figure = recreated('figure_estimated', 'estimated', 'read off Figure 1');
  const es = migrated(estimated).explainer;
  assert.equal(es.charts.length, 0, 'an estimated recreation is dropped (Q11)');
  assert.ok(has(es.metadata.quality.dropped, /Costs by firm size|recreated/i));
});

test('extra references, diagrams and undeclared keys are dropped and listed', () => {
  const doc = v1();
  doc.references = [doc.references[0], 'Jones, A. (2024). Other work. <em>Venue</em>.', 'Lee, B. (2023). Third. <em>Venue</em>.'];
  doc.diagrams = [{ mermaid: 'graph TD; A-->B' }];
  doc.notes = 'scratch';
  const e = migrated(doc).explainer;
  assert.equal(e.references.length, 1);
  assert.equal(e.references[0].authors[0].family, 'Smith', 'the first reference is kept');
  assert.ok(e.metadata.quality.dropped.filter((s: string) => /reference/i.test(s)).length >= 2, 'each extra reference is listed');
  assert.ok(has(e.metadata.quality.dropped, /diagrams/));
  assert.ok(has(e.metadata.quality.dropped, /notes/));
  assert.equal(e.diagrams, undefined);
});

test('multi-author and unparseable references', () => {
  const multi = v1();
  multi.references = ['Hu, J., Li, K., & Wu, L. (2025). Scaling agents. <em>Venue</em>.'];
  assert.deepEqual(migrated(multi).explainer.references[0].authors.map((a: any) => a.family), ['Hu', 'Li', 'Wu']);
  const partial = v1();
  partial.references = ['A citation with no recognisable pattern'];
  const p = migrated(partial).explainer;
  assert.equal(p.references[0].title, 'A citation with no recognisable pattern');
  assert.equal(p.references[0].authors[0].family, 'Smith', 'the family name falls back to the slug author segment');
  assert.ok(has(p.metadata.quality.issues, /reference/i), 'the partial parse is recorded in quality.issues');
});

test('values outside an editorial bound are kept with an issue', () => {
  const six = v1();
  six.sections = [1, 2, 3, 4, 5, 6].map((i) => ({ label: `S${i}`, paragraphs: [`P${i}.`] }));
  const s = migrated(six).explainer;
  assert.equal(s.sections.length, 6);
  assert.ok(has(s.metadata.quality.issues, /section/i));
  const noEnd = v1();
  delete noEnd.end_takeaway;
  const n = migrated(noEnd).explainer;
  assert.equal(n.end_takeaway, undefined);
  assert.ok(has(n.metadata.quality.issues, /end_takeaway/));
  const longSub = v1();
  longSub.hero.subtitle = 'x'.repeat(400);
  const l = migrated(longSub).explainer;
  assert.equal(l.hero.subtitle.length, 400, 'an over-long subtitle is kept, not truncated');
  assert.ok(has(l.metadata.quality.issues, /subtitle/));
});

test('a file with no version is read as v1 (Q8)', () => {
  const doc = v1();
  delete doc.version;
  assert.equal(migrated(doc).explainer.hero.title, 'Agent Costs');
});

test('more than three convertible charts keep the first three and list the rest', () => {
  const doc = v1();
  doc.charts = [1, 2, 3, 4].map((i) => ({ title: `Chart ${i}`, caption: `Caption ${i}`, config_json: barConfig('bar'), config_raw: '' }));
  const e = migrated(doc).explainer;
  assert.deepEqual(e.charts.map((c: any) => c.title), ['Chart 1', 'Chart 2', 'Chart 3']);
  assert.ok(has(e.metadata.quality.dropped, /Chart 4/), 'the fourth chart is listed as dropped');
});

test('a listed image whose bytes cannot be read is dropped and listed', () => {
  const doc = v1();
  doc.image = { source_figure: 'Figure 6', caption: 'Unreadable.', src: '/explainer-html/ai-strategy/media/unreadable.jpg' };
  const e = migrated(doc, { listing: ['media/unreadable.jpg'], bytes: () => undefined }).explainer;
  assert.equal(e.lead_figure, undefined);
  assert.ok(has(e.metadata.quality.dropped, /Figure 6|image/i));
});

test('a file that fails a structural bound is a typed failure', () => {
  for (const [why, doc] of [
    ['no sections', { ...v1(), sections: [] }],
    ['no reference', { ...v1(), references: [] }],
    ['not v1', { ...v1(), version: 2 }],
    ['not an object', 'version 1'],
  ] as const) {
    const r = migrate(doc);
    assert.equal(r.ok, false, `${why} must not migrate`);
    assert.equal(typeof r.reason, 'string');
    assert.ok(r.reason.length > 0, `${why} carries a reason`);
  }
});

test('migrateV1 is pure: no file access in the module, input untouched', () => {
  const raw = fs.readFileSync(path.join(REPO_ROOT, 'contract', 'migrate-v1.ts'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  assert.ok(!/['"](node:)?fs(\/promises)?['"]/.test(src), 'contract/migrate-v1.ts must not import fs');
  for (const [re, what] of [[/\bimport\s*\(/, 'a dynamic import'], [/\bfetch\s*\(/, 'fetch'], [/\bDate\.now\s*\(|\bnew Date\s*\(/, 'the clock'], [/\bMath\.random\s*\(/, 'randomness']] as const) {
    assert.ok(!re.test(src), `contract/migrate-v1.ts must not use ${what}`);
  }
  assert.ok(/migrated_from\s*:/.test(src), 'contract/migrate-v1.ts writes migrated_from');
  const doc = v1();
  const before = JSON.stringify(doc);
  migrate(doc);
  assert.equal(JSON.stringify(doc), before, 'migrateV1 must not mutate its input');
  const unit = path.join(REPO_ROOT, 'tests', 'unit', 'migrate-v1.test.ts');
  assert.ok(fs.existsSync(unit), 'tests/unit/migrate-v1.test.ts must exist');
  assert.match(fs.readFileSync(unit, 'utf8'), /migrateV1/, 'the unit test exercises migrateV1');
  const fixtures = path.join(REPO_ROOT, 'tests', 'unit', 'fixtures', 'v1');
  assert.ok(fs.existsSync(fixtures) && fs.readdirSync(fixtures).some((f) => f.endsWith('.json')), 'tests/unit/fixtures/v1/ holds the unit fixtures');
});
// AUTOMETTA-CONTRACT-END
