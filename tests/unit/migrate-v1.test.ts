import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ExplainerV2 } from '../../contract/explainer-v2';
import { migrateV1, MigrateIo } from '../../contract/migrate-v1';

const fixtures = join(__dirname, 'fixtures', 'v1');
const noIo: MigrateIo = { listing: [], bytes: () => undefined };

function at(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((v, key) => (v as Record<string, unknown>)[key], value);
}

for (const name of readdirSync(fixtures).filter(n => n.endsWith('.json')).sort()) {
  test(`migrateV1 fixture: ${name}`, () => {
    const fixture = JSON.parse(readFileSync(join(fixtures, name), 'utf8')) as {
      input: unknown; ok: boolean; expected?: Record<string, unknown>;
      dropped?: string[]; issues?: string[]; media?: { path: string; base64: string };
    };
    const before = JSON.stringify(fixture.input);
    const media = fixture.media;
    const io: MigrateIo = media ? {
      listing: [media.path], bytes: path => path === media.path ? Buffer.from(media.base64, 'base64') : undefined,
    } : noIo;
    const result = migrateV1(fixture.input, io);
    assert.equal(result.ok, fixture.ok, result.ok ? name : result.reason);
    assert.equal(JSON.stringify(fixture.input), before);
    assert.deepEqual(migrateV1(fixture.input, io), result, 'migration is deterministic');
    if (!result.ok) { assert.ok(result.reason.length); return; }
    const e = result.explainer;
    assert.ok(ExplainerV2.safeParse(e).success);
    assert.equal(e.metadata.migrated_from, 1);
    assert.equal(e.references[0].origin, 'legacy');
    for (const [path, expected] of Object.entries(fixture.expected ?? {})) assert.deepEqual(at(e, path), expected, path);
    for (const value of fixture.dropped ?? []) assert.ok(e.metadata.quality.dropped.some(s => s.includes(value)), value);
    for (const value of fixture.issues ?? []) assert.ok(e.metadata.quality.issues.some(s => s.includes(value)), value);
    if (e.lead_figure) {
      const bytes = media ? io.bytes(media.path) : result.assets[0]?.bytes;
      assert.ok(bytes);
      assert.equal(e.lead_figure.sha256, createHash('sha256').update(bytes).digest('hex'));
      assert.equal(result.assets.length, media ? 0 : 1);
    }
  });
}

test('migrateV1 tracked sample preserves content and decodes its image', () => {
  const raw = JSON.parse(readFileSync(join(__dirname, '../../output/2026-04-16_alenezi_agentic-ai-architecture_explainer.json'), 'utf8'));
  const before = JSON.stringify(raw);
  const result = migrateV1(raw, noIo);
  assert.ok(result.ok, result.ok ? '' : result.reason);
  assert.ok(ExplainerV2.safeParse(result.explainer).success);
  assert.equal(result.explainer.metadata.provider, 'unknown');
  assert.equal(result.explainer.metadata.route, 'unknown');
  assert.equal(result.explainer.hero.title, 'Agentic AI Architecture');
  assert.equal(result.explainer.references[0].authors[0].family, 'Alenezi');
  assert.equal(result.assets.length, 1);
  assert.deepEqual(Buffer.from(result.assets[0].bytes), Buffer.from(raw.image.src.split(',')[1], 'base64'));
  assert.equal(JSON.stringify(raw), before);
});

test('migrateV1 returns typed failures for malformed structures', () => {
  for (const input of [null, 1, [], 'v1', {}, { version: 3 }]) {
    const result = migrateV1(input, noIo);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.reason);
  }
});
