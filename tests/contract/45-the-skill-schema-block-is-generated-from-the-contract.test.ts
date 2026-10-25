import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SKILL_FILE = path.join(REPO_ROOT, 'skill.md');
const GENERATED_DIR = path.join(REPO_ROOT, 'contract', 'generated');

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/45-the-skill-schema-block-is-generated-from-the-contract.md
const CARD = '45-the-skill-schema-block-is-generated-from-the-contract';
const BEGIN = '<!-- CONTRACT-V2-BEGIN -->';
const END = '<!-- CONTRACT-V2-END -->';

type Schema = {
  properties?: Record<string, Schema>;
  description?: string;
  enum?: unknown[];
  type?: string | string[];
  [key: string]: unknown;
};

function read(relative: string): string {
  const text = fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
  assert.ok(text.trim().length > 0, `${CARD}: empty ${relative}`);
  return text;
}

function sha(file: string): string {
  const bytes = fs.readFileSync(file);
  assert.ok(bytes.length > 0, `${CARD}: empty ${path.basename(file)}`);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function builder(): Record<string, any> {
  const mod = require('../../scripts/contract-build') as Record<string, any>;
  for (const name of ['renderSkill', 'renderSkillBlock', 'checkContract']) {
    assert.equal(typeof mod[name], 'function', `${CARD}: missing ${name}`);
  }
  return mod;
}

function prompt(): Record<string, any> {
  const mod = require('../../src/prompt') as Record<string, any>;
  for (const name of ['buildSystemPrompt', 'buildUserInstruction']) {
    assert.equal(typeof mod[name], 'function', `${CARD}: missing ${name}`);
  }
  return mod;
}

function occurrences(text: string, needle: string): number {
  assert.ok(needle.length > 0, `${CARD}: empty count needle`);
  return text.split(needle).length - 1;
}

function splitBlock(text: string): {
  before: string;
  block: string;
  after: string;
} {
  assert.ok(text.trim().length > 0, `${CARD}: empty marked document`);
  assert.equal(occurrences(text, BEGIN), 1, `${CARD}: BEGIN count`);
  assert.equal(occurrences(text, END), 1, `${CARD}: END count`);
  const begin = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  assert.ok(begin < end, `${CARD}: marker order`);
  const block = text.slice(begin + BEGIN.length, end);
  assert.ok(block.trim().length > 0, `${CARD}: empty schema block`);
  return {
    before: text.slice(0, begin + BEGIN.length),
    block,
    after: text.slice(end),
  };
}

function renderedBlock(): string {
  const block = builder().renderSkillBlock();
  assert.equal(typeof block, 'string', `${CARD}: block type`);
  assert.ok(block.trim().length > 0, `${CARD}: empty rendered block`);
  return block;
}

function systemPrompt(): string {
  const text = prompt().buildSystemPrompt();
  assert.equal(typeof text, 'string', `${CARD}: system prompt type`);
  assert.ok(text.length > 1000, `${CARD}: empty or truncated system prompt`);
  return text;
}

function prose(): string {
  const marked = splitBlock(read('skill.md'));
  const text = systemPrompt();
  const block = marked.block.trim();
  assert.ok(text.includes(block), `${CARD}: prompt lacks schema block`);
  assert.equal(occurrences(text, block), 1, `${CARD}: repeated schema block`);
  const outside = text.replace(block, '');
  assert.ok(outside.length > 1000, `${CARD}: empty or truncated prose`);
  return outside;
}

function section(text: string, heading: string): string {
  const start = text.indexOf(`${heading}\n`);
  assert.ok(start >= 0, `${CARD}: missing ${heading}`);
  const rest = text.slice(start + heading.length + 1);
  const next = rest.search(/^## /m);
  const content = next < 0 ? rest : rest.slice(0, next);
  assert.ok(content.trim().length > 0, `${CARD}: empty ${heading}`);
  return content;
}

function stripFrontmatter(text: string): string {
  const lines = text.split('\n');
  assert.equal(lines[0].trim(), '---', `${CARD}: missing frontmatter`);
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  assert.ok(end > 1, `${CARD}: incomplete frontmatter`);
  const body = lines.slice(end + 1).join('\n').trimStart();
  assert.ok(body.trim().length > 0, `${CARD}: empty skill body`);
  return body;
}

function dialectNodes(value: unknown): Schema[] {
  if (Array.isArray(value)) return value.flatMap(dialectNodes);
  if (!value || typeof value !== 'object') return [];
  const node = value as Schema;
  return [node, ...Object.entries(node).flatMap(([key, child]) =>
    key === 'properties'
      ? Object.values(child as Record<string, unknown>).flatMap(dialectNodes)
      : dialectNodes(child),
  )];
}

function dialect(): Schema {
  const schema = JSON.parse(read('contract/generated/model-output.openai.json'));
  assert.ok(
    Object.keys(schema.properties ?? {}).length > 0,
    `${CARD}: empty wire properties`,
  );
  return schema;
}

function npm(script: string): { status: number | null; out: string } {
  const result = spawnSync('npm', ['run', script], {
    cwd: REPO_ROOT,
    env: { ...process.env, WEBSITE_REPO: '' },
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.ifError(result.error);
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.ok(out.trim().length > 0, `${CARD}: empty ${script} output`);
  return { status: result.status, out };
}

test(`${CARD}: one ordered marker pair is inside JSON schema`, () => {
  const skill = read('skill.md');
  splitBlock(skill);
  const schemaSection = section(skill, '## JSON schema');
  assert.equal(occurrences(schemaSection, BEGIN), 1, `${CARD}: BEGIN location`);
  assert.equal(occurrences(schemaSection, END), 1, `${CARD}: END location`);
  assert.match(skill, /^<!-- CONTRACT-V2-BEGIN -->\r?$/m, `${CARD}: BEGIN line`);
  assert.match(skill, /^<!-- CONTRACT-V2-END -->\r?$/m, `${CARD}: END line`);
});

test(`${CARD}: rendering the finished skill is an identity`, () => {
  const skill = read('skill.md');
  const { renderSkill } = builder();
  assert.equal(renderSkill(skill), skill, `${CARD}: stale skill block`);
  assert.equal(
    splitBlock(skill).block.trim(),
    renderedBlock().trim(),
    `${CARD}: block differs from renderer`,
  );
});

test(`${CARD}: synthetic rendering preserves every byte outside markers`, () => {
  const { renderSkill } = builder();
  const before = '---\r\nname: fixture\r\n---\r\nα prefix\t \n' + BEGIN;
  const after = END + '\r\nsuffix Ω\t \r\n';
  const fixture = before + '\nSTALE FIXTURE\n' + after;
  const result = renderSkill(fixture);
  assert.equal(typeof result, 'string', `${CARD}: rendered document type`);
  assert.notEqual(result, fixture, `${CARD}: stale fixture survived`);
  const parts = splitBlock(result);
  assert.equal(parts.before, before, `${CARD}: prefix bytes changed`);
  assert.equal(parts.after, after, `${CARD}: suffix bytes changed`);
  assert.equal(parts.block.trim(), renderedBlock().trim(), `${CARD}: replacement`);
  assert.equal(renderSkill(result), result, `${CARD}: rendering not idempotent`);
});

test(`${CARD}: malformed markers throw marker-naming errors`, () => {
  const { renderSkill } = builder();
  const pair = `${BEGIN}\nstale\n${END}`;
  const fixtures: Array<[string, string, RegExp]> = [
    ['missing BEGIN', `prefix\nstale\n${END}\nsuffix`, /CONTRACT-V2-BEGIN/],
    ['missing END', `prefix\n${BEGIN}\nstale\nsuffix`, /CONTRACT-V2-END/],
    ['duplicate pair', `${pair}\nbetween\n${pair}`, /CONTRACT-V2-(?:BEGIN|END)/],
    ['duplicate BEGIN', `${BEGIN}\n${pair}`, /CONTRACT-V2-BEGIN/],
    ['duplicate END', `${pair}\n${END}`, /CONTRACT-V2-END/],
  ];
  for (const [name, fixture, marker] of fixtures) {
    assert.ok(fixture.length > 0, `${CARD}: empty ${name} fixture`);
    assert.throws(
      () => renderSkill(fixture),
      marker,
      `${CARD}: ${name} must name marker`,
    );
  }
});

test(`${CARD}: the block covers wire keys without inventing keys`, () => {
  const schema = dialect();
  const nodes = dialectNodes(schema);
  assert.ok(nodes.length > 10, `${CARD}: incomplete dialect walk`);
  const propertyNames = nodes.flatMap(node => Object.keys(node.properties ?? {}));
  assert.ok(propertyNames.length > 20, `${CARD}: missing nested properties`);

  const block = renderedBlock();
  const quotedKeys = [...block.matchAll(/"([^"\r\n]+)"\s*:/g)].map(hit => hit[1]);
  assert.ok(quotedKeys.length > 20, `${CARD}: missing skeleton properties`);

  for (const key of Object.keys(schema.properties!)) {
    assert.ok(quotedKeys.includes(key), `${CARD}: missing root ${key}`);
  }
  for (const key of new Set(propertyNames)) {
    assert.ok(quotedKeys.includes(key), `${CARD}: missing nested ${key}`);
  }

  const kindValues = nodes.flatMap(node => node.properties?.kind?.enum ?? []);
  assert.ok(kindValues.length > 0, `${CARD}: empty kind values`);
  const allowed = new Set([...propertyNames, ...kindValues.map(String)]);
  for (const key of new Set(quotedKeys)) {
    assert.ok(allowed.has(key), `${CARD}: invented key ${key}`);
  }

  const rootPositions = Object.keys(schema.properties!).map(key =>
    block.search(new RegExp(`"${key}"\\s*:`)),
  );
  assert.deepEqual(
    rootPositions,
    [...rootPositions].sort((a, b) => a - b),
    `${CARD}: root property order`,
  );
});

test(`${CARD}: the block retains descriptions, enums and types`, () => {
  const nodes = dialectNodes(dialect());
  const descriptions = nodes.flatMap(node =>
    typeof node.description === 'string' ? [node.description] : [],
  );
  const enumValues = nodes.flatMap(node => node.enum ?? []);
  const types = nodes.flatMap(node =>
    typeof node.type === 'string' ? [node.type] : node.type ?? [],
  );
  assert.ok(descriptions.length > 20, `${CARD}: empty descriptions`);
  assert.ok(enumValues.length > 5, `${CARD}: empty enums`);
  assert.ok(types.length > 20, `${CARD}: empty types`);

  const block = renderedBlock();
  for (const description of descriptions) {
    assert.ok(description.length > 0, `${CARD}: empty dialect description`);
    assert.ok(block.includes(description), `${CARD}: missing ${description}`);
  }
  for (const value of enumValues) {
    const literal = JSON.stringify(value);
    assert.ok(literal.length > 0, `${CARD}: empty enum literal`);
    assert.ok(block.includes(literal), `${CARD}: missing enum ${literal}`);
  }
  for (const type of new Set(types.filter(type => type !== 'null'))) {
    assert.match(block, new RegExp(`\\b${type}\\b`), `${CARD}: missing ${type}`);
  }
  assert.match(block, /or null/, `${CARD}: missing nullability`);
  assert.equal(
    (block.match(/^\s*```[^\r\n]*\r?$/gm) ?? []).length,
    2,
    `${CARD}: expected one fenced block`,
  );
  assert.doesNotMatch(block, /CONTRACT-V2-(?:BEGIN|END)/, `${CARD}: block markers`);
  assert.doesNotMatch(block, /[\u2014\u2015]/, `${CARD}: block em dash`);
  assert.match(block, /"kind"\s*:\s*"pills"/, `${CARD}: pills alternative`);
  assert.match(block, /"kind"\s*:\s*"takeaway"/, `${CARD}: takeaway alternative`);
});

test(`${CARD}: array bounds are attached to sections and charts`, () => {
  const block = renderedBlock();
  const sections = block.match(/"sections"\s*:([^\r\n]*(?:\r?\n\s*\/\/[^\r\n]*)*)/);
  const charts = block.match(/"charts"\s*:([^\r\n]*(?:\r?\n\s*\/\/[^\r\n]*)*)/);
  assert.ok(sections?.[1]?.trim(), `${CARD}: sections annotation missing`);
  assert.ok(charts?.[1]?.trim(), `${CARD}: charts annotation missing`);
  assert.match(sections[1], /\bminItems\b\s*[:=]?\s*2\b/, `${CARD}: sections min`);
  assert.match(sections[1], /\bmaxItems\b\s*[:=]?\s*5\b/, `${CARD}: sections max`);
  assert.match(charts[1], /\bmaxItems\b\s*[:=]?\s*1\b/, `${CARD}: charts max`);
});

test(`${CARD}: check detects only skill drift and restores original bytes`, () => {
  const { checkContract } = builder();
  assert.deepEqual(checkContract(), [], `${CARD}: finished tree drifts`);
  const clean = npm('contract:check');
  assert.equal(clean.status, 0, `${CARD}: ${clean.out}`);
  assert.match(clean.out, /contract: generated files up to date/, `${CARD}: gate`);

  const before = fs.readFileSync(SKILL_FILE);
  assert.ok(before.length > 0, `${CARD}: empty original skill`);
  const original = before.toString('utf8');
  const end = original.indexOf(END);
  assert.ok(end > original.indexOf(BEGIN), `${CARD}: invalid stale fixture`);
  const stale = original.slice(0, end) + '// stale card 45 fixture\n' +
    original.slice(end);
  assert.notEqual(stale, original, `${CARD}: unchanged drift fixture`);

  try {
    fs.writeFileSync(SKILL_FILE, stale);
    const drift = checkContract();
    assert.ok(Array.isArray(drift), `${CARD}: drift must be an array`);
    assert.equal(drift.length, 1, `${CARD}: drift precision`);
    assert.ok(
      /(?:^|[/\\])skill\.md$/.test(drift[0].file),
      `${CARD}: drift does not name skill.md`,
    );
    assert.ok(
      typeof drift[0].detail === 'string' && drift[0].detail.trim().length > 0,
      `${CARD}: empty drift detail`,
    );
    const result = npm('contract:check');
    assert.equal(result.status, 1, `${CARD}: stale gate exit: ${result.out}`);
    assert.match(result.out, /skill\.md/, `${CARD}: stale gate filename`);
  } finally {
    fs.writeFileSync(SKILL_FILE, before);
  }

  assert.deepEqual(fs.readFileSync(SKILL_FILE), before, `${CARD}: restore bytes`);
  assert.deepEqual(checkContract(), [], `${CARD}: drift after restoration`);
});

test(`${CARD}: contract build leaves finished artefacts untouched`, () => {
  const generated = fs.readdirSync(GENERATED_DIR).sort();
  assert.deepEqual(generated, [
    'explainer-v2.schema.json',
    'model-output.claude.json',
    'model-output.gemini.json',
    'model-output.openai.json',
  ], `${CARD}: generated file inventory`);
  const files = [SKILL_FILE, ...generated.map(name => path.join(GENERATED_DIR, name))];
  const snapshot = () => files.map(file => ({
    file,
    hash: sha(file),
    mtime: fs.statSync(file, { bigint: true }).mtimeNs.toString(),
  }));
  const before = snapshot();
  const result = npm('contract:build');
  assert.equal(result.status, 0, `${CARD}: ${result.out}`);
  assert.match(result.out, /contract: generated files up to date/, `${CARD}: build`);
  assert.doesNotMatch(result.out, /contract: wrote\b/, `${CARD}: build wrote files`);
  assert.deepEqual(snapshot(), before, `${CARD}: build changed finished files`);
});

test(`${CARD}: system prompt removes only frontmatter and marker lines`, () => {
  const skill = read('skill.md');
  const expected = stripFrontmatter(skill).trimEnd().replace(
    /^<!-- CONTRACT-V2-(?:BEGIN|END) -->\r?\n/gm,
    '',
  );
  assert.ok(expected.length > 1000, `${CARD}: empty expected prompt`);
  const actual = systemPrompt();
  assert.equal(actual, expected, `${CARD}: prompt transformation`);
  assert.doesNotMatch(actual, /CONTRACT-V2-BEGIN/, `${CARD}: leaked BEGIN`);
  assert.doesNotMatch(actual, /CONTRACT-V2-END/, `${CARD}: leaked END`);
  assert.ok(actual.includes(renderedBlock().trim()), `${CARD}: missing block`);
});

test(`${CARD}: system prompt removes v1 fields and instructions`, () => {
  const text = systemPrompt();
  const forbidden = [
    'headline_html', 'paragraphs_html', '_html"', 'accent_color', '<span',
    'config_json', 'Chart.js', 'options.scales', 'title.display',
    'filename_slug', 'date_created', 'eyebrow', 'publication_date',
    '"version"', '"metadata"', '"references"', 'recreated_figure',
  ];
  for (const token of forbidden) {
    assert.ok(!text.includes(token), `${CARD}: v1 token ${token}`);
  }
  assert.doesNotMatch(
    text,
    /\((?:Table|Figure) \d+, p\. \d+\)/,
    `${CARD}: caption page tag`,
  );
  assert.doesNotMatch(text, /^\s*"image"\s*:/m, `${CARD}: image key`);
  assert.doesNotMatch(text, /NEVER emit/, `${CARD}: v1 figure rule`);
  assert.doesNotMatch(text, /vision model (?:auto-)?picks/i, `${CARD}: v1 figure picker`);

  const outside = prose();
  assert.doesNotMatch(outside, /\b(?:metadata|references)\b/i, `${CARD}: v1 prose`);
  assert.doesNotMatch(outside, /`(?:number|description|align)`/, `${CARD}: v1 field`);
  assert.doesNotMatch(
    outside,
    /match the axes|faithfully recreated|reproduce (?:it|that shape|that)\b/i,
    `${CARD}: removed figure phrasing`,
  );
});

test(`${CARD}: v2 instructions are present outside the generated block`, () => {
  const text = prose();
  for (const token of ['emphasis', 'citation', 'figure_request', 'lead', 'source']) {
    assert.match(text, new RegExp(`\\b${token}\\b`), `${CARD}: missing prose ${token}`);
  }
  assert.match(text, /\b(?:x|y)\.unit\b/, `${CARD}: missing axis unit rule`);
  assert.match(text, /continuation/i, `${CARD}: missing pill continuation`);
  assert.match(text, /lowercase/i, `${CARD}: missing lowercase rule`);
  assert.match(text, /copied exactly[^.\n]*headline|headline[^.\n]*copied exactly/i, `${CARD}: emphasis copy rule`);
  assert.match(text, /front matter/i, `${CARD}: citation source`);
  assert.match(text, /citation[^.\n]*known|known[^.\n]*citation/i, `${CARD}: known citation`);
  assert.match(text, /placeholder/i, `${CARD}: placeholder author rule`);

  for (const tag of ['<em>', '<strong>', '<code>', '<sub>', '<sup>']) {
    assert.ok(text.includes(tag), `${CARD}: missing inline ${tag}`);
  }
  assert.match(text, /<a href(?:>|=)/, `${CARD}: missing inline anchor`);
  assert.match(text, /\bref\b/, `${CARD}: missing source ref`);
  assert.match(text, /\bpage\b/, `${CARD}: missing source page`);

  const checklist = section(text, '## Pre-delivery checklist');
  for (const field of ['emphasis', 'citation', 'source']) {
    assert.match(checklist, new RegExp(`\\b${field}\\b`), `${CARD}: checklist ${field}`);
  }
  assert.doesNotMatch(
    checklist,
    /filename_slug|metadata|Published Month Year|HTML.reference|bracketed (?:source )?tag/i,
    `${CARD}: obsolete checklist`,
  );
});

test(`${CARD}: frontmatter no longer permits markup in pills or references`, () => {
  const skill = read('skill.md');
  const frontmatter = skill.match(/^---\r?\n([\s\S]+?)\r?\n---(?:\r?\n|$)/);
  assert.ok(frontmatter?.[1]?.trim(), `${CARD}: empty frontmatter`);
  const description = frontmatter[1].match(/^description:\s*(.+)$/m);
  assert.ok(description?.[1]?.trim(), `${CARD}: empty skill description`);
  assert.doesNotMatch(
    description[1],
    /inline markup inside[^.]*\b(?:pills|references)\b|(?:pills|references)[^.]*may carry inline markup/i,
    `${CARD}: frontmatter permits obsolete markup`,
  );
});

test(`${CARD}: frozen chart and figure rules remain outside markers`, () => {
  const text = prose();
  const chartRules = [
    /never read values off/i,
    /stated in the text or a table/i,
    /names the table or page/i,
    /pie, doughnut,? or radar/i,
    /never join categories with a line/i,
    /never split a reported range/i,
    /\b(?:no|never)\b[^.\n]*stacked bars?[^.\n]*\blog\b/i,
    /prefer a `table`/i,
  ];
  for (const rule of chartRules) {
    assert.match(text, rule, `${CARD}: missing chart rule ${rule.source}`);
  }
  const sentences = text.split(/\n+|(?<=[.!?])\s+/).filter(s => s.trim());
  assert.ok(sentences.length > 10, `${CARD}: empty prose sentences`);
  const chartLimits = sentences.filter(s => /at most one chart/i.test(s));
  assert.ok(chartLimits.length > 0, `${CARD}: missing chart limit`);
  assert.ok(chartLimits.some(s => /\bURL\b/.test(s)), `${CARD}: URL chart limit`);
  const bannedChartSentences = sentences.filter(s => /\b(?:pie|doughnut|radar|spider)\b/i.test(s));
  assert.ok(bannedChartSentences.length > 0, `${CARD}: missing chart bans`);
  for (const sentence of bannedChartSentences) {
    assert.match(sentence, /\b(?:no|never|not|banned)\b/i, `${CARD}: offered banned chart`);
  }
  assert.match(systemPrompt(), /"table"\s*:\s*\{/, `${CARD}: missing table shape`);

  for (const sentence of [
    'Do not emit an `image` field or any image bytes; name the figure in `figure_request` and the pipeline locates and attaches it.',
    'Figures are never a source of chart values.',
    "- [ ] `figure_request` names one figure by the paper's own label, or is null.",
  ]) {
    assert.ok(text.includes(sentence), `${CARD}: frozen figure sentence`);
  }
  const paragraph = text.split(/\n\s*\n/).find(p => p.includes('`figure_request.label`'));
  assert.ok(paragraph?.trim(), `${CARD}: missing figure paragraph`);
  assert.match(paragraph, /key results figure/i, `${CARD}: figure preference`);
  assert.match(paragraph, /\bnull\b/, `${CARD}: nullable figure`);
});

test(`${CARD}: ranked writing rules and hard floor survive`, () => {
  const text = prose();
  const writing = section(text, '## Writing the prose');
  assert.deepEqual(
    [...writing.matchAll(/^(\d+)\.\s/gm)].map(match => Number(match[1])),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    `${CARD}: ranked writing rules`,
  );
  for (const rule of [
    /only what the paper supports/i,
    /claim no more than the body/i,
    /on first use/i,
    /28 words/,
    /lead each section with its finding/i,
    /no manufactured twist/i,
    /at most one figurative line/i,
    /so what/i,
    /no jokes/i,
    /at most twice/i,
    /It is not X\. It is Y\./,
    /only when the finding (?:really )?is a contrast/i,
    /British English/,
    /no em dashes/i,
  ]) {
    assert.match(writing, rule, `${CARD}: missing writing rule ${rule.source}`);
  }
  for (const heading of ['## JSON schema', '## Headline rules', '## Pre-delivery checklist']) {
    assert.ok(text.includes(heading), `${CARD}: missing ${heading}`);
  }
  assert.match(text, /must not change what the statistic means/i, `${CARD}: statistic meaning`);
  assert.match(text, /No semicolons/, `${CARD}: semicolon rule`);
  assert.doesNotMatch(systemPrompt(), /[\u2014\u2015]/, `${CARD}: system em dash`);

  const block = renderedBlock();
  const combined = `${block}\n${text}`;
  assert.ok(combined.length > 1000, `${CARD}: empty combined prompt`);
  for (const word of ['tapestry', 'delve', 'synergy', 'leverage']) {
    const pattern = new RegExp(`\\b${word}\\b`, 'gi');
    assert.equal((block.match(pattern) ?? []).length, 0, `${CARD}: block word ${word}`);
    assert.equal((combined.match(pattern) ?? []).length, 1, `${CARD}: combined word ${word}`);
    assert.equal((systemPrompt().match(pattern) ?? []).length, 1, `${CARD}: prompt word ${word}`);
  }
});

test(`${CARD}: docs explain stripped markers and generated skill block`, () => {
  for (const file of ['README.md', 'AGENTS.md']) {
    const text = read(file);
    const paragraphs = text.split(/\n\s*\n/).filter(p => /skill\.md/.test(p));
    assert.ok(paragraphs.length > 0, `${CARD}: ${file} lacks skill.md`);
    assert.ok(paragraphs.some(p =>
      /marker/i.test(p) && /stripp/i.test(p) && /contract:build/.test(p),
    ), `${CARD}: ${file} lacks marker and generation explanation`);
  }
});

// AUTOMETTA-CONTRACT-END
