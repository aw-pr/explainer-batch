/**
 * MODEL-FACING JSON Schema for the explainer output, used to enforce
 * structured output at the API layer (OpenAI `text.format:{type:'json_schema'}`
 * and Claude's forced-tool `input_schema`).
 *
 * This deliberately DIVERGES from the canonical `ExplainerJson` type
 * (`src/types/explainer-json.ts`, the saved-artifact / website contract) in
 * two ways, both required by OpenAI's strict structured-output subset:
 *
 *   1. `chart.config_json` is emitted as a STRINGIFIED Chart.js config
 *      (`{type:'string'}`) here, not an object. `src/output.ts` parses it
 *      back into an object before the artifact is saved, so the saved JSON
 *      still matches `ExplainerJson.config_json: unknown | null`.
 *   2. `image.src` is omitted entirely — the model must never emit it. It is
 *      filled in post-hoc by `attachFigureImage` (`src/output.ts`).
 *
 * The strict subset also requires, on every object: `additionalProperties:false`
 * and every property listed in `required` (optional fields are expressed as
 * nullable via `type:[X,'null']` rather than being absent from `required`).
 * Discriminated unions use `anyOf` (not `oneOf`); discriminators are
 * `{type:'string',enum:[...]}` (not a bare `const`).
 *
 * Keep this file in lockstep with `src/types/explainer-json.ts` — any field
 * added/removed/renamed there must be mirrored here (modulo the two
 * divergences above), and vice versa.
 */

type JsonSchemaObject = Record<string, unknown>;

function obj(properties: JsonSchemaObject, required: string[], extra: JsonSchemaObject = {}): JsonSchemaObject {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required,
    ...extra,
  };
}

function nullable(type: string): JsonSchemaObject {
  return { type: [type, 'null'] };
}

function nullableObj(properties: JsonSchemaObject, required: string[]): JsonSchemaObject {
  return {
    type: ['object', 'null'],
    additionalProperties: false,
    properties,
    required,
  };
}

function nullableArray(items: JsonSchemaObject): JsonSchemaObject {
  return { type: ['array', 'null'], items };
}

const pillSchema = obj(
  {
    number: { type: 'string' },
    description: { type: 'string' },
    accent_color: { type: 'string' },
  },
  ['number', 'description', 'accent_color'],
);

const topBlockSchema = {
  anyOf: [
    obj(
      {
        kind: { type: 'string', enum: ['pills'] },
        pills: { type: 'array', items: pillSchema },
      },
      ['kind', 'pills'],
    ),
    obj(
      {
        kind: { type: 'string', enum: ['takeaway'] },
        label: { type: 'string' },
        body: { type: 'string' },
      },
      ['kind', 'label', 'body'],
    ),
  ],
};

const listItemSchema = obj(
  {
    label: nullable('string'),
    body: { type: 'string' },
    body_html: nullable('string'),
  },
  ['label', 'body', 'body_html'],
);

const listSchema = nullableObj(
  {
    ordered: { type: 'boolean' },
    style: { type: ['string', 'null'], enum: ['steps', 'list', null] },
    intro: nullable('string'),
    intro_html: nullable('string'),
    items: { type: 'array', items: listItemSchema },
  },
  ['ordered', 'style', 'intro', 'intro_html', 'items'],
);

const tableSchema = nullableObj(
  {
    caption: nullable('string'),
    columns: { type: 'array', items: { type: 'string' } },
    rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
    align: nullableArray({ type: 'string', enum: ['left', 'right', 'center'] }),
  },
  ['caption', 'columns', 'rows', 'align'],
);

const sectionSchema = obj(
  {
    label: { type: 'string' },
    paragraphs: { type: 'array', items: { type: 'string' } },
    paragraphs_html: nullableArray({ type: 'string' }),
    list: listSchema,
    table: tableSchema,
  },
  ['label', 'paragraphs', 'paragraphs_html', 'list', 'table'],
);

// config_json is a STRINGIFIED Chart.js config (parsed back to an object by
// src/output.ts before the artifact is saved) — see the file header.
const chartSchema = obj(
  {
    title: { type: 'string' },
    caption: { type: 'string' },
    config_json: { type: 'string' },
    config_raw: nullable('string'),
  },
  ['title', 'caption', 'config_json', 'config_raw'],
);

// `src` is deliberately omitted — filled in post-hoc by attachFigureImage.
const imageSchema = nullableObj(
  {
    source_figure: { type: 'string' },
    caption: { type: 'string' },
    alt_text: nullable('string'),
  },
  ['source_figure', 'caption', 'alt_text'],
);

const endTakeawaySchema = nullableObj(
  {
    label: { type: 'string' },
    body: { type: 'string' },
  },
  ['label', 'body'],
);

const metadataSchema = obj(
  {
    title: { type: 'string' },
    eyebrow: nullable('string'),
    date_created: { type: 'string' },
    filename_slug: { type: 'string' },
  },
  ['title', 'eyebrow', 'date_created', 'filename_slug'],
);

const heroSchema = obj(
  {
    headline: { type: 'string' },
    headline_html: { type: 'string' },
    subtitle: { type: 'string' },
    publication_date: nullable('string'),
  },
  ['headline', 'headline_html', 'subtitle', 'publication_date'],
);

export const EXPLAINER_JSON_SCHEMA: JsonSchemaObject = obj(
  {
    version: { type: 'integer', enum: [1] },
    metadata: metadataSchema,
    hero: heroSchema,
    top_block: topBlockSchema,
    charts: nullableArray(chartSchema),
    image: imageSchema,
    sections: { type: 'array', items: sectionSchema },
    end_takeaway: endTakeawaySchema,
    references: { type: 'array', items: { type: 'string' } },
  },
  ['version', 'metadata', 'hero', 'top_block', 'charts', 'image', 'sections', 'end_takeaway', 'references'],
);

/** Default ON. Set STRUCTURED_OUTPUT=0 to fall back to unenforced JSON output. */
export function structuredOutputEnabled(): boolean {
  return process.env.STRUCTURED_OUTPUT !== '0';
}
