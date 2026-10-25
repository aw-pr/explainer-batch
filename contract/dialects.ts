// The schema dialects, each generated from the zod source and then adjusted
// by a small deterministic pass over plain JSON. No dialect is hand-written.
//
// zod 4.3.6 emits a discriminated union as `oneOf`. Its variants are disjoint
// on `kind`, so `anyOf` accepts exactly the same documents; every wire dialect
// rewrites it, because none of the three structured-output subsets accepts
// `oneOf`.
import { z } from 'zod';
import { ExplainerV2, ModelOutputV2 } from './explainer-v2';

type Schema = Record<string, unknown>;

const SUBSCHEMA_MAPS = ['properties', '$defs', 'definitions'];
const SUBSCHEMA_LISTS = ['anyOf', 'oneOf', 'allOf', 'prefixItems'];
const SUBSCHEMA_SINGLE = ['items', 'additionalProperties', 'not'];

function isSchema(v: unknown): v is Schema {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Rebuilds a schema bottom-up, applying `visit` to every node after its children. */
function walk(node: Schema, visit: (n: Schema) => Schema): Schema {
  const out: Schema = {};
  for (const [key, value] of Object.entries(node)) {
    if (SUBSCHEMA_MAPS.includes(key) && isSchema(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, isSchema(v) ? walk(v, visit) : v]));
    } else if (SUBSCHEMA_LISTS.includes(key) && Array.isArray(value)) {
      out[key] = value.map((v) => (isSchema(v) ? walk(v, visit) : v));
    } else if (SUBSCHEMA_SINGLE.includes(key) && isSchema(value)) {
      out[key] = walk(value, visit);
    } else {
      out[key] = value;
    }
  }
  return visit(out);
}

function oneOfToAnyOf(n: Schema): Schema {
  if (!('oneOf' in n)) return n;
  const { oneOf, ...rest } = n;
  return { ...rest, anyOf: oneOf };
}

function constToEnum(n: Schema): Schema {
  if (!('const' in n)) return n;
  const { const: value, ...rest } = n;
  return { ...rest, enum: [value] };
}

/** `anyOf: [{type: T, ...}, {type: 'null'}]` becomes `type: [T, 'null']` carrying the inner keywords. */
function collapseNullable(n: Schema): Schema {
  const options = n.anyOf;
  if (!Array.isArray(options) || options.length !== 2) return n;
  const nullIndex = options.findIndex((o) => isSchema(o) && o.type === 'null' && Object.keys(o).length === 1);
  if (nullIndex === -1) return n;
  const inner = options[1 - nullIndex] as Schema;
  if (typeof inner.type !== 'string') return n;
  const { anyOf: _anyOf, ...outer } = n;
  const merged: Schema = { ...inner, ...outer, type: [inner.type, 'null'] };
  if (Array.isArray(inner.enum)) merged.enum = [...inner.enum, null];
  return merged;
}

const OPENAI_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'anyOf',
  'description',
  'minItems',
  'maxItems',
]);

function keepOpenAiKeywords(n: Schema): Schema {
  return Object.fromEntries(Object.entries(n).filter(([k]) => OPENAI_KEYWORDS.has(k)));
}

/** Throws unless every object is closed and lists every property in `required`, as OpenAI strict mode demands. */
export function assertOpenAiStrict(schema: Schema): void {
  const check = (n: Schema, at: string): void => {
    const types = ([] as unknown[]).concat(n.type);
    if (isSchema(n.properties) || types.includes('object')) {
      const keys = Object.keys(isSchema(n.properties) ? n.properties : {});
      const required = Array.isArray(n.required) ? n.required : [];
      if (n.additionalProperties !== false) throw new Error(`openai dialect: ${at} must set additionalProperties false`);
      const missing = keys.filter((k) => !required.includes(k));
      if (missing.length > 0 || required.length !== keys.length) {
        throw new Error(`openai dialect: ${at} must require every property (missing ${missing.join(', ') || 'none'})`);
      }
    }
    for (const [key, value] of Object.entries(n)) {
      if (key === 'properties' && isSchema(value)) {
        for (const [k, v] of Object.entries(value)) if (isSchema(v)) check(v, `${at}.properties.${k}`);
      } else if (key === 'anyOf' && Array.isArray(value)) {
        value.forEach((v, i) => isSchema(v) && check(v, `${at}.anyOf[${i}]`));
      } else if (key === 'items' && isSchema(value)) {
        check(value, `${at}.items`);
      }
    }
  };
  check(schema, '#');
}

export function openaiPass(schema: Schema): Schema {
  const out = walk(schema, (n) => keepOpenAiKeywords(collapseNullable(constToEnum(oneOfToAnyOf(n)))));
  assertOpenAiStrict(out);
  return out;
}

export function claudePass(schema: Schema): Schema {
  const { $schema: _drop, ...rest } = walk(schema, (n) => constToEnum(oneOfToAnyOf(n)));
  return rest;
}

/** Expects the `openapi-3.0` target, so nullables already read `nullable: true` and literals `enum`. */
export function geminiPass(schema: Schema): Schema {
  return walk(schema, (n) => {
    const { additionalProperties: _ap, $schema: _s, ...rest } = constToEnum(oneOfToAnyOf(n));
    if (isSchema(rest.properties)) rest.propertyOrdering = Object.keys(rest.properties);
    return rest;
  });
}

/** Every generated file under contract/generated/, keyed by file name. */
export function generateSchemas(): Record<string, Schema> {
  const options = { io: 'output', unrepresentable: 'throw' } as const;
  const wire = z.toJSONSchema(ModelOutputV2, { target: 'draft-2020-12', ...options }) as Schema;
  const openapi = z.toJSONSchema(ModelOutputV2, { target: 'openapi-3.0', ...options }) as Schema;
  return {
    'explainer-v2.schema.json': z.toJSONSchema(ExplainerV2, { target: 'draft-2020-12', ...options }) as Schema,
    'model-output.openai.json': openaiPass(wire),
    'model-output.claude.json': claudePass(wire),
    'model-output.gemini.json': geminiPass(openapi),
  };
}
