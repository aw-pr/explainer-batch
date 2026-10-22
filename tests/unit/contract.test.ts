import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ExplainerV2, ModelOutputV2, modelOutputValidator } from '../../contract/explainer-v2';
import { assertOpenAiStrict, claudePass, geminiPass, openaiPass } from '../../contract/dialects';
import { sanitiseInline } from '../../contract/inline';
import { checkContract, renderSkill, renderSkillBlock } from '../../scripts/contract-build';

const FIXTURES = path.join(__dirname, 'fixtures', 'v2');
const GENERATED = path.join(__dirname, '..', '..', 'contract', 'generated');

function fixture(name: string): any {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

const storedSample = (): any => fixture('alenezi-agentic-ai-architecture.stored.json');
const wireSample = (): any => fixture('alenezi-agentic-ai-architecture.model-output.json');

function wireChart(): any {
  return {
    kind: 'bar',
    title: 'Agent adoption',
    caption: 'Share of surveyed firms running agents',
    x: { label: 'Year', unit: null, type: 'category', values: ['2024', '2025'] },
    y: { label: 'Share of firms', unit: '%', scale: 'linear' },
    series: [{ name: 'Firms', values: [8, 12], points: null, source: { kind: 'table', ref: 'Table 1', page: 3 } }],
  };
}

function issuesOf(result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }): string[] {
  return (result.error?.issues ?? []).map((i) => `${i.path.join('.')}: ${i.message}`);
}

test('the tracked v1 sample, converted by hand to v2, parses as a stored artefact', () => {
  const result = ExplainerV2.safeParse(storedSample());
  assert.ok(result.success, issuesOf(result).join('\n'));
});

test('the same article as a wire output parses when the model had to emit the citation', () => {
  const result = modelOutputValidator({ citationKnown: false }).safeParse(wireSample());
  assert.ok(result.success, issuesOf(result).join('\n'));
  assert.ok(modelOutputValidator({ citationKnown: false }).safeParse({ ...wireSample(), charts: [wireChart()] }).success);
});

test('a <span> in a paragraph is rejected on the wire', () => {
  const wire = wireSample();
  wire.sections[0].paragraphs = ['A <span>highlighted</span> claim.'];
  const result = ModelOutputV2.safeParse(wire);
  assert.equal(result.success, false);
  assert.ok(issuesOf(result).some((i) => i.startsWith('sections.0.paragraphs.0')), issuesOf(result).join('\n'));
});

test('a two-chart wire output is rejected', () => {
  const wire = { ...wireSample(), charts: [wireChart(), wireChart()] };
  assert.equal(ModelOutputV2.safeParse(wire).success, false);
});

test('a wire output carrying metadata is rejected', () => {
  const wire = { ...wireSample(), metadata: { date_created: '2026-04-16' } };
  assert.equal(ModelOutputV2.safeParse(wire).success, false);
});

test('citation is required only when citationKnown is false', () => {
  const wire = { ...wireSample(), citation: null };
  assert.equal(modelOutputValidator({ citationKnown: false }).safeParse(wire).success, false);
  assert.ok(modelOutputValidator({ citationKnown: true }).safeParse(wire).success);
});

test('a migrated artefact with unknown provider and route and six sections parses', () => {
  const stored = storedSample();
  stored.metadata.provider = 'unknown';
  stored.metadata.route = 'unknown';
  stored.metadata.migrated_from = 1;
  stored.sections.push({ label: 'A sixth section', paragraphs: ['Curated and published with six sections.'] });
  stored.metadata.quality.issues = ['sections: 6 is above the editorial maximum of 5'];
  const result = ExplainerV2.safeParse(stored);
  assert.ok(result.success, issuesOf(result).join('\n'));
});

test('the generated OpenAI dialect is strict: every object closed and fully required', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(GENERATED, 'model-output.openai.json'), 'utf8'));
  assert.doesNotThrow(() => assertOpenAiStrict(schema));
  const objects: any[] = [];
  const visit = (n: any): void => {
    if (Array.isArray(n)) n.forEach(visit);
    else if (n && typeof n === 'object') {
      if (n.properties) objects.push(n);
      for (const [k, v] of Object.entries(n)) {
        if (k === 'properties') Object.values(v as object).forEach(visit);
        else visit(v);
      }
    }
  };
  visit(schema);
  assert.ok(objects.length >= 10);
  for (const n of objects) {
    assert.equal(n.additionalProperties, false);
    assert.deepEqual([...n.required].sort(), Object.keys(n.properties).sort());
  }
});

test('the dialect passes rewrite a small schema as designed', () => {
  const zodLike = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      kind: { type: 'string', const: 'pills' },
      note: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }], description: 'A note.' },
      block: { oneOf: [{ type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false }] },
    },
    required: ['kind', 'note', 'block'],
    additionalProperties: false,
  };
  const openai = openaiPass(zodLike);
  assert.deepEqual(openai.properties, {
    kind: { type: 'string', enum: ['pills'] },
    note: { type: ['string', 'null'], description: 'A note.' },
    block: { anyOf: [{ type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false }] },
  });
  assert.equal('$schema' in openai, false);

  const claude = claudePass(zodLike) as any;
  assert.equal('$schema' in claude, false);
  assert.deepEqual(claude.properties.kind, { type: 'string', enum: ['pills'] });
  assert.equal(claude.properties.note.anyOf.length, 2, 'Claude keeps anyOf nullables');

  const gemini = geminiPass({ type: 'object', properties: { b: { type: 'string', nullable: true }, a: { type: 'string' } }, required: ['b', 'a'], additionalProperties: false }) as any;
  assert.deepEqual(gemini, { type: 'object', properties: { b: { type: 'string', nullable: true }, a: { type: 'string' } }, required: ['b', 'a'], propertyOrdering: ['b', 'a'] });

  assert.throws(() => openaiPass({ type: 'object', properties: { a: { type: 'string' } }, required: [], additionalProperties: false }), /require every property/);
  assert.throws(() => openaiPass({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }), /additionalProperties false/);
});

test('sanitiseInline is idempotent on malformed input', () => {
  for (const s of ['<em>a <strong>b</em> c</strong>', '<a href="https://x.org"><a href="https://y.org">in</a>out</a>', 'x < y', '<em>open', '&lt;b&gt; &#39;']) {
    const once = sanitiseInline(s);
    assert.equal(sanitiseInline(once), once, s);
  }
});

test('contract:check finds the generated files up to date', () => {
  assert.deepEqual(checkContract(), []);
});

test('renderSkill replaces only the content between the markers and is idempotent', () => {
  const before = 'prefix\t\r\n<!-- CONTRACT-V2-BEGIN -->';
  const after = '<!-- CONTRACT-V2-END -->\r\nsuffix\t ';
  const rendered = renderSkill(`${before}\nstale\n${after}`);
  assert.equal(rendered, before + renderSkillBlock() + after);
  assert.equal(renderSkill(rendered), rendered);
});

test('renderSkill rejects missing, duplicated and reversed markers', () => {
  const begin = '<!-- CONTRACT-V2-BEGIN -->';
  const end = '<!-- CONTRACT-V2-END -->';
  for (const marker of [begin, end]) {
    const other = marker === begin ? end : begin;
    assert.throws(() => renderSkill(other), error => error instanceof Error && error.message.includes(marker));
    assert.throws(() => renderSkill(`${begin}${marker}${end}`), error => error instanceof Error && error.message.includes(marker));
  }
  assert.throws(() => renderSkill(`${end}${begin}`), /CONTRACT-V2-BEGIN.*CONTRACT-V2-END/);
});

test('renderSkillBlock names every top-level wire property in schema order', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(GENERATED, 'model-output.openai.json'), 'utf8'));
  const keys = [...renderSkillBlock().matchAll(/^  "([^"]+)": /gm)].map(match => match[1]);
  assert.deepEqual(keys, Object.keys(schema.properties));
});

test('a table accepts an empty cell and rejects a tagged cell and an empty column heading', () => {
  const withTable = (columns: string[], rows: string[][]): any => {
    const doc = storedSample();
    doc.sections[0].table = { columns, rows };
    return doc;
  };
  assert.ok(ExplainerV2.safeParse(withTable(['Year', 'Cost'], [['2025', '']])).success);
  assert.ok(!ExplainerV2.safeParse(withTable(['Year', 'Cost'], [['2025', '<b>10</b>']])).success);
  assert.ok(!ExplainerV2.safeParse(withTable(['Year', ''], [['2025', '10']])).success);
});
